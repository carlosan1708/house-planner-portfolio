import type { UniverWorkbook } from "./workbook";

export const budgetInputColumns = [0, 1, 2, 3, 4, 6, 8, 9, 10, 26] as const;

export function addBudgetRow(workbook: UniverWorkbook, sheetId: string, fields: { chapter: string; item: string; type: string; subcategory: string }, id: string) {
  if (!fields.chapter.trim() || !fields.item.trim() || /^TOTAL/i.test(fields.chapter.trim())) throw new Error("Chapter and item are required");
  const next = structuredClone(workbook);
  const sheet = next.sheets[sheetId];
  if (!sheet || sheet.hidden) throw new Error("Invalid budget sheet");
  const row = Math.max(2, ...Object.keys(sheet.cellData).map(Number)) + 1;
  sheet.cellData[row] = { 0: { v: fields.chapter.trim() }, 1: { v: fields.item.trim() }, 2: { v: fields.type.trim() }, 3: { v: fields.subcategory.trim() }, 4: { v: 0 }, 6: { v: 0 }, 8: { v: "Pendiente" }, 9: { v: 0 }, 10: { v: "" }, 25: { v: `new:${id}` } };
  sheet.rowCount = Math.max(sheet.rowCount, row + 2);
  return next;
}

export function removeBudgetRow(workbook: UniverWorkbook, sheetId: string, row: number) {
  const next = structuredClone(workbook);
  const cells = next.sheets[sheetId]?.cellData[row];
  if (!cells) throw new Error("Budget row not found");
  // Retain the identity as an explicit deletion, without shifting other rows.
  next.sheets[sheetId].cellData[row] = cells[25] ? { 25: cells[25] } : {};
  return next;
}

export function budgetEditorRows(workbook: UniverWorkbook) {
  return workbook.sheetOrder.flatMap((sheetId) => {
    const sheet = workbook.sheets[sheetId];
    if (!sheet || sheet.hidden || !/objective|objetivo/i.test(String(sheet.cellData[2]?.[4]?.v || ""))) return [];
    return Object.entries(sheet.cellData).filter(([row, cells]) => Number(row) >= 3 && cells[0]?.v && cells[1]?.v && !/^TOTAL/i.test(String(cells[0].v)))
      .map(([row, cells]) => ({ sheetId, sheetName: sheet.name, row: Number(row), cells }));
  });
}

export function fillZeroBudgetQuotes(workbook: UniverWorkbook, projectId?: string) {
  if (projectId !== "sample-house") return workbook;
  const updates = budgetEditorRows(workbook).flatMap(({ sheetId, row, cells }) => {
    const quote = cells[6];
    const value = quote?.v;
    if (quote?.f !== undefined || (value !== 0 && value !== null && value !== undefined && value !== "")) return [];
    const objective = Number(cells[4]?.v);
    return Number.isFinite(objective) && objective > 0 ? [{ sheetId, row, objective }] : [];
  });
  if (!updates.length) return workbook;
  const next = structuredClone(workbook);
  for (const { sheetId, row, objective } of updates) {
    const cells = next.sheets[sheetId].cellData[row];
    cells[6] = { ...cells[6], v: objective };
  }
  return next;
}

export function updateBudgetInput(workbook: UniverWorkbook, sheetId: string, row: number, column: number, input: string) {
  if (!(budgetInputColumns as readonly number[]).includes(column)) throw new Error("This column is calculated");
  const original = workbook.sheets[sheetId]?.cellData[row]?.[column];
  if (original?.f) throw new Error("Edit this formula in the advanced editor");
  const numeric = [4, 6, 9, 26].includes(column);
  const value = numeric ? Number(input) : input;
  if (numeric && (!input.trim() || !Number.isFinite(value) || Number(value) < 0)) throw new Error("Enter a non-negative amount");
  const next = structuredClone(workbook);
  (next.sheets[sheetId].cellData[row] ||= {})[column] = { ...original, v: value };
  return next;
}
