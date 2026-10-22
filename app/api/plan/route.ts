import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireTabAccess } from "@/lib/auth";
import { firestore } from "@/lib/firebase-admin";
import { PLAN_ITEMS } from "@/lib/project";
import { commitActivity, diffChanges } from "@/lib/activity";

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

function serialize(doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot) {
  const data = doc.data()!;
  return {
    id: doc.id,
    title: text(data.title),
    phase: text(data.phase),
    owner: text(data.owner),
    startDate: dateValue(data.startDate),
    endDate: dateValue(data.endDate),
    status: STATUSES.includes(data.status as typeof STATUSES[number]) ? data.status : "not_started",
    dependsOn: dependsOn(data.dependsOn),
    notes: text(data.notes),
  };
}

export async function GET() {
  const actor = await requireTabAccess("plan");
  if (!actor) return NextResponse.json({ error: "Plan access required" }, { status: 403 });
  const snapshot = await firestore.collection(PLAN_ITEMS).where("projectId", "==", actor.projectId).get();
  return NextResponse.json({ items: snapshot.docs.map(serialize).sort((a, b) => a.title.localeCompare(b.title)) });
}

export async function POST(request: Request) {
  const actor = await requireTabAccess("plan", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Plan editor access required" }, { status: 403 });
  const body = await request.json() as Record<string, unknown>;
  const title = text(body.title);
  if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
  const ref = firestore.collection(PLAN_ITEMS).doc();
  const record = {
    projectId: actor.projectId,
    title,
    phase: text(body.phase),
    owner: text(body.owner),
    startDate: dateValue(body.startDate),
    endDate: dateValue(body.endDate),
    status: STATUSES.includes(body.status as typeof STATUSES[number]) ? body.status : "not_started",
    dependsOn: dependsOn(body.dependsOn),
    notes: text(body.notes),
    createdBy: actor.email,
    updatedBy: actor.email,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await commitActivity(actor, {
    category: "plan", action: "plan.created",
    target: { type: "plan_item", id: ref.id, label: title, section: "plan" },
    changes: [{ field: "status", before: null, after: record.status, format: "status" }],
  }, (transaction) => transaction.set(ref, record));
  return NextResponse.json({ item: serialize(await ref.get()) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const actor = await requireTabAccess("plan", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Plan editor access required" }, { status: 403 });
  const body = await request.json() as { id?: string } & Record<string, unknown>;
  if (!body.id) return NextResponse.json({ error: "Plan item is required" }, { status: 400 });
  const ref = firestore.collection(PLAN_ITEMS).doc(body.id);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.projectId !== actor.projectId) return NextResponse.json({ error: "Plan item not found" }, { status: 404 });
  const title = text(body.title);
  if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
  const before = serialize(snap);
  const businessUpdate = {
    title,
    phase: text(body.phase),
    owner: text(body.owner),
    startDate: dateValue(body.startDate),
    endDate: dateValue(body.endDate),
    status: STATUSES.includes(body.status as typeof STATUSES[number]) ? body.status : "not_started",
    dependsOn: dependsOn(body.dependsOn),
    notes: text(body.notes),
  };
  const update = {
    ...businessUpdate,
    updatedBy: actor.email,
    updatedAt: FieldValue.serverTimestamp(),
  };
  const after = { ...before, ...businessUpdate };
  const changes = diffChanges(before, after, { startDate: "date", endDate: "date", status: "status", dependsOn: "list" });
  if (!changes.length) return NextResponse.json({ item: before });
  await commitActivity(actor, {
    category: "plan", action: "plan.updated",
    target: { type: "plan_item", id: body.id, label: title, section: "plan" }, changes,
  }, (transaction) => transaction.set(ref, update, { merge: true }));
  return NextResponse.json({ item: serialize(await ref.get()) });
}

export async function DELETE(request: Request) {
  const actor = await requireTabAccess("plan", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Plan editor access required" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Plan item is required" }, { status: 400 });
  const ref = firestore.collection(PLAN_ITEMS).doc(id);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.projectId !== actor.projectId) return NextResponse.json({ error: "Plan item not found" }, { status: 404 });
  const current = serialize(snap);
  await commitActivity(actor, {
    category: "plan", action: "plan.deleted",
    target: { type: "plan_item", id, label: current.title, section: "plan", exists: false },
    changes: [{ field: "status", before: current.status, after: null, format: "status" }],
  }, (transaction) => transaction.delete(ref));
  return NextResponse.json({ ok: true });
}
