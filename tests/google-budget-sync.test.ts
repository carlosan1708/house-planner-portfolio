import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  type Data = Record<string, unknown>;
  type Reference = { id: string; collection: string; path: string; get: () => Promise<Snapshot>; set: (data: Data, options?: { merge?: boolean }) => Promise<unknown> };
  type Snapshot = { id: string; ref: Reference; exists: boolean; data: () => Data | undefined };
  type Query = { where: (field: string, operator: string, value: unknown) => Query; get: () => Promise<{ docs: Snapshot[] }> };
  type SaveOptions = { preconditionOpts?: { ifGenerationMatch?: number } };
  const records = new Map<string, Data>(), objects = new Map<string, Buffer>();
  const remote = { bytes: Buffer.alloc(0), version: "1", etag: '"google-1"' };
  const hooks = { afterSave: null as ((key: string) => void | Promise<void>) | null, beforeGet: null as ((path: string) => void | Promise<void>) | null };
  let sequence = 0;
  const ref = (collection: string, id = `generated-${++sequence}`): Reference => ({
    id, collection, path: `${collection}/${id}`,
    get: async () => snapshot(collection, id),
    set: async (data: Data, options?: { merge?: boolean }) => set(ref(collection, id), data, options),
  });
  const snapshot = (collection: string, id: string): Snapshot => {
    const value = records.get(`${collection}/${id}`);
    return { id, ref: ref(collection, id), exists: value !== undefined, data: () => value && structuredClone(value) };
  };
  const set = vi.fn((target: ReturnType<typeof ref>, data: Data, options?: { merge?: boolean }) => records.set(target.path, structuredClone(options?.merge ? { ...records.get(target.path), ...data } : data)));
  const query = (collection: string, filters: Array<[string, unknown]> = []): Query => ({
    where: (field: string, _operator: string, value: unknown) => query(collection, [...filters, [field, value]]),
    get: async () => ({ docs: [...records.entries()].flatMap(([path, data]) => path.startsWith(`${collection}/`) && filters.every(([field, value]) => data[field] === value) ? [snapshot(collection, path.slice(collection.length + 1))] : []) }),
  });
  const transaction = vi.fn(async (run: (tx: unknown) => Promise<unknown>) => {
    const pending: Array<() => void> = [];
    const result = await run({
      get: async (target: { path?: string; get: () => Promise<unknown> }) => { await hooks.beforeGet?.(target.path || "query"); return target.get(); },
      set: (target: ReturnType<typeof ref>, data: Data, options?: { merge?: boolean }) => pending.push(() => set(target, data, options)),
      update: (target: ReturnType<typeof ref>, data: Data) => pending.push(() => set(target, data, { merge: true })),
    });
    pending.forEach((write) => write());
    return result;
  });
  const save = vi.fn(async (key: string, bytes: Buffer, options?: SaveOptions) => {
    if (options?.preconditionOpts?.ifGenerationMatch === 0 && objects.has(key)) throw Object.assign(new Error("Object already exists"), { code: 412 });
    objects.set(key, Buffer.from(bytes)); await hooks.afterSave?.(key);
  });
  const googleState = vi.fn(async () => ({ version: remote.version, etag: remote.etag }));
  const googleRead = vi.fn(async () => ({ bytes: Buffer.from(remote.bytes), state: { version: remote.version, etag: remote.etag } }));
  const googleUpdate = vi.fn(async (_client: unknown, _fileId: string, bytes: Buffer, etag: string) => {
    if (etag !== remote.etag) throw Object.assign(new Error("Google file changed"), { response: { status: 412 } });
    remote.bytes = Buffer.from(bytes); remote.version = String(Number(remote.version) + 1); remote.etag = `"google-${remote.version}"`;
    return remote.version;
  });
  return {
    records, objects, remote, hooks, ref, set, query, transaction, save, googleState, googleRead, googleUpdate,
    reset: () => { records.clear(); objects.clear(); sequence = 0; remote.bytes = Buffer.alloc(0); remote.version = "1"; remote.etag = '"google-1"'; hooks.afterSave = null; hooks.beforeGet = null; },
  };
});

vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "server-time" } }));
vi.mock("@/lib/firebase-admin", () => ({
  firestore: { collection: (name: string) => ({ doc: (id?: string) => mocks.ref(name, id), where: (field: string, operator: string, value: unknown) => mocks.query(name).where(field, operator, value) }), runTransaction: mocks.transaction },
  projectBucket: { file: (key: string) => ({
    download: async () => { const bytes = mocks.objects.get(key); if (!bytes) throw new Error(`Missing synthetic workbook ${key}`); return [Buffer.from(bytes)]; },
    save: (bytes: Buffer, options?: { preconditionOpts?: { ifGenerationMatch?: number } }) => mocks.save(key, bytes, options),
    delete: async () => { mocks.objects.delete(key); },
  }) },
}));
vi.mock("@/lib/google-sheets", () => ({
  googleConfigured: () => true, connectedGoogle: async () => ({ synthetic: true }), serviceGoogle: async () => ({ synthetic: true }),
  googleFileState: mocks.googleState, readStableGoogleWorkbook: mocks.googleRead, updateGoogleWorkbook: mocks.googleUpdate,
  createGoogleFolder: vi.fn(), createGoogleWorkbook: vi.fn(),
}));
vi.mock("@/lib/project-currency", () => ({
  readProjectCurrency: async (id: string) => mocks.records.get(`housePlannerProjects/${id}`)?.currency === "USD" ? "USD" : "CRC",
  lockProjectCurrency: async (id: string) => mocks.records.get(`housePlannerProjects/${id}`)?.currency === "USD" ? "USD" : "CRC",
  validateProjectCurrency: async (_tx: unknown, id: string, expected: string) => { if ((mocks.records.get(`housePlannerProjects/${id}`)?.currency === "USD" ? "USD" : "CRC") !== expected) throw new Error("project_currency_changed"); },
}));

// Exercise the real synchronizer, ledger reconciler and XLSX transformations.
import { syncGoogleBudget } from "@/lib/google-budget";
import { consolidatedWorkbook } from "@/lib/consolidated-workbook";
import { addPaymentWorkbookProjection, removePaymentWorkbookProjection, PAYMENT_PROJECTION_SHEET } from "@/lib/payment-workbook";
import { CONFIG, EXPENSE_PAYMENTS, PROJECTS, projectConfigDoc, projectStoragePrefix } from "@/lib/project";
import { createStarterWorkbook, loadWorkbook, readBudgetLines, writeWorkbook } from "@/lib/workbook";

const projectId = "qa-google-ledger-v2";
const configPath = `${CONFIG}/${projectConfigDoc(projectId)}`;
const linkPath = `housePlannerGoogleBudgets/${projectId}`;
const baselineKey = `${projectStoragePrefix(projectId)}/workbooks/baseline.xlsx`;
const currentConfig = () => mocks.records.get(configPath)!;
const active = (): Array<Record<string, unknown> & { id: string }> => [...mocks.records.entries()].flatMap(([path, data]) => path.startsWith(`${EXPENSE_PAYMENTS}/`) && data.projectId === projectId && !data.deletedAt ? [{ ...data, id: path.slice(EXPENSE_PAYMENTS.length + 1) }] : []);
const imported = () => active().filter((payment) => payment.source === "excel-import");
const ledgerTotal = () => active().reduce((total, payment) => total + Number(payment.amount), 0);

async function seed(paid = 1600, amounts = [800, 400, 200, 200]) {
  mocks.records.set(`${PROJECTS}/${projectId}`, { id: projectId, currency: "CRC" });
  const workbook = createStarterWorkbook(), sheet = workbook.getWorksheet("Presupuesto")!;
  sheet.getCell("B4").value = "Arquitectura QA"; sheet.getCell("E4").value = 3000; sheet.getCell("G4").value = 2500; sheet.getCell("J4").value = paid;
  const normalized = await loadWorkbook(await consolidatedWorkbook(await writeWorkbook(workbook)));
  const line = readBudgetLines(normalized)[0];
  const payments = amounts.map((amount, index) => ({ id: `known-${index + 1}`, projectId, budgetLineId: line.id, amount, accountingMode: index % 2 ? "ledger" : "historical-detail", documentIds: [`receipt-${index + 1}`], payee: "Private professional", notes: "Private payment notes" }));
  addPaymentWorkbookProjection(normalized, payments, { paymentsModelVersion: 2, paymentLedgerRevision: 7, includePaymentDetails: false });
  const bytes = await writeWorkbook(normalized);
  mocks.objects.set(baselineKey, bytes); mocks.remote.bytes = Buffer.from(bytes);
  mocks.records.set(configPath, { projectId, workbookObjectKey: baselineKey, workbookPlanVersion: 4, workbookActualsRevision: 2, paymentsModelVersion: 2, paymentLedgerRevision: 7, paymentProjectedLedgerRevision: 7, paymentProjectionPending: false });
  mocks.records.set(linkPath, { projectId, fileId: "synthetic-file", folderId: "synthetic-folder", authMode: "service_account", version: "1", syncedObjectKey: baselineKey });
  payments.forEach((payment) => mocks.records.set(`${EXPENSE_PAYMENTS}/${payment.id}`, payment));
  return line;
}
function addAppPayment(id: string, lineId: string, amount: number) {
  mocks.records.set(`${EXPENSE_PAYMENTS}/${id}`, { projectId, budgetLineId: lineId, amount, source: "app", accountingMode: "ledger" });
  mocks.records.set(configPath, { ...currentConfig(), paymentLedgerRevision: Number(currentConfig().paymentLedgerRevision) + 1, paymentProjectionPending: true });
}
async function editRemote(edit: (workbook: Awaited<ReturnType<typeof loadWorkbook>>) => void) {
  const workbook = await loadWorkbook(mocks.remote.bytes); edit(workbook);
  mocks.remote.bytes = await writeWorkbook(workbook); mocks.remote.version = String(Number(mocks.remote.version) + 1); mocks.remote.etag = `"google-${mocks.remote.version}"`;
}
async function currentPaid() {
  return readBudgetLines(await loadWorkbook(mocks.objects.get(String(currentConfig().workbookObjectKey))!))[0].paid;
}

beforeEach(() => { vi.clearAllMocks(); mocks.reset(); });

describe("Google synchronization with the single payment ledger", () => {
  it("keeps an unchanged Google source a no-op rather than rebuilding payments", async () => {
    await seed(); const before = structuredClone(active());
    await syncGoogleBudget(projectId);
    expect(active()).toEqual(before); expect(currentConfig().workbookObjectKey).toBe(baselineKey);
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.googleUpdate).not.toHaveBeenCalled();
  });

  it("retains the Google reports as its comparison baseline after a pull strips the app copy", async () => {
    await seed(); const before = structuredClone(active());
    await editRemote((workbook) => { workbook.getWorksheet("Presupuesto")!.getCell("B4").font = { italic: true }; });
    await syncGoogleBudget(projectId);
    const link = mocks.records.get(linkPath)!;
    expect(currentConfig().workbookObjectKey).toBe(link.syncedObjectKey);
    expect(link.syncedBaselineObjectKey).not.toBe(link.syncedObjectKey);
    const savedBaseline = await loadWorkbook(mocks.objects.get(String(link.syncedBaselineObjectKey))!);
    const appCopy = await loadWorkbook(mocks.objects.get(String(currentConfig().workbookObjectKey))!);
    expect(savedBaseline.getWorksheet(PAYMENT_PROJECTION_SHEET)).toBeDefined();
    expect(appCopy.getWorksheet(PAYMENT_PROJECTION_SHEET)).toBeUndefined();
    expect(currentConfig().paymentProjectionPending).toBe(true);
    // Another Drive revision can arrive before the next request flushes the ledger.
    await editRemote((workbook) => { workbook.getWorksheet("Presupuesto")!.getCell("G4").value = 2700; });
    await syncGoogleBudget(projectId);
    expect(active()).toEqual(before); expect(imported()).toHaveLength(0);
    expect(readBudgetLines(await loadWorkbook(mocks.remote.bytes))[0]).toMatchObject({ paid: 1600, quote: 2700 });
    expect(currentConfig().paymentProjectionPending).toBe(false);
    await syncGoogleBudget(projectId);
    expect(active()).toEqual(before);
  });

  async function seedStrippedBaseline() {
    await seed();
    const stripped = await loadWorkbook(mocks.objects.get(baselineKey)!);
    removePaymentWorkbookProjection(stripped);
    mocks.objects.set(baselineKey, await writeWorkbook(stripped));
    mocks.records.set(configPath, { ...currentConfig(), paymentProjectionPending: true });
  }

  it("recovers the existing stripped-baseline state from its trusted published summary", async () => {
    await seedStrippedBaseline(); const before = structuredClone(active());
    await editRemote((workbook) => { workbook.getWorksheet("Presupuesto")!.getCell("B4").font = { italic: true }; });
    await syncGoogleBudget(projectId);
    expect(active()).toEqual(before); expect(imported()).toHaveLength(0); expect(await currentPaid()).toBe(1600);
    expect(currentConfig()).toMatchObject({ paymentLedgerRevision: 7, paymentProjectedLedgerRevision: 7, paymentProjectionPending: false });
    expect((await loadWorkbook(mocks.remote.bytes)).getWorksheet("Presupuesto")!.getCell("B4").font.italic).toBe(true);
  });

  it("recovers the published summary from saved observations while retaining different current ledger totals", async () => {
    await seedStrippedBaseline();
    mocks.records.set(`${EXPENSE_PAYMENTS}/known-1`, { ...mocks.records.get(`${EXPENSE_PAYMENTS}/known-1`), amount: 600 });
    const before = structuredClone(active());
    await editRemote((workbook) => { workbook.getWorksheet("Presupuesto")!.getCell("B4").font = { italic: true }; });
    await syncGoogleBudget(projectId);
    expect(active()).toEqual(before); expect(imported()).toHaveLength(0); expect(await currentPaid()).toBe(1400);
    expect(readBudgetLines(await loadWorkbook(mocks.remote.bytes))[0].paid).toBe(1400);
    expect(currentConfig().paymentProjectionPending).toBe(false);
  });

  it("uses the last projected revision when a newer payment is pending during baseline recovery", async () => {
    await seedStrippedBaseline();
    const line = readBudgetLines(await loadWorkbook(mocks.objects.get(baselineKey)!))[0];
    addAppPayment("app-new", line.id, 500); const before = structuredClone(active());
    await editRemote((workbook) => { workbook.getWorksheet("Presupuesto")!.getCell("G4").value = 2700; });
    await syncGoogleBudget(projectId);
    expect(active()).toEqual(before); expect(imported()).toHaveLength(0); expect(await currentPaid()).toBe(2100);
    expect(readBudgetLines(await loadWorkbook(mocks.remote.bytes))[0]).toMatchObject({ paid: 2100, quote: 2700 });
    expect(currentConfig()).toMatchObject({ paymentLedgerRevision: 8, paymentProjectedLedgerRevision: 8, paymentProjectionPending: false });
  });

  it("rejects baseline recovery prepared before a concurrent app payment", async () => {
    await seedStrippedBaseline();
    const line = readBudgetLines(await loadWorkbook(mocks.objects.get(baselineKey)!))[0];
    await editRemote((workbook) => { workbook.getWorksheet("Presupuesto")!.getCell("B4").font = { italic: true }; });
    mocks.hooks.beforeGet = (path) => {
      if (path !== configPath || !mocks.save.mock.calls.length) return;
      mocks.hooks.beforeGet = null; addAppPayment("concurrent", line.id, 100);
    };
    await expect(syncGoogleBudget(projectId)).rejects.toThrow();
    expect(imported()).toHaveLength(0); expect(ledgerTotal()).toBe(1700);
    expect(currentConfig()).toMatchObject({ workbookObjectKey: baselineKey, paymentLedgerRevision: 8, paymentProjectionPending: true });
    expect(mocks.googleUpdate).not.toHaveBeenCalled();
  });

  it.each(["revision", "amount", "id", "legacy", "missing-sheet", "details", "unknown-revision"])("rejects a %s change when recovering a stripped baseline", async (change) => {
    await seedStrippedBaseline(); const before = structuredClone(active());
    if (change === "unknown-revision") mocks.records.set(configPath, { ...currentConfig(), paymentProjectedLedgerRevision: 0 });
    await editRemote((workbook) => {
      if (change === "revision") workbook.getWorksheet(PAYMENT_PROJECTION_SHEET)!.getCell("E1").value = 6;
      if (change === "amount") workbook.getWorksheet("Pagos")!.getCell("E4").value = 999;
      if (change === "id") workbook.getWorksheet("Pagos")!.getCell("A4").value = "forged-payment";
      if (change === "legacy") workbook.getWorksheet(PAYMENT_PROJECTION_SHEET)!.getCell("A1").value = "payments-projection-v1";
      if (change === "missing-sheet") workbook.removeWorksheet(workbook.getWorksheet("Pagos")!.id);
      if (change === "details") workbook.getWorksheet(PAYMENT_PROJECTION_SHEET)!.getCell("D1").value = "details";
    });
    await expect(syncGoogleBudget(projectId)).rejects.toThrow();
    expect(active()).toEqual(before); expect(imported()).toHaveLength(0);
    expect(currentConfig()).toMatchObject({ workbookObjectKey: baselineKey, paymentLedgerRevision: 7, paymentProjectionPending: true });
    expect(mocks.googleUpdate).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });

  it("publishes a new app payment when Google's financial cells did not change", async () => {
    const line = await seed(); addAppPayment("app-new", line.id, 500);
    await syncGoogleBudget(projectId);
    expect(imported()).toHaveLength(0); expect(ledgerTotal()).toBe(2100); expect(await currentPaid()).toBe(2100);
    const googleWorkbook = await loadWorkbook(mocks.remote.bytes);
    expect(readBudgetLines(googleWorkbook)[0].paid).toBe(2100);
    expect(JSON.stringify(googleWorkbook.worksheets.map((sheet) => sheet.model))).not.toMatch(/known-1|receipt-1|Private professional|Private payment notes/);
    expect(currentConfig()).toMatchObject({ paymentLedgerRevision: 8, paymentProjectedLedgerRevision: 8, paymentProjectionPending: false });
  });

  it("imports an Excel increase once even when the same Google sync is repeated concurrently", async () => {
    await seed(1200, [800, 400]);
    await editRemote((workbook) => { workbook.getWorksheet("Presupuesto")!.getCell("J4").value = 1600; });
    await Promise.all([syncGoogleBudget(projectId), syncGoogleBudget(projectId)]);
    const firstIds = active().map((payment) => payment.id).sort();
    expect(imported()).toHaveLength(1); expect(imported()[0].amount).toBe(400); expect(ledgerTotal()).toBe(1600);
    await syncGoogleBudget(projectId);
    expect(active().map((payment) => payment.id).sort()).toEqual(firstIds);
    expect(await currentPaid()).toBe(1600);
  });

  it("preserves remote formatting while projecting pending app payments", async () => {
    const line = await seed(1200, [800, 400]); addAppPayment("app-new", line.id, 500);
    await editRemote((workbook) => { workbook.getWorksheet("Presupuesto")!.getCell("B4").font = { name: "Calibri", italic: true }; });
    await syncGoogleBudget(projectId);
    expect(imported()).toHaveLength(0); expect(ledgerTotal()).toBe(1700);
    const googleWorkbook = await loadWorkbook(mocks.remote.bytes);
    expect(readBudgetLines(googleWorkbook)[0]).toMatchObject({ paid: 1700, quote: 2500 });
    expect(googleWorkbook.getWorksheet("Presupuesto")!.getCell("B4").font.italic).toBe(true);
    expect(await currentPaid()).toBe(1700);
  });

  it("accepts equivalent rich text from Google while preserving pending payments and remote plan edits", async () => {
    const line = await seed(1200, [800, 400]); addAppPayment("app-new", line.id, 500);
    const before = structuredClone(active());
    await editRemote((workbook) => {
      for (const name of [PAYMENT_PROJECTION_SHEET, "Resumen de pagos", "Pagos"]) {
        workbook.getWorksheet(name)!.eachRow((row) => row.eachCell((cell) => {
          if (typeof cell.value === "string" && cell.value) cell.value = { richText: [{ text: cell.value, font: { italic: true } }] };
        }));
      }
      workbook.getWorksheet("Presupuesto")!.getCell("G4").value = 2700;
    });
    await syncGoogleBudget(projectId);
    expect(active()).toEqual(before); expect(imported()).toHaveLength(0); expect(ledgerTotal()).toBe(1700);
    expect(readBudgetLines(await loadWorkbook(mocks.remote.bytes))[0]).toMatchObject({ paid: 1700, quote: 2700 });
    expect(currentConfig()).toMatchObject({ paymentLedgerRevision: 8, paymentProjectedLedgerRevision: 8, paymentProjectionPending: false });
    await syncGoogleBudget(projectId);
    expect(active()).toEqual(before); expect(await currentPaid()).toBe(1700);
  });

  it.each(["revision", "payment", "formula"])("rejects a changed Google %s while a payment awaits projection", async (change) => {
    const line = await seed(1200, [800, 400]); addAppPayment("app-new", line.id, 500);
    const before = structuredClone(active());
    await editRemote((workbook) => {
      if (change === "revision") workbook.getWorksheet(PAYMENT_PROJECTION_SHEET)!.getCell("E1").value = 999;
      if (change === "payment") workbook.getWorksheet("Pagos")!.getCell("E4").value = 999;
      if (change === "formula") workbook.getWorksheet(PAYMENT_PROJECTION_SHEET)!.getCell("E1").value = { formula: "7", result: 7 };
    });
    await expect(syncGoogleBudget(projectId)).rejects.toThrow("historial de pagos");
    expect(active()).toEqual(before); expect(imported()).toHaveLength(0);
    expect(currentConfig()).toMatchObject({ workbookObjectKey: baselineKey, paymentLedgerRevision: 8, paymentProjectionPending: true });
    expect(mocks.googleUpdate).not.toHaveBeenCalled();
  });

  it("keeps a Google-only quote correction when the local change is only a pending payment", async () => {
    const line = await seed(1200, [800, 400]); addAppPayment("app-new", line.id, 500);
    await editRemote((workbook) => { workbook.getWorksheet("Presupuesto")!.getCell("G4").value = 2700; });
    await syncGoogleBudget(projectId);
    expect(imported()).toHaveLength(0); expect(ledgerTotal()).toBe(1700);
    expect(readBudgetLines(await loadWorkbook(mocks.remote.bytes))[0]).toMatchObject({ paid: 1700, quote: 2700 });
    const canonical = await loadWorkbook(mocks.objects.get(String(currentConfig().workbookObjectKey))!);
    expect(readBudgetLines(canonical)[0]).toMatchObject({ paid: 1700, quote: 2700 });
  });

  it("keeps divergent local and Google plan edits in conflict instead of choosing one quote", async () => {
    const line = await seed(1200, [800, 400]);
    const local = await loadWorkbook(mocks.objects.get(baselineKey)!);
    local.getWorksheet("Presupuesto")!.getCell("G4").value = 2600;
    const localKey = `${projectStoragePrefix(projectId)}/workbooks/local-plan.xlsx`;
    mocks.objects.set(localKey, await writeWorkbook(local));
    mocks.records.set(configPath, { ...currentConfig(), workbookObjectKey: localKey, workbookPlanVersion: 5 });
    addAppPayment("app-new", line.id, 500);
    await editRemote((workbook) => { workbook.getWorksheet("Presupuesto")!.getCell("G4").value = 2700; });
    await expect(syncGoogleBudget(projectId)).rejects.toThrow();
    expect(ledgerTotal()).toBe(1700); expect(imported()).toHaveLength(0);
    const current = await loadWorkbook(mocks.objects.get(String(currentConfig().workbookObjectKey))!);
    expect(readBudgetLines(current)[0].quote).toBe(2600);
    expect(readBudgetLines(await loadWorkbook(mocks.remote.bytes))[0].quote).toBe(2700);
    expect(mocks.googleUpdate).not.toHaveBeenCalled();
  });

  it("rejects simultaneous app and Google financial changes without committing either as an import", async () => {
    const line = await seed(1200, [800, 400]); addAppPayment("app-new", line.id, 500);
    await editRemote((workbook) => { workbook.getWorksheet("Presupuesto")!.getCell("J4").value = 1600; });
    await expect(syncGoogleBudget(projectId)).rejects.toThrow();
    expect(imported()).toHaveLength(0); expect(ledgerTotal()).toBe(1700);
    expect(currentConfig()).toMatchObject({ workbookObjectKey: baselineKey, paymentLedgerRevision: 8, paymentProjectionPending: true });
    expect(mocks.googleUpdate).not.toHaveBeenCalled();
    expect(mocks.records.get(linkPath)?.leaseExpires).toBe(0);
  });

  it("rejects a real Google decrease without shrinking payments or changing the official source", async () => {
    await seed(); const before = structuredClone(active());
    await editRemote((workbook) => { workbook.getWorksheet("Presupuesto")!.getCell("J4").value = 1400; });
    await expect(syncGoogleBudget(projectId)).rejects.toThrow();
    expect(active()).toEqual(before); expect(currentConfig().workbookObjectKey).toBe(baselineKey);
    expect(currentConfig().paymentLedgerRevision).toBe(7); expect(mocks.googleUpdate).not.toHaveBeenCalled();
  });

  it("does not commit an import prepared before a concurrent app payment", async () => {
    const line = await seed(1200, [800, 400]);
    await editRemote((workbook) => { workbook.getWorksheet("Presupuesto")!.getCell("J4").value = 1600; });
    mocks.hooks.beforeGet = (path) => {
      if (path !== configPath || !mocks.save.mock.calls.length) return;
      mocks.hooks.beforeGet = null; addAppPayment("concurrent", line.id, 100);
    };
    await expect(syncGoogleBudget(projectId)).rejects.toThrow();
    expect(imported()).toHaveLength(0); expect(ledgerTotal()).toBe(1300);
    expect(currentConfig()).toMatchObject({ workbookObjectKey: baselineKey, paymentLedgerRevision: 8, paymentProjectionPending: true });
    expect(mocks.googleUpdate).not.toHaveBeenCalled();
  });

  it("imports only the extra Excel payment after app sync and never resurrects it after deletion", async () => {
    const line = await seed();
    const originalIds = active().map((payment) => payment.id).sort();
    addAppPayment("app-new", line.id, 500);
    await syncGoogleBudget(projectId);
    expect(ledgerTotal()).toBe(2100);
    expect(readBudgetLines(await loadWorkbook(mocks.remote.bytes))[0].paid).toBe(2100);

    await editRemote((workbook) => { workbook.getWorksheet("Presupuesto")!.getCell("J4").value = 2200; });
    await syncGoogleBudget(projectId);
    const [unknown] = imported();
    expect(imported()).toHaveLength(1);
    expect(unknown).toMatchObject({ amount: 100, source: "excel-import", sourceLabel: "Pago de Excel sin detalle", paymentDate: "", documentIds: [] });
    expect(ledgerTotal()).toBe(2200);
    expect(await currentPaid()).toBe(2200);
    const importedRevision = currentConfig().paymentLedgerRevision;
    await syncGoogleBudget(projectId);
    expect(imported().map((payment) => payment.id)).toEqual([unknown.id]);
    expect(currentConfig().paymentLedgerRevision).toBe(importedRevision);

    const deletedPath = `${EXPENSE_PAYMENTS}/${unknown.id}`;
    mocks.records.set(deletedPath, { ...mocks.records.get(deletedPath), deletedAt: "2026-10-16T12:00:00Z" });
    mocks.records.set(configPath, { ...currentConfig(), paymentLedgerRevision: Number(importedRevision) + 1, paymentProjectionPending: true });
    await syncGoogleBudget(projectId);
    expect(ledgerTotal()).toBe(2100);
    expect(await currentPaid()).toBe(2100);
    expect(readBudgetLines(await loadWorkbook(mocks.remote.bytes))[0].paid).toBe(2100);

    await editRemote((workbook) => { workbook.getWorksheet("Presupuesto")!.getCell("B4").font = { name: "Calibri", italic: true }; });
    await syncGoogleBudget(projectId);
    expect(imported()).toHaveLength(0);
    expect(active().map((payment) => payment.id).sort()).toEqual([...originalIds, "app-new"].sort());
    expect(mocks.records.get(deletedPath)?.deletedAt).toBe("2026-10-16T12:00:00Z");
    expect(ledgerTotal()).toBe(2100);
    expect(await currentPaid()).toBe(2100);
    expect((await loadWorkbook(mocks.remote.bytes)).getWorksheet("Presupuesto")!.getCell("B4").font.italic).toBe(true);
  });
});
