import { randomUUID } from "node:crypto";
import { BUDGET_SHEET, loadWorkbook, readBudgetLines, scanUnsupportedFeatures, setWorkbookCurrency, workbookCurrency, writeWorkbook } from "./workbook";
import type { ProjectCurrency } from "./currency";

function moveTotalAfterItems(workbook: Awaited<ReturnType<typeof loadWorkbook>>) {
  const sheet = workbook.getWorksheet(BUDGET_SHEET)!;
  let lastItem = 3, total = 0;
  for (let row = 4; row <= sheet.rowCount; row++) {
    if (/^TOTAL/i.test(sheet.getCell(row, 1).text)) { if (!total) total = row; }
    else if (sheet.getCell(row, 1).text && sheet.getCell(row, 2).text) lastItem = row;
  }
  if (!total || total > lastItem) return;
  let destination = lastItem + 2;
  while (sheet.getRow(destination).hasValues) destination++;
  const old = sheet.getRow(total), next = sheet.getRow(destination);
  next.values = old.values; next.height = old.height;
  old.eachCell({ includeEmpty: true }, (cell, column) => { next.getCell(column).style = structuredClone(cell.style); });
  old.values = [];
  for (const tab of workbook.worksheets) tab.eachRow(row => row.eachCell(cell => {
    if (!cell.formula) return;
    const qualified = new RegExp(`((?:'Presupuesto'|Presupuesto)!\\$?[A-Z]{1,3}\\$?)${total}(?!\\d)`, "gi");
    const local = new RegExp(`(?<![A-Za-z0-9_!])(\\$?[A-Z]{1,3}\\$?)${total}(?!\\d)`, "g");
    const formula = cell.formula.split(/("(?:[^"]|"")*")/g).map((part, index) => {
      if (index % 2) return part;
      const translated = part.replace(qualified, (_match, prefix: string) => `${prefix}${destination}`);
      return tab.name === BUDGET_SHEET ? translated.replace(local, (_match, prefix: string) => `${prefix}${destination}`) : translated;
    }).join("");
    if (formula !== cell.formula) cell.value = { formula, result: cell.result };
  }));
}

export async function needsGoogleRowIdentities(bytes: Buffer) {
  const workbook = await loadWorkbook(bytes);
  const sheet = workbook.getWorksheet(BUDGET_SHEET);
  if (!sheet) return false;
  const seen = new Set<string>();
  for (let row = 4; row <= sheet.rowCount; row++) {
    if (!sheet.getCell(row, 1).text || !sheet.getCell(row, 2).text || /^TOTAL/i.test(sheet.getCell(row, 1).text)) continue;
    const id = sheet.getCell(row, 26).text;
    if (!id || seen.has(id)) return true;
    seen.add(id);
  }
  return false;
}

// IDs travel with the row when Google Sheets or Excel sorts/inserts/deletes it.
// The hidden mapping tab alone cannot preserve identity after a physical move.
export async function consolidatedWorkbook(bytes: Buffer, external = false, baseline?: Buffer, currency?: ProjectCurrency) {
  const unsupported = await scanUnsupportedFeatures(bytes);
  if (unsupported.length) throw new Error(`Contenido no compatible con sincronización: ${unsupported.join(", ")}`);
  const workbook = await loadWorkbook(bytes);
  if (currency || baseline) setWorkbookCurrency(workbook, currency ?? workbookCurrency(await loadWorkbook(baseline!)));
  const sheet = workbook.getWorksheet(BUDGET_SHEET);
  if (!sheet || !/objetivo|objective/i.test(sheet.getCell("E3").text)) throw new Error("Conserva la pestaña Presupuesto y sus encabezados en la fila 3.");
  if (sheet.rowCount > 5000) throw new Error("El presupuesto supera el límite de 5000 filas.");
  const seen = new Set<string>();
  if (external) {
    const groups = new Map<string, number[]>();
    for (let row = 4; row <= sheet.rowCount; row++) {
      if (!sheet.getCell(row, 1).text || !sheet.getCell(row, 2).text || /^TOTAL/i.test(sheet.getCell(row, 1).text)) continue;
      const marker = sheet.getCell(row, 26).text;
      if (marker) groups.set(marker, [...(groups.get(marker) || []), row]);
    }
    const duplicates = [...groups].filter(([, rows]) => rows.length > 1);
    const previous = duplicates.length && baseline ? readBudgetLines(await loadWorkbook(baseline)) : [];
    const label = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase();
    for (const [marker, rows] of duplicates) {
      const original = previous.filter(line => `new:${line.id}` === marker);
      let matches = original.length === 1 ? rows.filter(row => label(sheet.getCell(row, 1).text) === label(original[0].chapter) && label(sheet.getCell(row, 2).text) === label(original[0].item)) : [];
      // Renaming a whole category must not detach the existing item's links.
      if (!matches.length && original.length === 1) matches = rows.filter(row => label(sheet.getCell(row, 2).text) === label(original[0].item));
      if (matches.length !== 1) throw new Error(`Hay partidas con el mismo identificador en las filas ${rows.join(", ")}. Pon un nombre distinto a la partida copiada y conserva el nombre de la original para mantener sus vínculos.`);
      for (const row of rows) if (row !== matches[0]) sheet.getCell(row, 26).value = `new:${randomUUID()}`;
    }
    for (let row = 4; row <= sheet.rowCount; row++) {
      if (!sheet.getCell(row, 1).text || !sheet.getCell(row, 2).text || /^TOTAL/i.test(sheet.getCell(row, 1).text)) continue;
      const marker = sheet.getCell(row, 26).text;
      if (marker && !/^new:[\w-]+$/.test(marker)) throw new Error("No modifiques los identificadores de la columna Z.");
      const id = marker || `new:${randomUUID()}`;
      if (seen.has(id)) throw new Error("Hay partidas con el mismo identificador. Al copiar una fila, deja vacía su columna Z.");
      seen.add(id); sheet.getCell(row, 26).value = id;
      for (const column of [5, 7, 10]) {
        const cell = sheet.getCell(row, column);
        const value = cell.formula ? cell.result : cell.value;
        if (value !== null && value !== undefined && value !== "" && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw new Error(`Corrige el importe o fórmula en ${cell.address} antes de sincronizar.`);
      }
    }
  }
  if (external) moveTotalAfterItems(workbook);
  const lines = readBudgetLines(workbook);
  for (const line of lines) sheet.getCell(line.row, 26).value = `new:${line.id}`;
  sheet.getColumn(26).hidden = true;
  return writeWorkbook(workbook);
}
