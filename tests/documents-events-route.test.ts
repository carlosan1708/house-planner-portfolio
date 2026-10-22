import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  canAccessFolder: vi.fn(),
  get: vi.fn(),
  listProjectFolders: vi.fn(),
  memberships: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/auth", () => ({
  canAccessFolder: mocks.canAccessFolder,
  requireTabAccess: mocks.actor,
}));
vi.mock("@/lib/firebase-admin", () => ({
  firestore: { collection: () => ({ doc: () => ({ get: mocks.get }), where: () => ({ get: async () => ({ docs: mocks.memberships.map((data) => ({ data: () => data })) }) }) }) },
}));
vi.mock("@/lib/folders", () => ({
  buildTopLevelFolderMap: () => new Map([["private", "private"]]),
  folderTopLevelId: (id: string | null) => id,
  listProjectFolders: mocks.listProjectFolders,
}));
vi.mock("@/lib/project", () => ({
  CONFIG: "config",
  MEMBERSHIPS: "memberships",
  projectConfigDoc: (projectId: string) => `project-${projectId}`,
}));

import { GET } from "@/app/api/events/documents/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.memberships = [];
  mocks.actor.mockResolvedValue({
    email: "admin@example.com",
    folderAccess: { mode: "all" },
    projectId: "alpha",
    role: "admin",
  });
  mocks.listProjectFolders.mockResolvedValue([]);
  mocks.get.mockResolvedValue({
    data: () => ({
      documentsUpdatedBy: "member@example.com",
      documentsUpdatedFolderIds: ["private"],
      documentsVersion: 8,
    }),
  });
});

it("returns a short no-store version response instead of an event stream", async () => {
  const response = await GET(new Request("http://localhost/api/events/documents"));

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  await expect(response.json()).resolves.toEqual({
    version: 8,
    updatedBy: "member@example.com",
  });
});

it("aliases the last document updater without changing the version or stored author", async () => {
  mocks.memberships = [{ uid: "former", projectId: "alpha", removed: true, removedEmail: "member@example.com" }];
  const response = await GET(new Request("http://localhost/api/events/documents"));
  await expect(response.json()).resolves.toEqual({ version: 8, updatedBy: "Usuario desactivado" });
});

it("keeps a restricted member on the known version for an inaccessible update", async () => {
  mocks.actor.mockResolvedValue({
    email: "viewer@example.com",
    folderAccess: { mode: "selected" },
    projectId: "alpha",
    role: "viewer",
  });
  mocks.canAccessFolder.mockReturnValue(false);

  const response = await GET(new Request("http://localhost/api/events/documents?version=7"));

  await expect(response.json()).resolves.toEqual({ version: 7, updatedBy: "" });
});

it("rejects callers without document access", async () => {
  mocks.actor.mockResolvedValue(null);

  const response = await GET(new Request("http://localhost/api/events/documents"));

  expect(response.status).toBe(403);
  expect(mocks.get).not.toHaveBeenCalled();
});

it("hides protected-folder update details even from administrators", async () => {
  mocks.listProjectFolders.mockResolvedValue([{ id: "private", parentId: null, encrypted: true }]);
  const response = await GET(new Request("http://localhost/api/events/documents?version=7"));
  await expect(response.json()).resolves.toEqual({ version: 7, updatedBy: "" });
});

it("does not reveal the protected version on the first polling request", async () => {
  mocks.listProjectFolders.mockResolvedValue([{ id: "private", parentId: null, encrypted: true }]);
  const response = await GET(new Request("http://localhost/api/events/documents"));
  await expect(response.json()).resolves.toEqual({ version: 0, updatedBy: "" });
});

it("refreshes ordinary changes without disclosing a mixed protected update's author", async () => {
  mocks.listProjectFolders.mockResolvedValue([{ id: "private", parentId: null, encrypted: true }]);
  mocks.get.mockResolvedValue({ data: () => ({ documentsUpdatedFolderIds: ["public", "private"], documentsUpdatedBy: "secret@example.com", documentsVersion: 8 }) });
  const response = await GET(new Request("http://localhost/api/events/documents?version=7"));
  await expect(response.json()).resolves.toEqual({ version: 8, updatedBy: "" });
});
