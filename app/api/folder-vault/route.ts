import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { canAccessFolder, requireTabAccess } from "@/lib/auth";
import { firestore } from "@/lib/firebase-admin";
import { appendActivity } from "@/lib/activity";
import { buildTopLevelFolderMap, folderTopLevelId, listProjectFolders } from "@/lib/folders";
import { parseFolderVault, resetVaultPassword, unwrapVault, validateVaultPassword, vaultRecoveryConfigured, VaultRecoveryConfigurationError, wrapVaultRecovery } from "@/lib/folder-vault-crypto";
import { consumeVaultUnlockAttempt, endVaultSession, hasVaultGrant, startVaultSession, vaultAttemptRef, vaultRootFolder } from "@/lib/folder-vault";
import { FOLDERS, LEGACY_PROJECT_ID, MEMBERSHIPS, type MemberRecord, USERS } from "@/lib/project";

export const runtime = "nodejs";

function reply(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  const allowed = new Set([new URL(request.url).origin]);
  // Standalone Next uses an internal request URL behind Cloud Run's proxy.
  // Only Host and the configured public URL can add an accepted origin.
  const host = request.headers.get("host")?.trim();
  const protocol = request.headers.get("x-forwarded-proto")?.trim().toLowerCase();
  if (host && !/[\\/\s@?#]/.test(host) && (protocol === "http" || protocol === "https")) {
    try { allowed.add(new URL(`${protocol}://${host}`).origin); } catch { /* Malformed hosts are not trusted. */ }
  }
  try {
    if (process.env.HOUSE_PLANNER_PUBLIC_URL) {
      const configured = new URL(process.env.HOUSE_PLANNER_PUBLIC_URL);
      if (configured.protocol === "https:" || configured.protocol === "http:") allowed.add(configured.origin);
    }
  } catch { /* Invalid configuration cannot expand accepted origins. */ }
  return allowed.has(origin);
}

async function folderVault(actor: MemberRecord, folderId: unknown) {
  if (typeof folderId !== "string" || !folderId || folderId.length > 200 || folderId.includes("/")) return null;
  const folders = await listProjectFolders(actor.projectId);
  if (!folders.some((folder) => folder.id === folderId)) return null;
  let root;
  try { root = vaultRootFolder(folders, folderId); } catch { return null; }
  if (!root || !canAccessFolder(actor, folderId, folderTopLevelId(folderId, buildTopLevelFolderMap(folders)))) return null;
  const ref = firestore.collection(FOLDERS).doc(root.id);
  const snapshot = await ref.get();
  const data = snapshot.data();
  const vault = parseFolderVault(data?.vault);
  if (!vault || data?.projectId !== actor.projectId || data.encrypted !== true) return null;
  return { root, ref, vault, revision: snapshot.updateTime };
}

async function approvedUsers(projectId: string) {
  const memberships = await firestore.collection(MEMBERSHIPS).where("projectId", "==", projectId).get();
  const approvedUids = new Set(memberships.docs.filter((document) => document.data().status === "approved").map((document) => String(document.data().uid || "")).filter(Boolean));
  if (projectId === LEGACY_PROJECT_ID && memberships.empty) {
    const legacy = await firestore.collection(USERS).where("status", "==", "approved").get();
    for (const user of legacy.docs) approvedUids.add(user.id);
  }
  const users = await Promise.all([...approvedUids].map(async (uid) => {
    const identity = await firestore.collection(USERS).doc(uid).get();
    const data = identity.data();
    return data ? { uid, name: String(data.name || data.email || "User"), email: String(data.email || "") } : null;
  }));
  return users.filter((user): user is NonNullable<typeof user> => user !== null).sort((a, b) => a.name.localeCompare(b.name));
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: "Invalid request origin" }, 403);
  const actor = await requireTabAccess("documents");
  if (!actor || actor.anonymousLink) return reply({ error: "Document account access required" }, 403);
  const body = await request.json().catch(() => null) as { folderId?: unknown; password?: unknown } | null;
  if (!body) return reply({ error: "Invalid request" }, 400);
  const folder = await folderVault(actor, body.folderId);
  if (!folder || !hasVaultGrant(actor, folder.vault)) return reply({ error: "Encrypted folder not found" }, 404);
  try { validateVaultPassword(body.password); } catch { return reply({ error: "Use a password between 12 and 128 characters" }, 400); }
  const attempt = await consumeVaultUnlockAttempt(actor, folder.root.id);
  if (!attempt.allowed) return reply({ error: "Too many attempts. Try again later", retryAfter: attempt.retryAfter }, 429, { "Retry-After": String(attempt.retryAfter) });
  let key: Buffer;
  try {
    key = await unwrapVault(folder.vault, body.password, actor.projectId, folder.root.id);
  } catch {
    return reply({ error: "Unable to unlock folder. Check the password" }, 403);
  }
  try {
    if (actor.role === "admin" && !folder.vault.recoveryWrappedKey && vaultRecoveryConfigured()) {
      const recoveryWrappedKey = wrapVaultRecovery(key, actor.projectId, folder.root.id);
      const enrolled = await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(folder.ref);
        const data = snapshot.data();
        const current = parseFolderVault(data?.vault);
        if (data?.projectId !== actor.projectId || data.encrypted !== true || !current ||
          current.version !== folder.vault.version || current.wrappedKey !== folder.vault.wrappedKey || current.salt !== folder.vault.salt) return false;
        if (!current.recoveryWrappedKey) transaction.update(folder.ref,
          { "vault.recoveryWrappedKey": recoveryWrappedKey, updatedAt: FieldValue.serverTimestamp() },
          { lastUpdateTime: snapshot.updateTime! });
        return true;
      });
      if (!enrolled) return reply({ error: "Folder changed. Refresh and try again" }, 409);
    }
    const expiresAt = await startVaultSession(actor, folder.root.id, folder.vault, key);
    return reply({ unlocked: true, expiresAt });
  } finally {
    key.fill(0);
  }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return reply({ error: "Invalid request origin" }, 403);
  const actor = await requireTabAccess("documents");
  if (!actor || actor.anonymousLink) return reply({ error: "Document account access required" }, 403);
  const folder = await folderVault(actor, new URL(request.url).searchParams.get("folderId"));
  if (!folder) return reply({ error: "Encrypted folder not found" }, 404);
  await endVaultSession(actor, folder.root.id);
  return reply({ ok: true });
}

export async function GET(request: Request) {
  const actor = await requireTabAccess("documents", ["admin"]);
  if (!actor) return reply({ error: "Administrator access required" }, 403);
  const folder = await folderVault(actor, new URL(request.url).searchParams.get("folderId"));
  if (!folder) return reply({ error: "Encrypted folder not found" }, 404);
  return reply({ folderId: folder.root.id, allowedUids: folder.vault.allowedUids, users: await approvedUsers(actor.projectId),
    passwordResetAvailable: Boolean(folder.vault.recoveryWrappedKey) && vaultRecoveryConfigured() });
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return reply({ error: "Invalid request origin" }, 403);
  const actor = await requireTabAccess("documents", ["admin"]);
  if (!actor) return reply({ error: "Administrator access required" }, 403);
  const body = await request.json().catch(() => null) as { folderId?: unknown; allowedUids?: unknown; action?: unknown; newPassword?: unknown } | null;
  if (!body) return reply({ error: "Invalid request" }, 400);
  const folder = await folderVault(actor, body.folderId);
  if (!folder) return reply({ error: "Encrypted folder not found" }, 404);
  if (body.action === "reset-password") {
    try { validateVaultPassword(body.newPassword); } catch { return reply({ error: "Use a password between 12 and 128 characters" }, 400); }
    if (!vaultRecoveryConfigured()) return reply({ error: "Folder password recovery is not configured" }, 503);
    if (!folder.vault.recoveryWrappedKey) return reply({ error: "Unlock this folder once with its current password to enable administrator reset" }, 409);
    let replacement;
    try { replacement = await resetVaultPassword(folder.vault, body.newPassword, actor.projectId, folder.root.id); }
    catch (error) {
      return reply({ error: error instanceof VaultRecoveryConfigurationError ? "Folder password recovery is not configured" : "Folder password recovery is unavailable" }, error instanceof VaultRecoveryConfigurationError ? 503 : 409);
    }
    const updated = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(folder.ref);
      const data = snapshot.data();
      const current = parseFolderVault(data?.vault);
      if (data?.projectId !== actor.projectId || data.encrypted !== true || !current || current.version !== folder.vault.version ||
        current.wrappedKey !== folder.vault.wrappedKey || current.salt !== folder.vault.salt || current.recoveryWrappedKey !== folder.vault.recoveryWrappedKey ||
        (folder.revision && !snapshot.updateTime?.isEqual(folder.revision))) return false;
      await appendActivity(transaction, actor, {
        category: "document", action: "folder.password_reset",
        target: { type: "folder", id: folder.root.id, label: "Encrypted folder", section: "documents" },
        visibility: { adminOnly: true },
      });
      transaction.update(folder.ref, { "vault.salt": replacement.salt, "vault.wrappedKey": replacement.wrappedKey,
        "vault.version": replacement.version, updatedAt: FieldValue.serverTimestamp() }, { lastUpdateTime: snapshot.updateTime! });
      transaction.delete(vaultAttemptRef(actor, folder.root.id));
      return true;
    });
    if (!updated) return reply({ error: "Folder changed. Refresh and try again" }, 409);
    await endVaultSession(actor, folder.root.id);
    return reply({ ok: true, passwordReset: true });
  }
  if (body.action !== undefined || !Array.isArray(body.allowedUids) || body.allowedUids.length > 250 || body.allowedUids.some((uid) => typeof uid !== "string" || !uid || uid.length > 128)) return reply({ error: "Invalid request" }, 400);
  const allowedUids = [...new Set(body.allowedUids as string[])];
  const approved = new Set((await approvedUsers(actor.projectId)).map((user) => user.uid));
  if (allowedUids.some((uid) => !approved.has(uid))) return reply({ error: "Access can only be granted to approved project members" }, 400);
  const updated = await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(folder.ref);
    const data = snapshot.data();
    const current = parseFolderVault(data?.vault);
    if (data?.projectId !== actor.projectId || data?.encrypted !== true || !current) return false;
    transaction.update(folder.ref, { "vault.allowedUids": allowedUids, "vault.version": randomUUID(), updatedAt: FieldValue.serverTimestamp() });
    return true;
  });
  if (!updated) return reply({ error: "Encrypted folder not found" }, 404);
  await endVaultSession(actor, folder.root.id);
  return reply({ ok: true, allowedUids });
}
