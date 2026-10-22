import { createHash, randomBytes } from "node:crypto";
import { FieldValue, type DocumentData, type DocumentSnapshot } from "firebase-admin/firestore";
import { appendActivity } from "./activity";
import { projectCurrency } from "./currency";
import { firestore } from "./firebase-admin";
import { ACCESS_LINKS, FOLDERS, LEGACY_PROJECT_ID, MEMBERSHIPS, membershipId, normalizeFolderAccess, normalizePermissions, PROJECTS, USERS, WORKSPACE_TABS, type FolderAccess, type MemberPermissions, type MemberRecord } from "./project";

export { ACCESS_LINKS } from "./project";
export const ACCESS_LINK_DAYS = 14;
export type AccessLinkAuthentication = "account" | "public";
export type AccessLinkLanguage = "es" | "en";

export function accessLinkAuthentication(value: unknown): AccessLinkAuthentication {
  return value === "public" ? "public" : "account";
}

export function accessLinkLanguage(value: unknown): AccessLinkLanguage {
  return value === "en" ? "en" : "es";
}

export function accessLinkDefaultSection(permissions: unknown) {
  const normalized = normalizePermissions(permissions);
  return WORKSPACE_TABS.find((tab) => normalized[tab]) || "overview";
}

export type AccessLinkRecord = {
  id: string;
  projectId: string;
  label: string;
  role: "viewer";
  authentication: AccessLinkAuthentication;
  defaultLanguage: AccessLinkLanguage;
  status: "active" | "revoked" | "expired";
  permissions: MemberPermissions;
  folderAccess: FolderAccess;
  createdBy: string;
  createdAt: string | null;
  expiresAt: string | null;
  redemptionCount: number;
};

export class AccessLinkError extends Error {
  constructor(message: string, readonly status = 403) { super(message); }
}

function timestampMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") return value.toMillis();
  return 0;
}

export function accessLinkStatus(data: DocumentData, now = Date.now()): AccessLinkRecord["status"] {
  if (data.status !== "active") return "revoked";
  return timestampMillis(data.expiresAt) > now ? "active" : "expired";
}

export function serializeAccessLink(document: DocumentSnapshot): AccessLinkRecord {
  const data = document.data()!;
  const iso = (value: unknown) => { const millis = timestampMillis(value); return millis ? new Date(millis).toISOString() : null; };
  return {
    id: document.id,
    projectId: String(data.projectId || ""),
    label: String(data.label || "Read-only link"),
    role: "viewer",
    authentication: accessLinkAuthentication(data.authentication),
    defaultLanguage: accessLinkLanguage(data.defaultLanguage),
    status: accessLinkStatus(data),
    permissions: normalizePermissions(data.permissions),
    folderAccess: normalizeFolderAccess(data.folderAccess),
    createdBy: String(data.createdBy || ""),
    createdAt: iso(data.createdAt),
    expiresAt: iso(data.expiresAt),
    redemptionCount: Math.max(0, Number(data.redemptionCount || 0)),
  };
}

export function accessLinkTokenHash(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AccessLinkError("El enlace de lectura no es válido.", 400);
  return createHash("sha256").update(token).digest("hex");
}

export function createAccessLinkToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, id: accessLinkTokenHash(token) };
}

/** Link policies remain authoritative after redemption, including expiry and revocation. */
export function effectiveAccessLinkMembership(data: DocumentData, link: DocumentData | null, now = Date.now()): DocumentData {
  if (data.removed === true) {
    return { ...data, status: "rejected", permissions: Object.fromEntries(WORKSPACE_TABS.map((tab) => [tab, false])), folderAccess: { mode: "selected", folderIds: [], allowUnfiled: false } };
  }
  if (!data.accessLinkId) return data;
  if (data.status !== "approved" || !link || link.projectId !== data.projectId || accessLinkStatus(link, now) !== "active") {
    return { ...data, role: "viewer", status: "rejected", permissions: Object.fromEntries(WORKSPACE_TABS.map((tab) => [tab, false])), folderAccess: { mode: "selected", folderIds: [], allowUnfiled: false } };
  }
  return { ...data, role: "viewer", permissions: normalizePermissions(link.permissions), folderAccess: normalizeFolderAccess(link.folderAccess), linkDefaultLanguage: accessLinkLanguage(link.defaultLanguage) };
}

export async function resolveMembershipAccess(data: DocumentData): Promise<DocumentData> {
  if (data.removed === true) return effectiveAccessLinkMembership(data, null);
  if (!data.accessLinkId) return data;
  if (typeof data.accessLinkId !== "string" || !/^[a-f0-9]{64}$/.test(data.accessLinkId)) return effectiveAccessLinkMembership(data, null);
  const link = await firestore.collection(ACCESS_LINKS).doc(data.accessLinkId).get();
  return effectiveAccessLinkMembership(data, link.exists ? link.data()! : null);
}

export async function validatedAccessLinkFolders(value: unknown, projectId: string) {
  const access = normalizeFolderAccess(value);
  if (access.mode === "all") return access;
  const folders = await firestore.collection(FOLDERS).where("projectId", "==", projectId).get();
  const topLevelIds = new Set(folders.docs.filter((folder) => !folder.data().parentId && !folder.data().deletedAt).map((folder) => folder.id));
  return { ...access, folderIds: access.folderIds.filter((id) => topLevelIds.has(id)) };
}

export function accessLinkOrigin(request: Request) {
  const configured = process.env.HOUSE_PLANNER_PUBLIC_URL?.trim();
  if (configured) {
    try { return new URL(configured).origin; } catch { /* fall back to request origin */ }
  }
  return new URL(request.url).origin;
}

function validateLinkPolicy(policy: DocumentData, requestedProjectId: string) {
  if (accessLinkStatus(policy) !== "active") throw new AccessLinkError("El enlace de lectura ha caducado o fue revocado.", 410);
  const projectId = typeof policy.projectId === "string" ? policy.projectId : "";
  if (!projectId || (requestedProjectId && requestedProjectId !== projectId)) throw new AccessLinkError("El enlace de lectura pertenece a otro proyecto.");
  return projectId;
}

function publicAccessLinkMember(id: string, policy: DocumentData, project: DocumentData): MemberRecord {
  const defaultLanguage = accessLinkLanguage(policy.defaultLanguage);
  return {
    uid: `access-link-${id}`, projectId: policy.projectId,
    projectName: String(project.name || "Proyecto"), projectCurrency: projectCurrency(project.currency), isPersonal: project.kind === "personal",
    email: "", name: defaultLanguage === "en" ? "Guest" : "Invitado",
    role: "viewer", status: "approved",
    permissions: normalizePermissions(policy.permissions), folderAccess: normalizeFolderAccess(policy.folderAccess),
    accessLinkId: id, anonymousLink: true, linkDefaultLanguage: defaultLanguage,
  };
}

/** Every guest request validates the bearer capability and its current policy. */
export async function resolvePublicAccessLink(token: string, requestedProjectId = ""): Promise<MemberRecord> {
  const id = accessLinkTokenHash(token);
  const link = await firestore.collection(ACCESS_LINKS).doc(id).get();
  if (!link.exists) throw new AccessLinkError("El enlace de lectura no existe.", 404);
  const policy = link.data()!;
  const projectId = validateLinkPolicy(policy, requestedProjectId);
  if (accessLinkAuthentication(policy.authentication) !== "public") throw new AccessLinkError("Este enlace de lectura requiere iniciar sesión.", 401);
  const project = await firestore.collection(PROJECTS).doc(projectId).get();
  if (!project.exists) throw new AccessLinkError("El proyecto del enlace ya no está disponible.", 404);
  return publicAccessLinkMember(id, policy, project.data()!);
}

/** Public acceptance never creates an account or a project membership. */
export async function redeemPublicAccessLink(token: string, requestedProjectId = "") {
  const id = accessLinkTokenHash(token);
  const linkRef = firestore.collection(ACCESS_LINKS).doc(id);
  return firestore.runTransaction(async (transaction) => {
    const link = await transaction.get(linkRef);
    if (!link.exists) throw new AccessLinkError("El enlace de lectura no existe.", 404);
    const policy = link.data()!;
    const projectId = validateLinkPolicy(policy, requestedProjectId);
    if (accessLinkAuthentication(policy.authentication) !== "public") return null;
    const project = await transaction.get(firestore.collection(PROJECTS).doc(projectId));
    if (!project.exists) throw new AccessLinkError("El proyecto del enlace ya no está disponible.", 404);
    transaction.set(linkRef, { redemptionCount: FieldValue.increment(1), lastRedeemedAt: FieldValue.serverTimestamp() }, { merge: true });
    return {
      member: publicAccessLinkMember(id, policy, project.data()!),
      defaultSection: accessLinkDefaultSection(policy.permissions),
      maxAge: Math.max(0, Math.min(ACCESS_LINK_DAYS * 24 * 60 * 60, Math.floor((timestampMillis(policy.expiresAt) - Date.now()) / 1000))),
    };
  });
}

export async function redeemAccessLink(identity: Pick<MemberRecord, "uid" | "name" | "email">, token: string, requestedProjectId = "") {
  const id = accessLinkTokenHash(token);
  const linkRef = firestore.collection(ACCESS_LINKS).doc(id);
  return firestore.runTransaction(async (transaction) => {
    const link = await transaction.get(linkRef);
    if (!link.exists) throw new AccessLinkError("El enlace de lectura no existe.", 404);
    const policy = link.data()!;
    const projectId = validateLinkPolicy(policy, requestedProjectId);
    const memberRef = firestore.collection(MEMBERSHIPS).doc(membershipId(projectId, identity.uid));
    const [project, member] = await transaction.getAll(firestore.collection(PROJECTS).doc(projectId), memberRef);
    if (!project.exists) throw new AccessLinkError("El proyecto del enlace ya no está disponible.", 404);
    const existing = member.data();
    // Removing a member blocks every shared link until an administrator explicitly invites them again.
    if (existing?.removed === true) {
      throw new AccessLinkError("El administrador ha eliminado tu acceso a este proyecto. Necesitas una nueva invitación para recuperarlo.");
    }
    // A link never changes an independently granted role or its permissions.
    if (existing?.status === "approved" && !existing.accessLinkId) return projectId;
    if (existing && existing.status !== "approved" && (existing.accessLinkBlocked === true || existing.reviewedBy || existing.reviewedAt)) {
      throw new AccessLinkError("El administrador ha retirado tu acceso a este proyecto. Contacta con él para recuperarlo.");
    }
    if (existing?.status === "approved" && existing.accessLinkId === id) return projectId;
    if (!member.exists && projectId === LEGACY_PROJECT_ID) {
      const legacyIdentity = await transaction.get(firestore.collection(USERS).doc(identity.uid));
      const legacy = legacyIdentity.data();
      // Preserve the approved access used by pre-membership sessions before accepting a link.
      if (legacy?.status === "approved" && legacy.multiTenantReady !== true) {
        transaction.set(memberRef, {
          projectId, uid: identity.uid,
          role: legacy.role === "admin" || legacy.role === "viewer" ? legacy.role : "editor",
          status: "approved", permissions: normalizePermissions(legacy.permissions),
          folderAccess: normalizeFolderAccess(legacy.folderAccess),
          joinedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        });
        return projectId;
      }
    }
    await appendActivity(transaction, { ...identity, projectId, role: "viewer" }, {
      category: "access", action: "access.link_redeemed",
      target: { type: "member", id: identity.uid, label: identity.name || identity.email, section: "overview" },
      changes: [{ field: "status", before: existing?.status || null, after: "approved", format: "status" }],
      visibility: { requiredTabs: ["overview"], adminOnly: true },
    });
    transaction.set(memberRef, {
      projectId, uid: identity.uid, role: "viewer", status: "approved",
      permissions: normalizePermissions(policy.permissions), folderAccess: normalizeFolderAccess(policy.folderAccess),
      accessLinkId: id, accessLinkBlocked: false, invitedBy: String(policy.createdBy || ""),
      joinedAt: existing?.joinedAt || FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(linkRef, { redemptionCount: FieldValue.increment(1), lastRedeemedAt: FieldValue.serverTimestamp() }, { merge: true });
    return projectId;
  });
}
