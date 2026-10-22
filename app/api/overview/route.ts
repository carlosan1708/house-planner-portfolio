import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireTabAccess } from "@/lib/auth";
import { AESTHETIC_PDF_TYPE } from "@/lib/aesthetics";
import { firestore } from "@/lib/firebase-admin";
import { normalizeOverviewPreferences, parseOverviewUpdate, type OverviewPreferences } from "@/lib/overview";
import { AESTHETIC_IMAGES, CONFIG, PROJECT_NOTES, projectConfigDoc, type MemberRecord } from "@/lib/project";

const privateHeaders = { "Cache-Control": "private, no-store" };

function hasResourceAccess(actor: MemberRecord, resource: "aesthetics" | "notes") {
  return (resource !== "notes" || !actor.isPersonal) && (actor.role === "admin" || actor.permissions[resource]);
}

async function availableIds(projectId: string, ids: string[], resource: "aesthetics" | "notes") {
  if (!ids.length) return [];
  const collection = resource === "aesthetics" ? AESTHETIC_IMAGES : PROJECT_NOTES;
  const documents = await firestore.getAll(...ids.map((id) => firestore.collection(collection).doc(id)));
  const available = new Set(documents.filter((document) => {
    const data = document.data();
    return document.exists && data?.projectId === projectId && !data.deletedAt
      && (resource !== "aesthetics" || data.contentType !== AESTHETIC_PDF_TYPE);
  }).map((document) => document.id));
  return ids.filter((id) => available.has(id));
}

async function visiblePreferences(actor: MemberRecord, preferences: OverviewPreferences): Promise<OverviewPreferences> {
  const [imageIds, noteIds] = await Promise.all([
    hasResourceAccess(actor, "aesthetics") ? availableIds(actor.projectId, preferences.imageIds, "aesthetics") : [],
    hasResourceAccess(actor, "notes") ? availableIds(actor.projectId, preferences.noteIds, "notes") : [],
  ]);
  return { imageIds, noteIds };
}

export async function GET() {
  const actor = await requireTabAccess("overview");
  if (!actor) return NextResponse.json({ error: "Overview access required" }, { status: 403 });
  const snapshot = await firestore.collection(CONFIG).doc(projectConfigDoc(actor.projectId)).get();
  const data = snapshot.data();
  // Existing legacy configuration can omit projectId; a conflicting owner must never be exposed.
  const preferences = normalizeOverviewPreferences(data?.projectId && data.projectId !== actor.projectId ? null : data);
  return NextResponse.json(await visiblePreferences(actor, preferences), { headers: privateHeaders });
}

export async function PATCH(request: Request) {
  const actor = await requireTabAccess("overview", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Overview editor access required" }, { status: 403 });
  const update = parseOverviewUpdate(await request.json().catch(() => null));
  if (!update) return NextResponse.json({ error: "Choose up to 30 valid photos and 12 valid notes" }, { status: 400 });
  if ((update.imageIds !== undefined && !hasResourceAccess(actor, "aesthetics"))
    || (update.noteIds !== undefined && !hasResourceAccess(actor, "notes"))) {
    return NextResponse.json({ error: "Access to the selected section is required" }, { status: 403 });
  }

  const [images, notes] = await Promise.all([
    update.imageIds ? availableIds(actor.projectId, update.imageIds, "aesthetics") : [],
    update.noteIds ? availableIds(actor.projectId, update.noteIds, "notes") : [],
  ]);
  if ((update.imageIds && images.length !== update.imageIds.length) || (update.noteIds && notes.length !== update.noteIds.length)) {
    return NextResponse.json({ error: "One or more selected photos or notes are unavailable" }, { status: 400 });
  }

  const ref = firestore.collection(CONFIG).doc(projectConfigDoc(actor.projectId));
  const current = await ref.get();
  if (current.data()?.projectId && current.data()?.projectId !== actor.projectId) {
    return NextResponse.json({ error: "Project configuration is unavailable" }, { status: 409 });
  }
  await ref.set({
    projectId: actor.projectId,
    ...(update.imageIds !== undefined ? { overviewImageIds: update.imageIds } : {}),
    ...(update.noteIds !== undefined ? { overviewNoteIds: update.noteIds } : {}),
    overviewUpdatedAt: FieldValue.serverTimestamp(),
    overviewUpdatedBy: actor.email,
  }, { merge: true });
  const saved = normalizeOverviewPreferences((await ref.get()).data());
  return NextResponse.json(await visiblePreferences(actor, saved), { headers: privateHeaders });
}
