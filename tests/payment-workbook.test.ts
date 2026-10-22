import { describe, expect, it } from "vitest";
import { consolidatedWorkbook } from "@/lib/consolidated-workbook";
import { addPaymentWorkbookProjection, assertHistoricalPaidUnchangedForLedger, PAYMENT_PROJECTION_SHEET, restoreHistoricalWorkbookPaid, stripPaymentProjectionAgainstBaseline, stripUnifiedPaymentWorkbookProjection, type WorkbookPayment } from "@/lib/payment-workbook";
import { createStarterWorkbook, loadWorkbook, readBudgetLines, writeWorkbook } from "@/lib/workbook";

async function fixture() {
  const workbook = createStarterWorkbook();
  const sheet = workbook.getWorksheet("Presupuesto")!;
  sheet.getCell("E4").value = 1000;
  sheet.getCell("G4").value = 900;
  sheet.getCell("J4").value = 200;
  const bytes = await consolidatedWorkbook(await writeWorkbook(workbook));
  const baseline = await loadWorkbook(bytes);
  const line = readBudgetLines(baseline)[0];
  const payments: WorkbookPayment[] = [
    { id: "payment-1", budgetLineId: line.id, amount: 150, accountingMode: "ledger", paymentDate: "2026-10-15", payee: "Store", documentIds: ["shared-invoice"], paymentKind: "partial" },
    { id: "legacy-detail", budgetLineId: line.id, amount: 200, paymentDate: "2026-09-01", payee: "Store", documentId: "old-invoice" },
    { id: "unassigned", budgetLineId: null, amount: 70, accountingMode: "ledger", documentIds: ["shared-invoice"] },
    { id: "removed", budgetLineId: line.id, amount: 1000, accountingMode: "ledger", deletedAt: "deleted" },
  ];
  return { baseline, bytes, line, payments };
}

describe("Excel payment projection", () => {
  it("projects every real payment once in v2 and removes private details from a summary-only copy", async () => {
    const { baseline, payments } = await fixture();
    addPaymentWorkbookProjection(baseline, payments, { paymentsModelVersion: 2, paymentLedgerRevision: 7 });
    expect(readBudgetLines(baseline)[0].paid).toBe(350);
    expect(baseline.getWorksheet("Pagos")!.getCell("A4").text).toBe("legacy-detail");
    addPaymentWorkbookProjection(baseline, payments, { paymentsModelVersion: 2, paymentLedgerRevision: 7, includePaymentDetails: false });
    const text = JSON.stringify(baseline.getWorksheet("Pagos")!.getSheetValues());
    expect(text).not.toContain("Store"); expect(text).not.toContain("shared-invoice"); expect(text).not.toContain("legacy-detail");
    expect(readBudgetLines(baseline)[0].paid).toBe(350);
  });
  it("validates a v2 download without changing its official baseline and rejects tampered payment pages", async () => {
    const { baseline, payments, bytes } = await fixture();
    addPaymentWorkbookProjection(baseline, payments, { paymentsModelVersion: 2, paymentLedgerRevision: 7 });
    const downloaded = await loadWorkbook(await writeWorkbook(baseline));
    const rawSource = await loadWorkbook(bytes), before = readBudgetLines(rawSource)[0].paid;
    stripUnifiedPaymentWorkbookProjection(downloaded, rawSource, payments, 7);
    expect(readBudgetLines(rawSource)[0].paid).toBe(before); expect(rawSource.getWorksheet(PAYMENT_PROJECTION_SHEET)).toBeUndefined();
    expect(downloaded.getWorksheet("Pagos")).toBeUndefined(); expect(readBudgetLines(downloaded)[0].paid).toBe(350);
    const tampered = await loadWorkbook(await writeWorkbook(baseline)); tampered.getWorksheet("Pagos")!.getCell("E4").value = 999;
    expect(() => stripUnifiedPaymentWorkbookProjection(tampered, rawSource, payments, 7)).toThrow("consulta");
  });
  it.each([true, false])("accepts equivalent rich text in v2 payment sheets with details=%s", async (includePaymentDetails) => {
    const { baseline, payments, bytes, line } = await fixture();
    const projection = addPaymentWorkbookProjection(baseline, payments, { paymentsModelVersion: 2, paymentLedgerRevision: 7, includePaymentDetails });
    const projectedBytes = await writeWorkbook(baseline);
    const imported = await loadWorkbook(projectedBytes);
    for (const name of [projection.summarySheetName, projection.paymentsSheetName, PAYMENT_PROJECTION_SHEET]) {
      imported.getWorksheet(name)!.eachRow((row) => row.eachCell((cell) => {
        if (typeof cell.value !== "string") return;
        cell.value = { richText: [{ text: cell.value.slice(0, 1), font: { bold: true } }, { text: cell.value.slice(1) }] };
      }));
    }
    imported.getWorksheet("Presupuesto")!.getCell("B4").value = "Edited Google item";
    imported.getWorksheet("Presupuesto")!.getCell("G4").value = 950;
    const convertedBytes = await writeWorkbook(imported);
    const googleCopy = await loadWorkbook(convertedBytes), excelCopy = await loadWorkbook(convertedBytes);
    const originalPublished = await loadWorkbook(projectedBytes), originalSource = await loadWorkbook(bytes);
    stripPaymentProjectionAgainstBaseline(googleCopy, originalPublished);
    stripUnifiedPaymentWorkbookProjection(excelCopy, originalSource, payments, 7);
    for (const copy of [googleCopy, excelCopy]) {
      expect(copy.getWorksheet(PAYMENT_PROJECTION_SHEET)).toBeUndefined();
      expect(copy.getWorksheet(projection.paymentsSheetName)).toBeUndefined();
      expect(readBudgetLines(copy)[0]).toMatchObject({ id: line.id, item: "Edited Google item", quote: 950, paid: 350 });
    }
    expect(originalPublished.getWorksheet(PAYMENT_PROJECTION_SHEET)).toBeDefined();
    expect(readBudgetLines(originalSource)[0].paid).toBe(200);
  });
  it.each(["text", "revision", "amount", "id", "formula", "numeric-text"])("still rejects a changed %s in v2 payment sheets after rich-text conversion", async (change) => {
    const { baseline, payments, bytes } = await fixture();
    const projection = addPaymentWorkbookProjection(baseline, payments, { paymentsModelVersion: 2, paymentLedgerRevision: 7 });
    const projectedBytes = await writeWorkbook(baseline);
    const imported = await loadWorkbook(projectedBytes);
    imported.getWorksheet(PAYMENT_PROJECTION_SHEET)!.getCell("A1").value = { richText: [{ text: "payments-ledger-v2" }] };
    const ledger = imported.getWorksheet(projection.paymentsSheetName)!;
    if (change === "text") ledger.getCell("C4").value = { richText: [{ text: "Changed payee" }] };
    if (change === "revision") imported.getWorksheet(PAYMENT_PROJECTION_SHEET)!.getCell("E1").value = 8;
    if (change === "amount") ledger.getCell("E4").value = 201;
    if (change === "id") ledger.getCell("A4").value = { richText: [{ text: "changed-payment-id" }] };
    if (change === "formula") ledger.getCell("E4").value = { formula: "100+100", result: 200 };
    if (change === "numeric-text") ledger.getCell("E4").value = { richText: [{ text: "200" }] };
    const convertedBytes = await writeWorkbook(imported);
    const googleCopy = await loadWorkbook(convertedBytes), excelCopy = await loadWorkbook(convertedBytes);
    const originalPublished = await loadWorkbook(projectedBytes), originalSource = await loadWorkbook(bytes);
    expect(() => stripPaymentProjectionAgainstBaseline(googleCopy, originalPublished)).toThrow("historial de pagos de Google");
    expect(() => stripUnifiedPaymentWorkbookProjection(excelCopy, originalSource, payments, 7)).toThrow(change === "revision" ? "pagos cambiaron" : "consulta");
    expect(googleCopy.getWorksheet(PAYMENT_PROJECTION_SHEET)).toBeDefined();
    expect(excelCopy.getWorksheet(projection.paymentsSheetName)).toBeDefined();
    expect(readBudgetLines(originalSource)[0].paid).toBe(200);
  });
  it.each([null, "purchase-1"])("labels a full payment for purchase %s without inferring that the budget line is settled", async (purchaseId) => {
    const { baseline, line, payments } = await fixture();
    const classified = payments.map((payment) => payment.id === "payment-1" ? { ...payment, paymentKind: "settlement" as const, purchaseId }
      : payment.id === "legacy-detail" ? { ...payment, paymentKind: "settlement" as const, purchaseId: null } : payment);
    const result = addPaymentWorkbookProjection(baseline, classified);
    const exported = await loadWorkbook(await writeWorkbook(baseline));
    const ledger = exported.getWorksheet(result.paymentsSheetName)!;
    const rows = Array.from({ length: ledger.rowCount - 3 }, (_, index) => ledger.getRow(index + 4).values as unknown[]);
    const full = rows.filter((row) => row[1] === "payment-1");
    expect(full).toHaveLength(1);
    expect(full[0][10]).toBe(purchaseId ? "Pago de saldo" : "Pago total");
    expect(full[0][6]).toBe(150);
    expect(rows.find((row) => row[1] === "legacy-detail")).toEqual(expect.arrayContaining(["Pago total", "Detalle histórico (ya incluido)"]));
    expect(rows.find((row) => row[1] === "legacy-detail")?.[6]).toBe(0);
    expect(readBudgetLines(exported)[0]).toMatchObject({ id: line.id, paid: 350, quote: 900, objective: 1000 });
    expect(rows.reduce((sum, row) => sum + Number(row[6]), 0)).toBe(420);
    expect(exported.getWorksheet(result.summarySheetName)!.getCell("J4").value).toBe("Abono parcial");
    expect(exported.getWorksheet("Presupuesto")!.getCell("I4").value).toBe("Pendiente");
  });

  it("exports historical plus new payments once, includes unassigned payments, and preserves stable receipt/payment IDs", async () => {
    const { baseline, line, payments } = await fixture();
    const result = addPaymentWorkbookProjection(baseline, payments);
    const downloaded = await loadWorkbook(await writeWorkbook(baseline));
    expect(readBudgetLines(downloaded)[0].paid).toBe(350);
    const summary = downloaded.getWorksheet(result.summarySheetName)!;
    expect(summary.getRow(4).values).toEqual([undefined, line.id, "General", "Nueva partida", 1000, 900, 200, 150, 350, 550, "Abono parcial", "No"]);
    const ledger = downloaded.getWorksheet(result.paymentsSheetName)!;
    const rows = Array.from({ length: ledger.rowCount - 3 }, (_, index) => ledger.getRow(index + 4).values as unknown[]);
    expect(rows.map((row) => row[1])).toEqual([`historical:${line.id}`, "legacy-detail", "payment-1", "unassigned"]);
    expect(rows.reduce((sum, row) => sum + Number(row[6]), 0)).toBe(420);
    expect(rows.find((row) => row[1] === "legacy-detail")?.[6]).toBe(0);
    expect(rows.find((row) => row[1] === "payment-1")?.[11]).toBe("shared-invoice");
    expect(rows.find((row) => row[1] === "unassigned")?.[11]).toBe("shared-invoice");
    expect(downloaded.getWorksheet(PAYMENT_PROJECTION_SHEET)?.state).toBe("veryHidden");
    expect(downloaded.getWorksheet("Presupuesto")!.getCell("I4").value).toBe("Pendiente");
  });

  it("restores only the historical amount after an offline rename and never turns exported payment totals into new history", async () => {
    const { baseline, bytes, line, payments } = await fixture();
    addPaymentWorkbookProjection(baseline, payments);
    const imported = await loadWorkbook(await writeWorkbook(baseline));
    imported.getWorksheet("Presupuesto")!.getCell("B4").value = "Renamed offline";
    imported.getWorksheet("Presupuesto")!.getCell("G4").value = 950;
    restoreHistoricalWorkbookPaid(imported, await loadWorkbook(bytes), payments);
    const restored = await loadWorkbook(await writeWorkbook(imported));
    expect(readBudgetLines(restored)[0]).toMatchObject({ id: line.id, item: "Renamed offline", paid: 200, quote: 950 });
    expect(restored.getWorksheet(PAYMENT_PROJECTION_SHEET)).toBeUndefined();
    expect(restored.getWorksheet("Pagos")).toBeUndefined();
    expect(addPaymentWorkbookProjection(restored, payments).lines[0].paid).toBe(350);
  });

  it.each(["amount", "payment", "metadata", "missing"])("rejects an edited %s projection without accepting a second payment", async (edit) => {
    const { baseline, bytes, payments } = await fixture();
    addPaymentWorkbookProjection(baseline, payments);
    const imported = await loadWorkbook(await writeWorkbook(baseline));
    if (edit === "amount") imported.getWorksheet("Presupuesto")!.getCell("J4").value = 500;
    if (edit === "payment") imported.getWorksheet("Pagos")!.getCell("E5").value = 500;
    if (edit === "metadata") imported.getWorksheet(PAYMENT_PROJECTION_SHEET)!.getCell("B3").value = 500;
    if (edit === "missing") imported.removeWorksheet(imported.getWorksheet(PAYMENT_PROJECTION_SHEET)!.id);
    const source = await loadWorkbook(bytes);
    const message = edit === "amount" ? "se calcula" : edit === "payment" ? "consulta" : edit === "metadata" ? "identificadores" : "Falta el resumen";
    expect(() => restoreHistoricalWorkbookPaid(imported, source, payments)).toThrow(message);
    expect(readBudgetLines(await loadWorkbook(bytes))[0].paid).toBe(200);
  });

  it("requires a fresh download when a payment changes while the Excel copy is offline", async () => {
    const { baseline, bytes, payments } = await fixture();
    addPaymentWorkbookProjection(baseline, payments);
    const imported = await loadWorkbook(await writeWorkbook(baseline));
    const source = await loadWorkbook(bytes);
    expect(() => restoreHistoricalWorkbookPaid(imported, source, payments.map((payment) => payment.id === "payment-1" ? { ...payment, amount: 175 } : payment))).toThrow("identificadores");
    const current = await loadWorkbook(bytes);
    expect(readBudgetLines(current)[0].paid).toBe(200);
  });

  it("keeps an unknown balance unknown and excludes outside-objective payments from budget control", async () => {
    const { baseline, line, payments } = await fixture();
    baseline.getWorksheet("Presupuesto")!.getCell("G4").value = null;
    baseline.getWorksheet("Presupuesto")!.getCell("AA4").value = 1;
    const result = addPaymentWorkbookProjection(baseline, payments);
    expect(result.lines[0]).toMatchObject({ id: line.id, remaining: null, paymentStatus: "unknown", excess: 0, paid: 350 });
    expect(baseline.getWorksheet(result.summarySheetName)!.getCell("I4").value).toBeNull();
  });

  it("allows a new unpaid budget line but never copies a projected payment into its historical baseline", async () => {
    const { baseline, bytes, payments } = await fixture();
    addPaymentWorkbookProjection(baseline, payments);
    const exported = await writeWorkbook(baseline);
    const invalid = await loadWorkbook(exported);
    invalid.getWorksheet("Presupuesto")!.insertRow(5, ["General", "New item", "", "", 75, null, 60, null, "Pendiente", 350]);
    const source = await loadWorkbook(bytes);
    expect(() => restoreHistoricalWorkbookPaid(invalid, source, payments)).toThrow("pagado cero");
    const valid = await loadWorkbook(exported);
    valid.getWorksheet("Presupuesto")!.insertRow(5, ["General", "New item", "", "", 75, null, 60, null, "Pendiente", 0]);
    restoreHistoricalWorkbookPaid(valid, await loadWorkbook(bytes), payments);
    expect(readBudgetLines(valid).map((line) => line.paid)).toEqual([200, 0]);
  });

  it("preserves user worksheets whose names match generated report names", async () => {
    const { baseline, bytes, payments } = await fixture();
    baseline.addWorksheet("Pagos").getCell("A1").value = "Custom user sheet";
    const customBytes = await writeWorkbook(baseline);
    const result = addPaymentWorkbookProjection(baseline, payments);
    expect(result.paymentsSheetName).toBe("Pagos (2)");
    const imported = await loadWorkbook(await writeWorkbook(baseline));
    restoreHistoricalWorkbookPaid(imported, await loadWorkbook(customBytes), payments);
    expect(imported.getWorksheet("Pagos")!.getCell("A1").value).toBe("Custom user sheet");
    expect(readBudgetLines(await loadWorkbook(bytes))[0].paid).toBe(200);
  });

  it("allows Google objective/quote edits while preventing cumulative payments from replacing the historical baseline", async () => {
    const { baseline, bytes, payments } = await fixture();
    const imported = await loadWorkbook(bytes);
    const sheet = imported.getWorksheet("Presupuesto")!;
    sheet.getCell("E4").value = 1200;
    sheet.getCell("G4").value = 1100;
    expect(() => assertHistoricalPaidUnchangedForLedger(imported, baseline, payments)).not.toThrow();
    sheet.getCell("J4").value = 350;
    expect(() => assertHistoricalPaidUnchangedForLedger(imported, baseline, payments)).toThrow("pagado histórico");
    expect(readBudgetLines(await loadWorkbook(bytes))[0].paid).toBe(200);
  });

  it("allows existing historical amounts to change when all payment details were already included or removed", async () => {
    const { baseline, bytes, payments } = await fixture();
    const imported = await loadWorkbook(bytes);
    imported.getWorksheet("Presupuesto")!.getCell("J4").value = 300;
    const inactive = payments.map((payment) => payment.accountingMode === "ledger" ? { ...payment, deletedAt: "deleted" } : payment);
    expect(() => assertHistoricalPaidUnchangedForLedger(imported, baseline, inactive)).not.toThrow();
  });

  it("rejects deleting a budget line with active ledger payments in raw and projected Excel copies", async () => {
    const { baseline, bytes, payments } = await fixture();
    const raw = await loadWorkbook(bytes);
    raw.getWorksheet("Presupuesto")!.spliceRows(4, 1);
    expect(() => assertHistoricalPaidUnchangedForLedger(raw, baseline, payments)).toThrow("Reasigná sus pagos");
    const projectedSource = await loadWorkbook(bytes);
    addPaymentWorkbookProjection(projectedSource, payments);
    const projected = await loadWorkbook(await writeWorkbook(projectedSource));
    projected.getWorksheet("Presupuesto")!.spliceRows(4, 1);
    const current = await loadWorkbook(bytes);
    expect(() => restoreHistoricalWorkbookPaid(projected, current, payments)).toThrow("Reasigná sus pagos");
  });

  it("allows deleting a line once its payments have been reassigned", async () => {
    const { baseline, bytes, payments } = await fixture();
    const imported = await loadWorkbook(bytes);
    imported.getWorksheet("Presupuesto")!.spliceRows(4, 1);
    const reassigned = payments.map((payment) => ({ ...payment, budgetLineId: null }));
    expect(() => assertHistoricalPaidUnchangedForLedger(imported, baseline, reassigned)).not.toThrow();
  });
});
