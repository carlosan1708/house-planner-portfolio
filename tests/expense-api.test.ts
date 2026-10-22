import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ budgetPayload: vi.fn() }));
vi.mock("@/lib/workbook-store", () => ({ budgetPayload: mocks.budgetPayload }));
vi.mock("@/lib/firebase-admin", () => ({ firestore: {} }));
vi.mock("@/lib/project", () => ({ DOCUMENTS: "documents" }));

import { paidBudgetLines, validateExpenseBudgetLine } from "@/lib/expense-api";

describe("expense budget-line reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.budgetPayload.mockResolvedValue({ lines: [
      { id: "paid", item: "Arquitectura", chapter: "Profesionales", supplier: "Arquitecto", paid: 900000 },
      { id: "unpaid", item: "Pendiente", chapter: "Otros", supplier: "", paid: 0 },
    ] });
  });

  it("reads the stored official workbook without starting another Google sync", async () => {
    expect(await paidBudgetLines("project-1")).toEqual([{ id: "paid", label: "Arquitectura", chapter: "Profesionales", supplier: "Arquitecto", paid: 900000 }]);
    expect(mocks.budgetPayload).toHaveBeenCalledWith("project-1", { skipGoogleSync: true });
  });

  it("retains raw historical paid and source versions instead of using ledger-inclusive actuals", async () => {
    mocks.budgetPayload.mockResolvedValue({ planVersion: 3, actualsRevision: 7, lines: [
      { id: "permit", item: "Permiso municipal", chapter: "Permisos", supplier: "Municipalidad", paid: 1030600, workbookPaid: 515300 },
    ] });
    expect(await validateExpenseBudgetLine("project-1", "permit")).toEqual({ id: "permit", label: "Permiso municipal", chapter: "Permisos", supplier: "Municipalidad", paid: 1030600, workbookPaid: 515300, planVersion: 3, actualsRevision: 7 });
    expect(mocks.budgetPayload).toHaveBeenCalledWith("project-1", { skipGoogleSync: true });
    expect(await validateExpenseBudgetLine("project-1", "missing")).toBeNull();
  });
});
