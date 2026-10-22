import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildDemoWorkbook } from "../scripts/prepare-demo-workbooks.mjs";
import { loadWorkbook, readBudgetLines, BUDGET_SHEET, MAPPING_SHEET } from "@/lib/workbook";

const fixture = (suffix = "") => new URL(`../public/demo/House_Planner_Demo${suffix}.xlsx`, import.meta.url);
async function rawWorkbook(bytes: Buffer) { const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes as never); return book; }
type FormattedSheet = ExcelJS.Worksheet & { conditionalFormattings: Array<{ ref: string; rules: Array<ExcelJS.ConditionalFormattingRule & { formulae?: string[] }> }> };
const formatting = (sheet: ExcelJS.Worksheet) => (sheet as FormattedSheet).conditionalFormattings;
const formulaStructure = (value: string) => value.replace(/"((?:[^"]|"")*)"/g, '"localized"');
const copy = {
  en: { chapter: "Structure", item: "Concrete and reinforcement", type: "Construction", subcategory: "Foundation", vendor: "Demo Builder", secondVendor: "Demo Finishes", excess: "Excess over objective", status: "Completed", inProgress: "In progress", pending: "Pending", objective: "Objective", legend: "✓ 1 completed", alert: "OVER OBJECTIVE", title: "House Planner - Demo budget", dropdown: '"Pending,In progress,Completed"' },
  es: { chapter: "Estructura", item: "Concreto y refuerzo", type: "Construcción", subcategory: "Cimentación", vendor: "Constructora Demo", secondVendor: "Acabados Demo", excess: "Exceso sobre objetivo", status: "Completada", inProgress: "En progreso", pending: "Pendiente", objective: "Objetivo", legend: "✓ 1 completada", alert: "SOBRE OBJETIVO", title: "House Planner - Presupuesto de demostración", dropdown: '"Pendiente,En progreso,Completada"' },
};

describe("reproducible localized public demo workbooks", () => {
  it("keeps the legacy alias identical to the English-first download", async () => {
    expect(await readFile(fixture())).toEqual(await readFile(fixture("_en")));
  });

  it.each(["en", "es"] as const)("rebuilds the committed %s fixture byte-for-byte without modifying the alias", async (language) => {
    const original = await readFile(fixture());
    const built = await buildDemoWorkbook(language);
    expect(built).toEqual(await buildDemoWorkbook(language));
    expect(built).toEqual(await readFile(fixture(`_${language}`)));
    expect(await readFile(fixture())).toEqual(original);
  });

  it.each(["en", "es"] as const)("preserves raw %s localization before application normalization", async (language) => {
    const workbook = await rawWorkbook(await readFile(fixture(`_${language}`)));
    const sheet = workbook.getWorksheet(BUDGET_SHEET)!;
    const localized = copy[language];
    expect(workbook.worksheets.map((item) => item.name)).toEqual([BUDGET_SHEET, MAPPING_SHEET]);
    expect(sheet.getCell("A1").value).toBe(localized.title);
    expect(sheet.getCell("E3").value).toBe(localized.objective);
    expect(sheet.getCell("F3").value).toBe(localized.excess);
    expect([1, 2, 3, 4].map((column) => sheet.getCell(4, column).value)).toEqual([localized.chapter, localized.item, localized.type, localized.subcategory]);
    expect(sheet.getCell("K4").value).toBe(localized.vendor);
    expect(sheet.getCell("K5").value).toBe(localized.secondVendor);
    expect([4, 5, 6].map((row) => sheet.getCell(row, 9).value)).toEqual([localized.status, localized.inProgress, localized.pending]);
    expect(sheet.getCell("I2").value).toMatchObject({ result: localized.legend });
    expect(sheet.getCell("M5").value).toMatchObject({ result: localized.alert });
    expect(sheet.getCell("I4").dataValidation.formulae).toEqual([localized.dropdown]);
    expect(sheet.getCell("I4").dataValidation.errorTitle).toBe(language === "en" ? "Invalid status" : "Estado no válido");
    expect(formatting(sheet)[0].rules[0].formulae?.[0]).toContain(`"${localized.status}"`);
    const visibleStrings: string[] = [];
    sheet.eachRow((row) => row.eachCell((cell) => { if (typeof cell.value === "string") visibleStrings.push(cell.value); else if (cell.value && typeof cell.value === "object" && "result" in cell.value && typeof cell.value.result === "string") visibleStrings.push(cell.value.result); }));
    expect(visibleStrings.join(" ")).not.toMatch(language === "en" ? /Exceso|completada|pendiente|Construcción|Cimentación|Constructora|Acabados|Presupuesto de demostración/ : /Chapter|Objective|Construction|Concrete|Completed|In progress|Pending|Source \/ evidence|Demo budget/);
  });

  it.each(["en", "es"] as const)("keeps %s UUIDs and localized hidden mappings coherent and parser-compatible", async (language) => {
    const original = await rawWorkbook(await readFile(fixture()));
    const workbook = await rawWorkbook(await readFile(fixture(`_${language}`)));
    const mapping = workbook.getWorksheet(MAPPING_SHEET)!;
    const originalMapping = original.getWorksheet(MAPPING_SHEET)!;
    const budget = workbook.getWorksheet(BUDGET_SHEET)!;
    expect(mapping.state).toBe("veryHidden");
    expect(mapping.getRow(1).values).toEqual(originalMapping.getRow(1).values);
    expect(mapping.getRow(2).values).toEqual(originalMapping.getRow(2).values);
    for (let row = 3; row <= mapping.rowCount; row++) {
      expect(mapping.getCell(row, 1).value).toBe(originalMapping.getCell(row, 1).value);
      expect(mapping.getCell(row, 2).value).toBe(BUDGET_SHEET);
      const sourceRow = Number(mapping.getCell(row, 3).value);
      const chapter = budget.getCell(sourceRow, 1).value;
      const item = budget.getCell(sourceRow, 2).value;
      expect(mapping.getCell(row, 4).value).toBe(chapter);
      expect(mapping.getCell(row, 5).value).toBe(item);
      expect(mapping.getCell(row, 6).value).toBe(`${chapter}\u241f${item}\u241f${sourceRow}`);
    }
    const numeric = (book: ExcelJS.Workbook) => readBudgetLines(book).map(({ id, row, objective, excess, quote, paid, status, outsideObjective }) => ({ id, row, objective, excess, quote, paid, status, outsideObjective }));
    expect(numeric(workbook)).toEqual(numeric(original));
    expect(numeric(workbook).map((line) => line.status)).toEqual(["Completada", "En progreso", "Pendiente"]);
    const imported = await loadWorkbook(await readFile(fixture(`_${language}`)));
    expect(numeric(imported)).toEqual(numeric(original));
  });

  it.each(["en", "es"] as const)("keeps %s typed numbers, formula calculations, styles and native formatting unchanged", async (language) => {
    const original = await rawWorkbook(await readFile(fixture()));
    const workbook = await rawWorkbook(await readFile(fixture(`_${language}`)));
    const source = original.getWorksheet(BUDGET_SHEET)!;
    const target = workbook.getWorksheet(BUDGET_SHEET)!;
    expect(target.model.merges).toEqual(source.model.merges);
    expect(target.views).toEqual(source.views);
    expect(target.columns.map((column) => ({ width: column.width, hidden: column.hidden }))).toEqual(source.columns.map((column) => ({ width: column.width, hidden: column.hidden })));
    source.eachRow((row) => row.eachCell((cell) => {
      const actual = target.getCell(cell.address);
      expect(actual.style).toEqual(cell.style);
      const value = cell.value;
      if (typeof value === "number" || typeof value === "boolean" || value instanceof Date) expect(actual.value).toEqual(value);
      if (value && typeof value === "object" && "formula" in value) {
        const localized = actual.value as ExcelJS.CellFormulaValue;
        expect(formulaStructure(localized.formula!)).toBe(formulaStructure(value.formula!));
        if (typeof value.result !== "string") expect(localized.result).toBe(value.result);
      }
    }));
    expect(formatting(target).map((group) => ({ ref: group.ref, rules: group.rules.map((rule) => ({ ...rule, formulae: rule.formulae?.map(formulaStructure) })) }))).toEqual(formatting(source).map((group) => ({ ref: group.ref, rules: group.rules.map((rule) => ({ ...rule, formulae: rule.formulae?.map(formulaStructure) })) })));
  });

  it.each(["", "_en", "_es"])("uses coherent synthetic USD amounts in the %s download", async (suffix) => {
    const workbook = await rawWorkbook(await readFile(fixture(suffix)));
    const sheet = workbook.getWorksheet(BUDGET_SHEET)!;
    const amounts = { E4: 30000, G4: 29000, H4: 300, J4: 6200, E5: 15000, G5: 15500, H5: 300, E6: 10000, G6: 0 };
    for (const [address, amount] of Object.entries(amounts)) expect(sheet.getCell(address).value).toBe(amount);
    for (const [address, amount] of Object.entries({ L4: 6200, F5: 500, L5: 15500, E8: 55000, F8: 500, L8: 21700 })) {
      expect(sheet.getCell(address).value).toMatchObject({ result: amount });
    }
    for (const row of [4, 5, 6]) for (const column of [5, 6, 7, 8, 10, 12]) {
      expect(sheet.getCell(row, column).numFmt).toBe('"USD "#,##0');
    }
    for (const address of ["E8", "F8", "L8"]) expect(sheet.getCell(address).numFmt).toBe('"USD "#,##0');
    for (const address of ["A4", "I4", "R4", "A8", "M8"]) expect(sheet.getCell(address).numFmt).toBeUndefined();
    const imported = await loadWorkbook(await readFile(fixture(suffix)));
    expect(readBudgetLines(imported).map(({ objective, quote, paid }) => ({ objective, quote, paid }))).toEqual([
      { objective: 30000, quote: 29000, paid: 6200 },
      { objective: 15000, quote: 15500, paid: 0 },
      { objective: 10000, quote: 0, paid: 0 },
    ]);
  });

  it.each([
    ["Demo_Quote.txt", "USD 7,665"], ["Cotizacion_demo.txt", "USD 7.665"],
    ["Demo_Invoice.txt", "USD 840"], ["Factura_demo.txt", "USD 840"],
  ])("uses USD in the fictional %s document", async (name, amount) => {
    const text = await readFile(new URL(`../public/demo/${name}`, import.meta.url), "utf8");
    expect(text).toContain(amount);
    expect(text).not.toMatch(/CRC|₡/);
  });

  it("rejects unsupported locales instead of preparing an unlocalized file", async () => {
    await expect(buildDemoWorkbook("fr")).rejects.toThrow("Unsupported demo workbook language");
  });
});
