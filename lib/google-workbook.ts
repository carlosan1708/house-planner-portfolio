import ExcelJS from "exceljs";
import type { UniverWorkbook, UniverCell, UniverSheet } from "./workbook";

const identityColumn = (sheet: UniverSheet) => Object.values(sheet.cellData).some((cells) => cells[26]) ? 28 : 27;

// A row marker travels with each exported row. Structural changes must never
// silently attach an amount (or its receipt) to a different budget item.
export async function exportGoogleDraft(snapshot: UniverWorkbook) {
  const workbook = new ExcelJS.Workbook();
  for (const id of snapshot.sheetOrder) {
    const source = snapshot.sheets[id];
    const ID_COLUMN = identityColumn(source);
    const sheet = workbook.addWorksheet(source.name, { state: source.hidden ? "hidden" : "visible" });
    for (const [row, cells] of Object.entries(source.cellData)) {
      for (const [column, cell] of Object.entries(cells)) {
        if (Number(column) >= ID_COLUMN - 1) throw new Error("This workbook uses columns reserved for Google editing identities");
        const target = sheet.getCell(Number(row) + 1, Number(column) + 1);
        target.value = cell.f ? { formula: cell.f.replace(/^=/, ""), result: cell.v ?? undefined } as ExcelJS.CellFormulaValue : cell.v ?? null;
        if (typeof cell.s?.n === "string") target.numFmt = cell.s.n;
        target.font = { bold: Boolean(cell.s?.bl), italic: Boolean(cell.s?.it) };
      }
      sheet.getCell(Number(row) + 1, ID_COLUMN).value = `${id}:${row}`;
    }
    sheet.getColumn(ID_COLUMN).hidden = true;
    for (const [column, dimension] of Object.entries(source.columnData)) { if (dimension.w) sheet.getColumn(Number(column) + 1).width = dimension.w / 7; }
    for (const merge of source.mergeData) sheet.mergeCells(merge.startRow + 1, merge.startColumn + 1, merge.endRow + 1, merge.endColumn + 1);
    sheet.views = [{ state: "frozen", ySplit: 3 }];
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function importGoogleDraft(base: UniverWorkbook, bytes: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as never);
  if (workbook.worksheets.length !== base.sheetOrder.length) throw new Error("Keep the same worksheet tabs when editing in Google Sheets");
  const next = structuredClone(base);
  for (const id of base.sheetOrder) {
    const source = base.sheets[id];
    const ID_COLUMN = identityColumn(source);
    const sheet = workbook.getWorksheet(source.name);
    if (!sheet) throw new Error("A worksheet was renamed or removed. Restore its original name in Google Sheets.");
    if (sheet.rowCount > Math.max(source.rowCount, ...Object.keys(source.cellData).map(Number)) + 1 || sheet.columnCount > ID_COLUMN) throw new Error("Adding rows or columns is not supported in this Google editing draft");
    const knownRows = new Set(Object.keys(source.cellData));
    sheet.eachRow((row, rowNumber) => {
      if (!knownRows.has(String(rowNumber - 1)) && row.hasValues) throw new Error("Adding rows is not supported in this Google editing draft");
    });
    for (const [row, cells] of Object.entries(source.cellData)) {
      if (sheet.getCell(Number(row) + 1, ID_COLUMN).value !== `${id}:${row}`) throw new Error("Rows moved or their identities changed. Restore the original row order before importing.");
      for (const column of Number(row) < 3 ? Object.keys(cells).map(Number) : [0, 1]) {
        const expected = cells[column];
        if (!expected?.f && String(sheet.getCell(Number(row) + 1, column + 1).value ?? "") !== String(expected?.v ?? "")) throw new Error("Keep headers and item names unchanged when editing in Google Sheets");
      }
      // Hidden mapping sheets and identity columns cannot be edited externally.
      if (source.hidden) continue;
      const columns = new Set([...Object.keys(cells).map(Number), ...Array.from({ length: ID_COLUMN - 1 }, (_, index) => index)]);
      for (const column of columns) {
        if (column === 25) {
          if (String(sheet.getCell(Number(row) + 1, column + 1).value ?? "") !== String(cells[column]?.v ?? "")) throw new Error("Budget item identities changed");
          continue;
        }
        const raw = sheet.getCell(Number(row) + 1, column + 1).value;
        const cell: UniverCell = { ...cells[column] };
        delete cell.f; delete cell.v;
        if (raw && typeof raw === "object" && "formula" in raw) { cell.f = raw.formula; cell.v = raw.result as UniverCell["v"]; }
        else if (raw && typeof raw === "object" && "sharedFormula" in raw) { cell.f = sheet.getCell(Number(row) + 1, column + 1).formula; cell.v = raw.result as UniverCell["v"]; }
        else if (raw === null || ["number", "string", "boolean"].includes(typeof raw)) cell.v = raw as UniverCell["v"];
        else throw new Error("This draft contains a cell value that cannot be imported safely");
        if (cell.v !== null && cell.v !== undefined && typeof cell.v === "object") throw new Error("Fix formula errors in Google Sheets before importing");
        if (Number(row) >= 3 && [4, 6, 9].includes(column) && /objective|objetivo/i.test(String(source.cellData[2]?.[4]?.v || "")) && cell.v !== null && cell.v !== undefined && (typeof cell.v !== "number" || !Number.isFinite(cell.v))) throw new Error("Budget amounts must be numeric. Fix the values or formulas in Google Sheets.");
        if (cells[column] || raw !== null) next.sheets[id].cellData[Number(row)][column] = cell;
      }
    }
  }
  return next;
}
