import ExcelJS from "exceljs";
import JSZip from "jszip";
import { applyExpensePaymentsToBudget, expensePaymentDocumentIds, type BudgetPaymentInput } from "./expense-records";
import { BUDGET_COLUMNS, BUDGET_SHEET, readBudgetLines, setWorkbookCurrency, workbookCurrency } from "./workbook";
import { currencyNumberFormat, projectCurrency, type ProjectCurrency } from "./currency";

export const PAYMENT_PROJECTION_SHEET = "_HousePlannerPayments";
export const PAYMENT_PROJECTION_VERSION = "payments-projection-v1";
export const UNIFIED_PAYMENT_PROJECTION_VERSION = "payments-ledger-v2";
export type WorkbookPayment = BudgetPaymentInput & { id: string; documentIds?: unknown; documentId?: unknown; [field: string]: unknown };

/** Inspect package metadata without rewriting unsupported workbook features. */
export async function containsPaymentWorkbookProjection(bytes: Buffer) {
  const zip = await JSZip.loadAsync(bytes);
  return (await zip.file("xl/workbook.xml")?.async("string"))?.includes(PAYMENT_PROJECTION_SHEET) === true;
}

const money = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
const label = (value: unknown) => typeof value === "string" ? value : "";
const mode = (payment: WorkbookPayment) => payment.accountingMode === "ledger" ? "Pago registrado" : "Detalle histórico (ya incluido)";
const statusLabels: Record<string, string> = { unpaid: "Sin pagos", partial: "Abono parcial", paid: "Pagado", overpaid: "Pago superior a cotización", unknown: "Sin cotización" };

function activePayments(payments: WorkbookPayment[], currency: ProjectCurrency) {
  const active = payments.filter((payment) => !payment.deletedAt && money(payment.amount) > 0).sort((a, b) => a.id.localeCompare(b.id));
  if (active.some((payment) => projectCurrency(payment.currency) !== currency)) throw new Error("Payment currency does not match workbook currency");
  return active;
}

function availableSheetName(workbook: ExcelJS.Workbook, preferred: string) {
  let name = preferred;
  let suffix = 1;
  while (workbook.worksheets.some((sheet) => sheet.name.toLocaleLowerCase() === name.toLocaleLowerCase())) name = `${preferred} (${++suffix})`;
  return name;
}

function projectionSheet(workbook: ExcelJS.Workbook, name: string, title: string, headers: string[]) {
  const sheet = workbook.addWorksheet(availableSheetName(workbook, name), { views: [{ state: "frozen", ySplit: 3 }] });
  sheet.getCell("A1").value = title;
  sheet.getCell("A2").value = "Resumen de consulta. Registrá y corregí los pagos en Compras y gastos; esta hoja no importa pagos.";
  sheet.getRow(3).values = headers;
  sheet.getRow(3).height = 34;
  sheet.getRow(3).eachCell((cell) => {
    cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF292B34" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  sheet.columns.forEach((column) => { column.width = 24; });
  return sheet;
}

/** Project the ledger into a downloaded copy; never persist these totals as historical Excel actuals. */
export function addPaymentWorkbookProjection(workbook: ExcelJS.Workbook, payments: WorkbookPayment[], options: { includePaymentDetails?: boolean; paymentsModelVersion?: number; paymentLedgerRevision?: number; currency?: ProjectCurrency } = {}) {
  const currency = options.currency ?? workbookCurrency(workbook);
  setWorkbookCurrency(workbook, currency);
  if (options.paymentsModelVersion === 2) return addUnifiedPaymentWorkbookProjection(workbook, payments, options);
  if (workbook.getWorksheet(PAYMENT_PROJECTION_SHEET)) throw new Error("El archivo ya contiene un resumen de pagos. Volvé a descargar el presupuesto actual.");
  const originalLines = readBudgetLines(workbook);
  const active = activePayments(payments, currency);
  const lines = applyExpensePaymentsToBudget(originalLines, active, { currency });
  const includePaymentDetails = options.includePaymentDetails !== false;
  // Budget access grants calculated line totals, while payees, notes and unassigned payments require Expenses access.
  const reportedPayments: WorkbookPayment[] = includePaymentDetails ? active : lines.filter((line) => line.transactionPaid > 0)
    .map((line) => ({ id: `summary:${line.id}`, budgetLineId: line.id, amount: line.transactionPaid, accountingMode: "ledger" }));
  const budget = workbook.getWorksheet(BUDGET_SHEET)!;
  const summary = projectionSheet(workbook, "Resumen de pagos", "Presupuesto y pagos por partida", [
    "ID partida", "Capítulo", "Partida", "Objetivo", "Cotización vigente", "Pagado histórico de Excel", "Pagos registrados", "Total pagado", "Pendiente según cotización", "Estado de pago", "Fuera de objetivo",
  ]);
  summary.getColumn(1).hidden = true;
  summary.getColumn(3).width = 38;
  const ledger = projectionSheet(workbook, "Pagos", "Historial de pagos con identificadores estables", [
    "ID pago", "Fecha", "Proveedor / beneficiario", "Descripción", "Monto", "Suma al pagado", "Origen", "ID partida", "ID compra", "Tipo de pago", "IDs comprobantes", "Referencia", "Notas",
  ]);
  ledger.getColumn(1).width = 35;
  ledger.getColumn(4).width = 38;
  const metadata = workbook.addWorksheet(PAYMENT_PROJECTION_SHEET, { state: "veryHidden" });
  metadata.getRow(1).values = [PAYMENT_PROJECTION_VERSION, summary.name, ledger.name, includePaymentDetails ? "details" : "summary"];
  metadata.getRow(2).values = ["ID partida", "Pagado histórico", "Pagado proyectado"];

  for (const line of lines) {
    budget.getCell(line.row, BUDGET_COLUMNS.paid).value = line.paid;
    summary.addRow([line.id, line.chapter, line.item, line.objective, line.quote, line.workbookPaid, line.transactionPaid, line.paid,
      line.remaining, statusLabels[line.paymentStatus] || "Sin cotización", line.outsideObjective ? "Sí" : "No"]);
    metadata.addRow([line.id, line.workbookPaid, line.paid]);
    if (line.workbookPaid > 0) ledger.addRow([`historical:${line.id}`, "", line.supplier, line.item, line.workbookPaid, line.workbookPaid,
      "Pagado histórico de Excel", line.id, "", "", "", "", "Saldo anterior; revisá coincidencias antes de registrar pagos antiguos"]);
  }
  for (const payment of reportedPayments) {
    const line = originalLines.find((item) => item.id === payment.budgetLineId);
    const kind = payment.paymentKind === "settlement" ? payment.purchaseId ? "Pago de saldo" : "Pago total" : payment.paymentKind === "partial" ? "Abono" : "";
    ledger.addRow([payment.id, label(payment.paymentDate), label(payment.payee), label(payment.purchaseTitle) || line?.item || "Pago sin partida",
      money(payment.amount), payment.accountingMode === "ledger" ? money(payment.amount) : 0, mode(payment), label(payment.budgetLineId),
      label(payment.purchaseId), kind, expensePaymentDocumentIds(payment).join(", "), label(payment.reference), label(payment.notes)]);
  }
  for (const sheet of [summary, ledger]) {
    const columns = sheet === summary ? [4, 5, 6, 7, 8, 9] : [5, 6];
    for (let row = 4; row <= sheet.rowCount; row++) for (const column of columns) sheet.getCell(row, column).style = { ...sheet.getCell(row, column).style, numFmt: currencyNumberFormat(currency, true) };
    sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: Math.max(3, sheet.rowCount), column: sheet.columnCount } };
  }
  return { summarySheetName: summary.name, paymentsSheetName: ledger.name, lines };
}

/** V2 contains the actual payment records; the workbook contributes no hidden paid amount. */
export function removePaymentWorkbookProjection(workbook: ExcelJS.Workbook) {
  const previous = workbook.getWorksheet(PAYMENT_PROJECTION_SHEET);
  if (previous) {
    if (![PAYMENT_PROJECTION_VERSION, UNIFIED_PAYMENT_PROJECTION_VERSION].includes(previous.getCell("A1").text)) throw new Error("La identificación del historial de pagos no es válida.");
    for (const name of [previous.getCell("B1").text, previous.getCell("C1").text]) {
      const sheet = workbook.getWorksheet(name); if (sheet && sheet.id !== previous.id && sheet.name !== BUDGET_SHEET) workbook.removeWorksheet(sheet.id);
    }
    workbook.removeWorksheet(previous.id);
  }
}

function addUnifiedPaymentWorkbookProjection(workbook: ExcelJS.Workbook, payments: WorkbookPayment[], options: { includePaymentDetails?: boolean; paymentLedgerRevision?: number }) {
  removePaymentWorkbookProjection(workbook);
  const original = readBudgetLines(workbook);
  const currency = workbookCurrency(workbook);
  const active = activePayments(payments, currency);
  const lines = applyExpensePaymentsToBudget(original, active, { paymentsModelVersion: 2, currency });
  const includeDetails = options.includePaymentDetails !== false;
  const reported: WorkbookPayment[] = includeDetails ? active : lines.filter((line) => line.paid > 0).map((line) => ({ id: `summary:${line.id}`, budgetLineId: line.id, amount: line.paid }));
  const summary = projectionSheet(workbook, "Resumen de pagos", "Presupuesto y pagos por partida", ["ID partida", "Capítulo", "Partida", "Objetivo", "Cotización vigente", "Total pagado", "Pendiente según cotización", "Estado de pago", "Fuera de objetivo"]);
  summary.getColumn(1).hidden = true;
  const ledger = projectionSheet(workbook, "Pagos", "Historial de pagos", ["ID pago", "Fecha", "Proveedor / beneficiario", "Descripción", "Monto", "Origen", "ID partida", "ID compra", "Tipo de pago", "IDs comprobantes", "Referencia", "Notas"]);
  const metadata = workbook.addWorksheet(PAYMENT_PROJECTION_SHEET, { state: "veryHidden" });
  metadata.getRow(1).values = [UNIFIED_PAYMENT_PROJECTION_VERSION, summary.name, ledger.name, includeDetails ? "details" : "summary", options.paymentLedgerRevision || 0];
  metadata.getRow(2).values = ["ID partida", "Total pagado"];
  for (const line of lines) {
    workbook.getWorksheet(BUDGET_SHEET)!.getCell(line.row, BUDGET_COLUMNS.paid).value = line.paid;
    summary.addRow([line.id, line.chapter, line.item, line.objective, line.quote, line.paid, line.remaining, statusLabels[line.paymentStatus], line.outsideObjective ? "Sí" : "No"]);
    metadata.addRow([line.id, line.paid]);
  }
  for (const payment of reported) {
    const line = original.find((item) => item.id === payment.budgetLineId);
    ledger.addRow([payment.id, label(payment.paymentDate), label(payment.payee), label(payment.purchaseTitle) || label(payment.sourceLabel) || line?.item || "Pago sin partida", money(payment.amount),
      payment.source === "excel-import" ? "Excel" : "Pago registrado", label(payment.budgetLineId), label(payment.purchaseId), payment.paymentKind === "settlement" ? payment.purchaseId ? "Pago de saldo" : "Pago total" : "Abono",
      expensePaymentDocumentIds(payment).join(", "), label(payment.reference), label(payment.notes)]);
  }
  for (const sheet of [summary, ledger]) {
    const columns = sheet === summary ? [4, 5, 6, 7] : [5];
    for (let row = 4; row <= sheet.rowCount; row++) for (const column of columns) sheet.getCell(row, column).style = { ...sheet.getCell(row, column).style, numFmt: currencyNumberFormat(currency, true) };
    sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: Math.max(3, sheet.rowCount), column: sheet.columnCount } };
  }
  return { summarySheetName: summary.name, paymentsSheetName: ledger.name, lines };
}

/** Protected export pages are checked against server records before removal, never trusted as payments. */
export function stripUnifiedPaymentWorkbookProjection(imported: ExcelJS.Workbook, baseline: ExcelJS.Workbook, payments: WorkbookPayment[], revision: number) {
  const marker = imported.getWorksheet(PAYMENT_PROJECTION_SHEET);
  if (!marker) return;
  if (marker.getCell("A1").text !== UNIFIED_PAYMENT_PROJECTION_VERSION) throw new Error("Esta copia usa el historial anterior. Descargá el presupuesto actual antes de subir cambios.");
  const expectedWorkbook = new ExcelJS.Workbook(); expectedWorkbook.model = structuredClone(baseline.model);
  const expected = addUnifiedPaymentWorkbookProjection(expectedWorkbook, payments, { includePaymentDetails: marker.getCell("D1").text !== "summary", paymentLedgerRevision: revision });
  if (sheetContent(marker) !== sheetContent(expectedWorkbook.getWorksheet(PAYMENT_PROJECTION_SHEET)!)) throw new Error("Los pagos cambiaron desde la descarga. Descargá el presupuesto actual.");
  for (const name of [expected.summarySheetName, expected.paymentsSheetName]) {
    const actual = imported.getWorksheet(name), canonical = expectedWorkbook.getWorksheet(name)!;
    if (!actual || sheetContent(actual) !== sheetContent(canonical)) throw new Error("El historial de pagos es de consulta. Corregí los pagos en la aplicación antes de descargar el Excel.");
  }
  for (const name of [expected.summarySheetName, expected.paymentsSheetName, PAYMENT_PROJECTION_SHEET]) imported.removeWorksheet(imported.getWorksheet(name)!.id);
}

/** Google can still hold the last published revision while newer app payments await projection. */
export function stripPaymentProjectionAgainstBaseline(imported: ExcelJS.Workbook, baseline: ExcelJS.Workbook) {
  const marker = imported.getWorksheet(PAYMENT_PROJECTION_SHEET), expected = baseline.getWorksheet(PAYMENT_PROJECTION_SHEET);
  if (!marker && !expected) return;
  if (!marker || !expected || marker.getCell("A1").text !== UNIFIED_PAYMENT_PROJECTION_VERSION || sheetContent(marker) !== sheetContent(expected)) throw new Error("El historial de pagos de Google cambió. Conservá sus hojas de consulta y reintentá.");
  for (const name of [expected.getCell("B1").text, expected.getCell("C1").text]) {
    const actual = imported.getWorksheet(name), canonical = baseline.getWorksheet(name);
    if (!actual || !canonical || sheetContent(actual) !== sheetContent(canonical)) throw new Error("El historial de pagos de Google es de consulta. Corregí sus pagos desde la aplicación.");
  }
  removePaymentWorkbookProjection(imported);
}

function sheetContent(sheet: ExcelJS.Worksheet) {
  const cells: Array<[number, number, unknown]> = [];
  sheet.eachRow((row, rowNumber) => row.eachCell((cell, column) => {
    // Google can export unchanged text as styled runs. Preserve exact text,
    // numeric types and formulas while ignoring only that representation.
    const value = cell.type === ExcelJS.ValueType.RichText ? cell.text : cell.value;
    if (value !== null && value !== undefined && value !== "") cells.push([rowNumber, column, value]);
  }));
  return JSON.stringify(cells);
}

/** Validate against the server's source and ledger, not against client-editable hidden metadata. */
export function restoreHistoricalWorkbookPaid(imported: ExcelJS.Workbook, baseline: ExcelJS.Workbook, payments: WorkbookPayment[]) {
  const metadata = imported.getWorksheet(PAYMENT_PROJECTION_SHEET);
  if (!metadata || metadata.getCell("A1").text !== PAYMENT_PROJECTION_VERSION)
    throw new Error("Falta el resumen original de pagos. Descargá el presupuesto actual y volvé a aplicar tus cambios.");
  const expected = addPaymentWorkbookProjection(baseline, payments, { includePaymentDetails: metadata.getCell("D1").text !== "summary" });
  const expectedMetadata = baseline.getWorksheet(PAYMENT_PROJECTION_SHEET)!;
  if (sheetContent(metadata) !== sheetContent(expectedMetadata))
    throw new Error("Los pagos o sus identificadores cambiaron desde la descarga. Descargá el presupuesto actual para conciliarlo.");
  for (const name of [expected.summarySheetName, expected.paymentsSheetName]) {
    const sheet = imported.getWorksheet(name);
    if (!sheet || sheetContent(sheet) !== sheetContent(baseline.getWorksheet(name)!))
      throw new Error("Las hojas de resumen e historial de pagos son de consulta. Corregí los pagos en Compras y gastos y descargá el Excel actual.");
  }
  const originals = new Map(expected.lines.map((line) => [line.id, line]));
  const budget = imported.getWorksheet(BUDGET_SHEET)!;
  const hasLedger = payments.some((payment) => !payment.deletedAt && payment.accountingMode === "ledger" && money(payment.amount) > 0);
  const importedLines = readBudgetLines(imported);
  assertLedgerLinesRetained(importedLines, expected.lines, payments);
  for (const line of importedLines) {
    const original = originals.get(line.id);
    if (original) {
      if (Math.abs(line.paid - original.paid) > 0.000001)
        throw new Error("El total pagado se calcula desde los pagos. Registrá abonos o saldos en Compras y gastos.");
      budget.getCell(line.row, BUDGET_COLUMNS.paid).value = original.workbookPaid;
    } else if (hasLedger && line.paid !== 0) {
      throw new Error("Las partidas nuevas deben tener pagado cero. Registrá sus pagos en Compras y gastos para evitar duplicados.");
    }
  }
  for (const name of [expected.summarySheetName, expected.paymentsSheetName, PAYMENT_PROJECTION_SHEET]) imported.removeWorksheet(imported.getWorksheet(name)!.id);
}

/** A connected/raw workbook contains the historical baseline, never the app's cumulative ledger total. */
export function assertHistoricalPaidUnchangedForLedger(imported: ExcelJS.Workbook, baseline: ExcelJS.Workbook, payments: WorkbookPayment[]) {
  if (imported.getWorksheet(PAYMENT_PROJECTION_SHEET)) throw new Error("Este archivo contiene totales proyectados. Descargá el presupuesto actual y conciliá los pagos antes de restaurarlo.");
  assertHistoricalPaidUnchangedForLedgerLines(readBudgetLines(imported), readBudgetLines(baseline), payments);
}

export function assertHistoricalPaidUnchangedForLedgerLines(imported: Array<{ id: string; paid: number }>, baseline: Array<{ id: string; paid: number }>, payments: WorkbookPayment[]) {
  const protectedIds = new Set(payments.filter((payment) => !payment.deletedAt && payment.accountingMode === "ledger" && money(payment.amount) > 0)
    .flatMap((payment) => typeof payment.budgetLineId === "string" && payment.budgetLineId ? [payment.budgetLineId] : []));
  if (!protectedIds.size) return;
  assertLedgerLinesRetained(imported, baseline, payments);
  const previous = new Map(baseline.map((line) => [line.id, line.paid]));
  for (const line of imported) {
    if (protectedIds.has(line.id) && Math.abs(line.paid - (previous.get(line.id) || 0)) > 0.000001)
      throw new Error("La columna J conserva el pagado histórico de Excel. Esta partida ya tiene pagos registrados: guardá los abonos y saldos en Compras y gastos, sin volver a sumarlos en Excel o Google Sheets.");
  }
}

function assertLedgerLinesRetained(imported: Array<{ id: string }>, baseline: Array<{ id: string }>, payments: WorkbookPayment[]) {
  const currentIds = new Set(imported.map((line) => line.id));
  const previousIds = new Set(baseline.map((line) => line.id));
  if (payments.some((payment) => !payment.deletedAt && payment.accountingMode === "ledger" && money(payment.amount) > 0 && typeof payment.budgetLineId === "string" &&
    previousIds.has(payment.budgetLineId) && !currentIds.has(payment.budgetLineId)))
    throw new Error("Esta partida tiene pagos registrados. Reasigná sus pagos antes de eliminarla para conservar los totales del presupuesto.");
}
