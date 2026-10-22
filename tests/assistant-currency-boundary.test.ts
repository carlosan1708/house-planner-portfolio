import { beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_FOLDER_ACCESS, DEFAULT_MEMBER_PERMISSIONS, AGENT_PROPOSALS, CONFIG, projectConfigDoc, WORKBOOK_DRAFTS, type MemberRecord } from "@/lib/project";

const mocks = vi.hoisted(() => {
  const records = new Map<string, Record<string, unknown>>();
  let sequence = 0;
  const reference = (collection: string, id = `record-${++sequence}`) => ({
    id,
    get: async () => ({ exists: records.has(`${collection}/${id}`), data: () => records.get(`${collection}/${id}`) }),
    set: async (data: Record<string, unknown>) => { records.set(`${collection}/${id}`, { ...records.get(`${collection}/${id}`), ...data }); },
    collection: (child: string) => ({ doc: () => reference(`${collection}/${id}/${child}`), orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }) }),
  });
  return { records, reference, currency: "USD" as "USD" | "CRC", lock: vi.fn(), budget: vi.fn(), config: vi.fn(), editor: vi.fn(), generate: vi.fn(), save: vi.fn() };
});

vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "synthetic-time" } }));
vi.mock("@/lib/project-currency", () => ({ lockProjectCurrency: mocks.lock, validateProjectCurrency: async (_transaction: unknown, _projectId: string, expected: string) => { if (expected !== mocks.currency) throw new Error("project_currency_changed"); return mocks.currency; } }));
vi.mock("@/lib/firebase-admin", () => ({
  firestore: {
    collection: (name: string) => ({ doc: (id?: string) => mocks.reference(name, id) }),
    runTransaction: async (run: (transaction: unknown) => Promise<void>) => run({
      get: (ref: ReturnType<typeof mocks.reference>) => ref.get(),
      set: (ref: ReturnType<typeof mocks.reference>, data: Record<string, unknown>) => ref.set(data),
      update: (ref: ReturnType<typeof mocks.reference>, data: Record<string, unknown>) => ref.set(data),
    }),
  },
  projectBucket: { file: () => ({ save: mocks.save }) },
}));
vi.mock("@/lib/workbook-store", () => ({ budgetPayload: mocks.budget, workbookConfig: mocks.config, editorPayload: mocks.editor }));
vi.mock("@/lib/gemini", () => ({ assistantModel: () => "mock-model", geminiConfigured: () => true, geminiClient: () => ({ models: { generateContent: mocks.generate } }) }));
vi.mock("@/lib/document-index", () => ({ searchPermittedDocuments: vi.fn() }));
vi.mock("@/lib/project-notes", () => ({ listProjectNotes: vi.fn(), noteCitationsRemainEnabled: () => true, searchAssistantNotes: vi.fn() }));
vi.mock("@/lib/usage-actions", () => ({ completedUsageAction: vi.fn() }));

import { runAssistantTurn } from "@/lib/assistant-service";
import { confirmAssistantProposal } from "@/lib/assistant-drafts";

const actor: MemberRecord = { uid: "owner", email: "owner@example.test", name: "Owner", projectId: "usd-project", projectName: "USD project", isPersonal: false, role: "admin", status: "approved", permissions: DEFAULT_MEMBER_PERMISSIONS, folderAccess: DEFAULT_FOLDER_ACCESS };
const line = { id: "line", row: 4, chapter: "Kitchen", item: "Faucet", type: "Purchase", subcategory: "Kitchen", objective: 100, quote: 10, paid: 0, excess: 0, supplier: "", status: "Pending" };

beforeEach(() => {
  vi.clearAllMocks(); mocks.records.clear();
  mocks.currency = "USD"; mocks.lock.mockImplementation(async () => mocks.currency);
  mocks.budget.mockResolvedValue({ currency: "USD", lines: [line], planVersion: 1, actualsRevision: 1 });
  mocks.config.mockResolvedValue({ currency: "USD", objectKey: "source.xlsx", planVersion: 1, actualsRevision: 1 });
  mocks.records.set(`${CONFIG}/${projectConfigDoc(actor.projectId)}`, { workbookObjectKey: "source.xlsx", workbookPlanVersion: 1, workbookActualsRevision: 1 });
  mocks.editor.mockResolvedValue({ currency: "USD", editingAllowed: true, workbook: { sheetOrder: ["budget"], sheets: { budget: { name: "Presupuesto", cellData: { 3: { 6: { v: 10 } } } } } } });
  mocks.save.mockResolvedValue(undefined);
});

it("locks the canonical denomination before preparing a proposal and preserves its USD values", async () => {
  mocks.generate.mockResolvedValueOnce({ functionCalls: [{ id: "call", name: "propose_budget_changes", args: { summary: "Update quote", changes: [{ lineId: "line", field: "quote", value: 25.5, reason: "Supplier quote" }] } }] }).mockResolvedValueOnce({ text: "Ready for review" });
  const result = await runAssistantTurn(actor, { message: "Set the faucet quote to 25.50" });
  expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.budget.mock.invocationCallOrder[0]);
  expect(mocks.records.get(`${AGENT_PROPOSALS}/${result.proposal!.id}`)).toMatchObject({ currency: "USD", status: "pending", changes: [{ before: 10, after: 25.5 }] });
});

it("keeps read-only assistant budget tools free of the financial currency lock", async () => {
  mocks.generate.mockResolvedValueOnce({ functionCalls: [{ id: "read", name: "get_budget_summary", args: {} }] }).mockResolvedValueOnce({ text: "The project uses USD" });
  await runAssistantTurn(actor, { message: "What is the budget?" });
  expect(mocks.budget).toHaveBeenCalledWith(actor.projectId);
  expect(mocks.lock).not.toHaveBeenCalled();
});

it("locks before confirming a proposal into a workbook draft and fails before reading money if the lock fails", async () => {
  mocks.records.set(`${AGENT_PROPOSALS}/proposal`, { projectId: actor.projectId, createdByUid: actor.uid, status: "pending", basePlanVersion: 1, baseActualsRevision: 1, changes: [{ row: 4, field: "quote", after: 25.5 }] });
  const result = await confirmAssistantProposal(actor, "proposal");
  expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.config.mock.invocationCallOrder[0]);
  expect(mocks.records.get(`${WORKBOOK_DRAFTS}/${result.draftId}`)).toMatchObject({ currency: "USD", source: "assistant" });
  expect(JSON.parse(mocks.save.mock.calls[1][0]).sheets.budget.cellData[3][6].v).toBe(25.5);
  mocks.records.set(`${AGENT_PROPOSALS}/blocked`, { projectId: actor.projectId, createdByUid: actor.uid, status: "pending" });
  mocks.lock.mockRejectedValueOnce(new Error("project_not_found"));
  const reads = mocks.config.mock.calls.length, writes = mocks.save.mock.calls.length;
  await expect(confirmAssistantProposal(actor, "blocked")).rejects.toThrow("project_not_found");
  expect(mocks.config).toHaveBeenCalledTimes(reads);
  expect(mocks.save).toHaveBeenCalledTimes(writes);
});

it("rejects an explicitly stale proposal denomination before preparing a draft", async () => {
  mocks.records.set(`${AGENT_PROPOSALS}/stale`, { currency: "CRC", projectId: actor.projectId, createdByUid: actor.uid, status: "pending", basePlanVersion: 1, baseActualsRevision: 1, changes: [] });
  await expect(confirmAssistantProposal(actor, "stale")).rejects.toThrow("stale_proposal_currency");
  expect(mocks.save).not.toHaveBeenCalled();
});

it("does not confirm a prepared USD draft if correction commits before its transaction", async () => {
  mocks.records.set(`${AGENT_PROPOSALS}/race`, { currency: "USD", projectId: actor.projectId, createdByUid: actor.uid, status: "pending", basePlanVersion: 1, baseActualsRevision: 1, changes: [] });
  mocks.save.mockImplementationOnce(async () => { mocks.currency = "CRC"; });
  await expect(confirmAssistantProposal(actor, "race")).rejects.toThrow("project_currency_changed");
  expect(mocks.records.get(`${AGENT_PROPOSALS}/race`)?.status).toBe("pending");
  expect([...mocks.records.keys()].filter((key) => key.startsWith(`${WORKBOOK_DRAFTS}/`))).toEqual([]);
});
