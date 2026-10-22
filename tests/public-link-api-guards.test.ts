import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as chat } from "@/app/api/assistant/chat/route";
import { GET as conversations } from "@/app/api/assistant/conversations/route";
import { POST as proposals } from "@/app/api/assistant/proposals/route";
import { GET as notifications, PATCH as notificationPreferences } from "@/app/api/notifications/route";
import { DEFAULT_FOLDER_ACCESS, DEFAULT_MEMBER_PERMISSIONS, NOTIFICATION_PREFERENCES, USERS, type MemberRecord } from "@/lib/project";

const mock = vi.hoisted(() => ({
  actor: null as MemberRecord | null,
  collection: vi.fn(),
  set: vi.fn(async () => undefined),
  recipients: vi.fn(async () => [{ uid: "member", name: "Member", email: "private@example.test" }]),
  chat: vi.fn(async () => ({ conversationId: "conversation", assistantMessageId: "message", text: "Answer", language: "es", citations: [] })),
  list: vi.fn(async () => []),
  get: vi.fn(async () => ({ id: "conversation", messages: [] })),
  confirm: vi.fn(async () => ({ draftId: "draft", reused: true })),
}));

vi.mock("@/lib/auth", () => ({ requireApproved: async () => mock.actor, requireTabAccess: async () => mock.actor }));
vi.mock("@/lib/assistant-service", () => ({ runAssistantTurn: mock.chat, listAssistantConversations: mock.list, getAssistantConversation: mock.get }));
vi.mock("@/lib/assistant-drafts", () => ({ confirmAssistantProposal: mock.confirm }));
vi.mock("@/lib/usage-actions", () => ({ completedUsageAction: vi.fn() }));
vi.mock("@/lib/firebase-admin", () => ({ firestore: { collection: mock.collection } }));
vi.mock("@/lib/notification-service", () => ({ eligibleCountdownRecipients: mock.recipients }));
vi.mock("@/lib/gmail", () => ({ gmailConfiguration: () => ({ configured: true, sender: "sender@example.test" }) }));

const viewer: MemberRecord = {
  uid: "reader", name: "Reader", email: "reader@example.test", projectId: "shared", projectName: "Shared", isPersonal: false,
  role: "viewer", status: "approved", permissions: DEFAULT_MEMBER_PERMISSIONS, folderAccess: DEFAULT_FOLDER_ACCESS,
};
const request = (path: string, method: string, body?: unknown) => new Request(`https://planner.example.test/api/${path}`, {
  method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
});

beforeEach(() => {
  vi.clearAllMocks();
  mock.actor = { ...viewer, uid: `public-link:${"a".repeat(64)}`, email: "", accessLinkId: "a".repeat(64), anonymousLink: true };
  mock.collection.mockReturnValue({ doc: () => ({ get: async () => ({ data: () => ({ emailEnabled: true, language: "es" }) }), set: mock.set }) });
});

describe("public link account boundaries", () => {
  it("denies assistant chat before storing a conversation or invoking the model", async () => {
    expect((await chat(request("assistant/chat", "POST", { message: "Help me" }))).status).toBe(403);
    expect(mock.chat).not.toHaveBeenCalled();
  });

  it("denies both assistant history listing and direct conversation reads", async () => {
    expect((await conversations(request("assistant/conversations", "GET"))).status).toBe(403);
    expect((await conversations(request("assistant/conversations?id=conversation", "GET"))).status).toBe(403);
    expect(mock.list).not.toHaveBeenCalled();
    expect(mock.get).not.toHaveBeenCalled();
  });

  it("denies proposal confirmation before reading or applying drafts", async () => {
    expect((await proposals(request("assistant/proposals", "POST", { id: "proposal" }))).status).toBe(403);
    expect(mock.confirm).not.toHaveBeenCalled();
  });

  it("hides notification recipients and account preferences before accessing either", async () => {
    expect((await notifications()).status).toBe(403);
    expect(mock.recipients).not.toHaveBeenCalled();
    expect(mock.collection).not.toHaveBeenCalled();
  });

  it("denies preference writes without creating a guest user or preference record", async () => {
    expect((await notificationPreferences(request("notifications", "PATCH", { emailEnabled: false, language: "en" }))).status).toBe(403);
    expect(mock.collection).not.toHaveBeenCalled();
    expect(mock.set).not.toHaveBeenCalled();
  });

  it("preserves assistant chat and private history for a viewer with an account link", async () => {
    mock.actor = { ...viewer, accessLinkId: "a".repeat(64) };
    const response = await chat(request("assistant/chat", "POST", { message: "Help me", language: "es" }));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Answer");
    expect(mock.chat).toHaveBeenCalledWith(mock.actor, { conversationId: undefined, message: "Help me", language: "es" });
    expect((await conversations(request("assistant/conversations", "GET"))).status).toBe(200);
    expect(mock.list).toHaveBeenCalledWith(mock.actor);
    expect((await conversations(request("assistant/conversations?id=conversation", "GET"))).status).toBe(200);
    expect(mock.get).toHaveBeenCalledWith(mock.actor, "conversation");
  });

  it("preserves proposal validation for independent viewers", async () => {
    mock.actor = viewer;
    expect((await proposals(request("assistant/proposals", "POST", {}))).status).toBe(400);
    expect(mock.confirm).not.toHaveBeenCalled();
  });

  it("preserves notification settings for account viewers", async () => {
    mock.actor = viewer;
    expect((await notifications()).status).toBe(200);
    expect(mock.recipients).toHaveBeenCalledWith("shared");
    expect((await notificationPreferences(request("notifications", "PATCH", { emailEnabled: false, language: "en" }))).status).toBe(200);
    expect(mock.collection).toHaveBeenCalledWith(NOTIFICATION_PREFERENCES);
    expect(mock.collection).toHaveBeenCalledWith(USERS);
    expect(mock.set).toHaveBeenCalledTimes(2);
  });
});
