import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const records = new Map<string, Record<string, unknown>>();
  const snapshot = (collection: string, id: string) => ({ id, ref: { collection, id }, exists: records.has(`${collection}/${id}`), data: () => records.get(`${collection}/${id}`) });
  return {
    records,
    actor: vi.fn(),
    paidLines: vi.fn(),
    commitActivity: vi.fn(),
    collection: (collection: string) => ({
      doc: (id = "generated-document") => ({ id, collection, get: async () => snapshot(collection, id) }),
      where: () => ({ get: async () => ({ docs: [] }) }),
    }),
  };
});

vi.mock("sharp", () => ({ default: vi.fn() }));
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
vi.mock("@/lib/firebase-admin", () => ({ firestore: { collection: mocks.collection, getAll: vi.fn() }, projectBucket: null }));
vi.mock("@/lib/folders", () => ({ ensureExpenseInvoiceFolder: vi.fn() }));
vi.mock("@/lib/project", () => ({ DOCUMENTS: "media", EXPENSE_DOCUMENTS: "documents", EXPENSE_PAYMENTS: "payments", PURCHASES: "purchases", projectStoragePrefix: vi.fn() }));
vi.mock("@/lib/expense-api", () => ({ expenseBudgetLines: mocks.paidLines, projectMedia: vi.fn(), mediaJson: vi.fn(), legacyExpenseDocuments: async () => [], expenseIso: vi.fn() }));
vi.mock("@/lib/activity", () => ({ commitActivity: mocks.commitActivity }));

import { PATCH } from "@/app/api/expenses/documents/route";

const patchDocument = (body: Record<string, unknown>) => PATCH(new Request("http://localhost/api/expenses/documents", {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.records.clear();
  mocks.actor.mockResolvedValue({ projectId: "project-1", email: "owner@example.com", role: "admin" });
  mocks.paidLines.mockResolvedValue([
    { id: "architecture", label: "Honorarios arquitectura", paid: 900000 },
    { id: "renders", label: "Renders", paid: 200000 },
  ]);
  mocks.records.set("documents/invoice-1", { projectId: "project-1", title: "Factura", deletedAt: null });
  mocks.commitActivity.mockImplementation(async (_actor, _event, write) => write({ set: (ref: { collection: string; id: string }, data: Record<string, unknown>) => {
    const key = `${ref.collection}/${ref.id}`;
    mocks.records.set(key, { ...mocks.records.get(key), ...data });
  } }));
});

describe("expense document budget lines", () => {
  it("stores one comprobante against several paid budget lines", async () => {
    const response = await patchDocument({ id: "invoice-1", title: "Factura mixta", budgetLineIds: ["architecture", "renders"] });
    expect(response.status).toBe(200);
    expect(mocks.records.get("documents/invoice-1")).toMatchObject({
      budgetLineIds: ["architecture", "renders"],
      budgetLines: [
        { id: "architecture", label: "Honorarios arquitectura" },
        { id: "renders", label: "Renders" },
      ],
      budgetLineId: "architecture",
    });
  });

  it("allows every user-facing field to be empty", async () => {
    const response = await patchDocument({ id: "invoice-1", budgetLineIds: [] });
    expect(response.status).toBe(200);
    expect(mocks.records.get("documents/invoice-1")).toMatchObject({ title: "Comprobante sin descripción", amount: null, budgetLineIds: [] });
  });

  it("rejects a line outside the project's paid budget lines", async () => {
    const response = await patchDocument({ id: "invoice-1", budgetLineIds: ["other-project-line"] });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/no existe en este proyecto/);
  });
  it("prevents a gift invoice from also being assigned to a budget line", async () => {
    mocks.records.set("purchases/gift", { projectId: "project-1", outsideObjective: true, budgetLineId: null });
    expect((await patchDocument({ id: "invoice-1", purchaseId: "gift", budgetLineIds: ["architecture"] })).status).toBe(409);
    expect((await patchDocument({ id: "invoice-1", purchaseId: "gift", budgetLineIds: [] })).status).toBe(200);
  });

});

it("retains a receipt's existing currency when metadata edits omit it", async () => {
  currencyMock.value = "USD";
  mocks.records.set("documents/invoice-1", { projectId: "project-1", title: "USD invoice", currency: "USD" });
  expect((await patchDocument({ id: "invoice-1", title: "Updated invoice" })).status).toBe(200);
  expect(mocks.records.get("documents/invoice-1")?.currency).toBe("USD");
  mocks.records.set("documents/legacy", { projectId: "project-1", title: "Legacy CRC invoice" });
  expect((await patchDocument({ id: "legacy", title: "Preserved invoice" })).status).toBe(200);
  expect(mocks.records.get("documents/legacy")?.currency).toBe("CRC");
});
