import { NextResponse } from "next/server";
import { requireApproved } from "@/lib/auth";
import { getAssistantConversation, runAssistantTurn } from "@/lib/assistant-service";
import { respondToRun, type RunResponse } from "@/lib/assistant-run";
import { agentId, checkpoint, conversationRef, readRun, RunConflict } from "@/lib/assistant-run-store";
import { respondToImageRun } from "@/lib/assistant-image-run";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const actor = await requireApproved();
  if (!actor?.projectMembershipVerified || actor.anonymousLink) return NextResponse.json({ error: "project_access_required" }, { status: 403 });
  const input = await request.json().catch(() => null) as (RunResponse & { conversationId: string; projectId?: string }) | null;
  if (!input || !agentId(input.conversationId) || !agentId(input.id) || !Number.isSafeInteger(input.revision) ||
    !["answer", "approve", "retry", "continue", "cancel", "save"].includes(input.action) ||
    (input.answer !== undefined && typeof input.answer !== "string") ||
    (input.fields !== undefined && (!input.fields || typeof input.fields !== "object" || Array.isArray(input.fields)))) {
    return NextResponse.json({ error: "invalid_run_request" }, { status: 400 });
  }
  if (input.projectId && input.projectId !== actor.projectId) return NextResponse.json({ error: "project_changed" }, { status: 409 });
  const thread = conversationRef(input.conversationId);
  try {
    const current = await readRun(thread);
    if (current?.image) {
      await respondToImageRun(actor, thread, input);
      return NextResponse.json({ conversation: await getAssistantConversation(actor, thread.id) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const run = await respondToRun(actor, thread, input);
    let view = null;
    const shouldPlan = run.status === "planning" || (run.status === "ready" && !run.pending?.question && !run.action);
    if (shouldPlan) {
      const planning = run.status === "planning" ? run : await respondToRun(actor, thread, { id: run.id, revision: run.revision, action: "continue" });
      try {
        const result = await runAssistantTurn(actor, { conversationId: thread.id, message: planning.goal, language: planning.language, resume: planning, ...(input.action === "answer" && planning.answer ? { resumeResponse: planning.answer } : {}) });
        view = result.view || null;
      } catch {
        await checkpoint(thread, actor, planning, { status: "ready", pending: { kind: "continue", question: "" } }).catch(() => undefined);
      }
    }
    return NextResponse.json({ conversation: await getAssistantConversation(actor, thread.id), view }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof RunConflict) {
      const status = error.message === "conversation_not_found" ? 404 : error.message.endsWith("access_required") ? 403 : 409;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: "run_unavailable" }, { status: 503 });
  }
}
