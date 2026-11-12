import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const records = new Map<string, Record<string, unknown>>();
  let sequence = 0;
  const ref = (id = `new-${++sequence}`) => ({ id, get: async () => ({ exists: records.has(id), data: () => records.get(id) }) });
  return { records, ref, actor: vi.fn(), commit: vi.fn(), beforeValidation: null as (() => void) | null };
});
vi.mock("@/lib/auth", () => ({ requireTabAccess: mocks.actor }));
vi.mock("@/lib/project", () => ({ EXPENSES: "expenses" }));
vi.mock("@/lib/project-currency", () => ({ readProjectCurrency: async () => "USD" }));
vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "server-time" } }));
vi.mock("@/lib/firebase-admin", () => ({ firestore: { collection: (name: string) => {
  if (name !== "expenses") throw new Error("Reminders must not access payment or budget storage");
  return { doc: mocks.ref, where: () => ({ get: async () => ({ docs: [...mocks.records].map(([id, data]) => ({ id, data: () => data })) }) }) };
} } }));
vi.mock("@/lib/activity", () => ({ commitActivity: mocks.commit }));
import { DELETE, GET, PATCH, POST } from "@/app/api/expenses/reminders/route";

const request = (method: string, body: unknown) => new Request("http://localhost/api/expenses/reminders", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const entry = { projectId: "house", kind: "transaction", description: "Cable de prueba", amount: 300, budgetLineId: "old-line", paymentDate: "2026-11-07", deletedAt: null };
beforeEach(() => {
  vi.clearAllMocks(); mocks.records.clear(); mocks.beforeValidation = null;
  mocks.actor.mockResolvedValue({ projectId: "house", uid: "owner", name: "Owner", email: "owner@example.test", role: "admin" });
  mocks.records.set("legacy", { ...entry });
  mocks.commit.mockImplementation(async (_actor, _event, write, validate) => {
    mocks.beforeValidation?.();
    const transaction = { get: (ref: ReturnType<typeof mocks.ref>) => ref.get(), set: (ref: ReturnType<typeof mocks.ref>, data: Record<string, unknown>, options?: { merge?: boolean }) => mocks.records.set(ref.id, options?.merge ? { ...mocks.records.get(ref.id), ...data } : data) };
    await validate?.(transaction); write(transaction);
  });
});

describe("independent payment reminders", () => {
  it("recovers active old entries without relabeling their currency, linking budgets or writing records", async () => {
    mocks.records.set("foreign", { ...entry, projectId: "other" });
    mocks.records.set("deleted", { ...entry, deletedAt: "yesterday" });
    mocks.records.set("receipt", { ...entry, kind: "workbook_receipt_link" });
    mocks.records.set("void", { ...entry, status: "void" });
    const payload = await GET().then((response) => response.json());
    expect(payload.defaultCurrency).toBe("USD");
    expect(payload.reminders).toEqual([{ id: "legacy", description: entry.description, amount: 300, currency: "CRC", dueDate: "", vendor: "", notes: "", status: "pending", revision: 0 }]);
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.records.get("legacy")).toEqual(entry);
  });
  it("creates a reminder without accepting financial or budget fields", async () => {
    const response = await POST(request("POST", { description: " Recordatorio ", amount: 2.35, currency: "USD", budgetLineId: "another-line", paid: 999, kind: "transaction" }));
    expect(response.status).toBe(201);
    const { id } = await response.json(), record = mocks.records.get(id)!;
    expect(record).toMatchObject({ projectId: "house", kind: "payment_reminder", description: "Recordatorio", amount: 2.35, currency: "USD", reminderStatus: "pending", reminderRevision: 1 });
    expect(record).not.toHaveProperty("paid"); expect(record).not.toHaveProperty("budgetLineId");
  });
  it("edits and resolves the same old record while preserving its original references", async () => {
    expect((await PATCH(request("PATCH", { id: "legacy", revision: 0, description: "Revisar suministro", amount: null, currency: "CRC", dueDate: "2026-12-02", budgetLineId: "replacement" }))).status).toBe(200);
    expect((await PATCH(request("PATCH", { id: "legacy", revision: 1, action: "status", status: "done" }))).status).toBe(200);
    expect(mocks.records.get("legacy")).toMatchObject({ kind: "transaction", budgetLineId: "old-line", reminderRevision: 2, reminderStatus: "done", amount: null, paymentDate: entry.paymentDate });
    expect((await PATCH(request("PATCH", { id: "legacy", revision: 2, action: "status", status: "pending" }))).status).toBe(200);
    expect(mocks.records.get("legacy")?.reminderStatus).toBe("pending");
  });
  it("soft deletes a reminder without deleting or changing its other data", async () => {
    expect((await DELETE(request("DELETE", { id: "legacy", revision: 0 }))).status).toBe(200);
    expect(mocks.records.get("legacy")).toMatchObject({ ...entry, deletedAt: "server-time", reminderRevision: 1 });
    expect((await GET().then((response) => response.json())).reminders).toEqual([]);
  });
  it("rejects cross-project IDs and receipt links before writing", async () => {
    mocks.records.set("foreign", { ...entry, projectId: "other" });
    mocks.records.set("link", { ...entry, kind: "workbook_receipt_link" });
    for (const id of ["foreign", "link", "missing"])
      expect((await PATCH(request("PATCH", { id, revision: 0, action: "status", status: "done" }))).status).toBe(404);
    expect(mocks.commit).not.toHaveBeenCalled();
  });
  it("rejects stale revisions and a concurrent update during transaction validation", async () => {
    expect((await PATCH(request("PATCH", { id: "legacy", revision: 8, action: "status", status: "done" }))).status).toBe(409);
    mocks.beforeValidation = () => mocks.records.set("legacy", { ...entry, reminderRevision: 1 });
    expect((await DELETE(request("DELETE", { id: "legacy", revision: 0 }))).status).toBe(409);
    expect(mocks.records.get("legacy")?.deletedAt).toBeNull();
  });
  it("requires expenses read access and editor access for every mutation", async () => {
    mocks.actor.mockResolvedValue(null);
    expect((await GET()).status).toBe(403);
    for (const [method, handler] of [["POST", POST], ["PATCH", PATCH], ["DELETE", DELETE]] as const) {
      expect((await handler(request(method, { id: "legacy", revision: 0 }))).status).toBe(403);
      expect(mocks.actor).toHaveBeenLastCalledWith("expenses", ["admin", "editor"]);
    }
    expect(mocks.commit).not.toHaveBeenCalled();
  });
  it("rejects malformed requests, invalid amounts, currencies, and dates", async () => {
    for (const body of [null, [], {}, { description: "x", currency: "EUR" }, { description: "x", currency: "CRC", amount: -1 }, { description: "x", currency: "CRC", dueDate: "2026-02-31" }])
      expect((await POST(request("POST", body))).status).toBe(400);
    expect((await PATCH(request("PATCH", { id: "a/b", revision: 0 }))).status).toBe(400);
    expect(mocks.commit).not.toHaveBeenCalled();
  });
});
