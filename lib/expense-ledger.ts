import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import type ExcelJS from "exceljs";
import { firestore, projectBucket } from "./firebase-admin";
import { CONFIG, EXPENSE_PAYMENTS, projectConfigDoc, projectStoragePrefix } from "./project";
import { lockProjectCurrency, readProjectCurrency, validateProjectCurrency } from "./project-currency";
import type { ProjectCurrency } from "./currency";
import { applyExpensePaymentsToBudget } from "./expense-records";
import { addPaymentWorkbookProjection, assertHistoricalPaidUnchangedForLedger, type WorkbookPayment } from "./payment-workbook";
import { BUDGET_COLUMNS, BUDGET_SHEET, loadWorkbook, readBudgetLines, writeWorkbook } from "./workbook";

export class PaymentLedgerConflict extends Error {
  constructor(message = "Los pagos o el presupuesto cambiaron. Actualizá antes de guardar.") { super(message); }
}

export type PaymentLedgerState = {
  paymentsModelVersion: 1 | 2;
  paymentLedgerRevision: number;
  paymentProjectedLedgerRevision: number;
  paymentProjectionPending: boolean;
  objectKey: string;
  planVersion: number;
  actualsRevision: number;
};

const revision = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
export function paymentLedgerState(data: Record<string, unknown> = {}): PaymentLedgerState {
  return {
    paymentsModelVersion: data.paymentsModelVersion === 2 ? 2 : 1,
    paymentLedgerRevision: revision(data.paymentLedgerRevision),
    paymentProjectedLedgerRevision: revision(data.paymentProjectedLedgerRevision),
    paymentProjectionPending: data.paymentProjectionPending === true,
    objectKey: String(data.workbookObjectKey || ""),
    planVersion: Number(data.workbookPlanVersion || 1), actualsRevision: Number(data.workbookActualsRevision || 0),
  };
}

export async function readPaymentLedgerState(projectId: string) {
  return paymentLedgerState((await firestore.collection(CONFIG).doc(projectConfigDoc(projectId)).get()).data());
}

const sameSource = (left: PaymentLedgerState, right: PaymentLedgerState) => left.paymentsModelVersion === right.paymentsModelVersion && left.objectKey === right.objectKey
  && left.paymentLedgerRevision === right.paymentLedgerRevision && left.planVersion === right.planVersion && left.actualsRevision === right.actualsRevision;

/** Both payment models validate their financial source and denomination before mutation. */
export function paymentLedgerMutation(projectId: string, expected: PaymentLedgerState, currency: ProjectCurrency) {
  const ref = firestore.collection(CONFIG).doc(projectConfigDoc(projectId));
  return {
    validate: async (transaction: FirebaseFirestore.Transaction) => {
      await validateProjectCurrency(transaction, projectId, currency);
      const current = paymentLedgerState((await transaction.get(ref)).data());
      if (!sameSource(current, expected)) throw new PaymentLedgerConflict();
    },
    write: (transaction: FirebaseFirestore.Transaction) => {
      if (expected.paymentsModelVersion === 2) transaction.set(ref, { paymentLedgerRevision: expected.paymentLedgerRevision + 1, paymentProjectionPending: true }, { merge: true });
    },
  };
}

/** Prepare outside the transaction; validate its exact source/revision before writing. */
export async function prepareWorkbookPaymentChange(projectId: string, baselineWorkbook: ExcelJS.Workbook, proposedWorkbook: ExcelJS.Workbook, options: { restorePlanOnly?: boolean } = {}) {
  const currency = await lockProjectCurrency(projectId);
  const expected = await readPaymentLedgerState(projectId);
  const snapshot = await firestore.collection(EXPENSE_PAYMENTS).where("projectId", "==", projectId).get();
  const payments: WorkbookPayment[] = snapshot.docs.map((document) => ({ ...document.data(), id: document.id }));
  const configRef = firestore.collection(CONFIG).doc(projectConfigDoc(projectId));
  if (expected.paymentsModelVersion !== 2) {
    assertHistoricalPaidUnchangedForLedger(proposedWorkbook, baselineWorkbook, payments);
    return { paymentsModelVersion: 1 as const, revision: expected.paymentLedgerRevision,
      validate: async (transaction: FirebaseFirestore.Transaction) => {
        await validateProjectCurrency(transaction, projectId, currency);
        const current = paymentLedgerState((await transaction.get(configRef)).data());
        if (!sameSource(current, expected)) throw new PaymentLedgerConflict();
      }, write: (transaction: FirebaseFirestore.Transaction) => { void transaction; },
    };
  }
  const baseline = readBudgetLines(baselineWorkbook), proposed = readBudgetLines(proposedWorkbook);
  const before = new Map(baseline.map((line) => [line.id, line]));
  const proposedIds = new Set(proposed.map((line) => line.id));
  const active = payments.filter((payment) => !payment.deletedAt && typeof payment.amount === "number" && Number.isFinite(payment.amount) && payment.amount > 0);
  if (active.some((payment) => typeof payment.budgetLineId === "string" && before.has(payment.budgetLineId) && !proposedIds.has(payment.budgetLineId)))
    throw new PaymentLedgerConflict("La partida tiene pagos registrados. Reasigná sus pagos antes de eliminarla.");
  const totals = new Map(applyExpensePaymentsToBudget(proposed, active, { paymentsModelVersion: 2, currency }).map((line) => [line.id, line.paid]));
  const imports: Array<{ id: string; record: Record<string, unknown> }> = [];
  for (const line of proposed) {
    const canonical = totals.get(line.id) || 0;
    const unchanged = Math.round(line.paid * 100) === Math.round((before.get(line.id)?.paid || 0) * 100);
    if (!options.restorePlanOnly && !unchanged) {
      if (!Number.isFinite(line.paid) || line.paid < 0 || line.paid > 1_000_000_000_000) throw new PaymentLedgerConflict("El importe pagado de Excel no es válido.");
      if (Math.round(line.paid * 100) < Math.round(canonical * 100)) throw new PaymentLedgerConflict("Excel indica menos que los pagos registrados. Revisá o corregí los pagos antes de reducir el total.");
      const gap = (Math.round(line.paid * 100) - Math.round(canonical * 100)) / 100;
      if (gap > 0) {
        const id = createHash("sha256").update(JSON.stringify(["excel-import-v2", projectId, expected.objectKey, expected.paymentLedgerRevision, line.id, Math.round(line.paid * 100)])).digest("hex");
        imports.push({ id, record: { projectId, currency, budgetLineId: line.id, budgetLineLabel: line.item, amount: gap,
          source: "excel-import", sourceLabel: "Pago de Excel sin detalle", sourceWorkbookObjectKey: expected.objectKey,
          sourceObservedTotal: line.paid, sourcePreviousTotal: before.get(line.id)?.paid || 0, sourceLedgerRevision: expected.paymentLedgerRevision,
          accountingMode: "ledger", purchaseId: null, purchaseTitle: "", paymentKind: "partial", documentIds: [], documents: [], documentId: null, documentTitle: "", documentType: null,
          paymentDate: "", payee: "", reference: "", notes: "", deletedAt: null, createdBy: "Excel", updatedBy: "Excel", createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() } });
      }
    }
    proposedWorkbook.getWorksheet(BUDGET_SHEET)!.getCell(line.row, BUDGET_COLUMNS.paid).value = canonical + (imports.find((payment) => payment.record.budgetLineId === line.id)?.record.amount as number || 0);
  }
  if (imports.length > 350) throw new PaymentLedgerConflict("Esta importación contiene demasiados pagos nuevos. Dividí la carga antes de continuar.");
  const nextRevision = expected.paymentLedgerRevision + (imports.length ? 1 : 0);
  return { paymentsModelVersion: 2 as const, revision: expected.paymentLedgerRevision,
    validate: async (transaction: FirebaseFirestore.Transaction) => {
      await validateProjectCurrency(transaction, projectId, currency);
      if (!sameSource(paymentLedgerState((await transaction.get(configRef)).data()), expected)) throw new PaymentLedgerConflict();
      for (const payment of imports) if ((await transaction.get(firestore.collection(EXPENSE_PAYMENTS).doc(payment.id))).exists) throw new PaymentLedgerConflict("La importación ya fue registrada. Actualizá el presupuesto.");
    },
    write: (transaction: FirebaseFirestore.Transaction) => {
      for (const payment of imports) transaction.set(firestore.collection(EXPENSE_PAYMENTS).doc(payment.id), payment.record);
      transaction.set(configRef, { paymentLedgerRevision: nextRevision, paymentProjectionPending: true }, { merge: true });
    },
  };
}

/** Durable outbox: a failed projection never rolls back an accepted payment. */
export async function flushPaymentProjection(projectId: string) {
  const expected = await readPaymentLedgerState(projectId);
  if (expected.paymentsModelVersion !== 2 || !expected.paymentProjectionPending) return expected;
  if (!projectBucket || !expected.objectKey) throw new PaymentLedgerConflict("La proyección de pagos está pendiente porque el presupuesto no está disponible.");
  const [[bytes], snapshot] = await Promise.all([projectBucket.file(expected.objectKey).download(), firestore.collection(EXPENSE_PAYMENTS).where("projectId", "==", projectId).get()]);
  const workbook = await loadWorkbook(bytes);
  const payments = snapshot.docs.map((document) => ({ ...document.data(), id: document.id }));
  addPaymentWorkbookProjection(workbook, payments, { currency: await readProjectCurrency(projectId), paymentsModelVersion: 2, paymentLedgerRevision: expected.paymentLedgerRevision, includePaymentDetails: false });
  const digest = createHash("sha256").update(expected.objectKey).digest("hex").slice(0, 20);
  const objectKey = `${projectStoragePrefix(projectId)}/workbooks/versions/payments-${expected.paymentLedgerRevision}-${digest}.xlsx`;
  try {
    await projectBucket.file(objectKey).save(await writeWorkbook(workbook), { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", resumable: false, preconditionOpts: { ifGenerationMatch: 0 } });
  } catch (error) { if ((error as { code?: number }).code !== 412) throw error; }
  await firestore.runTransaction(async (transaction) => {
    const ref = firestore.collection(CONFIG).doc(projectConfigDoc(projectId));
    const current = paymentLedgerState((await transaction.get(ref)).data());
    if (!sameSource(current, expected)) throw new PaymentLedgerConflict();
    transaction.set(ref, { workbookObjectKey: objectKey, paymentProjectedLedgerRevision: expected.paymentLedgerRevision, paymentProjectionPending: false }, { merge: true });
  });
  return { ...expected, objectKey, paymentProjectedLedgerRevision: expected.paymentLedgerRevision, paymentProjectionPending: false };
}
