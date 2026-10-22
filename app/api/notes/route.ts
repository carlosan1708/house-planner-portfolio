import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireTabAccess } from "@/lib/auth";
import { firestore } from "@/lib/firebase-admin";
import { PROJECT_NOTES } from "@/lib/project";
import { listProjectNotes, serializeProjectNote } from "@/lib/project-notes";
import { randomUUID } from "node:crypto";
import { completedUsageAction } from "@/lib/usage-actions";
import { loadProjectAuthorDisplay } from "@/lib/project-authors";

function validText(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength ? value.trim() : null;
}

export async function GET() {
  const actor = await requireTabAccess("notes");
  if (!actor || actor.isPersonal) return NextResponse.json({ error: "Notes access required" }, { status: 403 });
  return NextResponse.json({ notes: await listProjectNotes(actor.projectId) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const actor = await requireTabAccess("notes", ["admin", "editor"]);
  if (!actor || actor.isPersonal) return NextResponse.json({ error: "Notes editor access required" }, { status: 403 });
  const body = await request.json().catch(() => null) as { title?: unknown; content?: unknown; aiEnabled?: unknown } | null;
  const title = validText(body?.title, 120);
  const content = validText(body?.content, 12_000);
  if (!title || !content || (body?.aiEnabled !== undefined && typeof body.aiEnabled !== "boolean"))
    return NextResponse.json({ error: "A title and note text are required" }, { status: 400 });
  const ref = firestore.collection(PROJECT_NOTES).doc();
  await ref.set({ projectId: actor.projectId, title, content, aiEnabled: body?.aiEnabled === true, createdBy: actor.email, updatedBy: actor.email, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  await completedUsageAction(actor, "record.create", "notes", ref.id);
  return NextResponse.json({ note: serializeProjectNote(await ref.get(), await loadProjectAuthorDisplay(actor.projectId)) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const actor = await requireTabAccess("notes", ["admin", "editor"]);
  if (!actor || actor.isPersonal) return NextResponse.json({ error: "Notes editor access required" }, { status: 403 });
  const body = await request.json().catch(() => null) as { id?: unknown; title?: unknown; content?: unknown; aiEnabled?: unknown } | null;
  if (typeof body?.id !== "string" || !body.id || body.id.length > 200) return NextResponse.json({ error: "Note is required" }, { status: 400 });
  const title = validText(body.title, 120);
  const content = validText(body.content, 12_000);
  if (!title || !content || typeof body.aiEnabled !== "boolean") return NextResponse.json({ error: "A title, text and AI choice are required" }, { status: 400 });
  const ref = firestore.collection(PROJECT_NOTES).doc(body.id);
  let changed = false;
  try {
    changed = await firestore.runTransaction(async (transaction) => {
      const note = await transaction.get(ref);
      if (!note.exists || note.data()?.projectId !== actor.projectId) throw new Error("note_not_found");
      const changed = note.data()?.title !== title || note.data()?.content !== content || note.data()?.aiEnabled !== body.aiEnabled;
      transaction.update(ref, { title, content, aiEnabled: body.aiEnabled, updatedBy: actor.email, updatedAt: FieldValue.serverTimestamp() });
      return changed;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "note_not_found") return NextResponse.json({ error: "Note not found" }, { status: 404 });
    throw error;
  }
  if (changed) await completedUsageAction(actor, "record.update", "notes", randomUUID());
  return NextResponse.json({ note: serializeProjectNote(await ref.get(), await loadProjectAuthorDisplay(actor.projectId)) });
}

export async function DELETE(request: Request) {
  const actor = await requireTabAccess("notes", ["admin", "editor"]);
  if (!actor || actor.isPersonal) return NextResponse.json({ error: "Notes editor access required" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id || id.length > 200) return NextResponse.json({ error: "Note is required" }, { status: 400 });
  const ref = firestore.collection(PROJECT_NOTES).doc(id);
  try {
    await firestore.runTransaction(async (transaction) => {
      const note = await transaction.get(ref);
      if (!note.exists || note.data()?.projectId !== actor.projectId) throw new Error("note_not_found");
      transaction.delete(ref);
    });
  } catch (error) {
    if (error instanceof Error && error.message === "note_not_found") return NextResponse.json({ error: "Note not found" }, { status: 404 });
    throw error;
  }
  await completedUsageAction(actor, "record.delete", "notes", id);
  return NextResponse.json({ ok: true });
}
