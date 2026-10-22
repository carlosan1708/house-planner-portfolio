import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  type Stored = Record<string, unknown>;
  type Reference = { id: string; collection: string; path: string; get: () => Promise<Snapshot>; set: (data: Stored, options?: { merge?: boolean }) => Promise<unknown> };
  type Snapshot = { id: string; ref: Reference; exists: boolean; data: () => Stored | undefined };
  type Query = { where: (field: string, operator: string, value: unknown) => Query; get: () => Promise<{ docs: Snapshot[] }> };
  type SaveOptions = { preconditionOpts?: { ifGenerationMatch?: number } };
  const records = new Map<string, Stored>(), objects = new Map<string, Buffer>();
  const hooks = { beforeGet: null as ((path: string) => void | Promise<void>) | null, afterSave: null as ((key: string) => void | Promise<void>) | null };
  let sequence = 0;
  const reference = (collection: string, id = `generated-${++sequence}`): Reference => ({
    id, collection, path: `${collection}/${id}`,
    get: async () => snapshot(collection, id),
    set: async (data: Stored, options?: { merge?: boolean }) => set(reference(collection, id), data, options),
  });
  const snapshot = (collection: string, id: string): Snapshot => {
    const value = records.get(`${collection}/${id}`);
    return { id, ref: reference(collection, id), exists: value !== undefined, data: () => value && structuredClone(value) };
  };
  const set = vi.fn((ref: ReturnType<typeof reference>, data: Stored, options?: { merge?: boolean }) => {
    records.set(ref.path, structuredClone(options?.merge ? { ...records.get(ref.path), ...data } : data));
  });
  const query = (collection: string, filters: Array<[string, unknown]> = []): Query => ({
    where: (field: string, _operator: string, value: unknown) => query(collection, [...filters, [field, value]]),
    get: async () => ({ docs: [...records.entries()].flatMap(([path, data]) => path.startsWith(`${collection}/`) && filters.every(([field, value]) => data[field] === value) ? [snapshot(collection, path.slice(collection.length + 1))] : []) }),
  });
  const transaction = vi.fn(async (run: (tx: unknown) => Promise<unknown>) => {
    const pending: Array<() => void> = [];
    const tx = {
      get: async (target: { path?: string; get: () => Promise<unknown> }) => { await hooks.beforeGet?.(target.path || "query"); return target.get(); },
      set: (ref: ReturnType<typeof reference>, data: Stored, options?: { merge?: boolean }) => pending.push(() => set(ref, data, options)),
      update: (ref: ReturnType<typeof reference>, data: Stored) => pending.push(() => set(ref, data, { merge: true })),
    };
    const result = await run(tx);
    pending.forEach((write) => write());
    return result;
  });
  const save = vi.fn(async (key: string, bytes: Buffer, options?: SaveOptions) => {
    if (options?.preconditionOpts?.ifGenerationMatch === 0 && objects.has(key)) throw Object.assign(new Error("Object already exists"), { code: 412 });
    objects.set(key, Buffer.from(bytes)); await hooks.afterSave?.(key);
  });
  return {
    records, objects, hooks, reference, set, query, transaction, save,
    reset: () => { records.clear(); objects.clear(); sequence = 0; hooks.beforeGet = null; hooks.afterSave = null; },
  };
});

const currencyMock = vi.hoisted(() => ({ value: "CRC" as "CRC" | "USD", lock: vi.fn() }));
vi.mock("@/lib/project-currency", () => ({
  readProjectCurrency: async () => currencyMock.value,
  lockProjectCurrency: currencyMock.lock,
  validateProjectCurrency: async (_transaction: unknown, _projectId: string, expected: string) => {
    if (expected !== currencyMock.value) throw new Error("project_currency_changed");
    return currencyMock.value;
  },
}));
beforeEach(() => { currencyMock.value = "CRC"; currencyMock.lock.mockImplementation(async () => currencyMock.value); });

vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "server-time" } }));
vi.mock("@/lib/firebase-admin", () => ({
  firestore: { collection: (name: string) => ({ doc: (id?: string) => mocks.reference(name, id), where: (field: string, operator: string, value: unknown) => mocks.query(name).where(field, operator, value) }), runTransaction: mocks.transaction },
  projectBucket: { file: (key: string) => ({
    download: async () => { const bytes = mocks.objects.get(key); if (!bytes) throw new Error("Missing synthetic workbook"); return [Buffer.from(bytes)]; },
    save: (bytes: Buffer, options?: { preconditionOpts?: { ifGenerationMatch?: number } }) => mocks.save(key, bytes, options),
    delete: async () => { mocks.objects.delete(key); },
  }) },
}));

import { flushPaymentProjection, prepareWorkbookPaymentChange, readPaymentLedgerState } from "@/lib/expense-ledger";
import { CONFIG, EXPENSE_PAYMENTS, projectConfigDoc, projectStoragePrefix } from "@/lib/project";
import { createStarterWorkbook, loadWorkbook, readBudgetLines, writeWorkbook } from "@/lib/workbook";

const projectId = "qa-ledger-v2";
const configPath = `${CONFIG}/${projectConfigDoc(projectId)}`;
const baselineKey = `${projectStoragePrefix(projectId)}/workbooks/baseline.xlsx`;
const active = (): Array<Record<string, unknown> & { id: string }> => [...mocks.records.entries()].flatMap(([path, data]) => path.startsWith(`${EXPENSE_PAYMENTS}/`) && !data.deletedAt ? [{ ...data, id: path.slice(EXPENSE_PAYMENTS.length + 1) }] : []);
const currentConfig = () => mocks.records.get(configPath)!;

async function source(paid = 1600) {
  const workbook = createStarterWorkbook(currencyMock.value), sheet = workbook.getWorksheet("Presupuesto")!;
  sheet.getCell("B4").value = "Honorarios de arquitectura";
  sheet.getCell("E4").value = 3000; sheet.getCell("G4").value = 2500; sheet.getCell("J4").value = paid;
  return workbook;
}
async function seed(paid = 1600, amounts = [800, 400, 200, 200]) {
  const workbook = await source(paid), line = readBudgetLines(workbook)[0];
  mocks.objects.set(baselineKey, await writeWorkbook(workbook));
  mocks.records.set(configPath, { projectId, workbookObjectKey: baselineKey, workbookPlanVersion: 4, workbookActualsRevision: 2, paymentsModelVersion: 2, paymentLedgerRevision: 7, paymentProjectedLedgerRevision: 7, paymentProjectionPending: false });
  amounts.forEach((amount, index) => mocks.records.set(`${EXPENSE_PAYMENTS}/known-${index + 1}`, { projectId, budgetLineId: line.id, amount, accountingMode: index % 2 ? "ledger" : "historical-detail", documentIds: [`receipt-${index + 1}`], paymentDate: `2026-10-${10 + index}`, payee: `Profesional ${index + 1}` }));
  return { workbook, line };
}
async function commit(change: Awaited<ReturnType<typeof prepareWorkbookPaymentChange>>) {
  await mocks.transaction(async (tx: unknown) => {
    const transaction = tx as Parameters<typeof change.validate>[0];
    await change.validate(transaction); change.write(transaction);
  });
}

beforeEach(() => { vi.clearAllMocks(); mocks.reset(); });

describe("single payment ledger workbook reconciliation", () => {
  it("reads model state without reconstructing payments or writing financial data", async () => {
    await seed(); const before = structuredClone(active());
    expect(await readPaymentLedgerState(projectId)).toMatchObject({ paymentsModelVersion: 2, paymentLedgerRevision: 7, objectKey: baselineKey });
    await readPaymentLedgerState(projectId);
    expect(active()).toEqual(before); expect(mocks.set).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });

  it("keeps the four architecture payments and their receipt IDs when their sum already explains Excel", async () => {
    const { workbook } = await seed();
    const before = structuredClone(active());
    const proposed = await loadWorkbook(await writeWorkbook(workbook));
    const change = await prepareWorkbookPaymentChange(projectId, workbook, proposed);
    await commit(change);
    expect(active()).toEqual(before);
    expect(readBudgetLines(proposed)[0]).toMatchObject({ paid: 1600, quote: 2500, objective: 3000 });
    expect(active().reduce((total, payment) => total + Number(payment.amount), 0)).toBe(1600);
  });

  it("imports only the unexplained positive gap with no invented date or beneficiary", async () => {
    const { workbook, line } = await seed(1200, [800, 400]);
    const proposed = await loadWorkbook(await writeWorkbook(workbook));
    proposed.getWorksheet("Presupuesto")!.getCell("J4").value = 1600;
    await commit(await prepareWorkbookPaymentChange(projectId, workbook, proposed));
    const imported = active().filter((payment) => payment.source === "excel-import");
    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({ budgetLineId: line.id, amount: 400, source: "excel-import", sourceLabel: "Pago de Excel sin detalle", paymentDate: "", payee: "" });
    expect(imported[0].documentIds || []).toEqual([]);
    expect(active().reduce((total, payment) => total + Number(payment.amount), 0)).toBe(1600);
    expect(readBudgetLines(proposed)[0].paid).toBe(1600);
  });

  it("does not interpret the unchanged old Excel value as a decrease after an app payment", async () => {
    const { workbook, line } = await seed(1600);
    mocks.records.set(`${EXPENSE_PAYMENTS}/app-new`, { projectId, budgetLineId: line.id, amount: 500, accountingMode: "ledger" });
    mocks.records.set(configPath, { ...currentConfig(), paymentLedgerRevision: 8, paymentProjectionPending: true });
    const proposed = await loadWorkbook(await writeWorkbook(workbook));
    await commit(await prepareWorkbookPaymentChange(projectId, workbook, proposed));
    expect(readBudgetLines(proposed)[0].paid).toBe(2100);
    expect(active().filter((payment) => payment.source === "excel-import")).toHaveLength(0);
    expect(active()).toHaveLength(5);
  });

  it("keeps repeated imports idempotent and does not resurrect a deleted imported payment from unchanged Excel", async () => {
    const { workbook } = await seed(1200, [800, 400]);
    const proposed = await loadWorkbook(await writeWorkbook(workbook));
    proposed.getWorksheet("Presupuesto")!.getCell("J4").value = 1600;
    await commit(await prepareWorkbookPaymentChange(projectId, workbook, proposed));
    await flushPaymentProjection(projectId);
    const imported = active().find((payment) => payment.source === "excel-import")!;
    const ids = active().map((payment) => payment.id).sort();
    const canonical = await loadWorkbook(mocks.objects.get(String(currentConfig().workbookObjectKey))!);
    const repeat = await loadWorkbook(await writeWorkbook(canonical));
    await commit(await prepareWorkbookPaymentChange(projectId, canonical, repeat));
    expect(active().map((payment) => payment.id).sort()).toEqual(ids);
    mocks.records.set(`${EXPENSE_PAYMENTS}/${imported.id}`, { ...mocks.records.get(`${EXPENSE_PAYMENTS}/${imported.id}`), deletedAt: "user-deleted" });
    mocks.records.set(configPath, { ...currentConfig(), paymentLedgerRevision: Number(currentConfig().paymentLedgerRevision) + 1, paymentProjectionPending: true });
    const unchangedExcel = await loadWorkbook(await writeWorkbook(canonical));
    await commit(await prepareWorkbookPaymentChange(projectId, canonical, unchangedExcel));
    expect(active().filter((payment) => payment.source === "excel-import")).toHaveLength(0);
    expect(readBudgetLines(unchangedExcel)[0].paid).toBe(1200);
    expect(mocks.records.get(`${EXPENSE_PAYMENTS}/${imported.id}`)?.deletedAt).toBe("user-deleted");
  });

  it("excludes foreign, deleted and unassigned payments from an existing line's total", async () => {
    const { workbook, line } = await seed();
    mocks.records.set(`${EXPENSE_PAYMENTS}/foreign`, { projectId: "another-project", budgetLineId: line.id, amount: 9000 });
    mocks.records.set(`${EXPENSE_PAYMENTS}/deleted`, { projectId, budgetLineId: line.id, amount: 8000, deletedAt: "before" });
    mocks.records.set(`${EXPENSE_PAYMENTS}/unassigned`, { projectId, budgetLineId: null, amount: 70 });
    const proposed = await loadWorkbook(await writeWorkbook(workbook));
    await commit(await prepareWorkbookPaymentChange(projectId, workbook, proposed));
    expect(readBudgetLines(proposed)[0].paid).toBe(1600);
    expect(active().filter((payment) => payment.source === "excel-import")).toHaveLength(0);
    expect(mocks.records.get(`${EXPENSE_PAYMENTS}/foreign`)?.amount).toBe(9000);
  });

  it("rejects a real decrease without deleting or shrinking existing payments", async () => {
    const { workbook } = await seed();
    const proposed = await loadWorkbook(await writeWorkbook(workbook));
    proposed.getWorksheet("Presupuesto")!.getCell("J4").value = 1400;
    const before = structuredClone(active());
    await expect(prepareWorkbookPaymentChange(projectId, workbook, proposed)).rejects.toThrow();
    expect(active()).toEqual(before);
    expect(currentConfig().paymentLedgerRevision).toBe(7);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("rejects an import prepared before another payment changes the ledger", async () => {
    const { workbook, line } = await seed();
    const proposed = await loadWorkbook(await writeWorkbook(workbook));
    proposed.getWorksheet("Presupuesto")!.getCell("J4").value = 1800;
    const change = await prepareWorkbookPaymentChange(projectId, workbook, proposed);
    mocks.records.set(`${EXPENSE_PAYMENTS}/concurrent`, { projectId, budgetLineId: line.id, amount: 100 });
    mocks.records.set(configPath, { ...currentConfig(), paymentLedgerRevision: 8 });
    await expect(commit(change)).rejects.toThrow();
    expect(active().filter((payment) => payment.source === "excel-import")).toHaveLength(0);
    expect(currentConfig().paymentLedgerRevision).toBe(8);
  });

  it("writes pending app payments into an immutable workbook and clears only the matching outbox revision", async () => {
    const { line } = await seed();
    mocks.records.set(`${EXPENSE_PAYMENTS}/app-new`, { projectId, budgetLineId: line.id, amount: 500 });
    mocks.records.set(configPath, { ...currentConfig(), paymentLedgerRevision: 8, paymentProjectionPending: true });
    await flushPaymentProjection(projectId);
    expect(currentConfig()).toMatchObject({ paymentLedgerRevision: 8, paymentProjectedLedgerRevision: 8, paymentProjectionPending: false });
    const currentKey = String(currentConfig().workbookObjectKey);
    expect(currentKey).not.toBe(baselineKey);
    expect(readBudgetLines(await loadWorkbook(mocks.objects.get(currentKey)!))[0].paid).toBe(2100);
    expect(readBudgetLines(await loadWorkbook(mocks.objects.get(baselineKey)!))[0].paid).toBe(1600);
    expect((await readPaymentLedgerState(projectId)).paymentsModelVersion).toBe(2);
  });

  it("keeps a concurrent payment pending when a previously prepared projection loses its revision check", async () => {
    const { line } = await seed();
    mocks.records.set(`${EXPENSE_PAYMENTS}/app-new`, { projectId, budgetLineId: line.id, amount: 500 });
    mocks.records.set(configPath, { ...currentConfig(), paymentLedgerRevision: 8, paymentProjectionPending: true });
    mocks.hooks.afterSave = () => {
      mocks.hooks.afterSave = null;
      mocks.records.set(`${EXPENSE_PAYMENTS}/concurrent`, { projectId, budgetLineId: line.id, amount: 100 });
      mocks.records.set(configPath, { ...currentConfig(), paymentLedgerRevision: 9, paymentProjectionPending: true });
    };
    await expect(flushPaymentProjection(projectId)).rejects.toThrow();
    expect(currentConfig()).toMatchObject({ workbookObjectKey: baselineKey, paymentLedgerRevision: 9, paymentProjectedLedgerRevision: 7, paymentProjectionPending: true });
    expect(active().reduce((total, payment) => total + Number(payment.amount), 0)).toBe(2200);
    await flushPaymentProjection(projectId);
    expect(currentConfig()).toMatchObject({ paymentLedgerRevision: 9, paymentProjectedLedgerRevision: 9, paymentProjectionPending: false });
    expect(readBudgetLines(await loadWorkbook(mocks.objects.get(String(currentConfig().workbookObjectKey))!))[0].paid).toBe(2200);
  });

  it("retains accepted payments through a storage outage and projects them once on retry", async () => {
    const { line } = await seed();
    mocks.records.set(`${EXPENSE_PAYMENTS}/app-new`, { projectId, budgetLineId: line.id, amount: 500 });
    mocks.records.set(configPath, { ...currentConfig(), paymentLedgerRevision: 8, paymentProjectionPending: true });
    mocks.save.mockRejectedValueOnce(new Error("Synthetic storage outage"));
    await expect(flushPaymentProjection(projectId)).rejects.toThrow("Synthetic storage outage");
    expect(currentConfig()).toMatchObject({ workbookObjectKey: baselineKey, paymentLedgerRevision: 8, paymentProjectionPending: true });
    expect(active()).toHaveLength(5);
    await flushPaymentProjection(projectId);
    expect(active()).toHaveLength(5);
    expect(readBudgetLines(await loadWorkbook(mocks.objects.get(String(currentConfig().workbookObjectKey))!))[0].paid).toBe(2100);
  });

  it("reuses an immutable candidate after its first database commit failed", async () => {
    const { line } = await seed();
    mocks.records.set(`${EXPENSE_PAYMENTS}/app-new`, { projectId, budgetLineId: line.id, amount: 500 });
    mocks.records.set(configPath, { ...currentConfig(), paymentLedgerRevision: 8, paymentProjectionPending: true });
    mocks.transaction.mockRejectedValueOnce(new Error("Synthetic database outage"));
    await expect(flushPaymentProjection(projectId)).rejects.toThrow("Synthetic database outage");
    const candidate = mocks.save.mock.calls[0][0], original = Buffer.from(mocks.objects.get(candidate)!);
    expect(mocks.save.mock.calls[0][2]).toMatchObject({ preconditionOpts: { ifGenerationMatch: 0 } });
    expect(currentConfig()).toMatchObject({ workbookObjectKey: baselineKey, paymentProjectionPending: true });
    await flushPaymentProjection(projectId);
    expect(mocks.objects.get(candidate)).toEqual(original);
    expect(currentConfig()).toMatchObject({ workbookObjectKey: candidate, paymentProjectedLedgerRevision: 8, paymentProjectionPending: false });
    expect(active()).toHaveLength(5);
  });
});

it("stamps imported USD gaps with the locked project denomination", async () => {
  currencyMock.value = "USD";
  const { workbook, line } = await seed(1200, [800, 400]);
  for (const payment of active()) mocks.records.set(`${EXPENSE_PAYMENTS}/${payment.id}`, { ...payment, currency: "USD" });
  const proposed = await loadWorkbook(await writeWorkbook(workbook));
  proposed.getWorksheet("Presupuesto")!.getCell("J4").value = 1600.25;
  await commit(await prepareWorkbookPaymentChange(projectId, workbook, proposed));
  expect(active().find((payment) => payment.source === "excel-import")).toMatchObject({ currency: "USD", budgetLineId: line.id, amount: 400.25 });
  expect(currencyMock.lock).toHaveBeenCalledWith(projectId);
  expect(readBudgetLines(proposed)[0].paid).toBe(1600.25);
});

it("rejects importing a USD workbook over a legacy CRC payment without rewriting money", async () => {
  currencyMock.value = "USD";
  const { workbook } = await seed(1200, [800, 400]);
  const before = structuredClone(active());
  const proposed = await loadWorkbook(await writeWorkbook(workbook));
  proposed.getWorksheet("Presupuesto")!.getCell("J4").value = 1600;
  await expect(prepareWorkbookPaymentChange(projectId, workbook, proposed)).rejects.toThrow("currency");
  expect(active()).toEqual(before);
});
