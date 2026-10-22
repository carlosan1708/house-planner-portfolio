import { NextResponse } from "next/server";
import { requireApproved } from "@/lib/auth";
import { budgetPayload } from "@/lib/workbook-store";

export async function POST() {
  const actor = await requireApproved(["admin"]);
  if (!actor) return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  const budget = await budgetPayload(actor.projectId);
  return NextResponse.json({ ok: true, source: "workbook", spent: budget.spent, actualsRevision: budget.actualsRevision });
}
