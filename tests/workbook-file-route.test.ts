import { beforeEach, expect, it, vi } from "vitest";
import JSZip from "jszip";

const mocks = vi.hoisted(() => {
  const records = new Map<string, Record<string, unknown>>();
  const objects = new Map<string, Buffer>();
  let sequence = 0;
  const ref = (collection: string, id = `generated-${++sequence}`) => ({
    id,
    collection,
    get: async () => ({ exists: records.has(`${collection}/${id}`), data: () => records.get(`${collection}/${id}`) }),
  });
  const set = vi.fn((target: ReturnType<typeof ref>, data: Record<string, unknown>, options?: { merge?: boolean }) => {
    const key = `${target.collection}/${target.id}`;
    records.set(key, options?.merge ? { ...records.get(key), ...data } : data);
  });
  return {
    records, objects, ref, set,
    actor: vi.fn(),
    config: vi.fn(),
    payments: vi.fn(),
    oauth: vi.fn(),
    activity: vi.fn(),
    usage: vi.fn(),
    reset: () => { records.clear(); objects.clear(); sequence = 0; },
  };
});

vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "server-timestamp" } }));
vi.mock("@/lib/auth", () => ({ requireApproved: mocks.actor, requireTabAccess: mocks.actor }));
vi.mock("@/lib/firebase-admin", () => ({
  firestore: {
    collection: (name: string) => ({ doc: (id?: string) => mocks.ref(name, id), where: (_field: string, _operator: string, projectId: string) => ({ get: async () => {
      const payments = new Map((await mocks.payments(projectId)).map((payment: Record<string, unknown>) => [payment.id, payment]));
      for (const [path, data] of mocks.records) if (path.startsWith(`${name}/`) && data.projectId === projectId) payments.set(path.slice(name.length + 1), data);
      return { docs: [...payments].map(([id, payment]) => ({ id, data: () => payment })) };
    } }) }),
    runTransaction: async (write: (transaction: unknown) => Promise<unknown>) => write({
      get: (target: ReturnType<typeof mocks.ref>) => target.get(),
      set: mocks.set,
    }),
  },
  projectBucket: {
    file: (key: string) => ({
      exists: async () => [mocks.objects.has(key)],
      download: async () => {
        const bytes = mocks.objects.get(key);
        if (!bytes) throw new Error("Missing synthetic workbook");
        return [bytes];
      },
      save: async (bytes: Buffer) => { mocks.objects.set(key, Buffer.from(bytes)); },
      delete: async () => { mocks.objects.delete(key); },
    }),
  },
}));
vi.mock("@/lib/workbook-store", () => ({ workbookConfig: mocks.config, getWorkbookPayments: mocks.payments }));
vi.mock("@/lib/project-currency", () => ({
  readProjectCurrency: async (id: string) => mocks.records.get(`housePlannerProjects/${id}`)?.currency === "USD" ? "USD" : "CRC",
  lockProjectCurrency: async (id: string) => mocks.records.get(`housePlannerProjects/${id}`)?.currency === "USD" ? "USD" : "CRC",
  validateProjectCurrency: async (_tx: unknown, id: string, expected: string) => { if ((mocks.records.get(`housePlannerProjects/${id}`)?.currency === "USD" ? "USD" : "CRC") !== expected) throw new Error("project_currency_changed"); },
}));
vi.mock("@/lib/activity", () => ({ appendActivity: mocks.activity }));
vi.mock("@/lib/usage-actions", () => ({ completedUsageAction: mocks.usage }));
vi.mock("@/lib/google-sheets", () => ({
  googleConfigured: () => false,
  connectedGoogle: mocks.oauth,
  serviceGoogle: mocks.oauth,
  createGoogleFolder: vi.fn(),
  createGoogleWorkbook: vi.fn(),
  readStableGoogleWorkbook: vi.fn(),
  googleFileState: vi.fn(),
  updateGoogleWorkbook: vi.fn(),
}));

import { GET, POST } from "@/app/api/workbook/file/route";
import { consolidatedWorkbook } from "@/lib/consolidated-workbook";
import { deriveExpensesFromBudgetLines, type ExpenseAttachmentLink } from "@/lib/expenses";
import { CONFIG, PROJECTS, projectConfigDoc, projectStoragePrefix } from "@/lib/project";
import { createStarterWorkbook, loadWorkbook, readBudgetLines, writeWorkbook } from "@/lib/workbook";

const projectId = "qa-primary";
const configKey = `${CONFIG}/${projectConfigDoc(projectId)}`;
const baselineKey = `${projectStoragePrefix(projectId)}/workbooks/baseline.xlsx`;
const config = () => mocks.records.get(configKey)!;

async function downloadedWorkbook() {
  const response = await GET(new Request("http://localhost/api/workbook/file"));
  expect(response.status).toBe(200);
  const workbook = await loadWorkbook(Buffer.from(await response.arrayBuffer()));
  // Match Excel's independent row formulas before copying an XLSX row.
  workbook.eachSheet((sheet) => sheet.eachRow((row) => row.eachCell((cell) => {
    if (cell.formula) cell.value = { formula: cell.formula, result: cell.result };
  })));
  return workbook;
}

async function upload(workbook: Awaited<ReturnType<typeof loadWorkbook>>) {
  return uploadBytes(Buffer.from(await workbook.xlsx.writeBuffer()));
}

async function uploadBytes(bytes: Buffer) {
  const body = new FormData();
  body.set("file", new File([new Uint8Array(bytes)], "QA-offline-copy.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }));
  return POST(new Request("http://localhost/api/workbook/file", { method: "POST", body }));
}

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.reset();
  mocks.records.set(`${PROJECTS}/${projectId}`, { id: projectId, currency: "CRC" });
  mocks.actor.mockResolvedValue({ projectId, email: "qa-owner@example.invalid", role: "admin" });
  mocks.activity.mockResolvedValue({ id: "activity-1" });
  mocks.config.mockImplementation(async () => ({ objectKey: String(config().workbookObjectKey), fileName: "QA-budget.xlsx", paymentsModelVersion: config().paymentsModelVersion || 1, paymentLedgerRevision: config().paymentLedgerRevision || 0 }));
  mocks.payments.mockResolvedValue([]);
  const workbook = createStarterWorkbook();
  const sheet = workbook.getWorksheet("Presupuesto")!;
  sheet.getCell("A4").value = "QA Structure";
  sheet.getCell("B4").value = "QA Original concrete";
  sheet.getCell("E4").value = 1000;
  sheet.getCell("G4").value = 900;
  sheet.getCell("J4").value = 250;
  sheet.getCell("K4").value = "QA Supplier";
  mocks.objects.set(baselineKey, await consolidatedWorkbook(await writeWorkbook(workbook)));
  mocks.records.set(configKey, {
    projectId, workbookObjectKey: baselineKey, workbookFileName: "QA-budget.xlsx",
    workbookPlanVersion: 1, workbookActualsRevision: 3,
  });
});

it("reconciles a renamed offline copy before its original without Google, preserving amounts and receipt links", async () => {
  const original = readBudgetLines(await loadWorkbook(mocks.objects.get(baselineKey)!))[0];
  const receipt: ExpenseAttachmentLink = {
    id: "existing-receipt-link", budgetLineId: original.id, documentId: "existing-receipt",
    fileName: "QA-receipt.jpg", contentType: "image/jpeg", createdAt: "2026-10-08T00:00:00.000Z", isImage: true,
  };
  const workbook = await downloadedWorkbook();
  const sheet = workbook.getWorksheet("Presupuesto")!;
  sheet.insertRow(4, sheet.getRow(4).values);
  sheet.getCell("B4").value = "QA Copied item";
  sheet.getCell("A4").value = "QA New category";
  sheet.getCell("A5").value = "QA Renamed category";
  sheet.getCell("E4").value = 75;
  sheet.getCell("G4").value = 60;
  sheet.getCell("J4").value = 10;
  expect(sheet.getCell("Z4").value).toBe(sheet.getCell("Z5").value);

  const response = await upload(workbook);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, googleSynced: false, editingAllowed: true, unsupported: [] });
  const saved = await loadWorkbook(mocks.objects.get(String(config().workbookObjectKey))!);
  const lines = readBudgetLines(saved);
  expect(lines).toHaveLength(2);
  expect(lines.find((line) => line.item === original.item)).toMatchObject({
    id: original.id, chapter: "QA Renamed category", objective: 1000, quote: 900, paid: 250, supplier: "QA Supplier",
  });
  const copy = lines.find((line) => line.item === "QA Copied item")!;
  expect(copy).toMatchObject({ chapter: "QA New category", objective: 75, quote: 60, paid: 10 });
  expect(copy.id).not.toBe(original.id);
  expect(new Set(lines.map((line) => line.id)).size).toBe(2);
  const expenses = deriveExpensesFromBudgetLines(lines, [receipt]);
  expect(expenses.find((expense) => expense.id === original.id)?.attachments).toEqual([expect.objectContaining({ documentId: receipt.documentId })]);
  expect(expenses.find((expense) => expense.id === copy.id)?.attachments).toEqual([]);
  expect(saved.getWorksheet("_HousePlannerOffline")).toBeUndefined();
  expect(config()).toMatchObject({ projectId, workbookPlanVersion: 2, workbookActualsRevision: 3 });
  expect(String(config().workbookObjectKey)).toMatch(new RegExp(`^${projectStoragePrefix(projectId)}/workbooks/`));
  expect(mocks.objects.has(baselineKey)).toBe(true);
  expect(mocks.oauth).not.toHaveBeenCalled();
  expect(mocks.usage).toHaveBeenCalledWith(expect.objectContaining({ projectId }), "file.upload", "budget", "activity-1");
});

it("rejects ambiguous offline copies without overwriting the current workbook or its links", async () => {
  const workbook = await downloadedWorkbook();
  const sheet = workbook.getWorksheet("Presupuesto")!;
  sheet.insertRow(4, sheet.getRow(4).values);
  const response = await upload(workbook);
  expect(response.status).toBe(422);
  expect((await response.json()).error).toContain("nombre distinto");
  expect(config().workbookObjectKey).toBe(baselineKey);
  expect(mocks.objects.size).toBe(1);
  expect(mocks.set).not.toHaveBeenCalled();
  expect(mocks.usage).not.toHaveBeenCalled();
  expect(mocks.oauth).not.toHaveBeenCalled();
});

it.each(["A1", "B1"])("rejects an offline workbook with a foreign or stale %s stamp before saving", async (cell) => {
  const workbook = await downloadedWorkbook();
  workbook.getWorksheet("_HousePlannerOffline")!.getCell(cell).value = "foreign-or-stale";
  const response = await upload(workbook);
  expect(response.status).toBe(409);
  expect(config().workbookObjectKey).toBe(baselineKey);
  expect(mocks.objects.size).toBe(1);
  expect(mocks.set).not.toHaveBeenCalled();
  expect(mocks.usage).not.toHaveBeenCalled();
  expect(mocks.oauth).not.toHaveBeenCalled();
});

it("exports registered payments and restores the Excel historical baseline on reimport", async () => {
  const line = readBudgetLines(await loadWorkbook(mocks.objects.get(baselineKey)!))[0];
  mocks.payments.mockResolvedValue([{ id: "payment-1", budgetLineId: line.id, amount: 125, accountingMode: "ledger", payee: "QA Supplier", paymentKind: "partial" }]);
  const workbook = await downloadedWorkbook();
  expect(readBudgetLines(workbook)[0].paid).toBe(375);
  expect(workbook.getWorksheet("Pagos")?.getCell("A5").value).toBe("payment-1");
  workbook.getWorksheet("Presupuesto")!.getCell("B4").value = "Updated description";
  const response = await upload(workbook);
  expect(response.status).toBe(200);
  const saved = await loadWorkbook(mocks.objects.get(String(config().workbookObjectKey))!);
  expect(readBudgetLines(saved)[0]).toMatchObject({ id: line.id, paid: 250, item: "Updated description" });
  expect(saved.getWorksheet("Pagos")).toBeUndefined();
  expect(saved.getWorksheet("_HousePlannerPayments")).toBeUndefined();
  const exportedAgain = await downloadedWorkbook();
  expect(readBudgetLines(exportedAgain)[0].paid).toBe(375);
});

it("rejects payment edits in an exported Excel without writing a budget version", async () => {
  const line = readBudgetLines(await loadWorkbook(mocks.objects.get(baselineKey)!))[0];
  mocks.payments.mockResolvedValue([{ id: "payment-1", budgetLineId: line.id, amount: 125, accountingMode: "ledger" }]);
  const workbook = await downloadedWorkbook();
  workbook.getWorksheet("Pagos")!.getCell("E5").value = 999;
  const response = await upload(workbook);
  expect(response.status).toBe(422);
  expect((await response.json()).error).toContain("consulta");
  expect(config().workbookObjectKey).toBe(baselineKey);
  expect(mocks.objects.size).toBe(1);
  expect(mocks.set).not.toHaveBeenCalled();
});

it("exports calculated paid totals without leaking expense details to a budget-only reader", async () => {
  const line = readBudgetLines(await loadWorkbook(mocks.objects.get(baselineKey)!))[0];
  mocks.actor.mockResolvedValue({ projectId, email: "budget-viewer@example.invalid", role: "viewer", permissions: { budget: true, expenses: false } });
  mocks.payments.mockResolvedValue([
    { id: "private-payment-id", budgetLineId: line.id, amount: 125, accountingMode: "ledger", payee: "Private payee", notes: "Private notes", documentIds: ["private-receipt"] },
    { id: "unassigned-private", budgetLineId: null, amount: 500, accountingMode: "ledger", payee: "Unassigned payee", notes: "Unassigned notes" },
  ]);
  const workbook = await downloadedWorkbook();
  expect(readBudgetLines(workbook)[0].paid).toBe(375);
  const ledger = JSON.stringify(workbook.getWorksheet("Pagos")!.model);
  expect(ledger).toContain(`summary:${line.id}`);
  expect(ledger).not.toMatch(/private-payment-id|Private payee|Private notes|private-receipt|unassigned-private|Unassigned payee|Unassigned notes/);
  expect(workbook.getWorksheet("_HousePlannerPayments")!.getCell("D1").text).toBe("summary");
  mocks.actor.mockResolvedValue({ projectId, email: "admin@example.invalid", role: "admin" });
  const response = await upload(workbook);
  expect(response.status).toBe(200);
  const saved = await loadWorkbook(mocks.objects.get(String(config().workbookObjectKey))!);
  expect(readBudgetLines(saved)[0].paid).toBe(250);
});

it("rejects raw Excel cumulative paid changes on a line with registered ledger payments", async () => {
  const workbook = await loadWorkbook(mocks.objects.get(baselineKey)!);
  const line = readBudgetLines(workbook)[0];
  mocks.payments.mockResolvedValue([{ id: "payment-1", budgetLineId: line.id, amount: 125, accountingMode: "ledger" }]);
  workbook.getWorksheet("Presupuesto")!.getCell("J4").value = 375;
  const response = await upload(workbook);
  expect(response.status).toBe(422);
  expect((await response.json()).error).toContain("pagado histórico");
  expect(config().workbookObjectKey).toBe(baselineKey);
  expect(mocks.objects.size).toBe(1);
});

it.each(["ledger", "projection"])("rejects unsupported XLSX features that would bypass %s payment reconciliation", async (kind) => {
  const baselineBytes = mocks.objects.get(baselineKey)!;
  const line = readBudgetLines(await loadWorkbook(baselineBytes))[0];
  const bytes = kind === "projection" ? Buffer.from(await (await downloadedWorkbook()).xlsx.writeBuffer()) : baselineBytes;
  if (kind === "ledger") mocks.payments.mockResolvedValue([{ id: "payment-1", budgetLineId: line.id, amount: 125, accountingMode: "ledger" }]);
  const zip = await JSZip.loadAsync(bytes);
  zip.file("xl/charts/chart1.xml", "<chartSpace />");
  const response = await uploadBytes(await zip.generateAsync({ type: "nodebuffer" }));
  expect(response.status).toBe(422);
  expect((await response.json()).error).toContain("conciliar sus pagos");
  expect(config().workbookObjectKey).toBe(baselineKey);
  expect(mocks.objects.size).toBe(1);
  expect(mocks.set).not.toHaveBeenCalled();
  expect(mocks.usage).not.toHaveBeenCalled();
});

async function unifiedFixture() {
  const line = readBudgetLines(await loadWorkbook(mocks.objects.get(baselineKey)!))[0];
  mocks.records.set(configKey, { ...config(), paymentsModelVersion: 2, paymentLedgerRevision: 7, paymentProjectedLedgerRevision: 7 });
  mocks.payments.mockResolvedValue([{ id: "known-payment", budgetLineId: line.id, amount: 250, accountingMode: "historical-detail", payee: "Private payee", notes: "Private notes", documentIds: ["private-receipt"] }]);
  return line;
}

it("round-trips v2 payment exports and quote edits without creating another payment", async () => {
  const line = await unifiedFixture();
  const workbook = await downloadedWorkbook();
  expect(readBudgetLines(workbook)[0].paid).toBe(250);
  expect(workbook.getWorksheet("Pagos")!.getCell("A4").text).toBe("known-payment");
  expect(JSON.stringify(workbook.getWorksheet("Pagos")!.model)).not.toContain("ya incluido");
  workbook.getWorksheet("Presupuesto")!.getCell("G4").value = 950;
  const response = await upload(workbook);
  expect(response.status).toBe(200);
  expect(config().paymentLedgerRevision).toBe(7);
  expect(readBudgetLines(await loadWorkbook(mocks.objects.get(String(config().workbookObjectKey))!))[0]).toMatchObject({ id: line.id, paid: 250, quote: 950 });
  expect([...mocks.records.keys()].filter((key) => key.startsWith("housePlannerExpensePayments/"))).toHaveLength(0);
});

it("materializes only an external v2 increase and projects it on a second download", async () => {
  const line = await unifiedFixture();
  const workbook = await loadWorkbook(mocks.objects.get(baselineKey)!);
  workbook.getWorksheet("Presupuesto")!.getCell("J4").value = 350;
  const response = await upload(workbook);
  expect(response.status).toBe(200);
  const imports = [...mocks.records.entries()].filter(([path]) => path.startsWith("housePlannerExpensePayments/"));
  expect(imports).toHaveLength(1);
  expect(imports[0][1]).toMatchObject({ budgetLineId: line.id, amount: 100, source: "excel-import", paymentDate: "", payee: "", documentIds: [] });
  expect(config().paymentLedgerRevision).toBe(8);
  expect(readBudgetLines(await loadWorkbook(mocks.objects.get(String(config().workbookObjectKey))!))[0].paid).toBe(350);
});

it("redacts v2 financial details from budget-only downloads even when the stored source has a generated payment sheet", async () => {
  const line = await unifiedFixture();
  const full = await downloadedWorkbook();
  mocks.objects.set(baselineKey, await writeWorkbook(full));
  mocks.actor.mockResolvedValue({ projectId, role: "viewer", permissions: { budget: true, expenses: false } });
  const workbook = await downloadedWorkbook();
  const contents = JSON.stringify(workbook.model);
  expect(contents).toContain(`summary:${line.id}`);
  expect(contents).not.toMatch(/known-payment|Private payee|Private notes|private-receipt/);
  expect(readBudgetLines(workbook)[0].paid).toBe(250);
});
