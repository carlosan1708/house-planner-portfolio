import { lockProjectCurrency } from "@/lib/project-currency";
import type { ProjectCurrency } from "@/lib/currency";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireTabAccess } from "@/lib/auth";
import { commitActivity } from "@/lib/activity";
import { firestore } from "@/lib/firebase-admin";
import { expenseIso, mediaJson, projectMedia, validateExpenseBudgetLine } from "@/lib/expense-api";
import { cleanExpenseAmount, cleanExpenseBudgetLineIds, cleanExpenseCurrency, cleanExpenseDate, cleanExpenseNotes, cleanExpenseText } from "@/lib/expense-records";
import { DOCUMENTS, EXPENSE_DOCUMENTS, EXPENSE_PAYMENTS, PURCHASES } from "@/lib/project";

type Body = { outsideObjective?: unknown; id?: string; title?: unknown; purchaseDate?: unknown; vendor?: unknown; reference?: unknown; notes?: unknown; amount?: unknown; currency?: unknown; budgetLineId?: unknown; coverPhotoId?: unknown };

const nullableId = (value: unknown) => typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null;
class PurchaseConflict extends Error {}

async function payload(projectId: string) {
  const [purchases, documents, media] = await Promise.all([
    firestore.collection(PURCHASES).where("projectId", "==", projectId).get(),
    firestore.collection(EXPENSE_DOCUMENTS).where("projectId", "==", projectId).get(),
    projectMedia(projectId),
  ]);
  const documentCounts = new Map<string, number>();
  for (const item of documents.docs) {
    if (item.data().deletedAt) continue;
    const id = nullableId(item.data().purchaseId);
    if (id) documentCounts.set(id, (documentCounts.get(id) || 0) + 1);
  }
  const photosByPurchase = new Map<string, ReturnType<typeof mediaJson>[]>();
  for (const item of media) {
    if (item.data().source !== "expense_purchase") continue;
    const id = nullableId(item.data().purchaseId);
    if (!id) continue;
    const photos = photosByPurchase.get(id) || [];
    photos.push(mediaJson(item));
    photosByPurchase.set(id, photos);
  }
  const records = purchases.docs.filter((item) => !item.data().deletedAt).map((item) => {
    const data = item.data();
    return {
      id: item.id, outsideObjective: data.outsideObjective === true,
      title: String(data.title || "Compra"), purchaseDate: String(data.purchaseDate || ""), vendor: String(data.vendor || ""),
      reference: String(data.reference || ""), notes: String(data.notes || ""), amount: typeof data.amount === "number" ? data.amount : null,
      currency: data.currency === "USD" ? "USD" : "CRC", budgetLineId: nullableId(data.budgetLineId), budgetLineLabel: String(data.budgetLineLabel || ""),
      coverPhotoId: nullableId(data.coverPhotoId), photos: (photosByPurchase.get(item.id) || []).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      documentCount: documentCounts.get(item.id) || 0, createdAt: expenseIso(data.createdAt), updatedAt: expenseIso(data.updatedAt),
    };
  }).sort((a, b) => (b.purchaseDate || b.createdAt).localeCompare(a.purchaseDate || a.createdAt));
  return { purchases: records };
}

async function normalized(projectId: string, body: Body, defaultCurrency: ProjectCurrency) {
  if (body.outsideObjective !== undefined && typeof body.outsideObjective !== "boolean") return { error: NextResponse.json({ error: "Clasificación fuera de objetivo inválida" }, { status: 400 }) };
  if (body.outsideObjective === true && nullableId(body.budgetLineId)) return { error: NextResponse.json({ error: "Una compra fuera de objetivo no puede tener partida" }, { status: 400 }) };
  const title = cleanExpenseText(body.title, 160) || "Compra sin descripción";
  const budgetLineId = nullableId(body.budgetLineId);
  const line = await validateExpenseBudgetLine(projectId, budgetLineId);
  if (budgetLineId && !line) return { error: NextResponse.json({ error: "La partida seleccionada no existe en este proyecto" }, { status: 400 }) };
  return { record: {
    title, purchaseDate: cleanExpenseDate(body.purchaseDate), vendor: cleanExpenseText(body.vendor, 160), reference: cleanExpenseText(body.reference, 160),
    notes: cleanExpenseNotes(body.notes), amount: cleanExpenseAmount(body.amount), currency: body.currency === undefined || body.currency === null || body.currency === "" ? defaultCurrency : cleanExpenseCurrency(body.currency),
    outsideObjective: body.outsideObjective === true, budgetLineId, budgetLineLabel: line?.label || "",
  } };
}

export async function GET() {
  const actor = await requireTabAccess("expenses");
  if (!actor) return NextResponse.json({ error: "Expenses access required" }, { status: 403 });
  return NextResponse.json(await payload(actor.projectId), { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const actor = await requireTabAccess("expenses", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Expenses editor access required" }, { status: 403 });
  const body = await request.json() as Body;
  const currency = await lockProjectCurrency(actor.projectId);
  const result = await normalized(actor.projectId, body, currency);
  if (result.error) return result.error;
  const ref = firestore.collection(PURCHASES).doc();
  await commitActivity(actor, { category: "expense", action: "expense.purchase_created", target: { type: "purchase", id: ref.id, label: result.record!.title, section: "expenses" }, changes: [{ field: "purchase", before: null, after: result.record!.title }] }, (transaction) => transaction.set(ref, {
    projectId: actor.projectId, ...result.record, coverPhotoId: null, createdBy: actor.email, createdAt: FieldValue.serverTimestamp(), updatedBy: actor.email, updatedAt: FieldValue.serverTimestamp(), deletedAt: null,
  }));
  return NextResponse.json({ id: ref.id, purchase: (await payload(actor.projectId)).purchases.find((item) => item.id === ref.id) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const actor = await requireTabAccess("expenses", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Expenses editor access required" }, { status: 403 });
  const body = await request.json() as Body;
  const ref = firestore.collection(PURCHASES).doc(String(body.id || ""));
  const current = await ref.get();
  if (!current.exists || current.data()?.projectId !== actor.projectId || current.data()?.deletedAt) return NextResponse.json({ error: "Compra no encontrada" }, { status: 404 });
  await lockProjectCurrency(actor.projectId);
  const result = await normalized(actor.projectId, { ...body, outsideObjective: body.outsideObjective ?? (current.data()?.outsideObjective === true) }, cleanExpenseCurrency(current.data()?.currency));
  if (result.error) return result.error;
  const coverPhotoId = nullableId(body.coverPhotoId);
  if (coverPhotoId) {
    const photo = await firestore.collection(DOCUMENTS).doc(coverPhotoId).get();
    if (!photo.exists || photo.data()?.projectId !== actor.projectId || photo.data()?.purchaseId !== current.id || photo.data()?.deletedAt) return NextResponse.json({ error: "La foto de portada no pertenece a esta compra" }, { status: 400 });
  }
  try { await commitActivity(actor, { category: "expense", action: "expense.purchase_updated", target: { type: "purchase", id: current.id, label: result.record!.title, section: "expenses" }, changes: [{ field: "purchase", before: current.data()?.title, after: result.record!.title }] }, (transaction) => transaction.set(ref, { ...result.record, coverPhotoId, updatedBy: actor.email, updatedAt: FieldValue.serverTimestamp() }, { merge: true }), async (transaction) => {
    const latest = await transaction.get(ref);
    if (!latest.exists || latest.data()?.projectId !== actor.projectId || latest.data()?.deletedAt) throw new PurchaseConflict("La compra ya no está disponible");
    const documents = await transaction.get(firestore.collection(EXPENSE_DOCUMENTS).where("projectId", "==", actor.projectId));
    const payments = await transaction.get(firestore.collection(EXPENSE_PAYMENTS).where("projectId", "==", actor.projectId));
    const linkedPayments = payments.docs.filter((item) => !item.data().deletedAt && item.data().purchaseId === ref.id);
    if (result.record!.outsideObjective && linkedPayments.some((item) => nullableId(item.data().budgetLineId))) throw new PurchaseConflict("Desasigná del presupuesto los pagos de esta compra antes de marcarla fuera de objetivo.");
    if (linkedPayments.length && cleanExpenseCurrency(latest.data()?.currency) !== result.record!.currency) throw new PurchaseConflict("No se puede cambiar la moneda de una compra con pagos activos.");
    if (linkedPayments.some((item) => cleanExpenseCurrency(item.data().currency) !== result.record!.currency)) throw new PurchaseConflict("La moneda de un pago existente no coincide con la compra.");
    const paid = Math.round(linkedPayments.reduce((sum, item) => item.data().accountingMode === "ledger" ? sum + Number(item.data().amount || 0) : sum, 0) * 100) / 100;
    if (paid > 0 && (result.record!.amount !== null && result.record!.amount < paid || result.record!.amount === null && typeof latest.data()?.amount === "number")) throw new PurchaseConflict("El total acordado no puede ser menor que los pagos registrados ni quitarse mientras existan pagos.");
    const conflict = documents.docs.some((item) => {
      if (item.data().deletedAt || item.data().purchaseId !== ref.id) return false;
      const lineIds = cleanExpenseBudgetLineIds(item.data().budgetLineIds, item.data().budgetLineId);
      return result.record!.outsideObjective ? lineIds.length > 0 : Boolean(result.record!.budgetLineId && lineIds.length && !lineIds.includes(result.record!.budgetLineId));
    });
    if (conflict) throw new PurchaseConflict("Revisá las partidas de los comprobantes vinculados antes de cambiar la clasificación de esta compra.");
  }); } catch (error) { if (error instanceof PurchaseConflict) return NextResponse.json({ error: error.message }, { status: 409 }); throw error; }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const actor = await requireTabAccess("expenses", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Expenses editor access required" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id") || "";
  const ref = firestore.collection(PURCHASES).doc(id);
  const current = await ref.get();
  if (!current.exists || current.data()?.projectId !== actor.projectId || current.data()?.deletedAt) return NextResponse.json({ error: "Compra no encontrada" }, { status: 404 });
  await lockProjectCurrency(actor.projectId);
  const [documents, media] = await Promise.all([firestore.collection(EXPENSE_DOCUMENTS).where("projectId", "==", actor.projectId).get(), projectMedia(actor.projectId)]);
  await commitActivity(actor, { category: "expense", action: "expense.purchase_deleted", target: { type: "purchase", id, label: String(current.data()?.title || "Compra"), section: "expenses", exists: false }, changes: [{ field: "deleted", before: false, after: true }] }, (transaction) => {
    transaction.set(ref, { deletedAt: FieldValue.serverTimestamp(), deletedBy: actor.email, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    for (const item of documents.docs.filter((item) => !item.data().deletedAt && item.data().purchaseId === id)) transaction.set(item.ref, { purchaseId: null, purchaseTitle: "", updatedBy: actor.email, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    for (const item of media.filter((item) => item.data().source === "expense_purchase" && item.data().purchaseId === id)) transaction.set(item.ref, { deletedAt: FieldValue.serverTimestamp(), deletedBy: actor.email, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  return NextResponse.json({ ok: true, recoverable: true, comprobantesPreserved: true });
}
