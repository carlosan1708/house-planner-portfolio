import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { firestore } from "./firebase-admin";
import { DOCUMENTS, QUOTE_ANALYSES } from "./project";
import { ragJob, ragProject, writeRagJob } from "./rag-jobs";
import { documentKey, quoteKey, ragFolderState, resolveRagSource } from "./rag-sources";
import { storedQuoteFiles } from "./quote-context";

export const ragBackfillRef = (projectId: string) => ragProject(projectId).collection("operations").doc("backfill");
type Backfill = {
  mode: "inventory" | "enqueue";
  status: "running" | "complete";
  collection: typeof DOCUMENTS | typeof QUOTE_ANALYSES;
  cursor: string | null;
  scanned: number;
  eligible: number;
  queued: number;
};

export async function startRagBackfill(projectId: string, mode: Backfill["mode"]) {
  const ref = ragBackfillRef(projectId);
  return firestore.runTransaction(async (transaction) => {
    const previous = (await transaction.get(ref)).data() as Backfill | undefined;
    if (previous?.status === "running") return false;
    if (mode === "enqueue" && !previous) return false;
    transaction.set(ref, {
      mode, status: "running", collection: DOCUMENTS, cursor: null, scanned: 0, eligible: 0, queued: 0,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
}

export async function advanceRagBackfill(projectId: string) {
  const ref = ragBackfillRef(projectId);
  if ((await ref.get()).data()?.status !== "running") return;
  const folders = await ragFolderState(projectId);
  return firestore.runTransaction(async (transaction) => {
    const current = (await transaction.get(ref)).data() as Backfill | undefined;
    if (!current || current.status !== "running") return;
    let query = firestore.collection(current.collection).where("projectId", "==", projectId).orderBy(FieldPath.documentId()).limit(25);
    if (current.cursor) query = query.startAfter(current.cursor);
    const page = await transaction.get(query);
    const sources = page.docs.flatMap((item) => {
      const data = item.data();
      const keys = current.collection === DOCUMENTS ? [documentKey(item.id)]
        : storedQuoteFiles(data).map((_, index) => quoteKey(item.id, index));
      return keys.filter((key) => resolveRagSource(projectId, key, data, folders));
    });
    let queued = 0;
    if (current.mode === "enqueue" && sources.length) {
      const existing = await transaction.getAll(...sources.map((key) => ragJob(projectId, key)));
      sources.forEach((key, index) => {
        if (existing[index].exists) return;
        writeRagJob(transaction, projectId, key, { history: true });
        queued += 1;
      });
    }
    const exhausted = page.size < 25;
    transaction.update(ref, {
      status: exhausted && current.collection === QUOTE_ANALYSES ? "complete" : "running",
      collection: exhausted ? QUOTE_ANALYSES : current.collection,
      cursor: exhausted ? null : page.docs.at(-1)!.id,
      scanned: current.scanned + page.size,
      eligible: current.eligible + sources.length,
      queued: current.queued + queued,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}
