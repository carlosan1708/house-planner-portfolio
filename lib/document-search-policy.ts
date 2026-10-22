import { canAccessFolder } from "./auth";
import type { MemberRecord } from "./project";

export const DOCUMENT_SEARCH_CANDIDATE_LIMIT = 250;
export const DOCUMENT_SEARCH_BYTE_LIMIT = 120_000;
export const DOCUMENT_SEARCH_RESULT_LIMIT = 30;
export const DOCUMENT_SEARCH_MODEL = "gemini-3.1-flash-lite";

export type DocumentSearchCode = "semantic_unavailable" | "search_limit" | "semantic_scope_limit" | "invalid_query" | "denied";
export class DocumentSearchFailure extends Error {
  constructor(readonly code: DocumentSearchCode, readonly status: number, readonly retryAfter?: number) { super(code); }
}

export type SearchMetadata = { id: string; name: string; description: string; path: string };
export type SearchCandidate = SearchMetadata & { fingerprint: string };
export type SearchScore = { id: string; score: number };
type RecordData = Record<string, unknown>;
type SourceRecord = { id: string; data: RecordData };
const identifier = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(value);

export function documentSearchQuery(input: unknown): { query: string; language: "es" | "en" } {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new DocumentSearchFailure("invalid_query", 400);
  const body = input as RecordData;
  if (typeof body.query !== "string" || body.query.trim().length < 3 || body.query.length > 400
    || body.language !== "es" && body.language !== "en") throw new DocumentSearchFailure("invalid_query", 400);
  return { query: body.query.trim(), language: body.language };
}

export function documentSearchActor(actor: MemberRecord | null): actor is MemberRecord {
  return Boolean(actor && actor.status === "approved" && !actor.anonymousLink && (actor.role === "admin" || actor.permissions.documents));
}

/** Resolve every ancestor. Invalid, protected and expense-only trees fail closed before model input. */
export function permittedSearchMetadata(actor: MemberRecord, documents: SourceRecord[], folderRecords: SourceRecord[]): SearchCandidate[] {
  const folders = new Map(folderRecords.map(folder => [folder.id, folder.data]));
  const output: SearchCandidate[] = [];
  for (const document of documents) {
    const data = document.data;
    if (!identifier(document.id) || data.projectId !== actor.projectId || data.deletedAt || data.encrypted === true
      || data.encryptionCleanupPending === true || data.vaultFolderId || data.encryptedMetadata) continue;
    if (data.folderId !== undefined && data.folderId !== null && typeof data.folderId !== "string") continue;
    const folderId = typeof data.folderId === "string" && data.folderId ? data.folderId : null;
    const path: string[] = [], ancestry: string[] = [], visited = new Set<string>();
    let id = folderId, topLevelId: string | null = null, valid = true;
    while (id) {
      if (!identifier(id) || visited.has(id)) { valid = false; break; }
      visited.add(id);
      ancestry.push(id);
      const folder = folders.get(id);
      if (!folder || folder.projectId !== actor.projectId || folder.deletedAt || folder.encrypted === true
        || folder.vault || folder.encryptionCleanupPending === true) { valid = false; break; }
      const name = typeof folder.name === "string" ? folder.name : "Folder";
      path.unshift(name);
      const parent = folder.parentId;
      if (parent === undefined || parent === null || parent === "") {
        if (["factura", "compras"].includes(name.trim().toLocaleLowerCase())) valid = false;
        topLevelId = id;
        break;
      }
      if (!identifier(parent)) { valid = false; break; }
      id = parent;
    }
    if (!valid || !canAccessFolder(actor, folderId, topLevelId)) continue;
    const name = typeof data.fileName === "string" ? data.fileName : "Document";
    const description = typeof data.description === "string" && data.description
      ? data.description : typeof data.aiDescription === "string" ? data.aiDescription : "";
    const metadata = { id: document.id, name, description, path: path.join(" / ") };
    output.push({ ...metadata, fingerprint: JSON.stringify([metadata, folderId, ancestry]) });
  }
  return output.sort((a, b) => a.id.localeCompare(b.id));
}

export function documentSearchContents(query: string, language: "es" | "en", documents: SearchMetadata[]) {
  const contents = JSON.stringify({ query, language, documents: documents.map(({ id, name, description, path }) => ({ id, name, description, path })) });
  if (documents.length > DOCUMENT_SEARCH_CANDIDATE_LIMIT || Buffer.byteLength(contents, "utf8") > DOCUMENT_SEARCH_BYTE_LIMIT)
    throw new DocumentSearchFailure("semantic_scope_limit", 413);
  return contents;
}

/** Never trust generated identity, text, order, URLs or score coercions. */
export function parseDocumentSearchScores(text: unknown, sent: SearchMetadata[]): SearchScore[] {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > 24_000) throw new DocumentSearchFailure("semantic_unavailable", 503);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new DocumentSearchFailure("semantic_unavailable", 503); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray((parsed as RecordData).results))
    throw new DocumentSearchFailure("semantic_unavailable", 503);
  const values = (parsed as { results: unknown[] }).results;
  if (values.length > DOCUMENT_SEARCH_RESULT_LIMIT) throw new DocumentSearchFailure("semantic_unavailable", 503);
  const allowed = new Set(sent.map(document => document.id)), seen = new Set<string>();
  const scores: SearchScore[] = [];
  for (const value of values) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const item = value as RecordData;
    if (typeof item.id !== "string" || !allowed.has(item.id) || seen.has(item.id)
      || typeof item.score !== "number" || !Number.isFinite(item.score) || item.score < 0.5 || item.score > 1) continue;
    seen.add(item.id);
    scores.push({ id: item.id, score: item.score });
  }
  return scores.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

export function unchangedDocumentSearchScores(scores: SearchScore[], before: SearchCandidate[], after: SearchCandidate[]) {
  const previous = new Map(before.map(document => [document.id, JSON.stringify(document)]));
  const current = new Map(after.map(document => [document.id, JSON.stringify(document)]));
  return scores.filter(item => previous.get(item.id) === current.get(item.id));
}
