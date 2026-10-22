import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as sendQuoteMessage } from "@/app/api/quotes/chat/route";
import { GET as readCountdowns, PATCH as updateCountdown } from "@/app/api/countdowns/route";
import { DEFAULT_MEMBER_PERMISSIONS, type MemberRecord } from "@/lib/project";

const mock = vi.hoisted(() => ({ actor: null as MemberRecord | null, collection: vi.fn(), update: vi.fn(), answer: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireTabAccess: async () => mock.actor }));
vi.mock("@/lib/firebase-admin", () => ({ firestore: { collection: mock.collection }, projectBucket: {} }));
vi.mock("@/lib/quote-analysis", () => ({ answerQuoteQuestion: mock.answer }));
vi.mock("@/lib/quote-context", () => ({ loadReferenceInputs: vi.fn(), loadStoredQuoteInputs: vi.fn(), quoteBudgetContext: vi.fn() }));
vi.mock("@/lib/notification-service", () => ({ cancelCountdownNotificationJobs: vi.fn(), scheduleCountdownNotificationJobs: vi.fn(), validateRecipientUids: vi.fn() }));
vi.mock("@/lib/activity", () => ({ commitActivity: async (_actor: unknown, _event: unknown, mutate: (transaction: unknown) => void) => mutate({ update: mock.update }) }));

const viewer: MemberRecord = { uid: "reader", name: "Reader", email: "reader@example.com", projectId: "shared", projectName: "Shared", isPersonal: false, role: "viewer", status: "approved", permissions: DEFAULT_MEMBER_PERMISSIONS, folderAccess: { mode: "all", folderIds: [], allowUnfiled: true } };
const request = (body: unknown) => new Request("https://houseplanner.example/api/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks(); mock.actor = { ...viewer, accessLinkId: "a".repeat(64) };
  mock.collection.mockReturnValue({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ projectId: "shared", title: "Deadline", acknowledgedByUids: [] }) }) }), where: () => ({ get: async () => ({ docs: [] }) }) });
});

describe("strict read-only links", () => {
  it("keeps guest countdown dates and titles readable while excluding recipient identifiers", async () => {
    const dueAt = new Date("2026-10-15T12:00:00.000Z");
    mock.actor = { ...viewer, accessLinkId: "a".repeat(64), anonymousLink: true };
    mock.collection.mockReturnValue({ where: () => ({ get: async () => ({ docs: [{ id: "deadline", data: () => ({ projectId: "shared", title: "Inspection", durationDays: 7, dueAt: { toDate: () => dueAt }, recipientUids: [viewer.uid, "private-member"], createdByUid: "private-member", acknowledgedByUids: [] }) }] }) }) });
    const guestResponse = await readCountdowns();
    expect(guestResponse.status).toBe(200);
    expect(await guestResponse.json()).toMatchObject({ countdowns: [{ id: "deadline", title: "Inspection", dueAt: dueAt.toISOString(), recipientUids: [], notifyCurrentUser: false }] });
    mock.actor = viewer;
    expect(await (await readCountdowns()).json()).toMatchObject({ countdowns: [{ recipientUids: [viewer.uid, "private-member"], notifyCurrentUser: true }] });
  });

  it("denies shared quote chat before reading project data or calling the model", async () => {
    expect((await sendQuoteMessage(request({ id: "quote", question: "Compare" }))).status).toBe(403);
    expect(mock.collection).not.toHaveBeenCalled();
    expect(mock.answer).not.toHaveBeenCalled();
  });
  it("preserves chat access for independently granted viewers", async () => {
    mock.actor = viewer;
    expect((await sendQuoteMessage(request({}))).status).toBe(400);
  });
  it("denies acknowledgement writes before reading or updating the countdown", async () => {
    expect((await updateCountdown(request({ id: "deadline", action: "acknowledge" }))).status).toBe(403);
    expect(mock.collection).not.toHaveBeenCalled();
    expect(mock.update).not.toHaveBeenCalled();
  });
  it("preserves acknowledgement for independently granted viewers", async () => {
    mock.actor = viewer;
    expect((await updateCountdown(request({ id: "deadline", action: "acknowledge" }))).status).toBe(200);
    expect(mock.update).toHaveBeenCalledOnce();
  });
  it("still denies recipient editing to independent viewers", async () => {
    mock.actor = viewer;
    expect((await updateCountdown(request({ id: "deadline", action: "recipients", recipientUids: [viewer.uid] }))).status).toBe(403);
    expect(mock.update).not.toHaveBeenCalled();
  });
});
