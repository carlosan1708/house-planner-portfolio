import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireTabAccess } from "@/lib/auth";
import { normalizeCountdownDays } from "@/lib/countdowns";
import { cancelCountdownNotificationJobs, scheduleCountdownNotificationJobs, validateRecipientUids } from "@/lib/notification-service";
import { normalizeRecipientUids } from "@/lib/notifications";
import { COUNTDOWNS, NOTIFICATION_JOBS } from "@/lib/project";
import { firestore } from "@/lib/firebase-admin";
import { commitActivity } from "@/lib/activity";
import { loadProjectAuthorDisplay, type ProjectAuthorDisplay } from "@/lib/project-authors";

function title(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 140) : "";
}

function iso(value: unknown) {
  return value && typeof value === "object" && "toDate" in value
    ? (value as FirebaseFirestore.Timestamp).toDate().toISOString()
    : new Date(0).toISOString();
}

function serialize(document: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot, uid: string, authors?: ProjectAuthorDisplay) {
  const original = document.data()!;
  const data = authors ? authors.redact(original) : original;
  const recipientUids = normalizeRecipientUids(data.recipientUids).length
    ? normalizeRecipientUids(data.recipientUids)
    : normalizeRecipientUids([data.createdByUid]);
  return {
    id: document.id,
    title: title(data.title),
    durationDays: normalizeCountdownDays(data.durationDays),
    startedAt: iso(data.startedAt),
    dueAt: iso(data.dueAt),
    completed: data.completed === true,
    completedAt: data.completed === true && data.completedAt ? iso(data.completedAt) : null,
    acknowledged: Array.isArray(data.acknowledgedByUids) && data.acknowledgedByUids.includes(uid),
    recipientUids,
    notifyCurrentUser: recipientUids.includes(uid),
    createdBy: String(data.createdBy || ""),
  };
}

export async function GET() {
  const actor = await requireTabAccess("plan");
  if (!actor) return NextResponse.json({ error: "Plan access required" }, { status: 403 });
  const snapshot = await firestore.collection(COUNTDOWNS).where("projectId", "==", actor.projectId).get();
  const authors = await loadProjectAuthorDisplay(actor.projectId);
  const countdowns = snapshot.docs.map((document) => {
    const countdown = serialize(document, actor.uid, authors);
    return actor.anonymousLink ? { ...countdown, recipientUids: [], notifyCurrentUser: false } : countdown;
  }).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  return NextResponse.json({ countdowns });
}

export async function POST(request: Request) {
  const actor = await requireTabAccess("plan", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Plan editor access required" }, { status: 403 });
  const body = await request.json() as Record<string, unknown>;
  const countdownTitle = title(body.title);
  if (!countdownTitle) return NextResponse.json({ error: "Title is required" }, { status: 400 });
  const durationDays = normalizeCountdownDays(body.durationDays);
  const recipientUids = await validateRecipientUids(actor.projectId, body.recipientUids ?? [actor.uid]);
  if (!recipientUids.length) return NextResponse.json({ error: "At least one eligible recipient is required" }, { status: 400 });
  const startedAt = Timestamp.now();
  const dueAt = Timestamp.fromMillis(startedAt.toMillis() + durationDays * 86_400_000);
  const ref = firestore.collection(COUNTDOWNS).doc();
  const record = { projectId: actor.projectId, title: countdownTitle, durationDays, startedAt, dueAt, recipientUids, acknowledgedByUids: [], createdBy: actor.email, createdByUid: actor.uid, createdAt: FieldValue.serverTimestamp() };
  await commitActivity(actor, {
    category: "plan", action: "countdown.created",
    target: { type: "countdown", id: ref.id, label: countdownTitle, section: "plan" },
    summaryParams: { durationDays, recipientCount: recipientUids.length },
    changes: [{ field: "dueAt", before: null, after: dueAt.toDate().toISOString(), format: "date" }],
  }, (transaction) => transaction.set(ref, record));
  await scheduleCountdownNotificationJobs({ countdownId: ref.id, projectId: actor.projectId, startedAtMs: startedAt.toMillis(), dueAtMs: dueAt.toMillis() });
  return NextResponse.json({ countdown: serialize(await ref.get(), actor.uid, await loadProjectAuthorDisplay(actor.projectId)) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const actor = await requireTabAccess("plan");
  if (!actor) return NextResponse.json({ error: "Plan access required" }, { status: 403 });
  if (actor.accessLinkId) return NextResponse.json({ error: "El enlace de lectura no permite modificar los plazos del proyecto." }, { status: 403 });
  const body = await request.json() as { id?: string; action?: string; recipientUids?: unknown };
  if (!body.id || (body.action !== "acknowledge" && body.action !== "recipients" && body.action !== "complete")) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  if (body.action === "complete" && actor.role !== "admin" && actor.role !== "editor") return NextResponse.json({ error: "Plan editor access required" }, { status: 403 });
  const ref = firestore.collection(COUNTDOWNS).doc(body.id); const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data()?.projectId !== actor.projectId) return NextResponse.json({ error: "Countdown not found" }, { status: 404 });
  if (body.action === "complete") {
    if (snapshot.data()?.completed !== true) await commitActivity(actor, {
      category: "plan", action: "countdown.completed",
      target: { type: "countdown", id: body.id, label: title(snapshot.data()?.title), section: "plan" },
      changes: [{ field: "completed", before: false, after: true }],
    }, (transaction) => {
      transaction.update(ref, { completed: true, completedAt: FieldValue.serverTimestamp(), completedByUid: actor.uid, updatedAt: FieldValue.serverTimestamp() });
      for (const stage of ["pre_due", "due"]) {
        transaction.set(firestore.collection(NOTIFICATION_JOBS).doc(`${body.id}__${stage}`), { status: "cancelled", leaseUntil: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
    });
  } else if (body.action === "acknowledge") {
    const acknowledged = Array.isArray(snapshot.data()?.acknowledgedByUids) && snapshot.data()!.acknowledgedByUids.includes(actor.uid);
    if (!acknowledged) await commitActivity(actor, {
      category: "plan", action: "countdown.acknowledged",
      target: { type: "countdown", id: body.id, label: title(snapshot.data()?.title), section: "plan" },
    }, (transaction) => transaction.update(ref, { acknowledgedByUids: FieldValue.arrayUnion(actor.uid) }));
  } else {
    if (actor.role === "viewer") return NextResponse.json({ error: "Plan editor access required" }, { status: 403 });
    const recipientUids = await validateRecipientUids(actor.projectId, body.recipientUids);
    if (!recipientUids.length) return NextResponse.json({ error: "At least one eligible recipient is required" }, { status: 400 });
    const before = normalizeRecipientUids(snapshot.data()?.recipientUids);
    if (JSON.stringify(before) !== JSON.stringify(recipientUids)) await commitActivity(actor, {
      category: "plan", action: "countdown.recipients_updated",
      target: { type: "countdown", id: body.id, label: title(snapshot.data()?.title), section: "plan" },
      changes: [{ field: "recipients", before, after: recipientUids, format: "list" }],
    }, (transaction) => transaction.update(ref, { recipientUids, updatedAt: FieldValue.serverTimestamp() }));
  }
  return NextResponse.json({ countdown: serialize(await ref.get(), actor.uid, await loadProjectAuthorDisplay(actor.projectId)) });
}

export async function DELETE(request: Request) {
  const actor = await requireTabAccess("plan", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Plan editor access required" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Countdown is required" }, { status: 400 });
  const ref = firestore.collection(COUNTDOWNS).doc(id); const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data()?.projectId !== actor.projectId) return NextResponse.json({ error: "Countdown not found" }, { status: 404 });
  await commitActivity(actor, {
    category: "plan", action: "countdown.deleted",
    target: { type: "countdown", id, label: title(snapshot.data()?.title), section: "plan", exists: false },
    changes: [{ field: "dueAt", before: iso(snapshot.data()?.dueAt), after: null, format: "date" }],
  }, (transaction) => transaction.delete(ref));
  await cancelCountdownNotificationJobs(id);
  return NextResponse.json({ ok: true });
}
