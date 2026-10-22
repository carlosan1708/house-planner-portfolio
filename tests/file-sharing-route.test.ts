import { createHash } from "node:crypto";
import { PassThrough, Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  actor: vi.fn(), records: new Map<string, Map<string, Record<string, unknown>>>(),
  file: vi.fn(), metadata: vi.fn(), download: vi.fn(), create: vi.fn(), authUser: vi.fn(), storageEnabled: true,
}));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth")>(), getSessionMember: mock.actor,
}));
vi.mock("@/lib/firebase-admin", () => {
  const collection = (name: string) => {
    const records = mock.records.get(name) || new Map<string, Record<string, unknown>>();
    mock.records.set(name, records);
    const doc = (id: string) => ({
      get: async () => ({ id, exists: records.has(id), data: () => records.get(id) }),
      create: async (data: Record<string, unknown>) => { mock.create(name, id, data); records.set(id, data); },
    });
    return { doc, where: (field: string, _operation: string, value: unknown) => ({
      get: async () => ({ docs: await Promise.all([...records].filter(([, data]) => data[field] === value).map(([id]) => doc(id).get())) }),
    }) };
  };
  return { adminAuth: { getUser: mock.authUser }, firestore: { collection }, get projectBucket() { return mock.storageEnabled ? { file: mock.file } : null; } };
});

import { GET, POST } from "@/app/api/files/share/route";
import { FILE_SHARE_LINKS, fileShareDisposition } from "@/lib/file-sharing";
import {
  AESTHETIC_FOLDERS, AESTHETIC_IMAGES, DEFAULT_FOLDER_ACCESS, DEFAULT_MEMBER_PERMISSIONS,
  DOCUMENTS, FOLDERS, LEGACY_PROJECT_ID, MEMBERSHIPS, USERS, membershipId,
  projectStoragePrefix, type MemberRecord,
} from "@/lib/project";

const projectId = "project-1", uid = "editor-1", generation = "1760644800000000";
const key = `${projectStoragePrefix(projectId)}/documents/document-1-example.pdf`;
const records = (collection: string) => {
  if (!mock.records.has(collection)) mock.records.set(collection, new Map());
  return mock.records.get(collection)!;
};
const body = (overrides: Record<string, unknown> = {}) => ({ kind: "document", id: "document-1", expiresInDays: 7, ...overrides });
const request = (input: unknown, headers: Record<string, string> = {}) => new Request("http://localhost/api/files/share", {
  method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost", ...headers }, body: JSON.stringify(input),
});
const actor = (overrides: Partial<MemberRecord> = {}): MemberRecord => ({
  uid, projectId, projectName: "Test", isPersonal: false, email: "editor@example.test", name: "Editor",
  status: "approved", role: "editor", permissions: { ...DEFAULT_MEMBER_PERMISSIONS }, folderAccess: { ...DEFAULT_FOLDER_ACCESS }, ...overrides,
});
const membership = () => records(MEMBERSHIPS).get(membershipId(projectId, uid))!;
const document = () => records(DOCUMENTS).get("document-1")!;
const download = (url: string) => GET(new Request(new URL(url, "http://localhost")));
async function createLink(input = body()) {
  const response = await POST(request(input));
  expect(response.status).toBe(200);
  return await response.json() as { url: string; expiresAt: string; expiresInDays: number };
}

beforeEach(() => {
  mock.records.clear();
  mock.storageEnabled = true;
  mock.create.mockReset();
  mock.authUser.mockReset().mockResolvedValue({ uid, disabled: false });
  mock.metadata.mockReset().mockResolvedValue([{ generation, size: "14" }]);
  mock.download.mockReset().mockImplementation(() => Readable.from([Buffer.from("original bytes")]));
  mock.file.mockReset().mockImplementation(() => ({ getMetadata: mock.metadata, createReadStream: mock.download }));
  mock.actor.mockReset().mockResolvedValue(actor());
  records(USERS).set(uid, { email: "editor@example.test", multiTenantReady: true });
  records(MEMBERSHIPS).set(membershipId(projectId, uid), { uid, projectId, role: "editor", status: "approved", permissions: { ...DEFAULT_MEMBER_PERMISSIONS }, folderAccess: { ...DEFAULT_FOLDER_ACCESS } });
  records(FOLDERS).set("root-1", { projectId, parentId: null, name: "Plans" });
  records(FOLDERS).set("child-1", { projectId, parentId: "root-1", name: "Ground floor" });
  records(DOCUMENTS).set("document-1", { projectId, folderId: "child-1", fileName: "Plan de la casa.pdf", objectKey: key });
  records(AESTHETIC_FOLDERS).set("interior-1", { projectId, parentId: null, name: "Interior" });
  records(AESTHETIC_FOLDERS).set("room-1", { projectId, parentId: "interior-1", name: "Room" });
  records(AESTHETIC_IMAGES).set("image-1", { projectId, folderId: "room-1", fileName: "Sala.jpg", objectKey: `${projectStoragePrefix(projectId)}/aesthetics/image-1-original.jpg` });
});

describe("file share capabilities", () => {
  it.each([1, 3, 7])("creates a %s-day link, stores only its hash, and downloads its pinned version without a session", async days => {
    const before = Date.now();
    const result = await createLink(body({ expiresInDays: days }));
    const after = Date.now();
    const token = new URL(result.url, "http://localhost").searchParams.get("token")!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const expires = new Date(result.expiresAt).getTime();
    expect(expires).toBeGreaterThanOrEqual(before + days * 86400000);
    expect(expires).toBeLessThanOrEqual(after + days * 86400000);
    const [hash, stored] = [...records(FILE_SHARE_LINKS)][0];
    expect(hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored).toMatchObject({ generation, projectId, sourceId: "document-1", createdByUid: uid, objectKey: key });
    expect(mock.create).toHaveBeenCalledTimes(1);
    mock.actor.mockResolvedValue(null);
    const response = await download(result.url);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("original bytes");
    expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(response.headers.get("Content-Length")).toBe("14");
    expect(response.headers.get("Content-Disposition")).toBe("attachment; filename*=UTF-8''Plan%20de%20la%20casa.pdf");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(mock.file).toHaveBeenLastCalledWith(key, { generation });
    expect(mock.download).toHaveBeenCalledWith({ decompress: false });
  });

  it("creates independent random links and supports aesthetics with its own tab permission", async () => {
    membership().permissions = { ...DEFAULT_MEMBER_PERMISSIONS, documents: false, aesthetics: true };
    membership().folderAccess = { mode: "selected", folderIds: [], allowUnfiled: false };
    const first = await createLink(body({ kind: "aesthetic", id: "image-1", expiresInDays: 3 }));
    const second = await createLink(body({ kind: "aesthetic", id: "image-1", expiresInDays: 3 }));
    expect(first.url).not.toBe(second.url);
    expect((await download(first.url)).status).toBe(200);
    membership().permissions = { ...DEFAULT_MEMBER_PERMISSIONS, aesthetics: false };
    expect((await download(first.url)).status).toBe(404);
  });

  it.each([
    { label: "missing session", value: null, status: 401 },
    { label: "viewer", value: actor({ role: "viewer" }), status: 403 },
    { label: "pending", value: actor({ status: "pending" }), status: 403 },
    { label: "removed", value: actor({ status: "rejected" }), status: 403 },
    { label: "anonymous link", value: actor({ anonymousLink: true }), status: 403 },
    { label: "account read link", value: actor({ accessLinkId: "read-link" }), status: 403 },
  ])("does not issue public access for $label", async ({ value, status }) => {
    mock.actor.mockResolvedValue(value);
    expect((await POST(request(body()))).status).toBe(status);
    expect(mock.create).not.toHaveBeenCalled();
    expect(mock.file).not.toHaveBeenCalled();
  });

  it.each([
    null, [], {}, { kind: "other", id: "document-1", expiresInDays: 7 },
    body({ id: "bad/id" }), body({ id: "" }), body({ expiresInDays: 8 }), body({ expiresInDays: "7" }),
    body({ expiresInDays: 0 }), body({ objectKey: "arbitrary/private/file" }), body({ projectId: "another-project" }),
  ])("rejects malformed IDs, expiration and client storage selection: %j", async input => {
    expect((await POST(request(input))).status).toBe(400);
    expect(mock.create).not.toHaveBeenCalled();
  });

  it("requires a matching browser origin and does not trust forwarded-host", async () => {
    expect((await POST(request(body(), { Origin: "https://external.example" }))).status).toBe(403);
    expect((await POST(request(body(), { Origin: "https://external.example", "x-forwarded-host": "external.example" }))).status).toBe(403);
    const noOrigin = new Request("http://localhost/api/files/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body()) });
    expect((await POST(noOrigin)).status).toBe(403);
    expect(mock.create).not.toHaveBeenCalled();
  });

  it("allows selected descendants while denying other folders, unfiled files and missing Documents access", async () => {
    membership().folderAccess = { mode: "selected", folderIds: ["root-1"], allowUnfiled: false };
    await createLink();
    membership().folderAccess = { mode: "selected", folderIds: ["other-root"], allowUnfiled: false };
    expect((await POST(request(body()))).status).toBe(404);
    document().folderId = null;
    expect((await POST(request(body()))).status).toBe(404);
    membership().folderAccess = { mode: "all" };
    membership().permissions = { ...DEFAULT_MEMBER_PERMISSIONS, documents: false };
    expect((await POST(request(body()))).status).toBe(404);
  });

  it.each(["Factura", "Compras"])("requires Expenses for %s descendants even when Documents access is granted", async folderName => {
    records(FOLDERS).get("root-1")!.name = folderName;
    expect((await POST(request(body()))).status).toBe(404);
    membership().permissions = { ...DEFAULT_MEMBER_PERMISSIONS, expenses: true, documents: false };
    membership().folderAccess = { mode: "selected", folderIds: [], allowUnfiled: false };
    const link = await createLink();
    expect((await download(link.url)).status).toBe(200);
    membership().permissions = { ...DEFAULT_MEMBER_PERMISSIONS, expenses: false };
    expect((await download(link.url)).status).toBe(404);
  });

  it.each([
    { projectId: "another-project" }, { deletedAt: new Date() }, { objectKey: "house-planner/projects/other/documents/file.pdf" },
    { objectKey: `${projectStoragePrefix(projectId)}/documents/../private.pdf` }, { objectKey: `${projectStoragePrefix(projectId)}/private/book.xlsx` },
    { folderId: "missing-folder" },
  ])("does not issue links for unavailable or invalid source metadata: %j", async update => {
    Object.assign(document(), update);
    expect((await POST(request(body()))).status).toBe(404);
    expect(mock.create).not.toHaveBeenCalled();
  });

  it.each([{ encrypted: true }, { vaultFolderId: "root-1" }, { encryptedMetadata: "sealed" }, { encryptionCleanupPending: true }])("blocks protected or incomplete encryption metadata: %j", async update => {
    Object.assign(document(), update);
    expect((await POST(request(body()))).status).toBe(409);
    expect(mock.file).not.toHaveBeenCalled();
    expect(mock.create).not.toHaveBeenCalled();
  });

  it.each([
    { encrypted: true }, { vault: {} }, { deletedAt: new Date() }, { projectId: "other-project" }, { parentId: "child-1" }, { parentId: "missing" },
  ])("fails closed for inherited vaults and broken ancestor paths: %j", async update => {
    Object.assign(records(FOLDERS).get("root-1")!, update);
    expect([404, 409]).toContain((await POST(request(body()))).status);
    expect(mock.file).not.toHaveBeenCalled();
  });

  it("checks every aesthetic ancestor belongs to the same active project", async () => {
    records(AESTHETIC_FOLDERS).get("interior-1")!.projectId = "other-project";
    expect((await POST(request(body({ kind: "aesthetic", id: "image-1" })))).status).toBe(404);
    records(AESTHETIC_FOLDERS).get("interior-1")!.projectId = projectId;
    const link = await createLink(body({ kind: "aesthetic", id: "image-1" }));
    records(AESTHETIC_FOLDERS).get("interior-1")!.deletedAt = new Date();
    expect((await download(link.url)).status).toBe(404);
  });

  it("rejects altered, expired, revoked and malformed bearer tokens without exposing them", async () => {
    const link = await createLink();
    const url = new URL(link.url, "http://localhost");
    const token = url.searchParams.get("token")!;
    url.searchParams.set("token", `${token[0] === "A" ? "B" : "A"}${token.slice(1)}`);
    expect((await download(url.toString())).status).toBe(404);
    const stored = [...records(FILE_SHARE_LINKS).values()][0];
    stored.expiresAt = new Date(Date.now() - 1);
    const expired = await download(link.url);
    expect(expired.status).toBe(410);
    expect(await expired.text()).not.toContain(token);
    stored.expiresAt = new Date(Date.now() + 86400000);
    stored.revokedAt = new Date();
    expect((await download(link.url)).status).toBe(404);
    for (const invalid of ["", "../secret", "x".repeat(1000)]) expect((await download(`/api/files/share?token=${encodeURIComponent(invalid)}`)).status).toBe(404);
    expect(mock.download).not.toHaveBeenCalled();
  });

  it.each([
    { deletedAt: new Date() }, { projectId: "other-project" }, { encrypted: true },
    { encryptionCleanupPending: true }, { objectKey: `${projectStoragePrefix(projectId)}/documents/replacement.pdf` },
  ])("revalidates source state at public download: %j", async update => {
    const link = await createLink();
    Object.assign(document(), update);
    expect((await download(link.url)).status).toBe(404);
    expect(mock.download).not.toHaveBeenCalled();
  });

  it("stops existing shares when their folder becomes encrypted or creator loses folder grants", async () => {
    const link = await createLink();
    records(FOLDERS).get("root-1")!.encrypted = true;
    expect((await download(link.url)).status).toBe(404);
    records(FOLDERS).get("root-1")!.encrypted = false;
    membership().folderAccess = { mode: "selected", folderIds: [], allowUnfiled: false };
    expect((await download(link.url)).status).toBe(404);
    expect(mock.download).not.toHaveBeenCalled();
  });

  it.each([
    { status: "rejected" }, { role: "viewer" }, { removed: true }, { accessLinkId: "read-link" },
    { anonymousLink: true }, { projectId: "other-project" }, { uid: "other-user" },
  ])("revalidates creator membership for issued links: %j", async update => {
    const link = await createLink();
    Object.assign(membership(), update);
    expect((await download(link.url)).status).toBe(404);
    expect(mock.download).not.toHaveBeenCalled();
  });

  it("does not revive removed identities or missing project memberships", async () => {
    const link = await createLink();
    records(USERS).delete(uid);
    expect((await download(link.url)).status).toBe(404);
    records(USERS).set(uid, { status: "approved", role: "admin" });
    records(MEMBERSHIPS).delete(membershipId(projectId, uid));
    expect((await download(link.url)).status).toBe(404);
  });

  it("rejects a creator disabled or deleted in Firebase Auth even when stored membership remains approved", async () => {
    const link = await createLink();
    mock.authUser.mockResolvedValue({ uid, disabled: true });
    expect((await download(link.url)).status).toBe(404);
    mock.authUser.mockRejectedValue({ code: "auth/user-not-found", message: "internal identity details" });
    expect((await download(link.url)).status).toBe(404);
    expect(mock.download).not.toHaveBeenCalled();
    mock.authUser.mockRejectedValue(new Error("secret Auth configuration"));
    const unavailable = await download(link.url);
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).not.toContain("secret");
  });

  it("supports legacy independent creators only while they have no migrated membership", async () => {
    const legacyActor = actor({ projectId: LEGACY_PROJECT_ID });
    mock.actor.mockResolvedValue(legacyActor);
    records(MEMBERSHIPS).clear();
    records(USERS).set(uid, { role: "admin", status: "approved" });
    records(DOCUMENTS).set("document-1", { projectId: LEGACY_PROJECT_ID, objectKey: `${projectStoragePrefix(LEGACY_PROJECT_ID)}/documents/document-1-plan.pdf` });
    const link = await createLink();
    expect((await download(link.url)).status).toBe(200);
    records(MEMBERSHIPS).set("another-membership", { uid, projectId: "another-project", role: "admin", status: "approved" });
    expect((await download(link.url)).status).toBe(404);
  });

  it("does not fall back to newer object bytes when the shared generation disappears", async () => {
    const link = await createLink();
    mock.metadata.mockRejectedValue({ code: 404, message: "internal object location" });
    const response = await download(link.url);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("internal");
    expect(mock.file).toHaveBeenLastCalledWith(key, { generation });
    expect(mock.download).not.toHaveBeenCalled();
  });

  it("refuses a storage response for a different generation and closes the read stream on download cancellation", async () => {
    const link = await createLink();
    mock.metadata.mockResolvedValue([{ generation: "1760644800000001", size: "14" }]);
    expect((await download(link.url)).status).toBe(404);
    expect(mock.download).not.toHaveBeenCalled();
    mock.metadata.mockResolvedValue([{ generation, size: "14" }]);
    const source = new PassThrough();
    mock.download.mockReturnValue(source);
    const response = await download(link.url);
    await response.body!.cancel();
    expect(source.destroyed).toBe(true);
  });

  it("returns a private generic 503 when storage is absent or inaccessible", async () => {
    mock.storageEnabled = false;
    expect((await POST(request(body()))).status).toBe(503);
    mock.storageEnabled = true;
    mock.metadata.mockRejectedValue(new Error("secret credentials"));
    const response = await POST(request(body()));
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).not.toContain("secret");
    expect(mock.create).not.toHaveBeenCalled();
  });

  it.each([undefined, "not-a-generation", "999999999999999999999999"])("does not issue a link unless the object generation can be pinned exactly: %s", async invalidGeneration => {
    mock.metadata.mockResolvedValue([{ generation: invalidGeneration }]);
    expect((await POST(request(body()))).status).toBe(503);
    expect(mock.create).not.toHaveBeenCalled();
  });

  it("encodes untrusted names as safe attachment filenames", () => {
    expect(fileShareDisposition("<html>/evil\\name\r\n'*.svg")).toBe("attachment; filename*=UTF-8''%3Chtml%3E_evil_name__%27%2A.svg");
  });
});
