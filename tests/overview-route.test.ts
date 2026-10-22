import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberRecord } from "@/lib/project";

const mock = vi.hoisted(() => ({
  actor: null as MemberRecord | null,
  records: new Map<string, Map<string, Record<string, unknown>>>(),
  writes: [] as { collection: string; id: string; data: Record<string, unknown>; merge: boolean }[],
  requireAccess: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireTabAccess: async (tab: keyof MemberRecord["permissions"], roles?: MemberRecord["role"][]) => {
  mock.requireAccess(tab, roles);
  const actor = mock.actor;
  return actor && actor.status === "approved" && (!roles || roles.includes(actor.role))
    && (actor.role === "admin" || actor.permissions[tab]) ? actor : null;
} }));
vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "server-time" } }));
vi.mock("@/lib/firebase-admin", () => {
  const collection = (name: string) => {
    const records = mock.records.get(name) || new Map();
    mock.records.set(name, records);
    return { doc: (id: string) => ({
      id,
      get: async () => ({ id, exists: records.has(id), data: () => records.get(id) }),
      set: async (data: Record<string, unknown>, options: { merge?: boolean } = {}) => {
        mock.writes.push({ collection: name, id, data, merge: options.merge === true });
        records.set(id, options.merge ? { ...records.get(id), ...data } : data);
      },
    }) };
  };
  return { firestore: { collection, getAll: (...refs: { get: () => Promise<unknown> }[]) => Promise.all(refs.map((ref) => ref.get())) } };
});

import { GET, PATCH } from "@/app/api/overview/route";
import { normalizeOverviewPreferences, OVERVIEW_IMAGE_LIMIT, OVERVIEW_NOTE_LIMIT, parseOverviewUpdate } from "@/lib/overview";
import { AESTHETIC_IMAGES, CONFIG, DEFAULT_MEMBER_PERMISSIONS, LEGACY_PROJECT_ID, PROJECT_NOTES } from "@/lib/project";

const member: MemberRecord = {
  uid: "user-1", email: "owner@example.test", name: "Owner", projectId: "project-a", projectName: "Casa", isPersonal: false,
  role: "admin", status: "approved", permissions: { ...DEFAULT_MEMBER_PERMISSIONS, notes: true },
  folderAccess: { mode: "all", folderIds: [], allowUnfiled: true },
};
const request = (body: unknown) => new Request("http://localhost/api/overview", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const config = () => mock.records.get(CONFIG)!;

beforeEach(() => {
  mock.actor = { ...member, permissions: { ...member.permissions } };
  mock.writes.length = 0;
  mock.requireAccess.mockClear();
  mock.records.clear();
  mock.records.set(CONFIG, new Map());
  mock.records.set(AESTHETIC_IMAGES, new Map([
    ["image-1", { projectId: member.projectId, contentType: "image/jpeg" }],
    ["image-2", { projectId: member.projectId }],
    ["foreign-image", { projectId: "project-b", contentType: "image/jpeg" }],
    ["deleted-image", { projectId: member.projectId, deletedAt: true }],
    ["plan-pdf", { projectId: member.projectId, contentType: "application/pdf" }],
  ]));
  mock.records.set(PROJECT_NOTES, new Map([
    ["note-1", { projectId: member.projectId, title: "Sala", content: "Privado", aiEnabled: false }],
    ["note-2", { projectId: member.projectId, aiEnabled: true }],
    ["foreign-note", { projectId: "project-b", aiEnabled: false }],
    ["deleted-note", { projectId: member.projectId, deletedAt: true }],
  ]));
});

describe("overview preferences", () => {
  it("starts with empty selections and uses private, uncached responses", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ imageIds: [], noteIds: [] });
    expect(mock.writes).toEqual([]);
  });

  it("persists deduplicated selections in order without changing notes or other project configuration", async () => {
    config().set(member.projectId, { projectId: member.projectId, documentsVersion: 8, workbook: "keep", overviewNoteIds: ["note-2"] });
    config().set("project-b", { projectId: "project-b", overviewImageIds: ["foreign-image"] });
    const response = await PATCH(request({ imageIds: ["image-2", "image-1", "image-2"], noteIds: ["note-1", "note-1", "note-2"] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ imageIds: ["image-2", "image-1"], noteIds: ["note-1", "note-2"] });
    expect(config().get(member.projectId)).toMatchObject({ documentsVersion: 8, workbook: "keep", overviewImageIds: ["image-2", "image-1"], overviewNoteIds: ["note-1", "note-2"], overviewUpdatedBy: member.email });
    expect(mock.writes).toEqual([expect.objectContaining({ collection: CONFIG, id: member.projectId, merge: true })]);
    expect(config().get("project-b")).toEqual({ projectId: "project-b", overviewImageIds: ["foreign-image"] });
    expect(mock.records.get(PROJECT_NOTES)!.get("note-1")).toEqual({ projectId: member.projectId, title: "Sala", content: "Privado", aiEnabled: false });
    expect(await (await GET()).json()).toEqual({ imageIds: ["image-2", "image-1"], noteIds: ["note-1", "note-2"] });
  });

  it("keeps omitted fields and permits clearing just one selection", async () => {
    config().set(member.projectId, { overviewImageIds: ["image-1"], overviewNoteIds: ["note-1"] });
    const response = await PATCH(request({ imageIds: [] }));
    expect(await response.json()).toEqual({ imageIds: [], noteIds: ["note-1"] });
    expect(config().get(member.projectId)?.overviewNoteIds).toEqual(["note-1"]);
    expect(mock.writes[0].data).not.toHaveProperty("overviewNoteIds");
  });

  it("does not expose stale, deleted, PDF or other-project saved IDs", async () => {
    config().set(member.projectId, {
      overviewImageIds: ["image-2", "foreign-image", "missing-image", "deleted-image", "plan-pdf", "image-1"],
      overviewNoteIds: ["foreign-note", "note-1", "deleted-note", "missing-note"],
    });
    expect(await (await GET()).json()).toEqual({ imageIds: ["image-2", "image-1"], noteIds: ["note-1"] });
  });

  it("masks each section for readers without its resource permission", async () => {
    config().set(member.projectId, { overviewImageIds: ["image-1"], overviewNoteIds: ["note-1"] });
    mock.actor = { ...member, role: "viewer", permissions: { ...member.permissions, notes: false } };
    expect(await (await GET()).json()).toEqual({ imageIds: ["image-1"], noteIds: [] });
    mock.actor.permissions.aesthetics = false;
    mock.actor.permissions.notes = true;
    expect(await (await GET()).json()).toEqual({ imageIds: [], noteIds: ["note-1"] });
    mock.actor = { ...member, permissions: { ...member.permissions, aesthetics: false, notes: false } };
    expect(await (await GET()).json()).toEqual({ imageIds: ["image-1"], noteIds: ["note-1"] });
  });

  it("requires approved overview access and editor or administrator writes", async () => {
    for (const actor of [null, { ...member, status: "pending" as const }, { ...member, role: "editor" as const, permissions: { ...member.permissions, overview: false } }]) {
      mock.actor = actor;
      expect((await GET()).status).toBe(403);
      expect((await PATCH(request({ imageIds: [] }))).status).toBe(403);
    }
    mock.actor = { ...member, role: "viewer" };
    expect((await GET()).status).toBe(200);
    expect((await PATCH(request({ imageIds: [] }))).status).toBe(403);
    expect(mock.writes).toEqual([]);
  });

  it("enforces the permission for every provided field without blocking permitted partial edits", async () => {
    config().set(member.projectId, { overviewImageIds: ["image-1"], overviewNoteIds: ["note-1"] });
    mock.actor = { ...member, role: "editor", permissions: { ...member.permissions, notes: false } };
    expect((await PATCH(request({ imageIds: [], noteIds: [] }))).status).toBe(403);
    expect(mock.writes).toEqual([]);
    expect(await (await PATCH(request({ imageIds: ["image-2"] }))).json()).toEqual({ imageIds: ["image-2"], noteIds: [] });
    expect(config().get(member.projectId)?.overviewNoteIds).toEqual(["note-1"]);
    mock.actor.permissions.aesthetics = false;
    mock.actor.permissions.notes = true;
    expect((await PATCH(request({ imageIds: [] }))).status).toBe(403);
    expect((await PATCH(request({ noteIds: [] }))).status).toBe(200);
  });

  it("rejects unavailable and other-project IDs atomically", async () => {
    config().set(member.projectId, { projectId: member.projectId, overviewImageIds: ["image-1"], overviewNoteIds: ["note-1"] });
    for (const id of ["foreign-image", "missing-image", "deleted-image", "plan-pdf"]) {
      expect((await PATCH(request({ imageIds: ["image-2", id], noteIds: [] }))).status).toBe(400);
    }
    for (const id of ["foreign-note", "missing-note", "deleted-note"]) {
      expect((await PATCH(request({ imageIds: [], noteIds: ["note-2", id] }))).status).toBe(400);
    }
    expect(mock.writes).toEqual([]);
    expect(config().get(member.projectId)).toEqual({ projectId: member.projectId, overviewImageIds: ["image-1"], overviewNoteIds: ["note-1"] });
  });

  it("rejects malformed JSON, malformed arrays and excessive selections before writing", async () => {
    const invalid = [null, [], {}, { unexpected: [] }, { imageIds: "image-1" }, { noteIds: null },
      { imageIds: [null] }, { imageIds: ["x"] }, { imageIds: ["image/1"] }, { noteIds: [2] }, { noteIds: [""] },
      { noteIds: ["note/1"] }, { noteIds: ["note\n1"] }, { noteIds: ["x".repeat(201)] },
      { imageIds: Array(OVERVIEW_IMAGE_LIMIT + 1).fill("image-1") }, { noteIds: Array(OVERVIEW_NOTE_LIMIT + 1).fill("note-1") }];
    for (const body of invalid) expect((await PATCH(request(body))).status).toBe(400);
    expect((await PATCH(new Request("http://localhost/api/overview", { method: "PATCH", body: "{" }))).status).toBe(400);
    expect(mock.writes).toEqual([]);
  });

  it("never reads or overwrites configuration with conflicting project ownership", async () => {
    const foreign = { projectId: "project-b", overviewImageIds: ["image-1"], overviewNoteIds: ["note-1"], private: "foreign" };
    config().set(member.projectId, foreign);
    expect(await (await GET()).json()).toEqual({ imageIds: [], noteIds: [] });
    expect((await PATCH(request({ imageIds: ["image-2"] }))).status).toBe(409);
    expect(config().get(member.projectId)).toEqual(foreign);
    expect(mock.writes).toEqual([]);
  });

  it("uses the legacy project's existing configuration document", async () => {
    mock.actor = { ...member, projectId: LEGACY_PROJECT_ID };
    config().set("production", { workbook: "keep" });
    expect((await PATCH(request({ imageIds: [], noteIds: [] }))).status).toBe(200);
    expect(mock.writes[0]).toMatchObject({ id: "production", merge: true });
    expect(config().get("production")).toMatchObject({ workbook: "keep", projectId: LEGACY_PROJECT_ID });
    expect(config().has(LEGACY_PROJECT_ID)).toBe(false);
  });

  it("keeps personal project notes unavailable like the Notes API", async () => {
    mock.actor = { ...member, isPersonal: true };
    config().set(member.projectId, { overviewNoteIds: ["note-1"] });
    expect(await (await GET()).json()).toEqual({ imageIds: [], noteIds: [] });
    expect((await PATCH(request({ noteIds: [] }))).status).toBe(403);
  });
});

describe("overview preference normalization", () => {
  it("sanitizes old stored preferences and preserves the first appearance of each ID", () => {
    expect(normalizeOverviewPreferences({ overviewImageIds: ["image-2", null, "image-1", "image-2"], overviewNoteIds: ["note-2", "", "note-1", "note-2"] }))
      .toEqual({ imageIds: ["image-2", "image-1"], noteIds: ["note-2", "note-1"] });
    expect(normalizeOverviewPreferences(null)).toEqual({ imageIds: [], noteIds: [] });
    expect(parseOverviewUpdate({ noteIds: [] })).toEqual({ noteIds: [] });
  });
});
