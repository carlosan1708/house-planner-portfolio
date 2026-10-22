import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => {
  const records = new Map<string, Record<string, unknown>>();
  const hook = { beforeValidation: null as (() => void) | null };
  const snap = (collection: string, id: string) => {
    const data = structuredClone(records.get(`${collection}/${id}`));
    return { id, exists: data !== undefined, data: () => data, ref: { collection, id } };
  };
  return { records, hook, actor: vi.fn(), commit: vi.fn(), collection: (collection: string) => ({
    doc: (id = "gift") => ({ id, collection, get: async () => snap(collection, id) }),
    where: (_field: string, _op: string, projectId: string) => ({ get: async () => ({ docs: [...records.entries()].filter(([key, data]) => key.startsWith(`${collection}/`) && data.projectId === projectId).map(([key]) => snap(collection, key.split("/")[1])) }) }),
  }) };
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

vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "time" } }));
vi.mock("@/lib/auth", () => ({ requireTabAccess: mocks.actor }));
vi.mock("@/lib/activity", () => ({ commitActivity: mocks.commit }));
vi.mock("@/lib/firebase-admin", () => ({ firestore: { collection: mocks.collection } }));
vi.mock("@/lib/project", () => ({ DOCUMENTS: "media", PURCHASES: "purchases", EXPENSE_DOCUMENTS: "documents", EXPENSE_PAYMENTS: "payments" }));
vi.mock("@/lib/expense-api", () => ({ expenseIso: () => "", mediaJson: vi.fn(), projectMedia: async () => [], validateExpenseBudgetLine: async (_project: string, id: string) => id === "line" ? { label: "Concrete" } : null }));
import { GET, POST, PATCH, DELETE } from "@/app/api/expenses/purchases/route";
const request = (body: Record<string, unknown>) => new Request("http://localhost/api/expenses/purchases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.records.clear(); mocks.hook.beforeValidation = null; mocks.actor.mockResolvedValue({ projectId: "project", email: "qa@example.com" });
  mocks.commit.mockImplementation(async (_actor, _event, write, validate) => {
    const transaction = { get: (target: { get: () => Promise<unknown> }) => target.get(), set: (ref: { collection: string; id: string }, data: Record<string, unknown>) => { const key = `${ref.collection}/${ref.id}`; mocks.records.set(key, { ...mocks.records.get(key), ...data }); } };
    const before = mocks.hook.beforeValidation;
    mocks.hook.beforeValidation = null;
    before?.();
    await validate?.(transaction);
    write(transaction);
  });
});
it("round-trips explicit gifts without converting old unassigned purchases", async () => {
  expect((await POST(request({ title: "Gift", outsideObjective: true, budgetLineId: null, amount: 90 }))).status).toBe(201);
  expect((await GET()).status).toBe(200);
  expect((await (await GET()).json()).purchases[0]).toMatchObject({ outsideObjective: true, budgetLineId: null, amount: 90 });
  expect((await PATCH(request({ id: "gift", amount: 100 }))).status).toBe(200);
  expect(mocks.records.get("purchases/gift")?.outsideObjective).toBe(true);
  expect((await PATCH(request({ id: "gift", outsideObjective: false, budgetLineId: "line" }))).status).toBe(200);
  expect(mocks.records.get("purchases/gift")).toMatchObject({ outsideObjective: false, budgetLineId: "line" });
  mocks.records.set("purchases/pending", { projectId: "project", budgetLineId: null, amount: 10 });
  expect((await (await GET()).json()).purchases.find((p: { id: string }) => p.id === "pending").outsideObjective).toBe(false);
  expect((await DELETE(new Request("http://localhost/api/expenses/purchases?id=gift"))).status).toBe(200);
  expect((await (await GET()).json()).purchases).toHaveLength(1);
});
it("rejects contradictory classification and linked invoices assigned to budget", async () => {
  expect((await POST(request({ outsideObjective: "true" }))).status).toBe(400);
  expect((await POST(request({ outsideObjective: true, budgetLineId: "line" }))).status).toBe(400);
  await POST(request({ outsideObjective: false, budgetLineId: "line" }));
  mocks.records.set("documents/invoice", { projectId: "project", purchaseId: "gift", budgetLineIds: ["line"] });
  expect((await PATCH(request({ id: "gift", outsideObjective: true, budgetLineId: null }))).status).toBe(409);
});

const purchaseWithPayment = (payment: Record<string, unknown> = {}) => {
  mocks.records.set("purchases/gift", { projectId: "project", title: "Materials", amount: 900, currency: "CRC", outsideObjective: false });
  mocks.records.set("payments/first", { projectId: "project", purchaseId: "gift", amount: 300, accountingMode: "ledger", ...payment });
};

it("prevents classifying a purchase outside objective while its payment remains in the budget", async () => {
  purchaseWithPayment({ budgetLineId: "line" });
  expect((await PATCH(request({ id: "gift", title: "Materials", amount: 900, outsideObjective: true }))).status).toBe(409);
  expect(mocks.records.get("purchases/gift")?.outsideObjective).toBe(false);
  expect(mocks.records.get("payments/first")?.budgetLineId).toBe("line");
});

it("permits outside-objective classification with only unassigned payments", async () => {
  purchaseWithPayment({ budgetLineId: null });
  expect((await PATCH(request({ id: "gift", amount: 900, outsideObjective: true }))).status).toBe(200);
  expect(mocks.records.get("purchases/gift")?.outsideObjective).toBe(true);
});

it("checks new payments inside the transaction before changing purchase classification", async () => {
  mocks.records.set("purchases/gift", { projectId: "project", amount: 900, currency: "CRC" });
  mocks.hook.beforeValidation = () => { mocks.records.set("payments/concurrent", { projectId: "project", purchaseId: "gift", amount: 300, budgetLineId: "line", accountingMode: "ledger" }); };
  expect((await PATCH(request({ id: "gift", amount: 900, outsideObjective: true }))).status).toBe(409);
  expect(mocks.records.get("purchases/gift")?.outsideObjective).toBeUndefined();
});

it("prevents changing the currency while payments remain active", async () => {
  purchaseWithPayment();
  expect((await PATCH(request({ id: "gift", amount: 900, currency: "USD" }))).status).toBe(409);
  expect(mocks.records.get("purchases/gift")?.currency).toBe("CRC");
});

it("keeps the agreed total at or above active ledger payments", async () => {
  purchaseWithPayment();
  expect((await PATCH(request({ id: "gift", amount: 299.99 }))).status).toBe(409);
  expect((await PATCH(request({ id: "gift", amount: null }))).status).toBe(409);
  expect((await PATCH(request({ id: "gift", amount: 300 }))).status).toBe(200);
  expect((await PATCH(request({ id: "gift", amount: 950 }))).status).toBe(200);
});

it("rechecks the ledger sum when a payment arrives before the purchase update commits", async () => {
  purchaseWithPayment();
  mocks.hook.beforeValidation = () => { mocks.records.set("payments/concurrent", { projectId: "project", purchaseId: "gift", amount: 400, accountingMode: "ledger" }); };
  expect((await PATCH(request({ id: "gift", amount: 500 }))).status).toBe(409);
  expect(mocks.records.get("purchases/gift")?.amount).toBe(900);
});

it("ignores deleted and foreign payments and does not add historical details to the ledger minimum", async () => {
  purchaseWithPayment({ accountingMode: "historical-detail", amount: 800 });
  mocks.records.set("payments/deleted", { projectId: "project", purchaseId: "gift", amount: 500, accountingMode: "ledger", deletedAt: "earlier" });
  mocks.records.set("payments/foreign", { projectId: "other", purchaseId: "gift", amount: 500, accountingMode: "ledger" });
  expect((await PATCH(request({ id: "gift", amount: 100 }))).status).toBe(200);
});

it("retains an unknown purchase total while recording partial payments", async () => {
  purchaseWithPayment();
  mocks.records.set("purchases/gift", { ...mocks.records.get("purchases/gift"), amount: null });
  expect((await PATCH(request({ id: "gift", title: "Updated title", amount: null }))).status).toBe(200);
});

it("defaults new purchases to project USD while preserving explicit and edited currencies", async () => {
  currencyMock.value = "USD";
  expect((await POST(request({ title: "USD default", amount: 395 }))).status).toBe(201);
  expect(mocks.records.get("purchases/gift")?.currency).toBe("USD");
  expect((await PATCH(request({ id: "gift", title: "Updated", amount: 400 }))).status).toBe(200);
  expect(mocks.records.get("purchases/gift")?.currency).toBe("USD");
  expect((await POST(request({ title: "CRC choice", currency: "CRC", amount: 1000 }))).status).toBe(201);
  expect(mocks.records.get("purchases/gift")?.currency).toBe("CRC");
  expect((await PATCH(request({ id: "gift", title: "Retained CRC", amount: 1100 }))).status).toBe(200);
  expect(mocks.records.get("purchases/gift")?.currency).toBe("CRC");
});
