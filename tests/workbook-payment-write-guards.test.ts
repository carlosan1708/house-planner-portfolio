import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const records = new Map<string, Record<string, unknown>>();
  const objects = new Map<string, Buffer>();
  let sequence = 0;
  const ref = (collection: string, id = `generated-${++sequence}`) => ({
    id, collection,
    get: async () => ({ id, exists: records.has(`${collection}/${id}`), data: () => records.get(`${collection}/${id}`) }),
  });
  const set = vi.fn((target: ReturnType<typeof ref>, value: Record<string, unknown>, options?: { merge?: boolean }) => {
    const key = `${target.collection}/${target.id}`;
    records.set(key, options?.merge ? { ...records.get(key), ...value } : value);
  });
  return {
    records, objects, ref, set,
    actor: vi.fn(), config: vi.fn(), load: vi.fn(), payments: vi.fn(), activity: vi.fn(), save: vi.fn(), transaction: vi.fn(),
    reset: () => { records.clear(); objects.clear(); sequence = 0; },
  };
});

vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "server-time" } }));
vi.mock("@/lib/auth", () => ({ requireApproved: mocks.actor, requireTabAccess: mocks.actor }));
vi.mock("@/lib/firebase-admin", () => ({
  firestore: { collection: (name: string) => ({ doc: (id?: string) => mocks.ref(name, id), where: (_field: string, _operator: string, projectId: string) => ({ get: async () => ({ docs: (await mocks.payments(projectId)).map((payment: Record<string, unknown>) => ({ id: payment.id, data: () => payment })) }) }) }), runTransaction: mocks.transaction },
  projectBucket: { file: (key: string) => ({
    download: async () => {
      const bytes = mocks.objects.get(key);
      if (!bytes) throw new Error(`Missing synthetic workbook: ${key}`);
      return [bytes];
    },
    save: async (bytes: Buffer) => { mocks.save(key); mocks.objects.set(key, Buffer.from(bytes)); },
    delete: async () => { mocks.objects.delete(key); },
  }) },
}));
vi.mock("@/lib/workbook-store", () => ({ workbookConfig: mocks.config, loadOfficialWorkbook: mocks.load, getWorkbookPayments: mocks.payments }));
vi.mock("@/lib/project-currency", () => ({
  readProjectCurrency: async (id: string) => mocks.records.get(`housePlannerProjects/${id}`)?.currency === "USD" ? "USD" : "CRC",
  lockProjectCurrency: async (id: string) => mocks.records.get(`housePlannerProjects/${id}`)?.currency === "USD" ? "USD" : "CRC",
  validateProjectCurrency: async (_tx: unknown, id: string, expected: string) => { if ((mocks.records.get(`housePlannerProjects/${id}`)?.currency === "USD" ? "USD" : "CRC") !== expected) throw new Error("project_currency_changed"); },
}));
vi.mock("@/lib/activity", () => ({ appendActivity: mocks.activity }));
vi.mock("@/lib/usage-actions", () => ({ completedUsageAction: vi.fn() }));
vi.mock("@/lib/google-budget", () => ({ googleSyncMessage: (error: Error) => error.message, syncAfterBudgetCommit: async () => ({ googleSynced: false }) }));
vi.mock("@/lib/project-authors", () => ({ loadProjectAuthorDisplay: async () => ({ redact: (data: unknown) => data }) }));

import { POST as publishDraft } from "@/app/api/workbook/drafts/route";
import { PATCH as approve } from "@/app/api/approvals/route";
import { POST as restoreVersion } from "@/app/api/workbook/versions/route";
import { APPROVALS, CONFIG, EXPENSE_PAYMENTS, PROJECTS, WORKBOOK_DRAFTS, WORKBOOK_VERSIONS, projectConfigDoc, projectStoragePrefix } from "@/lib/project";
import { addPaymentWorkbookProjection } from "@/lib/payment-workbook";
import { createStarterWorkbook, loadWorkbook, readBudgetLines, toUniver, writeWorkbook } from "@/lib/workbook";

const projectId = "qa-payment-guards";
const prefix = projectStoragePrefix(projectId);
const configKey = `${CONFIG}/${projectConfigDoc(projectId)}`;
const baselineKey = `${prefix}/workbooks/baseline.xlsx`;
const jsonRequest = (body: Record<string, unknown>) => new Request("http://localhost/api/workbook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.reset();
  mocks.records.set(`${PROJECTS}/${projectId}`, { id: projectId, currency: "CRC" });
  mocks.actor.mockResolvedValue({ uid: "owner", projectId, email: "owner@example.invalid", role: "admin" });
  mocks.activity.mockResolvedValue({ id: "activity-1" });
  mocks.transaction.mockImplementation(async (write) => write({ get: (target: ReturnType<typeof mocks.ref>) => target.get(), set: mocks.set, update: (target: ReturnType<typeof mocks.ref>, data: Record<string, unknown>) => mocks.set(target, data, { merge: true }) }));
  const workbook = createStarterWorkbook();
  const sheet = workbook.getWorksheet("Presupuesto")!;
  sheet.getCell("E4").value = 1000;
  sheet.getCell("G4").value = 900;
  sheet.getCell("J4").value = 200;
  const line = readBudgetLines(workbook)[0];
  sheet.getCell("Z4").value = `new:${line.id}`;
  const bytes = await writeWorkbook(workbook);
  mocks.objects.set(baselineKey, bytes);
  mocks.records.set(configKey, { projectId, workbookObjectKey: baselineKey, workbookPlanVersion: 1, workbookActualsRevision: 3 });
  mocks.config.mockImplementation(async () => ({ objectKey: String(mocks.records.get(configKey)!.workbookObjectKey), planVersion: 1, actualsRevision: 3, fileName: "QA.xlsx" }));
  mocks.load.mockImplementation(async () => ({ workbook: await loadWorkbook(mocks.objects.get(baselineKey)!), config: await mocks.config(), sourceBytes: bytes }));
  mocks.payments.mockResolvedValue([{ id: "existing-payment", budgetLineId: line.id, amount: 150, accountingMode: "ledger" }]);
});

async function prepareMutation(kind: string, column: number, value: number | string) {
  const workbook = await loadWorkbook(mocks.objects.get(baselineKey)!);
  const base = toUniver(workbook);
  const changed = structuredClone(base);
  const budgetId = changed.sheetOrder.find((id) => changed.sheets[id].name === "Presupuesto")!;
  changed.sheets[budgetId].cellData[3][column - 1] = { v: value };
  const draftId = "draft-1";
  const snapshotKey = `${prefix}/workbooks/draft-current.json`;
  mocks.objects.set(`${prefix}/workbooks/drafts/${draftId}/revision-1.json`, Buffer.from(JSON.stringify(base)));
  mocks.objects.set(snapshotKey, Buffer.from(JSON.stringify(changed)));
  mocks.records.set(`${WORKBOOK_DRAFTS}/${draftId}`, { projectId, createdByUid: "owner", status: kind === "draft" ? "editing" : "submitted", revision: 2,
    basePlanVersion: 1, baseActualsRevision: 3, snapshotObjectKey: snapshotKey, rowMaps: null });
  if (kind === "draft") return () => publishDraft(jsonRequest({ action: "publish", id: draftId }));
  if (kind === "approval" || kind === "legacy") {
    mocks.records.set(`${APPROVALS}/approval-1`, { projectId, status: "pending", kind: kind === "legacy" ? "workbook_changes" : "workbook_draft", title: "QA changes",
      payload: kind === "legacy" ? { changes: [{ sheetName: "Presupuesto", rowIndex: 3, columnIndex: column - 1, value }] } : { draftId, basePlanVersion: 1 } });
    return () => approve(jsonRequest({ id: "approval-1", action: "approved" }));
  }
  workbook.getWorksheet("Presupuesto")!.getCell(4, column).value = value;
  const sourceKey = `${prefix}/workbooks/historical.xlsx`;
  mocks.objects.set(sourceKey, await writeWorkbook(workbook));
  mocks.records.set(`${WORKBOOK_VERSIONS}/version-1`, { projectId, objectKey: sourceKey, planVersion: 0 });
  return () => restoreVersion(jsonRequest({ versionId: "version-1" }));
}

describe("historical paid protection on every workbook write path", () => {
  it("rejects legacy approvals after a denomination correction before preparing writes", async () => {
    const mutate = await prepareMutation("legacy", 7, 700);
    mocks.records.set(configKey, { ...mocks.records.get(configKey), currencyCorrectionPlanVersion: 2 });
    const response = await mutate();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "stale_currency" });
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.set).not.toHaveBeenCalled(); expect(mocks.activity).not.toHaveBeenCalled();
    expect(mocks.records.get(`${APPROVALS}/approval-1`)?.status).toBe("pending");
  });

  it("rejects a legacy approval when a currency correction wins during preparation", async () => {
    const mutate = await prepareMutation("legacy", 7, 700);
    mocks.transaction.mockImplementationOnce(async (write) => {
      mocks.records.set(configKey, { ...mocks.records.get(configKey), currencyCorrectionPlanVersion: 2 });
      return write({ get: (target: ReturnType<typeof mocks.ref>) => target.get(), set: mocks.set, update: (target: ReturnType<typeof mocks.ref>, data: Record<string, unknown>) => mocks.set(target, data, { merge: true }) });
    });
    const response = await mutate();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "stale_currency" });
    expect(mocks.set).not.toHaveBeenCalled(); expect(mocks.activity).not.toHaveBeenCalled();
    expect(mocks.records.get(`${APPROVALS}/approval-1`)?.status).toBe("pending");
  });

  it("rejects a budget editor opened from a stale currency before creating a snapshot", async () => {
    mocks.records.set(`${PROJECTS}/${projectId}`, { id: projectId, currency: "USD" });
    const response = await publishDraft(jsonRequest({ action: "create", expectedCurrency: "CRC" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "currency_changed" });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("rejects a pre-sync draft before it can restore historical paid that Google removed", async () => {
    const mutate = await prepareMutation("draft", 7, 950);
    const workbook = await loadWorkbook(mocks.objects.get(baselineKey)!);
    workbook.getWorksheet("Presupuesto")!.getCell("J4").value = 0;
    const syncedBytes = await writeWorkbook(workbook);
    const syncedKey = `${prefix}/workbooks/google-synced.xlsx`;
    mocks.objects.set(syncedKey, syncedBytes);
    mocks.records.set(configKey, { projectId, workbookObjectKey: syncedKey, workbookPlanVersion: 2, workbookActualsRevision: 3 });
    mocks.config.mockResolvedValue({ objectKey: syncedKey, planVersion: 2, actualsRevision: 3, fileName: "QA.xlsx" });
    const ledgerBefore = await mocks.payments(projectId);
    mocks.payments.mockClear();

    const response = await mutate();

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "stale_base" });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.activity).not.toHaveBeenCalled();
    expect(mocks.payments).not.toHaveBeenCalled();
    expect(readBudgetLines(await loadWorkbook(mocks.objects.get(syncedKey)!))[0].paid).toBe(0);
    expect(await mocks.payments(projectId)).toEqual(ledgerBefore);
    expect(mocks.records.get(`${WORKBOOK_DRAFTS}/draft-1`)?.status).toBe("editing");
  });

  it.each(["draft", "approval", "legacy", "rollback"])("rejects projected paid totals through %s before any financial write", async (kind) => {
    const mutate = await prepareMutation(kind, 10, 350);
    const response = await mutate();
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "historical_paid_protected", error: expect.stringContaining("pagado histórico") });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.activity).not.toHaveBeenCalled();
    expect(readBudgetLines(await loadWorkbook(mocks.objects.get(baselineKey)!))[0].paid).toBe(200);
  });

  it.each(["draft", "approval", "legacy", "rollback"])("allows a quote correction through %s while retaining the independent payment ledger", async (kind) => {
    const mutate = await prepareMutation(kind, 7, 950);
    const response = await mutate();
    expect(response.status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.payments).toHaveBeenCalledWith(projectId);
    expect(mocks.set.mock.calls.every(([target]) => target.collection !== EXPENSE_PAYMENTS)).toBe(true);
    if (kind !== "legacy") {
      const currentKey = String(mocks.records.get(configKey)!.workbookObjectKey);
      expect(readBudgetLines(await loadWorkbook(mocks.objects.get(currentKey)!))[0]).toMatchObject({ paid: 200, quote: 950 });
    }
  });

  it("rejects restoring a stored projection even if its source paid total matches the current baseline", async () => {
    const mutate = await prepareMutation("rollback", 10, 200);
    const sourceKey = `${prefix}/workbooks/historical.xlsx`;
    const workbook = await loadWorkbook(mocks.objects.get(sourceKey)!);
    addPaymentWorkbookProjection(workbook, []);
    mocks.objects.set(sourceKey, await writeWorkbook(workbook));
    const response = await mutate();
    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain("totales proyectados");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("protects the paid column in an older source whose legacy overrides apply before column migration", async () => {
    const workbook = await loadWorkbook(mocks.objects.get(baselineKey)!);
    const sheet = workbook.getWorksheet("Presupuesto")!;
    sheet.getRow(3).values = ["Capítulo", "Partida", "Tipo", "Subcategoría", "Objetivo", "Máximo", "Cotización", "Diferencia", "Obligatorio", "Referencia", "Base", "Fuente", "Fecha", "Estado", "Precio pagado", "Proveedor", "Costo usado", "Alerta"];
    sheet.getRow(4).values = ["General", "Nueva partida", "", "", 1000, 1000, 900, null, false, "", "", "", "", "Pendiente", 200, "", 900, "OK"];
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    mocks.objects.set(baselineKey, bytes);
    mocks.load.mockImplementation(async () => ({ workbook: await loadWorkbook(bytes), config: await mocks.config(), sourceBytes: bytes }));
    const mutate = await prepareMutation("legacy", 15, 350);
    const response = await mutate();
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("historical_paid_protected");
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it.each(["draft", "approval", "legacy", "rollback"])("rejects deleting a line with active payments through %s", async (kind) => {
    const mutate = await prepareMutation(kind, 1, "");
    const response = await mutate();
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "historical_paid_protected", error: expect.stringContaining("Reasigná sus pagos") });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });
});

describe("unified paid on workbook write paths", () => {
  async function unified() {
    const line = readBudgetLines(await loadWorkbook(mocks.objects.get(baselineKey)!))[0];
    mocks.records.set(configKey, { ...mocks.records.get(configKey), paymentsModelVersion: 2, paymentLedgerRevision: 7 });
    mocks.payments.mockResolvedValue([{ id: "original", budgetLineId: line.id, amount: 200, accountingMode: "historical-detail", documentIds: ["receipt"] }]);
  }
  it.each(["draft", "approval", "legacy"])("imports just the paid difference atomically through %s", async (kind) => {
    await unified();
    const response = await (await prepareMutation(kind, 10, 350))();
    expect(response.status).toBe(200);
    const imports = [...mocks.records.entries()].filter(([path]) => path.startsWith(`${EXPENSE_PAYMENTS}/`));
    expect(imports).toHaveLength(1);
    expect(imports[0][1]).toMatchObject({ amount: 150, source: "excel-import", paymentDate: "", documentIds: [] });
    expect(mocks.records.get(configKey)).toMatchObject({ paymentLedgerRevision: 8, paymentProjectionPending: true });
    const key = String(mocks.records.get(configKey)!.workbookObjectKey);
    expect(readBudgetLines(await loadWorkbook(mocks.objects.get(key)!))[0].paid).toBe(350);
  });
  it("restores an old plan without restoring its old paid amount or duplicating payments", async () => {
    await unified();
    const response = await (await prepareMutation("rollback", 10, 10_000))();
    expect(response.status).toBe(200);
    expect([...mocks.records.keys()].some((path) => path.startsWith(`${EXPENSE_PAYMENTS}/`))).toBe(false);
    const key = String(mocks.records.get(configKey)!.workbookObjectKey);
    expect(readBudgetLines(await loadWorkbook(mocks.objects.get(key)!))[0].paid).toBe(200);
    expect(mocks.records.get(configKey)?.paymentLedgerRevision).toBe(7);
  });
});

describe("concurrent workbook publication cleanup", () => {
  it.each(["draft", "approval", "legacy", "rollback"])("keeps the winning %s workbook when the other prepared publication loses its transaction", async (kind) => {
    const mutate = await prepareMutation(kind, 7, 950);
    if (kind === "legacy") {
      const line = readBudgetLines(await loadWorkbook(mocks.objects.get(baselineKey)!))[0];
      mocks.records.set(configKey, { ...mocks.records.get(configKey), paymentsModelVersion: 2, paymentLedgerRevision: 7 });
      mocks.payments.mockResolvedValue([{ id: "existing-payment", budgetLineId: line.id, amount: 200, accountingMode: "historical-detail" }]);
    }
    type Reference = ReturnType<typeof mocks.ref>;
    type Transaction = {
      get: (target: Reference) => ReturnType<Reference["get"]>;
      set: (target: Reference, data: Record<string, unknown>, options?: { merge?: boolean }) => void;
      update: (target: Reference, data: Record<string, unknown>) => void;
    };
    let arrivals = 0;
    let releasePrepared!: () => void;
    const bothPrepared = new Promise<void>((resolve) => { releasePrepared = resolve; });
    let serial = Promise.resolve<unknown>(undefined);
    mocks.transaction.mockImplementation((write: (transaction: Transaction) => Promise<unknown>) => {
      // Both requests have uploaded their candidate before either transaction can commit.
      arrivals += 1;
      if (arrivals === 2) releasePrepared();
      const operation = serial.then(async () => {
        await bothPrepared;
        const pending: Array<() => void> = [];
        const result = await write({
          get: (target) => target.get(),
          set: (target, data, options) => { pending.push(() => mocks.set(target, data, options)); },
          update: (target, data) => { pending.push(() => mocks.set(target, data, { merge: true })); },
        });
        pending.forEach((commit) => commit());
        return result;
      });
      serial = operation.then(() => undefined, () => undefined);
      return operation;
    });

    const results = await Promise.allSettled([mutate(), mutate()]);

    const successful = results.filter((result) => result.status === "fulfilled" && result.value.status === 200);
    expect(successful).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected" || result.value.status === 409)).toHaveLength(1);
    expect(arrivals).toBe(2);
    const candidates = mocks.save.mock.calls.map(([key]) => String(key)).filter((key) => key.startsWith(`${prefix}/workbooks/versions/`));
    expect(candidates).toHaveLength(2);
    expect(new Set(candidates).size).toBe(2);
    const winnerKey = String(mocks.records.get(configKey)!.workbookObjectKey);
    expect(candidates).toContain(winnerKey);
    expect(mocks.objects.has(winnerKey)).toBe(true);
    expect(mocks.objects.has(candidates.find((key) => key !== winnerKey)!)).toBe(false);
    expect(readBudgetLines(await loadWorkbook(mocks.objects.get(winnerKey)!))[0]).toMatchObject({ paid: 200, quote: 950 });
    expect(mocks.records.get(configKey)?.workbookPlanVersion).toBe(2);
    expect(mocks.set.mock.calls.every(([target]) => target.collection !== EXPENSE_PAYMENTS)).toBe(true);
  });
});
