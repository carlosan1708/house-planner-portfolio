import { createHash } from "node:crypto";
import type { AssistantCitation } from "./assistant";
import { firestore } from "./firebase-admin";
import { ragChunks, ragJobs, ragSourceMatches, type RagJob } from "./rag-jobs";
import { ragEmbedding } from "./rag-processing";
import { canReadRagSource, documentKey, ragEnabled, ragFolderState, ragJobId, ragScope, ragSourceRef, resolveRagSource, validRagKey, type RagKey, type RagSource } from "./rag-sources";
import type { MemberRecord } from "./project";

export type RagCitationSource = RagKey & { revision: string };
const revision = (source: RagSource) => createHash("sha256").update(source.objectKey).digest("hex");
export const assistantSourceToken = (citation: AssistantCitation) => JSON.stringify([citation.id, citation.source?.revision ?? null]);

function sourceCitation(projectId: string, source: RagSource, page: number | null): AssistantCitation {
  const id = encodeURIComponent(source.key.id);
  const fileUrl = source.key.kind === "quote" ? `/api/quotes?id=${id}&file=1&index=${source.key.index}`
    : `/api/files?id=${id}&preview=${source.format}`;
  return {
    id: `${source.key.kind}:${source.key.id}:${source.key.index}${page ? `:${page}` : ""}`,
    kind: "document",
    ...(source.key.kind === "document" ? { documentId: source.key.id } : {}),
    label: page ? `${source.name} · p. ${page}` : source.name,
    href: `${fileUrl}&project=${encodeURIComponent(projectId)}${page ? `#page=${page}` : ""}`,
    source: { ...source.key, revision: revision(source) },
  };
}

type Chunk = { jobId: string; projectId: string; version: string; section: string; scope: string; page: number | null; text: string; distance: number };

export async function searchRagDocuments(actor: MemberRecord, query: string, sectionFilter?: string) {
  try {
    return await findRagDocuments(actor, query, sectionFilter);
  } catch {
    console.warn("Assistant document retrieval failed");
    return { status: "unavailable" as const, results: [] };
  }
}

async function findRagDocuments(actor: MemberRecord, query: string, sectionFilter?: string) {
  const sections = (["quotes", "expenses", "documents"] as const).filter((section) => (!sectionFilter || section === sectionFilter) && (actor.role === "admin" || actor.permissions[section]));
  if (!sections.length || actor.status !== "approved" || !actor.projectMembershipVerified) return { status: "empty" as const, results: [] };
  if (!ragEnabled(actor.projectId)) return { status: "unavailable" as const, results: [] };
  const clean = query.trim().slice(0, 800);
  if (!clean) return { status: "empty" as const, results: [] };
  const collection = ragChunks(actor.projectId);
  const folders = await ragFolderState(actor.projectId);
  const queries: FirebaseFirestore.Query[] = [];
  for (const section of sections) {
    if (section !== "documents" || actor.role === "admin" || actor.folderAccess.mode === "all") {
      queries.push(collection.where("section", "==", section));
      continue;
    }
    const allowedTop = new Set(actor.folderAccess.folderIds);
    const scopes = [...folders.topLevels].filter(([folderId, root]) => root && allowedTop.has(root) && !folders.encrypted.has(folderId) && root !== folders.invoiceFolderId)
      .map(([folderId]) => ragScope("documents", folderId));
    if (actor.folderAccess.allowUnfiled) scopes.push(ragScope("documents", null));
    for (let start = 0; start < scopes.length; start += 30) {
      queries.push(collection.where("scope", "in", scopes.slice(start, start + 30)));
    }
  }
  if (!queries.length) return { status: "empty" as const, results: [] };
  const queryVector = await ragEmbedding(clean, "RETRIEVAL_QUERY");
  const snapshots = await Promise.all(queries.map((index) => index.findNearest({
    vectorField: "embedding", queryVector, limit: 30, distanceMeasure: "COSINE",
    distanceThreshold: 0.55, distanceResultField: "distance",
  }).get()));
  const candidates = snapshots.flatMap((snapshot) => snapshot.docs.map((doc) => doc.data() as Chunk))
    .filter((chunk) => chunk.projectId === actor.projectId && /^[a-f0-9]{64}$/.test(chunk.jobId))
    .sort((a, b) => a.distance - b.distance);
  const ids = [...new Set(candidates.map((item) => item.jobId))].slice(0, 75);
  if (!ids.length) return { status: "empty" as const, results: [] };
  const jobs = await firestore.getAll(...ids.map((id) => ragJobs(actor.projectId).doc(id)));
  const permitted = new Map<string, { source: RagSource; job: RagJob }>();
  const liveFolders = await ragFolderState(actor.projectId);
  await Promise.all(jobs.map(async (snap) => {
    const job = snap.data() as RagJob | undefined;
    if (!job || job.status !== "ready" || job.projectId !== actor.projectId || !validRagKey(job.key) || ragJobId(actor.projectId, job.key) !== snap.id) return;
    const data = (await ragSourceRef(job.key).get()).data();
    const source = resolveRagSource(actor.projectId, job.key, data, liveFolders);
    if (source && ragSourceMatches(job, source) && canReadRagSource(actor, source, liveFolders))
      permitted.set(snap.id, { source, job });
  }));
  const results = candidates.flatMap((chunk) => {
    const entry = permitted.get(chunk.jobId);
    if (!entry || entry.job.version !== chunk.version || entry.source.scope !== chunk.scope || entry.source.section !== chunk.section) return [];
    const citation = sourceCitation(actor.projectId, entry.source, chunk.page);
    return [{ citation, excerpt: chunk.text, page: chunk.page, name: entry.source.name, ...(entry.source.expenseReceiptId ? { expenseReceiptId: entry.source.expenseReceiptId } : {}) }];
  }).slice(0, 8);
  return { status: results.length ? "ready" as const : "empty" as const, results };
}

export async function readableAssistantSources(actor: MemberRecord, citations: AssistantCitation[]) {
  const documents = citations.filter((citation) => citation.kind === "document" &&
    (actor.projectMembershipVerified || (!citation.source && !ragEnabled(actor.projectId))));
  const folders = documents.length ? await ragFolderState(actor.projectId) : null;
  const allowed = new Set<string>();
  const records = new Map<string, Promise<FirebaseFirestore.DocumentSnapshot>>();
  await Promise.all(documents.map(async (citation) => {
    const key = citation.source || (citation.documentId ? documentKey(citation.documentId) : null);
    if (!folders || !key || !validRagKey(key)) return;
    const path = `${key.kind}/${key.id}`;
    if (!records.has(path)) records.set(path, ragSourceRef(key).get());
    const source = resolveRagSource(actor.projectId, key, (await records.get(path))?.data(), folders);
    if (source && canReadRagSource(actor, source, folders) && (!citation.source || citation.source.revision === revision(source)))
      allowed.add(assistantSourceToken(citation));
  }));
  return allowed;
}
