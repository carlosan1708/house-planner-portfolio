import { NextResponse } from "next/server";
import { requireApproved } from "@/lib/auth";
import { readAssistantImage, saveAssistantImage } from "@/lib/assistant-image-run";
import { planMember } from "@/lib/assistant-plan-sources";
import { agentId, conversationRef, RunConflict } from "@/lib/assistant-run-store";
import { projectBucket } from "@/lib/firebase-admin";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const unavailable = () => NextResponse.json({ error: "Image unavailable" }, { status: 404, headers });

export async function GET(request: Request) {
  const actor = await requireApproved();
  if (!actor || !planMember(actor)) return unavailable();
  const params = new URL(request.url).searchParams;
  const threadId = params.get("conversationId");
  const id = params.get("id");
  if (params.get("projectId") !== actor.projectId || !agentId(threadId) || !agentId(id)) return unavailable();
  const thread = conversationRef(threadId);
  try {
    const image = await readAssistantImage(actor, thread, id);
    if (!image || !projectBucket) return unavailable();
    const [bytes] = await projectBucket.file(image.objectKey).download();
    const current = await requireApproved();
    if (!current || current.uid !== actor.uid || current.projectId !== actor.projectId || !await readAssistantImage(current, thread, id)) return unavailable();
    return new Response(new Uint8Array(bytes), { headers: { ...headers, "Content-Type": "image/jpeg",
      "Content-Disposition": params.get("download") === "1" ? 'attachment; filename="house-planner-render.jpg"' : "inline" } });
  } catch {
    return unavailable();
  }
}

export async function POST(request: Request) {
  const actor = await requireApproved();
  if (!actor || !planMember(actor)) return unavailable();
  const body = await request.json().catch(() => null);
  if (!body || body.projectId !== actor.projectId || !agentId(body.conversationId) || !agentId(body.id) || !agentId(body.folderId)) return unavailable();
  try {
    const id = await saveAssistantImage(actor, conversationRef(body.conversationId), body.id, body.folderId);
    return NextResponse.json({ id }, { headers });
  } catch (error) {
    if (error instanceof RunConflict) return NextResponse.json({ error: error.message }, { status: error.message.endsWith("access_required") ? 403 : 409, headers });
    return NextResponse.json({ error: "Image unavailable" }, { status: 503, headers });
  }
}
