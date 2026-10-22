import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { applyUniverChanges, applyUniverSnapshot, availableBudgetRows, budgetLineExcess, budgetLinesEqual, diffGeneratedUniverWorkbooks, diffUniverWorkbooks, ensureBudgetColumnOrder, ensureBudgetProgressIndicators, ensureLineMapping, ensureObjectiveOnlyBudget, generateCategoryWorkbook, loadWorkbook, mapGeneratedChanges, readBudgetLines, scanUnsupportedFeatures, toUniver, writeWorkbook } from "@/lib/workbook";

async function fixture() {
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Presupuesto", { views: [{ state: "frozen", xSplit: 2, ySplit: 3 }] });
  sheet.getRow(3).values = ["Capítulo", "Partida", "Tipo", "Subcategoría", "Objetivo", "Máximo", "Cotización", "Diferencia", "Obligatorio", "Referencia", "Base", "Fuente", "Fecha", "Estado", "Precio pagado", "Proveedor", "Costo usado", "Alerta"];
  sheet.getRow(4).values = ["Structure", "Concrete", "Work", "Foundation", 1000, 1200, 1100, { formula: "E4-G4" }, true, { text: "Quote", hyperlink: "https://example.com" }, "", "", "", { formula: "IF(O4>0,\"Comprado\",\"Pendiente\")" }, 0, "", { formula: "IF(O4>0,O4,G4)" }, { formula: "IF(Q4>F4,\"SOBRE MÁXIMO\",\"OK\")" }];
  sheet.getCell("A3").font = { bold: true, color: { argb: "FFFFFFFF" } }; sheet.getCell("A3").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111827" } }; sheet.getCell("E4").numFmt = "₡#,##0"; sheet.getCell("C4").dataValidation = { type: "list", formulae: ['"Work,Material"'] }; sheet.mergeCells("A1:R1"); sheet.getCell("A1").value = "Fixture"; sheet.getColumn(2).width = 30; sheet.getRow(4).height = 24;
  return workbook;
}

describe("ExcelJS and Univer conversion", () => {
  it("preserves the current budget contract while applying editor values", async () => { const original = await fixture(); ensureLineMapping(original); original.getWorksheet("Presupuesto")!.getCell("O4").value = 450; const snapshot = toUniver(original); const budgetId = snapshot.sheetOrder.find((id) => snapshot.sheets[id].name === "Presupuesto")!; snapshot.sheets[budgetId].cellData[3][4].v = 1050; applyUniverSnapshot(original, snapshot); const restored = await loadWorkbook(await writeWorkbook(original)); const sheet = restored.getWorksheet("Presupuesto")!; expect(sheet.getCell("E4").value).toBe(1050); expect(sheet.getCell("J4").value).toBe(450); expect(sheet.getCell("I4").value).toBe("Pendiente"); expect(sheet.getCell("I4").dataValidation.type).toBe("list"); expect(sheet.getCell("A3").font.bold).toBe(true); expect(sheet.getCell("E4").numFmt).toBe("₡#,##0"); expect(sheet.getCell("C4").dataValidation.type).toBe("list"); expect((sheet.getCell("Q4").value as ExcelJS.CellHyperlinkValue).hyperlink).toBe("https://example.com"); expect(sheet.model.merges).toContain("A1:R1"); expect(restored.getWorksheet("_HousePlanner")?.state).toBe("veryHidden"); });
  it("moves progress and execution columns forward while preserving legacy data and formulas", async () => {
    const workbook = await fixture();
    const summary = workbook.addWorksheet("Resumen");
    summary.getCell("A1").value = { formula: "Presupuesto!O4+Presupuesto!Q4", result: 0 };
    summary.getCell("A2").value = { formula: "SUM(Presupuesto!$O$4:$O$20)", result: 0 };
    expect(ensureBudgetColumnOrder(workbook)).toBe(true);
    const sheet = workbook.getWorksheet("Presupuesto")!;
    expect(sheet.getRow(3).values).toEqual([undefined, "Capítulo", "Partida", "Tipo", "Subcategoría", "Objetivo", "Exceso sobre objetivo", "Cotización vigente", "Diferencia vs objetivo", "Estado", "Precio pagado", "Proveedor / nota", "Costo usado", "Alerta", "Fuente / evidencia", "Base de precio", "Fecha revisión", "Referencia reglamento", "Obligatorio"]);
    expect((sheet.getCell("Q4").value as ExcelJS.CellHyperlinkValue).hyperlink).toBe("https://example.com");
    expect((sheet.getCell("I4").value as ExcelJS.CellFormulaValue).formula).toContain("J4");
    expect((summary.getCell("A1").value as ExcelJS.CellFormulaValue).formula).toBe("Presupuesto!J4+Presupuesto!L4");
    expect((summary.getCell("A2").value as ExcelJS.CellFormulaValue).formula).toBe("SUM(Presupuesto!$J$4:$J$20)");
    expect(ensureBudgetColumnOrder(workbook)).toBe(false);
  });
  it("detects advanced XLSX features before editing", async () => { const bytes = await writeWorkbook(await fixture()); expect(await scanUnsupportedFeatures(bytes)).toEqual([]); });
  it("opens workbooks whose sheet views are null", async () => {
    const workbook = await fixture();
    const hidden = workbook.addWorksheet("Hidden", { state: "veryHidden" });
    Object.defineProperty(hidden, "views", { value: null, writable: true, configurable: true });
    expect(() => toUniver(workbook)).not.toThrow();
  });
  it("uses cached formula results for money while status remains independent of amounts", async () => {
    const workbook = await fixture();
    const sheet = workbook.getWorksheet("Presupuesto")!;
    sheet.getCell("O4").value = { formula: "200+250", result: 450 };
    sheet.getCell("N4").value = { formula: 'IF(O4>0,"Comprado","Pendiente")', result: "Pendiente" };
    const lines = readBudgetLines(workbook);
    expect(lines[0]).toMatchObject({ paid: 450, status: "Pendiente" });
    expect(budgetLinesEqual(lines, structuredClone(lines))).toBe(true);
    expect(budgetLinesEqual(lines, [{ ...lines[0], paid: 0 }])).toBe(false);
  });
  it("includes styled empty amount cells so newly entered money keeps the Excel font size", async () => {
    const workbook = await fixture();
    const cell = workbook.getWorksheet("Presupuesto")!.getCell("G4");
    cell.value = null;
    cell.font = { name: "Calibri", size: 9 };
    cell.numFmt = "₡#,##0";
    const snapshot = toUniver(workbook);
    const budgetId = snapshot.sheetOrder.find((id) => snapshot.sheets[id].name === "Presupuesto")!;
    expect(snapshot.sheets[budgetId].cellData[3][6]).toMatchObject({ v: null, s: { ff: "Calibri", fs: 9, n: "₡#,##0" } });
  });
  it("calculates excess per line from the control cost", async () => {
    const workbook = await fixture();
    const sheet = workbook.getWorksheet("Presupuesto")!;
    sheet.getCell("G4").value = { richText: [{ text: "1" }, { text: "\u00a0300" }] };
    expect(readBudgetLines(workbook)[0].excess).toBe(300);
    expect(budgetLineExcess({ objective: 100, quote: 140, paid: 0 })).toBe(40);
    expect(budgetLineExcess({ objective: 100, quote: 140, paid: 80 })).toBe(40);
  });
  it("removes maximum from budget and summary while keeping line-by-line excess", async () => {
    const workbook = await fixture();
    const summary = workbook.addWorksheet("Resumen");
    summary.getCell("A4").value = "Tope absoluto"; summary.getCell("A5").value = "Presupuesto objetivo"; summary.getCell("A6").value = "Presupuesto máximo";
    summary.getRow(10).values = ["Tipo", "Objetivo", "Máximo", "% objetivo"];
    summary.getRow(11).values = ["Work", 1000, 1200, 1];
    workbook.getWorksheet("Presupuesto")!.getCell("O4").value = 1450;
    ensureObjectiveOnlyBudget(workbook);
    const sheet = workbook.getWorksheet("Presupuesto")!;
    expect(sheet.getCell("F3").value).toBe("Exceso sobre objetivo");
    expect((sheet.getCell("F4").value as ExcelJS.CellFormulaValue).result).toBe(450);
    expect(summary.getCell("A6").value).toBe("Exceso sobre objetivo");
    expect(summary.getCell("C10").value).toBe("Exceso sobre objetivo");
    expect(JSON.stringify(summary.model)).not.toMatch(/Máximo|máximo|tope/i);
  });
  it("replaces purchase maximums with objective excess", async () => {
    const workbook = await fixture();
    const purchases = workbook.addWorksheet("Compras");
    purchases.getRow(3).values = ["Área", "Artículo / partida", "Cantidad", "Objetivo unit.", "Máximo unit.", "Objetivo total", "Máximo total", "Cotización", "Precio pagado", "Estado", "Costo control", "Alerta"];
    purchases.getRow(4).values = ["Work", "Concrete", 2, 500, 700, 1000, 1400, 1300, 0, "Cotizado", 1300, "SOBRE OBJETIVO"];
    ensureObjectiveOnlyBudget(workbook);
    expect(purchases.getCell("E3").value).toBe("Exceso unit.");
    expect(purchases.getCell("G3").value).toBe("Exceso sobre objetivo");
    expect((purchases.getCell("G4").value as ExcelJS.CellFormulaValue).result).toBe(100);
    expect((purchases.getCell("L4").value as ExcelJS.CellFormulaValue).result).toBe("SOBRE OBJETIVO");
    expect(JSON.stringify(purchases.model)).not.toMatch(/Máximo|máximo/i);
  });
  it("keeps paid price as a direct workbook value", async () => {
    const workbook = await fixture();
    ensureBudgetColumnOrder(workbook);
    workbook.getWorksheet("Presupuesto")!.getCell("J4").value = 250;
    const restored = await loadWorkbook(await writeWorkbook(workbook));
    expect(readBudgetLines(restored)[0].paid).toBe(250);
  });
  it("uses only the explicit status column for row indicators and valid-line counts", async () => {
    const workbook = await fixture();
    const sheet = workbook.getWorksheet("Presupuesto")!;
    ensureBudgetColumnOrder(workbook);
    sheet.getCell("I4").value = "Pendiente";
    sheet.getCell("J4").value = 900;
    sheet.getRow(5).values = ["Finishes", "Tile", "Material", "Interior", 600, 750, null, null, "En progreso"];
    sheet.getRow(6).values = ["Garden", "Plants", "Material", "Exterior", 400, 500, 800, null, "Completada"];
    sheet.getRow(7).values = ["TOTAL", "Not a budget line", "", "", "", "", "", "", "Completada"];
    ensureBudgetProgressIndicators(workbook);
    expect(sheet.getCell("I4").value).toBe("Pendiente");
    expect(sheet.getCell("I5").value).toBe("En progreso");
    expect(sheet.getCell("I6").value).toBe("Completada");
    expect(sheet.getCell("I4").dataValidation).toMatchObject({ type: "list", allowBlank: false, formulae: ['"Pendiente,En progreso,Completada"'] });
    expect(sheet.getCell("I2").value).toMatchObject({ result: "✓ 1 completada" });
    expect(sheet.getCell("K2").value).toMatchObject({ result: "◐ 1 en progreso" });
    expect(sheet.getCell("M2").value).toMatchObject({ result: "○ 1 pendiente" });
    expect((sheet.getCell("I2").value as ExcelJS.CellFormulaValue).formula).toContain("COUNTIFS");
    expect(sheet.getCell("A4").fill).toMatchObject({ fgColor: { argb: "FFF7F7F7" } });
    expect(sheet.getCell("A5").fill).toMatchObject({ fgColor: { argb: "FFFFF4CC" } });
    expect(sheet.getCell("A6").fill).toMatchObject({ fgColor: { argb: "FFEAF4E2" } });
    const formats = (sheet as ExcelJS.Worksheet & { conditionalFormattings: ExcelJS.ConditionalFormattingOptions[] }).conditionalFormattings;
    expect(formats.some((format) => format.ref === "I4:I6" && format.rules.length === 3)).toBe(true);
    expect(formats.some((format) => format.ref === "A4:R6" && format.rules.length === 2)).toBe(true);
  });
  it("promotes only edited cells so later actual-spend changes are retained", async () => {
    const baseWorkbook = await fixture();
    const base = toUniver(baseWorkbook);
    const draft = structuredClone(base);
    const budgetId = draft.sheetOrder.find((id) => draft.sheets[id].name === "Presupuesto")!;
    draft.sheets[budgetId].cellData[3][4].v = 1400;
    baseWorkbook.getWorksheet("Presupuesto")!.getCell("J4").value = 775;
    applyUniverChanges(baseWorkbook, diffUniverWorkbooks(base, draft));
    expect(baseWorkbook.getWorksheet("Presupuesto")!.getCell("E4").value).toBe(1400);
    expect(baseWorkbook.getWorksheet("Presupuesto")!.getCell("J4").value).toBe(775);
  });
  it("generates one compact sheet per category and maps edits to source rows", async () => {
    const workbook = await fixture();
    const sheet = workbook.getWorksheet("Presupuesto")!;
    sheet.getRow(5).values = ["Finishes", "Tile", "Material", "Interior", 600, 750, 625, "", true, "", "", "", "", "", 120, "Tile Co"];
    const lines = readBudgetLines(workbook);
    const source = toUniver(workbook);
    const one = generateCategoryWorkbook(source, lines, { key: "chapter", label: "Finishes" });
    expect(one.workbook.sheetOrder).toHaveLength(1);
    expect(one.workbook.sheets[one.workbook.sheetOrder[0]].name).toBe("Finishes");
    expect(one.rowMaps.Finishes[4]).toBe(5);
    expect(one.workbook.sheets[one.workbook.sheetOrder[0]].columnData[25].hd).toBe(true);
    expect(one.workbook.sheets[one.workbook.sheetOrder[0]].cellData[1][12].v).toBe("○ 1 pendiente");
    expect(one.workbook.sheets[one.workbook.sheetOrder[0]].cellData[1][12].f).toContain("COUNTIFS($I$4:$I$4");
    expect(one.workbook.sheets[one.workbook.sheetOrder[0]].cellData[4][4].f).toBe('SUMIF(AA4:AA4,"<>1",E4:E4)');
    expect(one.workbook.sheets[one.workbook.sheetOrder[0]].cellData[4][9].f).toBe('SUMIF(AA4:AA4,"<>1",J4:J4)');
    const all = generateCategoryWorkbook(source, lines, { key: "chapter", all: true });
    expect(all.workbook.sheetOrder).toHaveLength(2);
    const generatedChange = { sheet: "Finishes", row: 4, column: 5, before: { v: 600 }, after: { v: 650 } };
    expect(mapGeneratedChanges([generatedChange], one.rowMaps)[0]).toMatchObject({ sheet: "Presupuesto", row: 5, column: 5 });
  });
  it("maps a category row deletion by line identity without deleting the following entry", async () => {
    const workbook = await fixture();
    const sheet = workbook.getWorksheet("Presupuesto")!;
    sheet.getRow(5).values = ["Structure", "Steel", "Material", "Foundation", 600, 750, 625];
    sheet.getRow(6).values = ["Structure", "Blocks", "Material", "Walls", 400, 500, 425];
    const lines = readBudgetLines(workbook);
    const generated = generateCategoryWorkbook(toUniver(workbook), lines, { key: "chapter", label: "Structure" });
    const draft = structuredClone(generated.workbook);
    const draftSheet = draft.sheets[draft.sheetOrder[0]];
    draftSheet.cellData[4] = draftSheet.cellData[5];
    draftSheet.cellData[5] = draftSheet.cellData[6];
    delete draftSheet.cellData[6];
    const changes = diffGeneratedUniverWorkbooks(generated.workbook, draft, generated.rowMaps);
    expect(changes.some((change) => change.row === 5 && change.after === null)).toBe(true);
    expect(changes.some((change) => change.row === 6)).toBe(false);
    applyUniverChanges(workbook, changes);
    expect(readBudgetLines(workbook).map((line) => line.item)).toEqual(["Concrete", "Blocks"]);
  });
  it("does not clear generated budget rows when the editor omits hidden line IDs", async () => {
    const workbook = await fixture();
    const sheet = workbook.getWorksheet("Presupuesto")!;
    sheet.getRow(5).values = ["Structure", "Steel", "Material", "Foundation", 600, 750, 625];
    sheet.getRow(6).values = ["Structure", "Blocks", "Material", "Walls", 400, 500, 425];
    const generated = generateCategoryWorkbook(toUniver(workbook), readBudgetLines(workbook), { key: "chapter", label: "Structure" });
    const draft = structuredClone(generated.workbook);
    const draftSheet = draft.sheets[draft.sheetOrder[0]];
    for (const cells of Object.values(draftSheet.cellData)) delete cells[25];
    draftSheet.cellData[3][4].v = 1400;
    const changes = diffGeneratedUniverWorkbooks(generated.workbook, draft, generated.rowMaps);
    expect(changes).toEqual([{ sheet: "Presupuesto", row: 4, column: 5, before: expect.any(Object), after: expect.objectContaining({ v: 1400 }) }]);
    applyUniverChanges(workbook, changes);
    expect(readBudgetLines(workbook).map((line) => [line.item, line.objective])).toEqual([["Concrete", 1400], ["Steel", 600], ["Blocks", 400]]);
  });
  it("rejects a generated snapshot that would clear every budget row", async () => {
    const workbook = await fixture();
    const generated = generateCategoryWorkbook(toUniver(workbook), readBudgetLines(workbook), { key: "chapter", label: "Structure" });
    const draft = structuredClone(generated.workbook);
    const draftSheet = draft.sheets[draft.sheetOrder[0]];
    for (const [row, cells] of Object.entries(draftSheet.cellData)) {
      if (cells[25]) delete draftSheet.cellData[Number(row)];
    }
    expect(() => diffGeneratedUniverWorkbooks(generated.workbook, draft, generated.rowMaps)).toThrow(/row identities/i);
  });
  it("maps a newly inserted category line into an available official budget row", async () => {
    const workbook = await fixture();
    const sheet = workbook.getWorksheet("Presupuesto")!;
    sheet.getCell("A6").value = "TOTAL";
    const generated = generateCategoryWorkbook(toUniver(workbook), readBudgetLines(workbook), { key: "chapter", label: "Structure" });
    const draft = structuredClone(generated.workbook);
    const draftSheet = draft.sheets[draft.sheetOrder[0]];
    draftSheet.cellData[5] = draftSheet.cellData[4];
    draftSheet.cellData[4] = { 0: { v: "Structure" }, 1: { v: "Steel" }, 2: { v: "Material" }, 3: { v: "Frame" }, 4: { v: 600 }, 5: { v: 750 }, 6: { f: "E5", v: 600 } };
    const changes = diffGeneratedUniverWorkbooks(generated.workbook, draft, generated.rowMaps, availableBudgetRows(workbook));
    expect(changes).toContainEqual(expect.objectContaining({ row: 5, column: 2, after: { v: "Steel" } }));
    applyUniverChanges(workbook, changes);
    expect(readBudgetLines(workbook).map((line) => line.item)).toEqual(["Concrete", "Steel"]);
    expect((sheet.getCell("G5").value as ExcelJS.CellFormulaValue).formula).toBe("E5");
  });
  it("preserves a budget line ID when its label changes and removes stale mapping rows", async () => {
    const workbook = await fixture();
    ensureLineMapping(workbook);
    const mapping = workbook.getWorksheet("_HousePlanner")!;
    const originalId = String(mapping.getCell("A3").value);
    mapping.getRow(20).values = ["stale-id", "Presupuesto", 999, "Old", "Deleted", "Old␟Deleted␟999"];
    workbook.getWorksheet("Presupuesto")!.getCell("B4").value = "Concrete revised";
    ensureLineMapping(workbook);
    expect(String(mapping.getCell("A3").value)).toBe(originalId);
    expect(mapping.getCell("E3").value).toBe("Concrete revised");
    expect(mapping.getCell("A4").value).toBeNull();
  });
});
