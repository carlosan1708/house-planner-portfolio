import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberRecord } from "@/lib/project";

type Data = Record<string, unknown>;
type Write = { collection: string; id: string; data: Data; merge: boolean };
type DocRef = { kind: "doc"; collection: string; id: string; get: () => Promise<DocSnapshot> };
type Query = { kind: "query"; collection: string; filters: Array<[string, unknown]>; where: (field: string, operator: string, value: unknown) => Query; get: () => Promise<QuerySnapshot> };
type DocSnapshot = { id: string; exists: boolean; data: () => Data | undefined };
type QuerySnapshot = { docs: DocSnapshot[] };

const mock = vi.hoisted(() => ({
  actor: null as MemberRecord | null,
  records: new Map<string, Map<string, Data>>(), writes: [] as Write[],
  reads: [] as Array<{ attempt: number; collection: string; id?: string; filters?: Array<[string, unknown]> }>,
  requireAccess: vi.fn(), attempts: 0, revision: 0,
  retryMutations: [] as Array<() => void>, readFailure: false, commitFailure: false,
}));

vi.mock("@/lib/auth", () => ({
  requireTabAccess: async (tab: keyof MemberRecord["permissions"], roles?: MemberRecord["role"][]) => {
    mock.requireAccess(tab, roles);
    const actor = mock.actor;
    return actor && actor.status === "approved" && (!roles || roles.includes(actor.role))
      && (actor.role === "admin" || actor.permissions[tab]) ? actor : null;
  },
  canAccessFolder: (actor: MemberRecord, folderId: string | null, resolved = folderId) => {
    if (actor.role === "admin" || actor.folderAccess.mode === "all") return true;
    return resolved ? actor.folderAccess.folderIds.includes(resolved) : !folderId && actor.folderAccess.allowUnfiled;
  },
}));

vi.mock("@/lib/firebase-admin", () => {
  const copy = (records: typeof mock.records) => new Map([...records].map(([collection, values]) => [collection, new Map([...values].map(([id, data]) => [id, structuredClone(data)]))]));
  const snapshot = (records: typeof mock.records, ref: DocRef): DocSnapshot => {
    const value = records.get(ref.collection)?.get(ref.id);
    return { id: ref.id, exists: value !== undefined, data: () => value === undefined ? undefined : structuredClone(value) };
  };
  const querySnapshot = (records: typeof mock.records, query: Query): QuerySnapshot => ({
    docs: [...(records.get(query.collection) || new Map<string, Data>())]
      .filter(([, value]) => query.filters.every(([field, expected]) => value[field] === expected))
      .map(([id, value]) => ({ id, exists: true, data: () => structuredClone(value) })),
  });
  const read = (records: typeof mock.records, target: DocRef | Query, attempt: number) => {
    if (mock.readFailure) throw new Error("synthetic private datastore detail");
    mock.reads.push({ attempt, collection: target.collection, ...(target.kind === "doc" ? { id: target.id } : { filters: target.filters }) });
    return target.kind === "doc" ? snapshot(records, target) : querySnapshot(records, target);
  };
  const query = (name: string, filters: Array<[string, unknown]> = []): Query => ({
    kind: "query", collection: name, filters,
    where: (field, operator, value) => {
      if (operator !== "==") throw new Error("Unsupported synthetic query");
      return query(name, [...filters, [field, value]]);
    },
    get: async () => read(mock.records, query(name, filters), 0) as QuerySnapshot,
  });
  const collection = (name: string) => ({
    where: (field: string, operator: string, value: unknown) => query(name).where(field, operator, value),
    doc: (id: string): DocRef => ({ kind: "doc", collection: name, id, get: async () => read(mock.records, collection(name).doc(id), 0) as DocSnapshot }),
  });
  return { firestore: {
    collection,
    getAll: (...refs: DocRef[]) => Promise.all(refs.map(ref => ref.get())),
    runTransaction: async (callback: (transaction: {
      get: (target: DocRef | Query) => Promise<DocSnapshot | QuerySnapshot>;
      getAll: (...refs: DocRef[]) => Promise<DocSnapshot[]>;
      set: (ref: DocRef, data: Data, options: { merge: boolean }) => void;
    }) => Promise<unknown>) => {
      for (let retry = 0; retry < 5; retry += 1) {
        mock.attempts += 1;
        const attempt = mock.attempts, version = mock.revision, current = copy(mock.records), pending: Write[] = [];
        const get = async (target: DocRef | Query) => {
          if (pending.length) throw new Error("Firestore transaction read after write");
          return read(current, target, attempt);
        };
        const result = await callback({
          get,
          getAll: (...refs) => Promise.all(refs.map(async ref => await get(ref) as DocSnapshot)),
          set: (ref, data, options) => pending.push({ collection: ref.collection, id: ref.id, data: structuredClone(data), merge: options.merge }),
        });
        const change = mock.retryMutations.shift();
        if (change) { change(); mock.revision += 1; continue; }
        if (version !== mock.revision) continue;
        if (mock.commitFailure) throw new Error("synthetic private commit detail");
        for (const write of pending) {
          const records = mock.records.get(write.collection) || new Map<string, Data>();
          records.set(write.id, write.merge ? { ...records.get(write.id), ...write.data } : write.data);
          mock.records.set(write.collection, records);
          mock.writes.push(write);
        }
        if (pending.length) mock.revision += 1;
        return result;
      }
      throw new Error("Synthetic retry limit exceeded");
    },
  } };
});

import { GET, PATCH } from "@/app/api/documents/featured/route";
import { CONFIG, DEFAULT_MEMBER_PERMISSIONS, DOCUMENTS, FOLDERS, LEGACY_PROJECT_ID, MEMBERSHIPS, USERS, membershipId, projectConfigDoc } from "@/lib/project";

const member: MemberRecord = {
  uid: "curator", email: "curator@example.test", name: "Synthetic curator", projectId: "project-a", projectName: "Synthetic project", isPersonal: false,
  role: "admin", status: "approved", permissions: { ...DEFAULT_MEMBER_PERMISSIONS, overview: false },
  folderAccess: { mode: "all", folderIds: [], allowUnfiled: true },
};
const table = (name: string) => mock.records.get(name)!;
const config = () => table(CONFIG).get(projectConfigDoc(mock.actor!.projectId));
const saveConfig = (data: Data) => table(CONFIG).set(projectConfigDoc(mock.actor!.projectId), data);
const membership = () => table(MEMBERSHIPS).get(membershipId(mock.actor!.projectId, mock.actor!.uid))!;
const setActor = (changes: Partial<MemberRecord> = {}) => {
  mock.actor = { ...member, permissions: { ...member.permissions }, folderAccess: { ...member.folderAccess }, ...changes };
  table(MEMBERSHIPS).set(membershipId(mock.actor.projectId, mock.actor.uid), { ...mock.actor });
};
const request = (change: unknown) => new Request("http://localhost/api/documents/featured", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change) });
const patch = (addIds: string[] = [], removeIds: string[] = []) => PATCH(request({ addIds, removeIds }));
const assertPrivate = (response: Response) => expect(response.headers.get("Cache-Control")).toBe("private, no-store");
const setDoc = (id: string, data: Data = {}) => table(DOCUMENTS).set(id, { projectId: member.projectId, folderId: "folder-a", fileName: `${id}.pdf`, ...data });

beforeEach(() => {
  mock.records.clear();
  for (const collection of [CONFIG, DOCUMENTS, FOLDERS, MEMBERSHIPS, USERS]) mock.records.set(collection, new Map());
  mock.writes.length = 0; mock.reads.length = 0; mock.retryMutations.length = 0;
  mock.requireAccess.mockClear(); mock.attempts = 0; mock.revision = 0; mock.readFailure = false; mock.commitFailure = false;
  table(USERS).set(member.uid, { uid: member.uid, email: member.email, name: member.name, multiTenantReady: true });
  setActor();
  for (const [id, data] of [
    ["folder-a", { name: "Plans", parentId: null }], ["folder-b", { name: "Other access", parentId: null }],
    ["child-a", { name: "Child", parentId: "folder-a" }], ["nested-factura", { name: "Factura", parentId: "folder-a" }],
    ["invoices", { name: " Factura ", parentId: null }], ["invoice-child", { name: "Child", parentId: "invoices" }],
    ["purchases", { name: "COMPRAS", parentId: null }], ["purchase-child", { name: "Child", parentId: "purchases" }],
    ["vault", { name: "Vault", parentId: null, encrypted: true, unlocked: true }],
    ["vault-child", { name: "Plain-looking child", parentId: "vault", unlocked: true }],
    ["encrypted-child", { name: "Nested vault", parentId: "folder-a", encrypted: true, unlocked: true }],
    ["cycle-a", { name: "Cycle a", parentId: "cycle-b" }], ["cycle-b", { name: "Cycle b", parentId: "cycle-a" }],
    ["orphan", { name: "Orphan", parentId: "absent-parent" }], ["bad-parent", { name: "Bad parent", parentId: 9 }],
  ] as Array<[string, Data]>) table(FOLDERS).set(id, { projectId: member.projectId, ...data });
  table(FOLDERS).set("foreign-folder", { projectId: "project-b", name: "Foreign", parentId: null });
  setDoc("a"); setDoc("b"); setDoc("c", { folderId: "child-a" }); setDoc("hidden", { folderId: "folder-b" });
  setDoc("unfiled", { folderId: null }); setDoc("foreign", { projectId: "project-b" }); setDoc("deleted", { deletedAt: true });
  setDoc("encrypted", { encrypted: true }); setDoc("vault-document", { folderId: "vault-child" });
  setDoc("nested-vault-document", { folderId: "encrypted-child" }); setDoc("invoice", { folderId: "invoices" });
  setDoc("invoice-descendant", { folderId: "invoice-child" }); setDoc("purchase", { folderId: "purchases" });
  setDoc("purchase-descendant", { folderId: "purchase-child" }); setDoc("pending-cleanup", { encryptionCleanupPending: true });
  setDoc("orphan-document", { folderId: "orphan" }); setDoc("missing-folder", { folderId: "absent" });
  setDoc("cycle-document", { folderId: "cycle-a" }); setDoc("bad-parent-document", { folderId: "bad-parent" });
  setDoc("foreign-folder-document", { folderId: "foreign-folder" }); setDoc("malformed-folder", { folderId: 4 });
  setDoc("inconsistent-vault", { encrypted: false, vaultFolderId: "vault" });
  setDoc("sealed-metadata", { encryptedMetadata: { ciphertext: "synthetic" } });
  setDoc("ordinary-nested-factura", { folderId: "nested-factura" });
});

describe("featured documents read boundaries", () => {
  it("starts intentionally empty, needs Documents independently of Overview, and never writes on GET", async () => {
    const response = await GET();
    expect(response.status).toBe(200); assertPrivate(response);
    expect(await response.json()).toEqual({ documentIds: [] });
    expect(mock.requireAccess).toHaveBeenCalledWith("documents", undefined);
    expect(mock.writes).toEqual([]); expect(mock.attempts).toBe(0);
  });

  it("returns only eligible visible IDs in saved order without rewriting hidden or stale references", async () => {
    setActor({ role: "viewer", folderAccess: { mode: "selected", folderIds: ["folder-a"], allowUnfiled: false } });
    const stored = { featuredDocumentIds: ["c", "hidden", "foreign", "a", "missing", "encrypted", "vault-document", "invoice-descendant", "pending-cleanup", "unfiled", "a"], workbook: "unchanged" };
    saveConfig(stored);
    const response = await GET(); assertPrivate(response);
    expect(await response.json()).toEqual({ documentIds: ["c", "a"] });
    expect(config()).toEqual(stored); expect(mock.writes).toEqual([]);
  });

  it("permits authorized anonymous and signed read-only links to read under their current Documents/folder grants", async () => {
    saveConfig({ featuredDocumentIds: ["hidden", "c", "unfiled"] });
    for (const anonymousLink of [false, true]) {
      mock.actor = { ...member, role: "viewer", accessLinkId: "active-link", anonymousLink, folderAccess: { mode: "selected", folderIds: ["folder-a"], allowUnfiled: false } };
      expect(await (await GET()).json()).toEqual({ documentIds: ["c"] });
      const response = await patch(["a"]); assertPrivate(response); expect(response.status).toBe(403);
    }
    expect(mock.writes).toEqual([]);
  });

  it("supports personal projects without requiring Overview or a shared-project role", async () => {
    setActor({ isPersonal: true }); saveConfig({ featuredDocumentIds: ["a"] });
    expect(await (await GET()).json()).toEqual({ documentIds: ["a"] });
    expect((await patch(["b"])).status).toBe(200);
  });

  it("does not treat an ordinary nested folder named Factura as the reserved expense root", async () => {
    expect((await patch(["ordinary-nested-factura"])).status).toBe(200);
    expect(await (await GET()).json()).toEqual({ documentIds: ["ordinary-nested-factura"] });
  });

  it("fails privately when the datastore is unavailable", async () => {
    mock.readFailure = true;
    const response = await GET(); assertPrivate(response); expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("datastore detail");
    expect(mock.writes).toEqual([]);
  });
});

describe("featured documents atomic curation", () => {
  it.each(["admin", "editor"] as const)("lets an approved %s apply only ordered selection metadata with merge", async role => {
    setActor({ role });
    const beforeDocuments = structuredClone(table(DOCUMENTS)), beforeFolders = structuredClone(table(FOLDERS));
    saveConfig({ projectId: member.projectId, featuredDocumentIds: ["a", "hidden", "b"], workbook: "keep", documentsVersion: 8, overviewImageIds: ["photo"] });
    table(CONFIG).set("project-b", { featuredDocumentIds: ["foreign"], workbook: "foreign-keep" });
    const response = await patch(["b", "c", "unfiled", "c"], ["a"]); assertPrivate(response);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ documentIds: ["hidden", "b", "c", "unfiled"] });
    expect(config()).toEqual({ projectId: member.projectId, featuredDocumentIds: ["hidden", "b", "c", "unfiled"], workbook: "keep", documentsVersion: 8, overviewImageIds: ["photo"] });
    expect(mock.writes).toEqual([{ collection: CONFIG, id: member.projectId, data: { featuredDocumentIds: ["hidden", "b", "c", "unfiled"] }, merge: true }]);
    expect(table(CONFIG).get("project-b")).toEqual({ featuredDocumentIds: ["foreign"], workbook: "foreign-keep" });
    expect(table(DOCUMENTS)).toEqual(beforeDocuments); expect(table(FOLDERS)).toEqual(beforeFolders);
    expect(mock.reads).toEqual(expect.arrayContaining([
      expect.objectContaining({ attempt: 1, collection: MEMBERSHIPS, id: membershipId(member.projectId, member.uid) }),
      expect.objectContaining({ attempt: 1, collection: USERS, id: member.uid }),
      expect.objectContaining({ attempt: 1, collection: FOLDERS, filters: [["projectId", member.projectId]] }),
    ]));
  });

  it("preserves hidden ordinary references and prevents a restricted editor from clearing somebody else's selection", async () => {
    setActor({ role: "editor", folderAccess: { mode: "selected", folderIds: ["folder-a"], allowUnfiled: false } });
    saveConfig({ featuredDocumentIds: ["hidden", "a"] });
    const response = await patch(["c"], ["a"]);
    expect(await response.json()).toEqual({ documentIds: ["c"] });
    expect(config()?.featuredDocumentIds).toEqual(["hidden", "c"]);
    const before = structuredClone(config()), count = mock.writes.length;
    expect((await patch([], ["hidden"])).status).toBe(403);
    expect((await patch(["hidden"])).status).toBe(403);
    expect(config()).toEqual(before); expect(mock.writes).toHaveLength(count);
  });

  it("counts 29 visible plus one hidden valid reference toward the global cap, atomically permitting an eligible replacement", async () => {
    setActor({ role: "editor", folderAccess: { mode: "selected", folderIds: ["folder-a"], allowUnfiled: false } });
    const visible = Array.from({ length: 29 }, (_, index) => `visible-${index}`); visible.forEach(id => setDoc(id));
    saveConfig({ featuredDocumentIds: ["hidden", ...visible] });
    const rejected = await patch(["a"]); assertPrivate(rejected); expect(rejected.status).toBe(409);
    expect(JSON.stringify(await rejected.json())).not.toContain("hidden");
    expect(config()?.featuredDocumentIds).toEqual(["hidden", ...visible]); expect(mock.writes).toEqual([]);
    expect((await patch(["a"], [visible[0]])).status).toBe(200);
    expect(config()?.featuredDocumentIds).toEqual(["hidden", ...visible.slice(1), "a"]);
  });

  it("prunes only structurally unavailable stored references after valid input, without truncating valid late or hidden IDs", async () => {
    setActor({ role: "editor", folderAccess: { mode: "selected", folderIds: ["folder-a"], allowUnfiled: false } });
    const old = [...Array.from({ length: 31 }, (_, index) => `missing-${index}`), "foreign", "encrypted", "invoice", "orphan-document", "cycle-document", "pending-cleanup", "a", "hidden"];
    saveConfig({ featuredDocumentIds: old, other: "keep" });
    expect(await (await GET()).json()).toEqual({ documentIds: ["a"] }); expect(config()?.featuredDocumentIds).toEqual(old);
    expect(await (await patch(["b"])).json()).toEqual({ documentIds: ["a", "b"] });
    expect(config()).toEqual({ featuredDocumentIds: ["a", "hidden", "b"], other: "keep" });
  });

  it.each([
    "missing", "foreign", "deleted", "encrypted", "vault-document", "nested-vault-document", "invoice", "invoice-descendant",
    "purchase", "purchase-descendant", "pending-cleanup", "orphan-document", "missing-folder", "cycle-document", "bad-parent-document",
    "foreign-folder-document", "malformed-folder", "inconsistent-vault", "sealed-metadata",
  ])("rejects excluded target %s in additions AND removals before any cleanup or write", async id => {
    const stored = { featuredDocumentIds: ["a", "missing", id], unrelated: "keep" }; saveConfig(stored);
    for (const response of [await patch(["b", id]), await patch(["b"], [id])]) {
      assertPrivate(response); expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "One or more requested documents are unavailable" });
    }
    expect(config()).toEqual(stored); expect(mock.writes).toEqual([]);
  });

  it("allows eligible absent removals and already-saved additions as idempotent no-ops", async () => {
    saveConfig({ featuredDocumentIds: ["c", "a"] });
    expect(await (await patch(["a"], ["b"])).json()).toEqual({ documentIds: ["c", "a"] });
    expect(await (await patch(["a"], ["b"])).json()).toEqual({ documentIds: ["c", "a"] });
    expect(config()?.featuredDocumentIds).toEqual(["c", "a"]);
  });

  it("rejects invalid JSON, overlapping IDs and foreign selectors before starting a transaction", async () => {
    saveConfig({ featuredDocumentIds: ["a", "missing"] });
    for (const body of [null, {}, { addIds: [] }, { documentIds: [] }, { addIds: [], removeIds: [], projectId: "project-b" }, { addIds: ["a"], removeIds: ["a"] }, { addIds: ["path/id"], removeIds: [] }, { addIds: Array.from({ length: 31 }, (_, index) => `new-${index}`), removeIds: [] }]) {
      const response = await PATCH(request(body)); assertPrivate(response); expect(response.status).toBe(400);
    }
    expect((await PATCH(new Request("http://localhost/api/documents/featured", { method: "PATCH", body: "{" }))).status).toBe(400);
    expect(mock.attempts).toBe(0); expect(mock.writes).toEqual([]); expect(config()?.featuredDocumentIds).toEqual(["a", "missing"]);
  });

  it("does not expose or overwrite conflicting project-owned configuration", async () => {
    const foreign = { projectId: "project-b", featuredDocumentIds: ["a"], private: "foreign-config" }; saveConfig(foreign);
    const read = await GET(); assertPrivate(read); expect(read.status).toBe(503);
    expect(await read.json()).toEqual({ error: "Project configuration is unavailable" });
    const response = await patch(["b"]); assertPrivate(response); expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("project-b");
    expect(config()).toEqual(foreign); expect(mock.writes).toEqual([]);
  });

  it("returns an explicit failure on persistence error without claiming the selection was saved", async () => {
    saveConfig({ featuredDocumentIds: ["a"] }); mock.commitFailure = true;
    const response = await patch(["b"]); assertPrivate(response); expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Could not save featured documents. Try again." });
    expect(config()?.featuredDocumentIds).toEqual(["a"]); expect(mock.writes).toEqual([]);
  });
});

describe("current authorization and legacy compatibility", () => {
  it("denies unapproved, missing and non-Documents actors and denies curator writes from any read-only context", async () => {
    for (const actor of [null, { ...member, status: "pending" as const }, { ...member, status: "rejected" as const }, { ...member, role: "editor" as const, permissions: { ...member.permissions, documents: false } }]) {
      mock.actor = actor;
      const read = await GET(), write = await patch(["a"]); assertPrivate(read); assertPrivate(write);
      expect(read.status).toBe(403); expect(write.status).toBe(403);
    }
    for (const actor of [{ ...member, role: "viewer" as const }, { ...member, accessLinkId: "read-only" }, { ...member, anonymousLink: true }]) {
      mock.actor = actor; expect((await patch(["a"])).status).toBe(403);
    }
    expect(mock.writes).toEqual([]);
  });

  it.each(["revoked", "removed", "viewer", "documents-denied", "linked", "foreign-project", "wrong-uid", "missing-identity", "missing-membership"])("rejects stale actor state when transaction finds %s", async reason => {
    saveConfig({ featuredDocumentIds: ["a", "missing"] });
    const current = membership();
    if (reason === "revoked") current.status = "pending";
    if (reason === "removed") current.removed = true;
    if (reason === "viewer") current.role = "viewer";
    if (reason === "documents-denied") { current.role = "editor"; current.permissions = { ...member.permissions, documents: false }; }
    if (reason === "linked") current.accessLinkId = "read-only";
    if (reason === "foreign-project") current.projectId = "project-b";
    if (reason === "wrong-uid") current.uid = "other";
    if (reason === "missing-identity") table(USERS).delete(member.uid);
    if (reason === "missing-membership") table(MEMBERSHIPS).clear();
    const response = await patch(["b"]); assertPrivate(response); expect(response.status).toBe(403);
    expect(config()?.featuredDocumentIds).toEqual(["a", "missing"]); expect(mock.writes).toEqual([]);
  });

  it("uses the legacy config mapping for a current project membership without changing unrelated settings", async () => {
    setActor({ projectId: LEGACY_PROJECT_ID }); table(CONFIG).set("production", { workbook: "keep" });
    const response = await patch(); expect(response.status).toBe(200);
    expect(table(CONFIG).get("production")).toEqual({ workbook: "keep", featuredDocumentIds: [] });
    expect(mock.writes[0]).toMatchObject({ collection: CONFIG, id: "production", merge: true });
    expect(table(CONFIG).has(LEGACY_PROJECT_ID)).toBe(false);
  });

  it("preserves canonical pre-membership legacy compatibility only for an approved unmigrated identity with no memberships", async () => {
    setActor({ projectId: LEGACY_PROJECT_ID }); table(MEMBERSHIPS).clear();
    table(USERS).set(member.uid, { ...member, status: "approved", multiTenantReady: false });
    table(DOCUMENTS).set("legacy-doc", { projectId: LEGACY_PROJECT_ID, folderId: null });
    table(CONFIG).set("production", { workbook: "keep" });
    expect(await (await patch(["legacy-doc"])).json()).toEqual({ documentIds: ["legacy-doc"] });
    expect(table(CONFIG).get("production")).toEqual({ workbook: "keep", featuredDocumentIds: ["legacy-doc"] });
    expect(mock.reads).toContainEqual(expect.objectContaining({ attempt: 1, collection: MEMBERSHIPS, filters: [["uid", member.uid]] }));
  });

  it.each(["migrated", "other-membership", "unapproved-identity"])("does not revive a legacy identity that is %s", async reason => {
    setActor({ projectId: LEGACY_PROJECT_ID }); table(MEMBERSHIPS).clear();
    table(USERS).set(member.uid, { ...member, status: reason === "unapproved-identity" ? "rejected" : "approved", multiTenantReady: reason === "migrated" });
    if (reason === "other-membership") table(MEMBERSHIPS).set("another__curator", { uid: member.uid, projectId: "another", status: "approved" });
    expect((await patch()).status).toBe(403); expect(mock.writes).toEqual([]);
  });
});

describe("transaction retries and unrelated concurrent edits", () => {
  it("re-reads the complete latest selection, including a peer's new reference and unrelated config change", async () => {
    saveConfig({ featuredDocumentIds: ["a"], workbook: "original" });
    mock.retryMutations.push(() => saveConfig({ featuredDocumentIds: ["a", "c"], workbook: "peer-change" }));
    expect(await (await patch(["b"])).json()).toEqual({ documentIds: ["a", "c", "b"] });
    expect(config()).toEqual({ featuredDocumentIds: ["a", "c", "b"], workbook: "peer-change" });
    expect(mock.attempts).toBe(2); expect(mock.writes).toHaveLength(1);
    expect(mock.reads).toContainEqual(expect.objectContaining({ attempt: 2, collection: DOCUMENTS, id: "c" }));
  });

  it("preserves two unrelated concurrent additions without replacing the other curator's accepted change", async () => {
    saveConfig({ featuredDocumentIds: ["a"] });
    const responses = await Promise.all([patch(["b"]), patch(["c"])]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(config()?.featuredDocumentIds).toEqual(["a", "b", "c"]);
    expect(mock.writes).toHaveLength(2); expect(mock.attempts).toBeGreaterThanOrEqual(3);
  });

  it("makes the global limit atomic when concurrent additions compete for the final slot", async () => {
    const ids = Array.from({ length: 29 }, (_, index) => `selected-${index}`); ids.forEach(id => setDoc(id)); saveConfig({ featuredDocumentIds: ids });
    const responses = await Promise.all([patch(["b"]), patch(["c"])]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect((config()?.featuredDocumentIds as string[])).toHaveLength(30); expect(mock.writes).toHaveLength(1);
  });

  it.each(["membership-revoked", "folder-grant-revoked", "target-moved", "target-deleted", "target-encrypted", "ancestor-encrypted"])("fails atomically after retry observes %s", async reason => {
    setActor({ role: "editor", folderAccess: { mode: "selected", folderIds: ["folder-a"], allowUnfiled: false } });
    saveConfig({ featuredDocumentIds: ["a", "missing"] });
    mock.retryMutations.push(() => {
      if (reason === "membership-revoked") membership().status = "rejected";
      if (reason === "folder-grant-revoked") membership().folderAccess = { mode: "selected", folderIds: ["folder-b"], allowUnfiled: false };
      if (reason === "target-moved") setDoc("b", { folderId: "folder-b" });
      if (reason === "target-deleted") table(DOCUMENTS).delete("b");
      if (reason === "target-encrypted") setDoc("b", { encrypted: true });
      if (reason === "ancestor-encrypted") table(FOLDERS).get("folder-a")!.encrypted = true;
    });
    const response = await patch(["b"]); assertPrivate(response); expect(response.status).toBe(403);
    expect(config()?.featuredDocumentIds).toEqual(["a", "missing"]); expect(mock.writes).toEqual([]); expect(mock.attempts).toBe(2);
    expect(mock.reads).toContainEqual(expect.objectContaining({ attempt: 2, collection: MEMBERSHIPS, id: membershipId(member.projectId, member.uid) }));
  });
});
