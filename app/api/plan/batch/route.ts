import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireTabAccess } from "@/lib/auth";
import { firestore } from "@/lib/firebase-admin";
import { PLAN_ITEMS } from "@/lib/project";
import { commitActivity } from "@/lib/activity";

const STATUSES = ["not_started", "in_progress", "blocked", "done"] as const;

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, 300) : fallback;
}

function dateValue(value: unknown) {
  return typeof value === "string" && value ? value.slice(0, 10) : null;
}

function dependsOn(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === "string" && id.length <= 160))].slice(0, 100)
    : [];
}

export async function POST(request: Request) {
  const actor = await requireTabAccess("plan", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Plan editor access required" }, { status: 403 });
  const body = await request.json() as { items?: unknown };
  const items = Array.isArray(body.items) ? body.items.slice(0, 100) : [];
  if (!items.length) return NextResponse.json({ error: "At least one plan item is required" }, { status: 400 });
  const records: Array<{ ref: FirebaseFirestore.DocumentReference; record: Record<string, unknown> }> = [];
  for (const raw of items) {
    const item = (raw ?? {}) as Record<string, unknown>;
    const title = text(item.title);
    if (!title) continue;
    const ref = firestore.collection(PLAN_ITEMS).doc();
    records.push({ ref, record: {
      projectId: actor.projectId,
      title,
      phase: text(item.phase),
      owner: text(item.owner),
      startDate: dateValue(item.startDate),
      endDate: dateValue(item.endDate),
      status: STATUSES.includes(item.status as typeof STATUSES[number]) ? item.status : "not_started",
      dependsOn: dependsOn(item.dependsOn),
      notes: text(item.notes),
      createdBy: actor.email,
      updatedBy: actor.email,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    } });
  }
  if (!records.length) return NextResponse.json({ error: "At least one valid plan item is required" }, { status: 400 });
  await commitActivity(actor, {
    category: "plan", action: "plan.template_applied",
    target: { type: "plan_template", id: records[0].ref.id, label: `${records.length} plan items`, section: "plan" },
    summaryParams: { count: records.length }, changeCount: records.length,
  }, (transaction) => records.forEach(({ ref, record }) => transaction.set(ref, record)));
  return NextResponse.json({ ok: true, created: records.length }, { status: 201 });
}
