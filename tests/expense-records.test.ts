import { describe, expect, it } from "vitest";
import { applyExpensePaymentsToBudget, summarizeOutsideObjectivePurchases, cleanExpenseAmount, cleanExpenseBudgetLineIds, cleanExpenseCurrency, cleanExpenseDate, cleanExpenseDocumentType, cleanExpenseNotes, cleanExpenseText, expenseLinksConflict } from "@/lib/expense-records";

describe("purchase and comprobante validation", () => {
  it("keeps informational amounts finite without affecting workbook calculations", () => {
    expect(cleanExpenseAmount(1250.239)).toBe(1250.24);
    expect(cleanExpenseAmount("395")).toBe(395);
    expect(cleanExpenseAmount("")).toBeNull();
    expect(cleanExpenseAmount(-1)).toBeNull();
    expect(cleanExpenseAmount(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("normalizes optional metadata and supported enums", () => {
    expect(cleanExpenseText("  Cocina   principal ", 50)).toBe("Cocina principal");
    expect(cleanExpenseNotes("  línea 1\nlínea 2  ")).toBe("línea 1\nlínea 2");
    expect(cleanExpenseDate("2026-09-27")).toBe("2026-09-27");
    expect(cleanExpenseDate("27/09/2026")).toBe("");
    expect(cleanExpenseCurrency("USD")).toBe("USD");
    expect(cleanExpenseCurrency("EUR")).toBe("CRC");
    expect(cleanExpenseDocumentType("payroll")).toBe("payroll");
    expect(cleanExpenseDocumentType("unsupported")).toBe("invoice");
  });

  it("normalizes several unique document budget lines with legacy fallback", () => {
    expect(cleanExpenseBudgetLineIds([" salary-line ", "materials-line", "salary-line"])).toEqual(["salary-line", "materials-line"]);
    expect(cleanExpenseBudgetLineIds([], "legacy-line")).toEqual(["legacy-line"]);
    expect(cleanExpenseBudgetLineIds(undefined, "legacy-line")).toEqual(["legacy-line"]);
    expect(cleanExpenseBudgetLineIds(null, "legacy-line")).toEqual([]);
  });

  it("requires a linked purchase line to be among the document lines", () => {
    expect(expenseLinksConflict("salary-line", ["salary-line", "materials-line"])).toBe(false);
    expect(expenseLinksConflict("salary-line", [])).toBe(false);
    expect(expenseLinksConflict(null, ["salary-line"])).toBe(false);
    expect(expenseLinksConflict("salary-line", ["materials-line"])).toBe(true);
  });
  it("separates outside-objective purchases by currency, excludes deleted/unassigned records and flags missing amounts", () => {
    expect(summarizeOutsideObjectivePurchases([
      { outsideObjective: true, amount: 150000, currency: "CRC" },
      { outsideObjective: true, amount: 25, currency: "USD" },
      { outsideObjective: true, amount: null },
      { outsideObjective: true, amount: 100, deletedAt: "date" },
      { amount: 999, budgetLineId: null },
      { outsideObjective: true, amount: 999, budgetLineId: "line" },
    ])).toEqual({ CRC: 150000, USD: 25, count: 3, unpricedCount: 1 });
  });

});

describe("budget payment currency boundaries", () => {
  const lines = [{ id: "line", paid: 100, quote: 200, objective: 200 }];
  it("keeps legacy missing-currency payments in CRC and preserves historical accounting", () => {
    expect(applyExpensePaymentsToBudget(lines, [{ budgetLineId: "line", amount: 25.5, accountingMode: "ledger" }])[0].paid).toBe(125.5);
    expect(applyExpensePaymentsToBudget(lines, [{ budgetLineId: "line", amount: 25.5 }])[0].paid).toBe(100);
  });
  it("adds USD cents once under both payment models without conversion", () => {
    const payments = [{ budgetLineId: "line", amount: 0.1, currency: "USD", accountingMode: "ledger" }, { budgetLineId: "line", amount: 0.2, currency: "USD", accountingMode: "ledger" }];
    expect(applyExpensePaymentsToBudget(lines, payments, { currency: "USD" })[0].paid).toBe(100.3);
    expect(applyExpensePaymentsToBudget(lines, payments, { currency: "USD", paymentsModelVersion: 2 })[0]).toMatchObject({ paid: 0.3, workbookPaid: 0, transactionPaid: 0.3 });
  });
  it("rejects mixed currencies instead of summing or relabeling legacy amounts", () => {
    expect(() => applyExpensePaymentsToBudget(lines, [{ budgetLineId: "line", amount: 1, currency: "USD", accountingMode: "ledger" }])).toThrow("currency");
    expect(() => applyExpensePaymentsToBudget(lines, [{ budgetLineId: "line", amount: 1, accountingMode: "ledger" }], { currency: "USD" })).toThrow("currency");
    expect(applyExpensePaymentsToBudget(lines, [{ budgetLineId: "line", amount: 1, currency: "USD", deletedAt: "deleted", accountingMode: "ledger" }])[0].paid).toBe(100);
  });
});
