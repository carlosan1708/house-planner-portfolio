import { NextResponse } from "next/server";
import { requireApproved } from "@/lib/auth";
import { getAssistantConversation, listAssistantConversations } from "@/lib/assistant-service";

export async function GET(request: Request) {
  const actor = await requireApproved();
  if (!actor || actor.anonymousLink) return NextResponse.json({ error: "Project account access required" }, { status: 403 });
  try {
    const id = new URL(request.url).searchParams.get("id");
    return NextResponse.json(id ? { conversation: await getAssistantConversation(actor, id) } : { conversations: await listAssistantConversations(actor) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Assistant history unavailable";
    return NextResponse.json({ error: message }, { status: message === "conversation_not_found" ? 404 : 503 });
  }
}
