import { createHash, randomBytes } from "node:crypto";
import { canAccessFolder } from "./auth";
import { adminAuth, firestore, projectBucket } from "./firebase-admin";
import {
  AESTHETIC_FOLDERS, AESTHETIC_IMAGES, DOCUMENTS, FOLDERS, LEGACY_PROJECT_ID,
  MEMBERSHIPS, USERS, membershipId, normalizeFolderAccess, normalizePermissions,
  projectStoragePrefix, type MemberRecord,
} from "./project";

export const FILE_SHARE_LINKS = "housePlannerFileShareLinks";
export const FILE_SHARE_DAYS = [1, 3, 7] as const;
export type FileShareDays = (typeof FILE_SHARE_DAYS)[number];
export type FileShareInput = { kind: "document" | "aesthetic"; id: string; expiresInDays: FileShareDays };
export type FileShareResult = { url: string; expiresAt: string; expiresInDays: FileShareDays };

export class FileShareError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,220}$/.test(value);
}

export function parseFileShareInput(value: unknown): FileShareInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new FileShareError("Choose a file and a valid expiration", 400);
  const input = value as Record<string, unknown>;
  if ((input.kind !== "document" && input.kind !== "aesthetic") || !validId(input.id)
    || !FILE_SHARE_DAYS.some(days => days === input.expiresInDays)
    || Object.keys(input).some(key => !["kind", "id", "expiresInDays"].includes(key))) {
    throw new FileShareError("Choose a file and an expiration of 1, 3, or 7 days", 400);
  }
  return { kind: input.kind, id: input.id, expiresInDays: input.expiresInDays as FileShareDays };
}

export function assertFileShareCreator(actor: MemberRecord | null): asserts actor is MemberRecord {
  if (!actor) throw new FileShareError("Authentication required", 401);
  if (actor.status !== "approved" || actor.anonymousLink || actor.accessLinkId || !["admin", "editor"].includes(actor.role)) {
    throw new FileShareError("Editor access required to share files", 403);
  }
}

export function fileShareDisposition(fileName: unknown) {
  const name = (typeof fileName === "string" ? fileName : "Document")
    .replace(/[\u0000-\u001f\u007f/\\]/g, "_").slice(0, 240) || "Document";
  const encoded = encodeURIComponent(name).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename*=UTF-8''${encoded}`;
}

function unavailable(): never { throw new FileShareError("Shared file is unavailable", 404); }

/** Refresh grants in the original project; a share never preserves removed creator access. */
async function currentCreator(projectId: string, uid: string): Promise<MemberRecord> {
  try {
    const identity = await adminAuth.getUser(uid);
    if (identity.disabled) unavailable();
  } catch (error) {
    if (error instanceof FileShareError) throw error;
    if (error && typeof error === "object" && "code" in error && error.code === "auth/user-not-found") unavailable();
    throw new FileShareError("File sharing is unavailable. Try again later.", 503);
  }
  const [membership, identity] = await Promise.all([
    firestore.collection(MEMBERSHIPS).doc(membershipId(projectId, uid)).get(),
    firestore.collection(USERS).doc(uid).get(),
  ]);
  if (!identity.exists) unavailable();
  let data = membership.data();
  if (membership.exists) {
    if (data?.projectId !== projectId || data.uid !== uid) unavailable();
  } else {
    if (projectId !== LEGACY_PROJECT_ID || identity.data()?.multiTenantReady === true) unavailable();
    const memberships = await firestore.collection(MEMBERSHIPS).where("uid", "==", uid).get();
    if (memberships.docs.length) unavailable();
    data = identity.data();
  }
  if (!data || data.status !== "approved" || data.removed === true || data.accessLinkId || data.anonymousLink === true) unavailable();
  const role = data.role === "admin" || data.role === "viewer" ? data.role : "editor";
  if (role === "viewer") unavailable();
  return {
    uid, projectId, projectName: "", isPersonal: false, name: "", email: "", role, status: "approved",
    permissions: normalizePermissions(data.permissions), folderAccess: normalizeFolderAccess(data.folderAccess),
  };
}

type FolderRecords = Map<string, FirebaseFirestore.DocumentData>;

/** Traverse raw records so deleted, dangling, cross-project and inherited vault paths fail closed. */
function fileLocation(data: FirebaseFirestore.DocumentData, projectId: string, folders: FolderRecords) {
  if (data.folderId !== undefined && data.folderId !== null && data.folderId !== "" && !validId(data.folderId)) unavailable();
  const folderId = typeof data.folderId === "string" && data.folderId ? data.folderId : null;
  let id = folderId;
  const visited = new Set<string>();
  while (id) {
    if (visited.has(id)) unavailable();
    visited.add(id);
    const folder = folders.get(id);
    if (!folder || folder.projectId !== projectId || folder.deletedAt) unavailable();
    if (folder.encrypted === true || folder.vault) throw new FileShareError("Encrypted files cannot be shared", 409);
    const parent = folder.parentId;
    if (parent === undefined || parent === null || parent === "") {
      return { folderId, topLevelId: id, topLevelName: String(folder.name || "").trim().toLocaleLowerCase() };
    }
    if (!validId(parent)) unavailable();
    id = parent;
  }
  return { folderId, topLevelId: null, topLevelName: "" };
}

function safeObjectKey(value: unknown, projectId: string, kind: FileShareInput["kind"]) {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f\\]/.test(value)
    || value.split("/").some(part => !part || part === "." || part === "..")) unavailable();
  const prefix = projectStoragePrefix(projectId);
  const allowed = kind === "document" ? ["documents", "invoices", "purchase-photos"] : ["aesthetics"];
  if (!allowed.some(section => value.startsWith(`${prefix}/${section}/`))) unavailable();
  return value;
}

async function sourceFor(actor: MemberRecord, input: Pick<FileShareInput, "kind" | "id">) {
  const collection = input.kind === "document" ? DOCUMENTS : AESTHETIC_IMAGES;
  const folderCollection = input.kind === "document" ? FOLDERS : AESTHETIC_FOLDERS;
  const [source, folderSnapshot] = await Promise.all([
    firestore.collection(collection).doc(input.id).get(),
    firestore.collection(folderCollection).where("projectId", "==", actor.projectId).get(),
  ]);
  const data = source.data();
  if (!source.exists || !data || data.projectId !== actor.projectId || data.deletedAt) unavailable();
  if (data.encrypted === true || data.encryptedMetadata || data.vaultFolderId || data.encryptionCleanupPending === true) {
    throw new FileShareError("Encrypted files or files awaiting encryption cleanup cannot be shared", 409);
  }
  const folders = new Map(folderSnapshot.docs.map(folder => [folder.id, folder.data()]));
  const location = fileLocation(data, actor.projectId, folders);
  const expenseMedia = location.topLevelName === "factura" || location.topLevelName === "compras";
  const tab = input.kind === "aesthetic" ? "aesthetics" : expenseMedia ? "expenses" : "documents";
  if (actor.role !== "admin" && !actor.permissions[tab]) unavailable();
  if (input.kind === "aesthetic" && !location.folderId) unavailable();
  if (input.kind === "document" && !expenseMedia && !canAccessFolder(actor, location.folderId, location.topLevelId)) unavailable();
  return { objectKey: safeObjectKey(data.objectKey, actor.projectId, input.kind), fileName: data.fileName };
}

function storageFailure(error: unknown): never {
  if (error && typeof error === "object" && "code" in error && (error.code === 404 || error.code === "404")) unavailable();
  throw new FileShareError("File storage is unavailable. Try again later.", 503);
}

export async function createFileShare(actor: MemberRecord, input: FileShareInput, now = Date.now()): Promise<FileShareResult> {
  assertFileShareCreator(actor);
  if (!projectBucket) throw new FileShareError("File storage is unavailable", 503);
  const creator = await currentCreator(actor.projectId, actor.uid);
  const source = await sourceFor(creator, input);
  let generation: string;
  try {
    const [metadata] = await projectBucket.file(source.objectKey).getMetadata();
    generation = String(metadata.generation || "");
    // The Storage SDK converts generation strings to Number internally; reject values it cannot pin exactly.
    if (!/^\d+$/.test(generation) || !Number.isSafeInteger(Number(generation))) throw new Error("Unusable object generation");
  } catch (error) { storageFailure(error); }
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(now + input.expiresInDays * 24 * 60 * 60 * 1000);
  await firestore.collection(FILE_SHARE_LINKS).doc(hash).create({
    kind: input.kind, sourceId: input.id, projectId: actor.projectId, createdByUid: actor.uid,
    objectKey: source.objectKey, generation, createdAt: new Date(now), expiresAt,
  });
  return { url: `/api/files/share?token=${token}`, expiresAt: expiresAt.toISOString(), expiresInDays: input.expiresInDays };
}

function timestampMillis(value: unknown) {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") return value.toMillis();
  return 0;
}

/** Public bearer access remains bound to its creator, source, exact object version and expiration. */
export async function downloadFileShare(token: unknown, now = Date.now()) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) unavailable();
  const hash = createHash("sha256").update(token).digest("hex");
  const link = await firestore.collection(FILE_SHARE_LINKS).doc(hash).get();
  const data = link.data();
  if (!link.exists || !data || data.revokedAt) unavailable();
  const expiresAt = timestampMillis(data.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) unavailable();
  if (expiresAt <= now) throw new FileShareError("This shared link has expired", 410);
  if ((data.kind !== "document" && data.kind !== "aesthetic") || !validId(data.sourceId)
    || !validId(data.createdByUid) || !validId(data.projectId)
    || typeof data.generation !== "string" || !/^\d+$/.test(data.generation)
    || !Number.isSafeInteger(Number(data.generation))) unavailable();
  if (!projectBucket) throw new FileShareError("File storage is unavailable", 503);
  let source;
  try {
    const creator = await currentCreator(data.projectId, data.createdByUid);
    source = await sourceFor(creator, { kind: data.kind, id: data.sourceId });
  } catch (error) {
    if (error instanceof FileShareError && error.status !== 503) unavailable();
    throw error;
  }
  if (source.objectKey !== data.objectKey) unavailable();
  const file = projectBucket.file(source.objectKey, { generation: data.generation });
  let contentLength: string;
  try {
    const [metadata] = await file.getMetadata();
    if (String(metadata.generation) !== data.generation) unavailable();
    contentLength = String(metadata.size ?? "");
    if (!/^\d+$/.test(contentLength)) throw new Error("Unusable object size");
  } catch (error) {
    if (error instanceof FileShareError) throw error;
    storageFailure(error);
  }
  // Preserve stored bytes (and their length) rather than automatically decompressing encoded objects.
  const stream = file.createReadStream({ decompress: false });
  return { stream, contentLength, disposition: fileShareDisposition(source.fileName) };
}
