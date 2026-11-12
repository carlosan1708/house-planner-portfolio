import type { AgentWrite } from "./agent-write";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireTabAccess } from "@/lib/auth";
import { firestore } from "@/lib/firebase-admin";
import { EXPENSES } from "@/lib/project";
import { readProjectCurrency } from "@/lib/project-currency";
import { commitActivity } from "@/lib/activity";
import { isPaymentReminder, paymentReminder, reminderFields } from "@/lib/payment-reminders";

type ExpenseActor = NonNullable<Awaited<ReturnType<typeof requireTabAccess>>>;

class ReminderConflict extends Error {}
const validId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200 && !value.includes("/");

export async function GET() {
  const actor = await requireTabAccess("expenses");
  if (!actor) return NextResponse.json({ error: "Expense access required" }, { status: 403 });
  const [snapshot, defaultCurrency] = await Promise.all([
    firestore.collection(EXPENSES).where("projectId", "==", actor.projectId).get(), readProjectCurrency(actor.projectId),
  ]);
  const reminders = snapshot.docs.flatMap((document) => {
    const data = document.data();
    return data.projectId === actor.projectId && isPaymentReminder(data) ? [paymentReminder(document.id, data)] : [];
  }).sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || a.description.localeCompare(b.description) || a.id.localeCompare(b.id));
  return NextResponse.json({ reminders, defaultCurrency });
}

export async function POST(request: Request) {
  const actor = await requireTabAccess("expenses", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Expenses editor access required" }, { status: 403 });
  return createExpenseReminder(actor, request);
}

export async function createExpenseReminder(actor: ExpenseActor, request: Request, agent?: AgentWrite) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Solicitud no válida." }, { status: 400 });
  let fields: ReturnType<typeof reminderFields>;
  try { fields = reminderFields(body); } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
  const ref = firestore.collection(EXPENSES).doc();
  await commitActivity(actor, {
    category: "expense", ...(agent ? { source: "assistant" as const } : {}), action: "expense.reminder_created",
    target: { type: "payment_reminder", id: ref.id, label: fields.description, section: "expenses" },
    changes: [{ field: "reminder", before: null, after: fields.description }],
  }, (transaction) => {
    transaction.set(ref, { projectId: actor.projectId, kind: "payment_reminder", ...fields,
    reminderStatus: "pending", reminderRevision: 1, deletedAt: null,
    createdBy: actor.email, updatedBy: actor.email, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    agent?.record(transaction, ref.id);
  }, agent?.validate);
  return NextResponse.json({ id: ref.id }, { status: 201 });
}

async function mutate(request: Request, remove: boolean) {
  const actor = await requireTabAccess("expenses", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Expenses editor access required" }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || !validId(body.id) || !Number.isSafeInteger(body.revision) || body.revision < 0)
    return NextResponse.json({ error: "Falta la versión del recordatorio. Actualiza la página." }, { status: 400 });
  const ref = firestore.collection(EXPENSES).doc(body.id), snapshot = await ref.get(), data = snapshot.data();
  if (!snapshot.exists || !data || data.projectId !== actor.projectId || !isPaymentReminder(data))
    return NextResponse.json({ error: "Recordatorio no encontrado." }, { status: 404 });
  const current = paymentReminder(ref.id, data);
  let fields: Record<string, unknown>;
  const statusChange = !remove && body.action === "status";
  if (remove) fields = { deletedAt: FieldValue.serverTimestamp(), deletedBy: actor.email };
  else if (statusChange) {
    if (body.status !== "pending" && body.status !== "done") return NextResponse.json({ error: "Estado no válido." }, { status: 400 });
    fields = { reminderStatus: body.status };
  } else {
    try { fields = reminderFields(body); } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
  }
  try {
    await commitActivity(actor, {
      category: "expense", action: remove ? "expense.reminder_deleted" : statusChange ? "expense.reminder_status_updated" : "expense.reminder_updated",
      target: { type: "payment_reminder", id: ref.id, label: String(fields.description || current.description), section: "expenses", exists: !remove },
      changes: [{ field: statusChange ? "reminderStatus" : "reminder", before: statusChange ? current.status : current.description,
        after: remove ? null : statusChange ? body.status : fields.description }],
    }, (transaction) => transaction.set(ref, { ...fields, reminderRevision: current.revision + 1, updatedBy: actor.email, updatedAt: FieldValue.serverTimestamp() }, { merge: true }), async (transaction) => {
      const latest = await transaction.get(ref), value = latest.data();
      if (!latest.exists || !value || value.projectId !== actor.projectId || !isPaymentReminder(value) || paymentReminder(ref.id, value).revision !== body.revision || current.revision !== body.revision)
        throw new ReminderConflict("El recordatorio cambió. Actualiza antes de guardar.");
    });
    return NextResponse.json({ id: ref.id });
  } catch (error) {
    if (error instanceof ReminderConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}

export const PATCH = (request: Request) => mutate(request, false);
export const DELETE = (request: Request) => mutate(request, true);
