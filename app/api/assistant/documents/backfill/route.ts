import { requireApproved } from "@/lib/auth";
import { ragBackfillRef, startRagBackfill } from "@/lib/rag-backfill";
import { RAG_JOBS, ragProject } from "@/lib/rag-jobs";
import { ragEnabled } from "@/lib/rag-sources";

export const runtime = "nodejs";

export async function GET() {
  const actor = await requireApproved(["admin"]);
  if (!actor?.projectMembershipVerified || !ragEnabled(actor.projectId)) return Response.json({ error: "Index administration unavailable" }, { status: 403 });
  const statuses = ["pending", "indexing", "ready", "empty", "failed"] as const;
  const jobs = ragProject(actor.projectId).collection(RAG_JOBS);
  const [backfill, ...counts] = await Promise.all([
    ragBackfillRef(actor.projectId).get(),
    ...statuses.map((status) => jobs.where("status", "==", status).count().get()),
  ] as const);
  return Response.json({
    backfill: backfill.data() ?? null,
    counts: Object.fromEntries(statuses.map((status, index) => [status, counts[index].data().count])),
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const actor = await requireApproved(["admin"]);
  if (!actor?.projectMembershipVerified || !ragEnabled(actor.projectId)) return Response.json({ error: "Index administration unavailable" }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (body?.projectId !== actor.projectId || (body.mode !== "inventory" && body.mode !== "enqueue"))
    return Response.json({ error: "The active project and a valid mode are required" }, { status: 400 });
  if (!await startRagBackfill(actor.projectId, body.mode))
    return Response.json({ error: "Complete the inventory before starting another operation" }, { status: 409 });
  return Response.json({ status: "running" }, { status: 202 });
}
