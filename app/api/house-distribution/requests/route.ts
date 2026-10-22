import { NextResponse } from "next/server";
import { requireApproved } from "@/lib/auth";
import { DistributionError, distributionRequestRef, createDistributionRequest, updateDistributionRequest } from "@/lib/house-distribution-store";
const failure = (error: unknown) => NextResponse.json({ error: error instanceof DistributionError ? error.message : "Unable to process distribution request" }, { status: error instanceof DistributionError ? error.status : error instanceof SyntaxError ? 400 : 500 });
export async function GET() {
  const actor = await requireApproved(["admin"]); if (!actor) return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  try { return NextResponse.json({ request: (await distributionRequestRef(actor.projectId).get()).data() || null }, { headers: { "Cache-Control": "private, no-store" } }); } catch (e) { return failure(e); }
}
export async function POST(request: Request) {
  const actor = await requireApproved(["admin"]); if (!actor) return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  try { const body = await request.json(); return NextResponse.json({ request: await createDistributionRequest(actor, body.sourceDocumentIds, body.notes) }); } catch (e) { return failure(e); }
}
export async function PATCH(request: Request) {
  const actor = await requireApproved(["admin"]); if (!actor) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  try { const body = await request.json(); return NextResponse.json({ request: await updateDistributionRequest(actor, body.revision, body.preparationNotes) }); } catch (e) { return failure(e); }
}
