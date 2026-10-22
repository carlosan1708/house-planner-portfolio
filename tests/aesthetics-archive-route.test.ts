import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { Readable } from "node:stream";

type Row = Record<string, unknown>;
type StoredObject = { bytes: Buffer; size?: number; contentType?: string; missing?: boolean; failRead?: boolean; generation?: string };
const state = vi.hoisted(() => ({
  actor: vi.fn(), folders: new Map<string, Row>(), images: new Map<string, Row>(), objects: new Map<string, StoredObject>(),
  queries: [] as { collection: string; field: string; projectId: string }[], metadataReads: [] as string[], originalReads: [] as { key: string; generation?: string }[],
  storageAvailable: true,
}));
vi.mock("@/lib/auth", () => ({ requireTabAccess: state.actor }));
vi.mock("@/lib/firebase-admin", () => {
  const file = (key: string, options?: { generation?: string }) => ({
    getMetadata: async () => {
      state.metadataReads.push(key);
      const object = state.objects.get(key);
      if (!object || object.missing) throw new Error("Synthetic missing object");
      return [{ size: String(object.size ?? object.bytes.length), contentType: object.contentType || "image/jpeg", generation: object.generation || "123" }];
    },
    createReadStream: () => {
      state.originalReads.push({ key, generation: options?.generation });
      const object = state.objects.get(key)!;
      if (object.failRead) return Readable.from((async function* () { yield Buffer.from("partial"); throw new Error("Synthetic transfer failed"); })());
      return Readable.from([object.bytes]);
    },
  });
  return {
    get projectBucket() { return state.storageAvailable ? { file } : null; },
    firestore: { collection: (collection: string) => ({ where: (field: string, _operator: string, projectId: string) => ({ get: async () => {
      state.queries.push({ collection, field, projectId });
      const rows = collection === "housePlannerAestheticFolders" ? state.folders : state.images;
      return { docs: [...rows].filter(([, data]) => data[field] === projectId).map(([id, data]) => ({ id, data: () => data })) };
    } }) }) },
  };
});

import { GET as downloadArchive } from "@/app/api/aesthetics/archive/route";
import { AESTHETIC_ARCHIVE_MAX_BYTES, AESTHETIC_ARCHIVE_MAX_IMAGE_BYTES, AESTHETIC_ARCHIVE_MAX_IMAGES, claimAestheticArchiveMemory } from "@/lib/aesthetic-archive";
import { projectStoragePrefix } from "@/lib/project";

const projectId = "project-1";
const prefix = `${projectStoragePrefix(projectId)}/aesthetics/`;
const responses: Response[] = [];
async function GET(input: Request) {
  const response = await downloadArchive(input);
  responses.push(response);
  return response;
}
const request = (folderId = "interior-1") => new Request(`http://localhost/api/aesthetics/archive?folderId=${encodeURIComponent(folderId)}`);
function folder(id: string, values: Row = {}) { state.folders.set(id, { projectId, name: id, parentId: null, kind: "images", ...values }); }
function image(id: string, folderId = "interior-1", values: Row = {}, object: Partial<StoredObject> = {}) {
  const key = `${prefix}${id}.jpg`;
  state.images.set(id, { projectId, folderId, fileName: "Vista.jpg", objectKey: key, thumbnailObjectKey: `${prefix}thumbnails/${id}.webp`, contentType: "image/jpeg", ...values });
  state.objects.set(String(values.objectKey || key), { bytes: Buffer.from(`original-${id}`), ...object });
}
async function files(response: Response) {
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const entries = Object.values(zip.files).filter(entry => !entry.dir);
  return Promise.all(entries.map(async entry => ({ name: entry.name, content: await entry.async("string") })));
}

beforeEach(() => {
  state.folders.clear(); state.images.clear(); state.objects.clear(); state.queries.length = 0; state.metadataReads.length = 0; state.originalReads.length = 0;
  state.storageAvailable = true;
  state.actor.mockReset().mockResolvedValue({ projectId, role: "viewer", email: "reader@example.test", readOnlyLink: true });
  folder("interior-1", { name: "Interior", carouselImageIds: ["foreign-photo", "exterior-1"] });
  folder("kitchen-1", { name: "Cocina", parentId: "interior-1" });
  folder("material-1", { name: "Materiales", parentId: "kitchen-1" });
  folder("exterior-1", { name: "Exterior" });
  image("living-01"); image("kitchen-01", "kitchen-1"); image("material-01", "material-1"); image("outside-01", "exterior-1");
});
afterEach(async () => {
  for (const response of responses.splice(0)) if (!response.bodyUsed) await response.body?.cancel().catch(() => undefined);
});

describe("complete aesthetic folder archive", () => {
  it("lets an authorized read-only visitor download stored originals in the folder and its descendants", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(state.actor).toHaveBeenCalledWith("aesthetics");
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Disposition")).toContain("attachment;");
    expect(response.headers.get("Content-Disposition")).toContain("Interior-imagenes.zip");
    expect((await files(response)).sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: "Interior/Cocina/Materiales/Vista.jpg", content: "original-material-01" },
      { name: "Interior/Cocina/Vista.jpg", content: "original-kitchen-01" },
      { name: "Interior/Vista.jpg", content: "original-living-01" },
    ]);
    expect(state.queries).toEqual([
      { collection: "housePlannerAestheticFolders", field: "projectId", projectId },
      { collection: "housePlannerAestheticImages", field: "projectId", projectId },
    ]);
    expect(state.originalReads).toHaveLength(3);
    expect(state.originalReads.every(read => read.generation === "123" && !read.key.includes("/thumbnails/") && !read.key.includes("outside-01"))).toBe(true);
  });

  it("requires aesthetics access before reading records or originals", async () => {
    state.actor.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(403);
    expect(state.queries).toEqual([]);
    expect(state.metadataReads).toEqual([]);
    expect(state.originalReads).toEqual([]);
  });

  it("rejects missing, foreign or deleted folders and malformed destinations", async () => {
    folder("foreign-1", { projectId: "other-project" }); folder("deleted-1", { deletedAt: true });
    for (const id of ["missing-1", "foreign-1", "deleted-1"]) expect((await GET(request(id))).status).toBe(404);
    for (const id of ["", "../escape", "bad/id"]) expect((await GET(request(id))).status).toBe(400);
    expect(state.originalReads).toEqual([]);
  });

  it("excludes PDFs, deleted images, deleted branches and foreign-project records regardless of carousel membership", async () => {
    image("pdf-0001", "kitchen-1", { contentType: "application/pdf", fileName: "Plano.pdf" });
    image("deleted-photo", "interior-1", { deletedAt: true });
    image("foreign-photo", "interior-1", { projectId: "other-project" });
    folder("deleted-branch", { parentId: "interior-1", deletedAt: true });
    folder("orphan-child", { parentId: "deleted-branch" }); image("orphan-photo", "orphan-child");
    folder("foreign-child", { parentId: "interior-1", projectId: "other-project" });
    image("foreign-child-photo", "foreign-child");
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await files(response)).toHaveLength(3);
    expect(state.metadataReads.every(key => !/pdf-0001|deleted-photo|foreign-photo|orphan-photo|foreign-child-photo|outside-01/.test(key))).toBe(true);
  });

  it("rejects a record pointing to a different project's object or a thumbnail as its original", async () => {
    image("invalid-object", "interior-1", { objectKey: `${projectStoragePrefix("other-project")}/aesthetics/foreign.jpg` });
    expect((await GET(request())).status).toBe(503);
    expect(state.metadataReads).toEqual([]);
    state.images.delete("invalid-object");
    image("thumbnail-object", "interior-1", { objectKey: `${prefix}thumbnails/photo.webp` });
    expect((await GET(request())).status).toBe(503);
    expect(state.originalReads).toEqual([]);
  });

  it("sanitizes and deduplicates names and uses each original's actual media extension", async () => {
    state.images.clear();
    state.folders.get("interior-1")!.name = "../Casa\r\nprincipal";
    state.folders.get("kitchen-1")!.name = "../Cocina";
    image("named-0001", "interior-1", { fileName: "../../Vista.png" });
    image("named-0002", "interior-1", { fileName: "../../Vista.png" });
    image("named-0003", "interior-1", { fileName: "CON.png" });
    image("named-0004", "kitchen-1", { fileName: "Luz.webp" }, { contentType: "image/webp" });
    const response = await GET(request());
    expect(response.status).toBe(200);
    const exported = await files(response);
    expect(exported).toHaveLength(4);
    expect(new Set(exported.map(entry => entry.name.toLocaleLowerCase())).size).toBe(4);
    expect(exported.some(entry => entry.name.endsWith(" (2).jpg"))).toBe(true);
    expect(exported.some(entry => entry.name.endsWith("/_CON.jpg"))).toBe(true);
    expect(exported.some(entry => entry.name.endsWith("/Luz.webp"))).toBe(true);
    for (const entry of exported) {
      expect(entry.name).not.toMatch(/[\\\r\n]/);
      expect(entry.name.startsWith("/")).toBe(false);
      expect(entry.name.split("/").every(part => part !== ".." && part !== ".")).toBe(true);
    }
    expect(response.headers.get("Content-Disposition")).not.toMatch(/[\r\n]/);
    expect(exported.map(entry => entry.content).sort()).toEqual(["original-named-0001", "original-named-0002", "original-named-0003", "original-named-0004"]);
  });

  it("keeps similarly named sibling folders separate and works for the legacy project's original prefix", async () => {
    folder("duplicate-child", { name: "Cocina", parentId: "interior-1" }); image("duplicate-photo", "duplicate-child");
    const exported = await files(await GET(request()));
    expect(exported.some(entry => entry.name.includes("/Cocina (2)/"))).toBe(true);
    expect(exported).toHaveLength(4);
    state.actor.mockResolvedValue({ projectId: "sample-house", role: "viewer" });
    state.folders.clear(); state.images.clear();
    folder("legacy-1", { projectId: "sample-house", name: "Casa" });
    image("legacy-photo", "legacy-1", { projectId: "sample-house", objectKey: `${projectStoragePrefix("sample-house")}/aesthetics/legacy.jpg` });
    expect((await GET(request("legacy-1"))).status).toBe(200);
    expect(state.originalReads.at(-1)?.key).toBe("house-planner/production/aesthetics/legacy.jpg");
  });

  it("returns a clear empty-folder error and never creates a PDF-only archive", async () => {
    state.images.clear();
    expect((await GET(request())).status).toBe(409);
    image("pdf-only", "interior-1", { contentType: "application/pdf" });
    expect((await GET(request())).status).toBe(409);
    expect(state.metadataReads).toEqual([]);
  });

  it("fails the entire request when an original is missing, truncated or fails while transferring", async () => {
    state.objects.get(`${prefix}kitchen-01.jpg`)!.missing = true;
    const missing = await GET(request());
    expect(missing.status).toBe(503);
    expect(missing.headers.get("Content-Type")).toContain("application/json");
    expect(state.originalReads).toEqual([]);
    state.objects.get(`${prefix}kitchen-01.jpg`)!.missing = false;
    state.objects.get(`${prefix}kitchen-01.jpg`)!.size = 100;
    expect((await GET(request())).status).toBe(503);
    state.objects.get(`${prefix}kitchen-01.jpg`)!.size = undefined;
    state.objects.get(`${prefix}kitchen-01.jpg`)!.failRead = true;
    expect((await GET(request())).status).toBe(503);
  });

  it("checks image count and byte limits before reading image bodies", async () => {
    state.images.clear();
    for (let index = 0; index <= AESTHETIC_ARCHIVE_MAX_IMAGES; index++) image(`many-${index}`);
    expect((await GET(request())).status).toBe(413);
    expect(state.metadataReads).toEqual([]);
    state.images.clear();
    image("large-01", "interior-1", {}, { size: AESTHETIC_ARCHIVE_MAX_IMAGE_BYTES + 1 });
    expect((await GET(request())).status).toBe(413);
    expect(state.originalReads).toEqual([]);
    state.images.clear();
    const perFile = Math.floor(AESTHETIC_ARCHIVE_MAX_BYTES / 8) + 1;
    for (let index = 0; index < 8; index++) image(`total-${index}`, "interior-1", {}, { size: perFile });
    expect((await GET(request())).status).toBe(413);
    expect(state.originalReads).toEqual([]);
  });

  it("returns unavailable storage without touching records or silently producing an empty ZIP", async () => {
    state.storageAvailable = false;
    expect((await GET(request())).status).toBe(503);
    expect(state.queries).toEqual([]);
  });

  it("returns a retryable 429 while the aggregate archive memory allowance is occupied", async () => {
    const release = claimAestheticArchiveMemory(AESTHETIC_ARCHIVE_MAX_BYTES);
    try {
      const response = await GET(request());
      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("3");
      expect((await response.json()).error).toContain("otra descarga");
      expect(state.originalReads).toEqual([]);
    } finally { release(); }
    expect((await GET(request())).status).toBe(200);
  });

  it("holds memory until the complete response is consumed and releases it after success or cancellation", async () => {
    const complete = await GET(request());
    expect(() => claimAestheticArchiveMemory(AESTHETIC_ARCHIVE_MAX_BYTES)).toThrow("otra descarga");
    await files(complete);
    const afterSuccess = claimAestheticArchiveMemory(AESTHETIC_ARCHIVE_MAX_BYTES);
    afterSuccess(); afterSuccess(); // Release is idempotent, never increasing allowance.
    const cancelled = await GET(request());
    expect(() => claimAestheticArchiveMemory(AESTHETIC_ARCHIVE_MAX_BYTES)).toThrow("otra descarga");
    await cancelled.body!.cancel();
    claimAestheticArchiveMemory(AESTHETIC_ARCHIVE_MAX_BYTES)();
  });

  it("releases the aggregate allowance after original-read errors and client aborts during response transmission", async () => {
    state.objects.get(`${prefix}kitchen-01.jpg`)!.failRead = true;
    expect((await GET(request())).status).toBe(503);
    claimAestheticArchiveMemory(AESTHETIC_ARCHIVE_MAX_BYTES)();
    state.objects.get(`${prefix}kitchen-01.jpg`)!.failRead = false;
    const abort = new AbortController();
    const response = await GET(new Request(request(), { signal: abort.signal }));
    expect(response.status).toBe(200);
    abort.abort();
    await expect(response.arrayBuffer()).rejects.toThrow("se canceló");
    claimAestheticArchiveMemory(AESTHETIC_ARCHIVE_MAX_BYTES)();
  });
});
