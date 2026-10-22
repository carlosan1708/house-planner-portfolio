import { FieldValue } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { adminAuth, firestore } from "@/lib/firebase-admin";
import { ensureExpenseInvoiceFolder, ensureExpensePurchaseFolder } from "@/lib/folders";
import { ACTIVE_PROJECT_COOKIE, INVITATIONS, LEGACY_PROJECT_ID, MEMBERSHIPS, membershipId, normalizeFolderAccess, normalizePermissions, personalProjectId, PROJECTS, ProjectRole, PUBLIC_ACCESS_LINK_COOKIE, SESSION_COOKIE, SESSION_DAYS, signInProjectId, USERS } from "@/lib/project";
import { appendActivity, type ActivityInput } from "@/lib/activity";
import { recordActivityUsage } from "@/lib/usage-actions";
import { ACCESS_LINKS, AccessLinkError, accessLinkDefaultSection, accessLinkLanguage, accessLinkTokenHash, redeemAccessLink, resolveMembershipAccess } from "@/lib/access-links";

function timestampMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  return value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function" ? value.toMillis() : 0;
}

function invitationError(data: FirebaseFirestore.DocumentData, email: string) {
  if (!data.projectId || data.status !== "pending" || timestampMillis(data.expiresAt) <= Date.now()) return "Invitation is no longer valid";
  if (String(data.email || "").trim().toLowerCase() !== email) return "This invitation belongs to another email address";
  return null;
}

async function matchingInvitation(email: string, token: string) {
  if (token) {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const snap = await firestore.collection(INVITATIONS).doc(tokenHash).get();
    if (!snap.exists) return { error: "Invitation not found" as const };
    const data = snap.data()!;
    const error = invitationError(data, email);
    if (error) return { error };
    return { ref: snap.ref, data };
  }
  const pending = await firestore.collection(INVITATIONS).where("email", "==", email).get();
  const match = pending.docs.find((doc) => {
    const data = doc.data();
    return invitationError(data, email) === null;
  });
  return match ? { ref: match.ref, data: match.data() } : null;
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  const idToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!idToken) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  try {
    const decoded = await adminAuth.verifyIdToken(idToken, true);
    if (!decoded.email) return NextResponse.json({ error: "An email address is required" }, { status: 400 });
    const email = decoded.email.trim().toLowerCase();
    const body = await request.json().catch(() => ({})) as { inviteToken?: unknown; requestedProjectId?: unknown; accessLinkToken?: unknown };
    const inviteToken = typeof body.inviteToken === "string" ? body.inviteToken : "";
    const accessLinkToken = typeof body.accessLinkToken === "string" ? body.accessLinkToken : "";
    const requestedProjectId = typeof body.requestedProjectId === "string" ? body.requestedProjectId.trim().slice(0, 160) : "";
    const emailVerified = decoded.email_verified === true;
    const adminEmail = (process.env.HOUSE_PLANNER_ADMIN_EMAIL || "").trim().toLowerCase();
    if (!emailVerified && (inviteToken || Boolean(adminEmail) && email === adminEmail)) return NextResponse.json({ error: "Verify your email address before accepting a project invitation or using the configured administrator account.", code: "email_verification_required" }, { status: 403 });
    // A valid password token proves an account session, not ownership of its mailbox.
    const invite = emailVerified ? await matchingInvitation(email, inviteToken) : null;
    if (invite && "error" in invite) return NextResponse.json({ error: invite.error }, { status: 403 });
    const ref = firestore.collection(USERS).doc(decoded.uid); const existing = await ref.get();
    const isAdmin = emailVerified && Boolean(adminEmail) && email === adminEmail;
    const invitedRole: ProjectRole | null = invite?.data.role === "viewer" ? "viewer" : invite ? "editor" : null;
    const approved = true;
    const hadLegacyAccess = isAdmin || existing.data()?.legacyAccess === true || (existing.exists && existing.data()?.multiTenantReady !== true && existing.data()?.status === "approved");
    const finalRole: ProjectRole = isAdmin ? "admin" : invitedRole || (existing.data()?.role === "viewer" ? "viewer" : "editor");
    const permissions = isAdmin
      ? normalizePermissions(null)
      : normalizePermissions(invite?.data.permissions ?? existing.data()?.permissions);
    const folderAccess = isAdmin
      ? normalizeFolderAccess(null)
      : normalizeFolderAccess(invite?.data.folderAccess ?? existing.data()?.folderAccess);
    if (!existing.exists) {
      await ref.set({
        uid: decoded.uid,
        email,
        emailVerified,
        name: decoded.name || email,
        status: "approved",
        legacyAccess: isAdmin,
        multiTenantReady: true,
        requestedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      await ref.set({
        email,
        emailVerified,
        name: decoded.name || email,
        status: "approved",
        legacyAccess: hadLegacyAccess,
        multiTenantReady: true,
        lastSignedInAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    const personalId = personalProjectId(decoded.uid);
    const personalProjectRef = firestore.collection(PROJECTS).doc(personalId);
    const personalMembershipRef = firestore.collection(MEMBERSHIPS).doc(membershipId(personalId, decoded.uid));
    const [personalProject, personalMembership] = await Promise.all([personalProjectRef.get(), personalMembershipRef.get()]);
    if (!personalProject.exists || !personalMembership.exists) {
      const bootstrap = firestore.batch();
      if (!personalProject.exists) bootstrap.set(personalProjectRef, { id: personalId, name: decoded.name ? `${decoded.name}'s workspace` : "My workspace", kind: "personal", ownerUid: decoded.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      if (!personalMembership.exists) bootstrap.set(personalMembershipRef, { projectId: personalId, uid: decoded.uid, role: "admin", status: "approved", permissions: normalizePermissions(null), folderAccess: normalizeFolderAccess(null), joinedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      await bootstrap.commit();
      await Promise.all([ensureExpenseInvoiceFolder(personalId, email), ensureExpensePurchaseFolder(personalId, email)]);
    }
    if (hadLegacyAccess) {
      await firestore.collection(PROJECTS).doc(LEGACY_PROJECT_ID).set({ id: LEGACY_PROJECT_ID, name: "Sample House", kind: "shared", ...(isAdmin ? { ownerUid: decoded.uid } : {}), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      const legacyMembershipRef = firestore.collection(MEMBERSHIPS).doc(membershipId(LEGACY_PROJECT_ID, decoded.uid));
      await firestore.runTransaction(async (transaction) => {
        const legacyMembership = await transaction.get(legacyMembershipRef);
        if (!legacyMembership.exists) transaction.set(legacyMembershipRef, { projectId: LEGACY_PROJECT_ID, uid: decoded.uid, role: finalRole, status: "approved", permissions, folderAccess, joinedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      });
      if (isAdmin) await Promise.all([ensureExpenseInvoiceFolder(LEGACY_PROJECT_ID, email), ensureExpensePurchaseFolder(LEGACY_PROJECT_ID, email)]);
    }
    const invitedProjectId = invite?.data.projectId ? String(invite.data.projectId) : "";
    if (invite?.ref && invitedProjectId) {
      const membershipRef = firestore.collection(MEMBERSHIPS).doc(membershipId(invitedProjectId, decoded.uid));
      const actor = { uid: decoded.uid, projectId: invitedProjectId, name: String(decoded.name || email), email, role: finalRole };
      const activity: ActivityInput = {
        category: "access", action: "access.invitation_accepted",
        target: { type: "member", id: decoded.uid, label: String(decoded.name || email), section: "overview" },
        summaryParams: { role: finalRole }, changes: [{ field: "status", before: "invited", after: "approved", format: "status" }],
        visibility: { requiredTabs: ["overview"], adminOnly: true },
      };
      const event = await firestore.runTransaction(async (transaction) => {
        const [currentInvite, currentMembership] = await transaction.getAll(invite.ref, membershipRef);
        const currentData = currentInvite.data();
        const error = currentData ? invitationError(currentData, email) : "Invitation not found";
        if (!currentData || error || currentData.projectId !== invitedProjectId) throw new AccessLinkError(error || "Invitation is no longer valid");
        const membershipData = currentMembership.data();
        const removedAt = timestampMillis(membershipData?.removedAt);
        const accessWithdrawn = membershipData?.status !== "approved" && (membershipData?.accessLinkBlocked === true || Boolean(membershipData?.reviewedAt));
        const accessCutoff = Math.max(removedAt, accessWithdrawn ? timestampMillis(membershipData?.reviewedAt) : 0);
        if ((membershipData?.removed === true || removedAt || accessWithdrawn) && (!accessCutoff || timestampMillis(currentData.createdAt) <= accessCutoff)) {
          throw new AccessLinkError("El administrador ha retirado tu acceso a este proyecto. Necesitas una nueva invitación para recuperarlo.");
        }
        const event = await appendActivity(transaction, actor, activity);
        transaction.set(membershipRef, { projectId: invitedProjectId, uid: decoded.uid, role: isAdmin ? "admin" : currentData.role === "viewer" ? "viewer" : "editor", status: "approved", removed: false, permissions: isAdmin ? normalizePermissions(null) : normalizePermissions(currentData.permissions), folderAccess: isAdmin ? normalizeFolderAccess(null) : normalizeFolderAccess(currentData.folderAccess), accessLinkId: FieldValue.delete(), accessLinkBlocked: false, joinedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        transaction.set(invite.ref, { status: "accepted", acceptedByUid: decoded.uid, acceptedAt: FieldValue.serverTimestamp() }, { merge: true });
        return event;
      });
      await recordActivityUsage(actor, activity, event.id);
    }
    const linkProjectId = accessLinkToken ? await redeemAccessLink({ uid: decoded.uid, email, name: String(decoded.name || email) }, accessLinkToken, requestedProjectId) : "";
    const favoriteProjectId = typeof existing.data()?.favoriteProjectId === "string" ? String(existing.data()?.favoriteProjectId) : "";
    const [favoriteMembership, requestedMembership] = await Promise.all([
      favoriteProjectId ? firestore.collection(MEMBERSHIPS).doc(membershipId(favoriteProjectId, decoded.uid)).get() : null,
      requestedProjectId ? firestore.collection(MEMBERSHIPS).doc(membershipId(requestedProjectId, decoded.uid)).get() : null,
    ]);
    const activeProjectId = signInProjectId({
      personalId,
      invitedProjectId: linkProjectId || invitedProjectId,
      requestedProjectId,
      requestedApproved: requestedMembership?.exists && (await resolveMembershipAccess(requestedMembership.data()!)).status === "approved",
      favoriteProjectId,
      openFavoriteOnSignIn: existing.data()?.openFavoriteOnSignIn === true,
      favoriteApproved: favoriteMembership?.exists && (await resolveMembershipAccess(favoriteMembership.data()!)).status === "approved",
    });

    const expiresIn = SESSION_DAYS * 24 * 60 * 60 * 1000;
    const sessionCookie = await adminAuth.createSessionCookie(idToken, { expiresIn });
    const linkPolicy = accessLinkToken ? await firestore.collection(ACCESS_LINKS).doc(accessLinkTokenHash(accessLinkToken)).get() : null;
    const response = NextResponse.json({ ok: true, projectId: activeProjectId, status: approved ? "approved" : "pending", ...(linkPolicy ? { defaultLanguage: accessLinkLanguage(linkPolicy.data()?.defaultLanguage), defaultSection: accessLinkDefaultSection(linkPolicy.data()?.permissions) } : {}) });
    response.cookies.set(SESSION_COOKIE, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: expiresIn / 1000,
    });
    response.cookies.set(ACTIVE_PROJECT_COOKIE, activeProjectId, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: expiresIn / 1000 });
    response.cookies.set(PUBLIC_ACCESS_LINK_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
    return response;
  } catch (reason) {
    if (reason instanceof AccessLinkError) return NextResponse.json({ error: reason.message }, { status: reason.status });
    return NextResponse.json({ error: "Invalid sign-in" }, { status: 401 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  response.cookies.set(ACTIVE_PROJECT_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  response.cookies.set(PUBLIC_ACCESS_LINK_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
