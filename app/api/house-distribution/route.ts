import { NextResponse } from "next/server";
import { requireApproved } from "@/lib/auth";
import { DistributionError, readDistribution, importDistribution, correctDistribution } from "@/lib/house-distribution-store";

function errorResponse(error: unknown) {
  if (error instanceof DistributionError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  console.error("distribution", error);
  return NextResponse.json({ error: "Distribution could not be loaded or saved" }, { status: 500 });
}
export async function GET(request: Request) {
  const actor = await requireApproved();
  if (!actor) return NextResponse.json({ error: "Sign in required" }, { status: 403 });
  try { const record = await readDistribution(actor); return NextResponse.json(new URL(request.url).searchParams.has("status") ? { ready: Boolean(record), revision: record?.revision || 0 } : { record }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  const actor = await requireApproved(["admin"]);
  if (!actor) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  try {
    const text = await request.text(); if (text.length > 750_000) return NextResponse.json({ error: "Model is too large" }, { status: 413 });
    const body = JSON.parse(text);
    // Validation errors are safe to return; infrastructure failures retain a generic response.
    const { parseHouseModel } = await import("@/lib/house-distribution");
    let model; try { model = parseHouseModel(body.model); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid model" }, { status: 400 }); }
    return NextResponse.json({ record: await importDistribution(actor, model, body.revision) });
  } catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request) {
  const actor = await requireApproved(["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Editor access required" }, { status: 403 });
  try { const text = await request.text(); if (text.length > 20_000) throw new DistributionError("Correction is too large", 413); const body = JSON.parse(text); if (!body || typeof body !== "object" || Array.isArray(body)) throw new DistributionError("Invalid correction"); return NextResponse.json({ record: await correctDistribution(actor, body) }); }
  catch (error) { return errorResponse(error); }
}
