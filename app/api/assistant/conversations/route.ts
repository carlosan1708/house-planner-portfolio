import { NextResponse } from "next/server";
import { requireApproved } from "@/lib/auth";
import { deleteAssistantConversation, getAssistantConversation, listAssistantConversations } from "@/lib/assistant-service";
import { ragEnabled } from "@/lib/rag-sources";

export async function GET(request: Request) {
  const actor = await requireApproved();
  if (!actor || actor.anonymousLink || (ragEnabled(actor.projectId) && !actor.projectMembershipVerified)) return NextResponse.json({ error: "Project access required" }, { status: 403 });
  try {
    const params = new URL(request.url).searchParams;
    const project = params.get("project");
    if (project && project !== actor.projectId) return NextResponse.json({ error: "The active project changed" }, { status: 409 });
    const id = params.get("id");
    return NextResponse.json(id ? { conversation: await getAssistantConversation(actor, id) } : { conversations: await listAssistantConversations(actor) },
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Assistant history unavailable";
    return NextResponse.json({ error: "Assistant history unavailable" }, { status: message === "conversation_not_found" ? 404 : 503 });
  }
}

export async function DELETE(request: Request) {
  const actor = await requireApproved();
  if (!actor?.projectMembershipVerified || actor.anonymousLink) return NextResponse.json({ error: "Project access required" }, { status: 403 });
  const params = new URL(request.url).searchParams;
  if (params.get("project") && params.get("project") !== actor.projectId) return NextResponse.json({ error: "The active project changed" }, { status: 409 });
  try {
    await deleteAssistantConversation(actor, params.get("id") || "");
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const missing = error instanceof Error && error.message === "conversation_not_found";
    return NextResponse.json({ error: missing ? "Conversation not found" : "Conversation could not be deleted" }, { status: missing ? 404 : 503 });
  }
}
