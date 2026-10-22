import { beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

const state = vi.hoisted(() => {
  const records = new Map<string, Record<string, unknown>>(), objects = new Map<string, Buffer>();
  const ref = (collection: string, id: string) => ({
    key: `${collection}/${id}`,
    get: async () => ({ exists: records.has(`${collection}/${id}`), data: () => records.get(`${collection}/${id}`) }),
    set: async (data: Record<string, unknown>) => { records.set(`${collection}/${id}`, data); },
  });
  const query = (collection: string, value: unknown) => ({ get: async () => ({ docs: [...records].flatMap(([key, data]) => key.startsWith(`${collection}/`) && data.projectId === value ? [{ id: key.slice(collection.length + 1), data: () => data }] : []) }) });
  const read = vi.fn(async () => "USD" as "USD" | "CRC");
  const lock = vi.fn(async () => "USD" as "USD" | "CRC");
  return { records, objects, ref, query, read, lock, batchWrites: vi.fn() };
});

vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "server-time" } }));
vi.mock("@/lib/project-currency", () => ({ readProjectCurrency: state.read, lockProjectCurrency: state.lock }));
vi.mock("@/lib/google-budget", () => ({ syncGoogleBudget: async () => null }));
vi.mock("@/lib/firebase-admin", () => ({
  firestore: {
    collection: (collection: string) => ({ doc: (id: string) => state.ref(collection, id), where: (_field: string, _operator: string, value: unknown) => state.query(collection, value) }),
    batch: () => ({ set: state.batchWrites, commit: async () => undefined }),
  },
  projectBucket: { file: (key: string) => ({
    download: async () => [state.objects.get(key)!],
    save: async (bytes: Buffer) => { state.objects.set(key, Buffer.from(bytes)); },
  }) },
}));

import { budgetPayload, loadOfficialWorkbook, workbookConfig } from "@/lib/workbook-store";
import { CONFIG, EXPENSE_PAYMENTS, OVERRIDES, PROJECTS, PURCHASES, projectConfigDoc, projectStoragePrefix } from "@/lib/project";
import { createStarterWorkbook, loadWorkbook, readBudgetLines, workbookCurrency, writeWorkbook } from "@/lib/workbook";

const projectId = "currency-store-test";
const configKey = `${CONFIG}/${projectConfigDoc(projectId)}`;

function legacyWorkbook() {
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Presupuesto");
  sheet.getRow(3).values = ["Capítulo", "Partida", "Tipo", "Subcategoría", "Objetivo", "Máximo", "Cotización", "Diferencia", "Obligatorio", "Referencia", "Base", "Fuente", "Fecha", "Estado", "Precio pagado", "Proveedor", "Costo usado", "Alerta"];
  sheet.getRow(4).values = ["Structure", "Concrete", "Work", "Foundation", 1000, 1200, 1100, 0, true, "Regulation", "", "", "", "Pendiente", 125.5, "Supplier", 1100, "OK"];
  return workbook;
}

beforeEach(() => { vi.clearAllMocks(); state.records.clear(); state.objects.clear(); state.read.mockResolvedValue("USD"); });

describe("canonical project currency in stored workbooks", () => {
  it("creates an editable USD zero starter without locking currency or materializing financial records", async () => {
    const config = await workbookConfig(projectId, { skipGoogleSync: true });
    expect(config).toMatchObject({ currency: "USD", currencyEditable: true });
    expect(state.records.get(configKey)?.currencyEditable).toBe(true);
    expect(state.lock).not.toHaveBeenCalled();
    const workbook = await loadWorkbook(state.objects.get(config.objectKey)!);
    expect(workbookCurrency(workbook)).toBe("USD");
    expect(readBudgetLines(workbook)[0].objective).toBe(0);
    await budgetPayload(projectId, { skipGoogleSync: true });
    expect(state.batchWrites).not.toHaveBeenCalled();
    expect([...state.records.keys()]).toEqual([configKey]);
  });

  it("normalizes a stale stored marker to the canonical project without converting amounts", async () => {
    const workbook = createStarterWorkbook("CRC"); workbook.getWorksheet("Presupuesto")!.getCell("E4").value = 123.45;
    const key = `${projectStoragePrefix(projectId)}/workbooks/starter.xlsx`;
    state.objects.set(key, await writeWorkbook(workbook));
    state.records.set(configKey, { workbookObjectKey: key, currencyEditable: true });
    state.records.set(`${PROJECTS}/${projectId}`, { currency: "USD" });
    const result = await loadOfficialWorkbook(projectId, { skipGoogleSync: true });
    expect(result.config.currency).toBe("USD");
    expect(workbookCurrency(result.workbook)).toBe("USD");
    expect(readBudgetLines(result.workbook)[0].objective).toBe(123.45);
    expect(result.workbook.getWorksheet("Presupuesto")!.getCell("E4").numFmt).toBe("$#,##0.00");
  });

  it("assigns outside-objective paid amounts to USD while keeping separate CRC purchases", async () => {
    const workbook = createStarterWorkbook("USD"), sheet = workbook.getWorksheet("Presupuesto")!;
    sheet.getCell("E4").value = 300; sheet.getCell("J4").value = 25.5; sheet.getCell("AA4").value = 1;
    const id = readBudgetLines(workbook)[0].id, key = "official.xlsx";
    state.objects.set(key, await writeWorkbook(workbook));
    state.records.set(configKey, { workbookObjectKey: key, paymentsModelVersion: 2, workbookPlanVersion: 2 });
    state.records.set(`${EXPENSE_PAYMENTS}/usd-payment`, { projectId, budgetLineId: id, currency: "USD", amount: 25.5 });
    state.records.set(`${PURCHASES}/outside-crc`, { projectId, outsideObjective: true, currency: "CRC", amount: 700 });
    const payload = await budgetPayload(projectId, { skipGoogleSync: true });
    expect(payload).toMatchObject({ currency: "USD", objective: 0, spent: 0, outsideObjective: { USD: 25.5, CRC: 700, budgetLinesUSD: 25.5, budgetLinesCRC: 0 } });
  });

  it("applies legacy override coordinates before canonical currency normalization migrates the source columns", async () => {
    const key = "legacy-source.xlsx";
    state.objects.set(key, Buffer.from(await legacyWorkbook().xlsx.writeBuffer()));
    state.records.set(configKey, { workbookObjectKey: key });
    state.records.set(`${OVERRIDES}/old-paid`, { projectId, sheetName: "Presupuesto", rowIndex: 3, columnIndex: 14, value: 375.75 });
    state.records.set(`${OVERRIDES}/old-status`, { projectId, sheetName: "Presupuesto", rowIndex: 3, columnIndex: 13, value: "Completada" });
    const { workbook } = await loadOfficialWorkbook(projectId, { skipGoogleSync: true });
    expect(readBudgetLines(workbook)[0]).toMatchObject({ paid: 375.75, status: "Completada", objective: 1000, quote: 1100 });
    expect(workbook.getWorksheet("Presupuesto")!.getCell("O4").value).toBe("");
    expect(workbook.getWorksheet("Presupuesto")!.getCell("J4").numFmt).toBe("$#,##0.00");
  });

  it.each([true, false])("ignores v2 paid overrides in raw legacy coordinates: %s", async (legacy) => {
    const workbook = legacy ? legacyWorkbook() : createStarterWorkbook();
    if (!legacy) workbook.getWorksheet("Presupuesto")!.getCell("J4").value = 125.5;
    const key = legacy ? "legacy-v2.xlsx" : "current-v2.xlsx";
    state.objects.set(key, Buffer.from(await workbook.xlsx.writeBuffer()));
    state.records.set(configKey, { workbookObjectKey: key, paymentsModelVersion: 2 });
    state.records.set(`${OVERRIDES}/paid`, { projectId, sheetName: "Presupuesto", rowIndex: 3, columnIndex: legacy ? 14 : 9, value: 9999 });
    state.records.set(`${OVERRIDES}/regulatory`, { projectId, sheetName: "Presupuesto", rowIndex: 3, columnIndex: legacy ? 9 : 16, value: "Updated regulation" });
    const result = await loadOfficialWorkbook(projectId, { skipGoogleSync: true });
    expect(readBudgetLines(result.workbook)[0].paid).toBe(125.5);
    expect(result.workbook.getWorksheet("Presupuesto")!.getCell("Q4").value).toBe("Updated regulation");
  });
});
