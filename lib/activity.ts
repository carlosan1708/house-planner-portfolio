import { createHash } from "node:crypto";
import { FieldValue, type DocumentData, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import { firestore } from "./firebase-admin";
import { PROJECTS, WORKSPACE_TABS, type MemberRecord, type WorkspaceTab } from "./project";
import { ACTIVITY_CATEGORIES, type ActivityCategory, type ActivityChange, type ActivityEvent, type ActivitySource, type ActivityVisibility } from "./activity-types";
import { recordActivityUsage } from "./usage-actions";
import type { ProjectAuthorDisplay } from "./project-authors";

const EVENTS = "activityEvents";
const METADATA = "activityMetadata";
const HEAD = "head";
const MAX_STRING = 500;
const MAX_INLINE_CHANGES = 80;

type ActivityActor = Pick<MemberRecord, "uid" | "name" | "email" | "role" | "projectId">;

export type ActivityInput = {
  category: ActivityCategory;
  action: string;
  source?: ActivitySource;
  target: { type: string; id: string; label: string; section: WorkspaceTab; exists?: boolean };
  summaryParams?: Record<string, unknown>;
  changes?: ActivityChange[];
  changeCount?: number;
  visibility?: Partial<ActivityVisibility>;
  detailsObjectKey?: string | null;
};

function cleanString(value: unknown, max = MAX_STRING) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function safeValue(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === undefined) return null;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return cleanString(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => safeValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .slice(0, 50)
      .map(([key, item]) => [cleanString(key, 80), safeValue(item, depth + 1)]));
  }
  return cleanString(value);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashPayload(payload: Record<string, unknown>) {
  return createHash("sha256").update(canonical(payload)).digest("hex");
}

export const activityHashForPayload = hashPayload;

export function activityEvents(projectId: string) {
  return firestore.collection(PROJECTS).doc(projectId).collection(EVENTS);
}

export function activityMetadata(projectId: string) {
  return firestore.collection(PROJECTS).doc(projectId).collection(METADATA).doc(HEAD);
}

export async function appendActivity(transaction: Transaction, actor: ActivityActor, input: ActivityInput) {
  const headRef = activityMetadata(actor.projectId);
  const head = await transaction.get(headRef);
  const previousSequence = Number(head.data()?.sequence || 0);
  const previousHash = cleanString(head.data()?.hash, 64);
  const sequence = previousSequence + 1;
  const occurredAt = new Date().toISOString();
  const ref = activityEvents(actor.projectId).doc();
  const changes = (input.changes || []).slice(0, MAX_INLINE_CHANGES).map((change) => ({
    field: cleanString(change.field, 100),
    before: safeValue(change.before),
    after: safeValue(change.after),
    ...(change.format ? { format: change.format } : {}),
  }));
  const payload = {
    schemaVersion: 1,
    projectId: actor.projectId,
    sequence,
    previousHash,
    category: ACTIVITY_CATEGORIES.includes(input.category) ? input.category : "project",
    action: cleanString(input.action, 100),
    source: input.source || "user",
    actorUid: actor.uid,
    actorName: cleanString(actor.name || actor.email, 160),
    actorEmail: cleanString(actor.email, 254).toLowerCase(),
    actorRole: actor.role,
    target: {
      type: cleanString(input.target.type, 80),
      id: cleanString(input.target.id, 200),
      label: cleanString(input.target.label, 300),
      section: input.target.section,
      exists: input.target.exists !== false,
    },
    summaryParams: safeValue(input.summaryParams || {}),
    changes,
    changeCount: Math.max(changes.length, Number(input.changeCount || 0)),
    occurredAt,
    visibility: {
      requiredTabs: [...new Set(input.visibility?.requiredTabs || [input.target.section])],
      folderTopLevelId: cleanString(input.visibility?.folderTopLevelId, 200) || null,
      folderTopLevelIds: [...new Set((input.visibility?.folderTopLevelIds || []).map((id) => cleanString(id, 200)).filter(Boolean))],
      allowUnfiledRequired: input.visibility?.allowUnfiledRequired === true,
      adminOnly: input.visibility?.adminOnly === true,
    },
    detailsObjectKey: cleanString(input.detailsObjectKey, 500) || null,
  } satisfies Record<string, unknown>;
  const integrityHash = hashPayload(payload);
  transaction.set(ref, { ...payload, integrityHash, createdAt: FieldValue.serverTimestamp() });
  transaction.set(headRef, { sequence, hash: integrityHash, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { id: ref.id, sequence, integrityHash };
}

export async function commitActivity(actor: ActivityActor, input: ActivityInput, mutate: (transaction: Transaction) => void, validate?: (transaction: Transaction) => Promise<void>) {
  const event = await firestore.runTransaction(async (transaction) => {
    await validate?.(transaction);
    const event = await appendActivity(transaction, actor, input);
    mutate(transaction);
    return event;
  });
  await recordActivityUsage(actor, input, event.id);
  return event;
}

function payloadForVerification(data: DocumentData) {
  return {
    schemaVersion: data.schemaVersion,
    projectId: data.projectId,
    sequence: data.sequence,
    previousHash: data.previousHash,
    category: data.category,
    action: data.action,
    source: data.source,
    actorUid: data.actorUid,
    actorName: data.actorName,
    actorEmail: data.actorEmail,
    actorRole: data.actorRole,
    target: data.target,
    summaryParams: data.summaryParams,
    changes: data.changes,
    changeCount: data.changeCount,
    occurredAt: data.occurredAt,
    visibility: data.visibility,
    detailsObjectKey: data.detailsObjectKey ?? null,
  };
}

export function activityIntegrity(data: DocumentData) {
  return hashPayload(payloadForVerification(data)) === data.integrityHash ? "verified" as const : "invalid" as const;
}

export function canViewActivity(member: MemberRecord, data: DocumentData) {
  if (data.projectId !== member.projectId) return false;
  if (member.role === "admin") return true;
  if (!member.permissions.activity) return false;
  const visibility = (data.visibility || {}) as Partial<ActivityVisibility>;
  if (visibility.adminOnly) return false;
  const tabs = Array.isArray(visibility.requiredTabs) ? visibility.requiredTabs : [];
  if (tabs.some((tab) => !member.permissions[tab])) return false;
  const folderId = cleanString(visibility.folderTopLevelId, 200);
  const folderIds = [...new Set([folderId, ...(visibility.folderTopLevelIds || [])].filter(Boolean))];
  if (folderIds.length && member.folderAccess.mode === "selected" && folderIds.some((id) => !member.folderAccess.folderIds.includes(id))) return false;
  if (visibility.allowUnfiledRequired && member.folderAccess.mode === "selected" && !member.folderAccess.allowUnfiled) return false;
  return true;
}

export function serializeActivity(snapshot: DocumentSnapshot, authors?: ProjectAuthorDisplay): ActivityEvent {
  const data = snapshot.data() || {};
  const category = ACTIVITY_CATEGORIES.includes(data.category) ? data.category : "project";
  const integrity = activityIntegrity(data);
  return {
    id: snapshot.id,
    sequence: Number(data.sequence || 0),
    category,
    action: cleanString(data.action, 100),
    source: data.source === "assistant" || data.source === "system" ? data.source : "user",
    actor: {
      uid: cleanString(data.actorUid, 200),
      name: authors ? authors.display(cleanString(data.actorName, 160), data.occurredAt, data.actorUid, data.actorEmail) : cleanString(data.actorName, 160),
      role: data.actorRole === "admin" || data.actorRole === "viewer" ? data.actorRole : "editor",
    },
    target: {
      type: cleanString(data.target?.type, 80),
      id: cleanString(data.target?.id, 200),
      label: data.target?.type === "member" && authors
        ? authors.display(cleanString(data.target?.label, 300), data.occurredAt, data.target?.id)
        : cleanString(data.target?.label, 300),
      section: WORKSPACE_TABS.includes(data.target?.section) ? data.target.section : "overview",
      exists: data.target?.exists !== false,
    },
    summaryParams: (safeValue(data.summaryParams || {}) || {}) as Record<string, unknown>,
    changes: Array.isArray(data.changes) ? data.changes : [],
    changeCount: Number(data.changeCount || 0),
    occurredAt: cleanString(data.occurredAt, 40),
    visibility: {
      requiredTabs: Array.isArray(data.visibility?.requiredTabs) ? data.visibility.requiredTabs : [],
      folderTopLevelId: cleanString(data.visibility?.folderTopLevelId, 200) || null,
      folderTopLevelIds: Array.isArray(data.visibility?.folderTopLevelIds) ? data.visibility.folderTopLevelIds.map((id: unknown) => cleanString(id, 200)).filter(Boolean) : [],
      allowUnfiledRequired: data.visibility?.allowUnfiledRequired === true,
      adminOnly: data.visibility?.adminOnly === true,
    },
    integrity,
    hasDetails: Boolean(data.detailsObjectKey) || Number(data.changeCount || 0) > (Array.isArray(data.changes) ? data.changes.length : 0),
  };
}

export function activityMatches(data: DocumentData, filters: { category?: string; actorUid?: string; from?: number; to?: number }) {
  if (filters.category && data.category !== filters.category) return false;
  if (filters.actorUid && data.actorUid !== filters.actorUid) return false;
  const occurred = Date.parse(String(data.occurredAt || ""));
  if (filters.from && (!Number.isFinite(occurred) || occurred < filters.from)) return false;
  if (filters.to && (!Number.isFinite(occurred) || occurred > filters.to)) return false;
  return true;
}

export function diffChanges(before: Record<string, unknown>, after: Record<string, unknown>, formats: Record<string, ActivityChange["format"]> = {}) {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys.flatMap((field) => canonical(safeValue(before[field])) === canonical(safeValue(after[field])) ? [] : [{ field, before: safeValue(before[field]), after: safeValue(after[field]), ...(formats[field] ? { format: formats[field] } : {}) }]);
}
