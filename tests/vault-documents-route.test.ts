import { beforeEach, describe, expect, it, vi } from "vitest";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import sharp from "sharp";
import { DEFAULT_MEMBER_PERMISSIONS, DOCUMENTS, FOLDERS, MEMBERSHIPS, type MemberRecord } from "@/lib/project";
import { decryptVaultBytes, encryptVaultBytes, unwrapVault, type FolderVault } from "@/lib/folder-vault-crypto";
import { openVaultDocument, sealVaultDocument, vaultDocumentContext } from "@/lib/vault-documents";
import { findExpenseInvoiceFolder, findExpensePurchaseFolder } from "@/lib/folders";

const mocks = vi.hoisted(() => {
  const records = new Map<string, Record<string, unknown>>();
  const revisions = new Map<string, number>();
  const directUpdate = vi.fn();
  let sequence = 0;
  const reference = (collection: string, id?: string) => {
    const key = id || `generated-${++sequence}`;
    const path = `${collection}/${key}`;
    return { id: key, path, get: async () => snapshot(path), update: (data: Record<string, unknown>) => directUpdate(path, data) };
  };
  const snapshot = (path: string) => {
    const data = records.has(path) ? { ...records.get(path)! } : undefined;
    return {
      id: path.split("/").pop()!, ref: reference(path.slice(0, path.lastIndexOf("/")), path.split("/").pop()!),
      exists: records.has(path), updateTime: revisions.get(path) ?? 0,
      data: () => data ? { ...data } : undefined,
    };
  };
  return {
    records, revisions, reference, snapshot, directUpdate,
    actor: null as MemberRecord | null,
    objects: new Map<string, Buffer>(),
    save: vi.fn(), download: vi.fn(), delete: vi.fn(),
    vaultAccess: vi.fn(), commitActivity: vi.fn(), canAccessFolder: vi.fn(),
    index: vi.fn(), removeIndex: vi.fn(), updateIndex: vi.fn(),
    reset: () => { records.clear(); revisions.clear(); sequence = 0; },
  };
});

vi.mock("@/lib/auth", () => ({
  getSessionMember: async () => mocks.actor,
  requireTabAccess: async (tab: keyof MemberRecord["permissions"], roles?: string[]) => {
    const actor = mocks.actor;
    return actor?.status === "approved" && (!roles || roles.includes(actor.role))
      && (actor.role === "admin" || actor.permissions[tab]) ? actor : null;
  },
  canAccessFolder: mocks.canAccessFolder,
}));
vi.mock("@/lib/firebase-admin", () => ({
  firestore: {
    collection: (name: string) => ({
      doc: (id?: string) => mocks.reference(name, id),
      where: (field: string, _operator: string, value: unknown) => ({
        get: async () => ({ docs: [...mocks.records]
          .filter(([path, data]) => path.startsWith(`${name}/`) && data[field] === value)
          .map(([path]) => mocks.snapshot(path)) }),
      }),
    }),
  },
  projectBucket: {
    file: (key: string) => ({
      save: (bytes: Buffer, options: unknown) => mocks.save(key, bytes, options),
      download: () => mocks.download(key),
      delete: (options: unknown) => mocks.delete(key, options),
    }),
  },
}));
vi.mock("@/lib/activity", () => ({ commitActivity: mocks.commitActivity }));
vi.mock("@/lib/document-index", () => ({
  indexDocumentBytes: mocks.index, removeDocumentIndex: mocks.removeIndex, updateDocumentIndexFolder: mocks.updateIndex,
}));
vi.mock("@/lib/quote-context", () => ({ isQuoteDocument: () => true }));
vi.mock("@/lib/folder-vault", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/folder-vault")>(),
  vaultAccess: mocks.vaultAccess,
}));

import { GET as getFiles, POST as uploadFile, PATCH as patchFile } from "@/app/api/files/route";
import { GET as getFolders, POST as createFolder, PATCH as patchFolder } from "@/app/api/folders/route";

const key = Buffer.alloc(32, 7);
const ordinarySource = "house-planner/projects/p1/documents/old-source.pdf";
const ordinaryThumb = "house-planner/projects/p1/thumbnails/old-thumb.webp";
const owner: MemberRecord = {
  uid: "owner", projectId: "p1", projectName: "House", isPersonal: false, email: "owner@test.local", name: "Owner",
  role: "admin", status: "approved", permissions: { ...DEFAULT_MEMBER_PERMISSIONS },
  folderAccess: { mode: "all", folderIds: [], allowUnfiled: true },
};

function writeRecord(path: string, update: Record<string, unknown>, merge = false) {
  const next = merge ? { ...mocks.records.get(path) } : {};
  for (const [field, value] of Object.entries(update)) {
    if (value instanceof FieldValue && value.isEqual(FieldValue.delete())) delete next[field];
    else if (value instanceof FieldValue && value.isEqual(FieldValue.serverTimestamp())) next[field] = Timestamp.fromMillis(1_800_000_000_000);
    else if (value instanceof FieldValue && value.constructor.name === "NumericIncrementTransform") next[field] = Number(next[field] || 0) + Number((value as unknown as { operand: number }).operand);
    else next[field] = value;
  }
  mocks.records.set(path, next);
  mocks.revisions.set(path, (mocks.revisions.get(path) || 0) + 1);
}

function seedProtected(id: string, bytes: Buffer, contentType = "application/pdf", folderId = "vault") {
  const objectKey = `documents/${id}.enc`;
  mocks.objects.set(objectKey, encryptVaultBytes(bytes, key, vaultDocumentContext("p1", id, "content")));
  writeRecord(`${DOCUMENTS}/${id}`, {
    projectId: "p1", folderId, objectKey, createdAt: Timestamp.fromMillis(1_800_000_000_000),
    ...sealVaultDocument({ fileName: "private-contract.pdf", contentType, size: bytes.length, uploadedBy: owner.email, description: "Private legal description" }, key, "p1", id, "vault"),
  });
}

const jsonRequest = (path: string, method: string, body: Record<string, unknown>) => new Request(`http://localhost/api/${path}`, {
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const uploadRequest = (bytes: Buffer, name = "private-image.png", type = "image/png", folderId = "vault") => {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], name, { type }));
  form.set("folderId", folderId);
  return new Request("http://localhost/api/files", { method: "POST", body: form });
};

beforeEach(() => {
  vi.stubEnv("HOUSE_PLANNER_VAULT_RECOVERY_KEY", "ab".repeat(32));
  vi.clearAllMocks();
  mocks.reset(); mocks.objects.clear();
  mocks.actor = { ...owner };
  mocks.canAccessFolder.mockReturnValue(true);
  mocks.vaultAccess.mockImplementation(async () => new Map([["vault", { granted: true, key,
    expiresAt: Date.now() + 900_000, revision: mocks.revisions.get(`${FOLDERS}/vault`),
  }]]));
  mocks.index.mockResolvedValue({ status: "ready" });
  mocks.save.mockImplementation(async (objectKey: string, bytes: Buffer) => { mocks.objects.set(objectKey, Buffer.from(bytes)); });
  mocks.download.mockImplementation(async (objectKey: string) => {
    const bytes = mocks.objects.get(objectKey);
    if (!bytes) throw new Error(`Missing object: ${objectKey}`);
    return [Buffer.from(bytes)];
  });
  mocks.delete.mockImplementation(async (objectKey: string) => { mocks.objects.delete(objectKey); });
  mocks.directUpdate.mockImplementation(async (path: string, data: Record<string, unknown>) => writeRecord(path, data, true));
  mocks.commitActivity.mockImplementation(async (_actor, _event, mutate) => {
    const writes: (() => void)[] = [];
    mutate({
      set: (ref: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }) => writes.push(() => writeRecord(ref.path, data, options?.merge)),
      update: (ref: { path: string }, data: Record<string, unknown>, condition: { lastUpdateTime: number }) => {
        if (condition.lastUpdateTime !== (mocks.revisions.get(ref.path) ?? 0)) throw new Error("Stale document");
        writes.push(() => writeRecord(ref.path, data, true));
      },
      delete: (ref: { path: string }) => writes.push(() => mocks.records.delete(ref.path)),
    });
    writes.forEach((write) => write());
  });
  for (const folder of [
    { id: "vault", name: "Protected", parentId: null, encrypted: true },
    { id: "secret-child", name: "Private contracts", parentId: "vault" },
    { id: "public", name: "Ordinary", parentId: null },
    { id: "public-child", name: "Ordinary child", parentId: "public" },
  ]) writeRecord(`${FOLDERS}/${folder.id}`, { ...folder, projectId: "p1" });
});

describe("encrypted document API", () => {
  it("uploads encrypted bytes and sealed names without persisting thumbnails or plaintext AI indexes", async () => {
    const bytes = await sharp({ create: { width: 12, height: 12, channels: 3, background: "red" } }).png().toBuffer();
    const response = await uploadFile(uploadRequest(bytes));
    expect(response.status).toBe(201);
    const { id, aiIndexStatus } = await response.json();
    expect(aiIndexStatus).toBe("encrypted");
    const stored = mocks.records.get(`${DOCUMENTS}/${id}`)!;
    expect(stored).toMatchObject({ fileName: "Encrypted document", contentType: "application/octet-stream", encrypted: true, vaultFolderId: "vault" });
    for (const field of ["uploadedBy", "thumbnailObjectKey", "description", "aiText", "aiDescription"]) expect(stored).not.toHaveProperty(field);
    expect(JSON.stringify(stored)).not.toContain("private-image.png");
    expect(String(stored.objectKey)).not.toContain("private-image.png");
    const ciphertext = mocks.objects.get(String(stored.objectKey))!;
    expect(ciphertext.equals(bytes)).toBe(false);
    expect(decryptVaultBytes(ciphertext, key, vaultDocumentContext("p1", id, "content"))).toEqual(bytes);
    expect(openVaultDocument(stored, key, "p1", id)).toMatchObject({ fileName: "private-image.png", uploadedBy: owner.email });
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][2]).toEqual({ contentType: "application/octet-stream", resumable: false });
    expect(mocks.index).not.toHaveBeenCalled();
    expect(mocks.commitActivity.mock.calls[0][1]).toMatchObject({ target: { label: "Encrypted document" }, visibility: { adminOnly: true } });
  });

  it.each([
    { label: "ungranted", granted: false, expectedStatus: 404 },
    { label: "locked", granted: true, expectedStatus: 423 },
  ])("denies direct downloads, previews and file listings for $label folders despite generic all-folder access", async ({ granted, expectedStatus }) => {
    seedProtected("secret", Buffer.from("Private PDF bytes"));
    mocks.actor = { ...owner, uid: "editor", role: "editor" };
    mocks.vaultAccess.mockResolvedValue(new Map([["vault", { granted, key: null }]]));
    for (const suffix of ["", "&preview=pdf", "&preview=thumb"]) {
      const response = await getFiles(new Request(`http://localhost/api/files?id=secret${suffix}`));
      expect(response.status).toBe(expectedStatus);
    }
    const list = await getFiles(new Request("http://localhost/api/files"));
    expect(await list.json()).toMatchObject({ documents: [] });
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("rejects locked and ungranted uploads before storing any bytes", async () => {
    mocks.vaultAccess.mockResolvedValue(new Map([["vault", { granted: true, key: null }]]));
    expect((await uploadFile(uploadRequest(Buffer.from("secret"), "secret.pdf", "application/pdf"))).status).toBe(423);
    mocks.vaultAccess.mockResolvedValue(new Map([["vault", { granted: false, key: null }]]));
    expect((await uploadFile(uploadRequest(Buffer.from("secret"), "secret.pdf", "application/pdf"))).status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.commitActivity).not.toHaveBeenCalled();
  });

  it("cannot publish an upload after the protected root changes during storage transfer", async () => {
    mocks.save.mockImplementationOnce(async (objectKey: string, bytes: Buffer) => {
      mocks.objects.set(objectKey, Buffer.from(bytes));
      writeRecord(`${FOLDERS}/vault`, { grantChangedAt: Timestamp.now() }, true);
    });
    await expect(uploadFile(uploadRequest(Buffer.from("secret"), "private.pdf", "application/pdf"))).rejects.toThrow("Stale document");
    expect([...mocks.records.keys()].some((path) => path.startsWith(`${DOCUMENTS}/`))).toBe(false);
    expect(mocks.objects.size).toBe(0);
    expect(mocks.index).not.toHaveBeenCalled();
  });

  it("rejects inconsistent document protection before reading storage instead of falling back to plaintext", async () => {
    writeRecord(`${DOCUMENTS}/plaintext-in-vault`, { projectId: "p1", folderId: "vault", objectKey: "plain.pdf", fileName: "plain.pdf", contentType: "application/pdf" });
    const inconsistentPlaintext = await getFiles(new Request("http://localhost/api/files?id=plaintext-in-vault"));
    expect(inconsistentPlaintext.status).toBe(409);
    seedProtected("encrypted-in-public", Buffer.from("secret"), "application/pdf", "public");
    const orphanedCiphertext = await getFiles(new Request("http://localhost/api/files?id=encrypted-in-public"));
    expect(orphanedCiphertext.status).toBe(409);
    expect(mocks.download).not.toHaveBeenCalled();
    expect((await (await getFiles(new Request("http://localhost/api/files"))).json()).documents).toEqual([]);
  });

  it("decrypts authorized downloads and descriptions with private no-store responses", async () => {
    const bytes = Buffer.from("Private PDF bytes");
    seedProtected("secret", bytes, "application/pdf", "secret-child");
    const response = await getFiles(new Request("http://localhost/api/files?id=secret"));
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain("private-contract.pdf");
    const list = await getFiles(new Request("http://localhost/api/files"));
    expect(list.headers.get("cache-control")).toBe("private, no-store");
    expect(await list.json()).toMatchObject({ documents: [{ id: "secret", name: "private-contract.pdf", description: "Private legal description" }] });
  });

  it("aliases a removed uploader after unlocking without rewriting encrypted metadata", async () => {
    seedProtected("secret", Buffer.from("Private PDF bytes"));
    const stored = { ...mocks.records.get(`${DOCUMENTS}/secret`)! };
    writeRecord(`${MEMBERSHIPS}/p1__former`, { projectId: "p1", uid: "former", removed: true, removedEmail: owner.email,
      removedAt: Timestamp.fromMillis(1_800_000_001_000) });
    const list = await getFiles(new Request("http://localhost/api/files"));
    expect(await list.json()).toMatchObject({ documents: [{ id: "secret", uploadedBy: "Usuario desactivado", name: "private-contract.pdf" }] });
    expect(mocks.records.get(`${DOCUMENTS}/secret`)).toEqual(stored);
    expect(openVaultDocument(stored, key, "p1", "secret").uploadedBy).toBe(owner.email);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("generates authorized thumbnails in memory and never persists decrypted image content", async () => {
    const bytes = await sharp({ create: { width: 24, height: 16, channels: 3, background: "blue" } }).png().toBuffer();
    seedProtected("image", bytes, "image/png");
    const response = await getFiles(new Request("http://localhost/api/files?id=image&preview=thumb"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toBe("image/webp");
    const thumbnail = Buffer.from(await response.arrayBuffer());
    expect((await sharp(thumbnail).metadata()).format).toBe("webp");
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.objects.size).toBe(1);
  });

  it("encrypts ordinary content and metadata when moving into an unlocked vault, deleting previous copies and derivatives", async () => {
    const bytes = Buffer.from("Ordinary source that becomes confidential");
    mocks.objects.set(ordinarySource, bytes); mocks.objects.set(ordinaryThumb, Buffer.from("old thumbnail"));
    writeRecord(`${DOCUMENTS}/ordinary`, { projectId: "p1", folderId: "public", objectKey: ordinarySource, thumbnailObjectKey: ordinaryThumb, fileName: "confidential-contract.pdf", contentType: "application/pdf", size: bytes.length, uploadedBy: owner.email,
      description: "Private payment terms", aiText: "Private full text", aiDescription: "Private summary", aiIndexProvider: "local-text", quoteReferenceEnabled: true });
    const response = await patchFile(jsonRequest("files", "PATCH", { id: "ordinary", folderId: "secret-child" }));
    expect(response.status).toBe(200);
    const stored = mocks.records.get(`${DOCUMENTS}/ordinary`)!;
    expect(stored).toMatchObject({ folderId: "secret-child", encrypted: true, vaultFolderId: "vault", quoteReferenceEnabled: false, aiIndexStatus: "encrypted" });
    for (const field of ["thumbnailObjectKey", "description", "aiText", "aiDescription", "aiIndexProvider", "uploadedBy"]) expect(stored).not.toHaveProperty(field);
    expect(JSON.stringify(stored)).not.toContain("confidential-contract.pdf");
    expect(JSON.stringify(stored)).not.toContain("Private payment terms");
    expect(openVaultDocument(stored, key, "p1", "ordinary")).toMatchObject({ fileName: "confidential-contract.pdf", description: "Private payment terms" });
    expect(decryptVaultBytes(mocks.objects.get(String(stored.objectKey))!, key, vaultDocumentContext("p1", "ordinary", "content"))).toEqual(bytes);
    expect(mocks.delete).toHaveBeenCalledWith(ordinarySource, { ignoreNotFound: true });
    expect(mocks.delete).toHaveBeenCalledWith(ordinaryThumb, { ignoreNotFound: true });
    expect(mocks.objects.size).toBe(1);
    expect(mocks.index).not.toHaveBeenCalled();
  });

  it("keeps encrypted documents protected when a caller requests a public destination", async () => {
    seedProtected("secret", Buffer.from("Private PDF bytes"));
    const before = mocks.records.get(`${DOCUMENTS}/secret`)!;
    const response = await patchFile(jsonRequest("files", "PATCH", { id: "secret", folderId: "public" }));
    expect(response.status).toBe(409);
    expect(mocks.records.get(`${DOCUMENTS}/secret`)).toEqual(before);
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.commitActivity).not.toHaveBeenCalled();
  });

  it.each([{ source: "mobile_capture" }, { captureId: "capture-linked-123" }])("refuses to migrate linked mobile capture copies into a vault ($source $captureId)", async (link) => {
    const bytes = Buffer.from("Linked capture that remains shared in Decisions");
    mocks.objects.set(ordinarySource, bytes);
    writeRecord(`${DOCUMENTS}/capture`, { projectId: "p1", folderId: "public", objectKey: ordinarySource,
      fileName: "capture-photo.png", contentType: "image/png", description: "Shared capture note", ...link });
    const before = mocks.records.get(`${DOCUMENTS}/capture`)!;
    const response = await patchFile(jsonRequest("files", "PATCH", { id: "capture", folderId: "vault" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("Linked mobile captures") });
    expect(mocks.records.get(`${DOCUMENTS}/capture`)).toEqual(before);
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
    expect(mocks.commitActivity).not.toHaveBeenCalled();
  });

  it.each(["download", "list", "same PATCH"])("blocks incomplete migration and safely retries source cleanup through %s", async (retry) => {
    const bytes = Buffer.from("Content being moved into protection");
    mocks.objects.set(ordinarySource, bytes); mocks.objects.set(ordinaryThumb, Buffer.from("old thumbnail"));
    writeRecord(`${DOCUMENTS}/ordinary`, { projectId: "p1", folderId: "public", objectKey: ordinarySource, thumbnailObjectKey: ordinaryThumb,
      fileName: "private-payment-terms.pdf", contentType: "application/pdf", description: "Private terms", aiText: "Private extracted text" });
    mocks.delete.mockImplementation(async (objectKey: string) => {
      if (objectKey === ordinarySource) throw new Error("Storage deletion unavailable");
      mocks.objects.delete(objectKey);
    });
    const first = await patchFile(jsonRequest("files", "PATCH", { id: "ordinary", folderId: "vault" }));
    expect(first.status).toBe(503);
    const pending = mocks.records.get(`${DOCUMENTS}/ordinary`)!;
    expect(pending).toMatchObject({ encrypted: true, folderId: "vault", encryptionCleanupPending: true,
      encryptionCleanupKeys: [ordinarySource, ordinaryThumb] });
    expect(pending).not.toHaveProperty("aiText");
    expect(pending).not.toHaveProperty("description");
    expect(JSON.stringify(pending)).not.toContain("private-payment-terms.pdf");
    mocks.download.mockClear();
    const blocked = await getFiles(new Request("http://localhost/api/files?id=ordinary"));
    expect(blocked.status).toBe(503);
    const hidden = await getFiles(new Request("http://localhost/api/files"));
    expect(await hidden.json()).toEqual({ documents: [], encryptionCleanupPending: 1 });
    expect(mocks.download).not.toHaveBeenCalled();
    mocks.delete.mockImplementation(async (objectKey: string) => { mocks.objects.delete(objectKey); });
    const completed = retry === "same PATCH"
      ? await patchFile(jsonRequest("files", "PATCH", { id: "ordinary", folderId: "vault" }))
      : await getFiles(new Request(`http://localhost/api/files${retry === "download" ? "?id=ordinary" : ""}`));
    expect(completed.status).toBe(200);
    if (retry === "download") expect(Buffer.from(await completed.arrayBuffer())).toEqual(bytes);
    if (retry === "list") expect(await completed.json()).toMatchObject({ documents: [{ id: "ordinary", name: "private-payment-terms.pdf" }], encryptionCleanupPending: 0 });
    const stored = mocks.records.get(`${DOCUMENTS}/ordinary`)!;
    expect(stored.encryptionCleanupPending).toBe(false);
    expect(stored).not.toHaveProperty("encryptionCleanupKeys");
    expect(mocks.objects.has(ordinarySource)).toBe(false);
    expect(mocks.objects.has(ordinaryThumb)).toBe(false);
    expect(mocks.objects.size).toBe(1);
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it("seals edited descriptions without creating a plaintext derivative", async () => {
    seedProtected("secret", Buffer.from("Private PDF bytes"));
    const response = await patchFile(jsonRequest("files", "PATCH", { id: "secret", description: "Sensitive updated clauses" }));
    expect(response.status).toBe(200);
    const stored = mocks.records.get(`${DOCUMENTS}/secret`)!;
    expect(stored).not.toHaveProperty("description");
    expect(JSON.stringify(stored)).not.toContain("Sensitive updated clauses");
    expect(openVaultDocument(stored, key, "p1", "secret").description).toBe("Sensitive updated clauses");
  });

  it("retains plaintext source only when migration fails and cleans the uncommitted encrypted candidate", async () => {
    const bytes = Buffer.from("Original file"); mocks.objects.set("original.pdf", bytes);
    writeRecord(`${DOCUMENTS}/ordinary`, { projectId: "p1", folderId: "public", objectKey: "original.pdf", fileName: "original.pdf", contentType: "application/pdf" });
    mocks.commitActivity.mockRejectedValueOnce(new Error("Firestore failed"));
    await expect(patchFile(jsonRequest("files", "PATCH", { id: "ordinary", folderId: "vault" }))).rejects.toThrow("Firestore failed");
    expect(mocks.objects).toEqual(new Map([["original.pdf", bytes]]));
    expect(mocks.records.get(`${DOCUMENTS}/ordinary`)).toMatchObject({ folderId: "public", objectKey: "original.pdf" });
  });
});

describe("encrypted folder API", () => {
  it("shows an approved locked root but hides descendants, and hides the entire vault without an explicit grant", async () => {
    mocks.vaultAccess.mockResolvedValue(new Map([["vault", { granted: true, key: null }]]));
    const locked = await getFolders();
    const lockedPayload = await locked.json();
    expect(locked.headers.get("cache-control")).toBe("private, no-store");
    expect(lockedPayload.folders.map((folder: { id: string }) => folder.id).sort()).toEqual(["public", "public-child", "vault"]);
    expect(lockedPayload.folders.find((folder: { id: string }) => folder.id === "vault")).toMatchObject({ encrypted: true, unlocked: false });
    mocks.actor = { ...owner, uid: "editor", role: "editor" };
    mocks.vaultAccess.mockResolvedValue(new Map([["vault", { granted: false, key: null }]]));
    const denied = await getFolders();
    expect((await denied.json()).folders.map((folder: { id: string }) => folder.id).sort()).toEqual(["public", "public-child"]);
  });

  it("reveals descendants after authorized password unlock", async () => {
    const response = await getFolders();
    expect((await response.json()).folders.map((folder: { id: string }) => folder.id).sort()).toEqual(["public", "public-child", "secret-child", "vault"]);
  });

  it("limits protected folder creation to admins and top-level folders", async () => {
    mocks.actor = { ...owner, role: "editor" };
    expect((await createFolder(jsonRequest("folders", "POST", { name: "Editor vault", password: "secret-password-long" }))).status).toBe(403);
    mocks.actor = { ...owner };
    expect((await createFolder(jsonRequest("folders", "POST", { name: "Nested vault", parentId: "public", password: "secret-password-long" }))).status).toBe(403);
    expect(mocks.commitActivity).not.toHaveBeenCalled();
  });

  it("stores a wrapped folder key with no password plaintext and returns only public folder metadata", async () => {
    const password = "secret-password-long";
    const response = await createFolder(jsonRequest("folders", "POST", { name: "New protected", password }));
    expect(response.status).toBe(201);
    const { folder } = await response.json();
    expect(folder).toMatchObject({ name: "New protected", parentId: null, encrypted: true });
    expect(folder).not.toHaveProperty("vault");
    const stored = mocks.records.get(`${FOLDERS}/${folder.id}`)!;
    expect(JSON.stringify(stored)).not.toContain(password);
    expect((stored.vault as FolderVault).allowedUids).toEqual([]);
    expect((await unwrapVault(stored.vault as FolderVault, password, "p1", folder.id)).length).toBe(32);
  });

  it("refuses new protected folders when administrator recovery is unavailable, without writes", async () => {
    vi.stubEnv("HOUSE_PLANNER_VAULT_RECOVERY_KEY", "");
    const response = await createFolder(jsonRequest("folders", "POST", { name: "Unrecoverable folder", password: "secret-password-long" }));
    expect(response.status).toBe(503);
    expect(mocks.commitActivity).not.toHaveBeenCalled();
    expect([...mocks.records.values()].some((record) => record.name === "Unrecoverable folder")).toBe(false);
  });

  it.each(["Factura", "Compras"])("retains the Expenses reserved folder protection for %s", async (name) => {
    const response = await createFolder(jsonRequest("folders", "POST", { name, password: "secret-password-long" }));
    expect(response.status).toBe(409);
    expect(mocks.commitActivity).not.toHaveBeenCalled();
  });

  it.each([
    { id: "vault", name: "Factura" }, { id: "vault", name: "Compras" },
    { id: "public", name: "Factura" }, { id: "public", name: "Compras" },
    { id: "vault", name: " fAcTuRa " }, { id: "public", name: " cOmPrAs " },
  ])("rejects renaming an encrypted or ordinary top-level folder to an Expenses name: %j", async ({ id, name }) => {
    const before = mocks.records.get(`${FOLDERS}/${id}`)!;
    const response = await patchFolder(jsonRequest("folders", "PATCH", { id, name }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "This folder name is reserved for Expenses" });
    expect(mocks.records.get(`${FOLDERS}/${id}`)).toEqual(before);
    expect(mocks.commitActivity).not.toHaveBeenCalled();
  });

  it.each(["Factura", "Compras"])("rejects moving a nested folder named %s into an Expenses top-level slot", async (name) => {
    writeRecord(`${FOLDERS}/public-child`, { name }, true);
    const before = mocks.records.get(`${FOLDERS}/public-child`)!;
    const response = await patchFolder(jsonRequest("folders", "PATCH", { id: "public-child", parentId: null }));
    expect(response.status).toBe(409);
    expect(mocks.records.get(`${FOLDERS}/public-child`)).toEqual(before);
    expect(mocks.commitActivity).not.toHaveBeenCalled();
  });

  it.each([
    { name: "Factura", find: findExpenseInvoiceFolder }, { name: "Compras", find: findExpensePurchaseFolder },
  ])("never selects an encrypted root named $name as an Expenses upload destination", ({ name, find }) => {
    const encrypted = { id: "vault", name, parentId: null, encrypted: true };
    const ordinary = { id: "expense-folder", name, parentId: null };
    expect(find([encrypted])).toBeUndefined();
    expect(find([encrypted, ordinary])).toBe(ordinary);
    expect(find([ordinary, encrypted])).toBe(ordinary);
  });

  it.each([
    { id: "public-child", parentId: "vault" },
    { id: "secret-child", parentId: "public" },
    { id: "vault", parentId: "public" },
  ])("rejects cross-boundary or encrypted-root folder moves: %j", async (move) => {
    const response = await patchFolder(jsonRequest("folders", "PATCH", move));
    expect(response.status).toBe(409);
    expect(mocks.commitActivity).not.toHaveBeenCalled();
  });
});
