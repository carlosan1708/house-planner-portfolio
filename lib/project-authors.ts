import { firestore } from "./firebase-admin";
import { MEMBERSHIPS } from "./project";

export const DEACTIVATED_USER_NAME = "Usuario desactivado";

type RecordData = Record<string, unknown>;
type Removal = { removed: boolean; cutoff: number | null };

function timestamp(value: unknown): number | null {
  let result: number;
  if (value instanceof Date) result = value.getTime();
  else if (typeof value === "number") result = value;
  else if (typeof value === "string") result = Date.parse(value);
  else if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") result = Number(value.toMillis());
  else if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") result = Number(value.toDate());
  else return null;
  return Number.isFinite(result) ? result : null;
}

const email = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";

const AUTHOR_TIMESTAMPS = {
  createdBy: "createdAt", updatedBy: "updatedAt", uploadedBy: "createdAt",
  requestedBy: "createdAt", requested_by: "created_at", reviewedBy: "reviewedAt", reviewed_by: "reviewed_at",
  approvedBy: "approvedAt", rejectedBy: "rejectedAt", invitedBy: "createdAt", revokedBy: "revokedAt", deletedBy: "deletedAt",
} as const;

/** Read-time aliases preserve stored content, encrypted metadata and signed activity. */
export function projectAuthorDisplay(memberships: RecordData[]) {
  const byUid = new Map<string, Removal[]>();
  const byEmail = new Map<string, Removal[]>();
  for (const membership of memberships) {
    const addresses = [...new Set([membership.removedEmail, ...(Array.isArray(membership.removedEmails) ? membership.removedEmails : [])].map(email).filter(Boolean))];
    const cutoff = timestamp(membership.removedAt);
    if (membership.removed !== true && cutoff === null && !addresses.length) continue;
    const removal = { removed: membership.removed === true, cutoff };
    const uid = typeof membership.uid === "string" ? membership.uid : "";
    if (uid) byUid.set(uid, [...(byUid.get(uid) || []), removal]);
    for (const address of addresses) byEmail.set(address, [...(byEmail.get(address) || []), removal]);
  }

  function isDeactivated(uid: unknown, address: unknown, occurredAt: unknown) {
    const removals = typeof uid === "string" && byUid.has(uid) ? byUid.get(uid)! : byEmail.get(email(address)) || [];
    const occurred = timestamp(occurredAt);
    return removals.some((removal) => removal.removed || removal.cutoff === null || occurred === null || occurred <= removal.cutoff);
  }

  function display(value: unknown, occurredAt?: unknown, uid?: unknown, address: unknown = value) {
    return isDeactivated(uid, address, occurredAt) ? DEACTIVATED_USER_NAME : String(value || "");
  }

  function redact<T extends RecordData>(data: T): T {
    const result: RecordData = { ...data };
    for (const [field, dateField] of Object.entries(AUTHOR_TIMESTAMPS)) {
      if (typeof data[field] !== "string" || !data[field]) continue;
      result[field] = display(data[field], data[dateField], data[`${field}Uid`]);
    }
    return result as T;
  }

  return { display, redact, isDeactivated };
}

export type ProjectAuthorDisplay = ReturnType<typeof projectAuthorDisplay>;

export async function loadProjectAuthorDisplay(projectId: string): Promise<ProjectAuthorDisplay> {
  const snapshot = await firestore.collection(MEMBERSHIPS).where("projectId", "==", projectId).get();
  return projectAuthorDisplay(snapshot.docs.map((document) => document.data()));
}
