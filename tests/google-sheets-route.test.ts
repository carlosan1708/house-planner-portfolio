import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), read: vi.fn(), sync: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireTabAccess: mocks.actor }));
vi.mock("@/lib/google-sheets", () => ({ googleConfigured: () => true, googleConnectionRef: () => ({ get: mocks.read, delete: vi.fn() }) }));
vi.mock("@/lib/google-budget", () => ({ googleBudgetRef: () => ({ get: mocks.read }), syncGoogleBudget: mocks.sync, googleSyncMessage: () => "Sync failed" }));
import { GET, POST, DELETE } from "@/app/api/google-sheets/route";
const request = (action: string) => new Request("http://localhost/api/google-sheets", { method: "POST", body: JSON.stringify({ action, projectId: "untrusted-project", draftId: "tiny-draft" }) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor.mockResolvedValue({ uid: "owner", projectId: "project-a", role: "admin" });
  mocks.read.mockResolvedValue({ data: () => ({ fileId: "one-file", folderId: "folder", ownerUid: "owner", token: "private-token" }) });
  mocks.sync.mockResolvedValue({ fileId: "one-file", folderId: "folder" });
});
it("uses the authenticated project and one file for every category", async () => {
  for (let i = 0; i < 2; i++) {
    const response = await POST(request("ensure"));
    expect(response.status).toBe(200);
    expect((await response.json()).url).toContain("one-file");
  }
  expect(mocks.sync).toHaveBeenCalledWith("project-a", "owner", false);
});
it("never exposes the encrypted connection token", async () => { expect(await (await GET()).text()).not.toContain("private-token"); });
it("uses managed access without requiring a personal OAuth token", async () => {
  vi.stubEnv("HOUSE_PLANNER_GOOGLE_SERVICE_ACCOUNT", "sheets@example.iam.gserviceaccount.com");
  mocks.read.mockResolvedValue({ data: () => ({ fileId: "one-file", folderId: "folder", authMode: "service_account" }) });
  try {
    expect(await (await GET()).json()).toMatchObject({ managed: true, connected: true });
    expect(mocks.read).toHaveBeenCalledTimes(1);
  } finally { vi.unstubAllEnvs(); }
});
it("requires editing access", async () => {
  mocks.actor.mockResolvedValue(null);
  expect((await GET()).status).toBe(403); expect((await POST(request("sync"))).status).toBe(403);
  expect(mocks.sync).not.toHaveBeenCalled();
});
it("only administrators provision a project connection", async () => {
  mocks.actor.mockResolvedValue({ uid: "editor", projectId: "project-a", role: "editor" });
  expect((await POST(request("ensure"))).status).toBe(403);
});
it("rejects obsolete per-draft exports", async () => { expect((await POST(request("export"))).status).toBe(400); expect(mocks.sync).not.toHaveBeenCalled(); });
it("does not silently disconnect the backing account", async () => { expect((await DELETE()).status).toBe(409); });
it("sanitizes errors", async () => {
  mocks.sync.mockRejectedValue(new Error("secret-token"));
  expect(await (await POST(request("sync"))).text()).not.toContain("secret-token");
});
