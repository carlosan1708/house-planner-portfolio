import { cookies } from "next/headers";
import { adminAuth, firestore } from "./firebase-admin";
import { ACTIVE_PROJECT_COOKIE, LEGACY_PROJECT_ID, MemberRecord, MEMBERSHIPS, membershipId, normalizeFolderAccess, normalizePermissions, personalProjectId, PROJECTS, PUBLIC_ACCESS_LINK_COOKIE, SESSION_COOKIE, USERS, WorkspaceTab } from "./project";
import { isUsageOwner } from "./usage";
import { resolveMembershipAccess, resolvePublicAccessLink } from "./access-links";
import { projectCurrency } from "./currency";

/** Link acceptance can restore the signed-in account without trusting guest identity. */
export async function getSessionAccountIdentity(): Promise<Pick<MemberRecord, "uid" | "email" | "name"> | null> {
  try {
    const session = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!session) return null;
    const token = await adminAuth.verifySessionCookie(session, true);
    const identity = await firestore.collection(USERS).doc(token.uid).get();
    if (!identity.exists) return null;
    const data = identity.data()!;
    return { uid: token.uid, email: String(data.email || token.email || ""), name: String(data.name || token.name || token.email || "User") };
  } catch {
    return null;
  }
}

export async function getSessionMember(): Promise<MemberRecord | null> {
  try {
    const cookieStore = await cookies();
    const publicAccess = cookieStore.get(PUBLIC_ACCESS_LINK_COOKIE);
    // Fail closed for invalid guest cookies even when an account session is present.
    if (publicAccess) return await resolvePublicAccessLink(publicAccess.value);
    const session = cookieStore.get(SESSION_COOKIE)?.value;
    if (!session) return null;
    const token = await adminAuth.verifySessionCookie(session, true);
    const identity = await firestore.collection(USERS).doc(token.uid).get();
    if (!identity.exists) return null;
    const activeProjectId = cookieStore.get(ACTIVE_PROJECT_COOKIE)?.value || "";
    let membership = activeProjectId ? await firestore.collection(MEMBERSHIPS).doc(membershipId(activeProjectId, token.uid)).get() : null;
    let membershipData = membership?.exists ? await resolveMembershipAccess(membership.data()!) : null;
    if (!membership?.exists) {
      const memberships = await firestore.collection(MEMBERSHIPS).where("uid", "==", token.uid).get();
      const resolved = await Promise.all(memberships.docs.map(async (document) => ({ document, data: await resolveMembershipAccess(document.data()) })));
      const approved = resolved.find(({ data }) => data.projectId === personalProjectId(token.uid) && data.status === "approved")
        || resolved.find(({ data }) => data.status === "approved");
      if (approved) { membership = approved.document; membershipData = approved.data; }
      else if (!membership?.exists && resolved.length) { membership = resolved[0].document; membershipData = resolved[0].data; }
    }
    const identityData = identity.data()!;
    if (!membership?.exists && identityData.multiTenantReady === true) return null;
    // Compatibility for active sessions created before project memberships existed.
    const data = membership?.exists ? membershipData! : identityData;
    const projectId = membership?.exists ? String(data.projectId) : LEGACY_PROJECT_ID;
    const project = await firestore.collection(PROJECTS).doc(projectId).get();
    return {
      uid: token.uid,
      projectId,
      projectName: String(project.data()?.name || (projectId === LEGACY_PROJECT_ID ? "Sample House" : "Mi espacio")),
      projectCurrency: projectCurrency(project.data()?.currency),
      isPersonal: project.data()?.kind === "personal" || projectId === personalProjectId(token.uid),
      email: String(identityData.email || token.email || ""),
      name: String(identityData.name || token.name || token.email || "User"),
      role: data.role === "admin" || data.role === "viewer" ? data.role : "editor",
      status: data.status === "approved" || data.status === "rejected" ? data.status : "pending",
      permissions: normalizePermissions(data.permissions),
      folderAccess: normalizeFolderAccess(data.folderAccess),
      ...(typeof data.accessLinkId === "string" ? { accessLinkId: data.accessLinkId } : {}),
      ...(data.linkDefaultLanguage === "es" || data.linkDefaultLanguage === "en" ? { linkDefaultLanguage: data.linkDefaultLanguage } : {}),
    };
  } catch {
    return null;
  }
}

export async function requireApproved(roles?: MemberRecord["role"][]) {
  const member = await getSessionMember();
  if (!member || member.status !== "approved") return null;
  if (roles && !roles.includes(member.role)) return null;
  return member;
}

export async function requireTabAccess(tab: WorkspaceTab, roles?: MemberRecord["role"][]) {
  const member = await requireApproved(roles);
  if (!member) return null;
  if (member.role !== "admin" && !member.permissions[tab]) return null;
  return member;
}

export async function requirePlatformOwner() {
  const member = await requireApproved();
  return member && isUsageOwner(member.email, process.env.HOUSE_PLANNER_ADMIN_EMAIL) ? member : null;
}

export function canAccessFolder(member: MemberRecord, folderId: string | null | undefined, resolvedFolderId: string | null = folderId ?? null) {
  if (member.role === "admin" || member.folderAccess.mode === "all") return true;
  if (resolvedFolderId) return member.folderAccess.folderIds.includes(resolvedFolderId);
  return folderId ? false : member.folderAccess.allowUnfiled;
}

export function publicMember(member: MemberRecord | null) {
  if (!member) return null;
  return { name: member.name, email: member.email, projectId: member.projectId, projectName: member.projectName, projectCurrency: projectCurrency(member.projectCurrency), isPersonal: member.isPersonal, role: member.role, status: member.status, permissions: member.permissions, folderAccess: member.folderAccess, readOnlyLink: Boolean(member.accessLinkId), anonymousLink: member.anonymousLink === true, ...(member.linkDefaultLanguage ? { linkDefaultLanguage: member.linkDefaultLanguage } : {}), canViewPlatformAnalytics: member.status === "approved" && !member.anonymousLink && isUsageOwner(member.email, process.env.HOUSE_PLANNER_ADMIN_EMAIL) };
}
