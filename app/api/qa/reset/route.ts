import { NextResponse } from "next/server";
import { requireApproved } from "@/lib/auth";
import { assertQaWorkspace, previewQaWorkspace, resetQaWorkspace } from "@/lib/qa-reset";
import { qaResetConfirmation, qaResetEligibility, validQaResetConfirmation } from "@/lib/qa-reset-policy";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const actor = await requireApproved(["admin"]);
  if (!actor) return NextResponse.json({ available: false });
  const eligibility = qaResetEligibility(actor);
  if (!eligibility.allowed) return NextResponse.json({ available: false });
  try { await assertQaWorkspace(actor); } catch { return NextResponse.json({ available: false }); }
  const base = { available: true, projectId: actor.projectId, projectName: actor.projectName, confirmation: qaResetConfirmation(actor.projectId) };
  if (new URL(request.url).searchParams.get("preview") !== "1") return NextResponse.json(base);
  return NextResponse.json({ ...base, preview: await previewQaWorkspace(actor) });
}

export async function POST(request: Request) {
  const actor = await requireApproved(["admin"]);
  if (!actor || !qaResetEligibility(actor).allowed) return NextResponse.json({ error: "QA reset is unavailable" }, { status: 403 });
  const body = await request.json() as { confirmation?: unknown; confirmPermanentDeletion?: unknown };
  if (body.confirmPermanentDeletion !== true || !validQaResetConfirmation(actor.projectId, body.confirmation))
    return NextResponse.json({ error: "The reset confirmation does not match" }, { status: 400 });
  try {
    const removed = await resetQaWorkspace(actor);
    return NextResponse.json({ ok: true, removed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "qa_reset_failed";
    return NextResponse.json({ error: message }, { status: message === "qa_reset_in_progress" ? 409 : 500 });
  }
}
