import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  get: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  canAccessFolder: vi.fn(() => true),
  requireTabAccess: mocks.actor,
}));
vi.mock("@/lib/firebase-admin", () => ({
  firestore: { collection: () => ({ doc: () => ({ get: mocks.get }), where: () => ({ get: async () => ({ docs: [] }) }) }) },
}));
vi.mock("@/lib/folders", () => ({
  buildTopLevelFolderMap: vi.fn(() => new Map()),
  folderTopLevelId: vi.fn(() => null),
  listProjectFolders: vi.fn(async () => []),
}));
vi.mock("@/lib/project", () => ({ CONFIG: "config", MEMBERSHIPS: "memberships", projectConfigDoc: (projectId: string) => projectId }));

import { GET } from "@/app/api/events/documents/route";

describe("document change polling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor.mockResolvedValue({ projectId: "project-1", email: "owner@example.com", role: "admin", folderAccess: { mode: "all" } });
    mocks.get.mockResolvedValue({ data: () => ({ documentsVersion: 12, documentsUpdatedBy: "editor@example.com", documentsUpdatedFolderIds: [] }) });
  });

  it("returns a short JSON version response instead of holding an event stream open", async () => {
    const response = await GET(new Request("http://localhost/api/events/documents"));

    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(await response.json()).toEqual({ version: 12, updatedBy: "editor@example.com" });
  });
});
