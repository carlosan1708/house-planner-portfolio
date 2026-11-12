import { randomUUID } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { GoogleAuth } from "google-auth-library";
import { PDFParse } from "pdf-parse";
import sharp from "sharp";
import { extractAssistantDocumentText } from "./document-index";
import { firestore, projectBucket } from "./firebase-admin";
import { geminiClient } from "./gemini";
import { clearRagLease, ragChunks, ragJobs, ragSourceMatches, type RagJob } from "./rag-jobs";
import { ragFolderState, ragSourceRef, resolveRagSource, validRagKey, type RagSource } from "./rag-sources";

const vision = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
const maxBytes = 25 * 1024 * 1024;
const chunkSize = 1400;
const chunkOverlap = 180;
const chunksPerStep = 6;
const leaseMs = 240_000;

export async function ragEmbedding(text: string, taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY") {
  const result = await geminiClient().models.embedContent({
    model: "gemini-embedding-001",
    contents: text,
    config: { taskType, outputDimensionality: 768, autoTruncate: false, httpOptions: { timeout: 12_000 } },
  });
  const values = result.embeddings?.[0]?.values;
  if (!values || values.length !== 768 || !values.every(Number.isFinite) || !values.some((value) => value !== 0))
    throw new Error("invalid_embedding");
  return values;
}

async function imageOcr(bytes: Uint8Array) {
  const image = await sharp(bytes, { limitInputPixels: 50_000_000 }).rotate()
    .resize(3200, 3200, { fit: "inside", withoutEnlargement: true }).flatten({ background: "white" }).jpeg({ quality: 88 }).toBuffer();
  const result = await vision.request<{ responses?: Array<{ fullTextAnnotation?: { text?: string }; error?: { code: number } }> }>({
    method: "POST",
    url: "https://vision.googleapis.com/v1/images:annotate",
    timeout: 15_000,
    data: { requests: [{ image: { content: image.toString("base64") }, features: [{ type: "DOCUMENT_TEXT_DETECTION" }] }] },
  });
  const response = result.data.responses?.[0];
  if (!response || response.error) throw new Error("ocr_failed");
  return response.fullTextAnnotation?.text ?? "";
}

async function readPage(bytes: Buffer, source: RagSource, page: number) {
  if (source.format === "docx") return { text: await extractAssistantDocumentText(bytes, source.name, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", null), total: 1 };
  if (source.format === "image") return { text: await imageOcr(bytes), total: 1 };
  const pdf = new PDFParse({ data: bytes });
  try {
    const result = await pdf.getText({ partial: [page] });
    const text = result.pages[0]?.text ?? "";
    if (text.replace(/\s/g, "").length >= 40) return { text, total: result.total };
    const rendered = await pdf.getScreenshot({ partial: [page], desiredWidth: 2400, imageDataUrl: false, imageBuffer: true });
    const image = rendered.pages[0]?.data;
    if (!image) throw new Error("pdf_page_render_failed");
    return { text: await imageOcr(image) || text, total: result.total };
  } finally {
    await pdf.destroy();
  }
}

export function ragTextSlice(text: string, offset: number) {
  const chunks: Array<{ offset: number; text: string }> = [];
  for (let count = 0; count < chunksPerStep && offset < text.length; count += 1) {
    const end = Math.min(offset + chunkSize, text.length);
    const boundary = end < text.length ? text.lastIndexOf(" ", end) : end;
    const stop = boundary > offset + chunkSize / 2 ? boundary : end;
    const excerpt = text.slice(offset, stop).trim();
    if (excerpt) chunks.push({ offset, text: excerpt });
    offset = stop >= text.length ? text.length : stop - chunkOverlap;
  }
  return { chunks, offset };
}

type JobRef = FirebaseFirestore.DocumentReference;

async function claim(ref: JobRef, projectId: string) {
  return firestore.runTransaction(async (transaction) => {
    const job = (await transaction.get(ref)).data() as RagJob | undefined;
    if (!job || job.projectId !== projectId || !job.dueAt || job.dueAt.toMillis() > Date.now()) return null;
    if (job.attempts >= 4 && !job.cleanup) {
      transaction.update(ref, { status: "failed", dueAt: FieldValue.delete(), pageText: FieldValue.delete(), ...clearRagLease() });
      return null;
    }
    const lease = randomUUID();
    transaction.update(ref, { status: "indexing", lease, dueAt: Timestamp.fromMillis(Date.now() + leaseMs), attempts: job.attempts + 1 });
    return { ...job, lease, attempts: job.attempts + 1 };
  });
}

async function commitStep(ref: JobRef, job: RagJob, write: (transaction: FirebaseFirestore.Transaction) => Promise<void> | void) {
  return firestore.runTransaction(async (transaction) => {
    const current = (await transaction.get(ref)).data() as RagJob | undefined;
    if (current?.version !== job.version || current.lease !== job.lease) return false;
    await write(transaction);
    return true;
  });
}

const nextStep = () => ({ dueAt: Timestamp.now(), attempts: 0, ...clearRagLease() });

function queuePurge(transaction: FirebaseFirestore.Transaction, ref: JobRef, status: "unsupported" | "pending") {
  transaction.update(ref, { status, cleanup: true, purge: true, pageText: FieldValue.delete(), ...nextStep() });
}

function restartChangedSource(transaction: FirebaseFirestore.Transaction, ref: JobRef) {
  transaction.update(ref, {
    status: "pending", cleanup: true, version: randomUUID(), objectKey: FieldValue.delete(),
    scope: FieldValue.delete(), pageText: FieldValue.delete(), totalPages: FieldValue.delete(),
    page: 1, offset: 0, chunkCount: 0, ...nextStep(),
  });
}

async function cleanChunks(ref: JobRef, job: RagJob) {
  await commitStep(ref, job, async (transaction) => {
    const chunks = await transaction.get(ragChunks(job.projectId).where("jobId", "==", ref.id).limit(150));
    for (const chunk of chunks.docs) transaction.delete(chunk.ref);
    if (chunks.size === 150) transaction.update(ref, nextStep());
    else if (job.purge) transaction.delete(ref);
    else transaction.update(ref, { cleanup: false, ...nextStep() });
  });
}

async function processStep(ref: JobRef, job: RagJob) {
  if (job.cleanup) return cleanChunks(ref, job);
  if (!validRagKey(job.key)) throw new Error("invalid_source");
  const sourceRef = ragSourceRef(job.key);
  const [snapshot, folders] = await Promise.all([sourceRef.get(), ragFolderState(job.projectId)]);
  const source = resolveRagSource(job.projectId, job.key, snapshot.data(), folders);
  if (!source) {
    await commitStep(ref, job, (transaction) => queuePurge(transaction, ref, "unsupported"));
    return;
  }
  if (job.objectKey && !ragSourceMatches(job, source)) {
    await commitStep(ref, job, (transaction) => restartChangedSource(transaction, ref));
    return;
  }
  let pageText = job.pageText;
  let total = job.totalPages ?? 1;
  if (pageText === undefined) {
    if (!projectBucket) throw new Error("storage_unavailable");
    const file = projectBucket.file(source.objectKey);
    const [metadata] = await file.getMetadata();
    if (Number(metadata.size) > maxBytes) throw new Error("file_too_large");
    const [bytes] = await projectBucket.file(source.objectKey, { generation: String(metadata.generation) }).download();
    if (!bytes.length || bytes.length > maxBytes) throw new Error("invalid_file_size");
    const page = await readPage(bytes, source, job.page);
    pageText = page.text.replace(/\u0000/g, "").trim();
    if (Buffer.byteLength(pageText) > 700_000) throw new Error("page_text_too_large");
    total = page.total;
  }
  const slice = ragTextSlice(pageText, job.offset);
  const vectors = await Promise.all(slice.chunks.map((chunk) => ragEmbedding(chunk.text, "RETRIEVAL_DOCUMENT")));
  const pageDone = slice.offset >= pageText.length;
  const finished = pageDone && job.page >= total;
  const chunkCount = job.chunkCount + slice.chunks.length;
  const currentFolders = await ragFolderState(job.projectId);
  await commitStep(ref, job, async (transaction) => {
    const current = resolveRagSource(job.projectId, job.key, (await transaction.get(sourceRef)).data(), currentFolders);
    if (!current) {
      queuePurge(transaction, ref, "unsupported");
      return;
    }
    if (current.objectKey !== source.objectKey || current.scope !== source.scope) {
      restartChangedSource(transaction, ref);
      return;
    }
    for (const [index, chunk] of slice.chunks.entries()) {
      transaction.set(ragChunks(job.projectId).doc(`${ref.id}-${job.version}-${job.page}-${chunk.offset}`), {
        jobId: ref.id, projectId: job.projectId, version: job.version, section: source.section, scope: source.scope,
        page: source.format === "pdf" ? job.page : null, text: chunk.text, embedding: FieldValue.vector(vectors[index]),
      });
    }
    transaction.update(ref, {
      ...nextStep(), objectKey: source.objectKey, scope: source.scope, chunkCount, totalPages: total,
      page: pageDone ? job.page + 1 : job.page, offset: pageDone ? 0 : slice.offset,
      pageText: pageDone ? FieldValue.delete() : pageText,
      status: finished ? (chunkCount ? "ready" : "empty") : "indexing",
      ...(finished ? { dueAt: FieldValue.delete() } : {}),
    });
  });
}

export async function processRagProject(projectId: string, deadline: number) {
  const counts = { steps: 0, errors: 0 };
  for (const priority of ["upload", "history"]) {
    if (Date.now() >= deadline) break;
    const due = await ragJobs(projectId).where("priority", "==", priority).where("dueAt", "<=", Timestamp.now()).orderBy("dueAt").limit(4).get();
    for (const item of due.docs) {
      if (Date.now() >= deadline) return counts;
      const job = await claim(item.ref, projectId);
      if (!job) continue;
      try {
        await processStep(item.ref, job);
        counts.steps += 1;
      } catch {
        counts.errors += 1;
        await commitStep(item.ref, job, (transaction) => {
          const failed = job.attempts >= 4 && !job.cleanup;
          transaction.update(item.ref, {
            ...clearRagLease(), status: failed ? "failed" : "pending",
            dueAt: failed ? FieldValue.delete() : Timestamp.fromMillis(Date.now() + Math.min(900, 15 * 2 ** job.attempts) * 1000),
            ...(failed ? { pageText: FieldValue.delete() } : {}),
          });
        });
      }
    }
  }
  return counts;
}
