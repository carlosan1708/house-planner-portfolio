import { NextResponse } from "next/server";
import { requireApproved } from "@/lib/auth";
import { runAssistantTurn } from "@/lib/assistant-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const actor = await requireApproved();
  if (!actor || actor.anonymousLink) return NextResponse.json({ error: "Project account access required" }, { status: 403 });
  const body = await request.json().catch(() => null) as { conversationId?: string; message?: string; language?: "en" | "es" } | null;
  if (!body?.message || typeof body.message !== "string") return NextResponse.json({ error: "Message is required" }, { status: 400 });
  const encoder = new TextEncoder();
  const event = (type: string, data: unknown) => encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(event("status", { state: "thinking" }));
      void runAssistantTurn(actor, { conversationId: body.conversationId, message: body.message!, language: body.language }).then((result) => {
        controller.enqueue(event("conversation", { id: result.conversationId }));
        const chunks = result.text.match(/.{1,80}(?:\s|$)/g) || [result.text];
        for (const chunk of chunks) controller.enqueue(event("text_delta", { delta: chunk }));
        for (const citation of result.citations) controller.enqueue(event("citation", citation));
        if (result.proposal) controller.enqueue(event("proposal", result.proposal));
        controller.enqueue(event("done", { messageId: result.assistantMessageId, language: result.language }));
        controller.close();
      }).catch((error) => {
        controller.enqueue(event("error", { message: error instanceof Error ? error.message : "Assistant unavailable" }));
        controller.close();
      });
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
