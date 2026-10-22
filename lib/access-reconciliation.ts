import {
  normalizeFolderAccess,
  normalizePermissions,
  type FolderAccess,
  type MemberPermissions,
  type ProjectRole,
} from "./project";

type RecordData = Record<string, unknown>;

export type RepairedMembership = {
  projectId: string;
  uid: string;
  role: ProjectRole;
  status: "approved";
  permissions: MemberPermissions;
  folderAccess: FolderAccess;
  invitedBy: string;
};

const normalizedEmail = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export function membershipFromAcceptedInvitation(
  projectId: string,
  invitation: RecordData,
  identityUid: string,
  identity: RecordData,
): RepairedMembership | null {
  const acceptedUid = typeof invitation.acceptedByUid === "string"
    ? invitation.acceptedByUid.trim()
    : "";
  const invitationEmail = normalizedEmail(invitation.email);
  const identityEmail = normalizedEmail(identity.email);
  if (
    invitation.projectId !== projectId ||
    invitation.status !== "accepted" ||
    !acceptedUid ||
    acceptedUid !== identityUid ||
    !invitationEmail ||
    invitationEmail !== identityEmail
  ) return null;

  return {
    projectId,
    uid: identityUid,
    role: invitation.role === "viewer" ? "viewer" : "editor",
    status: "approved",
    permissions: normalizePermissions(invitation.permissions),
    folderAccess: normalizeFolderAccess(invitation.folderAccess),
    invitedBy: normalizedEmail(invitation.invitedBy),
  };
}
