import { describe, expect, it } from "vitest";
import { fillZeroBudgetQuotes } from "@/lib/budget-editor";
import type { UniverCell, UniverWorkbook } from "@/lib/workbook";

function workbook(quotes: Array<UniverCell | undefined>, objectives: Array<UniverCell["v"]> = []): UniverWorkbook {
  const cellData: UniverWorkbook["sheets"][string]["cellData"] = { 2: { 4: { v: "Objetivo" } } };
  quotes.forEach((quote, index) => {
    cellData[index + 3] = {
      0: { v: "Pisos" }, 1: { v: `Partida ${index}` }, 4: { v: objectives[index] ?? 100 + index },
      5: { f: `MAX(0,G${index + 4}-E${index + 4})`, v: 0 }, 9: { v: 25 }, 10: { v: "Proveedor existente" },
      25: { v: `new:line-${index}` },
    };
    if (quote) cellData[index + 3][6] = quote;
  });
  cellData[quotes.length + 3] = { 0: { v: "TOTAL" }, 1: { v: "Total" }, 4: { v: 1000 }, 6: { v: 0 } };
  return { id: "budget", name: "Sample", sheetOrder: ["budget"], sheets: {
    budget: { id: "budget", name: "Pisos", rowCount: 30, columnCount: 26, cellData, mergeData: [], rowData: {}, columnData: {} },
  } };
}

describe("Sample quote defaults", () => {
  it("fills zero and empty quotes without changing existing quotes, formulas, styles or other cells", () => {
    const source = workbook([
      { v: 0, s: { n: "₡#,##0", bg: { rgb: "#fff" } }, p: { url: "https://example.com/evidence" } },
      { v: null }, undefined, { v: "" }, { v: 500 }, { v: 0, f: "E9*0" }, { v: "0" }, { v: false },
    ]);
    const original = structuredClone(source);
    const expected = structuredClone(source);
    for (let index = 0; index < 4; index++) expected.sheets.budget.cellData[index + 3][6] = { ...expected.sheets.budget.cellData[index + 3][6], v: 100 + index };
    const result = fillZeroBudgetQuotes(source, "sample-house");
    expect(result).toEqual(expected);
    expect(source).toEqual(original);
    expect(fillZeroBudgetQuotes(result, "sample-house")).toBe(result);
  });

  it("does not default another project, non-positive objectives, hidden sheets or rows outside a budget", () => {
    const source = workbook([{ v: 0 }, { v: 0 }, { v: 0 }, { v: 0 }], [0, -50, Infinity, "invalid"]);
    expect(fillZeroBudgetQuotes(source, "sample-house")).toBe(source);
    const eligible = workbook([{ v: 0 }]);
    expect(fillZeroBudgetQuotes(eligible, "another-project")).toBe(eligible);
    expect(fillZeroBudgetQuotes(eligible)).toBe(eligible);
    eligible.sheets.budget.hidden = true;
    expect(fillZeroBudgetQuotes(eligible, "sample-house")).toBe(eligible);
    eligible.sheets.budget.hidden = false;
    eligible.sheets.budget.cellData[2][4].v = "Notas";
    expect(fillZeroBudgetQuotes(eligible, "sample-house")).toBe(eligible);
  });

  it("uses the final objective and leaves a filled quote independent of later objective changes", () => {
    const source = workbook([{ v: 0 }], ["1000000"]);
    const result = fillZeroBudgetQuotes(source, "sample-house");
    expect(result.sheets.budget.cellData[3][6].v).toBe(1000000);
    result.sheets.budget.cellData[3][4].v = 2000000;
    expect(fillZeroBudgetQuotes(result, "sample-house")).toBe(result);
    expect(result.sheets.budget.cellData[3][6].v).toBe(1000000);
  });
});
