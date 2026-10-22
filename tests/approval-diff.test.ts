import { describe, expect, it } from "vitest";
import { approvalChangeDetails } from "@/lib/approval-diff";
import type { UniverChange, UniverWorkbook } from "@/lib/workbook";

const base: UniverWorkbook = {
  id: "workbook",
  name: "House Planner",
  sheetOrder: ["budget"],
  sheets: {
    budget: {
      id: "budget",
      name: "Presupuesto",
      rowCount: 100,
      columnCount: 18,
      cellData: { 8: { 1: { v: "Mano de obra de techo" }, 2: { v: "Mano de obra general" }, 4: { v: 1000, s: { n: "₡#,##0" } }, 7: { v: -1000, f: "G9-E9" } } },
      mergeData: [], rowData: {}, columnData: {},
    },
  },
};

describe("approval change details", () => {
  it("adds row context and separates edits from recalculated formula results", () => {
    const changes: UniverChange[] = [
      { sheet: "Presupuesto", row: 9, column: 5, before: { v: 1000, s: { n: "₡#,##0" } }, after: { v: 1200, s: { n: "₡#,##0" } } },
      { sheet: "Presupuesto", row: 9, column: 8, before: { v: -1000, f: "G9-E9" }, after: { v: -1200, f: "G9-E9" } },
    ];
    const details = approvalChangeDetails(changes, base);
    expect(details[0]).toMatchObject({ rowLabel: "Mano de obra de techo", groupLabel: "Mano de obra general", calculated: false, before: { value: 1000 }, after: { value: 1200 } });
    expect(details[0].after?.numberFormat).toBe("₡#,##0");
    expect(details[1]).toMatchObject({ calculated: true, before: { value: -1000 }, after: { value: -1200 } });
  });
});
