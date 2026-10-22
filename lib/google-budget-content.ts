import { budgetLinesEqual, loadWorkbook, readBudgetLines, writeWorkbook } from "./workbook";

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

// Rebase value-only local edits onto Google's latest formatting when Google
// still contains the baseline values. Structural/offline layout edits require
// explicit conflict resolution, never a guessed merge.
export async function reconcileBudgetMetadata(base: Buffer, local: Buffer, remote: Buffer): Promise<Buffer | null> {
  if (!await sameBudgetContent(base, remote)) return null;
  // If Google only advanced its revision, structural local edits are safe too.
  if (await sameWorkbookLayoutAndContent(base, remote)) return local;
  const [a, b, target] = await Promise.all([loadWorkbook(base), loadWorkbook(local), loadWorkbook(remote)]);
  if (a.worksheets.map(s => s.name).join("\0") !== b.worksheets.map(s => s.name).join("\0")) return null;
  for (const original of a.worksheets) {
    const edited = b.getWorksheet(original.name)!;
    const destination = target.getWorksheet(original.name)!;
    if (original.rowCount !== edited.rowCount || original.columnCount !== edited.columnCount || canonical(original.model.merges) !== canonical(edited.model.merges)) return null;
    if (canonical(original.columns.map(c => ({ width: c.width, hidden: c.hidden, style: c.style }))) !== canonical(edited.columns.map(c => ({ width: c.width, hidden: c.hidden, style: c.style })))) return null;
    for (let row = 1; row <= original.rowCount; row++) {
      if (original.getRow(row).height !== edited.getRow(row).height || original.getRow(row).hidden !== edited.getRow(row).hidden) return null;
      for (let column = 1; column <= original.columnCount; column++) {
        const before = original.getCell(row, column), after = edited.getCell(row, column);
        if (canonical(before.style) !== canonical(after.style) || canonical(before.dataValidation) !== canonical(after.dataValidation) || canonical(before.note) !== canonical(after.note)) return null;
        const value = (cell: typeof before) => cell.formula ? { formula: cell.formula } : cell.value;
        if (canonical(value(before)) !== canonical(value(after))) destination.getCell(row, column).value = after.value;
      }
    }
  }
  return writeWorkbook(target);
}

export async function sameWorkbookLayoutAndContent(left: Buffer, right: Buffer) {
  const models = async (bytes: Buffer) => {
    const workbook = await loadWorkbook(bytes);
    return JSON.parse(JSON.stringify(workbook.worksheets.map(sheet => sheet.model), (key, value) => key === "result" ? undefined : value));
  };
  return canonical(await models(left)) === canonical(await models(right));
}

// Drive revisions also advance for recalculation and conversion metadata.
// Drafts edit cells on the latest workbook, so formatting remains preserved
// without invalidating a draft whose underlying values/formulas are unchanged.
export async function sameBudgetContent(left: Buffer, right: Buffer) {
  const [a, b] = await Promise.all([loadWorkbook(left), loadWorkbook(right)]);
  if (!budgetLinesEqual(readBudgetLines(a), readBudgetLines(b))) return false;
  const content = (workbook: typeof a) => workbook.worksheets.map((sheet) => {
    const cells: Array<[number, number, unknown]> = [];
    sheet.eachRow((row, rowNumber) => row.eachCell((cell, column) => {
      if (cell.value === null || cell.value === undefined || cell.value === "") return;
      const value = cell.formula ? { formula: cell.formula } : typeof cell.value === "object" && "richText" in cell.value ? cell.text : cell.value;
      cells.push([rowNumber, column, value]);
    }));
    return { name: sheet.name, cells };
  });
  return JSON.stringify(content(a)) === JSON.stringify(content(b));
}
