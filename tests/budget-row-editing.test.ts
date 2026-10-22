import { describe, expect, it } from "vitest";
import { addBudgetRow, removeBudgetRow, updateBudgetInput } from "@/lib/budget-editor";
import { applyUniverChanges, createStarterWorkbook, diffGeneratedUniverWorkbooks, generateCategoryWorkbook, prepareBudgetRows, readBudgetLines, toUniver, writeWorkbook, loadWorkbook, ensureBudgetProgressIndicators } from "@/lib/workbook";

describe("basic budget row editing", () => {
  it("expands a full workbook and keeps old receipt identities through repeated publication", async () => {
    const workbook = createStarterWorkbook();
    const original = readBudgetLines(workbook)[0];
    for (let round = 0; round < 4; round++) {
      const base = generateCategoryWorkbook(toUniver(workbook), readBudgetLines(workbook), { key: "chapter", all: true });
      const next = addBudgetRow(base.workbook, base.workbook.sheetOrder[0], { chapter: "General", item: `Added ${round}`, type: "Material", subcategory: "Test" }, `id-${round}`);
      const changes = diffGeneratedUniverWorkbooks(base.workbook, next, base.rowMaps, prepareBudgetRows(workbook, base.workbook, next));
      applyUniverChanges(workbook, changes);
      const lines = readBudgetLines(await loadWorkbook(await writeWorkbook(workbook)));
      expect(lines.find((line) => line.item === `Added ${round}`)?.id).toBe(`id-${round}`);
      expect(lines.find((line) => line.id === original.id)?.row).toBe(original.row);
    }
    expect(readBudgetLines(workbook)).toHaveLength(5);
  });
  it("allows explicitly removing the last row without weakening missing-identity checks", () => {
    const workbook = createStarterWorkbook();
    const base = generateCategoryWorkbook(toUniver(workbook), readBudgetLines(workbook), { key: "chapter", all: true });
    const sheetId = base.workbook.sheetOrder[0];
    const row = Number(Object.keys(base.workbook.sheets[sheetId].cellData).find((row) => base.workbook.sheets[sheetId].cellData[Number(row)][25]));
    const next = removeBudgetRow(base.workbook, sheetId, row);
    applyUniverChanges(workbook, diffGeneratedUniverWorkbooks(base.workbook, next, base.rowMaps));
    expect(readBudgetLines(workbook)).toEqual([]);
    const empty = generateCategoryWorkbook(toUniver(workbook), [], { key: "chapter", all: true });
    expect(empty.workbook.sheetOrder).toHaveLength(1);
    const added = addBudgetRow(empty.workbook, empty.workbook.sheetOrder[0], { chapter: "General", item: "Restart", type: "", subcategory: "" }, "restart-id");
    applyUniverChanges(workbook, diffGeneratedUniverWorkbooks(empty.workbook, added, empty.rowMaps, prepareBudgetRows(workbook, empty.workbook, added)));
    expect(readBudgetLines(workbook)).toMatchObject([{ id: "restart-id", item: "Restart" }]);
  });
  it("persists an explicit outside-objective flag through categorized drafts and XLSX, preserves amounts and supports undo", async () => {
    const book = createStarterWorkbook();
    const sheet = book.getWorksheet("Presupuesto")!;
    sheet.getCell("E4").value = 100;
    sheet.getCell("J4").value = 150;
    const originalId = readBudgetLines(book)[0].id;
    for (const outside of [true, false]) {
      const base = generateCategoryWorkbook(toUniver(book), readBudgetLines(book), { key: "chapter", all: true });
      const id = base.workbook.sheetOrder[0];
      const row = Number(Object.keys(base.workbook.sheets[id].cellData).find((row) => base.workbook.sheets[id].cellData[Number(row)][25]));
      const draft = updateBudgetInput(base.workbook, id, row, 26, outside ? "1" : "0");
      applyUniverChanges(book, diffGeneratedUniverWorkbooks(base.workbook, draft, base.rowMaps));
      ensureBudgetProgressIndicators(book);
      const reloaded = await loadWorkbook(await writeWorkbook(book));
      expect(readBudgetLines(reloaded)[0]).toMatchObject({ id: originalId, outsideObjective: outside, objective: 100, paid: 150, excess: outside ? 0 : 50 });
      expect(Number(sheet.getCell("E5").result || 0)).toBe(outside ? 0 : 100);
      expect(Number(sheet.getCell("J5").result || 0)).toBe(outside ? 0 : 150);
      expect(Number(sheet.getCell("L5").result || 0)).toBe(outside ? 0 : 150);
    }
  });

});
