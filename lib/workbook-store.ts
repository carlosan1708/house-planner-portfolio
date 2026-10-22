import { FieldValue } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { syncGoogleBudget } from "./google-budget";
import { readProjectCurrency } from "./project-currency";
import { paymentLedgerState } from "./expense-ledger";
import { applyExpensePaymentsToBudget, summarizeOutsideObjectivePurchases } from "./expense-records";
import { firestore, projectBucket } from "./firebase-admin";
import type { ExpenseAttachmentLink } from "./expenses";
import { PURCHASES, BUDGET_LINES, CATEGORY_SHEETS, CONFIG, EXPENSES, EXPENSE_PAYMENTS, LEGACY_PROJECT_ID, OVERRIDES, projectConfigDoc, projectScopedId, projectStoragePrefix } from "./project";
import { removePaymentWorkbookProjection, type WorkbookPayment } from "./payment-workbook";
import { applyLegacyOverrides, budgetLinesEqual, createStarterWorkbook, ensureBudgetProgressIndicators, generateCategoryWorkbook, loadWorkbook, readBudgetLines, scanUnsupportedFeatures, setWorkbookCurrency, toUniver, writeWorkbook, type BudgetLine, type GeneratedWorkbook, type UniverWorkbook, type WorkbookScope } from "./workbook";

export const DEFAULT_WORKBOOK_KEY = "house-planner/production/workbooks/synthetic-budget.xlsx";

export type StoredExpenseAttachmentLink = Pick<ExpenseAttachmentLink, "id" | "budgetLineId" | "documentId" | "createdAt" | "deletedAt" | "note">;

const serializableExpenseLink = (document: FirebaseFirestore.QueryDocumentSnapshot): StoredExpenseAttachmentLink | null => {
  const data = document.data();
  const date = (value: unknown) => value && typeof value === "object" && "toDate" in value ? (value as FirebaseFirestore.Timestamp).toDate().toISOString() : null;
  const documentId = String(data.receiptDocumentId || "");
  const budgetLineId = String(data.budgetLineId || "");
  if (!documentId || !budgetLineId || data.status === "void") return null;
  return { id: document.id, budgetLineId, documentId, createdAt: date(data.createdAt) || "", deletedAt: date(data.deletedAt), note: String(data.captureNote || "").slice(0, 500) };
};

export async function getExpenseAttachmentLinks(projectId: string) {
  const snapshot = await firestore.collection(EXPENSES).where("projectId", "==", projectId).get();
  return snapshot.docs.map(serializableExpenseLink).filter((link): link is StoredExpenseAttachmentLink => Boolean(link));
}

export async function getWorkbookPayments(projectId: string): Promise<WorkbookPayment[]> {
  const snapshot = await firestore.collection(EXPENSE_PAYMENTS).where("projectId", "==", projectId).get();
  return snapshot.docs.map((document) => ({ ...document.data(), id: document.id }));
}

export async function workbookConfig(projectId: string, options: { skipGoogleSync?: boolean } = {}) {
  if (!options.skipGoogleSync) await syncGoogleBudget(projectId);
  const ref = firestore.collection(CONFIG).doc(projectConfigDoc(projectId)); let snapshot = await ref.get();
  const currency = await readProjectCurrency(projectId);
  if (!snapshot.exists && projectId !== LEGACY_PROJECT_ID) {
    if (!projectBucket) throw new Error("Storage is unavailable");
    const objectKey = `${projectStoragePrefix(projectId)}/workbooks/starter.xlsx`;
    await projectBucket.file(objectKey).save(await writeWorkbook(createStarterWorkbook(currency)), { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", resumable: false });
    await ref.set({ projectId, workbookObjectKey: objectKey, workbookFileName: "Mi_Presupuesto.xlsx", workbookPlanVersion: 1, workbookActualsRevision: 0, currencyEditable: true, createdAt: FieldValue.serverTimestamp() });
    snapshot = await ref.get();
  }
  const data = snapshot.data() || {};
  return {
    currency,
    currencyEditable: data.currencyEditable === true && data.workbookObjectKey === `${projectStoragePrefix(projectId)}/workbooks/starter.xlsx`,
    objectKey: String(data.workbookObjectKey || (projectId === LEGACY_PROJECT_ID ? DEFAULT_WORKBOOK_KEY : "")),
    fileName: String(data.workbookFileName || (projectId === LEGACY_PROJECT_ID ? "synthetic-budget.xlsx" : "Mi_Presupuesto.xlsx")),
    planVersion: Number(data.workbookPlanVersion || 1), actualsRevision: Number(data.workbookActualsRevision || 0),
    paymentsModelVersion: paymentLedgerState(data).paymentsModelVersion, paymentLedgerRevision: paymentLedgerState(data).paymentLedgerRevision,
    paymentProjectedLedgerRevision: paymentLedgerState(data).paymentProjectedLedgerRevision, paymentProjectionPending: data.paymentProjectionPending === true,
  };
}

export async function loadOfficialWorkbook(projectId: string, options: { legacyOverrides?: boolean; skipGoogleSync?: boolean } = {}) {
  if (!projectBucket) throw new Error("Storage is unavailable");
  const config = await workbookConfig(projectId, { skipGoogleSync: options.skipGoogleSync });
  const [bytes] = await projectBucket.file(config.objectKey).download();
  const workbook = await loadWorkbook(bytes);
  if (options.legacyOverrides !== false) {
    const snapshot = await firestore.collection(OVERRIDES).where("projectId", "==", projectId).get();
    const overrides = snapshot.docs.map((document) => document.data() as { sheetName: string; rowIndex: number; columnIndex: number; value: unknown });
    const rawBudget = workbook.getWorksheet("Presupuesto");
    const paidColumnIndex = /obligatorio|required/i.test(rawBudget?.getCell("I3").text || "") && /estado|status/i.test(rawBudget?.getCell("N3").text || "") ? 14 : 9;
    applyLegacyOverrides(workbook, config.paymentsModelVersion === 2 ? overrides.filter((override) => {
      const header = workbook.getWorksheet(override.sheetName)?.getCell(3, override.columnIndex + 1).text || "";
      return !/precio pagado|paid/i.test(header) && !(override.sheetName === "Presupuesto" && override.columnIndex === paidColumnIndex);
    }) : overrides);
  }
  // Legacy overrides use the source file's coordinates, before budget columns migrate.
  setWorkbookCurrency(workbook, config.currency);
  ensureBudgetProgressIndicators(workbook);
  return { workbook, config, sourceBytes: bytes };
}

const storedBudgetLine = (document: FirebaseFirestore.QueryDocumentSnapshot): BudgetLine => {
  const data = document.data();
  const objective = Number(data.objective || 0); const quote = Number(data.quote || 0); const paid = Number(data.paid || 0);
  return { id: String(data.id || document.id), row: Number(data.row), chapter: String(data.chapter || ""), item: String(data.item || ""), type: String(data.type || ""), subcategory: String(data.subcategory || ""), outsideObjective: data.outsideObjective === true, objective, excess: data.outsideObjective === true ? 0 : Math.max(0, Math.max(paid, quote) - objective), quote, paid, supplier: String(data.supplier || ""), status: String(data.status || "") };
};

async function persistLines(projectId: string, lines: BudgetLine[], planVersion: number, actualsRevision: number) {
  const batch = firestore.batch();
  for (const line of lines) batch.set(firestore.collection(BUDGET_LINES).doc(projectScopedId(projectId, line.id)), { projectId, ...line, planVersion, actualsRevision, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
}

async function databaseLines(projectId: string, fallback: BudgetLine[], planVersion: number, actualsRevision: number) {
  const snapshot = await firestore.collection(BUDGET_LINES).where("projectId", "==", projectId).get();
  const current = snapshot.docs.filter((document) => Number(document.data().planVersion) === planVersion && Number(document.data().actualsRevision || 0) === actualsRevision).map(storedBudgetLine).sort((a, b) => a.row - b.row);
  if (current.length > 0 && budgetLinesEqual(current, fallback)) return current;
  await persistLines(projectId, fallback, planVersion, actualsRevision);
  return fallback;
}

export async function budgetPayload(projectId: string, options: { skipGoogleSync?: boolean } = {}) {
  const { workbook, config, sourceBytes } = await loadOfficialWorkbook(projectId, { skipGoogleSync: options.skipGoogleSync });
  const historicalLines = config.currencyEditable ? readBudgetLines(workbook) : await databaseLines(projectId, readBudgetLines(workbook), config.planVersion, config.actualsRevision);
  const lines = applyExpensePaymentsToBudget(historicalLines, await getWorkbookPayments(projectId), { paymentsModelVersion: config.paymentsModelVersion, currency: config.currency });
  const purchases = await firestore.collection(PURCHASES).where("projectId", "==", projectId).get();
  const outsideObjective = summarizeOutsideObjectivePurchases(purchases.docs.map((item) => item.data()));
  const outsideLines = lines.filter((line) => line.outsideObjective);
  const outsidePaid = outsideLines.reduce((sum, line) => sum + line.paid, 0);
  const budgetLinesCRC = config.currency === "CRC" ? outsidePaid : 0;
  const budgetLinesUSD = config.currency === "USD" ? outsidePaid : 0;
  Object.assign(outsideObjective, { budgetLinesCRC, budgetLinesUSD, budgetLineCount: outsideLines.length, [config.currency]: outsideObjective[config.currency] + outsidePaid });
  const includedLines = lines.filter((line) => !line.outsideObjective);
  const objective = includedLines.reduce((sum, line) => sum + line.objective, 0);
  const excess = includedLines.reduce((sum, line) => sum + line.excess, 0);
  const spent = includedLines.reduce((sum, line) => sum + line.paid, 0);
  const groupBy = (key: "chapter" | "type" | "subcategory") => Object.values(includedLines.reduce<Record<string, { label: string; objective: number; excess: number; spent: number; count: number }>>((groups, line) => {
    const label = line[key] || "Unassigned"; const item = groups[label] ||= { label, objective: 0, excess: 0, spent: 0, count: 0 };
    item.objective += line.objective; item.excess += line.excess; item.spent += line.paid; item.count += 1; return groups;
  }, {})).sort((a, b) => b.objective - a.objective);
  const unsupported = await scanUnsupportedFeatures(sourceBytes);
  return { outsideObjective: { ...outsideObjective, budgetLinesCRC, budgetLinesUSD, budgetLineCount: outsideLines.length }, currency: config.currency, objective, excess, spent, remaining: objective - spent, percentUsed: objective ? spent / objective * 100 : 0, status: excess > 0 ? "over_objective" : "within_objective", lines, summaries: { chapter: groupBy("chapter"), type: groupBy("type"), subcategory: groupBy("subcategory") }, sheetCount: workbook.worksheets.filter((sheet) => sheet.state === "visible").length, rowCount: lines.length, unsupported, editingAllowed: unsupported.length === 0, planVersion: config.planVersion, actualsRevision: config.actualsRevision,
    paymentsModelVersion: config.paymentsModelVersion, paymentLedgerRevision: config.paymentLedgerRevision, paymentProjectionPending: config.paymentProjectionPending };
}

export async function editorPayload(projectId: string) {
  const { workbook, config, sourceBytes } = await loadOfficialWorkbook(projectId);
  if (config.paymentsModelVersion === 2) removePaymentWorkbookProjection(workbook);
  const unsupported = await scanUnsupportedFeatures(sourceBytes);
  return { workbook: toUniver(workbook, config.fileName), currency: config.currency, unsupported, editingAllowed: unsupported.length === 0, planVersion: config.planVersion, actualsRevision: config.actualsRevision };
}

const categoryCacheId = (projectId: string, scope: WorkbookScope, planVersion: number, actualsRevision: number, currency: string) => createHash("sha256").update(`v8\u241f${projectId}\u241f${scope.key}\u241f${scope.label}\u241f${planVersion}\u241f${actualsRevision}\u241f${currency}`).digest("hex").slice(0, 36);

async function categorySheet(projectId: string, source: UniverWorkbook, lines: BudgetLine[], scope: WorkbookScope, config: Awaited<ReturnType<typeof workbookConfig>>): Promise<GeneratedWorkbook> {
  const ref = firestore.collection(CATEGORY_SHEETS).doc(categoryCacheId(projectId, scope, config.planVersion, config.actualsRevision, config.currency));
  const cached = await ref.get();
  if (cached.exists) {
    const data = cached.data()!;
    if (data.planVersion === config.planVersion && data.actualsRevision === config.actualsRevision && data.workbook && data.rowMaps) return { workbook: data.workbook as UniverWorkbook, rowMaps: data.rowMaps as GeneratedWorkbook["rowMaps"] };
  }
  const generated = generateCategoryWorkbook(source, lines, scope);
  await ref.set({ projectId, group: scope.key, label: scope.label || "Unassigned", planVersion: config.planVersion, actualsRevision: config.actualsRevision, workbook: JSON.parse(JSON.stringify(generated.workbook)), rowMaps: generated.rowMaps, createdAt: FieldValue.serverTimestamp() });
  return generated;
}

export async function generatedEditorPayload(projectId: string, scope: WorkbookScope) {
  const payload = await editorPayload(projectId); const config = await workbookConfig(projectId);
  const sourceLines = readBudgetLines((await loadOfficialWorkbook(projectId)).workbook);
  const lines = config.currencyEditable ? sourceLines : await databaseLines(projectId, sourceLines, config.planVersion, config.actualsRevision);
  const labels = scope.all ? [...new Set(lines.map((line) => line[scope.key] || "Unassigned"))].sort((a, b) => a.localeCompare(b)) : [scope.label || "Unassigned"];
  const generated = await Promise.all(labels.map((label) => categorySheet(projectId, payload.workbook, lines, { key: scope.key, label }, config)));
  if (!scope.all) return { ...payload, ...generated[0] };
  const sheets: UniverWorkbook["sheets"] = {}; const sheetOrder: string[] = []; const rowMaps: GeneratedWorkbook["rowMaps"] = {};
  generated.forEach((item, index) => {
    const originalId = item.workbook.sheetOrder[0]; const sheet = item.workbook.sheets[originalId]; const id = `category-${index + 1}`;
    sheets[id] = { ...sheet, id }; sheetOrder.push(id); rowMaps[sheet.name] = item.rowMaps[sheet.name];
  });
  return { ...payload, workbook: { ...payload.workbook, id: createHash("sha256").update(`${config.planVersion}:${config.actualsRevision}:${scope.key}`).digest("hex"), name: `${payload.workbook.name} · ${scope.key}`, sheetOrder, sheets }, rowMaps };
}

export async function persistBudgetLineMetadata(projectId: string) {
  const { workbook, config } = await loadOfficialWorkbook(projectId);
  if (config.currencyEditable) return;
  await persistLines(projectId, readBudgetLines(workbook), config.planVersion, config.actualsRevision);
}
