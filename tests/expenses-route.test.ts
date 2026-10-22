import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const records = new Map<string, Record<string, unknown>>();
  let sequence = 0;
  const ref = (collection: string, id?: string) => {
    const key = id || `generated-${++sequence}`;
    return {
      id: key,
      collection,
      get: async () => ({ id: key, exists: records.has(`${collection}/${key}`), data: () => records.get(`${collection}/${key}`) }),
    };
  };
  return {
    records,
    ref,
    actor: vi.fn(),
    budgetPayload: vi.fn(),
    getExpenseAttachmentLinks: vi.fn(),
    commitActivity: vi.fn(),
    reset: () => { records.clear(); sequence = 0; },
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

vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "server-timestamp" } }));
vi.mock("@/lib/auth", () => ({ requireApproved: mocks.actor, requireTabAccess: mocks.actor }));
vi.mock("@/lib/firebase-admin", () => ({
  firestore: {
    collection: (name: string) => ({ doc: (id?: string) => mocks.ref(name, id) }),
    getAll: async (...refs: Array<{ get: () => Promise<unknown> }>) => Promise.all(refs.map((ref) => ref.get())),
  },
}));
vi.mock("@/lib/workbook-store", () => ({
  budgetPayload: mocks.budgetPayload,
  getExpenseAttachmentLinks: mocks.getExpenseAttachmentLinks,
}));
vi.mock("@/lib/folders", () => ({
  listProjectFolders: async () => [{ id: "invoice-folder", name: "Factura" }],
  findExpenseInvoiceFolder: () => ({ id: "invoice-folder", name: "Factura" }),
}));
vi.mock("@/lib/project", () => ({ DOCUMENTS: "documents", EXPENSES: "expenses" }));
vi.mock("@/lib/activity", () => ({ commitActivity: mocks.commitActivity }));

import { DELETE, GET, PATCH, POST } from "@/app/api/expenses/route";

const request = (method: string, body: Record<string, unknown>) => new Request("http://localhost/api/expenses", {
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reset();
  mocks.actor.mockResolvedValue({ projectId: "project-1", email: "owner@example.com", role: "admin" });
  mocks.budgetPayload.mockResolvedValue({ lines: [
    { id: "line-1", chapter: "Structure", item: "Concrete", type: "Work", subcategory: "Foundation", paid: 100, supplier: "Builder" },
    { id: "line-2", chapter: "Finishes", item: "Tile", type: "Material", subcategory: "Interior", paid: 0, supplier: "Tile Co" },
  ] });
  mocks.getExpenseAttachmentLinks.mockImplementation(async () => [...mocks.records.entries()]
    .filter(([key, data]) => key.startsWith("expenses/") && data.kind === "workbook_receipt_link")
    .map(([key, data]) => ({
      id: key.slice("expenses/".length),
      budgetLineId: String(data.budgetLineId || ""),
      documentId: String(data.receiptDocumentId || ""),
      createdAt: "2026-09-22T12:00:00.000Z",
      deletedAt: data.deletedAt ? String(data.deletedAt) : undefined,
    })));
  mocks.commitActivity.mockImplementation(async (_actor, _event, write) => write({
    set: (ref: { collection: string; id: string }, data: Record<string, unknown>, options?: { merge?: boolean }) => {
      const key = `${ref.collection}/${ref.id}`;
      mocks.records.set(key, options?.merge ? { ...mocks.records.get(key), ...data } : data);
    },
  }));
  mocks.records.set("documents/photo-1", { projectId: "project-1", folderId: "invoice-folder", fileName: "receipt.jpg", contentType: "image/jpeg" });
  mocks.records.set("documents/pdf-1", { projectId: "project-1", folderId: "invoice-folder", fileName: "invoice.pdf", contentType: "application/pdf" });
});

describe("budget-line expense attachments", () => {
  it("keeps one workbook expense and attaches multiple independent files", async () => {
    const first = await POST(request("POST", { budgetLineId: "line-1", receiptDocumentId: "photo-1" }));
    const second = await POST(request("POST", { budgetLineId: "line-1", receiptDocumentId: "pdf-1" }));
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const payload = await (await GET()).json();
    expect(mocks.budgetPayload).toHaveBeenCalledWith("project-1", { skipGoogleSync: true });
    expect(payload.expenses).toHaveLength(1);
    expect(payload.expenses[0]).toMatchObject({ id: "line-1", amount: 100, source: "workbook" });
    expect(payload.expenses[0].attachments.map((item: { documentId: string }) => item.documentId).sort()).toEqual(["pdf-1", "photo-1"]);
    expect(payload.summary.total).toBe(100);

    const duplicate = await POST(request("POST", { budgetLineId: "line-1", receiptDocumentId: "photo-1" }));
    expect(duplicate.status).toBe(200);
    expect((await duplicate.json()).duplicate).toBe(true);
  });

  it("rejects transaction amounts and unlinks only the selected file", async () => {
    expect((await POST(request("POST", { budgetLineId: "line-1", amount: 500 }))).status).toBe(400);
    expect((await PATCH(request("PATCH", { id: "anything", amount: 500 }))).status).toBe(400);

    const first = await POST(request("POST", { budgetLineId: "line-1", receiptDocumentId: "photo-1" }));
    await POST(request("POST", { budgetLineId: "line-1", receiptDocumentId: "pdf-1" }));
    const firstId = (await first.json()).id;
    const deletion = await DELETE(new Request(`http://localhost/api/expenses?id=${encodeURIComponent(firstId)}`, { method: "DELETE" }));
    expect(deletion.status).toBe(200);
    expect((await deletion.json()).documentPreserved).toBe(true);
    expect(mocks.records.has("documents/photo-1")).toBe(true);

    const payload = await (await GET()).json();
    expect(payload.expenses).toHaveLength(1);
    expect(payload.expenses[0].amount).toBe(100);
    expect(payload.expenses[0].attachments.map((item: { documentId: string }) => item.documentId)).toEqual(["pdf-1"]);
  });
});

it("returns project USD and binds receipt snapshots and audit values to it without conversion", async () => {
  currencyMock.value = "USD";
  mocks.budgetPayload.mockResolvedValue({ currency: "USD", lines: [{ id: "line-1", chapter: "Structure", item: "Concrete", type: "Work", subcategory: "Foundation", paid: 100.25, supplier: "Builder" }] });
  const response = await POST(request("POST", { budgetLineId: "line-1", receiptDocumentId: "photo-1" }));
  expect(response.status).toBe(201);
  const id = (await response.json()).id;
  expect(mocks.records.get(`expenses/${id}`)).toMatchObject({ currency: "USD", amountSnapshot: 100.25 });
  expect(mocks.commitActivity.mock.calls[0][1].changes[1].format).toBe("currency_usd");
  expect(await GET().then((result) => result.json())).toMatchObject({ currency: "USD", summary: { total: 100.25 } });
});
