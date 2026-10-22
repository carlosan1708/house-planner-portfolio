import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { applyExpensePaymentsToBudget } from "@/lib/expense-records";

const mocks = vi.hoisted(() => {
  const records = new Map<string, Record<string, unknown>>();
  let sequence = 0;
  let serial = Promise.resolve();
  const hook = { beforeValidation: null as (() => void | Promise<void>) | null };
  const snapshot = (collection: string, id: string) => {
    const data = records.has(`${collection}/${id}`) ? structuredClone(records.get(`${collection}/${id}`)) : undefined;
    return { id, ref: { collection, id }, exists: data !== undefined, data: () => data };
  };
  return {
    records, hook,
    actor: vi.fn(),
    validateLine: vi.fn(),
    commitActivity: vi.fn(),
    collection: (collection: string) => ({
      doc: (id?: string) => {
        const key = id || `payment-${++sequence}`;
        return { id: key, collection, get: async () => snapshot(collection, key) };
      },
      where: (_field: string, _operator: string, value: string) => ({ get: async () => ({ docs: [...mocks.records.entries()].flatMap(([key, data]) => {
        if (!key.startsWith(`${collection}/`) || data.projectId !== value) return [];
        return [snapshot(collection, key.slice(collection.length + 1))];
      }) }) }),
    }),
    transact: (run: () => Promise<unknown>) => { const result = serial.then(run); serial = result.then(() => undefined, () => undefined); return result; },
    reset: () => { records.clear(); sequence = 0; serial = Promise.resolve(); hook.beforeValidation = null; },
  };
});

const currencyMock = vi.hoisted(() => ({ value: "CRC" as "CRC" | "USD", lock: vi.fn() }));
vi.mock("@/lib/project-currency", () => ({
  readProjectCurrency: async () => currencyMock.value,
  lockProjectCurrency: currencyMock.lock,
  validateProjectCurrency: async (_transaction: unknown, _projectId: string, expected: string) => {
    if (expected !== currencyMock.value) throw new Error("project_currency_changed");
    return currencyMock.value;
  },
}));
beforeEach(() => { currencyMock.value = "CRC"; currencyMock.lock.mockImplementation(async () => currencyMock.value); });

vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "server-time" } }));
vi.mock("@/lib/auth", () => ({ requireTabAccess: mocks.actor }));
vi.mock("@/lib/firebase-admin", () => ({ firestore: { collection: mocks.collection } }));
vi.mock("@/lib/project", () => ({ DOCUMENTS: "media", EXPENSE_DOCUMENTS: "documents", EXPENSE_PAYMENTS: "payments", EXPENSE_PAYMENT_STATUSES: "payment-statuses", PURCHASES: "purchases", BUDGET_LINES: "budget-lines", CONFIG: "config", projectConfigDoc: (id: string) => id, projectScopedId: (projectId: string, id: string) => `${projectId}__${id}` }));
vi.mock("@/lib/expense-api", () => ({ validateExpenseBudgetLine: mocks.validateLine, validatePaidBudgetLine: mocks.validateLine, legacyExpenseDocuments: async () => [], expenseIso: () => "2026-09-27T12:00:00.000Z" }));
vi.mock("@/lib/activity", () => ({ commitActivity: mocks.commitActivity }));

import { DELETE, GET, PATCH, POST } from "@/app/api/expenses/payments/route";

const post = (body: Record<string, unknown>) => POST(new Request("http://localhost/api/expenses/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
const patch = (body: Record<string, unknown>) => PATCH(new Request("http://localhost/api/expenses/payments", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
const statusKey = (id = "architecture") => `payment-statuses/${createHash("sha256").update(`project-1:${id}`).digest("hex")}`;
const activePayments = () => [...mocks.records.entries()].flatMap(([key, data]) => key.startsWith("payments/") && !data.deletedAt ? [{ ...data, id: key.slice(9) }] : []);
const historical = (amount: number, extra: Record<string, unknown> = {}) => ({ budgetLineId: "architecture", amount, accountingMode: "historical-detail", ...extra });
const officialSource = (paid: number, id = "architecture", version = 1) => {
  mocks.records.set("config/project-1", { projectId: "project-1", workbookPlanVersion: version, workbookActualsRevision: 0 });
  mocks.records.set(`budget-lines/project-1__${id}`, { projectId: "project-1", id, paid, planVersion: version, actualsRevision: 0 });
  mocks.validateLine.mockImplementation(async (projectId: string, lineId: string) => projectId === "project-1" && lineId === id ? { id, label: "Honorarios arquitectura", paid, workbookPaid: paid, planVersion: version, actualsRevision: 0 } : null);
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reset();
  mocks.actor.mockResolvedValue({ projectId: "project-1", email: "owner@example.com", role: "admin" });
  officialSource(900000);
  mocks.commitActivity.mockImplementation(async (_actor, _event, write, validate) => mocks.transact(async () => {
    const pending: Array<() => void> = [];
    const transaction = { get: (target: { get: () => Promise<unknown> }) => target.get(), set: (ref: { collection: string; id: string }, data: Record<string, unknown>, options?: { merge?: boolean }) => {
    const key = `${ref.collection}/${ref.id}`;
    pending.push(() => mocks.records.set(key, options?.merge ? { ...mocks.records.get(key), ...data } : data));
    } };
    const before = mocks.hook.beforeValidation; mocks.hook.beforeValidation = null; await before?.();
    await validate?.(transaction);
    write(transaction);
    pending.forEach((save) => save());
  }));
});

describe("unified payment model writes", () => {
  const activate = () => mocks.records.set("config/project-1", { ...mocks.records.get("config/project-1"), paymentsModelVersion: 2, paymentLedgerRevision: 7, paymentProjectedLedgerRevision: 7, workbookObjectKey: "official.xlsx" });
  it("requires refreshed clients for every write after migration", async () => {
    activate();
    expect((await post({ amount: 100 })).status).toBe(409);
    expect((await patch({ id: "old", amount: 100 })).status).toBe(409);
    expect((await DELETE(new Request("http://localhost/api/expenses/payments?id=old", { method: "DELETE" }))).status).toBe(409);
    expect(activePayments()).toEqual([]); expect(mocks.commitActivity).not.toHaveBeenCalled();
  });
  it("counts existing details once and advances the durable outbox exactly once for an idempotent create", async () => {
    activate(); mocks.records.set("payments/old", { projectId: "project-1", budgetLineId: "architecture", amount: 400, accountingMode: "historical-detail" });
    const body = { paymentsModelVersion: 2, budgetLineId: "architecture", amount: 800, clientMutationId: "unified-create-1" };
    expect((await post(body)).status).toBe(201); expect((await post(body)).status).toBe(200);
    expect(mocks.records.get("config/project-1")).toMatchObject({ paymentLedgerRevision: 8, paymentProjectionPending: true });
    const payload = await GET().then((response) => response.json());
    expect(payload).toMatchObject({ paymentsModelVersion: 2, paymentLedgerRevision: 8, paymentProjectionPending: true });
    expect(applyExpensePaymentsToBudget([{ id: "architecture", paid: 1600, quote: 3000, objective: 3000 }], activePayments(), { paymentsModelVersion: 2 })[0].paid).toBe(1200);
  });
  it("edits legacy details as ordinary payments while preserving provenance and receipts", async () => {
    activate(); mocks.records.set("documents/receipt", { projectId: "project-1", title: "Factura", documentType: "receipt" });
    mocks.records.set("payments/old", { projectId: "project-1", budgetLineId: "architecture", amount: 400, accountingMode: "historical-detail", documentId: "receipt", documentIds: ["receipt"], source: "excel-import" });
    expect((await patch({ paymentsModelVersion: 2, id: "old", amount: 1000000 })).status).toBe(200);
    expect(mocks.records.get("payments/old")).toMatchObject({ amount: 1000000, accountingMode: "historical-detail", documentIds: ["receipt"], source: "excel-import" });
    expect(mocks.records.has(statusKey())).toBe(false);
    expect(mocks.records.get("config/project-1")).toMatchObject({ paymentLedgerRevision: 8, paymentProjectionPending: true });
  });
  it("deletes a payment without deleting its receipts or recreating Excel amounts", async () => {
    activate(); mocks.records.set("documents/receipt", { projectId: "project-1" });
    mocks.records.set("payments/old", { projectId: "project-1", budgetLineId: "architecture", amount: 400, documentIds: ["receipt"] });
    expect((await DELETE(new Request("http://localhost/api/expenses/payments?id=old", { method: "DELETE", body: JSON.stringify({ paymentsModelVersion: 2 }) }))).status).toBe(200);
    expect(activePayments()).toEqual([]); expect(mocks.records.get("documents/receipt")?.deletedAt).toBeUndefined();
    expect(mocks.records.get("config/project-1")).toMatchObject({ paymentLedgerRevision: 8, paymentProjectionPending: true });
  });
  it("rejects a concurrent ledger update before writing the proposed payment", async () => {
    activate(); mocks.hook.beforeValidation = () => { const config = mocks.records.get("config/project-1")!; mocks.records.set("config/project-1", { ...config, paymentLedgerRevision: 8 }); };
    expect((await post({ paymentsModelVersion: 2, amount: 100 })).status).toBe(409);
    expect(activePayments()).toHaveLength(0); expect(mocks.records.get("config/project-1")?.paymentLedgerRevision).toBe(8);
  });
});

describe("expense payment details", () => {
  it("persists a complete-payment choice independently from payment transactions", async () => {
    const response = await PATCH(new Request("http://localhost/api/expenses/payments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set-complete", budgetLineId: "architecture", complete: true }),
    }));

    expect(response.status).toBe(200);
    let payload = await GET().then((result) => result.json());
    expect(payload.completedLineIds).toEqual(["architecture"]);
    expect(payload.payments).toEqual([]);

    await PATCH(new Request("http://localhost/api/expenses/payments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set-complete", budgetLineId: "architecture", complete: false }),
    }));
    payload = await GET().then((result) => result.json());
    expect(payload.completedLineIds).toEqual([]);
  });

  it("stores multiple independent payments against one workbook line", async () => {
    expect((await post({ budgetLineId: "architecture", amount: 500000, paymentDate: "2026-09-01", payee: "Arquitecto" })).status).toBe(201);
    expect((await post({ budgetLineId: "architecture", amount: 200000, paymentDate: "2026-09-20", payee: "Enrique", notes: "Plano mecánico" })).status).toBe(201);

    const response = await GET();
    const payload = await response.json();
    expect(payload.payments).toHaveLength(2);
    expect(payload.payments.map((item: { amount: number }) => item.amount).sort()).toEqual([200000, 500000]);
    expect(payload.payments.every((item: { budgetLineId: string }) => item.budgetLineId === "architecture")).toBe(true);
    expect(mocks.validateLine).toHaveBeenCalledTimes(2);
  });

  it("links a comprobante to its payment regardless of legacy budget-line metadata", async () => {
    mocks.records.set("documents/invoice-1", { projectId: "project-1", title: "Factura", documentType: "invoice", budgetLineIds: ["another-line", "materials-line"], budgetLineId: "another-line", deletedAt: null });
    const response = await post({ budgetLineId: "architecture", amount: 200000, documentId: "invoice-1" });
    expect(response.status).toBe(201);
    expect([...mocks.records.keys()].filter((key) => key.startsWith("payments/"))).toHaveLength(1);
  });

  it("accepts a comprobante that covers this line and other lines", async () => {
    mocks.records.set("documents/invoice-1", { projectId: "project-1", title: "Factura mixta", documentType: "invoice", budgetLineIds: ["architecture", "materials-line"], budgetLineId: "architecture", deletedAt: null });
    const response = await post({ budgetLineId: "architecture", amount: 200000, documentId: "invoice-1" });
    expect(response.status).toBe(201);
  });

  it("updates an existing payment without creating another record", async () => {
    expect((await post({ budgetLineId: "architecture", amount: 200000, payee: "Renders" })).status).toBe(201);
    const created = (await GET().then((response) => response.json())).payments[0];
    const response = await PATCH(new Request("http://localhost/api/expenses/payments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...created, amount: 250000, payee: "Renders finales" }),
    }));

    expect(response.status).toBe(200);
    const payload = await GET().then((result) => result.json());
    expect(payload.payments).toHaveLength(1);
    expect(payload.payments[0]).toMatchObject({ amount: 250000, payee: "Renders finales" });
  });

  it("records an unassigned payment with several reusable receipts and no budget lookup", async () => {
    for (const id of ["photo", "pdf"]) mocks.records.set(`documents/${id}`, { projectId: "project-1", title: id, documentType: "receipt" });
    const response = await post({ amount: 300, documentIds: ["photo", "pdf", "photo"] });
    expect(response.status).toBe(201);
    const payment = (await GET().then((response) => response.json())).payments[0];
    expect(payment).toMatchObject({ budgetLineId: null, amount: 300, documentIds: ["photo", "pdf"], accountingMode: "ledger" });
    expect(mocks.validateLine).not.toHaveBeenCalled();
    expect((await post({ amount: 100, documentIds: ["photo"] })).status).toBe(201);
  });

  it("accepts a budget item before its first payment", async () => {
    mocks.validateLine.mockResolvedValue({ id: "unpaid", label: "New materials", paid: 0 });
    expect((await post({ amount: 100, budgetLineId: "unpaid" })).status).toBe(201);
  });

  it("preserves historical details when receipts are attached or their amount is edited", async () => {
    mocks.records.set("payments/historical", { projectId: "project-1", budgetLineId: "architecture", amount: 200 });
    expect((await PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ id: "historical", budgetLineId: "architecture", amount: 250, documentIds: [] }) }))).status).toBe(200);
    expect(mocks.records.get("payments/historical")?.accountingMode).toBe("historical-detail");
  });

  it("reuses a stable mutation ID instead of creating another payment", async () => {
    const input = { amount: 300, clientMutationId: "payment-request-1" };
    const first = await post(input).then((response) => response.json());
    const retry = await post(input).then((response) => response.json());
    expect(retry).toMatchObject({ id: first.id, duplicate: true });
    expect([...mocks.records.keys()].filter((key) => key.startsWith("payments/"))).toHaveLength(1);
  });

  it("calculates purchase settlement using only that purchase's active payments", async () => {
    mocks.records.set("purchases/materials", { projectId: "project-1", title: "Materials", amount: 900, currency: "CRC" });
    expect((await post({ amount: 300, purchaseId: "materials", paymentKind: "partial" })).status).toBe(201);
    expect((await post({ amount: 700, purchaseId: "materials", paymentKind: "settlement" })).status).toBe(409);
    expect((await post({ amount: 600, purchaseId: "materials", paymentKind: "settlement" })).status).toBe(201);
    expect((await post({ amount: 600, purchaseId: "materials", paymentKind: "settlement" })).status).toBe(409);
    expect(mocks.records.get("purchases/materials")?.paymentsRevision).toBe(2);
  });

  it.each([null, "architecture"])("records a declared full payment with manual amount and budget line %s without settling the line", async (budgetLineId) => {
    officialSource(0);
    mocks.records.set("documents/full-receipt", { projectId: "project-1", title: "Comprobante del pago total", documentType: "receipt" });
    const input = { budgetLineId, amount: 300.25, paymentKind: "settlement", documentIds: ["full-receipt"], clientMutationId: `manual-full-${budgetLineId || "unassigned"}` };
    const response = await post(input);
    expect(response.status).toBe(201);
    const created = await response.json();
    const duplicate = await post(input);
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ id: created.id, duplicate: true });
    const payload = await GET().then((result) => result.json());
    expect(payload.payments).toHaveLength(1);
    expect(payload.payments[0]).toMatchObject({ amount: 300.25, budgetLineId, purchaseId: null, paymentKind: "settlement", accountingMode: "ledger", documentIds: ["full-receipt"] });
    expect(payload.completedLineIds).toEqual([]);
    const [projected] = applyExpensePaymentsToBudget([{ id: "architecture", paid: 0, quote: 900, objective: 1000 }], activePayments());
    expect(projected).toMatchObject({ paid: budgetLineId ? 300.25 : 0, quote: 900, objective: 1000 });
    expect(mocks.records.get("budget-lines/project-1__architecture")).toMatchObject({ paid: 0 });
    expect(mocks.records.get("documents/full-receipt")?.deletedAt).toBeUndefined();
  });

  it("requires an explicit positive amount for a full payment without a purchase", async () => {
    for (const amount of [undefined, "", 0, -1]) expect((await post({ budgetLineId: "architecture", paymentKind: "settlement", amount })).status).toBe(400);
    expect(activePayments()).toHaveLength(0);
    expect(mocks.commitActivity).not.toHaveBeenCalled();
  });

  it("changes an independent payment classification without changing its amount or receipts", async () => {
    mocks.records.set("documents/invoice", { projectId: "project-1", title: "Factura", documentType: "invoice" });
    const created = await post({ budgetLineId: "architecture", amount: 350.50, documentIds: ["invoice"], paymentKind: "partial" }).then((response) => response.json());
    expect((await patch({ id: created.id, paymentKind: "settlement" })).status).toBe(200);
    expect(activePayments()).toEqual([expect.objectContaining({ id: created.id, amount: 350.50, purchaseId: null, paymentKind: "settlement", accountingMode: "ledger", documentIds: ["invoice"] })]);
    expect((await GET().then((response) => response.json())).completedLineIds).toEqual([]);
  });

  it("does not infer an exchange rate or a balance without an agreed total", async () => {
    mocks.records.set("purchases/usd", { projectId: "project-1", amount: 900, currency: "USD" });
    expect((await post({ amount: 300, purchaseId: "usd" })).status).toBe(400);
    mocks.records.set("purchases/unknown", { projectId: "project-1", amount: null, currency: "CRC" });
    expect((await post({ amount: 300, purchaseId: "unknown", paymentKind: "settlement" })).status).toBe(409);
  });

  it.each(["foreign", "deleted", "missing"])("rejects %s receipts before writing a payment", async (state) => {
    if (state !== "missing") mocks.records.set("documents/receipt", { projectId: state === "foreign" ? "project-2" : "project-1", deletedAt: state === "deleted" ? "time" : null });
    expect((await post({ amount: 100, documentIds: ["receipt"] })).status).toBe(400);
    expect([...mocks.records.keys()].filter((key) => key.startsWith("payments/"))).toHaveLength(0);
  });

  it("denies writes without an authorized actor", async () => {
    mocks.actor.mockResolvedValue(null);
    expect((await post({ amount: 100 })).status).toBe(403);
    expect(mocks.commitActivity).not.toHaveBeenCalled();
  });

  it("deletes only one payment and preserves its receipts and sibling payments", async () => {
    mocks.records.set("documents/receipt", { projectId: "project-1", title: "Photo" });
    const first = await post({ amount: 100, documentIds: ["receipt"] }).then((response) => response.json());
    await post({ amount: 200, documentIds: ["receipt"] });
    expect((await DELETE(new Request(`http://localhost/api/expenses/payments?id=${first.id}`, { method: "DELETE" }))).status).toBe(200);
    expect((await GET().then((response) => response.json())).payments).toHaveLength(1);
    expect(mocks.records.get("documents/receipt")?.deletedAt).toBeUndefined();
  });
});

describe("explicit Excel history allocation", () => {
  it("classifies an independent Excel historical detail as full payment without adding it again", async () => {
    officialSource(515300);
    const response = await post(historical(515300, { paymentKind: "settlement" }));
    expect(response.status).toBe(201);
    expect(activePayments()).toEqual([expect.objectContaining({ amount: 515300, paymentKind: "settlement", accountingMode: "historical-detail", purchaseId: null })]);
    const [line] = applyExpensePaymentsToBudget([{ id: "architecture", paid: 515300, quote: 600000, objective: 700000 }], activePayments());
    expect(line).toMatchObject({ paid: 515300, transactionPaid: 0, quote: 600000, objective: 700000 });
    expect((await GET().then((result) => result.json())).completedLineIds).toEqual([]);
  });

  it("never infers historical detail merely because the amount equals Excel", async () => {
    const response = await post({ budgetLineId: "architecture", amount: 900000 });
    expect(response.status).toBe(201);
    expect(activePayments()).toEqual([expect.objectContaining({ accountingMode: "ledger", amount: 900000 })]);
    expect(mocks.records.has(statusKey())).toBe(false);
  });

  it("records historical detail without increasing the official paid total or changing its receipt", async () => {
    officialSource(515300);
    mocks.records.set("documents/invoice", { projectId: "project-1", title: "Permiso municipal", documentType: "invoice" });
    const response = await post(historical(515300, { documentIds: ["invoice"] }));
    expect(response.status).toBe(201);
    const stored = activePayments();
    expect(stored).toEqual([expect.objectContaining({ amount: 515300, accountingMode: "historical-detail", documentIds: ["invoice"] })]);
    const [line] = applyExpensePaymentsToBudget([{ id: "architecture", paid: 515300, quote: 515300, objective: 515300 }], stored);
    expect(line).toMatchObject({ paid: 515300, workbookPaid: 515300, transactionPaid: 0 });
    expect(mocks.records.get(statusKey())?.historicalDetailsRevision).toBe(1);
    expect(mocks.records.get("documents/invoice")?.title).toBe("Permiso municipal");
  });

  it.each([undefined, null, "foreign-line"])("requires a historical budget line instead of %s", async (budgetLineId) => {
    expect((await post(historical(100, { budgetLineId }))).status).toBe(400);
    expect(activePayments()).toHaveLength(0);
  });

  it("uses raw workbook history rather than a positive paid total created by ledger payments", async () => {
    officialSource(0);
    mocks.validateLine.mockResolvedValue({ id: "architecture", label: "Arquitectura", paid: 515300, workbookPaid: 0, planVersion: 1, actualsRevision: 0 });
    expect((await post(historical(100))).status).toBe(400);
    expect(activePayments()).toHaveLength(0);
  });

  it.each(["automatic", "", null, true])("rejects an invalid explicit accounting mode %s", async (mode) => {
    expect((await post({ amount: 100, accountingMode: mode })).status).toBe(400);
    expect(activePayments()).toHaveLength(0);
  });

  it("limits all active historical details including legacy rows to the raw Excel amount", async () => {
    mocks.records.set("payments/legacy", { projectId: "project-1", budgetLineId: "architecture", amount: 200000 });
    mocks.records.set("payments/history", { projectId: "project-1", budgetLineId: "architecture", amount: 100000, accountingMode: "historical-detail" });
    mocks.records.set("payments/ledger", { projectId: "project-1", budgetLineId: "architecture", amount: 700000, accountingMode: "ledger" });
    mocks.records.set("payments/deleted", { projectId: "project-1", budgetLineId: "architecture", amount: 800000, deletedAt: "before" });
    mocks.records.set("payments/foreign", { projectId: "project-2", budgetLineId: "architecture", amount: 800000 });
    mocks.records.set("payments/other-line", { projectId: "project-1", budgetLineId: "another-line", amount: 800000 });
    expect((await post(historical(600000))).status).toBe(201);
    const rejected = await post(historical(.01));
    expect(rejected.status).toBe(409);
    expect((await rejected.json()).error).toContain("histórico de Excel disponible");
    expect(mocks.records.get(statusKey())?.historicalDetailsRevision).toBe(1);
  });

  it("allocates exact cent amounts without floating point overspending", async () => {
    officialSource(100.30);
    expect((await post(historical(60.10))).status).toBe(201);
    expect((await post(historical(40.20))).status).toBe(201);
    expect((await post(historical(.01))).status).toBe(409);
  });

  it("reclassifies only the selected ledger payment while retaining its ID, receipt and all fields", async () => {
    officialSource(515300);
    mocks.records.set("documents/invoice", { projectId: "project-1", title: "Permiso municipal", documentType: "invoice" });
    const input = { budgetLineId: "architecture", amount: 515300, documentIds: ["invoice"], paymentDate: "2026-10-01", payee: "Municipalidad", reference: "REC-123", notes: "Permiso de construcción" };
    const created = await post(input).then((response) => response.json());
    const before = mocks.records.get(`payments/${created.id}`)!;
    expect(applyExpensePaymentsToBudget([{ id: "architecture", paid: 515300, quote: 515300, objective: 515300 }], activePayments())[0].paid).toBe(1030600);
    expect((await patch({ id: created.id, accountingMode: "historical-detail" })).status).toBe(200);
    const after = mocks.records.get(`payments/${created.id}`)!;
    expect(after).toMatchObject({ ...before, accountingMode: "historical-detail", documentIds: ["invoice"] });
    expect(activePayments()).toHaveLength(1);
    expect(applyExpensePaymentsToBudget([{ id: "architecture", paid: 515300, quote: 515300, objective: 515300 }], activePayments())[0].paid).toBe(515300);
    const changes = mocks.commitActivity.mock.calls.at(-1)![1].changes;
    expect(changes).toContainEqual({ field: "accounting_mode", before: "ledger", after: "historical-detail" });
  });

  it("preserves both current modes when PATCH omits the accounting choice", async () => {
    const first = await post(historical(200)).then((response) => response.json());
    const second = await post({ budgetLineId: "architecture", amount: 300 }).then((response) => response.json());
    expect((await patch({ id: first.id, reference: "Updated history" })).status).toBe(200);
    expect((await patch({ id: second.id, reference: "Updated new payment" })).status).toBe(200);
    expect(mocks.records.get(`payments/${first.id}`)).toMatchObject({ accountingMode: "historical-detail", amount: 200, reference: "Updated history" });
    expect(mocks.records.get(`payments/${second.id}`)).toMatchObject({ accountingMode: "ledger", amount: 300, reference: "Updated new payment" });
  });

  it("excludes the edited historical row from capacity but keeps its siblings allocated", async () => {
    const first = await post(historical(200000)).then((response) => response.json());
    await post(historical(600000));
    expect((await patch({ id: first.id, amount: 300000 })).status).toBe(200);
    expect((await patch({ id: first.id, amount: 300000.01 })).status).toBe(409);
    expect(mocks.records.get(`payments/${first.id}`)?.amount).toBe(300000);
  });

  it("releases historical capacity on explicit conversion back to a new payment", async () => {
    const first = await post(historical(900000)).then((response) => response.json());
    expect((await patch({ id: first.id, accountingMode: "ledger" })).status).toBe(200);
    expect((await post(historical(900000))).status).toBe(201);
    expect(mocks.records.get(statusKey())?.historicalDetailsRevision).toBe(3);
    expect(applyExpensePaymentsToBudget([{ id: "architecture", paid: 900000, quote: 900000, objective: 900000 }], activePayments())[0].paid).toBe(1800000);
  });

  it("releases historical capacity on deletion without removing its receipt or complete flag", async () => {
    mocks.records.set("documents/invoice", { projectId: "project-1", title: "Factura", documentType: "invoice" });
    await patch({ action: "set-complete", budgetLineId: "architecture", complete: true });
    const first = await post(historical(900000, { documentIds: ["invoice"] })).then((response) => response.json());
    expect(mocks.records.get(statusKey())?.complete).toBe(true);
    expect((await DELETE(new Request(`http://localhost/api/expenses/payments?id=${first.id}`, { method: "DELETE" }))).status).toBe(200);
    expect((await post(historical(900000, { documentIds: ["invoice"] }))).status).toBe(201);
    expect(mocks.records.get(statusKey())).toMatchObject({ complete: true, historicalDetailsRevision: 3 });
    expect(mocks.records.get("documents/invoice")?.deletedAt).toBeUndefined();
  });

  it("includes the accounting choice in stable mutation retries", async () => {
    const input = historical(300, { clientMutationId: "historical-request-1" });
    const first = await post(input).then((response) => response.json());
    expect(await post(input).then((response) => response.json())).toEqual({ id: first.id, duplicate: true });
    expect((await post({ ...input, accountingMode: "ledger" })).status).toBe(409);
    expect(activePayments()).toHaveLength(1);
    expect(mocks.records.get(statusKey())?.historicalDetailsRevision).toBe(1);
    expect(mocks.commitActivity).toHaveBeenCalledOnce();
  });

  it("serializes competing allocations of the same historical budget line", async () => {
    const responses = await Promise.all([post(historical(600000)), post(historical(600000))]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(activePayments()).toHaveLength(1);
    expect(mocks.records.get(statusKey())).toMatchObject({ projectId: "project-1", budgetLineId: "architecture", historicalDetailsRevision: 1 });
  });

  it.each(["plan", "actuals", "source-amount", "source-project", "missing-source"])("rejects a concurrent %s change to the validated workbook source", async (change) => {
    mocks.hook.beforeValidation = () => {
      if (change === "plan") mocks.records.set("config/project-1", { workbookPlanVersion: 2, workbookActualsRevision: 0 });
      else if (change === "actuals") mocks.records.set("config/project-1", { workbookPlanVersion: 1, workbookActualsRevision: 1 });
      else if (change === "missing-source") mocks.records.delete("budget-lines/project-1__architecture");
      else mocks.records.set("budget-lines/project-1__architecture", { ...mocks.records.get("budget-lines/project-1__architecture"), ...(change === "source-amount" ? { paid: 100 } : { projectId: "project-2" }) });
    };
    const response = await post(historical(300));
    expect(response.status).toBe(409); expect((await response.json()).error).toContain("histórico de Excel cambió");
    expect(activePayments()).toHaveLength(0); expect(mocks.records.has(statusKey())).toBe(false);
  });

  it("rejects a status document belonging to another project or line", async () => {
    mocks.records.set(statusKey(), { projectId: "project-2", budgetLineId: "architecture", complete: true });
    expect((await post(historical(300))).status).toBe(409);
    expect(activePayments()).toHaveLength(0);
  });

  it("rejects mode changes after a concurrent edit rather than overwriting the new choice", async () => {
    const first = await post({ budgetLineId: "architecture", amount: 300 }).then((response) => response.json());
    mocks.hook.beforeValidation = () => { mocks.records.set(`payments/${first.id}`, { ...mocks.records.get(`payments/${first.id}`), accountingMode: "historical-detail" }); };
    expect((await patch({ id: first.id, reference: "Stale form" })).status).toBe(409);
    expect(mocks.records.get(`payments/${first.id}`)).toMatchObject({ accountingMode: "historical-detail", reference: "" });
  });

  it("rejects historical reclassification of a foreign or deleted payment", async () => {
    mocks.records.set("payments/foreign", { projectId: "project-2", amount: 300, accountingMode: "ledger" });
    mocks.records.set("payments/deleted", { projectId: "project-1", amount: 300, accountingMode: "ledger", deletedAt: "before" });
    expect((await patch({ id: "foreign", accountingMode: "historical-detail" })).status).toBe(404);
    expect((await patch({ id: "deleted", accountingMode: "historical-detail" })).status).toBe(404);
    expect(mocks.commitActivity).not.toHaveBeenCalled();
  });

  it("counts historical payments toward the related purchase balance while excluding them from new budget actuals", async () => {
    mocks.records.set("purchases/materials", { projectId: "project-1", title: "Materials", amount: 900, currency: "CRC" });
    expect((await post(historical(300, { purchaseId: "materials" }))).status).toBe(201);
    expect((await post({ amount: 700, purchaseId: "materials", paymentKind: "settlement" })).status).toBe(409);
    expect((await post({ amount: 600, purchaseId: "materials", paymentKind: "settlement" })).status).toBe(201);
    expect(mocks.records.get("purchases/materials")?.paymentsRevision).toBe(2);
  });
});

describe("project-denominated payment writes", () => {
  it("stamps canonical USD, ignores a submitted denomination and settles only the USD purchase", async () => {
    currencyMock.value = "USD";
    mocks.records.set("purchases/faucet", { projectId: "project-1", amount: 395, currency: "USD" });
    const body = { amount: 195, currency: "CRC", expectedCurrency: "USD", purchaseId: "faucet", clientMutationId: "usd-installment-1" };
    expect((await post(body)).status).toBe(201);
    expect((await post(body)).status).toBe(200);
    expect((await post({ amount: 200, expectedCurrency: "USD", purchaseId: "faucet", paymentKind: "settlement" })).status).toBe(201);
    const payload = await GET().then((response) => response.json());
    expect(payload.currency).toBe("USD");
    expect(payload.payments.map((payment: { amount: number; currency: string }) => [payment.amount, payment.currency]).sort()).toEqual([[195, "USD"], [200, "USD"]]);
    expect(mocks.commitActivity.mock.calls[0][1].changes[0].format).toBe("currency_usd");
    expect(currencyMock.lock).toHaveBeenCalledWith("project-1");
  });
  it("rejects a mismatched purchase and an existing mismatched payment before any currency sum", async () => {
    currencyMock.value = "USD";
    mocks.records.set("purchases/crc", { projectId: "project-1", amount: 395, currency: "CRC" });
    expect((await post({ amount: 1, expectedCurrency: "USD", purchaseId: "crc" })).status).toBe(400);
    mocks.records.set("purchases/usd", { projectId: "project-1", amount: 395, currency: "USD" });
    mocks.records.set("payments/legacy", { projectId: "project-1", purchaseId: "usd", amount: 100 });
    expect((await post({ amount: 295, expectedCurrency: "USD", purchaseId: "usd", paymentKind: "settlement" })).status).toBe(409);
    expect(activePayments()).toHaveLength(1);
    expect(mocks.commitActivity.mock.calls.every((call) => call[1].changes[0].format === "currency_usd")).toBe(true);
  });
  it("reads legacy payments as CRC and does not relabel them when an edit omits currency", async () => {
    mocks.records.set("payments/legacy", { projectId: "project-1", amount: 100, accountingMode: "ledger" });
    expect((await GET().then((response) => response.json())).payments[0].currency).toBe("CRC");
    expect((await patch({ id: "legacy", amount: 100.25 })).status).toBe(200);
    expect(mocks.records.get("payments/legacy")).toMatchObject({ amount: 100.25, currency: "CRC" });
    currencyMock.value = "USD";
    expect((await patch({ id: "legacy", amount: 100.25, expectedCurrency: "USD" })).status).toBe(409);
    expect(mocks.records.get("payments/legacy")?.currency).toBe("CRC");
  });
});

it.each([1, 2])("requires a currency-aware client before creating or editing a v%s USD payment", async (version) => {
  currencyMock.value = "USD";
  const model = version === 2 ? { paymentsModelVersion: 2 } : {};
  if (version === 2) mocks.records.set("config/project-1", { ...mocks.records.get("config/project-1"), paymentsModelVersion: 2, paymentLedgerRevision: 7 });
  const correctedPayment = { projectId: "project-1", amount: 195, currency: "USD", originalCurrency: "CRC", accountingMode: "ledger" };
  mocks.records.set("payments/corrected", correctedPayment);
  for (const response of [
    await post({ amount: 100000, currency: "CRC", ...model }),
    await patch({ id: "corrected", amount: 200000, currency: "CRC", ...model }),
  ]) {
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Project currency changed. Refresh before saving this payment.",
      code: "project_currency_changed",
    });
  }
  expect(activePayments()).toEqual([{ ...correctedPayment, id: "corrected" }]);
  expect(mocks.commitActivity).not.toHaveBeenCalled();
  expect(mocks.validateLine).not.toHaveBeenCalled();
});

it("accepts legacy CRC creates and edits without an expected currency", async () => {
  const response = await post({ amount: 125000, clientMutationId: "legacy-crc-create" });
  expect(response.status).toBe(201);
  const { id } = await response.json();
  expect(mocks.records.get(`payments/${id}`)).toMatchObject({ amount: 125000, currency: "CRC" });
  expect((await patch({ id, amount: 150000 })).status).toBe(200);
  expect(mocks.records.get(`payments/${id}`)).toMatchObject({ amount: 150000, currency: "CRC" });
  expect(activePayments()).toHaveLength(1);
});

it("rejects stale or invalid expected currency without recording or reinterpreting the payment", async () => {
  currencyMock.value = "USD";
  expect((await post({ amount: 25.5, expectedCurrency: "CRC" })).status).toBe(409);
  expect((await post({ amount: 25.5, expectedCurrency: "EUR" })).status).toBe(400);
  expect(activePayments()).toEqual([]); expect(mocks.commitActivity).not.toHaveBeenCalled();
  expect((await post({ amount: 25.5, expectedCurrency: "USD" })).status).toBe(201);
  const payment = activePayments()[0];
  expect((await patch({ id: payment.id, amount: 26, expectedCurrency: "CRC" })).status).toBe(409);
  expect(mocks.records.get(`payments/${payment.id}`)).toMatchObject({ amount: 25.5, currency: "USD" });
});

it.each([1, 2])("rejects a denomination correction committed after preparing a v%s payment", async (version) => {
  currencyMock.value = "USD";
  if (version === 2) mocks.records.set("config/project-1", { ...mocks.records.get("config/project-1"), paymentsModelVersion: 2, paymentLedgerRevision: 7 });
  mocks.hook.beforeValidation = () => {
    currencyMock.value = "CRC";
    mocks.records.set("config/project-1", { ...mocks.records.get("config/project-1"), workbookPlanVersion: 2, workbookActualsRevision: 1, paymentLedgerRevision: 8 });
  };
  const response = await post({ amount: 25.5, expectedCurrency: "USD", ...(version === 2 ? { paymentsModelVersion: 2 } : {}) });
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "Project currency changed. Refresh before saving this payment.",
    code: "project_currency_changed",
  });
  expect(activePayments()).toEqual([]);
});

it("rejects a corrected PATCH and keeps the original stable ID idempotent for old clients", async () => {
  currencyMock.value = "USD";
  const body = { amount: 25.5, clientMutationId: "correction-stable-id" };
  expect((await post({ ...body, expectedCurrency: "USD" })).status).toBe(201);
  const payment = activePayments()[0];
  mocks.hook.beforeValidation = () => {
    currencyMock.value = "CRC";
    mocks.records.set(`payments/${payment.id}`, { ...mocks.records.get(`payments/${payment.id}`), currency: "CRC", originalCurrency: "USD" });
    mocks.records.set("config/project-1", { ...mocks.records.get("config/project-1"), workbookPlanVersion: 2, workbookActualsRevision: 1, paymentLedgerRevision: 1 });
  };
  expect((await patch({ id: payment.id, amount: 26, expectedCurrency: "USD" })).status).toBe(409);
  expect(mocks.records.get(`payments/${payment.id}`)).toMatchObject({ amount: 25.5, currency: "CRC", originalCurrency: "USD" });
  expect((await post({ ...body, expectedCurrency: "USD" })).status).toBe(409);
  const retry = await post(body);
  expect(retry.status).toBe(200); expect((await retry.json()).duplicate).toBe(true);
  expect(activePayments()).toHaveLength(1);
});

it("checks the v1 source revisions even if two corrections restore the same currency", async () => {
  currencyMock.value = "USD";
  mocks.hook.beforeValidation = () => { mocks.records.set("config/project-1", { ...mocks.records.get("config/project-1"), workbookPlanVersion: 3, workbookActualsRevision: 2, paymentLedgerRevision: 2 }); };
  expect((await post({ amount: 25.5, expectedCurrency: "USD" })).status).toBe(409);
  expect(activePayments()).toEqual([]);
});
