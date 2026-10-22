import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST, PATCH } from "@/app/api/projects/route";
import { DEFAULT_FOLDER_ACCESS, DEFAULT_MEMBER_PERMISSIONS, type MemberRecord } from "@/lib/project";

const mock = vi.hoisted(() => ({ actor: null as MemberRecord | null, collection: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSessionMember: async () => mock.actor, requireApproved: async () => mock.actor }));
vi.mock("@/lib/firebase-admin", () => ({ firestore: { collection: mock.collection }, projectBucket: null }));
vi.mock("@/lib/activity", () => ({ commitActivity: vi.fn() }));
vi.mock("@/lib/folders", () => ({ ensureExpenseInvoiceFolder: vi.fn(), ensureExpensePurchaseFolder: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  mock.actor = { uid: "public-link:opaque-hash", email: "", name: "Visitante", projectId: "shared", projectName: "Shared house", isPersonal: false, role: "viewer", status: "approved", permissions: DEFAULT_MEMBER_PERMISSIONS, folderAccess: DEFAULT_FOLDER_ACCESS, anonymousLink: true, accessLinkId: "a".repeat(64) };
  mock.collection.mockImplementation(() => { throw new Error("Guest project endpoints must not access identities or create memberships"); });
});

describe("public-link project isolation", () => {
  it("lists only the granted project without bootstrapping a personal workspace", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ projects: [{ id: "shared", name: "Shared house", currency: "CRC", currencyRevision: 0, currencyLocked: true, kind: "shared", role: "viewer", active: true, favorite: false, openOnSignIn: false }] });
    expect(mock.collection).not.toHaveBeenCalled();
  });

  it("cannot create a project or acquire an administrator membership", async () => {
    const response = await POST(new Request("https://planner.example/api/projects", { method: "POST", body: JSON.stringify({ name: "New project" }) }));
    expect(response.status).toBe(403);
    expect(mock.collection).not.toHaveBeenCalled();
  });

  it.each(["switch", "favorite", "open_favorite", "currency"])("cannot change project or account preferences with %s", async (action) => {
    const response = await PATCH(new Request("https://planner.example/api/projects", { method: "PATCH", body: JSON.stringify({ action, projectId: "another-project", enabled: true }) }));
    expect(response.status).toBe(403);
    expect(mock.collection).not.toHaveBeenCalled();
  });
});
