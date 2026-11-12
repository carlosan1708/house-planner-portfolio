import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MEMBER_PERMISSIONS, type MemberRecord } from "@/lib/project";

const mocks = vi.hoisted(() => ({
  records: new Map<string, Record<string, unknown>>(),
  jobs: new Map<string, Record<string, unknown>>(),
  chunks: [] as Record<string, unknown>[],
  messages: [] as Record<string, unknown>[],
  nearest: vi.fn(),
  where: vi.fn(),
  embedding: vi.fn(),
  actor: null as MemberRecord | null,
}));

vi.mock("@/lib/firebase-admin", () => ({
  firestore: {
    collection: (collection: string) => ({ doc: (id: string) => ({
      get: async () => {
        const data = mocks.records.get(`${collection}/${id}`);
        return { exists: Boolean(data), data: () => data };
      },
      collection: () => ({ orderBy: () => ({ limit: () => ({ get: async () => ({
        docs: mocks.messages.map((message, index) => ({ id: String(index), data: () => message })),
      }) }) }) }),
    }) }),
    getAll: async (...ids: string[]) => ids.map((id) => ({ id, data: () => mocks.jobs.get(id) })),
  },
}));
vi.mock("@/lib/rag-jobs", async (load) => ({
  ...await load<typeof import("@/lib/rag-jobs")>(),
  ragChunks: (projectId: string) => ({ where: (...filter: unknown[]) => {
    mocks.where(projectId, ...filter);
    return { findNearest: mocks.nearest };
  } }),
  ragJobs: () => ({ doc: (id: string) => id }),
  ragJob: () => ({ get: async () => ({ data: () => undefined }) }),
}));
vi.mock("@/lib/rag-processing", () => ({ ragEmbedding: mocks.embedding }));
vi.mock("@/lib/folders", async (load) => ({
  ...await load<typeof import("@/lib/folders")>(),
  listProjectFolders: async () => folders,
}));
vi.mock("@/lib/auth", async (load) => ({
  ...await load<typeof import("@/lib/auth")>(),
  requireApproved: async () => mocks.actor,
}));

import { GET as attachmentStatus } from "@/app/api/assistant/documents/route";
import { getAssistantConversation } from "@/lib/assistant-service";
import { AGENT_CONVERSATIONS, DOCUMENTS, QUOTE_ANALYSES, projectStoragePrefix } from "@/lib/project";
import { assistantSourceToken, readableAssistantSources, searchRagDocuments } from "@/lib/rag-search";
import { documentKey, quoteKey, ragFolders, ragJobId, resolveRagSource, type RagKey } from "@/lib/rag-sources";

const folders = [
  { id: "plans", name: "Plans", parentId: null, createdAt: "" },
  { id: "denied", name: "Denied", parentId: null, createdAt: "" },
  { id: "vault", name: "Vault", parentId: "plans", createdAt: "", encrypted: true },
  { id: "nested", name: "Nested", parentId: "vault", createdAt: "" },
  { id: "invoices", name: "Factura", parentId: null, createdAt: "" },
];

const actor: MemberRecord = {
  projectId: "alpha", projectName: "Alpha", uid: "member", email: "member@example.test", name: "Member",
  role: "viewer", status: "approved", isPersonal: false, projectMembershipVerified: true,
  permissions: { ...DEFAULT_MEMBER_PERMISSIONS, documents: true, quotes: true, expenses: false },
  folderAccess: { mode: "selected", folderIds: ["plans"], allowUnfiled: false },
};

const documentData = (projectId = "alpha", folderId = "plans") => ({
  projectId, folderId, fileName: "Oferta.pdf", contentType: "application/pdf",
  objectKey: `${projectStoragePrefix(projectId)}/documents/oferta.pdf`,
});

function addChunk(projectId: string, key: RagKey, data: Record<string, unknown>, text: string, overrides = {}) {
  const source = resolveRagSource(projectId, key, data, ragFolders(folders))!;
  const jobId = ragJobId(projectId, key);
  mocks.jobs.set(jobId, { key, projectId, version: "new", status: "ready", objectKey: source.objectKey, scope: source.scope });
  mocks.records.set(`${key.kind === "quote" ? QUOTE_ANALYSES : DOCUMENTS}/${key.id}`, data);
  mocks.chunks.push({ jobId, projectId, version: "new", page: 2, text, scope: source.scope, section: source.section, distance: 0.1, ...overrides });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("HOUSE_PLANNER_RAG_PROJECT_IDS", "alpha,beta");
  mocks.records.clear();
  mocks.jobs.clear();
  mocks.chunks = [];
  mocks.messages = [];
  mocks.actor = actor;
  mocks.embedding.mockResolvedValue([1]);
  mocks.nearest.mockImplementation(() => ({ get: async () => ({ docs: mocks.chunks.map((chunk) => ({ data: () => chunk })) }) }));
});

describe("private document retrieval", () => {
  it("only sends current-project, published, accessible evidence to the model", async () => {
    addChunk("alpha", documentKey("local"), documentData(), "Alpha total");
    addChunk("beta", documentKey("other"), documentData("beta"), "Beta total");
    addChunk("alpha", documentKey("restricted"), documentData("alpha", "denied"), "Restricted total");
    addChunk("alpha", documentKey("receipt"), documentData("alpha", "invoices"), "Private receipt total");
    addChunk("alpha", documentKey("stale"), documentData(), "Obsolete price", { version: "old" });
    addChunk("alpha", documentKey("deleted"), documentData(), "Deleted price");
    mocks.records.get(`${DOCUMENTS}/deleted`)!.deletedAt = true;
    addChunk("alpha", documentKey("vaulted"), documentData(), "Vaulted price");
    mocks.records.get(`${DOCUMENTS}/vaulted`)!.folderId = "nested";

    const result = await searchRagDocuments(actor, "¿cuánto cobran?");
    expect(new Set(result.results.map((item) => item.excerpt))).toEqual(new Set(["Alpha total"]));
    expect(mocks.where.mock.calls).toEqual([["alpha", "section", "==", "quotes"], ["alpha", "scope", "in", ["documents/plans"]]]);
    expect(result.results[0].citation.href).toBe("/api/files?id=local&preview=pdf&project=alpha#page=2");
  });

  it("uses independent section permissions and cites the correct file in a multi-file quote", async () => {
    const quote = {
      projectId: "alpha",
      files: [0, 1].map((index) => ({
        fileName: `Offer-${index}.pdf`, contentType: "application/pdf", objectKey: `${projectStoragePrefix("alpha")}/quotes/offer-${index}.pdf`,
      })),
    };
    addChunk("alpha", quoteKey("package", 1), quote, "Second offer");
    const quotesOnly = { ...actor, permissions: { ...actor.permissions, documents: false } };
    const result = await searchRagDocuments(quotesOnly, "segundo proveedor");
    expect(result.results[0].citation.href).toBe("/api/quotes?id=package&file=1&index=1&project=alpha#page=2");
    const [citation] = result.results.map((item) => item.citation);
    expect(await readableAssistantSources(quotesOnly, [citation])).toEqual(new Set([assistantSourceToken(citation)]));
    expect(await readableAssistantSources({ ...quotesOnly, permissions: { ...quotesOnly.permissions, quotes: false } }, [citation])).toEqual(new Set());
    expect(await readableAssistantSources({ ...quotesOnly, projectId: "beta" }, [citation])).toEqual(new Set());
  });

  it("rejects a foreign attachment ID and a foreign Storage prefix", async () => {
    mocks.records.set(`${DOCUMENTS}/foreign`, documentData("beta"));
    const response = await attachmentStatus(new Request("http://test/api/assistant/documents?id=foreign"));
    expect(response.status).toBe(404);
    const forged = { ...documentData("beta"), projectId: "alpha" };
    expect(resolveRagSource("alpha", documentKey("forged"), forged, ragFolders(folders))).toBeNull();
  });

  it("requires a verified project membership before using the private index", async () => {
    const unverified = { ...actor, projectMembershipVerified: false };
    expect((await searchRagDocuments(unverified, "total")).results).toEqual([]);
    expect(mocks.embedding).not.toHaveBeenCalled();
    mocks.actor = unverified;
    expect((await attachmentStatus(new Request("http://test/api/assistant/documents?id=invoice"))).status).toBe(403);
  });

  it("rejects cross-project history and hides derived replies after a source becomes inaccessible", async () => {
    addChunk("alpha", documentKey("source"), documentData(), "Private evidence");
    const { results } = await searchRagDocuments(actor, "resumen de la oferta");
    const citation = results[0].citation;
    mocks.records.set(`${AGENT_CONVERSATIONS}/saved`, { projectId: "alpha", createdByUid: actor.uid });
    mocks.messages = [
      { role: "user", text: "Review the offer" },
      { role: "assistant", text: "Private evidence", citations: [citation] },
      { role: "assistant", text: "Private follow-up", documentDependencies: [citation] },
    ];
    expect((await getAssistantConversation(actor, "saved")).messages).toHaveLength(3);
    await expect(getAssistantConversation({ ...actor, projectId: "beta" }, "saved")).rejects.toThrow("conversation_not_found");
    mocks.records.get(`${DOCUMENTS}/source`)!.folderId = "denied";
    const history = await getAssistantConversation(actor, "saved");
    expect(history.messages.map((message) => message.text)).toEqual(["Review the offer"]);
  });

  it("excludes purchase photos and mobile captures even with section access", () => {
    const data = documentData("alpha", "invoices");
    expect(resolveRagSource("alpha", documentKey("photo"), { ...data, fileKind: "purchase" }, ragFolders(folders))).toBeNull();
    expect(resolveRagSource("alpha", documentKey("mobile"), { ...data, source: "mobile_capture" }, ragFolders(folders))).toBeNull();
  });
});
