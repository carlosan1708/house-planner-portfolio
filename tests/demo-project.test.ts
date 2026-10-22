import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { DEMO_BUDGET_LINES } from "@/lib/demo-project";
import { demoProjectNotes, localizeDemoNote } from "@/lib/demo-notes";

describe("demo summary and scripted data", () => {
  it.each(["en", "es"] as const)("matches the existing USD %s download without changing its sample budget", async (language) => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(`public/demo/House_Planner_Demo_${language}.xlsx`);
    const sheet = workbook.getWorksheet("Presupuesto")!;
    expect(DEMO_BUDGET_LINES).toHaveLength(3);
    for (const line of DEMO_BUDGET_LINES) {
      expect(sheet.getCell(line.row, 5).value).toBe(line.objective);
      expect(Number(sheet.getCell(line.row, 7).value || 0)).toBe(line.quote);
      expect(Number(sheet.getCell(line.row, 10).value || 0)).toBe(line.paid);
    }
    expect(DEMO_BUDGET_LINES.reduce((sum, line) => sum + line.objective, 0)).toBe(55000);
    expect(DEMO_BUDGET_LINES.find((line) => line.id === "demo-kitchen")?.quote).toBe(0);
  });
  it("translates untouched note copy and preserves user text and AI choices", () => {
    const note = demoProjectNotes("en")[0];
    const localized = localizeDemoNote({ ...note, aiEnabled: false }, "es");
    expect(localized.title).toContain("paleta confirmada");
    expect(localized.content).toContain("USD 10.000");
    expect(localized.content).not.toMatch(/CRC|9[,.]500/);
    expect(localized.aiEnabled).toBe(false);
    const edited = { ...note, title: "My own title", content: "Keep my supplier notes" };
    expect(localizeDemoNote(edited, "es")).toEqual(edited);
  });
});
