import { FieldValue } from "firebase-admin/firestore";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import type { MemberRecord } from "./project";
import { canAccessFolder } from "./auth";
import { firestore, projectBucket } from "./firebase-admin";
import { buildTopLevelFolderMap, folderTopLevelId, listProjectFolders } from "./folders";
import { DOCUMENTS } from "./project";
import type { AssistantCitation } from "./assistant";

const PDF_TYPE = "application/pdf";
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_INDEX_BYTES = 500_000;

export function isAssistantDocument(fileName: string, contentType: string) {
  const name = fileName.toLocaleLowerCase();
  const type = contentType.toLocaleLowerCase();
  return type === PDF_TYPE || type === DOCX_TYPE || name.endsWith(".pdf") || name.endsWith(".docx");
}

export function buildDocumentDescription(fileName: string, text: string) {
  const stem = fileName.replace(/\.(pdf|docx)$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const lines = text
    .replace(/\u0000/g, "")
    .split(/\r?\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line, index, all) => line.length >= 4 && all.indexOf(line) === index);
  const excerpt = lines.slice(0, 3).join(" · ").slice(0, 320).trim();
  return excerpt || `Document: ${stem || fileName}`;
}

function truncateUtf8(value: string, maxBytes = MAX_INDEX_BYTES) {
  const buffer = Buffer.from(value, "utf8");
  return buffer.length <= maxBytes ? value : buffer.subarray(0, maxBytes).toString("utf8").replace(/\uFFFD$/, "");
}

async function excludeEncryptedIndex(ref: FirebaseFirestore.DocumentReference, data: FirebaseFirestore.DocumentData | undefined, projectId: string, folderId: string | null) {
  const folders = data?.encrypted === true ? [] : await listProjectFolders(projectId);
  const topLevelId = folderTopLevelId(folderId, buildTopLevelFolderMap(folders));
  if (data?.encrypted !== true && !folders.some((folder) => folder.id === topLevelId && folder.encrypted === true)) return false;
  await ref.set({
    aiIndexStatus: "encrypted",
    aiIndexUpdatedAt: FieldValue.serverTimestamp(),
    aiText: FieldValue.delete(),
    aiDescription: FieldValue.delete(),
    aiIndexProvider: FieldValue.delete(),
    aiIndexError: FieldValue.delete(),
  }, { merge: true });
  return true;
}

async function saveOrdinaryIndex<T extends string>(ref: FirebaseFirestore.DocumentReference, projectId: string, status: T, update: Record<string, unknown>) {
  return firestore.runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    const data = current.data();
    if (!current.exists || data?.projectId !== projectId || data.deletedAt) return "unavailable" as const;
    if (data.encrypted === true) {
      transaction.set(ref, {
        aiIndexStatus: "encrypted", aiIndexUpdatedAt: FieldValue.serverTimestamp(),
        aiText: FieldValue.delete(), aiDescription: FieldValue.delete(),
        aiIndexProvider: FieldValue.delete(), aiIndexError: FieldValue.delete(),
      }, { merge: true });
      return "encrypted" as const;
    }
    transaction.set(ref, { ...update, aiIndexStatus: status }, { merge: true });
    return status;
  });
}

export async function extractAssistantDocumentText(bytes: Buffer, fileName: string, contentType: string) {
  const name = fileName.toLocaleLowerCase();
  const type = contentType.toLocaleLowerCase();
  let text = "";
  if (type === DOCX_TYPE || name.endsWith(".docx")) {
    text = (await mammoth.extractRawText({ buffer: bytes })).value;
  } else if (type === PDF_TYPE || name.endsWith(".pdf")) {
    const parser = new PDFParse({ data: bytes });
    try { text = (await parser.getText()).text; }
    finally { await parser.destroy(); }
  }
  return truncateUtf8(text.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").trim());
}

export async function indexDocumentBytes(input: {
  projectId: string;
  documentId: string;
  bytes: Buffer;
  fileName: string;
  contentType: string;
  folderId: string | null;
}) {
  const ref = firestore.collection(DOCUMENTS).doc(input.documentId);
  const snapshot = await ref.get();
  const data = snapshot.data();
  if (!snapshot.exists || data?.projectId !== input.projectId || data.deletedAt) return { status: "unavailable" as const };
  const folderId = typeof data?.folderId === "string" ? data.folderId : input.folderId;
  if (await excludeEncryptedIndex(ref, data, input.projectId, folderId)) return { status: "encrypted" as const };
  if (!isAssistantDocument(input.fileName, input.contentType)) {
    const status = await saveOrdinaryIndex(ref, input.projectId, "unsupported", { aiIndexUpdatedAt: FieldValue.serverTimestamp(), aiText: FieldValue.delete(), aiDescription: FieldValue.delete() });
    return { status };
  }
  try {
    const text = await extractAssistantDocumentText(input.bytes, input.fileName, input.contentType);
    const status = text ? "ready" : "empty";
    const savedStatus = await saveOrdinaryIndex(ref, input.projectId, status, {
      aiText: text || FieldValue.delete(),
      aiDescription: buildDocumentDescription(input.fileName, text),
      aiIndexProvider: "local-text",
      aiIndexError: FieldValue.delete(),
      aiIndexUpdatedAt: FieldValue.serverTimestamp(),
    });
    return { status: savedStatus };
  } catch (error) {
    const status = await saveOrdinaryIndex(ref, input.projectId, "failed", { aiIndexError: error instanceof Error ? error.message.slice(0, 500) : "Indexing failed", aiIndexUpdatedAt: FieldValue.serverTimestamp() });
    return { status };
  }
}

export async function refreshDocumentIndex(projectId: string, documentId: string) {
  const ref = firestore.collection(DOCUMENTS).doc(documentId);
  const snapshot = await ref.get();
  const data = snapshot.data();
  if (!snapshot.exists || data?.projectId !== projectId || data?.deletedAt) return null;
  const folderId = typeof data.folderId === "string" ? data.folderId : null;
  if (await excludeEncryptedIndex(ref, data, projectId, folderId)) return "encrypted";
  if (!isAssistantDocument(String(data.fileName || ""), String(data.contentType || ""))) return null;
  if (!projectBucket || !data.objectKey) return String(data.aiIndexStatus || "unavailable");
  const [bytes] = await projectBucket.file(String(data.objectKey)).download();
  return (await indexDocumentBytes({ projectId, documentId, bytes, fileName: String(data.fileName || "document"), contentType: String(data.contentType || "application/octet-stream"), folderId })).status;
}

export async function updateDocumentIndexFolder(projectId: string, documentId: string, folderId: string | null) {
  const ref = firestore.collection(DOCUMENTS).doc(documentId);
  const snapshot = await ref.get();
  const data = snapshot.data();
  if (snapshot.exists && data?.projectId === projectId && !await excludeEncryptedIndex(ref, data, projectId, folderId))
    await ref.set({ aiIndexUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

export async function removeDocumentIndex(projectId: string, documentId: string) {
  const ref = firestore.collection(DOCUMENTS).doc(documentId);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data()?.projectId !== projectId) return;
  await ref.set({ aiIndexStatus: "deleted", aiText: FieldValue.delete(), aiDescription: FieldValue.delete(), aiIndexUpdatedAt: FieldValue.serverTimestamp(), aiIndexError: FieldValue.delete() }, { merge: true });
}

export type DocumentSearchResult = {
  documentId: string;
  name: string;
  score: number;
  excerpt: string;
  description: string;
  citation: AssistantCitation;
};

const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();

function bestExcerpt(text: string, query: string) {
  const cleanQuery = normalized(query).trim();
  const tokens = [...new Set(cleanQuery.split(/[^a-z0-9]+/).filter((token) => token.length >= 3))].slice(0, 20);
  let best = { score: 0, excerpt: text.slice(0, 1800) };
  for (let start = 0; start < text.length; start += 1400) {
    const excerpt = text.slice(start, start + 1800);
    const haystack = normalized(excerpt);
    let score = cleanQuery.length >= 4 && haystack.includes(cleanQuery) ? 30 : 0;
    for (const token of tokens) score += Math.min(haystack.split(token).length - 1, 6);
    if (score > best.score) best = { score, excerpt };
  }
  return best;
}

export async function searchPermittedDocuments(actor: MemberRecord, query: string): Promise<DocumentSearchResult[]> {
  if ((actor.role !== "admin" && !actor.permissions.documents) || !projectBucket) return [];
  const [snapshot, folders] = await Promise.all([
    firestore.collection(DOCUMENTS).where("projectId", "==", actor.projectId).get(),
    listProjectFolders(actor.projectId),
  ]);
  const topLevelMap = buildTopLevelFolderMap(folders);
  const permitted = snapshot.docs.filter((document) => {
    const data = document.data();
    if (data.deletedAt || data.encrypted === true || !isAssistantDocument(String(data.fileName || ""), String(data.contentType || ""))) return false;
    const folderId = typeof data.folderId === "string" ? data.folderId : null;
    const topLevelId = folderTopLevelId(folderId, topLevelMap);
    return !folders.some((folder) => folder.id === topLevelId && folder.encrypted === true)
      && canAccessFolder(actor, folderId, topLevelId);
  });
  const output: DocumentSearchResult[] = [];
  for (const document of permitted.slice(0, 40)) {
    let data = document.data();
    if (typeof data.aiText !== "string" && data.objectKey) {
      try {
        const [bytes] = await projectBucket.file(String(data.objectKey)).download();
        await indexDocumentBytes({ projectId: actor.projectId, documentId: document.id, bytes, fileName: String(data.fileName || "document"), contentType: String(data.contentType || "application/octet-stream"), folderId: typeof data.folderId === "string" ? data.folderId : null });
        data = (await document.ref.get()).data() || data;
      } catch { continue; }
    }
    const text = typeof data.aiText === "string" ? data.aiText : "";
    const description = String(data.description || data.aiDescription || "").trim();
    if (!text && !description) continue;
    const match = bestExcerpt(`${String(data.fileName || "Document")}\n${description}\n${text}`, query);
    if (match.score <= 0) continue;
    const name = String(data.fileName || "Document");
    output.push({
      documentId: document.id,
      name,
      score: match.score,
      excerpt: match.excerpt,
      description,
      citation: { id: `document:${document.id}`, kind: "document", documentId: document.id, label: name, href: `/api/files?id=${encodeURIComponent(document.id)}&preview=${name.toLowerCase().endsWith(".docx") ? "docx" : "pdf"}` },
    });
  }
  return output.sort((a, b) => b.score - a.score).slice(0, 8);
}
