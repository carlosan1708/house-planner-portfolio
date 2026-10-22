import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { exportGoogleDraft, importGoogleDraft } from "@/lib/google-workbook";
import { updateBudgetInput } from "@/lib/budget-editor";
import type { UniverWorkbook } from "@/lib/workbook";

const snapshot = (): UniverWorkbook => ({ id: "draft", name: "Budget", sheetOrder: ["budget"], sheets: { budget: { id: "budget", name: "Presupuesto", rowCount: 100, columnCount: 26, cellData: { 2: { 0: { v: "Chapter" }, 1: { v: "Item" }, 4: { v: "Objective" } }, 3: { 0: { v: "Structure" }, 1: { v: "Concrete" }, 4: { v: 100, s: { n: "#,##0" } }, 6: { v: 50 }, 9: { v: 20 }, 25: { v: "stable-id" } }, 4: { 0: { v: "Structure" }, 1: { v: "Steel" }, 4: { f: "E4*2", v: 200 } } }, rowData: {}, columnData: {}, mergeData: [] } } });

async function googleEdit(edit: (sheet: ExcelJS.Worksheet) => void) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await exportGoogleDraft(snapshot()) as never);
  edit(workbook.getWorksheet("Presupuesto")!);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("Google Sheets draft exchange", () => {
  it("imports numeric changes and formula results while retaining styles and identities", async () => {
    const bytes = await googleEdit((sheet) => { sheet.getCell("J4").value = 75; sheet.getCell("E5").value = { formula: "E4*3", result: 300 }; });
    const result = await importGoogleDraft(snapshot(), bytes);
    expect(result.sheets.budget.cellData[3][9].v).toBe(75);
    expect(result.sheets.budget.cellData[4][4]).toMatchObject({ f: "E4*3", v: 300 });
    expect(result.sheets.budget.cellData[3][4].s).toEqual({ n: "#,##0" });
    expect(result.sheets.budget.cellData[3][25].v).toBe("stable-id");
  });
  it("rejects moved rows rather than reattaching expenses", async () => {
    const bytes = await googleEdit((sheet) => { sheet.getCell("AA4").value = "budget:4"; });
    await expect(importGoogleDraft(snapshot(), bytes)).rejects.toThrow("Rows moved");
  });
  it("rejects partial sorts that leave hidden row markers in place", async () => {
    const bytes = await googleEdit((sheet) => { sheet.getCell("B4").value = "Steel"; });
    await expect(importGoogleDraft(snapshot(), bytes)).rejects.toThrow("item names");
  });
  it("rejects deleted tabs and edited budget IDs", async () => {
    const bytes = await googleEdit((sheet) => { sheet.getCell("Z4").value = "different-id"; });
    await expect(importGoogleDraft(snapshot(), bytes)).rejects.toThrow("identities");
  });
  it("imports cleared cells without retaining their old formula", async () => {
    const bytes = await googleEdit((sheet) => { sheet.getCell("E5").value = null; });
    expect((await importGoogleDraft(snapshot(), bytes)).sheets.budget.cellData[4][4]).toEqual({ v: null });
  });
});

describe("focused budget editing", () => {
  it("preserves formulas, other rows and original snapshots", () => {
    const base = snapshot();
    const result = updateBudgetInput(base, "budget", 3, 9, "250.50");
    expect(result.sheets.budget.cellData[3][9].v).toBe(250.5);
    expect(base.sheets.budget.cellData[3][9].v).toBe(20);
    expect(result.sheets.budget.cellData[4][4].f).toBe("E4*2");
  });
  it("rejects formula overwrites and invalid amounts", () => {
    expect(() => updateBudgetInput(snapshot(), "budget", 4, 4, "10")).toThrow("formula");
    for (const value of ["", "-1", "Infinity", "text"]) expect(() => updateBudgetInput(snapshot(), "budget", 3, 9, value)).toThrow("amount");
  });
  it("round-trips outside-objective classification without overwriting the Google row identity", async () => {
    const base = updateBudgetInput(snapshot(), "budget", 3, 26, "1");
    const bytes = await exportGoogleDraft(base);
    const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes as never);
    expect(book.getWorksheet("Presupuesto")!.getCell("AA4").value).toBe(1);
    expect(book.getWorksheet("Presupuesto")!.getCell("AB4").value).toBe("budget:3");
    expect((await importGoogleDraft(base, bytes)).sheets.budget.cellData[3][26].v).toBe(1);
  });

});
