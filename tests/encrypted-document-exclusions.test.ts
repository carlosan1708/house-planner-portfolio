import { beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_MEMBER_PERMISSIONS, type MemberRecord } from "@/lib/project";

const mocks = vi.hoisted(() => ({
  records: new Map<string, Record<string, unknown>>(),
  set: vi.fn(),
  download: vi.fn(),
  extractRawText: vi.fn(),
  runTransaction: vi.fn(),
  folders: [] as { id: string; parentId: string | null; encrypted?: boolean }[],
  topLevelMap: new Map<string, string>(),
}));

vi.mock("@/lib/firebase-admin", () => ({
  firestore: {
    runTransaction: mocks.runTransaction,
    collection: () => ({
      doc: (id: string) => ({ get: async () => ({ exists: mocks.records.has(id), data: () => mocks.records.get(id) }), set: mocks.set }),
      where: () => ({ get: async () => ({ docs: [...mocks.records].map(([id, data]) => ({ id, data: () => data, ref: { get: async () => ({ data: () => data }), set: mocks.set } })) }) }),
    }),
  },
  projectBucket: { file: () => ({ download: mocks.download }) },
}));
vi.mock("@/lib/auth", () => ({ canAccessFolder: () => true }));
vi.mock("@/lib/folders", () => ({
  listProjectFolders: async () => mocks.folders,
  buildTopLevelFolderMap: () => mocks.topLevelMap,
  folderTopLevelId: (id: string | null) => id ? mocks.topLevelMap.get(id) ?? null : null,
  findExpenseInvoiceFolder: () => undefined,
  findExpensePurchaseFolder: () => undefined,
}));
vi.mock("@/lib/workbook-store", () => ({ budgetPayload: vi.fn() }));
vi.mock("@/lib/gemini", () => ({ assistantModel: vi.fn(), geminiClient: vi.fn() }));
vi.mock("mammoth", () => ({ default: { extractRawText: mocks.extractRawText } }));
vi.mock("pdf-parse", () => ({ PDFParse: vi.fn() }));

import { indexDocumentBytes, refreshDocumentIndex, searchPermittedDocuments } from "@/lib/document-index";
import { permittedReferenceDocuments } from "@/lib/quote-context";

const actor: MemberRecord = {
  uid: "owner", projectId: "p1", projectName: "House", isPersonal: false,
  email: "owner@test.local", name: "Owner", role: "admin", status: "approved",
  permissions: { ...DEFAULT_MEMBER_PERMISSIONS },
  folderAccess: { mode: "all", folderIds: [], allowUnfiled: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.records.clear();
  mocks.folders = [{ id: "vault", parentId: null, encrypted: true }, { id: "nested", parentId: "vault" }, { id: "public", parentId: null }];
  mocks.topLevelMap = new Map([["vault", "vault"], ["nested", "vault"], ["public", "public"]]);
  mocks.runTransaction.mockImplementation(async (callback) => callback({
    get: (ref: { get: () => Promise<unknown> }) => ref.get(),
    set: (_ref: unknown, value: unknown, options: unknown) => mocks.set(value, options),
  }));
});

it.each([
  { encrypted: true, folderId: "public" },
  { encrypted: false, folderId: "nested" },
])("clears every plaintext AI derivative before indexing protected documents: %j", async (protection) => {
  mocks.records.set("secret", { projectId: "p1", ...protection, aiText: "Secret text", aiDescription: "Secret description" });
  const result = await indexDocumentBytes({ projectId: "p1", documentId: "secret", bytes: Buffer.from("secret"), fileName: "secret.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", folderId: protection.folderId });
  expect(result.status).toBe("encrypted");
  expect(mocks.extractRawText).not.toHaveBeenCalled();
  expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ aiIndexStatus: "encrypted", aiText: expect.anything(), aiDescription: expect.anything(), aiIndexProvider: expect.anything(), aiIndexError: expect.anything() }), { merge: true });
});

it("blocks the refresh path before downloading an encrypted payload", async () => {
  mocks.records.set("secret", { projectId: "p1", encrypted: true, objectKey: "secret/key", fileName: "secret.pdf", contentType: "application/pdf", folderId: "public" });
  expect(await refreshDocumentIndex("p1", "secret")).toBe("encrypted");
  expect(mocks.download).not.toHaveBeenCalled();
});

it("does not persist plaintext when a document enters the vault during text extraction", async () => {
  mocks.records.set("moving", { projectId: "p1", folderId: "public" });
  mocks.extractRawText.mockImplementationOnce(async () => {
    mocks.records.set("moving", { projectId: "p1", folderId: "vault", encrypted: true });
    return { value: "Private content extracted while encryption changed" };
  });
  const result = await indexDocumentBytes({ projectId: "p1", documentId: "moving", bytes: Buffer.from("document"), fileName: "contract.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", folderId: "public" });
  expect(result.status).toBe("encrypted");
  expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ aiIndexStatus: "encrypted" }), { merge: true });
  expect(mocks.set.mock.calls.every(([value]) => typeof value.aiText !== "string" && typeof value.aiDescription !== "string")).toBe(true);
});

it("excludes encrypted flags and ancestors from text search and quote references even for admins", async () => {
  const base = { projectId: "p1", fileName: "plan.pdf", contentType: "application/pdf", objectKey: "object", quoteReferenceEnabled: true, aiText: "legal conditions", aiDescription: "legal document" };
  mocks.records.set("ordinary", { ...base, folderId: "public" });
  mocks.records.set("encrypted", { ...base, folderId: "public", encrypted: true });
  mocks.records.set("nested", { ...base, folderId: "nested" });
  expect((await searchPermittedDocuments(actor, "legal")).map((item) => item.documentId)).toEqual(["ordinary"]);
  expect((await permittedReferenceDocuments(actor)).map((item) => item.id)).toEqual(["ordinary"]);
  expect(mocks.download).not.toHaveBeenCalled();
});
