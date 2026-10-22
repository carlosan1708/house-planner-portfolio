import { beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";

const state = vi.hoisted(() => {
  type Data = Record<string, unknown>;
  const records = new Map<string, Data>(), objects = new Map<string, Buffer>();
  let serial = 0;
  const ref = (collection: string, id = `generated-${++serial}`) => ({
    key: `${collection}/${id}`, id,
    get: async () => ({ exists: records.has(`${collection}/${id}`), data: () => structuredClone(records.get(`${collection}/${id}`)) }),
  });
  const query = (collection: string, projectId: string) => ({ get: async () => ({ docs: [...records].flatMap(([key, data]) => key.startsWith(`${collection}/`) && data.projectId === projectId ? [{ id: key.slice(collection.length + 1), data: () => structuredClone(data) }] : []) }) });
  const set = (target: ReturnType<typeof ref>, data: Data, options?: { merge?: boolean }) => { records.set(target.key, options?.merge ? { ...records.get(target.key), ...data } : data); };
  const sync = vi.fn(async () => ({ googleSynced: false, googleSyncError: "Synthetic projection unavailable" }));
  return { records, objects, ref, query, set, sync };
});

vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "server-time" } }));
vi.mock("@/lib/google-budget", () => ({ syncAfterBudgetCommit: state.sync }));
vi.mock("@/lib/firebase-admin", () => ({
  firestore: { collection: (collection: string) => ({ doc: (id?: string) => state.ref(collection, id), where: (_field: string, _operator: string, projectId: string) => state.query(collection, projectId) }) },
  projectBucket: { file: (key: string) => ({
    download: async () => [Buffer.from(state.objects.get(key)!)],
    save: async (bytes: Buffer) => { state.objects.set(key, Buffer.from(bytes)); },
    delete: async () => { state.objects.delete(key); },
  }) },
}));

import { prepareProjectCurrencyCorrection } from "@/lib/project-currency-correction";
import { CONFIG, EXPENSE_PAYMENTS, LEGACY_PROJECT_ID, PROJECTS, PURCHASES, WORKBOOK_VERSIONS, projectConfigDoc } from "@/lib/project";
import { DEFAULT_WORKBOOK_KEY } from "@/lib/workbook-store";
import { addPaymentWorkbookProjection, PAYMENT_PROJECTION_SHEET } from "@/lib/payment-workbook";
import { createStarterWorkbook, generateCategoryWorkbook, loadWorkbook, readBudgetLines, setWorkbookCurrency, toUniver, workbookCurrency, writeWorkbook } from "@/lib/workbook";

const projectId = "currency-correction-test", configKey = `${CONFIG}/${projectConfigDoc(projectId)}`;
const tx = () => ({ get: (target: { get: () => Promise<unknown> }) => target.get(), set: state.set }) as unknown as FirebaseFirestore.Transaction;
const observations = (workbook: Awaited<ReturnType<typeof loadWorkbook>>) => {
  const numbers: unknown[] = [], formulas: unknown[] = [];
  for (const sheet of workbook.worksheets) sheet.eachRow((row) => row.eachCell((cell) => {
    if (typeof cell.value === "number") numbers.push([sheet.name, cell.address, cell.value]);
    if (cell.formula) formulas.push([sheet.name, cell.address, cell.formula, cell.result]);
  }));
  return { numbers, formulas };
};

async function seed(model = 1, pending = false) {
  const workbook = createStarterWorkbook("CRC"), sheet = workbook.getWorksheet("Presupuesto")!;
  sheet.getCell("E4").value = 5000.75; sheet.getCell("G4").value = 6100.5; sheet.getCell("J4").value = 200.25;
  const line = readBudgetLines(workbook)[0];
  const payment = { projectId, budgetLineId: line.id, amount: 25.5, accountingMode: "ledger", documentIds: ["receipt-original"], createdBy: "Original author" };
  state.records.set(`${EXPENSE_PAYMENTS}/legacy-payment`, payment);
  state.records.set(`${PURCHASES}/explicit-crc`, { projectId, currency: "CRC", amount: 400 });
  state.records.set(`${PROJECTS}/${projectId}`, { currency: "CRC" });
  if (model === 2) addPaymentWorkbookProjection(workbook, [{ id: "legacy-payment", ...payment }], { paymentsModelVersion: 2, paymentLedgerRevision: 2, includePaymentDetails: false });
  const extra = workbook.addWorksheet("Measurements"); extra.getCell("A1").value = 15.75; extra.getCell("A1").numFmt = "0.00";
  extra.getCell("B1").value = -123.45; extra.getCell("B1").numFmt = '₡#,##0.00;[Red](₡#,##0.00)';
  extra.getCell("C1").value = 5; extra.getCell("C1").numFmt = "[$-409]0";
  const bytes = await writeWorkbook(workbook);
  state.objects.set("baseline.xlsx", bytes);
  state.records.set(configKey, { workbookObjectKey: "baseline.xlsx", workbookPlanVersion: 4, workbookActualsRevision: 3,
    paymentsModelVersion: model, paymentLedgerRevision: pending ? 3 : 2, paymentProjectedLedgerRevision: 2, paymentProjectionPending: pending });
  return { line, bytes };
}

beforeEach(() => { vi.clearAllMocks(); state.records.clear(); state.objects.clear(); });

describe("confirmed populated project denomination correction", () => {
  it("corrects CRC to USD and back while preserving every number, formula, UUID and explicit purchase currency", async () => {
    const { bytes, line } = await seed();
    const source = await loadWorkbook(bytes), before = observations(source);
    const proposal = await prepareProjectCurrencyCorrection(projectId, "CRC", "USD");
    expect(state.records.get(configKey)?.workbookObjectKey).toBe("baseline.xlsx");
    await proposal.validate(tx()); proposal.write(tx());
    const corrected = await loadWorkbook(state.objects.get(proposal.objectKey!)!);
    expect(observations(corrected)).toEqual(before);
    expect(workbookCurrency(corrected)).toBe("USD");
    expect(corrected.getWorksheet("Measurements")!.getCell("A1").numFmt).toBe("0.00");
    expect(corrected.getWorksheet("Measurements")!.getCell("C1").numFmt).toBe("[$-409]0");
    expect(corrected.getWorksheet("Measurements")!.getCell("B1").numFmt).toBe('$#,##0.00;[Red]($#,##0.00)');
    expect(readBudgetLines(corrected)[0].id).toBe(line.id);
    expect(state.records.get(configKey)).toMatchObject({ workbookPlanVersion: 5, workbookActualsRevision: 4, currencyCorrectionPlanVersion: 5, paymentLedgerRevision: 3 });
    expect(state.records.get(`${EXPENSE_PAYMENTS}/legacy-payment`)).toMatchObject({ currency: "USD", originalCurrency: "CRC", amount: 25.5, createdBy: "Original author", documentIds: ["receipt-original"] });
    expect(state.records.get(`${PURCHASES}/explicit-crc`)).toMatchObject({ currency: "CRC", amount: 400 });
    const back = await prepareProjectCurrencyCorrection(projectId, "USD", "CRC");
    await back.validate(tx()); back.write(tx());
    const restored = await loadWorkbook(state.objects.get(back.objectKey!)!);
    expect(observations(restored)).toEqual(before);
    expect(workbookCurrency(restored)).toBe("CRC");
    expect(state.records.get(`${EXPENSE_PAYMENTS}/legacy-payment`)).toMatchObject({ currency: "CRC", originalCurrency: "CRC", amount: 25.5 });
    expect([...state.records].filter(([key]) => key.startsWith(`${WORKBOOK_VERSIONS}/`))).toHaveLength(2);
  });

  it.each(["config", "payment", "new-payment"])("rejects a stale %s preparation and cleans up only its candidate", async (change) => {
    await seed();
    const proposal = await prepareProjectCurrencyCorrection(projectId, "CRC", "USD");
    if (change === "config") state.records.set(configKey, { ...state.records.get(configKey), workbookPlanVersion: 5 });
    else if (change === "payment") state.records.set(`${EXPENSE_PAYMENTS}/legacy-payment`, { ...state.records.get(`${EXPENSE_PAYMENTS}/legacy-payment`), amount: 99 });
    else state.records.set(`${EXPENSE_PAYMENTS}/new`, { projectId, amount: 1 });
    await expect(proposal.validate(tx())).rejects.toThrow("currency_stale");
    await proposal.cleanup();
    expect(state.objects.has(proposal.objectKey!)).toBe(false);
    expect(state.objects.has("baseline.xlsx")).toBe(true);
  });

  it("rejects unsupported native features before creating a candidate", async () => {
    const { bytes } = await seed(), zip = await JSZip.loadAsync(bytes);
    zip.file("xl/charts/chart1.xml", "<chart/>"); state.objects.set("baseline.xlsx", await zip.generateAsync({ type: "nodebuffer" }));
    await expect(prepareProjectCurrencyCorrection(projectId, "CRC", "USD")).rejects.toThrow("currency_unsupported_workbook");
    expect(state.objects.size).toBe(1);
  });

  it.each([false, true])("versions the legacy default source when its stored key is missing (config exists: %s)", async (exists) => {
    const { bytes } = await seed(), before = observations(await loadWorkbook(bytes));
    const legacyConfigKey = `${CONFIG}/${projectConfigDoc(LEGACY_PROJECT_ID)}`;
    if (exists) state.records.set(legacyConfigKey, { workbookPlanVersion: 6 });
    state.objects.set(DEFAULT_WORKBOOK_KEY, bytes);
    const proposal = await prepareProjectCurrencyCorrection(LEGACY_PROJECT_ID, "CRC", "USD");
    await proposal.validate(tx()); proposal.write(tx());
    expect(proposal.objectKey).not.toBeNull();
    expect(observations(await loadWorkbook(state.objects.get(proposal.objectKey!)!))).toEqual(before);
    expect(state.records.get(legacyConfigKey)).toMatchObject({ workbookObjectKey: proposal.objectKey, workbookPlanVersion: exists ? 7 : 2, workbookActualsRevision: 1 });
    expect(state.objects.get(DEFAULT_WORKBOOK_KEY)).toEqual(bytes);
  });

  it("bounds payment relabels before exceeding one atomic Firestore transaction", async () => {
    await seed();
    for (let index = 0; index < 300; index++) state.records.set(`${EXPENSE_PAYMENTS}/extra-${index}`, { projectId, amount: 1 });
    await expect(prepareProjectCurrencyCorrection(projectId, "CRC", "USD")).rejects.toThrow("currency_scope_limit");
    expect(state.objects.size).toBe(1);
  });

  it("advances an aligned v2 projection metadata revision without changing paid amounts", async () => {
    const { bytes } = await seed(2);
    const original = await loadWorkbook(bytes), paid = original.getWorksheet("Presupuesto")!.getCell("J4").value;
    const proposal = await prepareProjectCurrencyCorrection(projectId, "CRC", "USD");
    await proposal.validate(tx()); proposal.write(tx());
    const corrected = await loadWorkbook(state.objects.get(proposal.objectKey!)!);
    expect(corrected.getWorksheet("Presupuesto")!.getCell("J4").value).toBe(paid);
    expect(corrected.getWorksheet(PAYMENT_PROJECTION_SHEET)!.getCell("E1").value).toBe(3);
    expect(state.records.get(configKey)).toMatchObject({ paymentLedgerRevision: 3, paymentProjectedLedgerRevision: 3, paymentProjectionPending: false });
  });

  it("keeps an accepted pending payment projection durable when post-commit synchronization fails", async () => {
    const { bytes } = await seed(2, true), before = observations(await loadWorkbook(bytes));
    const proposal = await prepareProjectCurrencyCorrection(projectId, "CRC", "USD");
    await proposal.validate(tx()); proposal.write(tx());
    expect(observations(await loadWorkbook(state.objects.get(proposal.objectKey!)!))).toEqual(before);
    expect(await proposal.afterCommit()).toMatchObject({ googleSynced: false, googleSyncError: "Synthetic projection unavailable" });
    expect(state.records.get(configKey)).toMatchObject({ paymentLedgerRevision: 4, paymentProjectedLedgerRevision: 2, paymentProjectionPending: true });
    expect(state.records.get(`${EXPENSE_PAYMENTS}/legacy-payment`)).toMatchObject({ currency: "USD", amount: 25.5 });
  });

  it("keeps fractional CRC visible after a USD correction and ordinary canonical reads, writes and category generation", async () => {
    await seed();
    const source = createStarterWorkbook("USD"), budget = source.getWorksheet("Presupuesto")!;
    budget.getCell("E4").value = 12.75; budget.getCell("G4").value = 13.5; budget.getCell("J4").value = 2.25;
    const summary = source.addWorksheet("Resumen"); summary.getCell("A4").value = "Objetivo";
    state.objects.set("baseline.xlsx", await writeWorkbook(source));
    state.records.set(`${EXPENSE_PAYMENTS}/legacy-payment`, { ...state.records.get(`${EXPENSE_PAYMENTS}/legacy-payment`), currency: "USD" });
    const proposal = await prepareProjectCurrencyCorrection(projectId, "USD", "CRC");
    await proposal.validate(tx()); proposal.write(tx());
    const candidate = await loadWorkbook(state.objects.get(proposal.objectKey!)!);
    setWorkbookCurrency(candidate, "CRC");
    const canonical = await loadWorkbook(await writeWorkbook(candidate)), lines = readBudgetLines(canonical);
    expect(lines[0]).toMatchObject({ objective: 12.75, quote: 13.5, paid: 2.25 });
    for (const address of ["E4", "F4", "G4", "J4", "L4", "E5"]) expect(canonical.getWorksheet("Presupuesto")!.getCell(address).numFmt).toBe("₡#,##0.00");
    expect(canonical.getWorksheet("Resumen")!.getCell("B4").numFmt).toBe("₡#,##0.00");
    const generated = generateCategoryWorkbook(toUniver(canonical), lines, { key: "chapter", label: "General" }).workbook;
    const sheet = generated.sheets[generated.sheetOrder[0]];
    expect(sheet.cellData[3][4].v).toBe(12.75);
    expect(sheet.cellData[3][4].s?.n).toBe("₡#,##0.00");
    expect(sheet.cellData[4][4].s?.n).toBe("₡#,##0.00");
    const integer = createStarterWorkbook("CRC"); integer.getWorksheet("Presupuesto")!.getCell("E4").value = 12;
    expect((await loadWorkbook(await writeWorkbook(integer))).getWorksheet("Presupuesto")!.getCell("E4").numFmt).toBe("₡#,##0");
  });
});
