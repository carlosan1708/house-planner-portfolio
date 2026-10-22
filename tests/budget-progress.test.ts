import { describe, expect, it } from "vitest";
import { BUDGET_PROGRESS_APPEARANCE, normalizeBudgetProgressStatus } from "@/lib/budget-progress";

describe("budget progress row formatting", () => {
  it("normalizes Spanish and English status values", () => {
    expect(normalizeBudgetProgressStatus("Completada")).toBe("Completada");
    expect(normalizeBudgetProgressStatus("completed")).toBe("Completada");
    expect(normalizeBudgetProgressStatus("in progress")).toBe("En progreso");
    expect(normalizeBudgetProgressStatus("")).toBe("Pendiente");
  });

  it("uses a distinct full-row and status-cell color for every status", () => {
    expect(new Set(Object.values(BUDGET_PROGRESS_APPEARANCE).map((appearance) => appearance.row)).size).toBe(3);
    expect(BUDGET_PROGRESS_APPEARANCE.Completada).toMatchObject({ row: "#EAF4E2", cell: "#C6E0B4" });
    expect(BUDGET_PROGRESS_APPEARANCE["En progreso"]).toMatchObject({ row: "#FFF4CC", cell: "#FFE699" });
  });
});
