import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireApproved } from "@/lib/auth";
import { firestore } from "@/lib/firebase-admin";
import { FOLDERS, INVITATIONS, MEMBERSHIPS, membershipId, normalizeFolderAccess, normalizePermissions, PROJECTS, ProjectRole, USERS, WORKSPACE_TABS } from "@/lib/project";
import { appendActivity, commitActivity, diffChanges, type ActivityInput } from "@/lib/activity";
import { membershipFromAcceptedInvitation } from "@/lib/access-reconciliation";
import { findExpenseInvoiceFolder, findExpensePurchaseFolder } from "@/lib/folders";
import { AccessLinkError, resolveMembershipAccess } from "@/lib/access-links";
import { recordActivityUsage } from "@/lib/usage-actions";
import { memberAccessState } from "@/lib/access-management";

async function validatedFolderAccess(value: unknown, projectId: string) {
  const access = normalizeFolderAccess(value);
  if (access.mode === "all") return access;
  const folders = await firestore.collection(FOLDERS).where("projectId", "==", projectId).get();
  const folderRecords = folders.docs.map((folder) => ({
    id: folder.id,
    name: String(folder.data().name || ""),
    parentId: typeof folder.data().parentId === "string" ? folder.data().parentId : null,
  }));
  const invoiceFolder = findExpenseInvoiceFolder(folderRecords);
  const purchaseFolder = findExpensePurchaseFolder(folderRecords);
  const validIds = new Set(folders.docs
    .filter((folder) => (typeof folder.data().parentId !== "string" || !folder.data().parentId) && folder.id !== invoiceFolder?.id && folder.id !== purchaseFolder?.id)
    .map((folder) => folder.id));
  return { ...access, folderIds: access.folderIds.filter((id) => validIds.has(id)) };
}

function serialize(uid: string, data: FirebaseFirestore.DocumentData, identity: FirebaseFirestore.DocumentData = {}) {
  const iso = (value: unknown) => typeof value === "object" && value && "toDate" in value
    ? (value as FirebaseFirestore.Timestamp).toDate().toISOString()
    : null;
  return {
    uid,
    email: String(identity.email || ""),
    name: String(identity.name || identity.email || "User"),
    role: data.role || "editor",
    status: data.status || "pending",
    accessState: memberAccessState(data),
    accessSource: data.accessLinkId ? "read_link" : "direct",
    permissions: normalizePermissions(data.permissions),
    folderAccess: normalizeFolderAccess(data.folderAccess),
    requestedAt: iso(data.requestedAt),
    reviewedAt: iso(data.reviewedAt),
  };
}

async function reconcileAcceptedInvitationMemberships(projectId: string) {
  const [invitations, memberships] = await Promise.all([
    firestore.collection(INVITATIONS).where("projectId", "==", projectId).get(),
    firestore.collection(MEMBERSHIPS).where("projectId", "==", projectId).get(),
  ]);
  const knownUids = new Set(memberships.docs.map((document) => String(document.data().uid || "")).filter(Boolean));
  const accepted = invitations.docs
    .filter((document) => document.data().status === "accepted" && typeof document.data().acceptedByUid === "string")
    .sort((a, b) => (b.data().acceptedAt?.toMillis?.() ?? 0) - (a.data().acceptedAt?.toMillis?.() ?? 0));
  const batch = firestore.batch();
  let repaired = 0;
  for (const invitation of accepted) {
    if (repaired >= 450) break;
    const data = invitation.data();
    const uid = String(data.acceptedByUid || "");
    if (!uid || knownUids.has(uid)) continue;
    const identity = await firestore.collection(USERS).doc(uid).get();
    if (!identity.exists) continue;
    const membership = membershipFromAcceptedInvitation(projectId, data, uid, identity.data()!);
    if (!membership) continue;
    batch.set(firestore.collection(MEMBERSHIPS).doc(membershipId(projectId, uid)), {
      ...membership,
      joinedAt: data.acceptedAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      repairedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    knownUids.add(uid);
    repaired += 1;
  }
  if (repaired) await batch.commit();
  return repaired;
}

export async function GET() {
  const actor = await requireApproved(["admin"]);
  if (!actor) return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  const reconciledMemberships = await reconcileAcceptedInvitationMemberships(actor.projectId);
  const snapshot = await firestore.collection(MEMBERSHIPS).where("projectId", "==", actor.projectId).get();
  const users = await Promise.all(snapshot.docs.filter((membership) => membership.data().removed !== true).map(async (membership) => {
    const uid = String(membership.data().uid || ""); const identity = uid ? await firestore.collection(USERS).doc(uid).get() : null;
    return serialize(uid, await resolveMembershipAccess(membership.data()), identity?.data());
  }));
  return NextResponse.json({ users: users.sort((a, b) => a.email.localeCompare(b.email)), reconciledMemberships });
}

export async function PATCH(request: Request) {
  const actor = await requireApproved(["admin"]);
  if (!actor) return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  const body = await request.json() as { uid?: string; action?: "approve" | "reject" | "revoke" | "permissions" | "folders"; role?: ProjectRole; permissions?: unknown; folderAccess?: unknown };
  if (!body.uid || !body.action) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const target = firestore.collection(MEMBERSHIPS).doc(membershipId(actor.projectId, body.uid));
  const snapshot = await target.get();
  const identity = await firestore.collection(USERS).doc(body.uid).get();
  if (!snapshot.exists || snapshot.data()?.projectId !== actor.projectId || snapshot.data()?.removed === true) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (body.uid === actor.uid) {
    return NextResponse.json({ error: "The owner's access cannot be changed" }, { status: 400 });
  }
  const effective = await resolveMembershipAccess(snapshot.data()!);
  const detachLink = snapshot.data()?.accessLinkId ? {
    accessLinkId: FieldValue.delete(), role: "viewer", permissions: normalizePermissions(effective.permissions), folderAccess: normalizeFolderAccess(effective.folderAccess),
  } : {};
  if (body.action === "permissions") {
    const before = normalizePermissions(effective.permissions);
    const after = normalizePermissions(body.permissions);
    const changes = diffChanges(before, after);
    if (changes.length || snapshot.data()?.accessLinkId) await commitActivity(actor, {
      category: "access", action: "access.permissions_changed",
      target: { type: "member", id: body.uid, label: String(identity.data()?.name || identity.data()?.email || "Member"), section: "overview" },
      changes, visibility: { requiredTabs: ["overview"], adminOnly: true },
    }, (transaction) => transaction.set(target, { ...detachLink, status: effective.status, permissions: after, reviewedBy: actor.email, updatedAt: FieldValue.serverTimestamp() }, { merge: true }));
    return NextResponse.json({ user: serialize(body.uid, (await target.get()).data()!, identity.data()) });
  }
  if (body.action === "folders") {
    const folderAccess = await validatedFolderAccess(body.folderAccess, actor.projectId);
    const before = normalizeFolderAccess(effective.folderAccess);
    const changes = diffChanges(before, folderAccess, { folderIds: "list" });
    if (changes.length || snapshot.data()?.accessLinkId) await commitActivity(actor, {
      category: "access", action: "access.folders_changed",
      target: { type: "member", id: body.uid, label: String(identity.data()?.name || identity.data()?.email || "Member"), section: "overview" },
      changes, visibility: { requiredTabs: ["overview"], adminOnly: true },
    }, (transaction) => transaction.set(target, { ...detachLink, status: effective.status, folderAccess, reviewedBy: actor.email, updatedAt: FieldValue.serverTimestamp() }, { merge: true }));
    return NextResponse.json({ user: serialize(body.uid, (await target.get()).data()!, identity.data()) });
  }
  const status = body.action === "approve" ? "approved" : body.action === "reject" ? "rejected" : "pending";
  const withdrawAccess = body.action === "revoke" || body.action === "reject";
  try {
    const result = await firestore.runTransaction(async (transaction) => {
      const [actorMembership, currentTarget, currentIdentity] = await transaction.getAll(
        firestore.collection(MEMBERSHIPS).doc(membershipId(actor.projectId, actor.uid)),
        target,
        firestore.collection(USERS).doc(body.uid!),
      );
      const actorData = actorMembership.data();
      if (actorData?.status !== "approved" || actorData.role !== "admin" || actorData.removed === true) {
        throw new AccessLinkError("Administrator access required");
      }
      const data = currentTarget.data();
      if (!data || data.projectId !== actor.projectId || data.removed === true) throw new AccessLinkError("User not found", 404);
      const currentEffective = await resolveMembershipAccess(data);
      const role: ProjectRole = body.role === "viewer" || (body.role === undefined && data.accessLinkId) ? "viewer" : "editor";
      const permissions = normalizePermissions(body.permissions ?? currentEffective.permissions);
      const before = { status: currentEffective.status || "pending", role: currentEffective.role || "editor", permissions: normalizePermissions(currentEffective.permissions) };
      const changes = diffChanges(before, { status, role, permissions }, { status: "status", role: "status" });
      const obsolete: FirebaseFirestore.QueryDocumentSnapshot[] = [];
      if (withdrawAccess) {
        const invitations = await transaction.get(firestore.collection(INVITATIONS).where("projectId", "==", actor.projectId));
        const emails = new Set([currentIdentity.data()?.email, data.removedEmail, ...(Array.isArray(data.removedEmails) ? data.removedEmails : []), ...invitations.docs
          .filter((invitation) => invitation.data().acceptedByUid === body.uid)
          .map((invitation) => invitation.data().email)]
          .filter((email): email is string => typeof email === "string" && Boolean(email.trim()))
          .map((email) => email.trim().toLowerCase()));
        obsolete.push(...invitations.docs.filter((invitation) => {
          const item = invitation.data();
          return item.status === "pending" && (item.acceptedByUid === body.uid || emails.has(String(item.email || "").trim().toLowerCase()));
        }));
        if (obsolete.length > 497) throw new AccessLinkError("Too many invitations for this user", 409);
      }
      if (!changes.length && !data.accessLinkId && !obsolete.length) return null;
      const activity: ActivityInput = {
        category: "access", action: "access.member_access_changed",
        target: { type: "member", id: body.uid!, label: String(currentIdentity.data()?.name || currentIdentity.data()?.email || "Member"), section: "overview" },
        summaryParams: { operation: body.action }, changes,
        visibility: { requiredTabs: ["overview"], adminOnly: true },
      };
      const event = await appendActivity(transaction, actor, activity);
      transaction.set(target, { ...(data.accessLinkId ? { accessLinkId: FieldValue.delete() } : {}), status, role, permissions, folderAccess: normalizeFolderAccess(currentEffective.folderAccess), accessLinkBlocked: withdrawAccess, reviewedBy: actor.email, reviewedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      for (const invitation of obsolete) transaction.set(invitation.ref, {
        status: "revoked", revokedBy: actor.email, revokedAt: FieldValue.serverTimestamp(), revokedReason: body.action === "reject" ? "member_rejected" : "member_access_revoked",
      }, { merge: true });
      return { event, activity };
    });
    if (result) await recordActivityUsage(actor, result.activity, result.event.id);
  } catch (error) {
    if (error instanceof AccessLinkError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  return NextResponse.json({ user: serialize(body.uid, (await target.get()).data()!, identity.data()) });
}

class MemberRemovalError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function DELETE(request: Request) {
  const actor = await requireApproved(["admin"]);
  if (!actor) return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  const body: unknown = await request.json().catch(() => null);
  const uid = body && typeof body === "object" && "uid" in body ? body.uid : null;
  if (typeof uid !== "string" || !uid.trim() || uid.length > 128 || uid.includes("/")) {
    return NextResponse.json({ error: "Invalid user" }, { status: 400 });
  }
  if (uid === actor.uid) return NextResponse.json({ error: "You cannot remove your own access" }, { status: 400 });
  const targetRef = firestore.collection(MEMBERSHIPS).doc(membershipId(actor.projectId, uid));
  try {
    const event = await firestore.runTransaction(async (transaction) => {
      const [actorMembership, target, identity, project] = await transaction.getAll(
        firestore.collection(MEMBERSHIPS).doc(membershipId(actor.projectId, actor.uid)),
        targetRef,
        firestore.collection(USERS).doc(uid),
        firestore.collection(PROJECTS).doc(actor.projectId),
      );
      if (actorMembership.data()?.status !== "approved" || actorMembership.data()?.role !== "admin" || actorMembership.data()?.removed === true) {
        throw new MemberRemovalError("Administrator access required", 403);
      }
      const data = target.data();
      if (!data || data.projectId !== actor.projectId || data.uid !== uid) throw new MemberRemovalError("User not found", 404);
      const platformOwnerEmail = process.env.HOUSE_PLANNER_ADMIN_EMAIL?.trim().toLowerCase();
      if (data.role === "admin" || project.data()?.ownerUid === uid || (platformOwnerEmail && String(identity.data()?.email || "").trim().toLowerCase() === platformOwnerEmail)) {
        throw new MemberRemovalError("The owner's access cannot be removed", 400);
      }
      if (data.removed === true) return;
      const email = String(identity.data()?.email || "").trim().toLowerCase();
      const emails = new Set([email, String(data.removedEmail || ""), ...(Array.isArray(data.removedEmails) ? data.removedEmails : [])].filter(Boolean).map((value) => String(value).toLowerCase()));
      const invitations = await transaction.get(firestore.collection(INVITATIONS).where("projectId", "==", actor.projectId));
      const obsolete = invitations.docs.filter((invitation) => {
        const item = invitation.data();
        return item.acceptedByUid === uid || emails.has(String(item.email || "").trim().toLowerCase());
      });
      const historicalEmails = [...new Set([email, ...obsolete
        .filter((invitation) => invitation.data().acceptedByUid === uid)
        .map((invitation) => String(invitation.data().email || "").trim().toLowerCase())].filter(Boolean))];
      if (obsolete.length > 497) throw new MemberRemovalError("Too many invitations for this user", 409);
      const event = await appendActivity(transaction, actor, {
        category: "access", action: "access.member_removed",
        target: { type: "member", id: uid, label: "Usuario desactivado", section: "overview", exists: false },
        changes: [{ field: "status", before: data.status || "pending", after: "removed", format: "status" }],
        visibility: { requiredTabs: ["overview"], adminOnly: true },
      });
      // Keep a project tombstone: legacy sign-in and invitation repair must not recreate access.
      transaction.set(targetRef, {
        status: "rejected", removed: true, removedAt: FieldValue.serverTimestamp(),
        removedBy: actor.email, removedEmail: email,
        ...(historicalEmails.length ? { removedEmails: FieldValue.arrayUnion(...historicalEmails) } : {}),
        permissions: Object.fromEntries(WORKSPACE_TABS.map((tab) => [tab, false])),
        folderAccess: { mode: "selected", folderIds: [], allowUnfiled: false },
        accessLinkBlocked: true, accessLinkId: FieldValue.delete(),
        reviewedBy: actor.email, reviewedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      for (const invitation of obsolete) transaction.set(invitation.ref, {
        status: "revoked", revokedBy: actor.email, revokedAt: FieldValue.serverTimestamp(),
        revokedReason: "member_removed", removedMemberUid: uid,
      }, { merge: true });
      return event;
    });
    if (event) await recordActivityUsage(actor, { action: "access.member_removed", target: { section: "overview" } }, event.id);
  } catch (error) {
    if (error instanceof MemberRemovalError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  return NextResponse.json({ removedUid: uid }, { headers: { "Cache-Control": "private, no-store" } });
}
