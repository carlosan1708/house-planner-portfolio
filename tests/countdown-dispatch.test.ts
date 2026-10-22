import { beforeEach, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { dispatchDueNotificationJobs } from "@/lib/notification-service";
import { COUNTDOWNS, NOTIFICATION_JOBS, PROJECTS } from "@/lib/project";

const mock = vi.hoisted(() => ({ completed: true, sets: [] as Record<string, unknown>[], send: vi.fn(), eligible: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/gmail", () => ({ gmailConfiguration: () => ({ configured: true, sender: "test@example.test" }), sendGmailMessage: mock.send }));
vi.mock("@/lib/access-links", () => ({ resolveMembershipAccess: mock.eligible }));
vi.mock("@/lib/firebase-admin", () => ({ firestore: {
  collection: (name: string) => {
    const ref = { set: async (data: Record<string, unknown>) => { mock.sets.push(data); } };
    const job = { id: "task__due", ref, data: () => ({ countdownId: "task", projectId: "house", status: "pending", stage: "due", runAt: Timestamp.fromMillis(1) }) };
    return {
      doc: () => ({ get: async () => ({ exists: true, data: () => name === COUNTDOWNS ? { projectId: "house", completed: mock.completed, dueAt: Timestamp.fromMillis(1), recipientUids: ["tester"] } : name === PROJECTS ? { name: "Test house" } : {} }) }),
      get: async () => ({ docs: name === NOTIFICATION_JOBS ? [job] : [] }),
      where: () => { throw new Error("Completed countdown must not resolve recipients"); },
    };
  },
  runTransaction: async (callback: (transaction: unknown) => unknown) => callback({ get: async () => ({ data: () => ({ status: "pending" }) }), set: () => {} }),
} }));
beforeEach(() => { mock.sets = []; mock.send.mockReset(); mock.eligible.mockReset(); });
it("cancels a surviving pending email job for a completed task before resolving recipients or sending", async () => {
  expect(await dispatchDueNotificationJobs(100)).toEqual({ jobs: 1, delivered: 0, skipped: 0, failed: 0 });
  expect(mock.sets).toEqual([expect.objectContaining({ status: "cancelled" })]);
  expect(mock.eligible).not.toHaveBeenCalled(); expect(mock.send).not.toHaveBeenCalled();
});
