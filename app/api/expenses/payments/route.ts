import { isProjectCurrency, projectCurrency, type ProjectCurrency } from "@/lib/currency";
import { lockProjectCurrency, readProjectCurrency } from "@/lib/project-currency";
import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { commitActivity } from "@/lib/activity";
import { requireTabAccess } from "@/lib/auth";
import { expenseIso, validatePaidBudgetLine, validateExpenseBudgetLine, legacyExpenseDocuments } from "@/lib/expense-api";
import { expensePaymentDocumentIds, cleanExpenseAmount, cleanExpenseDate, cleanExpenseDocumentType, cleanExpenseNotes, cleanExpenseText } from "@/lib/expense-records";
import { firestore } from "@/lib/firebase-admin";
import { EXPENSE_DOCUMENTS, EXPENSE_PAYMENTS, EXPENSE_PAYMENT_STATUSES, PURCHASES, DOCUMENTS, BUDGET_LINES, CONFIG, projectConfigDoc, projectScopedId } from "@/lib/project";
import { PaymentLedgerConflict, paymentLedgerMutation, readPaymentLedgerState } from "@/lib/expense-ledger";

type Body = {
  expectedCurrency?: unknown;
  paymentsModelVersion?: unknown;
  purchaseId?: unknown;
  documentIds?: unknown;
  paymentKind?: unknown;
  accountingMode?: unknown;
  clientMutationId?: unknown;
  action?: unknown;
  complete?: unknown;
  id?: unknown;
  budgetLineId?: unknown;
  amount?: unknown;
  paymentDate?: unknown;
  payee?: unknown;
  reference?: unknown;
  notes?: unknown;
  documentId?: unknown;
};

const nullableId = (value: unknown) => typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null;
const statusId = (projectId: string, budgetLineId: string) => createHash("sha256").update(`${projectId}:${budgetLineId}`).digest("hex");
const currencyChangedResponse = () => NextResponse.json({
  error: "Project currency changed. Refresh before saving this payment.",
  code: "project_currency_changed",
}, { status: 409 });
function currencyExpectation(body: Body, currency: ProjectCurrency) {
  if (body.expectedCurrency === undefined) return currency === "USD" ? currencyChangedResponse() : null;
  if (!isProjectCurrency(body.expectedCurrency)) return NextResponse.json({ error: "Moneda esperada inválida" }, { status: 400 });
  if (body.expectedCurrency !== currency) return NextResponse.json({ error: `La moneda del proyecto cambió a ${currency}. Actualizá antes de registrar el pago.` }, { status: 409 });
  return null;
}

type AccountingMode = "ledger" | "historical-detail";
const accountingMode = (record: Record<string, unknown>): AccountingMode => record.accountingMode === "ledger" ? "ledger" : "historical-detail";

async function normalized(projectId: string, body: Body, currency: ProjectCurrency, previousMode: AccountingMode = "ledger", unified = false) {
  if (!unified && body.accountingMode !== undefined && body.accountingMode !== "ledger" && body.accountingMode !== "historical-detail")
    return { error: NextResponse.json({ error: "Seleccioná si el pago es nuevo o ya estaba incluido en Excel" }, { status: 400 }) };
  const mode = unified || body.accountingMode === undefined ? previousMode : body.accountingMode as AccountingMode;
  const budgetLineId = nullableId(body.budgetLineId);
  const line = budgetLineId ? await validateExpenseBudgetLine(projectId, budgetLineId) : null;
  if (budgetLineId && !line) return { error: NextResponse.json({ error: "La partida seleccionada no existe en este proyecto" }, { status: 400 }) };
  const amount = cleanExpenseAmount(body.amount);
  if (amount === null || amount <= 0) return { error: NextResponse.json({ error: "Ingresá un monto de pago mayor que cero" }, { status: 400 }) };
  if (!unified && mode === "historical-detail" && (!line || !Number.isFinite(line.workbookPaid) || line.workbookPaid <= 0))
    return { error: NextResponse.json({ error: "Para detallar un pago ya incluido en Excel, elegí una partida con pagado histórico mayor que cero" }, { status: 400 }) };
  if (body.paymentDate && !cleanExpenseDate(body.paymentDate)) return { error: NextResponse.json({ error: "Ingresá una fecha de pago válida" }, { status: 400 }) };
  if (body.documentIds !== undefined && (!Array.isArray(body.documentIds) || body.documentIds.length > 50 || body.documentIds.some((id) => typeof id !== "string" || !id.trim())))
    return { error: NextResponse.json({ error: "Lista de comprobantes inválida" }, { status: 400 }) };
  const documentIds = expensePaymentDocumentIds(body);
  const documents = [];
  const legacy = documentIds.some((id) => id.startsWith("legacy:")) ? await legacyExpenseDocuments(projectId) : [];
  for (const id of documentIds) {
    if (id.startsWith("legacy:")) {
      const document = legacy.find((item) => item.id === id);
      if (!document) return { error: NextResponse.json({ error: "Comprobante existente no disponible" }, { status: 400 }) };
      documents.push({ id, title: document.title, documentType: document.documentType });
      continue;
    }
    const document = await firestore.collection(EXPENSE_DOCUMENTS).doc(id).get();
    if (!document.exists || document.data()?.projectId !== projectId || document.data()?.deletedAt)
      return { error: NextResponse.json({ error: "El comprobante seleccionado no existe en este proyecto" }, { status: 400 }) };
    documents.push({ id, title: String(document.data()?.title || "Comprobante"), documentType: cleanExpenseDocumentType(document.data()?.documentType) });
  }
  const purchaseId = nullableId(body.purchaseId);
  const purchase = purchaseId ? await firestore.collection(PURCHASES).doc(purchaseId).get() : null;
  if (purchaseId && (!purchase?.exists || purchase.data()?.projectId !== projectId || purchase.data()?.deletedAt))
    return { error: NextResponse.json({ error: "La compra seleccionada no existe en este proyecto" }, { status: 400 }) };
  if (purchase?.data()?.outsideObjective === true && budgetLineId) return { error: NextResponse.json({ error: "Una compra fuera de objetivo no puede asignar sus pagos al presupuesto" }, { status: 409 }) };
  if (purchase && projectCurrency(purchase.data()?.currency) !== currency) return { error: NextResponse.json({ error: `Los pagos se registran en ${currency}. La compra debe tener la misma moneda para calcular su saldo.` }, { status: 400 }) };
  const paymentKind = body.paymentKind === "settlement" ? "settlement" as const : "partial" as const;
  // Independent full payments use the entered amount; linked balances are checked by purchaseGuard.
  const firstDocument = documents[0];
  return { record: {
    currency, budgetLineId, accountingMode: mode,
    budgetLineLabel: line?.label || "",
    purchaseId, purchaseTitle: purchase ? String(purchase.data()?.title || "") : "", paymentKind, documentIds, documents,
    amount,
    paymentDate: cleanExpenseDate(body.paymentDate),
    payee: cleanExpenseText(body.payee, 160),
    reference: cleanExpenseText(body.reference, 160),
    notes: cleanExpenseNotes(body.notes),
    documentId: firstDocument?.id || null,
    documentTitle: firstDocument?.title || "",
    documentType: firstDocument?.documentType || null,
  }, line };
}

async function payload(projectId: string) {
  const [payments, documents, statuses, legacy, ledgerState, currency] = await Promise.all([
    firestore.collection(EXPENSE_PAYMENTS).where("projectId", "==", projectId).get(),
    firestore.collection(EXPENSE_DOCUMENTS).where("projectId", "==", projectId).get(),
    firestore.collection(EXPENSE_PAYMENT_STATUSES).where("projectId", "==", projectId).get(),
    legacyExpenseDocuments(projectId),
    readPaymentLedgerState(projectId),
    readProjectCurrency(projectId),
  ]);
  const activeDocuments = new Map(documents.docs.filter((item) => !item.data().deletedAt).map((item) => [item.id, item.data()]));
  for (const document of legacy) activeDocuments.set(document.id, document);
  return { currency, payments: payments.docs.filter((item) => !item.data().deletedAt).map((item) => {
    const data = item.data();
    const documentIds = expensePaymentDocumentIds(data).filter((id) => activeDocuments.has(id));
    const linkedDocuments = documentIds.map((id) => ({ id, title: String(activeDocuments.get(id)?.title || "Comprobante"), documentType: cleanExpenseDocumentType(activeDocuments.get(id)?.documentType) }));
    const documentId = documentIds[0] || null;
    const document = documentId ? activeDocuments.get(documentId) : undefined;
    return {
      id: item.id, currency: projectCurrency(data.currency),
      source: data.source === "excel-import" ? "excel-import" : "user", sourceLabel: String(data.sourceLabel || ""),
      budgetLineId: nullableId(data.budgetLineId),
      purchaseId: nullableId(data.purchaseId), purchaseTitle: String(data.purchaseTitle || ""),
      paymentKind: data.paymentKind === "settlement" ? "settlement" : "partial",
      accountingMode: data.accountingMode === "ledger" ? "ledger" : "historical-detail", documentIds, documents: linkedDocuments,
      budgetLineLabel: String(data.budgetLineLabel || ""),
      amount: Number(data.amount || 0),
      paymentDate: String(data.paymentDate || ""),
      payee: String(data.payee || ""),
      reference: String(data.reference || ""),
      notes: String(data.notes || ""),
      documentId: document ? documentId : null,
      documentTitle: document ? String(document.title || "Comprobante") : "",
      documentType: document ? cleanExpenseDocumentType(document.documentType) : null,
      createdAt: expenseIso(data.createdAt),
      updatedAt: expenseIso(data.updatedAt),
    };
  }).sort((a, b) => (b.paymentDate || b.createdAt).localeCompare(a.paymentDate || a.createdAt)),
  completedLineIds: ledgerState.paymentsModelVersion === 2 ? [] : statuses.docs.filter((item) => item.data().complete === true).map((item) => String(item.data().budgetLineId || "")).filter(Boolean),
  paymentsModelVersion: ledgerState.paymentsModelVersion, paymentLedgerRevision: ledgerState.paymentLedgerRevision, paymentProjectionPending: ledgerState.paymentProjectionPending,
  };
}

class PaymentConflict extends Error {}
const refreshRequired = () => NextResponse.json({ error: "El modelo de pagos cambió. Recargá la página antes de guardar.", code: "refresh_required" }, { status: 409 });
const noHistory = { validate: async (transaction: FirebaseFirestore.Transaction) => { void transaction; }, write: (transaction: FirebaseFirestore.Transaction) => { void transaction; } };
async function validatePaymentReceipts(transaction: FirebaseFirestore.Transaction, projectId: string, ids: string[]) {
  for (const id of ids) {
    const legacy = id.startsWith("legacy:");
    const source = legacy ? id.slice(7) : id;
    const receipt = await transaction.get(firestore.collection(legacy ? DOCUMENTS : EXPENSE_DOCUMENTS).doc(source));
    if (!receipt.exists || receipt.data()?.projectId !== projectId || receipt.data()?.deletedAt)
      throw new PaymentConflict("Un comprobante cambió o se eliminó. Actualizá la lista antes de guardar.");
  }
}
class DuplicatePayment extends Error { constructor(public id: string) { super("duplicate"); } }
function samePayment(data: Record<string, unknown>, record: Record<string, unknown>) {
  return projectCurrency(data.currency) === projectCurrency(record.currency) && accountingMode(data) === accountingMode(record) && ["amount", "budgetLineId", "purchaseId", "paymentDate", "payee", "reference", "notes", "paymentKind"].every((key) => (data[key] ?? null) === (record[key] ?? null)) && JSON.stringify(expensePaymentDocumentIds(data)) === JSON.stringify(expensePaymentDocumentIds(record));
}

type ValidatedBudgetLine = NonNullable<Awaited<ReturnType<typeof validateExpenseBudgetLine>>>;
/** Serialize allocation and release of the historical amount for each budget line. */
function historicalGuard(projectId: string, record: { currency: ProjectCurrency; accountingMode: AccountingMode; budgetLineId: string | null; amount: number } | null, line: ValidatedBudgetLine | null, previous?: Record<string, unknown>, excludeId = "") {
  const lineIds = [...new Set([
    record?.accountingMode === "historical-detail" ? record.budgetLineId : null,
    previous && accountingMode(previous) === "historical-detail" ? nullableId(previous.budgetLineId) : null,
  ].filter((id): id is string => Boolean(id)))].sort();
  const guards = lineIds.map((budgetLineId) => ({ budgetLineId, ref: firestore.collection(EXPENSE_PAYMENT_STATUSES).doc(statusId(projectId, budgetLineId)), revision: 0 }));
  return {
    validate: async (transaction: FirebaseFirestore.Transaction) => {
      for (const guard of guards) {
        const status = await transaction.get(guard.ref);
        if (status.exists && (status.data()?.projectId !== projectId || status.data()?.budgetLineId !== guard.budgetLineId)) throw new PaymentConflict("Estado histórico de pago inválido");
        guard.revision = Number(status.data()?.historicalDetailsRevision || 0);
      }
      if (record?.accountingMode !== "historical-detail") return;
      if (!line || !record.budgetLineId) throw new PaymentConflict("La partida del histórico ya no está disponible");
      const [config, source] = await Promise.all([
        transaction.get(firestore.collection(CONFIG).doc(projectConfigDoc(projectId))),
        transaction.get(firestore.collection(BUDGET_LINES).doc(projectScopedId(projectId, record.budgetLineId))),
      ]);
      const sourceData = source.data();
      if (!config.exists || Number(config.data()?.workbookPlanVersion || 1) !== line.planVersion || Number(config.data()?.workbookActualsRevision || 0) !== line.actualsRevision
        || !source.exists || sourceData?.projectId !== projectId || sourceData?.id !== record.budgetLineId
        || Number(sourceData?.planVersion) !== line.planVersion || Number(sourceData?.actualsRevision || 0) !== line.actualsRevision
        || !Number.isFinite(sourceData?.paid) || sourceData?.paid !== line.workbookPaid)
        throw new PaymentConflict("El histórico de Excel cambió. Actualizá el presupuesto antes de detallar el pago.");
      const payments = await transaction.get(firestore.collection(EXPENSE_PAYMENTS).where("projectId", "==", projectId));
      const allocated = payments.docs.reduce((sum, item) => {
        const data = item.data();
        if (item.id !== excludeId && !data.deletedAt && data.budgetLineId === record.budgetLineId && accountingMode(data) === "historical-detail" && projectCurrency(data.currency) !== record.currency) throw new PaymentConflict("La moneda del histórico no coincide con el proyecto");
        return item.id !== excludeId && !data.deletedAt && data.budgetLineId === record.budgetLineId && accountingMode(data) === "historical-detail" && typeof data.amount === "number" && Number.isFinite(data.amount) && data.amount > 0
          ? sum + Math.round(data.amount * 100) : sum;
      }, 0);
      const remaining = Math.round(line.workbookPaid * 100) - allocated;
      if (Math.round(record.amount * 100) > remaining) throw new PaymentConflict("El importe supera el histórico de Excel disponible para detallar. Revisá los pagos ya incluidos antes de guardar.");
    },
    write: (transaction: FirebaseFirestore.Transaction) => {
      for (const guard of guards) transaction.set(guard.ref, { projectId, budgetLineId: guard.budgetLineId, historicalDetailsRevision: guard.revision + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    },
  };
}
function purchaseGuard(projectId: string, record: { currency: ProjectCurrency; purchaseId: string | null; budgetLineId: string | null; amount: number; paymentKind: string }, excludeId = "") {
  const ref = record.purchaseId ? firestore.collection(PURCHASES).doc(record.purchaseId) : null;
  let revision = 0;
  return { ref, revision: () => revision, validate: ref ? async (transaction: FirebaseFirestore.Transaction) => {
    const purchase = await transaction.get(ref);
    if (!purchase.exists || purchase.data()?.projectId !== projectId || purchase.data()?.deletedAt) throw new PaymentConflict("La compra ya no está disponible");
    if (projectCurrency(purchase.data()?.currency) !== record.currency) throw new PaymentConflict(`La moneda de la compra cambió. Revisá el total en ${record.currency} antes de registrar el pago.`);
    if (purchase.data()?.outsideObjective === true && record.budgetLineId) throw new PaymentConflict("Una compra fuera de objetivo no puede asignar sus pagos al presupuesto");
    revision = Number(purchase.data()?.paymentsRevision || 0);
    const payments = await transaction.get(firestore.collection(EXPENSE_PAYMENTS).where("projectId", "==", projectId));
    const total = purchase.data()?.amount;
    if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) {
      if (record.paymentKind === "settlement") throw new PaymentConflict("Confirmá el total acordado de la compra antes de liquidar el saldo");
      return;
    }
    const paid = payments.docs.reduce((sum, item) => {
      const data = item.data();
      if (data.deletedAt || item.id === excludeId || data.purchaseId !== record.purchaseId) return sum;
      if (projectCurrency(data.currency) !== record.currency) throw new PaymentConflict("La moneda de un pago existente no coincide con la compra");
      return sum + Number(data.amount || 0);
    }, 0);
    const remaining = Math.round((total - paid) * 100) / 100;
    if (record.amount > remaining || record.paymentKind === "settlement" && (remaining <= 0 || Math.abs(record.amount - remaining) > .005))
      throw new PaymentConflict("El saldo de la compra cambió. Actualizá los pagos y revisá el monto antes de guardar.");
  } : undefined };
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
  const state = await readPaymentLedgerState(actor.projectId), unified = state.paymentsModelVersion === 2;
  if (unified && body.paymentsModelVersion !== 2) return refreshRequired();
  const currency = await lockProjectCurrency(actor.projectId);
  const currencyError = currencyExpectation(body, currency);
  if (currencyError) return currencyError;
  const ledger = paymentLedgerMutation(actor.projectId, state, currency);
  const result = await normalized(actor.projectId, body, currency, "ledger", unified);
  if (result.error) return result.error;
  const mutationId = nullableId(body.clientMutationId);
  if (mutationId && !/^[a-zA-Z0-9_-]{8,100}$/.test(mutationId)) return NextResponse.json({ error: "Identificador de pago inválido" }, { status: 400 });
  const id = mutationId ? createHash("sha256").update(`${actor.projectId}:${mutationId}`).digest("hex") : undefined;
  const ref = id ? firestore.collection(EXPENSE_PAYMENTS).doc(id) : firestore.collection(EXPENSE_PAYMENTS).doc();
  const existing = id ? await ref.get() : null;
  if (existing?.exists) {
    if (existing.data()?.projectId !== actor.projectId || existing.data()?.deletedAt) return NextResponse.json({ error: "El pago ya no está disponible" }, { status: 409 });
    if (!samePayment(existing.data()!, result.record!)) return NextResponse.json({ error: "Este identificador ya pertenece a otro pago" }, { status: 409 });
    return NextResponse.json({ id: ref.id, duplicate: true });
  }
  const guard = purchaseGuard(actor.projectId, result.record!);
  const history = unified ? noHistory : historicalGuard(actor.projectId, result.record!, result.line || null);
  try { await commitActivity(actor, {
    category: "expense", action: "expense.payment_created",
    target: { type: "expense_payment", id: ref.id, label: result.record!.payee || result.record!.budgetLineLabel, section: "expenses" },
    summaryParams: { amount: result.record!.amount },
    changes: [{ field: "payment", before: null, after: result.record!.amount, format: result.record!.currency === "USD" ? "currency_usd" : "currency_crc" }, { field: "accounting_mode", before: null, after: result.record!.accountingMode }],
  }, (transaction) => {
    transaction.set(ref, { projectId: actor.projectId, ...result.record, ...(unified ? { source: "user" } : {}), createdBy: actor.email, createdAt: FieldValue.serverTimestamp(), updatedBy: actor.email, updatedAt: FieldValue.serverTimestamp(), deletedAt: null });
    if (guard.ref) transaction.set(guard.ref, { paymentsRevision: guard.revision() + 1 }, { merge: true });
    history.write(transaction);
    ledger.write(transaction);
  }, async (transaction) => {
    const stored = await transaction.get(ref);
    if (stored.exists) {
      if (stored.data()?.projectId === actor.projectId && !stored.data()?.deletedAt && samePayment(stored.data()!, result.record!)) throw new DuplicatePayment(ref.id);
      throw new PaymentConflict("Este identificador ya pertenece a otro pago");
    }
    await guard.validate?.(transaction);
    await history.validate(transaction);
    await ledger.validate(transaction);
    await validatePaymentReceipts(transaction, actor.projectId, result.record!.documentIds);
  }); } catch (error) {
    if (error instanceof DuplicatePayment) return NextResponse.json({ id: error.id, duplicate: true });
    if (error instanceof Error && error.message === "project_currency_changed") return currencyChangedResponse();
    if (error instanceof PaymentConflict || error instanceof PaymentLedgerConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
  return NextResponse.json({ id: ref.id }, { status: 201 });
}

export async function PATCH(request: Request) {
  const actor = await requireTabAccess("expenses", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Expenses editor access required" }, { status: 403 });
  const body = await request.json() as Body;
  const state = await readPaymentLedgerState(actor.projectId), unified = state.paymentsModelVersion === 2;
  if (unified && body.paymentsModelVersion !== 2) return refreshRequired();
  const currency = await lockProjectCurrency(actor.projectId);
  const currencyError = currencyExpectation(body, currency);
  if (currencyError) return currencyError;
  const ledger = paymentLedgerMutation(actor.projectId, state, currency);
  if (body.action === "set-complete") {
    if (unified) return NextResponse.json({ error: "El historial se administra directamente desde los pagos." }, { status: 400 });
    const budgetLineId = nullableId(body.budgetLineId);
    if (!budgetLineId) return NextResponse.json({ error: "Seleccioná una partida pagada" }, { status: 400 });
    const line = await validatePaidBudgetLine(actor.projectId, budgetLineId);
    if (!line) return NextResponse.json({ error: "Solo se puede marcar una partida con Precio pagado mayor que cero" }, { status: 400 });
    const complete = body.complete === true;
    const ref = firestore.collection(EXPENSE_PAYMENT_STATUSES).doc(statusId(actor.projectId, budgetLineId));
    const current = await ref.get();
    if (current.exists && (current.data()?.projectId !== actor.projectId || current.data()?.budgetLineId !== budgetLineId))
      return NextResponse.json({ error: "Estado de pago inválido" }, { status: 409 });
    try { await commitActivity(actor, {
      category: "expense", action: "expense.payment_status_updated",
      target: { type: "expense_payment_status", id: ref.id, label: line.label, section: "expenses" },
      changes: [{ field: "paid_complete", before: current.data()?.complete === true, after: complete }],
    }, (transaction) => transaction.set(ref, {
      projectId: actor.projectId,
      budgetLineId,
      budgetLineLabel: line?.label || "",

      complete,
      createdBy: current.exists ? current.data()?.createdBy : actor.email,
      createdAt: current.exists ? current.data()?.createdAt : FieldValue.serverTimestamp(),
      updatedBy: actor.email,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }), (transaction) => ledger.validate(transaction)); } catch (error) {
      if (error instanceof Error && error.message === "project_currency_changed") return currencyChangedResponse();
      if (error instanceof PaymentLedgerConflict) return NextResponse.json({ error: error.message }, { status: 409 });
      throw error;
    }
    return NextResponse.json({ ok: true, complete });
  }
  const ref = firestore.collection(EXPENSE_PAYMENTS).doc(String(body.id || ""));
  const current = await ref.get();
  if (!current.exists || current.data()?.projectId !== actor.projectId || current.data()?.deletedAt) return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 });
  if (projectCurrency(current.data()?.currency) !== currency) return NextResponse.json({ error: "La moneda del pago no coincide con el proyecto" }, { status: 409 });
  const update: Body = { ...current.data(), ...body };
  // A mode-only correction must retain its original receipts and other fields.
  // Legacy clients may still replace documentId without sending documentIds.
  if (body.documentIds === undefined && body.documentId !== undefined) delete update.documentIds;
  const result = await normalized(actor.projectId, update, currency, accountingMode(current.data()!), unified);
  if (result.error) return result.error;
  const guard = purchaseGuard(actor.projectId, result.record!, ref.id);
  const history = unified ? noHistory : historicalGuard(actor.projectId, result.record!, result.line || null, current.data(), ref.id);
  try { await commitActivity(actor, {
    category: "expense", action: "expense.payment_updated",
    target: { type: "expense_payment", id: ref.id, label: result.record!.payee || result.record!.budgetLineLabel, section: "expenses" },
    changes: [{ field: "amount", before: current.data()?.amount, after: result.record!.amount, format: result.record!.currency === "USD" ? "currency_usd" : "currency_crc" }, { field: "accounting_mode", before: accountingMode(current.data()!), after: result.record!.accountingMode }],
  }, (transaction) => {
    transaction.set(ref, { ...result.record, updatedBy: actor.email, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    if (guard.ref) transaction.set(guard.ref, { paymentsRevision: guard.revision() + 1 }, { merge: true });
    history.write(transaction);
    ledger.write(transaction);
  }, async (transaction) => {
    const latest = await transaction.get(ref);
    if (!latest.exists || latest.data()?.projectId !== actor.projectId || latest.data()?.deletedAt) throw new PaymentConflict("El pago ya no está disponible");
    if (!samePayment(latest.data()!, current.data()!)) throw new PaymentConflict("El pago cambió. Actualizá sus datos antes de guardar.");
    await guard.validate?.(transaction);
    await history.validate(transaction);
    await ledger.validate(transaction);
    await validatePaymentReceipts(transaction, actor.projectId, result.record!.documentIds);
  }); } catch (error) {
    if (error instanceof Error && error.message === "project_currency_changed") return currencyChangedResponse();
    if (error instanceof PaymentConflict || error instanceof PaymentLedgerConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const actor = await requireTabAccess("expenses", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Expenses editor access required" }, { status: 403 });
  const state = await readPaymentLedgerState(actor.projectId), unified = state.paymentsModelVersion === 2;
  const body = await request.json().catch(() => ({})) as Body;
  const version = body.paymentsModelVersion ?? Number(new URL(request.url).searchParams.get("paymentsModelVersion") || request.headers.get("X-Payments-Model"));
  if (unified && version !== 2) return refreshRequired();
  const id = new URL(request.url).searchParams.get("id") || "";
  const ref = firestore.collection(EXPENSE_PAYMENTS).doc(id);
  const current = await ref.get();
  if (!current.exists || current.data()?.projectId !== actor.projectId || current.data()?.deletedAt) return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 });
  const currency = await lockProjectCurrency(actor.projectId);
  const ledger = paymentLedgerMutation(actor.projectId, state, currency);
  const history = unified ? noHistory : historicalGuard(actor.projectId, null, null, current.data(), ref.id);
  try { await commitActivity(actor, {
    category: "expense", action: "expense.payment_deleted",
    target: { type: "expense_payment", id, label: String(current.data()?.payee || current.data()?.budgetLineLabel || "Pago"), section: "expenses", exists: false },
    changes: [{ field: "deleted", before: false, after: true }],
  }, (transaction) => {
    transaction.set(ref, { deletedAt: FieldValue.serverTimestamp(), deletedBy: actor.email, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.email }, { merge: true });
    history.write(transaction);
    ledger.write(transaction);
  }, async (transaction) => {
    const latest = await transaction.get(ref);
    if (!latest.exists || latest.data()?.projectId !== actor.projectId || latest.data()?.deletedAt || !samePayment(latest.data()!, current.data()!)) throw new PaymentConflict("El pago cambió. Actualizá sus datos antes de eliminarlo.");
    await history.validate(transaction);
    await ledger.validate(transaction);
  }); } catch (error) {
    if (error instanceof Error && error.message === "project_currency_changed") return currencyChangedResponse();
    if (error instanceof PaymentConflict || error instanceof PaymentLedgerConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
  return NextResponse.json({ ok: true, recoverable: true });
}
