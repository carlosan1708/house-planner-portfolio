import { createHash, randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireApproved } from "@/lib/auth";
import { appendActivity, commitActivity, type ActivityInput } from "@/lib/activity";
import { recordActivityUsage } from "@/lib/usage-actions";
import { firestore } from "@/lib/firebase-admin";
import { FOLDERS, INVITATIONS, MEMBERSHIPS, membershipId, normalizeFolderAccess, normalizePermissions, ProjectRole, USERS } from "@/lib/project";
import { loadProjectAuthorDisplay } from "@/lib/project-authors";

const INVITE_DAYS = 14;

async function validatedFolderAccess(value: unknown, projectId: string) {
  const access = normalizeFolderAccess(value);
  if (access.mode === "all") return access;
  const folders = await firestore.collection(FOLDERS).where("projectId", "==", projectId).get();
  const validIds = new Set(folders.docs
    .filter((folder) => typeof folder.data().parentId !== "string" || !folder.data().parentId)
    .map((folder) => folder.id));
  return { ...access, folderIds: access.folderIds.filter((id) => validIds.has(id)) };
}

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, 254) : "";
}

function validEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function publicOrigin(request: Request) {
  const configured = process.env.HOUSE_PLANNER_PUBLIC_URL?.trim();
  if (configured) {
    try { return new URL(configured).origin; } catch { /* use proxy headers below */ }
  }
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0].trim();
  const host = forwardedHost || request.headers.get("host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  if (host) return `${forwardedProtocol || "https"}://${host}`;
  return new URL(request.url).origin;
}

function timestampIso(value: unknown) {
  return typeof value === "object" && value && "toDate" in value
    ? (value as FirebaseFirestore.Timestamp).toDate().toISOString()
    : null;
}

function serialize(doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot, data = doc.data()!) {
  return {
    id: doc.id,
    email: String(data.email || ""),
    role: data.role === "viewer" ? "viewer" : "editor",
    permissions: normalizePermissions(data.permissions),
    folderAccess: normalizeFolderAccess(data.folderAccess),
    status: data.status === "accepted" || data.status === "revoked" || data.status === "expired" ? data.status : "pending",
    invitedBy: String(data.invitedBy || ""),
    createdAt: timestampIso(data.createdAt),
    expiresAt: timestampIso(data.expiresAt),
    acceptedAt: timestampIso(data.acceptedAt),
  };
}

export async function GET() {
  const actor = await requireApproved(["admin"]);
  if (!actor) return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  const [snapshot, authors] = await Promise.all([
    firestore.collection(INVITATIONS).where("projectId", "==", actor.projectId).get(),
    loadProjectAuthorDisplay(actor.projectId),
  ]);
  const now = Date.now();
  const invitations = snapshot.docs.filter((doc) => doc.data().revokedReason !== "member_removed").map((doc) => {
    const item = serialize(doc, authors.redact(doc.data()));
    if (item.status === "pending" && item.expiresAt && new Date(item.expiresAt).getTime() <= now) item.status = "expired";
    return item;
  }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return NextResponse.json({ invitations });
}

export async function POST(request: Request) {
  const actor = await requireApproved(["admin"]);
  if (!actor) return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  const body = await request.json() as { email?: unknown; role?: ProjectRole; permissions?: unknown; folderAccess?: unknown };
  const email = normalizeEmail(body.email);
  const role: ProjectRole = body.role === "viewer" ? "viewer" : "editor";
  const permissions = normalizePermissions(body.permissions);
  const folderAccess = await validatedFolderAccess(body.folderAccess, actor.projectId);
  if (!validEmail(email)) return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  if (email === actor.email.toLowerCase()) return NextResponse.json({ error: "The administrator already has access" }, { status: 400 });

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000);
  const existingInvitesQuery = firestore.collection(INVITATIONS).where("email", "==", email);
  const ref = firestore.collection(INVITATIONS).doc(tokenHash);
  const matchingUsers = await firestore.collection(USERS).where("email", "==", email).get();
  // Only a server-recorded, verified mailbox may receive an email-based pregrant.
  // Other accounts can accept after their next verified sign-in.
  const existingUsers = { docs: matchingUsers.docs.filter((user) => user.data().emailVerified === true) };
  const activity: ActivityInput = {
    category: "access", action: "access.invited",
    target: { type: "invitation", id: ref.id, label: email, section: "overview" },
    summaryParams: { role }, changes: [{ field: "status", before: null, after: "pending", format: "status" }],
    visibility: { requiredTabs: ["overview"], adminOnly: true },
  };
  const event = await firestore.runTransaction(async (transaction) => {
    const existingInvites = await transaction.get(existingInvitesQuery);
    const membershipRefs = existingUsers.docs.map((user) => firestore.collection(MEMBERSHIPS).doc(membershipId(actor.projectId, user.id)));
    // Serialize readmission with removal, so an in-flight old sign-in cannot restore access.
    if (membershipRefs.length) await transaction.getAll(...membershipRefs);
    const event = await appendActivity(transaction, actor, activity);
    for (const invite of existingInvites.docs) {
      const data = invite.data();
      if (data.projectId === actor.projectId && data.status === "pending") transaction.set(invite.ref, { status: "revoked", revokedBy: actor.email, revokedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    transaction.set(ref, { projectId: actor.projectId, email, role, permissions, folderAccess, status: "pending", invitedBy: actor.email, createdAt: FieldValue.serverTimestamp(), expiresAt });
    for (const user of existingUsers.docs) transaction.set(firestore.collection(MEMBERSHIPS).doc(membershipId(actor.projectId, user.id)), { projectId: actor.projectId, uid: user.id, status: "approved", removed: false, role, permissions, folderAccess, accessLinkId: FieldValue.delete(), accessLinkBlocked: false, invitedBy: actor.email, joinedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return event;
  });
  await recordActivityUsage(actor, activity, event.id);

  const inviteUrl = `${publicOrigin(request)}/?invite=${encodeURIComponent(token)}`;
  return NextResponse.json({ invitation: serialize(await ref.get()), inviteUrl }, { status: 201 });
}

export async function PATCH(request: Request) {
  const actor = await requireApproved(["admin"]);
  if (!actor) return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  const body = await request.json() as { id?: string; action?: "revoke" };
  if (!body.id || body.action !== "revoke") return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const ref = firestore.collection(INVITATIONS).doc(body.id);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.projectId !== actor.projectId) return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  if (snap.data()?.status !== "revoked") await commitActivity(actor, {
    category: "access", action: "access.invitation_revoked",
    target: { type: "invitation", id: body.id, label: String(snap.data()?.email || "Invitation"), section: "overview", exists: false },
    changes: [{ field: "status", before: snap.data()?.status || "pending", after: "revoked", format: "status" }],
    visibility: { requiredTabs: ["overview"], adminOnly: true },
  }, (transaction) => transaction.set(ref, { status: "revoked", revokedBy: actor.email, revokedAt: FieldValue.serverTimestamp() }, { merge: true }));
  return NextResponse.json({ invitation: serialize(await ref.get()) });
}
