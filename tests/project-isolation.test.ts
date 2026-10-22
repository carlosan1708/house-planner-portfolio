import { describe, expect, it } from "vitest";
import { LEGACY_PROJECT_ID, membershipId, personalProjectId, projectConfigDoc, projectScopedId, projectStoragePrefix } from "@/lib/project";
import { createStarterWorkbook, loadWorkbook, readBudgetLines, writeWorkbook } from "@/lib/workbook";

describe("project isolation", () => {
  it("uses disjoint identifiers and storage paths for personal workspaces", () => {
    const first = personalProjectId("qa-user-one");
    const second = personalProjectId("qa-user-two");
    expect(first).not.toBe(second);
    expect(membershipId(first, "qa-user-one")).not.toBe(membershipId(second, "qa-user-two"));
    expect(projectConfigDoc(first)).toBe(first);
    expect(projectStoragePrefix(first)).toBe(`house-planner/projects/${first}`);
    expect(projectScopedId(first, "budget-line")).toBe(`${first}__budget-line`);
  });

  it("preserves every legacy production location for the existing shared project", () => {
    expect(projectConfigDoc(LEGACY_PROJECT_ID)).toBe("production");
    expect(projectStoragePrefix(LEGACY_PROJECT_ID)).toBe("house-planner/production");
    expect(projectScopedId(LEGACY_PROJECT_ID, "budget-line")).toBe("budget-line");
  });

  it("creates a fictional blank starter budget without legacy project content", async () => {
    const workbook = await loadWorkbook(await writeWorkbook(createStarterWorkbook()));
    const serialized = workbook.worksheets.flatMap((sheet) => [sheet.name, ...sheet.getSheetValues().flatMap((row) => Array.isArray(row) ? row.map(String) : [])]).join(" ");
    expect(serialized).not.toMatch(/Sample/i);
    expect(readBudgetLines(workbook)).toMatchObject([{ chapter: "General", item: "Nueva partida", objective: 0, excess: 0, paid: 0 }]);
  });
});
