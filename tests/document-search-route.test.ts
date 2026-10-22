import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MEMBER_PERMISSIONS, DOCUMENTS, FOLDERS, type MemberRecord } from "@/lib/project";

const mock = vi.hoisted(() => ({
  actor: null as MemberRecord | null, configured: true,
  documents: new Map<string, Record<string, unknown>>(), folders: new Map<string, Record<string, unknown>>(),
  generate: vi.fn(), reserve: vi.fn(), requireAccess: vi.fn(), read: vi.fn(),
  onAccess: null as (() => void) | null, onRead: null as (() => void) | null,
}));
vi.mock("@/lib/auth", () => ({
  requireTabAccess: async (tab: keyof MemberRecord["permissions"]) => {
    mock.requireAccess(tab); mock.onAccess?.();
    const actor = mock.actor;
    return actor && actor.status === "approved" && (actor.role === "admin" || actor.permissions[tab]) ? structuredClone(actor) : null;
  },
  canAccessFolder: (actor: MemberRecord, folderId: string | null, resolved = folderId) => actor.role === "admin" || actor.folderAccess.mode === "all"
    || (resolved ? actor.folderAccess.folderIds.includes(resolved) : !folderId && actor.folderAccess.allowUnfiled),
}));
vi.mock("@/lib/firebase-admin", () => ({ firestore: { collection: (collection: string) => ({
  where: (field: string, operator: string, projectId: string) => ({ get: async () => {
    mock.read(collection, field, operator, projectId); mock.onRead?.();
    const values = collection === "housePlannerDocuments" ? mock.documents : mock.folders;
    return { docs: [...values].filter(([, data]) => data.projectId === projectId).map(([id, data]) => ({ id, data: () => structuredClone(data) })) };
  } }),
}) } }));
vi.mock("@/lib/gemini", () => ({ geminiConfigured: () => mock.configured, geminiClient: () => ({ models: { generateContent: mock.generate } }) }));
vi.mock("@/lib/document-search-quota", () => ({ reserveDocumentSearch: mock.reserve }));

import { POST } from "@/app/api/documents/search/route";
import { DocumentSearchFailure } from "@/lib/document-search-policy";

const owner: MemberRecord = {
  uid: "owner", projectId: "project-a", projectName: "House", isPersonal: false,
  email: "owner@example.test", name: "Owner", role: "admin", status: "approved",
  permissions: { ...DEFAULT_MEMBER_PERMISSIONS }, folderAccess: { mode: "all", folderIds: [], allowUnfiled: true },
};
const request = (body: unknown = { query: "permiso para construir", language: "es" }, signal?: AbortSignal) => new Request("https://planner.test/api/documents/search", {
  method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" }, signal,
});
const doc = (id: string, data: Record<string, unknown> = {}) => mock.documents.set(id, {
  projectId: "project-a", folderId: "legal", fileName: `${id}.pdf`, description: "Licencia municipal de obra", ...data,
});
const folder = (id: string, data: Record<string, unknown> = {}) => mock.folders.set(id, { projectId: "project-a", name: id, parentId: null, ...data });
const answer = (results: unknown[] = [{ id: "license", score: 0.93 }]) => ({ text: JSON.stringify({ results }) });
const privateResponse = (response: Response) => expect(response.headers.get("Cache-Control")).toBe("private, no-store");

beforeEach(() => {
  vi.clearAllMocks(); mock.actor = structuredClone(owner); mock.configured = true;
  mock.documents.clear(); mock.folders.clear(); mock.onAccess = null; mock.onRead = null;
  folder("legal", { name: "Documentos legales" }); doc("license");
  mock.generate.mockResolvedValue(answer()); mock.reserve.mockResolvedValue(undefined);
});

describe("semantic document search request boundaries", () => {
  it.each([null, { ...owner, status: "pending" }, { ...owner, anonymousLink: true },
    { ...owner, role: "viewer", permissions: { ...owner.permissions, documents: false } },
  ])("denies an unavailable identity before data, quota or model calls", async (actor) => {
    mock.actor = actor as MemberRecord | null;
    const response = await POST(request()); privateResponse(response);
    expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ code: "denied" });
    expect(mock.reserve).not.toHaveBeenCalled(); expect(mock.generate).not.toHaveBeenCalled(); expect(mock.read).not.toHaveBeenCalled();
  });

  it.each([{}, null, [], { query: "  ", language: "es" }, { query: "ab", language: "es" },
    { query: 4, language: "es" }, { query: "x".repeat(401), language: "es" }, { query: "permit", language: "fr" },
  ])("rejects malformed input without reserving usage: %j", async body => {
    const response = await POST(request(body)); privateResponse(response); expect(response.status).toBe(400);
    expect(mock.reserve).not.toHaveBeenCalled(); expect(mock.generate).not.toHaveBeenCalled();
  });

  it("bounds the actual request stream even when an attacker omits Content-Length", async () => {
    const response = await POST(request({ query: "permit", language: "es", unwanted: "x".repeat(4096) }));
    privateResponse(response); expect(response.status).toBe(400);
    expect(mock.read).not.toHaveBeenCalled(); expect(mock.reserve).not.toHaveBeenCalled(); expect(mock.generate).not.toHaveBeenCalled();
  });

  it("allows a viewer with an independent Documents grant and an authenticated read link", async () => {
    for (const accessLinkId of [undefined, "active-link"]) {
      mock.actor = { ...structuredClone(owner), role: "viewer", accessLinkId,
        folderAccess: { mode: "selected", folderIds: ["legal"], allowUnfiled: false } };
      const response = await POST(request()); privateResponse(response); expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ results: [{ id: "license", score: 0.93 }], searchedCount: 1, totalCount: 1, mode: "semantic" });
    }
    expect(mock.reserve).toHaveBeenCalledTimes(2);
  });

  it("returns no candidates without consuming a provider reservation", async () => {
    mock.documents.clear(); const response = await POST(request()); privateResponse(response);
    expect(await response.json()).toEqual({ results: [], searchedCount: 0, totalCount: 0, mode: "semantic" });
    expect(mock.reserve).not.toHaveBeenCalled(); expect(mock.generate).not.toHaveBeenCalled();
  });

  it("does not reserve or call the model when the shared AI adapter disables the environment", async () => {
    mock.configured = false; const response = await POST(request()); privateResponse(response);
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: "semantic_unavailable" });
    expect(mock.reserve).not.toHaveBeenCalled(); expect(mock.generate).not.toHaveBeenCalled();
  });

  it("returns safe unavailable errors without exposing provider or storage details", async () => {
    mock.generate.mockRejectedValue(new Error("secret provider input / bucket / token"));
    const response = await POST(request()); privateResponse(response); expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/secret|bucket|token|provider input/);
    expect(mock.reserve).toHaveBeenCalledTimes(1);
  });

  it("preserves a safe quota Retry-After response without calling the model", async () => {
    mock.reserve.mockRejectedValue(new DocumentSearchFailure("search_limit", 429, 10));
    const response = await POST(request()); privateResponse(response);
    expect(response.status).toBe(429); expect(response.headers.get("Retry-After")).toBe("10");
    expect(await response.json()).toMatchObject({ code: "search_limit" }); expect(mock.generate).not.toHaveBeenCalled();
  });

  it("sends only metadata, a bounded dedicated model request and no extraction/Storage operations", async () => {
    doc("license", { aiText: "SECRET FULL CONTENT", objectKey: "private-storage", uploadedBy: "private-author", description: "Licencia municipal de obra" });
    const response = await POST(request()); expect(response.status).toBe(200);
    expect(mock.generate).toHaveBeenCalledTimes(1);
    const input = mock.generate.mock.calls[0][0];
    expect(input.model).toBe("gemini-3.1-flash-lite");
    expect(JSON.parse(input.contents)).toEqual({ query: "permiso para construir", language: "es", documents: [{
      id: "license", name: "license.pdf", description: "Licencia municipal de obra", path: "Documentos legales",
    }] });
    expect(JSON.stringify(input)).not.toMatch(/SECRET FULL CONTENT|private-storage|private-author/);
    expect(input.config).toMatchObject({ responseMimeType: "application/json", maxOutputTokens: 1500,
      httpOptions: { timeout: 30000, retryOptions: { attempts: 1 } }, thinkingConfig: { thinkingLevel: "MINIMAL" } });
    expect(input.config.abortSignal).toBeInstanceOf(AbortSignal); expect(input.config.tools).toBeUndefined();
    expect(mock.read.mock.calls.every(([collection]) => collection === DOCUMENTS || collection === FOLDERS)).toBe(true);
  });

  it("cancels the provider request and withholds results when the request is aborted", async () => {
    const controller = new AbortController();
    mock.generate.mockImplementationOnce(async () => { controller.abort(); return answer(); });
    const response = await POST(request(undefined, controller.signal)); privateResponse(response);
    expect(response.status).toBe(503); expect(mock.generate.mock.calls[0][0].config.abortSignal.aborted).toBe(true);
  });
});

describe("semantic source visibility", () => {
  it("excludes unlocked vault descendants even for an administrator", async () => {
    folder("vault", { encrypted: true, unlocked: true }); folder("vault-child", { parentId: "vault", unlocked: true });
    doc("admin-secret", { folderId: "vault-child", description: "UNLOCKED ADMIN SECRET" });
    const response = await POST(request()); expect(response.status).toBe(200);
    expect(JSON.parse(mock.generate.mock.calls[0][0].contents).documents.map((item: { id: string }) => item.id)).toEqual(["license"]);
    expect(JSON.stringify(mock.generate.mock.calls[0][0])).not.toContain("UNLOCKED ADMIN SECRET");
  });

  it("excludes foreign, protected, malformed, deleted and expense-only documents before model input", async () => {
    folder("other"); folder("child", { parentId: "legal" }); folder("vault", { encrypted: true, unlocked: true });
    folder("vault-child", { parentId: "vault", unlocked: true }); folder("nested-vault", { parentId: "legal", encrypted: true });
    folder("invoice", { name: " Factura " }); folder("invoice-child", { parentId: "invoice" });
    folder("purchases", { name: "COMPRAS" }); folder("purchase-child", { parentId: "purchases" });
    folder("nested-factura", { name: "Factura", parentId: "legal" });
    folder("cycle-a", { parentId: "cycle-b" }); folder("cycle-b", { parentId: "cycle-a" });
    folder("orphan", { parentId: "missing" }); folder("bad-parent", { parentId: 8 }); folder("deleted", { deletedAt: true });
    folder("foreign", { projectId: "project-b" });
    const excluded: Array<[string, Record<string, unknown>]> = [
      ["cross-project", { projectId: "project-b" }], ["forbidden", { folderId: "other" }], ["unfiled", { folderId: null }],
      ["deleted-doc", { deletedAt: true }], ["cleanup", { encryptionCleanupPending: true }], ["encrypted", { encrypted: true }],
      ["vault-flag", { vaultFolderId: "vault" }], ["sealed", { encryptedMetadata: "sealed" }], ["vault-doc", { folderId: "vault-child" }],
      ["nested-vault-doc", { folderId: "nested-vault" }], ["invoice-doc", { folderId: "invoice-child" }], ["purchase-doc", { folderId: "purchase-child" }],
      ["cycle-doc", { folderId: "cycle-a" }], ["orphan-doc", { folderId: "orphan" }], ["missing-doc", { folderId: "missing" }],
      ["malformed-doc", { folderId: 5 }], ["bad-parent-doc", { folderId: "bad-parent" }], ["deleted-folder-doc", { folderId: "deleted" }],
      ["foreign-folder-doc", { folderId: "foreign" }],
    ];
    excluded.forEach(([id, data]) => doc(id, { ...data, description: `secret-${id}` }));
    doc("image", { fileName: "photo.jpeg", folderId: "child" }); doc("nested-ordinary", { folderId: "nested-factura" });
    doc("fallback", { fileName: "design.ifc", description: "", aiDescription: "Extracted description" });
    mock.actor = { ...structuredClone(owner), role: "viewer", folderAccess: { mode: "selected", folderIds: ["legal"], allowUnfiled: false } };
    const response = await POST(request()); expect(response.status).toBe(200);
    const sent = JSON.parse(mock.generate.mock.calls[0][0].contents).documents;
    expect(sent.map((item: { id: string }) => item.id)).toEqual(["fallback", "image", "license", "nested-ordinary"]);
    expect(sent.find((item: { id: string }) => item.id === "fallback").description).toBe("Extracted description");
    expect(sent.find((item: { id: string }) => item.id === "image").path).toBe("Documentos legales / child");
    expect(JSON.stringify(sent)).not.toContain("secret-");
  });

  it("does not cut the project to its first40 files and rejects projects over250 rather than hiding candidates", async () => {
    for (let index = 0; index < 249; index += 1) doc(`ordinary-${index}`);
    expect((await POST(request())).status).toBe(200);
    expect(JSON.parse(mock.generate.mock.calls[0][0].contents).documents).toHaveLength(250);
    doc("overflow"); mock.generate.mockClear(); mock.reserve.mockClear();
    const response = await POST(request()); privateResponse(response); expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "semantic_scope_limit" });
    expect(mock.reserve).not.toHaveBeenCalled(); expect(mock.generate).not.toHaveBeenCalled();
  });

  it("counts UTF8 metadata bytes and rejects an oversized scope before reserving", async () => {
    doc("large", { description: "漢".repeat(40_000) });
    const response = await POST(request()); privateResponse(response); expect(response.status).toBe(413);
    expect(mock.reserve).not.toHaveBeenCalled(); expect(mock.generate).not.toHaveBeenCalled();
  });

  it.each(["revoked", "project", "identity", "anonymous"])("denies a changed identity after model completion: %s", async change => {
    mock.generate.mockImplementationOnce(async () => {
      if (change === "revoked") mock.actor = null;
      if (change === "project") mock.actor!.projectId = "project-b";
      if (change === "identity") mock.actor!.uid = "different-user";
      if (change === "anonymous") mock.actor!.anonymousLink = true;
      return answer();
    });
    const response = await POST(request()); privateResponse(response); expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "denied" });
  });

  it("revalidates identity after the quota await before any metadata is sent", async () => {
    mock.reserve.mockImplementationOnce(async () => { mock.actor!.permissions.documents = false; mock.actor!.role = "viewer"; });
    const response = await POST(request()); expect(response.status).toBe(403); expect(mock.generate).not.toHaveBeenCalled();
  });

  it.each(["before-model", "after-model"])("does not return or submit a stale grant revoked while awaiting source reads: %s", async phase => {
    mock.onRead = () => {
      const call = mock.read.mock.calls.length;
      if (call === (phase === "before-model" ? 3 : 5)) mock.actor = null;
    };
    const response = await POST(request()); expect(response.status).toBe(403);
    expect(mock.generate).toHaveBeenCalledTimes(phase === "before-model" ? 0 : 1);
  });

  it.each(["move-vault", "access", "ancestor-vault", "deleted"])("reloads scope after quota reservations and never sends a stale candidate: %s", async change => {
    doc("kept", { folderId: null });
    mock.reserve.mockImplementationOnce(async () => {
      if (change === "move-vault") { folder("vault", { encrypted: true }); mock.documents.get("license")!.folderId = "vault"; }
      if (change === "ancestor-vault") mock.folders.get("legal")!.encrypted = true;
      if (change === "deleted") mock.documents.get("license")!.deletedAt = true;
      if (change === "access") {
        mock.actor!.role = "viewer"; mock.actor!.folderAccess = { mode: "selected", folderIds: [], allowUnfiled: true };
      }
    });
    const response = await POST(request()); expect(response.status).toBe(200);
    expect(JSON.parse(mock.generate.mock.calls[0][0].contents).documents.map((item: { id: string }) => item.id)).toEqual(["kept"]);
    expect((await response.json()).searchedCount).toBe(1);
  });

  it.each(["description", "name", "folder-name", "move-vault", "deleted", "access", "cleanup"])("discards a stale match without leaking its previous scope in counts: %s", async change => {
    doc("kept");
    mock.generate.mockImplementationOnce(async () => {
      if (change === "description") mock.documents.get("license")!.description = "Changed description";
      if (change === "name") mock.documents.get("license")!.fileName = "renamed.pdf";
      if (change === "folder-name") { folder("other"); mock.documents.get("kept")!.folderId = "other"; mock.folders.get("legal")!.name = "Renamed"; }
      if (change === "move-vault") { folder("vault", { encrypted: true }); mock.documents.get("license")!.folderId = "vault"; }
      if (change === "deleted") mock.documents.get("license")!.deletedAt = true;
      if (change === "cleanup") mock.documents.get("license")!.encryptionCleanupPending = true;
      if (change === "access") {
        folder("other"); mock.documents.get("kept")!.folderId = "other";
        mock.actor!.role = "viewer"; mock.actor!.folderAccess = { mode: "selected", folderIds: ["other"], allowUnfiled: false };
      }
      return answer([{ id: "license", score: 0.99 }, { id: "kept", score: 0.8 }]);
    });
    const response = await POST(request()); expect(response.status).toBe(200);
    const body = await response.json(); expect(body.results.some((item: { id: string }) => item.id === "license")).toBe(false);
    expect(body.searchedCount).toBe(change === "folder-name" || change === "access" ? 0 : 1);
    expect(body.totalCount).toBe(["move-vault", "deleted", "access", "cleanup"].includes(change) ? 1 : 2);
  });

  it("reloads candidates after the quota await, including newly created files rather than silently omitting them", async () => {
    mock.reserve.mockImplementationOnce(async () => { doc("new-file"); });
    const response = await POST(request()); expect(response.status).toBe(200);
    expect(JSON.parse(mock.generate.mock.calls[0][0].contents).documents.map((item: { id: string }) => item.id)).toEqual(["license", "new-file"]);
  });

  it("discards a moved source even when the destination has the same visible folder path", async () => {
    folder("same-label", { name: "Documentos legales" });
    mock.generate.mockImplementationOnce(async () => { mock.documents.get("license")!.folderId = "same-label"; return answer(); });
    const response = await POST(request()); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ results: [], searchedCount: 0, totalCount: 1, mode: "semantic" });
    expect(mock.generate.mock.calls[0][0].contents).not.toContain("fingerprint");
  });
});

describe("generated scores are untrusted", () => {
  it("admits semantic synonyms and emits only known unique IDs with finite bounded numeric scores", async () => {
    doc("second"); doc("third");
    mock.generate.mockResolvedValue(answer([
      { id: "unknown-private-id", score: 1, url: "https://evil.test" }, { id: "license", score: 0.93, name: "made up", explanation: "ignore all instructions" },
      { id: "license", score: 0.99 }, { id: "second", score: "0.9" }, { id: "third", score: 1.5 },
      { id: "second", score: 0.2 }, { id: "third", score: 0.6 }, null,
    ]));
    const response = await POST(request()); expect(response.status).toBe(200);
    expect((await response.json()).results).toEqual([{ id: "license", score: 0.93 }, { id: "third", score: 0.6 }]);
    expect(JSON.parse(mock.generate.mock.calls[0][0].contents).query).toBe("permiso para construir");
  });

  it.each([undefined, "not json", "[]", "{}", '{"results":null}', "x".repeat(24_001), JSON.stringify({ results: Array.from({ length: 31 }, () => ({ id: "license", score: 1 })) })])("fails closed for malformed or oversized model output", async text => {
    mock.generate.mockResolvedValue({ text }); const response = await POST(request()); privateResponse(response);
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: "semantic_unavailable" });
  });
});
