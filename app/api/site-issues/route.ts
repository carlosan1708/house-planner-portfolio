import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { canAccessFolder, requireTabAccess } from "@/lib/auth";
import { firestore } from "@/lib/firebase-admin";
import { projectStoragePrefix, SITE_ISSUES, type MemberRecord } from "@/lib/project";
import { commitActivity, diffChanges } from "@/lib/activity";
import { normalizeCaptureAttachments } from "@/lib/mobile-capture";
import { buildTopLevelFolderMap, folderTopLevelId, listProjectFolders } from "@/lib/folders";

const CATEGORIES = ["punch", "observation", "inspection", "permit"] as const;
const PRIORITIES = ["low", "medium", "high", "critical"] as const;
const STATUSES = ["open", "in_progress", "resolved"] as const;

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, 500) : fallback;
}

function dateValue(value: unknown) {
  return typeof value === "string" && value ? value.slice(0, 10) : null;
}

function photos(value: unknown, projectId: string) {
  const prefix = `${projectStoragePrefix(projectId)}/site-issues/`;
  return Array.isArray(value)
    ? [...new Set(value.filter((key): key is string => typeof key === "string" && key.startsWith(prefix) && key.length <= 500))].slice(0, 30)
    : [];
}

function serialize(doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot, projectId: string, actor?: MemberRecord, topLevelMap = new Map<string, string | null>()) {
  const data = doc.data()!;
  return {
    id: doc.id,
    title: text(data.title),
    category: CATEGORIES.includes(data.category as typeof CATEGORIES[number]) ? data.category : "observation",
    priority: PRIORITIES.includes(data.priority as typeof PRIORITIES[number]) ? data.priority : "medium",
    status: STATUSES.includes(data.status as typeof STATUSES[number]) ? data.status : "open",
    assignee: text(data.assignee),
    dueDate: dateValue(data.dueDate),
    notes: text(data.notes),
    photos: photos(data.photos, projectId),
    captureAttachments: actor && (actor.role === "admin" || actor.permissions.documents)
      ? normalizeCaptureAttachments(data.captureAttachments).filter((attachment) => canAccessFolder(actor, attachment.folderId, folderTopLevelId(attachment.folderId, topLevelMap)))
      : [],
  };
}

export async function GET() {
  const actor = await requireTabAccess("site");
  if (!actor) return NextResponse.json({ error: "Site progress access required" }, { status: 403 });
  const [snapshot, folders] = await Promise.all([
    firestore.collection(SITE_ISSUES).where("projectId", "==", actor.projectId).get(),
    listProjectFolders(actor.projectId),
  ]);
  const topLevelMap = buildTopLevelFolderMap(folders);
  return NextResponse.json({ issues: snapshot.docs.map((document) => serialize(document, actor.projectId, actor, topLevelMap)).sort((a, b) => a.title.localeCompare(b.title)) });
}

export async function POST(request: Request) {
  const actor = await requireTabAccess("site", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Site progress editor access required" }, { status: 403 });
  const body = await request.json() as Record<string, unknown>;
  const title = text(body.title);
  if (!title) return NextResponse.json({ error: "Issue title is required" }, { status: 400 });
  const ref = firestore.collection(SITE_ISSUES).doc();
  const record = {
    projectId: actor.projectId,
    title,
    category: CATEGORIES.includes(body.category as typeof CATEGORIES[number]) ? body.category : "observation",
    priority: PRIORITIES.includes(body.priority as typeof PRIORITIES[number]) ? body.priority : "medium",
    status: STATUSES.includes(body.status as typeof STATUSES[number]) ? body.status : "open",
    assignee: text(body.assignee),
    dueDate: dateValue(body.dueDate),
    notes: text(body.notes),
    photos: photos(body.photos, actor.projectId),
    captureAttachments: [],
    createdBy: actor.email,
    updatedBy: actor.email,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await commitActivity(actor, {
    category: "site", action: "site_issue.created",
    target: { type: "site_issue", id: ref.id, label: title, section: "site" },
    changes: [{ field: "status", before: null, after: record.status, format: "status" }],
  }, (transaction) => transaction.set(ref, record));
  return NextResponse.json({ issue: serialize(await ref.get(), actor.projectId, actor) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const actor = await requireTabAccess("site", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Site progress editor access required" }, { status: 403 });
  const body = await request.json() as { id?: string } & Record<string, unknown>;
  if (!body.id) return NextResponse.json({ error: "Issue is required" }, { status: 400 });
  const ref = firestore.collection(SITE_ISSUES).doc(body.id);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.projectId !== actor.projectId) return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  const title = text(body.title);
  if (!title) return NextResponse.json({ error: "Issue title is required" }, { status: 400 });
  const topLevelMap = buildTopLevelFolderMap(await listProjectFolders(actor.projectId));
  const before = serialize(snap, actor.projectId, actor, topLevelMap);
  const businessUpdate = {
    title,
    category: CATEGORIES.includes(body.category as typeof CATEGORIES[number]) ? body.category : "observation",
    priority: PRIORITIES.includes(body.priority as typeof PRIORITIES[number]) ? body.priority : "medium",
    status: STATUSES.includes(body.status as typeof STATUSES[number]) ? body.status : "open",
    assignee: text(body.assignee),
    dueDate: dateValue(body.dueDate),
    notes: text(body.notes),
    photos: photos(body.photos, actor.projectId),
  };
  const update = {
    ...businessUpdate,
    updatedBy: actor.email,
    updatedAt: FieldValue.serverTimestamp(),
  };
  const after = { ...before, ...businessUpdate };
  const changes = diffChanges(before, after, { dueDate: "date", status: "status", priority: "status", photos: "list" });
  if (!changes.length) return NextResponse.json({ issue: before });
  await commitActivity(actor, {
    category: "site", action: "site_issue.updated",
    target: { type: "site_issue", id: body.id, label: title, section: "site" }, changes,
  }, (transaction) => transaction.set(ref, update, { merge: true }));
  return NextResponse.json({ issue: serialize(await ref.get(), actor.projectId, actor, topLevelMap) });
}

export async function DELETE(request: Request) {
  const actor = await requireTabAccess("site", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Site progress editor access required" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Issue is required" }, { status: 400 });
  const ref = firestore.collection(SITE_ISSUES).doc(id);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.projectId !== actor.projectId) return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  const current = serialize(snap, actor.projectId, actor);
  await commitActivity(actor, {
    category: "site", action: "site_issue.deleted",
    target: { type: "site_issue", id, label: current.title, section: "site", exists: false },
    changes: [{ field: "status", before: current.status, after: null, format: "status" }],
  }, (transaction) => transaction.delete(ref));
  return NextResponse.json({ ok: true });
}
