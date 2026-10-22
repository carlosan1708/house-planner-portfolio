import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ actor: vi.fn(), records: new Map<string, Map<string, Record<string, unknown>>>(), events: [] as unknown[], next: 0 }));
vi.mock("@/lib/auth", () => ({ requireTabAccess: mock.actor }));
vi.mock("@/lib/aesthetic-folders", () => ({ ensureDefaultAestheticFolders: vi.fn() }));
vi.mock("firebase-admin/firestore", () => ({ FieldValue: {
  serverTimestamp: () => ({ toDate: () => new Date("2026-10-04T12:00:00Z") }),
  arrayRemove: (id: string) => ({ removeId: id }),
} }));
vi.mock("@/lib/firebase-admin", () => {
  const collection = (name: string) => {
    const records = mock.records.get(name) || new Map();
    mock.records.set(name, records);
    const doc = (id = `folder-${++mock.next}`) => {
      const ref = { id, get: async () => ({ id, ref, exists: records.has(id), data: () => records.get(id) }), set: (data: Record<string, unknown>) => {
        const next = { ...records.get(id), ...data };
        for (const [key, value] of Object.entries(data)) {
          if (value && typeof value === "object" && "removeId" in value) next[key] = ((records.get(id)?.[key] || []) as string[]).filter((item) => item !== value.removeId);
        }
        records.set(id, next);
      } };
      return ref;
    };
    return { doc, where: (_key: string, _op: string, projectId: string) => ({ get: async () => ({ docs: await Promise.all([...records.entries()].filter(([, data]) => data.projectId === projectId).map(([id]) => doc(id).get())) }) }) };
  };
  return { projectBucket: null, firestore: { collection, getAll: (...refs: { get: () => Promise<unknown> }[]) => Promise.all(refs.map((ref) => ref.get())) } };
});
vi.mock("@/lib/activity", () => ({ commitActivity: async (_actor: unknown, event: unknown, mutate: (transaction: unknown) => void) => {
  mock.events.push(event);
  mutate({ set: (ref: { set: (data: unknown) => void }, data: unknown) => ref.set(data) });
} }));

import { DELETE, GET, PATCH, POST } from "@/app/api/aesthetics/route";
import { AESTHETIC_FOLDERS, AESTHETIC_IMAGES } from "@/lib/project";
import { MAX_AESTHETIC_NOTES_LENGTH } from "@/lib/aesthetics";

const request = (method: string, body: unknown) => new Request("http://localhost/api/aesthetics", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const folder = (name: string, parentId: string | null = null, carouselImageIds: string[] = []) => ({ projectId: "project-1", name, parentId, carouselImageIds });

beforeEach(() => {
  mock.next = 0;
  mock.events.length = 0;
  mock.records.clear();
  mock.records.set(AESTHETIC_FOLDERS, new Map([["interior-1", folder("Interior")], ["exterior-1", folder("Exterior")]]));
  mock.records.set(AESTHETIC_IMAGES, new Map([
    ["image-001", { projectId: "project-1", folderId: "interior-1", fileName: "Sala.jpg" }],
    ["image-002", { projectId: "project-1", folderId: "exterior-1", fileName: "Terraza.jpg" }],
    ["image-003", { projectId: "other-project", folderId: "exterior-2" }],
    ["image-004", { projectId: "project-1", folderId: "interior-1", deletedAt: true }],
  ]));
  mock.actor.mockReset().mockResolvedValue({ projectId: "project-1", email: "owner@example.test" });
});

describe("explicit aesthetic image classification", () => {
  it("returns unclassified for old or unknown values without writing a classification", async () => {
    const records = mock.records.get(AESTHETIC_IMAGES)!;
    records.set("image-002", { ...records.get("image-002"), classification: "unknown" });
    const data = await (await GET()).json();
    expect(data.images.map((image: { classification: string }) => image.classification)).toEqual(["unclassified", "unclassified"]);
    expect(records.get("image-001")?.classification).toBeUndefined();
    expect(records.get("image-002")?.classification).toBe("unknown");
    expect(mock.events).toEqual([]);
  });

  it("persists explicit design and inspiration labels without changing notes, captions or carousel selections", async () => {
    const records = mock.records.get(AESTHETIC_IMAGES)!;
    records.set("image-001", { ...records.get("image-001"), caption: "Description", notes: "Keep these notes" });
    mock.records.get(AESTHETIC_FOLDERS)!.set("exterior-1", folder("Exterior", null, ["image-001"]));
    for (const classification of ["planned", "inspiration", "unclassified"]) {
      const response = await PATCH(request("PATCH", { action: "classification", id: "image-001", classification }));
      expect(response.status).toBe(200);
      expect((await response.json()).image).toMatchObject({ classification, folderId: "interior-1", notes: "Keep these notes", caption: "Description" });
      expect(records.get("image-001")).toMatchObject({ classification, updatedBy: "owner@example.test", notes: "Keep these notes", caption: "Description" });
    }
    expect(mock.records.get(AESTHETIC_FOLDERS)!.get("exterior-1")?.carouselImageIds).toEqual(["image-001"]);
    expect(records.get("image-002")?.classification).toBeUndefined();
    expect(mock.events[0]).toMatchObject({ action: "aesthetic.classification_updated", changes: [{ field: "classification", before: "unclassified", after: "planned", format: "text" }] });
  });

  it("does not write or log an unchanged classification, including an unclassified legacy image", async () => {
    const response = await PATCH(request("PATCH", { action: "classification", id: "image-001", classification: "unclassified" }));
    expect((await response.json()).unchanged).toBe(true);
    expect(mock.records.get(AESTHETIC_IMAGES)!.get("image-001")?.classification).toBeUndefined();
    expect(mock.events).toEqual([]);
  });

  it("rejects missing and unsupported classification values without replacing the previous selection", async () => {
    const records = mock.records.get(AESTHETIC_IMAGES)!;
    records.set("image-001", { ...records.get("image-001"), classification: "planned" });
    for (const classification of [undefined, null, 123, {}, [], "design", " planned "]) {
      expect((await PATCH(request("PATCH", { action: "classification", id: "image-001", classification }))).status).toBe(400);
      expect(records.get("image-001")?.classification).toBe("planned");
    }
    expect(mock.events).toEqual([]);
  });

  it("rejects unavailable images and keeps classification off plan PDFs", async () => {
    const records = mock.records.get(AESTHETIC_IMAGES)!;
    records.set("plan-001", { projectId: "project-1", folderId: "interior-1", contentType: "application/pdf" });
    for (const id of ["missing-1", "image-003", "image-004"]) {
      expect((await PATCH(request("PATCH", { action: "classification", id, classification: "planned" }))).status).toBe(404);
      expect(records.get(id)?.classification).toBeUndefined();
    }
    expect((await PATCH(request("PATCH", { action: "classification", id: "bad/id", classification: "planned" }))).status).toBe(400);
    expect((await PATCH(request("PATCH", { action: "classification", id: "plan-001", classification: "planned" }))).status).toBe(409);
    expect(records.get("plan-001")?.classification).toBeUndefined();
    expect(mock.events).toEqual([]);
  });

  it("requires aesthetics editor permission to classify images", async () => {
    mock.actor.mockResolvedValue(null);
    expect((await PATCH(request("PATCH", { action: "classification", id: "image-001", classification: "planned" }))).status).toBe(403);
    expect(mock.actor).toHaveBeenLastCalledWith("aesthetics", ["admin", "editor"]);
    expect(mock.records.get(AESTHETIC_IMAGES)!.get("image-001")?.classification).toBeUndefined();
    expect(mock.events).toEqual([]);
  });
});

describe("per-image aesthetic notes", () => {
  it("returns empty notes for old images and only exposes active images in the current project", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const data = await response.json();
    expect(data.images.map((image: { id: string; notes: string }) => ({ id: image.id, notes: image.notes }))).toEqual([
      { id: "image-001", notes: "" }, { id: "image-002", notes: "" },
    ]);
    expect(mock.actor).toHaveBeenCalledWith("aesthetics");
  });

  it("persists multiline notes separately from the caption and records before and after", async () => {
    const records = mock.records.get(AESTHETIC_IMAGES)!;
    records.set("image-001", { ...records.get("image-001"), caption: "Descripción breve", notes: "Primera idea" });
    const notes = "  Acabado mate\n\nConsultar precio y medidas.\r\n  ";
    const response = await PATCH(request("PATCH", { action: "notes", id: "image-001", notes }));
    expect(response.status).toBe(200);
    expect((await response.json()).image).toMatchObject({ id: "image-001", notes, caption: "Descripción breve" });
    expect(records.get("image-001")).toMatchObject({ notes, caption: "Descripción breve", updatedBy: "owner@example.test" });
    expect(records.get("image-002")?.notes).toBeUndefined();
    expect(mock.events).toEqual([expect.objectContaining({
      action: "aesthetic.notes_updated", category: "aesthetic",
      target: { type: "aesthetic_image", id: "image-001", label: "Sala.jpg", section: "aesthetics" },
      changes: [{ field: "notes", before: "Primera idea", after: notes, format: "text" }],
    })]);
    const data = await (await GET()).json();
    expect(data.images.find((image: { id: string }) => image.id === "image-001").notes).toBe(notes);
  });

  it("allows notes up to the limit and clears them without deleting the image", async () => {
    const notes = "n".repeat(MAX_AESTHETIC_NOTES_LENGTH);
    expect((await PATCH(request("PATCH", { action: "notes", id: "image-001", notes }))).status).toBe(200);
    expect(mock.records.get(AESTHETIC_IMAGES)!.get("image-001")?.notes).toBe(notes);
    const response = await PATCH(request("PATCH", { action: "notes", id: "image-001", notes: "" }));
    expect(response.status).toBe(200);
    expect((await response.json()).image.notes).toBe("");
    expect(mock.records.get(AESTHETIC_IMAGES)!.get("image-001")?.deletedAt).toBeUndefined();
    expect(mock.events.at(-1)).toMatchObject({ changes: [{ field: "notes", before: notes, after: "", format: "text" }] });
  });

  it("does not write or log unchanged notes, including an empty legacy field", async () => {
    const response = await PATCH(request("PATCH", { action: "notes", id: "image-001", notes: "" }));
    expect((await response.json()).unchanged).toBe(true);
    expect(mock.events).toEqual([]);
    expect(mock.records.get(AESTHETIC_IMAGES)!.get("image-001")?.updatedAt).toBeUndefined();
  });

  it("rejects missing, non-string and oversized notes without replacing saved text", async () => {
    const records = mock.records.get(AESTHETIC_IMAGES)!;
    records.set("image-001", { ...records.get("image-001"), notes: "Conservar" });
    for (const notes of [undefined, null, 123, {}, [], "n".repeat(MAX_AESTHETIC_NOTES_LENGTH + 1)]) {
      const response = await PATCH(request("PATCH", { action: "notes", id: "image-001", notes }));
      expect(response.status).toBe(400);
      expect(records.get("image-001")?.notes).toBe("Conservar");
    }
    expect(mock.events).toEqual([]);
  });

  it("rejects malformed, missing, foreign and deleted images", async () => {
    expect((await PATCH(request("PATCH", { action: "notes", id: "bad/id", notes: "No" }))).status).toBe(400);
    for (const id of ["missing-1", "image-003", "image-004"]) {
      expect((await PATCH(request("PATCH", { action: "notes", id, notes: "No" }))).status).toBe(404);
      expect(mock.records.get(AESTHETIC_IMAGES)!.get(id)?.notes).toBeUndefined();
    }
    expect(mock.events).toEqual([]);
  });

  it("requires aesthetics read access and editor access to change notes", async () => {
    mock.actor.mockResolvedValue(null);
    expect((await GET()).status).toBe(403);
    expect(mock.actor).toHaveBeenLastCalledWith("aesthetics");
    expect((await PATCH(request("PATCH", { action: "notes", id: "image-001", notes: "No" }))).status).toBe(403);
    expect(mock.actor).toHaveBeenLastCalledWith("aesthetics", ["admin", "editor"]);
    expect(mock.events).toEqual([]);
    expect(mock.records.get(AESTHETIC_IMAGES)!.get("image-001")?.notes).toBeUndefined();
  });
});

describe("aesthetic subfolders and mixed carousels", () => {
  it("creates several subfolders, permits matching names under different parents, and rejects duplicate siblings", async () => {
    for (const name of ["Cocina", "Baño"]) {
      const response = await POST(request("POST", { action: "create_folder", name, parentId: "interior-1" }));
      expect(response.status).toBe(201);
      expect((await response.json()).folder).toMatchObject({ name, parentId: "interior-1" });
    }
    expect((await POST(request("POST", { action: "create_folder", name: " cocina ", parentId: "interior-1" }))).status).toBe(409);
    expect((await POST(request("POST", { action: "create_folder", name: "Cocina", parentId: "exterior-1" }))).status).toBe(201);
    const response = await GET();
    expect((await response.json()).folders.filter((item: { parentId: string }) => item.parentId === "interior-1")).toHaveLength(2);
  });

  it("rejects missing, deleted, malformed and foreign parent folders", async () => {
    mock.records.get(AESTHETIC_FOLDERS)!.set("foreign-1", { projectId: "other-project", name: "Private" });
    mock.records.get(AESTHETIC_FOLDERS)!.set("deleted-1", { ...folder("Deleted"), deletedAt: true });
    for (const parentId of ["missing-1", "foreign-1", "deleted-1"]) {
      expect((await POST(request("POST", { action: "create_folder", name: "New", parentId }))).status).toBe(404);
    }
    expect((await POST(request("POST", { action: "create_folder", name: "New", parentId: "bad/id" }))).status).toBe(400);
  });

  it("persists ordered photos from different folders", async () => {
    expect((await PATCH(request("PATCH", { action: "carousel", id: "interior-1", imageIds: ["image-002", "image-001"] }))).status).toBe(200);
    expect(mock.records.get(AESTHETIC_FOLDERS)!.get("interior-1")?.carouselImageIds).toEqual(["image-002", "image-001"]);
    const data = await (await GET()).json();
    expect(data.folders.find((item: { id: string }) => item.id === "interior-1").carouselImageIds).toEqual(["image-002", "image-001"]);
  });

  it.each(["image-003", "image-004"])("rejects a selection containing unavailable %s without replacing the existing carousel", async (id) => {
    mock.records.get(AESTHETIC_FOLDERS)!.set("interior-1", folder("Interior", null, ["image-001"]));
    expect((await PATCH(request("PATCH", { action: "carousel", id: "interior-1", imageIds: ["image-002", id] }))).status).toBe(400);
    expect(mock.records.get(AESTHETIC_FOLDERS)!.get("interior-1")?.carouselImageIds).toEqual(["image-001"]);
    expect(mock.events).toEqual([]);
  });

  it("keeps curated carousel selections when a photo moves and cleans every carousel on deletion", async () => {
    for (const id of ["interior-1", "exterior-1"]) mock.records.get(AESTHETIC_FOLDERS)!.set(id, folder(id, null, ["image-001", "image-002"]));
    expect((await PATCH(request("PATCH", { action: "move_image", id: "image-001", folderId: "exterior-1" }))).status).toBe(200);
    expect(mock.records.get(AESTHETIC_IMAGES)!.get("image-001")?.folderId).toBe("exterior-1");
    for (const id of ["interior-1", "exterior-1"]) expect(mock.records.get(AESTHETIC_FOLDERS)!.get(id)?.carouselImageIds).toEqual(["image-001", "image-002"]);
    await DELETE(new Request("http://localhost/api/aesthetics?type=image&id=image-001", { method: "DELETE" }));
    for (const id of ["interior-1", "exterior-1"]) expect(mock.records.get(AESTHETIC_FOLDERS)!.get(id)?.carouselImageIds).toEqual(["image-002"]);
  });

  it("blocks deleting a parent with subfolders even when it contains no images", async () => {
    mock.records.get(AESTHETIC_FOLDERS)!.set("parent-1", folder("Parent"));
    mock.records.get(AESTHETIC_FOLDERS)!.set("child-01", folder("Child", "parent-1"));
    expect((await DELETE(new Request("http://localhost/api/aesthetics?type=folder&id=parent-1", { method: "DELETE" }))).status).toBe(409);
    expect(mock.records.get(AESTHETIC_FOLDERS)!.get("parent-1")?.deletedAt).toBeUndefined();
  });

  it("requires aesthetics edit access", async () => {
    mock.actor.mockResolvedValue(null);
    expect((await POST(request("POST", { action: "create_folder", name: "New" }))).status).toBe(403);
    expect(mock.actor).toHaveBeenCalledWith("aesthetics", ["admin", "editor"]);
    expect((await PATCH(request("PATCH", { action: "carousel", id: "interior-1", imageIds: [] }))).status).toBe(403);
  });

  it("rejects an oversized carousel instead of silently dropping selected photos", async () => {
    const imageIds = Array.from({ length: 31 }, (_, index) => `image-${index.toString().padStart(3, "0")}`);
    expect((await PATCH(request("PATCH", { action: "carousel", id: "interior-1", imageIds }))).status).toBe(400);
    expect(mock.records.get(AESTHETIC_FOLDERS)!.get("interior-1")?.carouselImageIds).toEqual([]);
  });
});
