import { NextResponse } from "next/server";
import { requireApproved } from "@/lib/auth";
import { confirmAssistantProposal } from "@/lib/assistant-drafts";
import { completedUsageAction } from "@/lib/usage-actions";

export async function POST(request: Request) {
  const actor = await requireApproved();
  if (!actor || actor.anonymousLink) return NextResponse.json({ error: "Project account access required" }, { status: 403 });
  const body = await request.json().catch(() => null) as { id?: string } | null;
  if (!body?.id) return NextResponse.json({ error: "Proposal is required" }, { status: 400 });
  try {
    const result = await confirmAssistantProposal(actor, body.id);
    if (!result.reused) await completedUsageAction(actor, "budget.save", "budget", `draft:${result.draftId}:2`);
    return NextResponse.json(result);
  }
  catch (error) {
    const message = error instanceof Error ? error.message : "Proposal could not be confirmed";
    const status = message.includes("access") ? 403 : message.includes("not_found") ? 404 : message.includes("stale") || message.includes("pending") || message.includes("changed") ? 409 : 503;
    return NextResponse.json({ error: message }, { status });
  }
}
