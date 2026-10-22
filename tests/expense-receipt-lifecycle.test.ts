import { beforeEach, describe, expect, it, vi } from "vitest";

type RecordData = Record<string, unknown>;
type Ref = { collection: string; id: string; get: () => Promise<Snapshot> };
type Snapshot = { id: string; ref: Ref; exists: boolean; data: () => RecordData | undefined };
type Transaction = { get: (target: { get: () => Promise<unknown> }) => Promise<unknown>; set: (ref: Ref, data: RecordData, options?: { merge?: boolean }) => void };

const mocks = vi.hoisted(() => {
  const records = new Map<string, RecordData>();
  const activities: RecordData[] = [];
  const writes: string[] = [];
  let sequence = 0;
  let serial = Promise.resolve();
  const hook = { beforeValidation: null as (() => void | Promise<void>) | null };
  function ref(collection: string, id: string): Ref {
    return { collection, id, get: async () => snapshot(collection, id) };
  }
  function snapshot(collection: string, id: string): Snapshot {
    // Firestore snapshots retain the version read before a concurrent mutation.
    const data = records.has(collection + "/" + id) ? structuredClone(records.get(collection + "/" + id)) : undefined;
    return { id, ref: ref(collection, id), exists: data !== undefined, data: () => data };
  }
  const collection = (name: string) => ({
    doc: (id?: string) => ref(name, id || "generated-" + ++sequence),
    where: (field: string, _operator: string, value: string) => ({ get: async () => ({ docs: [...records.entries()].flatMap(([key, data]) =>
      key.startsWith(name + "/") && data[field] === value ? [snapshot(name, key.slice(name.length + 1))] : []) }) }),
  });
  return {
    records, activities, writes, hook, collection,
    actor: vi.fn(), budgetPayload: vi.fn(), storageFile: vi.fn(), commitActivity: vi.fn(), ensureInvoiceFolder: vi.fn(),
    getAll: async (...refs: Ref[]) => Promise.all(refs.map((value) => value.get())),
    transact: (event: RecordData, mutate: (transaction: Transaction) => void, validate?: (transaction: Transaction) => Promise<void>) => {
      const result = serial.then(async () => {
        const pending: Array<{ ref: Ref; data: RecordData; merge: boolean }> = [];
        const transaction = {
          get: (target: { get: () => Promise<unknown> }) => target.get(),
          set: (reference: Ref, data: RecordData, options?: { merge?: boolean }) => pending.push({ ref: reference, data, merge: options?.merge === true }),
        };
        const before = hook.beforeValidation;
        hook.beforeValidation = null;
        await before?.();
        await validate?.(transaction);
        mutate(transaction);
        for (const write of pending) {
          const key = write.ref.collection + "/" + write.ref.id;
          records.set(key, write.merge ? { ...records.get(key), ...write.data } : write.data);
          writes.push(key);
        }
        activities.push(event);
        return { id: "activity-" + activities.length };
      });
      serial = result.then(() => undefined, () => undefined);
      return result;
    },
    reset: () => { records.clear(); activities.length = 0; writes.length = 0; sequence = 0; serial = Promise.resolve(); hook.beforeValidation = null; },
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
vi.mock("@/lib/firebase-admin", () => ({ firestore: { collection: mocks.collection, getAll: mocks.getAll }, projectBucket: { file: mocks.storageFile } }));
vi.mock("@/lib/workbook-store", () => ({ budgetPayload: mocks.budgetPayload }));
vi.mock("@/lib/folders", () => ({
  listProjectFolders: async () => [{ id: "invoice-folder", name: "Factura" }],
  findExpenseInvoiceFolder: (folders: Array<{ id: string; name: string }>) => folders.find((folder) => folder.name === "Factura"),
  ensureExpenseInvoiceFolder: mocks.ensureInvoiceFolder,
}));
vi.mock("@/lib/project", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/project")>(), DOCUMENTS: "media", EXPENSES: "expenses", EXPENSE_DOCUMENTS: "receipts", EXPENSE_PAYMENTS: "payments", EXPENSE_PAYMENT_STATUSES: "statuses", PURCHASES: "purchases", projectStoragePrefix: (projectId: string) => "projects/" + projectId }));
vi.mock("@/lib/activity", () => ({ commitActivity: mocks.commitActivity }));

import { legacyExpenseDocuments } from "@/lib/expense-api";
import { GET as getPayments, PATCH as patchPayment, POST as postPayment } from "@/app/api/expenses/payments/route";
import { DELETE as deleteLegacyFile } from "@/app/api/expenses/files/route";
import { POST as createReceipt, DELETE as deleteReceipt } from "@/app/api/expenses/documents/route";

const paymentRequest = (body: RecordData, method = "POST") => new Request("http://localhost/api/expenses/payments", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const deletion = (path: string) => new Request("http://localhost" + path, { method: "DELETE" });
const media = (id: string, overrides: RecordData = {}) => mocks.records.set("media/" + id, {
  projectId: "project-1", folderId: "invoice-folder", fileName: id + ".png", contentType: "image/png", source: "expenses", ...overrides,
});
const modernReceipt = () => {
  media("modern-file", { expenseDocumentId: "invoice", mediaRole: "financial_document" });
  mocks.records.set("receipts/invoice", { projectId: "project-1", title: "Factura vigente", documentType: "invoice", fileIds: ["modern-file"] });
};
const activePayments = () => [...mocks.records.entries()].filter(([key, data]) => key.startsWith("payments/") && !data.deletedAt);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reset();
  mocks.actor.mockResolvedValue({ projectId: "project-1", email: "owner@example.com", role: "admin" });
  mocks.budgetPayload.mockResolvedValue({ lines: [] });
  mocks.commitActivity.mockImplementation((_actor, event, mutate, validate) => mocks.transact(event, mutate, validate));
});

describe("independent receipt retention", () => {
  it("offers only active, unwrapped image/PDF invoices from the current project without writing or copying files", async () => {
    media("image");
    media("pdf", { contentType: "application/pdf", fileName: "factura.pdf" });
    media("foreign", { projectId: "project-2" });
    media("deleted", { deletedAt: "earlier" });
    media("other-folder", { folderId: "other" });
    media("wrapped", { expenseDocumentId: "receipt-id" });
    media("financial", { mediaRole: "financial_document" });
    media("product", { source: "expense_purchase" });
    media("spreadsheet", { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const before = structuredClone([...mocks.records.entries()]);
    const receipts = await legacyExpenseDocuments("project-1");
    expect(receipts.map((item) => item.id).sort()).toEqual(["legacy:image", "legacy:pdf"]);
    expect(receipts.find((item) => item.id === "legacy:pdf")).toMatchObject({ title: "factura.pdf", amount: null, budgetLineId: null, files: [{ id: "pdf", contentType: "application/pdf" }] });
    expect([...mocks.records.entries()]).toEqual(before);
    expect(mocks.storageFile).not.toHaveBeenCalled();
    expect(mocks.ensureInvoiceFolder).not.toHaveBeenCalled();
    expect(mocks.commitActivity).not.toHaveBeenCalled();
  });

  it("uses an existing invoice in an unassigned payment and retains its live title without creating a duplicate receipt", async () => {
    media("invoice-photo", { fileName: "Factura original.png" });
    const response = await postPayment(paymentRequest({ amount: 300, documentIds: ["legacy:invoice-photo"] }));
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(mocks.records.get("payments/" + created.id)).toMatchObject({ amount: 300, budgetLineId: null, documentIds: ["legacy:invoice-photo"], accountingMode: "ledger" });
    const payload = await (await getPayments()).json();
    expect(payload.payments).toEqual([expect.objectContaining({ id: created.id, documentTitle: "Factura original.png", documentIds: ["legacy:invoice-photo"], documents: [{ id: "legacy:invoice-photo", title: "Factura original.png", documentType: "receipt" }] })]);
    expect([...mocks.records.keys()].filter((key) => key.startsWith("receipts/"))).toEqual([]);
    expect([...mocks.records.keys()].filter((key) => key.startsWith("media/"))).toEqual(["media/invoice-photo"]);
    expect(mocks.storageFile).not.toHaveBeenCalled();
  });

  it("rejects deletion of a legacy invoice that backs an active payment", async () => {
    media("invoice-photo");
    mocks.records.set("payments/payment", { projectId: "project-1", amount: 300, documentIds: ["legacy:invoice-photo"] });
    const response = await deleteLegacyFile(deletion("/api/expenses/files?id=invoice-photo"));
    expect(response.status).toBe(409);
    expect(mocks.records.get("media/invoice-photo")?.deletedAt).toBeUndefined();
    expect(mocks.writes).toEqual([]);
  });

  it("rejects deletion of a modern receipt that backs an active payment", async () => {
    modernReceipt();
    mocks.records.set("payments/payment", { projectId: "project-1", amount: 300, documentIds: ["invoice"] });
    const response = await deleteReceipt(deletion("/api/expenses/documents?id=invoice"));
    expect(response.status).toBe(409);
    expect(mocks.records.get("receipts/invoice")?.deletedAt).toBeUndefined();
    expect(mocks.records.get("media/modern-file")?.deletedAt).toBeUndefined();
    expect(mocks.writes).toEqual([]);
  });

  it.each(["POST", "PATCH"])("%s rechecks receipt availability inside the transaction before writing a payment", async (method) => {
    modernReceipt();
    const previous = { projectId: "project-1", amount: 150, budgetLineId: null, documentIds: [], accountingMode: "ledger" };
    if (method === "PATCH") mocks.records.set("payments/existing", previous);
    mocks.hook.beforeValidation = () => { mocks.records.set("receipts/invoice", { ...mocks.records.get("receipts/invoice"), deletedAt: "concurrent deletion" }); };
    const request = paymentRequest({ ...(method === "PATCH" ? { id: "existing" } : {}), amount: 300, documentIds: ["invoice"] }, method);
    const response = await (method === "PATCH" ? patchPayment(request) : postPayment(request));
    expect(response.status).toBe(409);
    expect(mocks.writes).toEqual([]);
    expect(mocks.activities).toEqual([]);
    if (method === "PATCH") expect(mocks.records.get("payments/existing")).toEqual(previous);
    else expect(activePayments()).toEqual([]);
  });

  it("also rechecks the original file when a legacy invoice disappears before payment commit", async () => {
    media("invoice-photo");
    mocks.hook.beforeValidation = () => { mocks.records.set("media/invoice-photo", { ...mocks.records.get("media/invoice-photo"), deletedAt: "concurrent deletion" }); };
    const response = await postPayment(paymentRequest({ amount: 300, documentIds: ["legacy:invoice-photo"] }));
    expect(response.status).toBe(409);
    expect(activePayments()).toEqual([]);
    expect(mocks.writes).toEqual([]);
  });

  it.each(["modern", "legacy"])("keeps a %s receipt when another payment links it after the initial delete check", async (kind) => {
    if (kind === "modern") modernReceipt();
    else media("invoice-photo");
    const receiptId = kind === "modern" ? "invoice" : "legacy:invoice-photo";
    mocks.hook.beforeValidation = () => { mocks.records.set("payments/concurrent", { projectId: "project-1", amount: 300, documentIds: [receiptId] }); };
    const response = kind === "modern" ? await deleteReceipt(deletion("/api/expenses/documents?id=invoice")) : await deleteLegacyFile(deletion("/api/expenses/files?id=invoice-photo"));
    expect(response.status).toBe(409);
    expect(mocks.records.get(kind === "modern" ? "receipts/invoice" : "media/invoice-photo")?.deletedAt).toBeUndefined();
    expect(mocks.records.get("media/modern-file")?.deletedAt).toBeUndefined();
    expect(mocks.writes).toEqual([]);
    expect(mocks.activities).toEqual([]);
  });

  it("allows cleanup once the only linked payment has been deleted", async () => {
    media("invoice-photo");
    mocks.records.set("payments/deleted", { projectId: "project-1", amount: 300, documentIds: ["legacy:invoice-photo"], deletedAt: "earlier" });
    const response = await deleteLegacyFile(deletion("/api/expenses/files?id=invoice-photo"));
    expect(response.status).toBe(200);
    expect(mocks.records.get("media/invoice-photo")?.deletedAt).toBe("server-time");
  });

  it("commits one payment and activity when two concurrent requests carry the same mutation ID", async () => {
    modernReceipt();
    const body = { amount: 300, documentIds: ["invoice"], clientMutationId: "same-payment-retry" };
    const results = await Promise.all([postPayment(paymentRequest(body)), postPayment(paymentRequest(body))]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 201]);
    const bodies = await Promise.all(results.map((result) => result.json()));
    expect(new Set(bodies.map((result) => result.id)).size).toBe(1);
    expect(activePayments()).toHaveLength(1);
    expect(mocks.activities).toHaveLength(1);
    expect(mocks.activities[0].action).toBe("expense.payment_created");
  });

  it.each(["POST", "PATCH"])("%s rechecks outside-objective purchase classification before assigning its payment to the budget", async (method) => {
    mocks.budgetPayload.mockResolvedValue({ lines: [{ id: "line", item: "Materials", paid: 0 }] });
    mocks.records.set("purchases/materials", { projectId: "project-1", amount: 900, currency: "CRC", outsideObjective: false });
    if (method === "PATCH") mocks.records.set("payments/existing", { projectId: "project-1", amount: 150, purchaseId: "materials", budgetLineId: null, accountingMode: "ledger" });
    mocks.hook.beforeValidation = () => { mocks.records.set("purchases/materials", { ...mocks.records.get("purchases/materials"), outsideObjective: true }); };
    const response = await (method === "PATCH" ? patchPayment : postPayment)(paymentRequest({ ...(method === "PATCH" ? { id: "existing" } : {}), amount: 300, purchaseId: "materials", budgetLineId: "line" }, method));
    expect(response.status).toBe(409);
    expect(mocks.writes).toEqual([]);
    expect(mocks.activities).toEqual([]);
  });
});

it("defaults new receipts to project USD while retaining an explicit CRC choice", async () => {
  currencyMock.value = "USD";
  const form = new FormData(); form.set("title", "USD receipt");
  const first = await createReceipt(new Request("http://localhost/api/expenses/documents", { method: "POST", body: form }));
  expect(first.status).toBe(201);
  const firstId = (await first.json()).id;
  expect(mocks.records.get(`receipts/${firstId}`)?.currency).toBe("USD");
  const chosen = new FormData(); chosen.set("title", "CRC receipt"); chosen.set("currency", "CRC");
  const second = await createReceipt(new Request("http://localhost/api/expenses/documents", { method: "POST", body: chosen }));
  expect(second.status).toBe(201);
  const secondId = (await second.json()).id;
  expect(mocks.records.get(`receipts/${secondId}`)?.currency).toBe("CRC");
  expect(currencyMock.lock).toHaveBeenCalledWith("project-1");
});
