import { NextResponse } from "next/server";
import { requireApproved } from "@/lib/auth";
import { runAssistantTurn } from "@/lib/assistant-service";
import { RunConflict } from "@/lib/assistant-run-store";
import { ragEnabled } from "@/lib/rag-sources";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const actor = await requireApproved();
  if (!actor || actor.anonymousLink || (ragEnabled(actor.projectId) && !actor.projectMembershipVerified)) return NextResponse.json({ error: "Project access required" }, { status: 403 });
  const form = request.headers.get("content-type")?.startsWith("multipart/form-data")
    ? await request.formData().catch(() => null) : null;
  const attachment = form?.get("attachment");
  const body = (form ? Object.fromEntries(form) : await request.json().catch(() => null)) as {
    projectId?: string; conversationId?: string; message?: string; language?: "en" | "es"; selection?: string;
  } | null;
  if (!body?.message || typeof body.message !== "string") return NextResponse.json({ error: "Message is required" }, { status: 400 });
  if (body.projectId !== undefined && body.projectId !== actor.projectId) return NextResponse.json({ error: "The active project changed" }, { status: 409 });
  const encoder = new TextEncoder();
  const event = (type: string, data: unknown) => encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  let canceled = false;
  const stream = new ReadableStream({
    start(controller) {
      let knownConversation: string | null = null;
      const emitConversation = (id: string) => {
        if (knownConversation === id || canceled || request.signal.aborted) return;
        knownConversation = id;
        controller.enqueue(event("conversation", { id }));
      };
      controller.enqueue(event("status", { state: "thinking" }));
      void runAssistantTurn(actor, { conversationId: body.conversationId, message: body.message!, language: body.language, ...(body.selection ? { selection: body.selection } : {}), ...(attachment instanceof File ? { file: attachment, onConversation: emitConversation } : {}) }, (state) => {
        if (!canceled && !request.signal.aborted) controller.enqueue(event("status", { state }));
      }).then((result) => {
        if (canceled || request.signal.aborted) return;
        emitConversation(result.conversationId);
        controller.enqueue(event("text_delta", { delta: result.text }));
        for (const citation of result.citations) controller.enqueue(event("citation", citation));
        if (result.run !== undefined) controller.enqueue(event("run", { run: result.run }));
        if (result.actions?.length) controller.enqueue(event("actions", { actions: result.actions }));
        if (result.view) controller.enqueue(event("view", result.view));
        if (result.proposal) controller.enqueue(event("proposal", result.proposal));
        controller.enqueue(event("done", { messageId: result.assistantMessageId, language: result.language }));
        controller.close();
      }).catch((error) => {
        if (canceled || request.signal.aborted) return;
        const message = error instanceof RunConflict || (error instanceof Error && error.message === "gemini_not_configured") ? error.message : "Assistant unavailable";
        controller.enqueue(event("error", { message }));
        controller.close();
      });
    },
    cancel() { canceled = true; },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
