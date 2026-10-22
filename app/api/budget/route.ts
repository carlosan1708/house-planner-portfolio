import { NextResponse } from "next/server";
import { requireTabAccess } from "@/lib/auth";
import { budgetPayload } from "@/lib/workbook-store";
import { GoogleBudgetSyncError } from "@/lib/google-budget";

export async function GET(request: Request) {
  const actor = await requireTabAccess("budget");
  if (!actor) return NextResponse.json({ error: "Budget access required" }, { status: 403 });
  const stored = request.headers.get("x-house-planner-budget-source") === "stored";
  try {
    if (stored) {
      const saved = await budgetPayload(actor.projectId, { skipGoogleSync: true });
      return NextResponse.json({ ...saved, editingAllowed: false, googleSyncPending: true });
    }
    return NextResponse.json(await budgetPayload(actor.projectId));
  }
  catch (error) {
    if (!stored && error instanceof GoogleBudgetSyncError) {
      try {
        const saved = await budgetPayload(actor.projectId, { skipGoogleSync: true });
        return NextResponse.json({ ...saved, editingAllowed: false, googleSyncError: error.message });
      } catch (snapshotError) {
        return NextResponse.json({ error: snapshotError instanceof Error ? snapshotError.message : "Budget unavailable" }, { status: 503 });
      }
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Budget unavailable" }, { status: 503 });
  }
}
