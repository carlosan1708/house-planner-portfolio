import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ record: vi.fn(), transaction: vi.fn(), committed: false }));
vi.mock("@/lib/usage-store", () => ({ recordUsageAction: mock.record }));
vi.mock("@/lib/firebase-admin", () => ({
  firestore: {
    collection: () => ({ doc: (id = "event-id") => ({ id, collection: () => ({ doc: () => ({ id: "event-id" }) }) }) }),
    runTransaction: mock.transaction,
  },
}));

import { activityUsageAction, completedUsageAction, recordActivityUsage } from "@/lib/usage-actions";
import { commitActivity } from "@/lib/activity";

const actor = { uid: "user-id", email: "owner@example.test", projectId: "project-id", name: "Owner", role: "admin" as const };

beforeEach(() => {
  mock.record.mockReset(); mock.record.mockResolvedValue(undefined);
  mock.transaction.mockReset(); mock.committed = false;
  mock.transaction.mockImplementation(async (callback: (transaction: unknown) => Promise<unknown>) => {
    const result = await callback({ get: async () => ({ data: () => ({ sequence: 2, hash: "previous" }) }), set: vi.fn() });
    mock.committed = true;
    return result;
  });
});

describe("completed business usage", () => {
  it("maps completed operations to stable metadata actions", () => {
    expect(activityUsageAction("expense.created")).toBe("record.create");
    expect(activityUsageAction("aesthetic.image_uploaded")).toBe("file.upload");
    expect(activityUsageAction("budget.published", "assistant")).toBe("budget.publish");
    expect(activityUsageAction("budget.approved")).toBe("approval.approve");
    expect(activityUsageAction("decision.deleted")).toBe("record.delete");
    expect(activityUsageAction("access.member_removed")).toBe("record.delete");
    expect(activityUsageAction("site.mobile_capture_added")).toBe("file.upload");
  });

  it("covers the current purchase, document and payment actions", () => {
    for (const resource of ["purchase", "document", "payment"]) {
      expect(activityUsageAction(`expense.${resource}_created`)).toBe("record.create");
      expect(activityUsageAction(`expense.${resource}_updated`)).toBe("record.update");
      expect(activityUsageAction(`expense.${resource}_deleted`)).toBe("record.delete");
    }
    expect(activityUsageAction("expense.payment_status_updated")).toBe("record.update");
    expect(activityUsageAction("expense.purchase_photo_added")).toBe("file.upload");
    expect(activityUsageAction("expense.document_files_added")).toBe("file.upload");
    expect(activityUsageAction("expense.purchase_photo_deleted")).toBe("record.delete");
    expect(activityUsageAction("expense.document_file_deleted")).toBe("record.delete");
  });

  it("rejects unknown and system activity, including object prototype keys", async () => {
    for (const action of ["qa.reset", "unknown", "constructor", "__proto__"]) expect(activityUsageAction(action)).toBeNull();
    expect(activityUsageAction("expense.created", "system")).toBeNull();
    await recordActivityUsage(actor, { action: "expense.created", source: "system", target: { section: "expenses" } }, "event-id");
    expect(mock.record).not.toHaveBeenCalled();
  });

  it("forwards only action, section and operation ID from activity", async () => {
    const input = { action: "expense.created", target: { section: "expenses" as const, label: "Private expense" }, changes: [{ before: 123, after: 456 }], summaryParams: { secret: "private" } };
    await recordActivityUsage(actor, input, "event-id");
    expect(mock.record).toHaveBeenCalledExactlyOnceWith(actor, "record.create", "expenses", "event-id");
  });

  it("records after transaction success and keeps the committed result on analytics failure", async () => {
    mock.record.mockImplementation(async () => { expect(mock.committed).toBe(true); throw new Error("analytics unavailable"); });
    const mutate = vi.fn();
    const event = await commitActivity(actor, { category: "expense", action: "expense.created", target: { type: "expense", id: "expense-id", label: "Private expense", section: "expenses" } }, mutate);
    expect(event.id).toBe("event-id");
    expect(mutate).toHaveBeenCalledOnce();
    expect(mock.record).toHaveBeenCalledExactlyOnceWith(actor, "record.create", "expenses", event.id);
  });

  it("never records a rejected business transaction", async () => {
    mock.transaction.mockRejectedValueOnce(new Error("business conflict"));
    await expect(commitActivity(actor, { category: "expense", action: "expense.created", target: { type: "expense", id: "id", label: "Expense", section: "expenses" } }, vi.fn())).rejects.toThrow("business conflict");
    expect(mock.record).not.toHaveBeenCalled();
  });

  it("records once when Firestore retries the business callback", async () => {
    mock.transaction.mockImplementationOnce(async (callback: (transaction: unknown) => Promise<unknown>) => {
      const transaction = { get: async () => ({ data: () => ({ sequence: 2, hash: "previous" }) }), set: vi.fn() };
      await callback(transaction);
      const result = await callback(transaction);
      mock.committed = true;
      return result;
    });
    const mutate = vi.fn();
    await commitActivity(actor, { category: "expense", action: "expense.created", target: { type: "expense", id: "id", label: "Expense", section: "expenses" } }, mutate);
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(mock.record).toHaveBeenCalledOnce();
  });

  it("isolates analytics errors for direct operations too", async () => {
    mock.record.mockRejectedValueOnce(new Error("analytics unavailable"));
    await expect(completedUsageAction(actor, "assistant.message", "overview", "message-id")).resolves.toBeUndefined();
  });
});
