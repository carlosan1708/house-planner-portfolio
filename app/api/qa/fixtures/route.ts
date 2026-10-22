import { NextResponse } from "next/server";
import { requireApproved } from "@/lib/auth";
import { adminAuth, firestore, projectBucket } from "@/lib/firebase-admin";
import { assertQaWorkspace } from "@/lib/qa-reset";
import { assertIsolatedQaEnvironment, QA_PRIMARY_PROJECT } from "@/lib/qa-environment.mjs";
import { QA_IDENTITIES, seedQaFixtures } from "@/lib/qa-fixtures.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try { assertIsolatedQaEnvironment(); }
  catch { return NextResponse.json({ error: "Not found" }, { status: 404 }); }
  const actor = await requireApproved(["admin"]);
  if (!actor || actor.projectId !== QA_PRIMARY_PROJECT || actor.email !== QA_IDENTITIES[0].email) return NextResponse.json({ error: "QA fixture owner required" }, { status: 403 });
  try { await assertQaWorkspace(actor); }
  catch { return NextResponse.json({ error: "QA fixture owner required" }, { status: 403 }); }
  const body = await request.json().catch(() => null);
  if (body?.action !== "reset" || body?.confirmation !== "RESET QA FIXTURES") return NextResponse.json({ error: "Invalid QA fixture confirmation" }, { status: 400 });
  try {
    const result = await seedQaFixtures({ auth: adminAuth, firestore, bucket: projectBucket });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "QA fixture reset failed" }, { status: 500 });
  }
}
