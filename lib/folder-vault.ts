import { createHash, randomBytes } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { cookies } from "next/headers";
import { canAccessFolder } from "./auth";
import { firestore } from "./firebase-admin";
import { buildTopLevelFolderMap, folderTopLevelId, type ProjectFolder } from "./folders";
import { decryptVaultBytes, encryptVaultBytes, parseFolderVault, type FolderVault } from "./folder-vault-crypto";
import { FOLDERS, type MemberRecord, SESSION_COOKIE } from "./project";

export const VAULT_SESSION_SECONDS = 15 * 60;
export const VAULT_SESSIONS = "housePlannerFolderVaultSessions";
export const VAULT_ATTEMPTS = "housePlannerFolderVaultAttempts";
const MAX_UNLOCK_ATTEMPTS = 5;

type VaultFolder = ProjectFolder & { encrypted?: boolean };
export type VaultAccess = { granted: boolean; key: Buffer | null; expiresAt?: number; revision?: FirebaseFirestore.Timestamp };

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function vaultCookieName(projectId: string, folderId: string) {
  return `house_planner_vault_${hash(JSON.stringify([projectId, folderId])).slice(0, 32)}`;
}

export function vaultRootFolder(folders: VaultFolder[], folderId: string | null | undefined): ProjectFolder | null {
  if (!folderId) return null;
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const visited = new Set<string>();
  let id: string | null = folderId;
  while (id) {
    if (visited.has(id)) throw new Error("Invalid folder hierarchy");
    visited.add(id);
    const folder = byId.get(id);
    if (!folder) throw new Error("Invalid folder hierarchy");
    if (folder.encrypted === true) return folder;
    id = folder.parentId;
  }
  return null;
}

export function hasVaultGrant(actor: MemberRecord, vault: FolderVault) {
  return !actor.anonymousLink && actor.status === "approved" && (actor.role === "admin" || (actor.permissions.documents && vault.allowedUids.includes(actor.uid)));
}

function sessionContext(uid: string, projectId: string, folderId: string, version: string, fingerprint: string) {
  return JSON.stringify(["house-planner-vault-session-v1", uid, projectId, folderId, version, fingerprint]);
}

function tokenKey(token: string) {
  return createHash("sha256").update(`house-planner-vault-token-v1:${token}`).digest();
}

function cookieOptions() {
  return { httpOnly: true, sameSite: "strict" as const, secure: process.env.NODE_ENV === "production", path: "/" };
}

export async function startVaultSession(actor: MemberRecord, folderId: string, vault: FolderVault, dataKey: Buffer) {
  if (dataKey.length !== 32 || !hasVaultGrant(actor, vault)) throw new Error("Encrypted folder access denied");
  const cookieStore = await cookies();
  const firebaseSession = cookieStore.get(SESSION_COOKIE)?.value;
  if (!firebaseSession) throw new Error("Session required");
  const previousToken = cookieStore.get(vaultCookieName(actor.projectId, folderId))?.value;
  const token = randomBytes(32).toString("base64url");
  const fingerprint = hash(firebaseSession);
  const expiresAt = new Date(Date.now() + VAULT_SESSION_SECONDS * 1000);
  const wrappingKey = tokenKey(token);
  try {
    await firestore.collection(VAULT_SESSIONS).doc(hash(token)).set({
      uid: actor.uid, projectId: actor.projectId, folderId, version: vault.version, fingerprint,
      encryptedKey: encryptVaultBytes(dataKey, wrappingKey, sessionContext(actor.uid, actor.projectId, folderId, vault.version, fingerprint)).toString("base64"),
      expiresAt: Timestamp.fromDate(expiresAt),
    });
  } finally {
    wrappingKey.fill(0);
  }
  if (previousToken && /^[A-Za-z0-9_-]{43}$/.test(previousToken)) await firestore.collection(VAULT_SESSIONS).doc(hash(previousToken)).delete();
  cookieStore.set(vaultCookieName(actor.projectId, folderId), token, { ...cookieOptions(), maxAge: VAULT_SESSION_SECONDS, expires: expiresAt });
  return expiresAt.toISOString();
}

export async function endVaultSession(actor: MemberRecord, folderId: string) {
  const cookieStore = await cookies();
  const name = vaultCookieName(actor.projectId, folderId);
  const token = cookieStore.get(name)?.value;
  if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) await firestore.collection(VAULT_SESSIONS).doc(hash(token)).delete();
  cookieStore.set(name, "", { ...cookieOptions(), maxAge: 0, expires: new Date(0) });
}

export function vaultAttemptRef(actor: MemberRecord, folderId: string) {
  return firestore.collection(VAULT_ATTEMPTS).doc(hash(JSON.stringify([actor.projectId, folderId, actor.uid])));
}

async function readVaultSession(actor: MemberRecord, folderId: string, vault: FolderVault, token: string | undefined, firebaseSession: string | undefined) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token) || !firebaseSession) return null;
  const snapshot = await firestore.collection(VAULT_SESSIONS).doc(hash(token)).get();
  const session = snapshot.data();
  const fingerprint = hash(firebaseSession);
  if (!session || session.uid !== actor.uid || session.projectId !== actor.projectId || session.folderId !== folderId || session.version !== vault.version || session.fingerprint !== fingerprint) return null;
  const expiresAt = session.expiresAt;
  if (!expiresAt || typeof expiresAt.toMillis !== "function" || expiresAt.toMillis() <= Date.now() || typeof session.encryptedKey !== "string") return null;
  const wrappingKey = tokenKey(token);
  try {
    const key = decryptVaultBytes(Buffer.from(session.encryptedKey, "base64"), wrappingKey, sessionContext(actor.uid, actor.projectId, folderId, vault.version, fingerprint));
    return key.length === 32 ? { key, expiresAt: expiresAt.toMillis() as number } : null;
  } catch {
    return null;
  } finally {
    wrappingKey.fill(0);
  }
}

export async function vaultAccess(actor: MemberRecord, folders: VaultFolder[]): Promise<Map<string, VaultAccess>> {
  const roots = folders.filter((folder) => folder.encrypted === true);
  const access = new Map<string, VaultAccess>();
  if (!roots.length) return access;
  const cookieStore = await cookies();
  const firebaseSession = cookieStore.get(SESSION_COOKIE)?.value;
  const topLevelMap = buildTopLevelFolderMap(folders);
  await Promise.all(roots.map(async (folder) => {
    const snapshot = await firestore.collection(FOLDERS).doc(folder.id).get();
    const data = snapshot.data();
    const vault = parseFolderVault(data?.vault);
    const granted = data?.projectId === actor.projectId && data?.encrypted === true && !!vault && hasVaultGrant(actor, vault) && canAccessFolder(actor, folder.id, folderTopLevelId(folder.id, topLevelMap));
    const session = granted && vault ? await readVaultSession(actor, folder.id, vault, cookieStore.get(vaultCookieName(actor.projectId, folder.id))?.value, firebaseSession) : null;
    access.set(folder.id, { granted, key: session?.key ?? null, ...(session ? { expiresAt: session.expiresAt, revision: snapshot.updateTime } : {}) });
  }));
  return access;
}

export async function consumeVaultUnlockAttempt(actor: MemberRecord, folderId: string): Promise<{ allowed: boolean; retryAfter: number }> {
  const now = Date.now();
  const ref = vaultAttemptRef(actor, folderId);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    const previousUntil = typeof data?.until === "number" && Number.isFinite(data.until) ? data.until : 0;
    const inWindow = previousUntil > now;
    const attempts = inWindow && typeof data?.attempts === "number" && Number.isFinite(data.attempts) ? data.attempts : 0;
    const until = inWindow ? previousUntil : now + VAULT_SESSION_SECONDS * 1000;
    if (attempts >= MAX_UNLOCK_ATTEMPTS) return { allowed: false, retryAfter: Math.max(1, Math.ceil((until - now) / 1000)) };
    transaction.set(ref, { projectId: actor.projectId, folderId, uid: actor.uid, attempts: attempts + 1, until, expiresAt: Timestamp.fromMillis(until) });
    return { allowed: true, retryAfter: 0 };
  });
}
