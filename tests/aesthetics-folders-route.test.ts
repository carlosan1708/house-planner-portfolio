import { beforeEach, describe, expect, it, vi } from "vitest";

type Data = Record<string, unknown>;
const state = vi.hoisted(() => ({ docs: new Map<string, Record<string, unknown>>(), writes: [] as string[], savedFiles: [] as string[], denied: false, counter: 0 }));

function reference(collection: string, id: string) {
  const path = `${collection}/${id}`;
  return { id, path, get: async () => snapshot(collection, id) };
}
function snapshot(collection: string, id: string) {
  const path = `${collection}/${id}`;
  return { id, exists: state.docs.has(path), data: () => state.docs.get(path) || {}, ref: reference(collection, id) };
}
function query(collection: string, field: string, value: unknown) {
  return { get: async () => ({ docs: [...state.docs.entries()].filter(([path, data]) => path.startsWith(`${collection}/`) && data[field] === value).map(([path]) => snapshot(collection, path.slice(collection.length + 1))) }) };
}

vi.mock("@/lib/auth", () => ({ requireTabAccess: vi.fn(async () => state.denied ? null : { uid: "user-1", email: "owner@example.com", name: "Owner", role: "admin", projectId: "project-a" }) }));
vi.mock("@/lib/aesthetic-folders", () => ({ ensureDefaultAestheticFolders: vi.fn(async () => undefined) }));
vi.mock("@/lib/project", () => ({ AESTHETIC_FOLDERS: "folders", AESTHETIC_IMAGES: "images", projectStoragePrefix: (id: string) => id }));
vi.mock("@/lib/firebase-admin", () => ({
  projectBucket: { file: (key: string) => ({ save: async () => { state.savedFiles.push(key); }, delete: async () => undefined }) },
  firestore: {
    collection: (collection: string) => ({ doc: (id = `new-folder-${++state.counter}`) => reference(collection, id), where: (field: string, _operator: string, value: unknown) => query(collection, field, value) }),
    getAll: async (...refs: Array<ReturnType<typeof reference>>) => Promise.all([...refs].reverse().map((ref) => ref.get())),
  },
}));
vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "timestamp", arrayRemove: (...values: string[]) => ({ removeValues: values }) } }));
vi.mock("sharp", () => ({ default: vi.fn(() => {
  const pipeline = {
    rotate: () => pipeline, resize: () => pipeline, jpeg: () => pipeline, clone: () => pipeline, webp: () => pipeline,
    toBuffer: async (options?: { resolveWithObject?: boolean }) => options?.resolveWithObject
      ? { data: Buffer.from("processed-image"), info: { width: 1200, height: 800 } }
      : Buffer.from("thumbnail"),
  };
  return pipeline;
}) }));
vi.mock("@/lib/activity", () => ({
  commitActivity: vi.fn(async (_actor: unknown, _input: unknown, write: (transaction: { set: (ref: ReturnType<typeof reference>, data: Data, options?: { merge?: boolean }) => void }) => unknown) => {
    await write({ set: (ref, data, options) => {
      state.writes.push(ref.path);
      const before = state.docs.get(ref.path) || {};
      const after: Data = options?.merge ? { ...before } : {};
      for (const [key, value] of Object.entries(data)) {
        if (value && typeof value === "object" && "removeValues" in value) {
          const removed = (value as { removeValues: string[] }).removeValues;
          after[key] = (Array.isArray(before[key]) ? before[key] : []).filter((id) => !removed.includes(String(id)));
        } else after[key] = value;
      }
      state.docs.set(ref.path, after);
    } });
  }),
}));

import { DELETE, GET, PATCH, POST } from "@/app/api/aesthetics/route";

function folder(id: string, values: Data = {}) {
  state.docs.set(`folders/${id}`, { projectId: "project-a", name: id, kind: "images", carouselImageIds: [], ...values });
}
function image(id: string, values: Data = {}) {
  state.docs.set(`images/${id}`, { projectId: "project-a", folderId: "folder-a", fileName: `${id}.jpg`, contentType: "image/jpeg", ...values });
}
function request(method: string, body: Data) {
  return new Request("http://localhost/api/aesthetics", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
const remove = (type: string, id: string) => DELETE(new Request(`http://localhost/api/aesthetics?type=${type}&id=${id}`, { method: "DELETE" }));

beforeEach(() => {
  state.docs.clear(); state.writes.length = 0; state.savedFiles.length = 0; state.denied = false; state.counter = 0;
  folder("folder-a", { name: "Interior" }); folder("folder-b", { name: "Exterior" });
  image("image-a"); image("image-b", { folderId: "folder-b" });
});

describe("aesthetic folder hierarchy API", () => {
  it("serializes legacy root folders without requiring a migration", async () => {
    const response = await GET();
    const body = await response.json();
    expect(body.folders.every((item: Data) => item.parentId === null)).toBe(true);
  });
  it("creates multiple sibling subfolders and a nested subfolder", async () => {
    const kitchen = await POST(request("POST", { action: "create_folder", name: "Cocina", parentId: "folder-a" }));
    const baths = await POST(request("POST", { action: "create_folder", name: "Baños", parentId: "folder-a" }));
    const kitchenData = await kitchen.json(); const bathData = await baths.json();
    const main = await POST(request("POST", { action: "create_folder", name: "Principal", parentId: bathData.folder.id }));
    expect([kitchen.status, baths.status, main.status]).toEqual([201, 201, 201]);
    expect(kitchenData.folder.parentId).toBe("folder-a");
    expect((await main.json()).folder.parentId).toBe(bathData.folder.id);
  });
  it("allows the same name under different parents but rejects duplicate siblings", async () => {
    folder("child-a", { name: "Cocina", parentId: "folder-a" });
    expect((await POST(request("POST", { action: "create_folder", name: " cocina ", parentId: "folder-a" }))).status).toBe(409);
    expect((await POST(request("POST", { action: "create_folder", name: "Cocina", parentId: "folder-b" }))).status).toBe(201);
  });
  it.each(["missing-parent", "foreign-parent", "deleted-parent"])("rejects inaccessible parent %s", async (parentId) => {
    folder("foreign-parent", { projectId: "project-other" }); folder("deleted-parent", { deletedAt: "timestamp" });
    expect((await POST(request("POST", { action: "create_folder", name: "New", parentId }))).status).toBe(404);
    expect(state.writes).toEqual([]);
  });
  it.each(["bad/id", 0, false, [], {}].map((parentId) => ({ parentId })))("rejects malformed parent $parentId instead of silently creating a root folder", async ({ parentId }) => {
    expect((await POST(request("POST", { action: "create_folder", name: "New", parentId }))).status).toBe(400);
    expect(state.writes).toEqual([]);
  });
  it("inherits PDF kind and permits renaming a plans subfolder but protects the root", async () => {
    folder("plans-root", { name: "Planos", kind: "plans" });
    const response = await POST(request("POST", { action: "create_folder", name: "Revisiones", parentId: "plans-root" }));
    const created = (await response.json()).folder;
    expect(created.kind).toBe("plans");
    expect((await PATCH(request("PATCH", { action: "rename_folder", id: created.id, name: "Finales" }))).status).toBe(200);
    expect((await PATCH(request("PATCH", { action: "rename_folder", id: "plans-root", name: "Other" }))).status).toBe(409);
    expect((await remove("folder", "plans-root")).status).toBe(409);
    expect((await remove("folder", created.id)).status).toBe(200);
  });
  it("keeps an explicitly image folder named Planos as an image folder", async () => {
    folder("image-parent", { name: "Planos", kind: "images" });
    const response = await POST(request("POST", { action: "create_folder", name: "Fotos", parentId: "image-parent" }));
    expect(response.status).toBe(201);
    expect((await response.json()).folder.kind).toBe("images");
  });
  it("prevents deleting folders that still contain subfolders", async () => {
    folder("empty-root"); folder("empty-child", { parentId: "empty-root" });
    expect((await remove("folder", "empty-root")).status).toBe(409);
    expect(state.writes).toEqual([]);
    expect((await remove("folder", "empty-child")).status).toBe(200);
    expect((await remove("folder", "empty-root")).status).toBe(200);
  });
});

describe("cross-folder carousel API", () => {
  it("selects photos from different folders and preserves the requested order", async () => {
    const response = await PATCH(request("PATCH", { action: "carousel", id: "folder-a", imageIds: ["image-a", "image-b"] }));
    expect(response.status).toBe(200);
    expect((await response.json()).folder.carouselImageIds).toEqual(["image-a", "image-b"]);
    expect(state.docs.get("images/image-b")?.folderId).toBe("folder-b");
    expect(state.writes).toEqual(["folders/folder-a"]);
  });
  it.each(["foreign-image", "deleted-image", "missing-image", "pdf-image"])("rejects unavailable or incompatible selection %s atomically", async (id) => {
    image("foreign-image", { projectId: "project-other" }); image("deleted-image", { deletedAt: "timestamp" }); image("pdf-image", { contentType: "application/pdf" });
    const response = await PATCH(request("PATCH", { action: "carousel", id: "folder-a", imageIds: ["image-a", id] }));
    expect(response.status).toBe(400);
    expect(state.writes).toEqual([]);
    expect(state.docs.get("folders/folder-a")?.carouselImageIds).toEqual([]);
  });
  it("rejects over-limit selections instead of silently truncating them", async () => {
    const ids = Array.from({ length: 31 }, (_, index) => `image-${index}`);
    expect((await PATCH(request("PATCH", { action: "carousel", id: "folder-a", imageIds: ids }))).status).toBe(400);
    expect(state.writes).toEqual([]);
  });
  it.each([undefined, null, "image-a", {}, ["image-a", "bad/id"], ["image-a", 7]].map((imageIds) => ({ imageIds })))("rejects malformed carousel input $imageIds without clearing the current selection", async ({ imageIds }) => {
    folder("folder-a", { carouselImageIds: ["image-a"] });
    const response = await PATCH(request("PATCH", { action: "carousel", id: "folder-a", imageIds }));
    expect(response.status).toBe(400);
    expect(state.writes).toEqual([]);
    expect(state.docs.get("folders/folder-a")?.carouselImageIds).toEqual(["image-a"]);
  });
  it("selects only PDF files from different Planos subfolders in the requested order", async () => {
    folder("plans-root", { name: "Planos", kind: "plans" });
    folder("plans-child", { name: "Revisiones", parentId: "plans-root", kind: "plans" });
    image("plan-first", { folderId: "plans-root", contentType: "application/pdf" });
    image("plan-later", { folderId: "plans-child", contentType: "application/pdf" });
    const selected = await PATCH(request("PATCH", { action: "carousel", id: "plans-root", imageIds: ["plan-later", "plan-first"] }));
    expect(selected.status).toBe(200);
    expect((await selected.json()).folder.carouselImageIds).toEqual(["plan-later", "plan-first"]);
    state.writes.length = 0;
    expect((await PATCH(request("PATCH", { action: "carousel", id: "plans-root", imageIds: ["plan-first", "image-a"] }))).status).toBe(400);
    expect(state.writes).toEqual([]);
    expect(state.docs.get("folders/plans-root")?.carouselImageIds).toEqual(["plan-later", "plan-first"]);
  });
  it("persists an explicitly empty carousel", async () => {
    folder("folder-a", { carouselImageIds: ["image-a"] });
    expect((await PATCH(request("PATCH", { action: "carousel", id: "folder-a", imageIds: [] }))).status).toBe(200);
    expect(state.docs.get("folders/folder-a")?.carouselImageIds).toEqual([]);
  });
  it("keeps all carousel memberships when an image moves", async () => {
    folder("folder-a", { carouselImageIds: ["image-a"] }); folder("folder-b", { carouselImageIds: ["image-a"] });
    expect((await PATCH(request("PATCH", { action: "move_image", id: "image-a", folderId: "folder-b" }))).status).toBe(200);
    expect(state.docs.get("images/image-a")?.folderId).toBe("folder-b");
    expect(state.docs.get("folders/folder-a")?.carouselImageIds).toEqual(["image-a"]);
    expect(state.docs.get("folders/folder-b")?.carouselImageIds).toEqual(["image-a"]);
    expect(state.writes).toEqual(["images/image-a"]);
  });
  it("removes a deleted image from every referencing carousel in its project only", async () => {
    folder("folder-a", { carouselImageIds: ["image-a", "image-b"] }); folder("folder-b", { carouselImageIds: ["image-a"] });
    folder("foreign-folder", { projectId: "project-other", carouselImageIds: ["image-a"] });
    expect((await remove("image", "image-a")).status).toBe(200);
    expect(state.docs.get("folders/folder-a")?.carouselImageIds).toEqual(["image-b"]);
    expect(state.docs.get("folders/folder-b")?.carouselImageIds).toEqual([]);
    expect(state.docs.get("folders/foreign-folder")?.carouselImageIds).toEqual(["image-a"]);
  });
  it("retains server authorization for read and write operations", async () => {
    state.denied = true;
    const responses = await Promise.all([GET(), POST(request("POST", { action: "create_folder", name: "New" })), PATCH(request("PATCH", { action: "carousel", id: "folder-a", imageIds: ["image-b"] })), remove("image", "image-a")]);
    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403]);
    expect(state.writes).toEqual([]);
  });
});

describe("uploads preserve curated carousel selections", () => {
  it.each([{ selected: [] }, { selected: ["image-a"] }])("leaves the image folder selection $selected unchanged while saving a new photo", async ({ selected }) => {
    folder("folder-a", { carouselImageIds: selected });
    const form = new FormData();
    form.set("file", new File(["image input"], "new-photo.png", { type: "image/png" }));
    form.set("folderId", "folder-a");
    form.set("caption", "New photo");
    const response = await POST(new Request("http://localhost/api/aesthetics", { method: "POST", body: form }));
    expect(response.status).toBe(201);
    const uploaded = (await response.json()).image;
    expect(uploaded).toMatchObject({ name: "new-photo.png", caption: "New photo", notes: "", folderId: "folder-a", mediaType: "image" });
    expect(state.docs.get(`images/${uploaded.id}`)).toMatchObject({ projectId: "project-a", folderId: "folder-a", notes: "" });
    expect(state.docs.get("folders/folder-a")?.carouselImageIds).toEqual(selected);
    expect(state.writes).toEqual([`images/${uploaded.id}`]);
    expect(state.savedFiles).toHaveLength(2);
    expect(state.savedFiles.every((key) => key.startsWith("project-a/aesthetics/"))).toBe(true);
  });
  it("saves a PDF into a plans child without changing either curated carousel", async () => {
    folder("plans-root", { name: "Planos", kind: "plans", carouselImageIds: ["plan-first"] });
    folder("plans-child", { name: "Revisiones", parentId: "plans-root", kind: "plans" });
    const form = new FormData();
    form.set("file", new File(["%PDF-1.4\nsynthetic QA fixture"], "revision.pdf", { type: "application/pdf" }));
    form.set("folderId", "plans-child");
    const response = await POST(new Request("http://localhost/api/aesthetics", { method: "POST", body: form }));
    expect(response.status).toBe(201);
    expect((await response.json()).image).toMatchObject({ name: "revision.pdf", notes: "", folderId: "plans-child", mediaType: "pdf" });
    expect(state.docs.get("folders/plans-root")?.carouselImageIds).toEqual(["plan-first"]);
    expect(state.docs.get("folders/plans-child")?.carouselImageIds).toEqual([]);
    expect(state.savedFiles).toHaveLength(1);
  });
});
