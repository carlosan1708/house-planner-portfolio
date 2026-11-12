import { requireApproved } from "@/lib/auth";
import { firestore } from "@/lib/firebase-admin";
import { ragJob, ragStatusForSource, writeRagJob, type RagJob } from "@/lib/rag-jobs";
import { canReadRagSource, ragEnabled, ragFolderState, ragSourceRef, resolveRagSource, validRagKey, type RagKey } from "@/lib/rag-sources";

export const runtime = "nodejs";

const reply = (data: object, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

async function handle(request: Request, change: boolean) {
  const actor = await requireApproved();
  if (!actor) return reply({ error: "Project access required" }, 403);
  const params = new URL(request.url).searchParams;
  const input = change ? await request.json().catch(() => null) : Object.fromEntries(params);
  if (!input || typeof input.id !== "string" || (input.projectId && input.projectId !== actor.projectId))
    return reply({ error: "Invalid attachment" }, 400);
  const key: RagKey = { kind: input.kind ?? "document", id: input.id, index: Number(input.index ?? 0) };
  if (!validRagKey(key)) return reply({ error: "Invalid attachment" }, 400);
  if (!ragEnabled(actor.projectId)) return reply({ status: "disabled" });
  if (!actor.projectMembershipVerified) return reply({ error: "Project membership required" }, 403);
  const ref = ragSourceRef(key);
  const jobRef = ragJob(actor.projectId, key);
  const [folders, record, job] = await Promise.all([ragFolderState(actor.projectId), ref.get(), jobRef.get()]);
  const source = resolveRagSource(actor.projectId, key, record.data(), folders, true);
  if (!source || !canReadRagSource(actor, source, folders)) return reply({ error: "Attachment not found" }, 404);
  const canRetry = actor.role !== "viewer";
  const status = source.format === "unsupported" ? "unsupported" : ragStatusForSource(job.data() as RagJob | undefined, source);
  if (!change || input.action === "status") return reply({ status, canRetry });
  if (input.action !== "index") return reply({ error: "Invalid indexing action" }, 400);
  if (!canRetry) return reply({ error: "Editor access required" }, 403);
  if (status === "unsupported") return reply({ status, canRetry: false }, 415);
  const queued = await firestore.runTransaction(async (transaction) => {
    const [current, currentJob] = await transaction.getAll(ref, jobRef);
    if (!current.updateTime || !record.updateTime?.isEqual(current.updateTime) || currentJob.exists !== job.exists ||
      (currentJob.updateTime && !job.updateTime?.isEqual(currentJob.updateTime)))
      return false;
    if (status === "indexing" || (status === "pending" && currentJob.exists)) return false;
    writeRagJob(transaction, actor.projectId, key, { cleanup: currentJob.exists });
    return true;
  });
  return queued ? reply({ status: "pending", canRetry }, 202) : reply({ error: "Attachment or index state changed" }, 409);
}

export const GET = (request: Request) => handle(request, false);
export const POST = (request: Request) => handle(request, true);
