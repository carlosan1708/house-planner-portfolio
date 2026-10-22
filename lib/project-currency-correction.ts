import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import type ExcelJS from "exceljs";
import { currencyFromNumberFormat, currencyNumberFormat, projectCurrency, type ProjectCurrency } from "./currency";
import { firestore, projectBucket } from "./firebase-admin";
import { syncAfterBudgetCommit } from "./google-budget";
import { CONFIG, EXPENSE_PAYMENTS, LEGACY_PROJECT_ID, WORKBOOK_VERSIONS, projectConfigDoc, projectStoragePrefix } from "./project";
import { DEFAULT_WORKBOOK_KEY } from "./workbook-store";
import { PAYMENT_PROJECTION_SHEET, UNIFIED_PAYMENT_PROJECTION_VERSION } from "./payment-workbook";
import { BUDGET_SHEET, MAPPING_SHEET, loadWorkbook, scanUnsupportedFeatures } from "./workbook";

const MAX_PAYMENTS = 300;
const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))) : item);
const paymentRecords = (snapshot: FirebaseFirestore.QuerySnapshot) => snapshot.docs.map((document) => ({ id: document.id, data: document.data() })).sort((a, b) => a.id.localeCompare(b.id));

/** Replace only currency tokens; retain decimal precision, accounting sections and locale directives. */
function correctedFormat(format: string, currency: ProjectCurrency) {
  const symbol = currency === "USD" ? "$" : "₡";
  return format.split(/(\[[^\]]*\])/g).map((part) => part.startsWith("[")
    ? part.replace(/\[\$(?:USD|CRC|₡|\$)(-[^\]]+)?\]/gi, (_match, locale = "") => `[$${symbol}${locale}]`)
    : part.replace(/USD|CRC|₡|\$/gi, () => symbol)).join("");
}

function correctWorkbookFormats(workbook: Awaited<ReturnType<typeof loadWorkbook>>, currency: ProjectCurrency) {
  for (const sheet of workbook.worksheets) {
    for (const column of sheet.columns) if (typeof column.numFmt === "string" && currencyFromNumberFormat(column.numFmt)) column.style = { ...column.style, numFmt: correctedFormat(column.numFmt, currency) };
    sheet.eachRow((row) => {
      if (typeof row.numFmt === "string" && currencyFromNumberFormat(row.numFmt)) row.numFmt = correctedFormat(row.numFmt, currency);
      row.eachCell((cell) => {
        if (typeof cell.numFmt === "string" && currencyFromNumberFormat(cell.numFmt)) cell.style = { ...cell.style, numFmt: correctedFormat(cell.numFmt, currency) };
      });
    });
    const formatting = (sheet as ExcelJS.Worksheet & { conditionalFormattings: ExcelJS.ConditionalFormattingOptions[] }).conditionalFormattings;
    for (const group of formatting) for (const rule of group.rules) if (typeof rule.style?.numFmt === "string" && currencyFromNumberFormat(rule.style.numFmt)) rule.style = { ...rule.style, numFmt: correctedFormat(rule.style.numFmt, currency) };
  }
  const budget = workbook.getWorksheet(BUDGET_SHEET);
  if (!budget) throw new Error("currency_unsupported_workbook");
  const legacy = /obligatorio|required/i.test(budget.getCell("I3").text) && /estado|status/i.test(budget.getCell("N3").text);
  const moneyColumns = legacy ? [5, 6, 7, 8, 15, 17] : [5, 6, 7, 8, 10, 12];
  budget.eachRow((row, rowNumber) => {
    if (rowNumber < 4 || !budget.getCell(rowNumber, 1).text || !budget.getCell(rowNumber, 2).text && !/^TOTAL/i.test(budget.getCell(rowNumber, 1).text)) return;
    for (const column of moneyColumns) {
      const cell = row.getCell(column);
      if (!currencyFromNumberFormat(cell.numFmt || "")) cell.style = { ...cell.style, numFmt: currencyNumberFormat(currency, currency === "USD") };
    }
  });
  const mapping = workbook.getWorksheet(MAPPING_SHEET) || workbook.addWorksheet(MAPPING_SHEET, { state: "veryHidden" });
  mapping.state = "veryHidden";
  mapping.getCell("C1").value = "Currency"; mapping.getCell("D1").value = currency;
}

/** Prepare an immutable candidate; the caller commits project settings and activity in the same transaction. */
export async function prepareProjectCurrencyCorrection(projectId: string, sourceCurrency: ProjectCurrency, targetCurrency: ProjectCurrency) {
  const configRef = firestore.collection(CONFIG).doc(projectConfigDoc(projectId));
  const query = firestore.collection(EXPENSE_PAYMENTS).where("projectId", "==", projectId);
  const [configSnapshot, paymentsSnapshot] = await Promise.all([configRef.get(), query.get()]);
  const storedConfig = configSnapshot.exists ? configSnapshot.data()! : null;
  const config = storedConfig || (projectId === LEGACY_PROJECT_ID ? {} : null);
  const sourceObjectKey = String(config?.workbookObjectKey || (projectId === LEGACY_PROJECT_ID ? DEFAULT_WORKBOOK_KEY : ""));
  const records = paymentRecords(paymentsSnapshot);
  if (records.length > MAX_PAYMENTS) throw new Error("currency_scope_limit");
  if (records.some(({ data }) => projectCurrency(data.currency) !== sourceCurrency)) throw new Error("currency_stale");
  const configFingerprint = stable(storedConfig), paymentsFingerprint = stable(records);
  const planVersion = config ? Number(config.workbookPlanVersion || 1) + 1 : 0;
  const actualsRevision = config ? Number(config.workbookActualsRevision || 0) + 1 : 0;
  const ledgerRevision = Number(config?.paymentLedgerRevision || 0) + 1;
  let objectKey: string | null = null;
  let projectionPending = config?.paymentProjectionPending === true;
  let projectedRevision = Number(config?.paymentProjectedLedgerRevision || 0);
  if (config) {
    if (!projectBucket || !sourceObjectKey) throw new Error("currency_source_unavailable");
    const [bytes] = await projectBucket.file(sourceObjectKey).download();
    if ((await scanUnsupportedFeatures(bytes)).length) throw new Error("currency_unsupported_workbook");
    const workbook = await loadWorkbook(bytes);
    if (workbook.worksheets.some((sheet) => sheet.rowCount > 5000)) throw new Error("currency_scope_limit");
    const projection = workbook.getWorksheet(PAYMENT_PROJECTION_SHEET);
    if (projection && (config.paymentsModelVersion !== 2 || projection.getCell("A1").text !== UNIFIED_PAYMENT_PROJECTION_VERSION)) throw new Error("currency_unsupported_workbook");
    correctWorkbookFormats(workbook, targetCurrency);
    if (config.paymentsModelVersion === 2) {
      projectionPending ||= projectedRevision < Number(config.paymentLedgerRevision || 0) || !projection;
      if (!projectionPending) { projectedRevision = ledgerRevision; projection!.getCell("E1").value = ledgerRevision; }
    }
    objectKey = `${projectStoragePrefix(projectId)}/workbooks/versions/currency-${sourceCurrency}-${targetCurrency}-plan-${planVersion}-${randomUUID()}.xlsx`;
    try {
      await projectBucket.file(objectKey).save(Buffer.from(await workbook.xlsx.writeBuffer()), { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", resumable: false, preconditionOpts: { ifGenerationMatch: 0 } });
    } catch (error) {
      await projectBucket.file(objectKey).delete({ ignoreNotFound: true }).catch(() => undefined);
      throw error;
    }
  }
  const versionRef = objectKey ? firestore.collection(WORKBOOK_VERSIONS).doc() : null;
  return {
    objectKey, planVersion, actualsRevision, paymentCount: records.length,
    validate: async (transaction: FirebaseFirestore.Transaction) => {
      const [freshConfig, freshPayments] = await Promise.all([transaction.get(configRef), transaction.get(query)]);
      if (stable(freshConfig.exists ? freshConfig.data() : null) !== configFingerprint || stable(paymentRecords(freshPayments)) !== paymentsFingerprint) throw new Error("currency_stale");
    },
    write: (transaction: FirebaseFirestore.Transaction) => {
      for (const { id, data } of records) transaction.set(firestore.collection(EXPENSE_PAYMENTS).doc(id), {
        currency: targetCurrency,
        originalCurrency: data.originalCurrency ?? projectCurrency(data.currency),
        currencyCorrectedFrom: sourceCurrency,
        currencyCorrectedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      if (config && objectKey && versionRef) {
        transaction.set(configRef, { projectId, workbookObjectKey: objectKey, workbookPlanVersion: planVersion, workbookActualsRevision: actualsRevision,
          currencyEditable: false, currencyCorrectionPlanVersion: planVersion, paymentLedgerRevision: ledgerRevision, paymentProjectedLedgerRevision: projectedRevision,
          paymentProjectionPending: projectionPending, workbookUpdatedBy: "Project currency correction", workbookUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
        transaction.set(versionRef, { projectId, kind: "currency_correction", objectKey, planVersion, actualsRevision, sourceCurrency, currency: targetCurrency,
          sourceObjectKey, createdBy: "Project currency correction", createdAt: FieldValue.serverTimestamp() });
      }
    },
    cleanup: async () => { if (objectKey && projectBucket) await projectBucket.file(objectKey).delete({ ignoreNotFound: true }).catch(() => undefined); },
    afterCommit: async () => objectKey ? syncAfterBudgetCommit(projectId) : { googleSynced: false },
  };
}
