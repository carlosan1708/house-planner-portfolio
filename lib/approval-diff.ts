import type { UniverCell, UniverChange, UniverWorkbook } from "./workbook";

export type ApprovalCell = {
  value: string | number | boolean | null;
  formula: string | null;
  numberFormat: string | null;
};

export type ApprovalChangeDetail = {
  sheet: string;
  row: number;
  column: number;
  rowLabel: string;
  groupLabel: string | null;
  before: ApprovalCell | null;
  after: ApprovalCell | null;
  calculated: boolean;
};

function displayCell(cell: UniverCell | null): ApprovalCell | null {
  if (!cell) return null;
  return {
    value: cell.v ?? null,
    formula: cell.f || null,
    numberFormat: typeof cell.s?.n === "string" ? cell.s.n : null,
  };
}

function sameExceptCachedValue(before: UniverCell | null, after: UniverCell | null) {
  if (!before?.f || !after?.f || before.f !== after.f) return false;
  const beforeRest = { ...before }; const afterRest = { ...after };
  delete beforeRest.v; delete afterRest.v;
  return JSON.stringify(beforeRest) === JSON.stringify(afterRest);
}

function workbookSheet(workbook: UniverWorkbook | null, name: string) {
  if (!workbook) return null;
  return Object.values(workbook.sheets).find((sheet) => sheet.name === name) || null;
}

function labelColumn(sheet: string) {
  return sheet === "Presupuesto" || sheet === "Compras" ? 2 : 1;
}

export function approvalChangeDetails(changes: UniverChange[], base: UniverWorkbook | null): ApprovalChangeDetail[] {
  const changedCells = new Map(changes.map((change) => [`${change.sheet}:${change.row}:${change.column}`, change.after]));
  return changes.map((change) => {
    const sheet = workbookSheet(base, change.sheet);
    const labelCol = labelColumn(change.sheet);
    const changedLabel = changedCells.get(`${change.sheet}:${change.row}:${labelCol}`);
    const baseLabel = sheet?.cellData[change.row - 1]?.[labelCol - 1] || null;
    const rawLabel = changedLabel === undefined ? baseLabel?.v : changedLabel?.v;
    const changedGroup = change.sheet === "Presupuesto" ? changedCells.get(`${change.sheet}:${change.row}:3`) : undefined;
    const baseGroup = change.sheet === "Presupuesto" ? sheet?.cellData[change.row - 1]?.[2] || null : null;
    const rawGroup = changedGroup === undefined ? baseGroup?.v : changedGroup?.v;
    return {
      sheet: change.sheet,
      row: change.row,
      column: change.column,
      rowLabel: String(rawLabel ?? (change.row === 94 ? "TOTAL" : `Row ${change.row}`)),
      groupLabel: rawGroup === null || rawGroup === undefined || rawGroup === "" ? null : String(rawGroup),
      before: displayCell(change.before),
      after: displayCell(change.after),
      calculated: sameExceptCachedValue(change.before, change.after),
    };
  });
}
