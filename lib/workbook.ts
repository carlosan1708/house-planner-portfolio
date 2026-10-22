import { createHash, randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { BUDGET_PROGRESS_APPEARANCE, normalizeBudgetProgressStatus, type BudgetProgressStatus } from "@/lib/budget-progress";
import { currencyNumberFormat, projectCurrency, type ProjectCurrency } from "./currency";

export const BUDGET_SHEET = "Presupuesto";
export const MAPPING_SHEET = "_HousePlanner";
export const BUDGET_HEADER_ROW = 3;
export const BUDGET_FIRST_ROW = 4;

export const BUDGET_COLUMNS = {
  chapter: 1,
  item: 2,
  type: 3,
  subcategory: 4,
  objective: 5,
  excess: 6,
  quote: 7,
  difference: 8,
  status: 9,
  paid: 10,
  supplier: 11,
  controlCost: 12,
  alert: 13,
  evidence: 14,
  pricingBasis: 15,
  reviewDate: 16,
  regulationReference: 17,
  required: 18,
  outsideObjective: 27,
} as const;

const BUDGET_HEADERS = [
  "Capítulo", "Partida", "Tipo", "Subcategoría", "Objetivo", "Exceso sobre objetivo", "Cotización vigente", "Diferencia vs objetivo",
  "Estado", "Precio pagado", "Proveedor / nota", "Costo usado", "Alerta", "Fuente / evidencia", "Base de precio",
  "Fecha revisión", "Referencia reglamento", "Obligatorio",
];

const LEGACY_TO_PRIMARY_COLUMN: Record<number, number> = {
  1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8,
  9: 18, 10: 17, 11: 15, 12: 14, 13: 16, 14: 9, 15: 10, 16: 11, 17: 12, 18: 13,
};

const LEGACY_TO_PRIMARY_LETTER: Record<string, string> = {
  I: "R", J: "Q", K: "O", L: "N", M: "P", N: "I", O: "J", P: "K", Q: "L", R: "M",
};

export type BudgetLine = {
  id: string; row: number; chapter: string; item: string; type: string; subcategory: string;
  outsideObjective?: boolean;
  objective: number; excess: number; quote: number; paid: number; supplier: string; status: string;
  workbookPaid?: number;
  transactionPaid?: number;
  remaining?: number | null;
  paymentStatus?: "unpaid" | "partial" | "paid" | "overpaid" | "unknown";
};

export type UniverCell = { v?: string | number | boolean | null; f?: string; s?: Record<string, unknown>; p?: { url?: string } };
export type UniverSheet = {
  id: string; name: string; rowCount: number; columnCount: number;
  cellData: Record<number, Record<number, UniverCell>>;
  mergeData: Array<{ startRow: number; endRow: number; startColumn: number; endColumn: number }>;
  rowData: Record<number, { h?: number; hd?: boolean }>;
  columnData: Record<number, { w?: number; hd?: boolean }>;
  freeze?: { startRow: number; startColumn: number; xSplit: number; ySplit: number };
  hidden?: boolean;
};
export type UniverWorkbook = { id: string; name: string; currency?: ProjectCurrency; sheetOrder: string[]; sheets: Record<string, UniverSheet> };
export type BudgetGroupKey = "chapter" | "type" | "subcategory";
export type WorkbookScope = { key: BudgetGroupKey; label?: string; all?: boolean };
export type GeneratedWorkbook = { workbook: UniverWorkbook; rowMaps: Record<string, Record<number, number>> };

const GENERATED_LINE_ID_COLUMN = 25;

/** A workbook marker preserves denomination through exports; server project settings remain authoritative. */
export function workbookCurrency(workbook: ExcelJS.Workbook): ProjectCurrency {
  const mapping = workbook.getWorksheet(MAPPING_SHEET);
  return projectCurrency(mapping?.getCell("C1").value === "Currency" ? mapping.getCell("D1").value : undefined);
}

const budgetCurrencyFormat = (workbook: ExcelJS.Workbook) => currencyNumberFormat(workbookCurrency(workbook), workbookCurrency(workbook) === "USD");
const formatMoneyCell = (cell: ExcelJS.Cell, format: string) => {
  const value = resolvedCellValue(cell.value);
  const fractionalCRC = format === currencyNumberFormat("CRC") && typeof value === "number" && Number.isFinite(value) && !Number.isInteger(value);
  cell.style = { ...cell.style, numFmt: fractionalCRC ? currencyNumberFormat("CRC", true) : format };
};

export function setWorkbookCurrency(workbook: ExcelJS.Workbook, currency: ProjectCurrency) {
  const mapping = workbook.getWorksheet(MAPPING_SHEET) || workbook.addWorksheet(MAPPING_SHEET, { state: "veryHidden" });
  mapping.state = "veryHidden";
  mapping.getCell("C1").value = "Currency";
  mapping.getCell("D1").value = currency;
  ensureObjectiveOnlyBudget(workbook);
}

function resolvedCellValue(value: unknown) {
  if (value && typeof value === "object" && "result" in value) {
    return (value as { result?: unknown }).result;
  }
  if (value && typeof value === "object" && "richText" in value) {
    const richText = (value as { richText?: Array<{ text?: unknown }> }).richText;
    if (Array.isArray(richText)) return richText.map((part) => String(part.text ?? "")).join("");
  }
  return value;
}

const text = (value: unknown) => String(resolvedCellValue(value) ?? "").trim();
const number = (value: unknown) => {
  const resolved = resolvedCellValue(value);
  if (typeof resolved === "number" && Number.isFinite(resolved)) return resolved;
  const normalized = typeof resolved === "string" ? resolved.replace(/[\s\u00a0\u202f]/g, "") : resolved;
  return Number(normalized) || 0;
};

const normalizedHeader = (value: unknown) => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function translateLegacyBudgetReferences(formula: string, localBudgetFormula: boolean) {
  let translated = formula.replace(/((?:'Presupuesto'|Presupuesto)!)(\$?)([I-R])(\$?\d+):(\$?)([I-R])(\$?\d+)/gi,
    (_match, sheet, firstAbsolute, firstColumn, firstRow, secondAbsolute, secondColumn, secondRow) =>
      `${sheet}${firstAbsolute}${LEGACY_TO_PRIMARY_LETTER[String(firstColumn).toUpperCase()] || firstColumn}${firstRow}:${secondAbsolute}${LEGACY_TO_PRIMARY_LETTER[String(secondColumn).toUpperCase()] || secondColumn}${secondRow}`);
  translated = translated.replace(/((?:'Presupuesto'|Presupuesto)!)(\$?)([I-R])(\$?\d+)(?![\d:])/gi, (_match, sheet, absolute, column, row) =>
    `${sheet}${absolute}${LEGACY_TO_PRIMARY_LETTER[String(column).toUpperCase()] || column}${row}`);
  if (localBudgetFormula) {
    translated = translated.replace(/(?<![A-Z0-9_!])(\$?)([I-R])(\$?\d+)/gi, (_match, absolute, column, row) =>
      `${absolute}${LEGACY_TO_PRIMARY_LETTER[String(column).toUpperCase()] || column}${row}`);
  }
  return translated;
}

function translateWorkbookFormulas(workbook: ExcelJS.Workbook) {
  for (const worksheet of workbook.worksheets) {
    const localBudgetFormula = worksheet.name === BUDGET_SHEET;
    worksheet.eachRow({ includeEmpty: true }, (row) => row.eachCell({ includeEmpty: true }, (cell) => {
      const value = cell.value;
      if (value && typeof value === "object" && "formula" in value) {
        cell.value = { ...value, formula: translateLegacyBudgetReferences(String(value.formula), localBudgetFormula) } as ExcelJS.CellFormulaValue;
      } else if (value && typeof value === "object" && "sharedFormula" in value) {
        cell.value = { ...value, sharedFormula: translateLegacyBudgetReferences(String(value.sharedFormula), localBudgetFormula) } as ExcelJS.CellSharedFormulaValue;
      }
      if (localBudgetFormula && cell.dataValidation?.formulae?.length) {
        cell.dataValidation = { ...cell.dataValidation, formulae: cell.dataValidation.formulae.map((formula) =>
          typeof formula === "string" ? translateLegacyBudgetReferences(formula, true) : formula) };
      }
    }));
  }
}

export function ensureBudgetColumnOrder(workbook: ExcelJS.Workbook) {
  const budget = workbook.getWorksheet(BUDGET_SHEET);
  if (!budget) return false;
  const ninth = normalizedHeader(budget.getCell(BUDGET_HEADER_ROW, 9).value);
  const fourteenth = normalizedHeader(budget.getCell(BUDGET_HEADER_ROW, 14).value);
  const legacy = /obligatorio|required/.test(ninth) && /estado|status/.test(fourteenth);
  if (!legacy) return false;

  const rowSnapshots = Array.from({ length: budget.rowCount }, (_, rowIndex) =>
    Array.from({ length: 18 }, (_, columnIndex) => {
      const cell = budget.getCell(rowIndex + 1, columnIndex + 1);
      return {
        value: structuredClone(cell.value),
        style: structuredClone(cell.style),
        dataValidation: structuredClone(cell.dataValidation),
        note: structuredClone(cell.note),
      };
    }));
  const columnSnapshots = Array.from({ length: 18 }, (_, columnIndex) => {
    const column = budget.getColumn(columnIndex + 1);
    return { width: column.width, hidden: column.hidden, style: structuredClone(column.style) };
  });

  for (let oldColumn = 1; oldColumn <= 18; oldColumn += 1) {
    const newColumn = LEGACY_TO_PRIMARY_COLUMN[oldColumn];
    const sourceColumn = columnSnapshots[oldColumn - 1];
    const targetColumn = budget.getColumn(newColumn);
    targetColumn.width = sourceColumn.width;
    targetColumn.hidden = sourceColumn.hidden;
    targetColumn.style = sourceColumn.style;
    for (let row = 1; row <= budget.rowCount; row += 1) {
      const source = rowSnapshots[row - 1][oldColumn - 1];
      const target = budget.getCell(row, newColumn);
      target.value = source.value;
      target.style = source.style;
      target.dataValidation = source.dataValidation;
      target.note = source.note;
    }
  }
  BUDGET_HEADERS.forEach((header, index) => { budget.getCell(BUDGET_HEADER_ROW, index + 1).value = header; });
  translateWorkbookFormulas(workbook);
  const formattingBudget = budget as ExcelJS.Worksheet & { conditionalFormattings: ExcelJS.ConditionalFormattingOptions[] };
  for (const formatting of formattingBudget.conditionalFormattings) {
    formatting.ref = translateLegacyBudgetReferences(formatting.ref, true);
    for (const rule of formatting.rules) {
      if ("formulae" in rule && rule.formulae) rule.formulae = rule.formulae.map((formula) => translateLegacyBudgetReferences(String(formula), true));
    }
  }
  const mapping = workbook.getWorksheet(MAPPING_SHEET);
  if (mapping) mapping.getCell("B1").value = "2";
  return true;
}

export const budgetControlCost = (line: Pick<BudgetLine, "quote" | "paid">) => Math.max(0, line.quote, line.paid);
export const budgetLineExcess = (line: Pick<BudgetLine, "objective" | "quote" | "paid" | "outsideObjective">) => line.outsideObjective ? 0 : Math.max(0, budgetControlCost(line) - line.objective);

const outsideBudgetRow = (sheet: ExcelJS.Worksheet, row: number) => number(sheet.getCell(row, BUDGET_COLUMNS.outsideObjective).value) === 1;

function ensureObjectiveOnlySummary(workbook: ExcelJS.Workbook, lastBudgetRow: number, totalsRow: number) {
  const summary = workbook.getWorksheet("Resumen");
  if (!summary) return;
  const knownBudgetSummary = ["A4", "A5", "A6", "B10", "C10"].some((address) =>
    /presupuesto|objetivo|maximum|maximo|máximo|tope|exceso/i.test(text(summary.getCell(address).value)));
  if (!knownBudgetSummary) return;
  const totalObjective = Array.from({ length: Math.max(0, lastBudgetRow - BUDGET_FIRST_ROW + 1) }, (_, index) =>
    (outsideBudgetRow(workbook.getWorksheet(BUDGET_SHEET)!, BUDGET_FIRST_ROW + index) ? 0 : number(workbook.getWorksheet(BUDGET_SHEET)!.getCell(BUDGET_FIRST_ROW + index, BUDGET_COLUMNS.objective).value))).reduce((sum, value) => sum + value, 0);
  const totalExcess = Array.from({ length: Math.max(0, lastBudgetRow - BUDGET_FIRST_ROW + 1) }, (_, index) => {
    const row = BUDGET_FIRST_ROW + index;
    const budget = workbook.getWorksheet(BUDGET_SHEET)!;
    if (outsideBudgetRow(budget, row)) return 0;
    return Math.max(0, Math.max(number(budget.getCell(row, BUDGET_COLUMNS.paid).value), number(budget.getCell(row, BUDGET_COLUMNS.quote).value)) - number(budget.getCell(row, BUDGET_COLUMNS.objective).value));
  }).reduce((sum, value) => sum + value, 0);
  const controlTotal = Array.from({ length: Math.max(0, lastBudgetRow - BUDGET_FIRST_ROW + 1) }, (_, index) => {
    const row = BUDGET_FIRST_ROW + index;
    const budget = workbook.getWorksheet(BUDGET_SHEET)!;
    if (outsideBudgetRow(budget, row)) return 0;
    return Math.max(number(budget.getCell(row, BUDGET_COLUMNS.paid).value), number(budget.getCell(row, BUDGET_COLUMNS.quote).value));
  }).reduce((sum, value) => sum + value, 0);
  const linesWithExcess = Array.from({ length: Math.max(0, lastBudgetRow - BUDGET_FIRST_ROW + 1) }, (_, index) => {
    const row = BUDGET_FIRST_ROW + index;
    const budget = workbook.getWorksheet(BUDGET_SHEET)!;
    if (outsideBudgetRow(budget, row)) return 0;
    const objective = number(budget.getCell(row, BUDGET_COLUMNS.objective).value);
    const control = Math.max(number(budget.getCell(row, BUDGET_COLUMNS.paid).value), number(budget.getCell(row, BUDGET_COLUMNS.quote).value));
    return control > objective;
  }).filter(Boolean).length;

  summary.getCell("A4").value = "Objetivo total";
  summary.getCell("B4").value = { formula: `Presupuesto!E${totalsRow}`, result: totalObjective };
  summary.getCell("A5").value = "Costo usado";
  summary.getCell("B5").value = { formula: `Presupuesto!L${totalsRow}`, result: controlTotal };
  summary.getCell("A6").value = "Exceso sobre objetivo";
  summary.getCell("B6").value = { formula: `Presupuesto!F${totalsRow}`, result: totalExcess };
  summary.getCell("A7").value = "Restante vs objetivo";
  summary.getCell("B7").value = { formula: "B4-B5", result: totalObjective - controlTotal };
  summary.getCell("D4").value = "% objetivo utilizado";
  summary.getCell("E4").value = { formula: "IF(B4=0,0,B5/B4)", result: totalObjective ? controlTotal / totalObjective : 0 };
  summary.getCell("D5").value = "Partidas con exceso";
  summary.getCell("E5").value = { formula: `COUNTIF(Presupuesto!$F$${BUDGET_FIRST_ROW}:$F$${lastBudgetRow},">0")`, result: linesWithExcess };
  summary.getCell("D6").value = "Costo control (pagado/cotizado)";
  summary.getCell("E6").value = { formula: `Presupuesto!L${totalsRow}`, result: controlTotal };
  summary.getCell("D7").value = "Saldo vs objetivo";
  summary.getCell("E7").value = { formula: "B4-E6", result: totalObjective - controlTotal };
  for (const address of ["B4", "B5", "B6", "B7", "E6", "E7"]) formatMoneyCell(summary.getCell(address), budgetCurrencyFormat(workbook));
  summary.getCell("E4").style = { ...structuredClone(summary.getCell("E4").style), numFmt: "0.0%" };
  summary.getCell("E5").style = { ...structuredClone(summary.getCell("E5").style), numFmt: "0" };
  summary.getCell("H12").value = "Los nuevos pagos se registran en Compras y gastos; el pagado histórico se conserva por separado.";

  if (/tipo|type/i.test(text(summary.getCell("A10").value))) {
    summary.getCell("B10").value = "Objetivo";
    summary.getCell("C10").value = "Exceso sobre objetivo";
    summary.getCell("D10").value = "% del objetivo";
    for (let row = 11; row <= summary.rowCount; row += 1) {
      const type = text(summary.getCell(row, 1).value);
      if (!type) break;
      let groupObjective = 0; let groupExcess = 0;
      const budget = workbook.getWorksheet(BUDGET_SHEET)!;
      for (let budgetRow = BUDGET_FIRST_ROW; budgetRow <= lastBudgetRow; budgetRow += 1) {
        if (outsideBudgetRow(budget, budgetRow) || text(budget.getCell(budgetRow, BUDGET_COLUMNS.type).value) !== type) continue;
        const objective = number(budget.getCell(budgetRow, BUDGET_COLUMNS.objective).value);
        const control = Math.max(number(budget.getCell(budgetRow, BUDGET_COLUMNS.paid).value), number(budget.getCell(budgetRow, BUDGET_COLUMNS.quote).value));
        groupObjective += objective;
        groupExcess += Math.max(0, control - objective);
      }
      summary.getCell(row, 2).value = { formula: `SUMIFS(Presupuesto!$E$${BUDGET_FIRST_ROW}:$E$${lastBudgetRow},Presupuesto!$C$${BUDGET_FIRST_ROW}:$C$${lastBudgetRow},A${row},Presupuesto!$AA$${BUDGET_FIRST_ROW}:$AA$${lastBudgetRow},"<>1")`, result: groupObjective };
      summary.getCell(row, 3).value = { formula: `SUMIFS(Presupuesto!$F$${BUDGET_FIRST_ROW}:$F$${lastBudgetRow},Presupuesto!$C$${BUDGET_FIRST_ROW}:$C$${lastBudgetRow},A${row},Presupuesto!$AA$${BUDGET_FIRST_ROW}:$AA$${lastBudgetRow},"<>1")`, result: groupExcess };
      summary.getCell(row, 4).value = { formula: `IF($B$4=0,0,B${row}/$B$4)`, result: totalObjective ? groupObjective / totalObjective : 0 };
      formatMoneyCell(summary.getCell(row, 2), budgetCurrencyFormat(workbook));
      formatMoneyCell(summary.getCell(row, 3), budgetCurrencyFormat(workbook));
      summary.getCell(row, 4).numFmt = "0.0%";
    }
  }
  summary.getCell("H14").value = "Rojo = la partida excede su objetivo; revise primero esos montos.";
  summary.getCell("H16").value = "El objetivo total es la única referencia del presupuesto.";
  summary.getCell("A20").value = "Dentro del objetivo";
  summary.getCell("B20").value = "Verde";
  summary.getCell("D20").value = "Costo ≤ objetivo";
  summary.getCell("A21").value = "Exceso sobre objetivo";
  summary.getCell("B21").value = "Rojo";
  summary.getCell("D21").value = "Costo > objetivo";
  for (let column = 1; column <= 8; column += 1) summary.getCell(22, column).value = null;
}

function ensureObjectiveOnlyPurchases(workbook: ExcelJS.Workbook, lastBudgetRow: number) {
  const purchases = workbook.getWorksheet("Compras");
  const budget = workbook.getWorksheet(BUDGET_SHEET);
  if (!purchases || !budget) return;
  const recognized = /objetivo|maximum|maximo|máximo|exceso/i.test(text(purchases.getCell("D3").value))
    && /objetivo|maximum|maximo|máximo|exceso/i.test(text(purchases.getCell("G3").value));
  if (!recognized) return;

  purchases.getCell("A2").value = "Cotización y proveedor se editan en Presupuesto. Los nuevos pagos se registran en Compras y gastos; el Excel descargado los resume sin duplicarlos.";
  purchases.getCell("D3").value = "Objetivo unit.";
  purchases.getCell("E3").value = "Exceso unit.";
  purchases.getCell("F3").value = "Objetivo total";
  purchases.getCell("G3").value = "Exceso sobre objetivo";

  for (let row = 4; row <= purchases.rowCount; row += 1) {
    const item = text(purchases.getCell(row, 2).value);
    if (!item || /^TOTAL/i.test(item)) continue;
    const quantity = number(purchases.getCell(row, 3).value);
    let objective = 0; let excess = 0; let quote = 0; let paid = 0; let control = 0;
    for (let budgetRow = BUDGET_FIRST_ROW; budgetRow <= lastBudgetRow; budgetRow += 1) {
      if (outsideBudgetRow(budget, budgetRow) || text(budget.getCell(budgetRow, BUDGET_COLUMNS.item).value) !== item) continue;
      objective += number(budget.getCell(budgetRow, BUDGET_COLUMNS.objective).value);
      excess += number(budget.getCell(budgetRow, BUDGET_COLUMNS.excess).value);
      quote += number(budget.getCell(budgetRow, BUDGET_COLUMNS.quote).value);
      paid += number(budget.getCell(budgetRow, BUDGET_COLUMNS.paid).value);
      control += number(budget.getCell(budgetRow, BUDGET_COLUMNS.controlCost).value);
    }
    purchases.getCell(row, 4).value = { formula: `IF(C${row}=0,0,F${row}/C${row})`, result: quantity ? objective / quantity : 0 };
    purchases.getCell(row, 5).value = { formula: `IF(C${row}=0,0,G${row}/C${row})`, result: quantity ? excess / quantity : 0 };
    purchases.getCell(row, 6).value = { formula: `SUMIFS(Presupuesto!$E$${BUDGET_FIRST_ROW}:$E$${lastBudgetRow},Presupuesto!$B$${BUDGET_FIRST_ROW}:$B$${lastBudgetRow},B${row},Presupuesto!$AA$${BUDGET_FIRST_ROW}:$AA$${lastBudgetRow},"<>1")`, result: objective };
    purchases.getCell(row, 7).value = { formula: `SUMIFS(Presupuesto!$F$${BUDGET_FIRST_ROW}:$F$${lastBudgetRow},Presupuesto!$B$${BUDGET_FIRST_ROW}:$B$${lastBudgetRow},B${row},Presupuesto!$AA$${BUDGET_FIRST_ROW}:$AA$${lastBudgetRow},"<>1")`, result: excess };
    purchases.getCell(row, 8).value = { formula: `SUMIFS(Presupuesto!$G$${BUDGET_FIRST_ROW}:$G$${lastBudgetRow},Presupuesto!$B$${BUDGET_FIRST_ROW}:$B$${lastBudgetRow},B${row},Presupuesto!$AA$${BUDGET_FIRST_ROW}:$AA$${lastBudgetRow},"<>1")`, result: quote };
    purchases.getCell(row, 9).value = { formula: `SUMIFS(Presupuesto!$J$${BUDGET_FIRST_ROW}:$J$${lastBudgetRow},Presupuesto!$B$${BUDGET_FIRST_ROW}:$B$${lastBudgetRow},B${row},Presupuesto!$AA$${BUDGET_FIRST_ROW}:$AA$${lastBudgetRow},"<>1")`, result: paid };
    purchases.getCell(row, 10).value = { formula: `IF(I${row}>0,"Comprado",IF(H${row}>0,"Cotizado","Pendiente"))`, result: paid > 0 ? "Comprado" : quote > 0 ? "Cotizado" : "Pendiente" };
    purchases.getCell(row, 11).value = { formula: `SUMIFS(Presupuesto!$L$${BUDGET_FIRST_ROW}:$L$${lastBudgetRow},Presupuesto!$B$${BUDGET_FIRST_ROW}:$B$${lastBudgetRow},B${row},Presupuesto!$AA$${BUDGET_FIRST_ROW}:$AA$${lastBudgetRow},"<>1")`, result: control || "" };
    purchases.getCell(row, 12).value = { formula: `IF(K${row}=0,"",IF(G${row}>0,"SOBRE OBJETIVO","OK"))`, result: control ? (excess > 0 ? "SOBRE OBJETIVO" : "OK") : "" };
    for (const column of [4, 5, 6, 7, 8, 9, 11]) formatMoneyCell(purchases.getCell(row, column), budgetCurrencyFormat(workbook));
  }
}

function ensureObjectiveOnlyAssumptions(workbook: ExcelJS.Workbook) {
  const assumptions = workbook.getWorksheet("Supuestos");
  if (!assumptions) return;
  assumptions.eachRow((row) => row.eachCell((cell) => {
    const value = text(cell.value);
    if (/tope absoluto de proyecto/i.test(value)) cell.value = value.replace(/tope absoluto de proyecto/i, "Objetivo total del proyecto");
  }));
}

export function ensureObjectiveOnlyBudget(workbook: ExcelJS.Workbook) {
  ensureBudgetColumnOrder(workbook);
  const budget = workbook.getWorksheet(BUDGET_SHEET);
  if (!budget) return;
  let lastBudgetRow = BUDGET_FIRST_ROW - 1;
  let totalsRow = 0;
  for (let row = BUDGET_FIRST_ROW; row <= budget.rowCount; row += 1) {
    const chapter = text(budget.getCell(row, BUDGET_COLUMNS.chapter).value);
    const item = text(budget.getCell(row, BUDGET_COLUMNS.item).value);
    if (/^TOTAL/i.test(chapter)) { totalsRow = row; break; }
    if (!chapter || !item) continue;
    lastBudgetRow = row;
    const objective = number(budget.getCell(row, BUDGET_COLUMNS.objective).value);
    const quote = number(budget.getCell(row, BUDGET_COLUMNS.quote).value);
    const paid = number(budget.getCell(row, BUDGET_COLUMNS.paid).value);
    const outside = outsideBudgetRow(budget, row);
    const control = outside ? 0 : Math.max(paid, quote);
    const excess = Math.max(0, control - objective);
    budget.getCell(row, BUDGET_COLUMNS.excess).value = { formula: `IF(AA${row}=1,0,MAX(0,MAX(J${row},G${row})-E${row}))`, result: excess };
    budget.getCell(row, BUDGET_COLUMNS.controlCost).value = { formula: `IF(AA${row}=1,0,IF(MAX(J${row},G${row})>0,MAX(J${row},G${row}),""))`, result: control || "" };
    budget.getCell(row, BUDGET_COLUMNS.alert).value = { formula: `IF(AA${row}=1,"FUERA DE OBJETIVO",IF(L${row}="","SIN DATOS",IF(L${row}>E${row},"SOBRE OBJETIVO","OK")))`, result: outside ? "FUERA DE OBJETIVO" : control ? (control > objective ? "SOBRE OBJETIVO" : "OK") : "SIN DATOS" };
    for (const column of [5, 6, 7, 8, 10, 12]) formatMoneyCell(budget.getCell(row, column), budgetCurrencyFormat(workbook));
  }
  budget.getCell(BUDGET_HEADER_ROW, BUDGET_COLUMNS.outsideObjective).value = "Fuera de objetivo (1 = sí)";
  budget.getColumn(BUDGET_COLUMNS.outsideObjective).width = 24;
  budget.getCell(BUDGET_HEADER_ROW, BUDGET_COLUMNS.excess).value = "Exceso sobre objetivo";
  if (lastBudgetRow < BUDGET_FIRST_ROW && totalsRow) for (const column of [5, 6, 7, 10, 12]) budget.getCell(totalsRow, column).value = 0;
  if (lastBudgetRow >= BUDGET_FIRST_ROW) {
    if (!totalsRow) {
      totalsRow = lastBudgetRow + 2;
      budget.getCell(totalsRow, BUDGET_COLUMNS.chapter).value = "TOTAL";
    }
    const totalExcess = Array.from({ length: lastBudgetRow - BUDGET_FIRST_ROW + 1 }, (_, index) => number(budget.getCell(BUDGET_FIRST_ROW + index, BUDGET_COLUMNS.excess).value)).reduce((sum, value) => sum + value, 0);
    const totalControl = Array.from({ length: lastBudgetRow - BUDGET_FIRST_ROW + 1 }, (_, index) => {
      const row = BUDGET_FIRST_ROW + index;
      if (outsideBudgetRow(budget, row)) return 0;
      return Math.max(number(budget.getCell(row, BUDGET_COLUMNS.paid).value), number(budget.getCell(row, BUDGET_COLUMNS.quote).value));
    }).reduce((sum, value) => sum + value, 0);
    const hasOutside = Array.from({ length: lastBudgetRow - BUDGET_FIRST_ROW + 1 }, (_, i) => outsideBudgetRow(budget, BUDGET_FIRST_ROW + i)).some(Boolean);
    for (const [column, letter] of [[5, "E"], [7, "G"], [10, "J"]] as const) {
      const result = Array.from({ length: lastBudgetRow - BUDGET_FIRST_ROW + 1 }, (_, i) => outsideBudgetRow(budget, BUDGET_FIRST_ROW + i) ? 0 : number(budget.getCell(BUDGET_FIRST_ROW + i, column).value)).reduce((a, b) => a + b, 0);
      budget.getCell(totalsRow, column).value = { formula: hasOutside ? `SUMIF(AA${BUDGET_FIRST_ROW}:AA${lastBudgetRow},"<>1",${letter}${BUDGET_FIRST_ROW}:${letter}${lastBudgetRow})` : `SUM(${letter}${BUDGET_FIRST_ROW}:${letter}${lastBudgetRow})`, result };
    }
    budget.getCell(totalsRow, BUDGET_COLUMNS.excess).value = { formula: `SUM(F${BUDGET_FIRST_ROW}:F${lastBudgetRow})`, result: totalExcess };
    budget.getCell(totalsRow, BUDGET_COLUMNS.controlCost).value = { formula: `SUM(L${BUDGET_FIRST_ROW}:L${lastBudgetRow})`, result: totalControl };
    budget.getCell(totalsRow, BUDGET_COLUMNS.alert).value = { formula: `IF(L${totalsRow}=0,"SIN DATOS",IF(F${totalsRow}>0,"SOBRE OBJETIVO","OK"))`, result: totalControl ? (totalExcess > 0 ? "SOBRE OBJETIVO" : "OK") : "SIN DATOS" };
    ensureObjectiveOnlySummary(workbook, lastBudgetRow, totalsRow);
    ensureObjectiveOnlyPurchases(workbook, lastBudgetRow);
    ensureObjectiveOnlyAssumptions(workbook);
  }
  if (totalsRow) for (const column of [5, 6, 7, 8, 10, 12]) formatMoneyCell(budget.getCell(totalsRow, column), budgetCurrencyFormat(workbook));
}
const lineFingerprint = (chapter: string, item: string, row: number) => `${chapter}\u241f${item}\u241f${row}`;
export const stableLineId = (chapter: string, item: string, row: number) => createHash("sha256").update(lineFingerprint(chapter, item, row)).digest("hex").slice(0, 24);

export async function loadWorkbook(bytes: Buffer | Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as never);
  return workbook;
}

export function createStarterWorkbook(currency: ProjectCurrency = "CRC") {
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet(BUDGET_SHEET, { views: [{ state: "frozen", ySplit: 3 }] });
  sheet.mergeCells("A1:R1"); sheet.getCell("A1").value = "House Planner · Personal budget";
  sheet.getCell("A1").font = { name: "Calibri", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF292B34" } };
  sheet.getCell("A1").alignment = { vertical: "middle" }; sheet.getRow(1).height = 30;
  sheet.getRow(3).values = BUDGET_HEADERS;
  sheet.getRow(4).values = ["General", "Nueva partida", "", "", 0, { formula: "MAX(0,IF(J4>0,J4,IF(G4>0,G4,0))-E4)", result: 0 }, null, { formula: "E4-G4" }, null, null, "", { formula: "IF(J4>0,J4,IF(G4>0,G4,\"\"))" }, { formula: "IF(L4=\"\",\"SIN DATOS\",IF(L4>E4,\"SOBRE OBJETIVO\",\"OK\"))" }, "", "", "", "", false];
  sheet.getRow(5).values = ["TOTAL", "", "", "", { formula: "SUM(E4:E4)" }, { formula: "SUM(F4:F4)" }, { formula: "SUM(G4:G4)" }, "", "", { formula: "SUM(J4:J4)" }];
  for (let column = 1; column <= 18; column += 1) {
    const header = sheet.getCell(3, column); header.font = { name: "Calibri", size: 9, bold: true, color: { argb: "FFFFFFFF" } }; header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF292B34" } }; header.alignment = { vertical: "middle", wrapText: true };
    const cell = sheet.getCell(4, column); cell.font = { name: "Calibri", size: 9 }; cell.alignment = { vertical: "top", wrapText: true };
  }
  setWorkbookCurrency(workbook, currency);
  [18, 28, 14, 16, 15, 15, 17, 17, 15, 16, 23, 17, 18, 19, 19, 13, 19, 14].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.getRow(3).height = 32; sheet.getRow(4).height = 25; ensureBudgetProgressIndicators(workbook); ensureLineMapping(workbook);
  return workbook;
}

export function applyLegacyOverrides(workbook: ExcelJS.Workbook, overrides: Array<{ sheetName: string; rowIndex: number; columnIndex: number; value: unknown }>) {
  for (const override of overrides) {
    const sheet = workbook.getWorksheet(override.sheetName);
    if (sheet) sheet.getCell(override.rowIndex + 1, override.columnIndex + 1).value = override.value as ExcelJS.CellValue;
  }
}

export function ensureLineMapping(workbook: ExcelJS.Workbook) {
  const budget = workbook.getWorksheet(BUDGET_SHEET);
  if (!budget) throw new Error(`Missing ${BUDGET_SHEET} sheet`);
  let mapping = workbook.getWorksheet(MAPPING_SHEET);
  if (!mapping) mapping = workbook.addWorksheet(MAPPING_SHEET, { state: "veryHidden" });
  mapping.state = "veryHidden";
  mapping.getRow(1).values = ["Version", "2", "Currency", workbookCurrency(workbook)];
  mapping.getRow(2).values = ["Budget line UUID", "Sheet", "Row", "Chapter", "Item", "Key"];
  const existing = new Map<string, string>();
  const existingByRow = new Map<number, string>();
  for (let row = 3; row <= mapping.rowCount; row += 1) {
    const values = mapping.getRow(row).values as ExcelJS.CellValue[];
    const id = text(values[1]); const sourceRow = number(values[3]); const key = text(values[6]);
    if (id && key) existing.set(key, id);
    if (id && sourceRow) existingByRow.set(sourceRow, id);
  }
  mapping.spliceRows(3, Math.max(0, mapping.rowCount - 2));
  let mappingRow = 3;
  for (let row = BUDGET_FIRST_ROW; row <= budget.rowCount; row += 1) {
    const chapter = text(budget.getCell(row, 1).value);
    const item = text(budget.getCell(row, 2).value);
    if (!chapter || !item || /^TOTAL/i.test(chapter)) continue;
    const key = lineFingerprint(chapter, item, row);
    const explicitId = text(budget.getCell(row, 26).value);
    if (explicitId.startsWith("new:")) budget.getColumn(26).hidden = true;
    mapping.getRow(mappingRow).values = [explicitId.startsWith("new:") ? explicitId.slice(4) : existing.get(key) || existingByRow.get(row) || stableLineId(chapter, item, row), BUDGET_SHEET, row, chapter, item, key];
    mappingRow += 1;
  }
}

export function readBudgetLines(workbook: ExcelJS.Workbook): BudgetLine[] {
  ensureObjectiveOnlyBudget(workbook);
  ensureLineMapping(workbook);
  const budget = workbook.getWorksheet(BUDGET_SHEET)!;
  const mapping = workbook.getWorksheet(MAPPING_SHEET)!;
  const ids = new Map<number, string>();
  for (let row = 3; row <= mapping.rowCount; row += 1) ids.set(number(mapping.getCell(row, 3).value), text(mapping.getCell(row, 1).value));
  const lines: BudgetLine[] = [];
  for (let row = BUDGET_FIRST_ROW; row <= budget.rowCount; row += 1) {
    const chapter = text(budget.getCell(row, 1).value);
    const item = text(budget.getCell(row, 2).value);
    if (!chapter || !item || /^TOTAL/i.test(chapter)) continue;
    const quote = number(budget.getCell(row, BUDGET_COLUMNS.quote).value);
    const paid = number(budget.getCell(row, BUDGET_COLUMNS.paid).value);
    const status = normalizeBudgetProgressStatus(budget.getCell(row, BUDGET_COLUMNS.status).value);
    lines.push({ id: ids.get(row) || stableLineId(chapter, item, row), row, chapter, item,
      type: text(budget.getCell(row, BUDGET_COLUMNS.type).value), subcategory: text(budget.getCell(row, BUDGET_COLUMNS.subcategory).value),
      outsideObjective: number(budget.getCell(row, BUDGET_COLUMNS.outsideObjective).value) === 1,
      objective: number(budget.getCell(row, BUDGET_COLUMNS.objective).value), excess: number(budget.getCell(row, BUDGET_COLUMNS.outsideObjective).value) === 1 ? 0 : Math.max(0, Math.max(paid, quote) - number(budget.getCell(row, BUDGET_COLUMNS.objective).value)),
      quote, paid, supplier: text(budget.getCell(row, BUDGET_COLUMNS.supplier).value), status });
  }
  return lines;
}

export function availableBudgetRows(workbook: ExcelJS.Workbook) {
  const budget = workbook.getWorksheet(BUDGET_SHEET);
  if (!budget) return [];
  let lastBudgetRow = budget.rowCount;
  for (let row = BUDGET_FIRST_ROW; row <= budget.rowCount; row += 1) {
    if (/^TOTAL/i.test(text(budget.getCell(row, 1).value))) { lastBudgetRow = row - 1; break; }
  }
  const available: number[] = [];
  for (let row = BUDGET_FIRST_ROW; row <= lastBudgetRow; row += 1) {
    if (!text(budget.getCell(row, 1).value) && !text(budget.getCell(row, 2).value)) available.push(row);
  }
  return available;
}

export function prepareBudgetRows(workbook: ExcelJS.Workbook, base: UniverWorkbook, draft: UniverWorkbook) {
  const known = new Set(Object.values(base.sheets).flatMap((sheet) => Object.values(sheet.cellData).map((cells) => String(cells[25]?.v || ""))).filter(Boolean));
  const additions = Object.values(draft.sheets).flatMap((sheet) => Object.entries(sheet.cellData)).filter(([row, cells]) => Number(row) >= 3 && cells[0]?.v && cells[1]?.v && !/^TOTAL/i.test(String(cells[0].v)) && !known.has(String(cells[25]?.v || ""))).length;
  const available = availableBudgetRows(workbook);
  const needed = additions - available.length;
  if (needed <= 0) return available;
  if (needed > 500) throw new Error("Add at most 500 budget rows per draft");
  const sheet = workbook.getWorksheet(BUDGET_SHEET)!;
  let insertion = sheet.rowCount + 1;
  for (let row = 4; row <= sheet.rowCount; row++) if (/^TOTAL/i.test(text(sheet.getCell(row, 1).value))) { insertion = row; break; }
  // Insert below all existing items, so row mappings and receipt identities stay stable.
  sheet.spliceRows(insertion, 0, ...Array.from({ length: needed }, () => []));
  workbook.eachSheet((target) => target.eachRow((row) => row.eachCell((cell) => {
    if (!cell.formula) return;
    let formula = cell.formula;
    if (target.name === BUDGET_SHEET) formula = formula.replace(/(\$?[A-Z]{1,3}\$?)(\d+)/g, (match, column, number) => Number(number) >= insertion ? `${column}${Number(number) + needed}` : match);
    else formula = formula.replace(/((?:'Presupuesto'|Presupuesto)!\$?[A-Z]{1,3}\$?)(\d+)/g, (match, prefix, number) => Number(number) >= insertion ? `${prefix}${Number(number) + needed}` : match);
    if (formula !== cell.formula) cell.value = { formula, result: cell.result } as ExcelJS.CellFormulaValue;
  })));
  return availableBudgetRows(workbook);
}

export function budgetLinesEqual(left: BudgetLine[], right: BudgetLine[]) {
  const fields: Array<keyof BudgetLine> = ["id", "row", "chapter", "item", "type", "subcategory", "objective", "excess", "quote", "paid", "supplier", "status", "outsideObjective"];
  return left.length === right.length && left.every((line, index) => fields.every((field) => line[field] === right[index]?.[field]));
}

const progressPalette: Record<BudgetProgressStatus, { fill: string; text: string }> = {
  Completada: { fill: `FF${BUDGET_PROGRESS_APPEARANCE.Completada.cell.slice(1)}`, text: `FF${BUDGET_PROGRESS_APPEARANCE.Completada.text.slice(1)}` },
  "En progreso": { fill: `FF${BUDGET_PROGRESS_APPEARANCE["En progreso"].cell.slice(1)}`, text: `FF${BUDGET_PROGRESS_APPEARANCE["En progreso"].text.slice(1)}` },
  Pendiente: { fill: `FF${BUDGET_PROGRESS_APPEARANCE.Pendiente.cell.slice(1)}`, text: `FF${BUDGET_PROGRESS_APPEARANCE.Pendiente.text.slice(1)}` },
};
const progressRowFill: Record<BudgetProgressStatus, string> = {
  Completada: `FF${BUDGET_PROGRESS_APPEARANCE.Completada.row.slice(1)}`,
  "En progreso": `FF${BUDGET_PROGRESS_APPEARANCE["En progreso"].row.slice(1)}`,
  Pendiente: `FF${BUDGET_PROGRESS_APPEARANCE.Pendiente.row.slice(1)}`,
};

function styleProgressCell(cell: ExcelJS.Cell, status: BudgetProgressStatus) {
  const palette = progressPalette[status];
  cell.font = { ...cell.font, bold: true, color: { argb: palette.text } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: palette.fill } };
  cell.alignment = { ...cell.alignment, horizontal: "center", vertical: "middle", wrapText: true };
  cell.numFmt = "General";
}

export function ensureBudgetProgressIndicators(workbook: ExcelJS.Workbook) {
  ensureObjectiveOnlyBudget(workbook);
  const budget = workbook.getWorksheet(BUDGET_SHEET);
  if (!budget) return;
  const rows: number[] = [];
  const counts: Record<BudgetProgressStatus, number> = { Completada: 0, "En progreso": 0, Pendiente: 0 };
  for (let row = BUDGET_FIRST_ROW; row <= budget.rowCount; row += 1) {
    const chapter = text(budget.getCell(row, 1).value);
    const item = text(budget.getCell(row, 2).value);
    if (!chapter || !item || /^TOTAL/i.test(chapter)) continue;
    rows.push(row);
    const cell = budget.getCell(row, BUDGET_COLUMNS.status);
    const status = normalizeBudgetProgressStatus(cell.value);
    counts[status] += 1;
    for (let column = 1; column <= 18; column += 1) {
      budget.getCell(row, column).fill = { type: "pattern", pattern: "solid", fgColor: { argb: progressRowFill[status] } };
    }
    cell.value = status;
    cell.dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: ['"Pendiente,En progreso,Completada"'],
      showErrorMessage: true,
      errorStyle: "stop",
      errorTitle: "Estado no válido",
      error: "Seleccioná Pendiente, En progreso o Completada.",
    };
    styleProgressCell(cell, status);
  }
  if (!rows.length) return;
  const firstRow = rows[0]; const lastRow = rows[rows.length - 1]; const range = `I${firstRow}:I${lastRow}`;
  const summaries: Array<{ column: number; status: BudgetProgressStatus; symbol: string; singular: string; plural: string }> = [
    { column: 9, status: "Completada", symbol: "✓", singular: "completada", plural: "completadas" },
    { column: 11, status: "En progreso", symbol: "◐", singular: "en progreso", plural: "en progreso" },
    { column: 13, status: "Pendiente", symbol: "○", singular: "pendiente", plural: "pendientes" },
  ];
  for (const summary of summaries) {
    const count = counts[summary.status];
    const label = count === 1 ? summary.singular : summary.plural;
    const cell = budget.getCell(2, summary.column);
    const countFormula = `COUNTIFS($I$${firstRow}:$I$${lastRow},"${summary.status}",$A$${firstRow}:$A$${lastRow},"<>",$A$${firstRow}:$A$${lastRow},"<>TOTAL*",$B$${firstRow}:$B$${lastRow},"<>")`;
    cell.value = {
      formula: `"${summary.symbol} "&${countFormula}&" "&IF(${countFormula}=1,"${summary.singular}","${summary.plural}")`,
      result: `${summary.symbol} ${count} ${label}`,
    };
    styleProgressCell(cell, summary.status);
  }
  budget.getRow(2).height = Math.max(budget.getRow(2).height || 0, 28);
  const formattingBudget = budget as ExcelJS.Worksheet & { conditionalFormattings: ExcelJS.ConditionalFormattingOptions[] };
  formattingBudget.removeConditionalFormatting((format: ExcelJS.ConditionalFormattingOptions) => {
    const formulas = format.rules.flatMap((rule) => "formulae" in rule ? rule.formulae || [] : []).join(" ");
    const isProgressRule = /Completada|En progreso|Pendiente|Comprado|Cotizado/i.test(formulas);
    return isProgressRule && (/^[IN]\d+:[IN]\d+$/i.test(format.ref) || /^A\d+:R\d+$/i.test(format.ref));
  });
  const priority = Math.max(0, ...formattingBudget.conditionalFormattings.flatMap((format) => format.rules.map((rule) => Number(rule.priority || 0)))) + 1;
  budget.addConditionalFormatting({
    ref: range,
    rules: (["Completada", "En progreso", "Pendiente"] as BudgetProgressStatus[]).map((status, index) => ({
      type: "containsText" as const,
      operator: "containsText" as const,
      priority: priority + index,
      formulae: [`NOT(ISERROR(SEARCH("${status}",I${firstRow})))`],
      style: {
        fill: { type: "pattern" as const, pattern: "solid" as const, bgColor: { argb: progressPalette[status].fill } },
        font: { bold: true, color: { argb: progressPalette[status].text } },
      },
    })),
  });
  budget.addConditionalFormatting({
    ref: `A${firstRow}:R${lastRow}`,
    rules: (["Completada", "En progreso"] as BudgetProgressStatus[]).map((status, index) => ({
      type: "expression" as const,
      priority: priority + 3 + index,
      formulae: [`$I${firstRow}="${status}"`],
      style: {
        fill: { type: "pattern" as const, pattern: "solid" as const, bgColor: { argb: progressRowFill[status] } },
        font: { color: { argb: progressPalette[status].text } },
      },
    })),
  });
}

function color(value: Partial<ExcelJS.Color> | undefined) {
  const argb = "argb" in (value || {}) ? value?.argb : undefined;
  return argb ? `#${argb.slice(-6)}` : undefined;
}

export function toUniver(workbook: ExcelJS.Workbook, name = "House Planner"): UniverWorkbook {
  ensureObjectiveOnlyBudget(workbook);
  const sheets: Record<string, UniverSheet> = {}; const sheetOrder: string[] = [];
  workbook.eachSheet((worksheet, id) => {
    const sheetId = `sheet-${id}`; sheetOrder.push(sheetId);
    const sheet: UniverSheet = { id: sheetId, name: worksheet.name, rowCount: Math.max(100, worksheet.rowCount), columnCount: Math.max(27, worksheet.columnCount), cellData: {}, mergeData: [], rowData: {}, columnData: {}, hidden: worksheet.state !== "visible" };
    worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      if (row.height || row.hidden) sheet.rowData[rowNumber - 1] = { h: row.height, hd: row.hidden || undefined };
      row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
        const target: UniverCell = {}; const raw = cell.value;
        if (raw === null && !Object.keys(cell.style || {}).length) return;
        if (raw && typeof raw === "object" && "formula" in raw) { target.f = String(raw.formula); target.v = (raw as ExcelJS.CellFormulaValue).result as string | number | boolean | null; }
        else if (raw && typeof raw === "object" && "text" in raw && "hyperlink" in raw) { target.v = String(raw.text); target.p = { url: String(raw.hyperlink) }; }
        else if (raw instanceof Date) target.v = raw.toISOString();
        else if (["string", "number", "boolean"].includes(typeof raw) || raw === null) target.v = raw as string | number | boolean | null;
        else target.v = text(raw);
        const fontColor = color(cell.font?.color); const fill = cell.fill?.type === "pattern" ? color(cell.fill.fgColor) : undefined;
        target.s = { n: cell.numFmt || undefined, ff: cell.font?.name, fs: cell.font?.size, bl: cell.font?.bold, it: cell.font?.italic, ul: Boolean(cell.font?.underline), cl: fontColor ? { rgb: fontColor } : undefined, bg: fill ? { rgb: fill } : undefined, ht: cell.alignment?.horizontal, vt: cell.alignment?.vertical, tb: cell.alignment?.wrapText ? 1 : undefined };
        (sheet.cellData[rowNumber - 1] ||= {})[columnNumber - 1] = target;
      });
    });
    for (let column = 1; column <= worksheet.columnCount; column += 1) { const source = worksheet.getColumn(column); if (source.width || source.hidden) sheet.columnData[column - 1] = { w: source.width ? source.width * 7 : undefined, hd: source.hidden || undefined }; }
    for (const range of worksheet.model.merges || []) { const parsed = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/); if (parsed) sheet.mergeData.push({ startRow: Number(parsed[2]) - 1, endRow: Number(parsed[4]) - 1, startColumn: columnNumber(parsed[1]) - 1, endColumn: columnNumber(parsed[3]) - 1 }); }
    const frozen = (worksheet.views || []).find((view) => view.state === "frozen") as (ExcelJS.WorksheetView & { xSplit?: number; ySplit?: number }) | undefined; if (frozen) sheet.freeze = { startRow: frozen.ySplit || 0, startColumn: frozen.xSplit || 0, xSplit: frozen.xSplit || 0, ySplit: frozen.ySplit || 0 };
    sheets[sheetId] = sheet;
  });
  return { id: randomUUID(), name, currency: workbookCurrency(workbook), sheetOrder, sheets };
}

function sheetName(value: string, used: Set<string>) {
  const base = value.replace(/[\\/*?:[\]]/g, "-").trim().slice(0, 31) || "Unassigned";
  let candidate = base; let suffix = 2;
  while (used.has(candidate)) { const tail = ` ${suffix++}`; candidate = `${base.slice(0, 31 - tail.length)}${tail}`; }
  used.add(candidate);
  return candidate;
}

function categorySheet(source: UniverSheet, lines: BudgetLine[], key: BudgetGroupKey, label: string, id: string, name: string, currency: ProjectCurrency) {
  const matchingLines = lines.filter((line) => (line[key] || "Unassigned") === label);
  const sourceRows = [1, 2, 3, ...matchingLines.map((line) => line.row)];
  const lineByRow = new Map(matchingLines.map((line) => [line.row, line]));
  const sourceToTarget = new Map(sourceRows.map((row, index) => [row, index + 1]));
  const rowMap: Record<number, number> = {};
  const cellData: UniverSheet["cellData"] = {};
  const rowData: UniverSheet["rowData"] = {};
  for (const [index, sourceRow] of sourceRows.entries()) {
    const targetRow = index + 1; rowMap[targetRow] = sourceRow;
    const sourceCells = source.cellData[sourceRow - 1] || {};
    const cells: Record<number, UniverCell> = {};
    for (const [column, original] of Object.entries(sourceCells)) {
      const cell = structuredClone(original);
      if (cell.f && sourceRow > 3) cell.f = cell.f.replace(new RegExp(`([A-Z]{1,3})${sourceRow}\\b`, "g"), `$1${targetRow}`);
      cells[Number(column)] = cell;
    }
    const line = lineByRow.get(sourceRow);
    if (line) cells[GENERATED_LINE_ID_COLUMN] = { v: line.id };
    if (Object.keys(cells).length) cellData[targetRow - 1] = cells;
    if (source.rowData[sourceRow - 1]) rowData[targetRow - 1] = { ...source.rowData[sourceRow - 1], hd: false };
  }
  const mergeData = source.mergeData.flatMap((merge) => {
    const mapped = Array.from({ length: merge.endRow - merge.startRow + 1 }, (_, offset) => sourceToTarget.get(merge.startRow + offset + 1));
    if (mapped.some((row) => !row)) return [];
    return [{ ...merge, startRow: mapped[0]! - 1, endRow: mapped[mapped.length - 1]! - 1 }];
  });
  const sheet: UniverSheet = {
    ...source, id, name, rowCount: Math.max(30, sourceRows.length + 8), columnCount: Math.max(27, source.columnCount),
    cellData, rowData, mergeData, columnData: { ...source.columnData, [GENERATED_LINE_ID_COLUMN]: { ...source.columnData[GENERATED_LINE_ID_COLUMN], hd: true } }, hidden: false,
    freeze: source.freeze ? { ...source.freeze, startRow: Math.min(source.freeze.startRow, 3), ySplit: Math.min(source.freeze.ySplit, 3) } : { startRow: 3, startColumn: 0, xSplit: 0, ySplit: 3 },
  };
  const lastLineRow = Math.max(BUDGET_FIRST_ROW, BUDGET_HEADER_ROW + matchingLines.length);
  const summaries: Array<{ column: number; status: BudgetProgressStatus; symbol: string; singular: string; plural: string }> = [
    { column: 9, status: "Completada", symbol: "✓", singular: "completada", plural: "completadas" },
    { column: 11, status: "En progreso", symbol: "◐", singular: "en progreso", plural: "en progreso" },
    { column: 13, status: "Pendiente", symbol: "○", singular: "pendiente", plural: "pendientes" },
  ];
  sheet.cellData[1] ||= {};
  for (const summary of summaries) {
    const count = matchingLines.filter((line) => normalizeBudgetProgressStatus(line.status) === summary.status).length;
    const countFormula = `COUNTIFS($I$${BUDGET_FIRST_ROW}:$I$${lastLineRow},"${summary.status}",$A$${BUDGET_FIRST_ROW}:$A$${lastLineRow},"<>",$A$${BUDGET_FIRST_ROW}:$A$${lastLineRow},"<>TOTAL*",$B$${BUDGET_FIRST_ROW}:$B$${lastLineRow},"<>")`;
    sheet.cellData[1][summary.column - 1] = {
      ...sheet.cellData[1][summary.column - 1],
      f: `"${summary.symbol} "&${countFormula}&" "&IF(${countFormula}=1,"${summary.singular}","${summary.plural}")`,
      v: `${summary.symbol} ${count} ${count === 1 ? summary.singular : summary.plural}`,
    };
  }
  const totalRow = sourceRows.length;
  sheet.cellData[totalRow] = {
    0: { v: "TOTAL" },
    4: { f: `SUMIF(AA4:AA${totalRow},"<>1",E4:E${totalRow})` },
    5: { f: `SUM(F4:F${totalRow})` },
    6: { f: `SUMIF(AA4:AA${totalRow},"<>1",G4:G${totalRow})` },
    9: { f: `SUMIF(AA4:AA${totalRow},"<>1",J4:J${totalRow})` },
  };
  for (const [column, field] of [[4, "objective"], [5, "excess"], [6, "quote"], [9, "paid"]] as const) {
    const total = matchingLines.filter((line) => !line.outsideObjective).reduce((sum, line) => sum + line[field], 0);
    sheet.cellData[totalRow][column].s = { n: currencyNumberFormat(currency, currency === "USD" || !Number.isInteger(total)) };
  }
  return { sheet, rowMap };
}

export function generateCategoryWorkbook(source: UniverWorkbook, lines: BudgetLine[], scope: WorkbookScope): GeneratedWorkbook {
  const sourceId = source.sheetOrder.find((id) => source.sheets[id]?.name === BUDGET_SHEET)
    || source.sheetOrder.find((id) => source.sheets[id]?.name === "Budget")
    || source.sheetOrder[0];
  const budget = source.sheets[sourceId];
  if (!budget) throw new Error("Budget sheet is unavailable");
  const labels = scope.all
    ? [...new Set(lines.map((line) => line[scope.key] || "Unassigned"))].sort((a, b) => a.localeCompare(b))
    : [scope.label || "Unassigned"];
  if (!labels.length) labels.push("General");
  const used = new Set<string>(); const sheets: Record<string, UniverSheet> = {}; const sheetOrder: string[] = []; const rowMaps: Record<string, Record<number, number>> = {};
  labels.forEach((label, index) => {
    const id = `category-${index + 1}`; const name = sheetName(label, used);
    const generated = categorySheet(budget, lines, scope.key, label, id, name, projectCurrency(source.currency));
    sheets[id] = generated.sheet; sheetOrder.push(id); rowMaps[name] = generated.rowMap;
  });
  return { workbook: { id: randomUUID(), name: scope.all ? `${source.name} · ${scope.key}` : `${scope.label} · ${source.name}`, currency: projectCurrency(source.currency), sheetOrder, sheets }, rowMaps };
}

function columnNumber(letters: string) { return [...letters].reduce((result, letter) => result * 26 + letter.charCodeAt(0) - 64, 0); }

export async function scanUnsupportedFeatures(bytes: Buffer | Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const paths = Object.keys(zip.files);
  const checks: Array<[string, RegExp]> = [["macros", /vbaProject\.bin/i], ["charts", /xl\/charts\//i], ["pivot tables", /xl\/pivot/i], ["slicers", /xl\/slicer/i], ["external links", /xl\/externalLinks\//i]];
  return checks.filter(([, pattern]) => paths.some((path) => pattern.test(path))).map(([label]) => label);
}

export async function writeWorkbook(workbook: ExcelJS.Workbook, currency: ProjectCurrency = workbookCurrency(workbook)) {
  setWorkbookCurrency(workbook, currency);
  ensureBudgetProgressIndicators(workbook);
  ensureLineMapping(workbook);
  workbook.calcProperties.fullCalcOnLoad = true;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function diffUniverWorkbooks(base: UniverWorkbook, draft: UniverWorkbook) {
  const changes: Array<{ sheet: string; row: number; column: number; before: UniverCell | null; after: UniverCell | null }> = [];
  for (const sheetId of draft.sheetOrder) {
    const afterSheet = draft.sheets[sheetId]; const beforeSheet = Object.values(base.sheets).find((sheet) => sheet.name === afterSheet?.name);
    if (!afterSheet || afterSheet.name === MAPPING_SHEET) continue;
    const rows = new Set([...Object.keys(beforeSheet?.cellData || {}), ...Object.keys(afterSheet.cellData || {})]);
    for (const row of rows) {
      const beforeRow = beforeSheet?.cellData[Number(row)] || {}; const afterRow = afterSheet.cellData[Number(row)] || {};
      const columns = new Set([...Object.keys(beforeRow), ...Object.keys(afterRow)]);
      for (const column of columns) { const before = beforeRow[Number(column)] || null; const after = afterRow[Number(column)] || null; if (JSON.stringify(before) !== JSON.stringify(after)) changes.push({ sheet: afterSheet.name, row: Number(row) + 1, column: Number(column) + 1, before, after }); }
    }
  }
  return changes;
}

export type UniverChange = ReturnType<typeof diffUniverWorkbooks>[number];

export class UnsafeGeneratedWorkbookError extends Error {
  constructor() {
    super("The workbook snapshot is missing its budget row identities. Reopen the workbook and try again.");
    this.name = "UnsafeGeneratedWorkbookError";
  }
}

export function mapGeneratedChanges(changes: UniverChange[], rowMaps: Record<string, Record<number, number>>) {
  return changes.flatMap((change) => {
    const sourceRow = rowMaps[change.sheet]?.[change.row];
    return sourceRow ? [{ ...change, sheet: BUDGET_SHEET, row: sourceRow }] : [];
  });
}

export function diffGeneratedUniverWorkbooks(base: UniverWorkbook, draft: UniverWorkbook, rowMaps: Record<string, Record<number, number>>, availableSourceRows: number[] = []) {
  const mapped: UniverChange[] = [];
  const remainingSourceRows = new Set(availableSourceRows);
  for (const baseSheetId of base.sheetOrder) {
    const beforeSheet = base.sheets[baseSheetId];
    const afterSheet = Object.values(draft.sheets).find((sheet) => sheet.name === beforeSheet?.name);
    if (!beforeSheet || !afterSheet) continue;
    const sourceRows = rowMaps[beforeSheet.name] || {};
    const beforeById = new Map<string, number>();
    const afterById = new Map<string, number>();
    for (const [row, cells] of Object.entries(beforeSheet.cellData)) {
      const id = String(cells[GENERATED_LINE_ID_COLUMN]?.v || "");
      if (id) beforeById.set(id, Number(row));
    }
    for (const [row, cells] of Object.entries(afterSheet.cellData)) {
      const id = String(cells[GENERATED_LINE_ID_COLUMN]?.v || "");
      if (id && beforeById.has(id) && !afterById.has(id)) afterById.set(id, Number(row));
    }
    if (!beforeById.size && !Object.values(afterSheet.cellData).some((cells) => String(cells[25]?.v || "").startsWith("new:"))) return mapGeneratedChanges(diffUniverWorkbooks(base, draft), rowMaps);
    // Univer can omit cells in hidden columns from getSnapshot(). Recover an ID only
    // when the same visible budget row is still in place; moved/deleted rows retain
    // their normal identity-based behavior.
    for (const [id, beforeRowIndex] of beforeById) {
      if (afterById.has(id)) continue;
      const cells = afterSheet.cellData[beforeRowIndex];
      const existingId = String(cells?.[GENERATED_LINE_ID_COLUMN]?.v || "");
      const chapter = String(cells?.[0]?.v ?? "").trim();
      const item = String(cells?.[1]?.v ?? "").trim();
      if (!existingId && chapter && item && !/^TOTAL/i.test(chapter)) afterById.set(id, beforeRowIndex);
    }
    const missingIdentityCount = [...beforeById.keys()].filter((id) => !afterById.has(id)).length;
    if ((beforeById.size > 0 && missingIdentityCount === beforeById.size) || (beforeById.size >= 4 && missingIdentityCount / beforeById.size > 0.5)) {
      throw new UnsafeGeneratedWorkbookError();
    }
    for (const [id, beforeRowIndex] of beforeById) {
      const sourceRow = sourceRows[beforeRowIndex + 1];
      if (!sourceRow) continue;
      const afterRowIndex = afterById.get(id);
      const beforeRow = beforeSheet.cellData[beforeRowIndex] || {};
      const afterRow = afterRowIndex === undefined ? {} : afterSheet.cellData[afterRowIndex] || {};
      const columns = new Set([...Object.keys(beforeRow), ...Object.keys(afterRow)]);
      for (const columnText of columns) {
        const columnIndex = Number(columnText);
        if (columnIndex === GENERATED_LINE_ID_COLUMN) {
          if (!afterRow[0]?.v && !afterRow[1]?.v) mapped.push({ sheet: BUDGET_SHEET, row: sourceRow, column: 26, before: null, after: null });
          continue;
        }
        const before = beforeRow[columnIndex] || null;
        const after = afterRow[columnIndex] || null;
        if (JSON.stringify(before) !== JSON.stringify(after)) mapped.push({ sheet: BUDGET_SHEET, row: sourceRow, column: columnIndex + 1, before, after });
      }
    }
    const identifiedAfterRows = new Set(afterById.values());
    const insertedRows = Object.entries(afterSheet.cellData).map(([row, cells]) => ({ rowIndex: Number(row), cells })).filter(({ rowIndex, cells }) => {
      if (rowIndex < BUDGET_HEADER_ROW || identifiedAfterRows.has(rowIndex)) return false;
      const chapter = String(cells[0]?.v ?? "").trim();
      const item = String(cells[1]?.v ?? "").trim();
      return Boolean(chapter && item && !/^TOTAL/i.test(chapter));
    }).sort((a, b) => a.rowIndex - b.rowIndex);
    const locatedRows = [...afterById.entries()].map(([id, afterRowIndex]) => ({ afterRowIndex, sourceRow: sourceRows[(beforeById.get(id) ?? -1) + 1] })).filter((item) => item.sourceRow);
    for (const inserted of insertedRows) {
      const previous = locatedRows.filter((item) => item.afterRowIndex < inserted.rowIndex).sort((a, b) => b.afterRowIndex - a.afterRowIndex)[0]?.sourceRow;
      const next = locatedRows.filter((item) => item.afterRowIndex > inserted.rowIndex).sort((a, b) => a.afterRowIndex - b.afterRowIndex)[0]?.sourceRow;
      const desired = previous ? previous + 1 : next ? next - 1 : Math.min(...remainingSourceRows);
      const sourceRow = [...remainingSourceRows].sort((left, right) => {
        const penalty = (row: number) => (previous && row <= previous ? 10_000 : 0) + (next && row >= next ? 10_000 : 0);
        return Math.abs(left - desired) + penalty(left) - (Math.abs(right - desired) + penalty(right));
      })[0];
      if (!sourceRow) throw new Error("No empty budget rows are available for new lines");
      remainingSourceRows.delete(sourceRow);
      locatedRows.push({ afterRowIndex: inserted.rowIndex, sourceRow });
      for (const [columnText, original] of Object.entries(inserted.cells)) {
        const columnIndex = Number(columnText);
        if (columnIndex === GENERATED_LINE_ID_COLUMN && !String(original.v || "").startsWith("new:")) continue;
        const after = structuredClone(original);
        if (after.f) after.f = after.f.replace(new RegExp(`([A-Z]{1,3})${inserted.rowIndex + 1}\\b`, "g"), `$1${sourceRow}`);
        mapped.push({ sheet: BUDGET_SHEET, row: sourceRow, column: columnIndex + 1, before: null, after });
      }
    }
  }
  return mapped;
}

function applyUniverCell(targetCell: ExcelJS.Cell, cell: UniverCell | null) {
  if (!cell) targetCell.value = null;
  else if (cell.f) targetCell.value = { formula: cell.f.replace(/^=/, ""), result: cell.v ?? undefined } as ExcelJS.CellFormulaValue;
  else if (cell.p?.url) targetCell.value = { text: String(cell.v ?? cell.p.url), hyperlink: cell.p.url };
  else targetCell.value = cell.v as ExcelJS.CellValue;
}

export function applyUniverChanges(workbook: ExcelJS.Workbook, changes: UniverChange[]) {
  for (const change of changes) {
    const target = workbook.getWorksheet(change.sheet);
    if (target) applyUniverCell(target.getCell(change.row, change.column), change.after);
  }
  ensureLineMapping(workbook);
}

export function applyUniverSnapshot(workbook: ExcelJS.Workbook, snapshot: UniverWorkbook) {
  for (const sheetId of snapshot.sheetOrder) {
    const source = snapshot.sheets[sheetId];
    if (!source || source.name === MAPPING_SHEET) continue;
    const target = workbook.getWorksheet(source.name);
    if (!target) continue;
    for (const [rowIndex, columns] of Object.entries(source.cellData || {})) {
      for (const [columnIndex, cell] of Object.entries(columns || {})) {
        const targetCell = target.getCell(Number(rowIndex) + 1, Number(columnIndex) + 1);
        applyUniverCell(targetCell, cell);
      }
    }
  }
  ensureLineMapping(workbook);
}
