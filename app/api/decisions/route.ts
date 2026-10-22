import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { canAccessFolder, requireTabAccess } from "@/lib/auth";
import { firestore } from "@/lib/firebase-admin";
import { DECISIONS, type MemberRecord } from "@/lib/project";
import { commitActivity, diffChanges } from "@/lib/activity";
import { normalizeCaptureAttachments } from "@/lib/mobile-capture";
import { buildTopLevelFolderMap, folderTopLevelId, listProjectFolders } from "@/lib/folders";

const STATUSES = ["open", "decided", "deferred"] as const;

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, 500) : fallback;
}

function dateValue(value: unknown) {
  return typeof value === "string" && value ? value.slice(0, 10) : null;
}

function serialize(doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot, actor?: MemberRecord, topLevelMap = new Map<string, string | null>()) {
  const data = doc.data()!;
  return {
    id: doc.id,
    area: text(data.area),
    title: text(data.title),
    options: text(data.options),
    selected: text(data.selected),
    dueDate: dateValue(data.dueDate),
    status: STATUSES.includes(data.status as typeof STATUSES[number]) ? data.status : "open",
    owner: text(data.owner),
    captureAttachments: actor && (actor.role === "admin" || actor.permissions.documents)
      ? normalizeCaptureAttachments(data.captureAttachments).filter((attachment) => canAccessFolder(actor, attachment.folderId, folderTopLevelId(attachment.folderId, topLevelMap)))
      : [],
  };
}

export async function GET() {
  const actor = await requireTabAccess("decisions");
  if (!actor) return NextResponse.json({ error: "Decisions access required" }, { status: 403 });
  const [snapshot, folders] = await Promise.all([
    firestore.collection(DECISIONS).where("projectId", "==", actor.projectId).get(),
    listProjectFolders(actor.projectId),
  ]);
  const topLevelMap = buildTopLevelFolderMap(folders);
  return NextResponse.json({ decisions: snapshot.docs.map((document) => serialize(document, actor, topLevelMap)).sort((a, b) => a.title.localeCompare(b.title)) });
}

export async function POST(request: Request) {
  const actor = await requireTabAccess("decisions", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Decisions editor access required" }, { status: 403 });
  const body = await request.json() as Record<string, unknown>;
  const title = text(body.title);
  if (!title) return NextResponse.json({ error: "Decision title is required" }, { status: 400 });
  const ref = firestore.collection(DECISIONS).doc();
  const record = {
    projectId: actor.projectId,
    area: text(body.area),
    title,
    options: text(body.options),
    selected: text(body.selected),
    dueDate: dateValue(body.dueDate),
    status: STATUSES.includes(body.status as typeof STATUSES[number]) ? body.status : "open",
    owner: text(body.owner),
    captureAttachments: [],
    createdBy: actor.email,
    updatedBy: actor.email,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await commitActivity(actor, {
    category: "decision", action: "decision.created",
    target: { type: "decision", id: ref.id, label: title, section: "decisions" },
    changes: [{ field: "status", before: null, after: record.status, format: "status" }],
  }, (transaction) => transaction.set(ref, record));
  return NextResponse.json({ decision: serialize(await ref.get(), actor) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const actor = await requireTabAccess("decisions", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Decisions editor access required" }, { status: 403 });
  const body = await request.json() as { id?: string } & Record<string, unknown>;
  if (!body.id) return NextResponse.json({ error: "Decision is required" }, { status: 400 });
  const ref = firestore.collection(DECISIONS).doc(body.id);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.projectId !== actor.projectId) return NextResponse.json({ error: "Decision not found" }, { status: 404 });
  const title = text(body.title);
  if (!title) return NextResponse.json({ error: "Decision title is required" }, { status: 400 });
  const topLevelMap = buildTopLevelFolderMap(await listProjectFolders(actor.projectId));
  const before = serialize(snap, actor, topLevelMap);
  const businessUpdate = {
    area: text(body.area),
    title,
    options: text(body.options),
    selected: text(body.selected),
    dueDate: dateValue(body.dueDate),
    status: STATUSES.includes(body.status as typeof STATUSES[number]) ? body.status : "open",
    owner: text(body.owner),
  };
  const update = {
    ...businessUpdate,
    updatedBy: actor.email,
    updatedAt: FieldValue.serverTimestamp(),
  };
  const changes = diffChanges(before, { ...before, ...businessUpdate }, { dueDate: "date", status: "status" });
  if (!changes.length) return NextResponse.json({ decision: before });
  await commitActivity(actor, {
    category: "decision", action: "decision.updated",
    target: { type: "decision", id: body.id, label: title, section: "decisions" }, changes,
  }, (transaction) => transaction.set(ref, update, { merge: true }));
  return NextResponse.json({ decision: serialize(await ref.get(), actor, topLevelMap) });
}

export async function DELETE(request: Request) {
  const actor = await requireTabAccess("decisions", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Decisions editor access required" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Decision is required" }, { status: 400 });
  const ref = firestore.collection(DECISIONS).doc(id);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.projectId !== actor.projectId) return NextResponse.json({ error: "Decision not found" }, { status: 404 });
  const current = serialize(snap, actor);
  await commitActivity(actor, {
    category: "decision", action: "decision.deleted",
    target: { type: "decision", id, label: current.title, section: "decisions", exists: false },
    changes: [{ field: "status", before: current.status, after: null, format: "status" }],
  }, (transaction) => transaction.delete(ref));
  return NextResponse.json({ ok: true });
}
