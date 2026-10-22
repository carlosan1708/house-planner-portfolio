import { beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { GET, PATCH } from "@/app/api/countdowns/route";
import { COUNTDOWNS, NOTIFICATION_JOBS, DEFAULT_MEMBER_PERMISSIONS, type MemberRecord } from "@/lib/project";

const mock = vi.hoisted(() => ({ actor: null as MemberRecord | null, data: new Map<string, Record<string, unknown>>(), events: [] as { action: string }[], fail: false, reads: 0 }));
vi.mock("@/lib/auth", () => ({ requireTabAccess: async () => mock.actor }));
vi.mock("@/lib/project-authors", () => ({ loadProjectAuthorDisplay: async () => ({ redact: (data: unknown) => data }) }));
vi.mock("@/lib/notification-service", () => ({ cancelCountdownNotificationJobs: vi.fn(), scheduleCountdownNotificationJobs: vi.fn(), validateRecipientUids: vi.fn() }));
vi.mock("@/lib/firebase-admin", () => ({ firestore: { collection: (name: string) => ({
  doc: (id: string) => ({ path: `${name}/${id}`, get: async () => { mock.reads++; return { id, exists: mock.data.has(`${name}/${id}`), data: () => mock.data.get(`${name}/${id}`) }; } }),
  where: (_field: string, _op: string, project: string) => ({ get: async () => ({ docs: [...mock.data].filter(([key, data]) => key.startsWith(`${name}/`) && data.projectId === project).map(([key, data]) => ({ id: key.split("/")[1], data: () => data })) }) }),
}) } }));
vi.mock("@/lib/activity", () => ({ commitActivity: async (_actor: unknown, event: { action: string }, mutate: (transaction: unknown) => void) => {
  const writes: (() => void)[] = [];
  const set = (ref: { path: string }, data: Record<string, unknown>) => writes.push(() => mock.data.set(ref.path, { ...mock.data.get(ref.path), ...data, ...(data.completedAt ? { completedAt: Timestamp.fromMillis(Date.parse("2026-10-14T12:00:00Z")) } : {}) }));
  mutate({ update: set, set });
  if (mock.fail) throw new Error("transaction failed");
  writes.forEach(write => write()); mock.events.push(event);
} }));
const taskKey = `${COUNTDOWNS}/task`;
const request = () => new Request("http://localhost/api/countdowns", { method: "PATCH", body: JSON.stringify({ id: "task", action: "complete" }) });
beforeEach(() => {
  mock.data.clear(); mock.events = []; mock.fail = false; mock.reads = 0;
  mock.actor = { uid: "tester", email: "tester@example.test", name: "Tester", role: "editor", projectId: "house", projectName: "Test", isPersonal: false, status: "approved", permissions: DEFAULT_MEMBER_PERMISSIONS, folderAccess: { mode: "all", folderIds: [], allowUnfiled: true } };
  mock.data.set(taskKey, { projectId: "house", title: "Inspection", durationDays: 10, startedAt: Timestamp.fromMillis(1), dueAt: Timestamp.fromMillis(864000001), createdBy: "creator@example.test", recipientUids: ["tester"], acknowledgedByUids: [] });
  for (const stage of ["pre_due", "due"]) mock.data.set(`${NOTIFICATION_JOBS}/task__${stage}`, { status: "pending" });
});
describe("countdown completion", () => {
  for (const role of ["admin", "editor"] as const) it(`lets ${role} complete without deleting or changing deadline/recipients`, async () => {
    mock.actor!.role = role;
    const before = { ...mock.data.get(taskKey) };
    expect((await PATCH(request())).status).toBe(200);
    expect(mock.data.get(taskKey)).toMatchObject({ ...before, completed: true, completedByUid: "tester" });
    for (const stage of ["pre_due", "due"]) expect(mock.data.get(`${NOTIFICATION_JOBS}/task__${stage}`)?.status).toBe("cancelled");
    expect(mock.events).toEqual([expect.objectContaining({ action: "countdown.completed" })]);
    expect(await (await GET()).json()).toMatchObject({ countdowns: [{ title: "Inspection", completed: true, completedAt: "2026-10-14T12:00:00.000Z" }] });
    expect((await PATCH(request())).status).toBe(200);
    expect(mock.events).toHaveLength(1);
  });
  it("reads existing tasks as active without migration", async () => {
    expect(await (await GET()).json()).toMatchObject({ countdowns: [{ completed: false, completedAt: null }] });
  });
  it("rejects viewers, read links and missing access before reading task data", async () => {
    const actor = mock.actor!;
    for (const denied of [{ ...actor, role: "viewer" as const }, { ...actor, accessLinkId: "read-link" }, null]) {
      mock.actor = denied;
      expect((await PATCH(request())).status).toBe(403);
    }
    expect(mock.reads).toBe(0); expect(mock.events).toHaveLength(0);
  });
  it("does not mutate another project's task or a missing task", async () => {
    mock.data.get(taskKey)!.projectId = "other";
    expect((await PATCH(request())).status).toBe(404);
    mock.data.delete(taskKey);
    expect((await PATCH(request())).status).toBe(404);
    expect(mock.events).toHaveLength(0);
    expect(mock.data.get(`${NOTIFICATION_JOBS}/task__due`)?.status).toBe("pending");
  });
  it("rolls back completion and job cancellation together when the audit transaction fails", async () => {
    mock.fail = true;
    await expect(PATCH(request())).rejects.toThrow("transaction failed");
    expect(mock.data.get(taskKey)?.completed).toBeUndefined();
    expect(mock.data.get(`${NOTIFICATION_JOBS}/task__due`)?.status).toBe("pending");
    expect(mock.events).toHaveLength(0);
  });
});
