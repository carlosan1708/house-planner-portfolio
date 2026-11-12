import { randomUUID } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { firestore } from "./firebase-admin";
import { ragEnabled, ragJobId, type RagKey, type RagSource } from "./rag-sources";

export const RAG_JOBS = "assistantRagJobs";
export const RAG_CHUNKS = "assistantRagChunks";
const RAG_PROJECTS = "housePlannerAssistantRag";
export const ragProject = (projectId: string) => firestore.collection(RAG_PROJECTS).doc(projectId);
export const ragJobs = (projectId: string) => ragProject(projectId).collection(RAG_JOBS);
export const ragChunks = (projectId: string) => ragProject(projectId).collection(RAG_CHUNKS);
export const ragJob = (projectId: string, key: RagKey) => ragJobs(projectId).doc(ragJobId(projectId, key));

export type RagStatus = "pending" | "indexing" | "ready" | "empty" | "unsupported" | "failed";
type Writer = { set(ref: FirebaseFirestore.DocumentReference, data: FirebaseFirestore.DocumentData): unknown };
export type RagJob = {
  projectId: string;
  key: RagKey;
  version: string;
  status: RagStatus;
  priority: "upload" | "history";
  dueAt?: FirebaseFirestore.Timestamp;
  lease?: string;
  cleanup?: boolean;
  purge?: boolean;
  attempts: number;
  page: number;
  offset: number;
  chunkCount: number;
  pageText?: string;
  totalPages?: number;
  objectKey?: string;
  scope?: string;
};

export function writeRagJob(writer: Writer, projectId: string, key: RagKey, options: { history?: boolean; cleanup?: boolean; purge?: boolean } = {}) {
  if (!ragEnabled(projectId)) return;
  writer.set(ragJob(projectId, key), {
    projectId, key, version: randomUUID(), status: "pending", priority: options.history ? "history" : "upload",
    dueAt: Timestamp.now(), attempts: 0, page: 1, offset: 0, chunkCount: 0,
    cleanup: Boolean(options.cleanup || options.purge), purge: Boolean(options.purge),
  } satisfies RagJob);
}

export function ragSourceMatches(job: RagJob, source: RagSource) {
  return job.objectKey === source.objectKey && job.scope === source.scope;
}

export function ragStatusForSource(job: RagJob | undefined, source: RagSource): RagStatus {
  if (!job || job.purge || (job.objectKey && !ragSourceMatches(job, source))) return "pending";
  return job.status;
}

export const clearRagLease = () => ({ lease: FieldValue.delete() });
