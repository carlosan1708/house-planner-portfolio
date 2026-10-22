import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  get: vi.fn(),
  recursiveDelete: vi.fn(),
  file: vi.fn(),
  fileDelete: vi.fn(),
  set: vi.fn(),
  lockCurrency: vi.fn(),
  budgetContext: vi.fn(),
  analyze: vi.fn(),
  ref: { id: "quote-1" },
}));

vi.mock("@/lib/project-currency", () => ({ lockProjectCurrency: mocks.lockCurrency }));
vi.mock("@/lib/usage-actions", () => ({ completedUsageAction: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireTabAccess: mocks.actor }));
vi.mock("@/lib/firebase-admin", () => ({
  firestore: {
    collection: () => ({ doc: () => ({ ...mocks.ref, get: mocks.get, set: mocks.set }) }),
    recursiveDelete: mocks.recursiveDelete,
  },
  projectBucket: { file: mocks.file },
}));
vi.mock("@/lib/quote-analysis", () => ({ analyzeQuote: mocks.analyze }));
vi.mock("@/lib/quote-context", () => ({
  isQuoteDocument: vi.fn(), loadReferenceInputs: vi.fn(), loadStoredQuoteInputs: vi.fn(), permittedReferenceDocuments: vi.fn(), quoteBudgetContext: mocks.budgetContext, quoteMime: vi.fn(), storedQuoteLabel: vi.fn(),
  storedQuoteFiles: (data: { files?: Array<{ fileName: string; contentType: string; objectKey: string; size: number }>; fileName?: string; contentType?: string; objectKey?: string; size?: number }) => data.files?.map((file) => ({ name: file.fileName, ...file })) || [{ name: data.fileName, contentType: data.contentType, objectKey: data.objectKey, size: data.size }],
}));

import { POST, DELETE } from "@/app/api/quotes/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lockCurrency.mockResolvedValue("CRC");
  mocks.actor.mockResolvedValue({ uid: "editor", email: "editor@example.com", projectId: "project-a", role: "editor" });
  mocks.get.mockResolvedValue({
    exists: true,
    data: () => ({ projectId: "project-a", status: "ready", files: [
      { fileName: "quote-1.pdf", contentType: "application/pdf", objectKey: "house-planner/projects/project-a/quotes/quote-1.pdf", size: 10 },
      { fileName: "terms.png", contentType: "image/png", objectKey: "house-planner/projects/project-a/quotes/terms.png", size: 20 },
    ] }),
  });
  mocks.recursiveDelete.mockResolvedValue(undefined);
  mocks.file.mockReturnValue({ delete: mocks.fileDelete });
  mocks.fileDelete.mockResolvedValue(undefined);
});

it("deletes a completed quote, its messages, and its stored original", async () => {
  const response = await DELETE(new Request("http://localhost/api/quotes?id=quote-1", { method: "DELETE" }));
  expect(response.status).toBe(200);
  expect(mocks.actor).toHaveBeenCalledWith("quotes", ["admin", "editor"]);
  expect(mocks.recursiveDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "quote-1" }));
  expect(mocks.file).toHaveBeenCalledTimes(2);
  expect(mocks.fileDelete).toHaveBeenCalledTimes(2);
  expect(mocks.fileDelete).toHaveBeenCalledWith({ ignoreNotFound: true });
});

it("cannot delete a quote from another project", async () => {
  mocks.get.mockResolvedValue({ exists: true, data: () => ({ projectId: "project-b", status: "ready" }) });
  const response = await DELETE(new Request("http://localhost/api/quotes?id=quote-1", { method: "DELETE" }));
  expect(response.status).toBe(404);
  expect(mocks.recursiveDelete).not.toHaveBeenCalled();
});

it("does not delete a quote while its analysis is running", async () => {
  mocks.get.mockResolvedValue({ exists: true, data: () => ({ projectId: "project-a", status: "analyzing" }) });
  const response = await DELETE(new Request("http://localhost/api/quotes?id=quote-1", { method: "DELETE" }));
  expect(response.status).toBe(409);
  expect(mocks.recursiveDelete).not.toHaveBeenCalled();
});

it.each(['{"currency":"USD"}', '{"currency":"USD","lines":['])("locks USD before preparing bounded quote budget context %s", async (budgetContext) => {
  const context = await import("@/lib/quote-context");
  mocks.actor.mockResolvedValue({ projectId: "project-a", email: "owner@example.com", role: "admin" });
  mocks.lockCurrency.mockResolvedValue("USD");
  vi.mocked(context.isQuoteDocument).mockReturnValue(true);
  vi.mocked(context.quoteMime).mockReturnValue("application/pdf");
  vi.mocked(context.loadReferenceInputs).mockResolvedValue([]);
  mocks.file.mockReturnValue({ save: vi.fn(), delete: mocks.fileDelete });
  mocks.budgetContext.mockResolvedValue(budgetContext);
  mocks.analyze.mockResolvedValue({ summary: "Synthetic analysis" });
  const form = new FormData(); form.append("files", new File(["synthetic PDF"], "quote.pdf", { type: "application/pdf" }));
  const result = await POST(new Request("http://localhost/api/quotes", { method: "POST", body: form }));
  expect(result.status).toBe(201);
  expect(mocks.set.mock.calls[0][0]).toMatchObject({ currency: "USD" });
  expect(mocks.lockCurrency.mock.invocationCallOrder[0]).toBeLessThan(mocks.budgetContext.mock.invocationCallOrder[0]);
  expect(mocks.analyze.mock.calls[0][0].budgetContext).toBe(budgetContext);
});
