import { NextResponse } from "next/server";
import { requireApproved } from "@/lib/auth";
import { acquireQaRun, normalizeQaRunId, normalizeQaRunSuite, qaRunStatus, releaseQaRun } from "@/lib/qa-run";

export const runtime = "nodejs";

export async function GET() {
  const actor = await requireApproved(["admin"]);
  if (!actor) return NextResponse.json({ error: "QA access required" }, { status: 403 });
  try { return NextResponse.json(await qaRunStatus(actor)); }
  catch { return NextResponse.json({ error: "QA access required" }, { status: 403 }); }
}

export async function POST(request: Request) {
  const actor = await requireApproved(["admin"]);
  if (!actor) return NextResponse.json({ error: "QA access required" }, { status: 403 });
  const body = await request.json().catch(() => null) as { runId?: unknown; suite?: unknown; aiMode?: unknown } | null;
  const runId = normalizeQaRunId(body?.runId);
  const suite = normalizeQaRunSuite(body?.suite);
  if (!runId || !suite) return NextResponse.json({ error: "Invalid QA run" }, { status: 400 });
  if (body?.aiMode !== undefined && body.aiMode !== "basic" && body.aiMode !== "disabled") return NextResponse.json({ error: "Invalid QA AI mode" }, { status: 400 });
  try { return NextResponse.json(await acquireQaRun(actor, runId, suite, body?.aiMode === "basic"), { status: 201 }); }
  catch (error) {
    const message = error instanceof Error ? error.message : "qa_run_failed";
    return NextResponse.json({ error: message }, { status: message === "qa_run_in_progress" ? 409 : 403 });
  }
}

export async function DELETE(request: Request) {
  const actor = await requireApproved(["admin"]);
  if (!actor) return NextResponse.json({ error: "QA access required" }, { status: 403 });
  const body = await request.json().catch(() => null) as { runId?: unknown } | null;
  const runId = normalizeQaRunId(body?.runId);
  if (!runId) return NextResponse.json({ error: "Invalid QA run" }, { status: 400 });
  try { return NextResponse.json({ released: await releaseQaRun(actor, runId) }); }
  catch { return NextResponse.json({ error: "QA access required" }, { status: 403 }); }
}
