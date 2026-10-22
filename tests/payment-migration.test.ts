import { describe, expect, it } from "vitest";
import { planPaymentMigration } from "@/lib/payment-migration";

const source = { objectKey: "qa/source.xlsx", generation: "123", sha256: "a".repeat(64), planVersion: 67, actualsRevision: 0 };
const lines = [{ id: "architecture", item: "Honorarios arquitectura", paid: 1_600_000 }, { id: "tap", item: "Grifo cocina", paid: 119_950, outsideObjective: true }];
const payments = [
  { id: "payment", budgetLineId: "architecture", amount: 800_000, accountingMode: "ledger", documentIds: ["shared"] },
  { id: "plans", budgetLineId: "architecture", amount: 400_000, accountingMode: "historical-detail", documentIds: ["plans-receipt"] },
  { id: "enrique", budgetLineId: "architecture", amount: 200_000, accountingMode: "historical-detail" },
  { id: "render", budgetLineId: "architecture", amount: 200_000, accountingMode: "historical-detail" },
  { id: "deleted", budgetLineId: "architecture", amount: 100_000, deletedAt: "deleted" },
];
const correction = { lineId: "architecture", expectedLegacyPaid: 2_400_000, expectedRecordedPaid: 1_600_000, targetPaid: 1_600_000, reason: "El usuario confirmó cuatro pagos por 1.600.000; el pago de 800.000 pertenece al acumulado." };
const plan = () => planPaymentMigration({ projectId: "qa", source, lines, payments, corrections: [correction] });

describe("reviewed unified payment migration", () => {
  it("retains every original ID and receipt, corrects the reviewed overlap, and materializes only unexplained source money", () => {
    const before = structuredClone(payments);
    const result = plan();
    expect(result.lines[0]).toMatchObject({ recordedPaid: 1_600_000, importAmount: 0, paid: 1_600_000, legacyPaid: 2_400_000 });
    expect(result.preservedPaymentIds).toEqual(["deleted", "enrique", "payment", "plans", "render"]);
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0]).toMatchObject({ budgetLineId: "tap", amount: 119_950, source: "excel-import", paymentDate: "", payee: "", documentIds: [], deletedAt: null });
    expect(result.lines[1].outsideObjective).toBe(true);
    expect(result.totals).toEqual({ legacyPaid: 2_519_950, recordedPaid: 1_600_000, importedPaid: 119_950, paid: 1_719_950 });
    expect(payments).toEqual(before);
  });

  it("preserves legitimate additional payments unless an exact correction was reviewed", () => {
    const result = planPaymentMigration({ projectId: "qa", source, lines: [{ id: "a", item: "A", paid: 1000 }], payments: [
      { id: "detail", budgetLineId: "a", amount: 400, accountingMode: "historical-detail" },
      { id: "new", budgetLineId: "a", amount: 200, accountingMode: "ledger" },
    ] });
    expect(result.lines[0]).toMatchObject({ paid: 1200, recordedPaid: 600, importAmount: 600 });
  });

  it("is deterministic on retry and binds approval to the entire source and receipt snapshot", () => {
    expect(plan()).toEqual(plan());
    const changed = structuredClone(payments); changed[0].documentIds = ["different-receipt"];
    const next = planPaymentMigration({ projectId: "qa", source, lines, payments: changed, corrections: [correction] });
    expect(next.manifestSha256).not.toBe(plan().manifestSha256);
    expect(next.sourceFingerprint).not.toBe(plan().sourceFingerprint);
  });

  it("rejects a stale correction, orphaned links, duplicate IDs, and a target that would erase a payment", () => {
    expect(() => planPaymentMigration({ projectId: "qa", source, lines, payments, corrections: [{ ...correction, expectedLegacyPaid: 2_399_999 }] })).toThrow("cambió");
    expect(() => planPaymentMigration({ projectId: "qa", source, lines, payments, corrections: [{ ...correction, targetPaid: 1_000_000 }] })).toThrow("eliminar pagos");
    expect(() => planPaymentMigration({ projectId: "qa", source, lines: [], payments })).toThrow("partida ausente");
    expect(() => planPaymentMigration({ projectId: "qa", source, lines, payments: [...payments, payments[0]] })).toThrow("duplicados");
    expect(() => planPaymentMigration({ projectId: "qa", source, lines, payments: [{ ...payments[0], projectId: "other-project" }] })).toThrow("otro proyecto");
  });
});

it("binds USD import provenance to its denomination and rejects legacy CRC mixing", () => {
  const input = { projectId: "usd-project", currency: "USD" as const, source, lines: [{ id: "usd-line", item: "Faucet", paid: 395.25 }], payments: [{ id: "usd-payment", budgetLineId: "usd-line", currency: "USD", amount: 195.1, accountingMode: "ledger" }] };
  const result = planPaymentMigration(input);
  expect(result.currency).toBe("USD");
  expect(result.imports[0]).toMatchObject({ currency: "USD", amount: 395.25 });
  expect(() => planPaymentMigration({ ...input, payments: [{ ...input.payments[0], currency: undefined }] })).toThrow("moneda");
});
