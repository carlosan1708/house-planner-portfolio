import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { consolidatedWorkbook } from "@/lib/consolidated-workbook";
import { exportGoogleDraft, importGoogleDraft } from "@/lib/google-workbook";
import { addPaymentWorkbookProjection } from "@/lib/payment-workbook";
import { createStarterWorkbook, generateCategoryWorkbook, loadWorkbook, readBudgetLines, setWorkbookCurrency, toUniver, workbookCurrency, writeWorkbook } from "@/lib/workbook";

describe("workbook denomination", () => {
  it("round-trips USD amounts, identity, formulas and every monetary view without conversion", async () => {
    const workbook = createStarterWorkbook("USD"), budget = workbook.getWorksheet("Presupuesto")!;
    budget.getCell("E4").value = 1234.56; budget.getCell("G4").value = 1300.75; budget.getCell("J4").value = 25.5;
    budget.getCell("C4").value = "Construction";
    const summary = workbook.addWorksheet("Resumen"); summary.getCell("A4").value = "Objetivo";
    summary.getRow(10).values = ["Tipo", "Objetivo", "Exceso", "% objetivo"]; summary.getCell("A11").value = "Construction";
    const purchases = workbook.addWorksheet("Compras");
    purchases.getRow(3).values = ["Área", "Partida", "Cantidad", "Objetivo unit.", "Exceso unit.", "Objetivo total", "Exceso sobre objetivo"];
    purchases.getRow(4).values = ["Construction", "Nueva partida", 2];
    const id = readBudgetLines(workbook)[0].id;
    const restored = await loadWorkbook(await writeWorkbook(workbook));
    expect(workbookCurrency(restored)).toBe("USD");
    expect(restored.getWorksheet("_HousePlanner")?.state).toBe("veryHidden");
    expect(readBudgetLines(restored)[0]).toMatchObject({ id, objective: 1234.56, quote: 1300.75, paid: 25.5 });
    for (const address of ["E4", "F4", "G4", "H4", "J4", "L4", "E5", "F5"]) expect(restored.getWorksheet("Presupuesto")!.getCell(address).numFmt).toBe("$#,##0.00");
    for (const address of ["B4", "B5", "B6", "B7", "E6", "E7", "B11", "C11"]) expect(restored.getWorksheet("Resumen")!.getCell(address).numFmt).toBe("$#,##0.00");
    expect(restored.getWorksheet("Resumen")!.getCell("E4").numFmt).toBe("0.0%");
    for (const column of [4, 5, 6, 7, 8, 9, 11]) expect(restored.getWorksheet("Compras")!.getCell(4, column).numFmt).toBe("$#,##0.00");
    expect(restored.getWorksheet("Presupuesto")!.getCell("I4").numFmt).toBeUndefined();
    expect(restored.getWorksheet("Presupuesto")!.getCell("F4").formula).toContain("MAX(J4,G4)-E4");
  });

  it("defaults an unmarked legacy workbook to CRC and retains its numeric amounts", async () => {
    const workbook = new ExcelJS.Workbook(), budget = workbook.addWorksheet("Presupuesto");
    budget.getRow(3).values = ["Capítulo", "Partida", "Tipo", "Subcategoría", "Objetivo"];
    budget.getRow(4).values = ["Legacy", "Item", "", "", 500];
    expect(workbookCurrency(workbook)).toBe("CRC");
    const restored = await loadWorkbook(await writeWorkbook(workbook));
    expect(workbookCurrency(restored)).toBe("CRC");
    expect(restored.getWorksheet("Presupuesto")!.getCell("E4").value).toBe(500);
    expect(restored.getWorksheet("Presupuesto")!.getCell("E4").numFmt).toBe("₡#,##0");
  });

  it("keeps USD category and Google draft exports consistent, including newly generated totals", async () => {
    const workbook = createStarterWorkbook("USD"), lines = readBudgetLines(workbook);
    const generated = generateCategoryWorkbook(toUniver(workbook), lines, { key: "chapter", label: "General" }).workbook;
    expect(generated.currency).toBe("USD");
    const sheet = generated.sheets[generated.sheetOrder[0]];
    expect(sheet.cellData[3][4].s?.n).toBe("$#,##0.00");
    expect(sheet.cellData[4][4].s?.n).toBe("$#,##0.00");
    const bytes = await exportGoogleDraft(generated);
    const native = await loadWorkbook(bytes);
    expect(native.getWorksheet(sheet.name)!.getCell("E5").numFmt).toBe("$#,##0.00");
    expect((await importGoogleDraft(generated, bytes)).currency).toBe("USD");
  });

  it("uses the server denomination instead of an uploaded or Google-supplied marker", async () => {
    const uploaded = createStarterWorkbook("CRC"); uploaded.getWorksheet("Presupuesto")!.getCell("E4").value = 987.65;
    const canonical = await loadWorkbook(await consolidatedWorkbook(await writeWorkbook(uploaded), true, undefined, "USD"));
    expect(workbookCurrency(canonical)).toBe("USD");
    expect(readBudgetLines(canonical)[0].objective).toBe(987.65);
    expect(canonical.getWorksheet("Presupuesto")!.getCell("E4").numFmt).toBe("$#,##0.00");
    setWorkbookCurrency(canonical, "CRC");
    expect(readBudgetLines(canonical)[0].objective).toBe(987.65);
    expect(workbookCurrency(await loadWorkbook(await writeWorkbook(canonical, "USD")))).toBe("USD");
  });

  it.each([1, 2])("exports USD payment summaries for model v%s without mixing legacy CRC records", async (paymentsModelVersion) => {
    const workbook = createStarterWorkbook("USD"), budget = workbook.getWorksheet("Presupuesto")!;
    budget.getCell("E4").value = 100; budget.getCell("G4").value = 90; budget.getCell("J4").value = 20;
    const line = readBudgetLines(workbook)[0];
    const projected = addPaymentWorkbookProjection(workbook, [{ id: "usd-payment", budgetLineId: line.id, amount: 15.25, currency: "USD", accountingMode: "ledger" }], { paymentsModelVersion, currency: "USD" });
    const downloaded = await loadWorkbook(await writeWorkbook(workbook));
    expect(readBudgetLines(downloaded)[0].paid).toBe(paymentsModelVersion === 2 ? 15.25 : 35.25);
    expect(downloaded.getWorksheet(projected.summarySheetName)!.getCell("D4").numFmt).toBe("$#,##0.00");
    expect(downloaded.getWorksheet(projected.paymentsSheetName)!.getCell("E4").numFmt).toBe("$#,##0.00");
    expect(workbookCurrency(downloaded)).toBe("USD");
    expect(() => addPaymentWorkbookProjection(createStarterWorkbook("USD"), [{ id: "legacy-crc", amount: 1 }], { paymentsModelVersion })).toThrow("currency");
  });
});
