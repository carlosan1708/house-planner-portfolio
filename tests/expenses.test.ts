import { describe, expect, it } from "vitest";
import { aggregateExpenses, deriveExpensesFromBudgetLines } from "@/lib/expenses";

describe("expense ledger", () => {
  it("derives every expense amount from paid price in the workbook", () => {
    const lines = [
      { id: "line-1", chapter: "Structure", item: "Concrete", type: "Work", subcategory: "Foundation", paid: 1000, supplier: "Builder" },
      { id: "line-2", chapter: "Finishes", item: "Tile", type: "Material", subcategory: "Interior", paid: 0, supplier: "Tiles Co" },
    ];
    const expenses = deriveExpensesFromBudgetLines(lines);
    expect(expenses).toHaveLength(1);
    expect(expenses[0]).toMatchObject({ id: "line-1", amount: 1000, description: "Concrete", source: "workbook", attachments: [] });
    expect(aggregateExpenses(expenses).total).toBe(1000);
  });

  it("links multiple images and PDFs without changing the Excel amount and ignores removed links", () => {
    const lines = [{ id: "line-1", chapter: "Structure", item: "Concrete", type: "Work", subcategory: "Foundation", paid: 1000, supplier: "Builder" }];
    const expenses = deriveExpensesFromBudgetLines(lines, [
      { id: "link-1", budgetLineId: "line-1", documentId: "doc-1", fileName: "receipt.jpg", contentType: "image/jpeg", createdAt: "2026-08-01T12:00:00.000Z", isImage: true },
      { id: "link-2", budgetLineId: "line-1", documentId: "doc-2", fileName: "invoice.pdf", contentType: "application/pdf", createdAt: "2026-08-02T12:00:00.000Z", isImage: false },
      { id: "link-3", budgetLineId: "line-1", documentId: "doc-3", fileName: "old.jpg", contentType: "image/jpeg", createdAt: "2026-07-01T12:00:00.000Z", isImage: true, deletedAt: "2026-08-03T12:00:00.000Z" },
    ]);
    expect(expenses[0].amount).toBe(1000);
    expect(expenses[0].attachments.map((item) => item.documentId)).toEqual(["doc-2", "doc-1"]);
    expect(expenses[0].receiptDocumentId).toBe("doc-2");
    expect(expenses[0].paymentDate).toBe("2026-08-02");
  });
});
