import { describe, expect, it } from "vitest";
import { findExpenseInvoiceFolder, findExpensePurchaseFolder } from "@/lib/folders";

describe("expense invoice folder", () => {
  it("finds only the top-level Factura folder without case sensitivity", () => {
    const folders = [
      { id: "nested", name: "Factura", parentId: "other" },
      { id: "receipts", name: "  FACTURA ", parentId: null },
    ];
    expect(findExpenseInvoiceFolder(folders)?.id).toBe("receipts");
  });

  it("does not match a differently named top-level folder", () => {
    expect(findExpenseInvoiceFolder([{ id: "other", name: "Receipts", parentId: null }])).toBeUndefined();
  });
});

describe("expense purchase folder", () => {
  it("finds only the top-level Compras folder without case sensitivity", () => {
    const folders = [
      { id: "nested", name: "Compras", parentId: "other" },
      { id: "purchases", name: " compras ", parentId: null },
    ];
    expect(findExpensePurchaseFolder(folders)?.id).toBe("purchases");
  });
});
