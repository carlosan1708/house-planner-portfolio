import { expect, it, vi } from "vitest";
vi.mock("@/lib/firebase-admin", () => ({ firestore: {}, projectBucket: null }));
import { consolidatedWorkbook, needsGoogleRowIdentities } from "@/lib/consolidated-workbook";
import { createStarterWorkbook, loadWorkbook, readBudgetLines, writeWorkbook } from "@/lib/workbook";
import { syncDirection, syncGoogleBudget } from "@/lib/google-budget";
it("never permits the QA reset override for a production project", async () => {
  vi.stubEnv("HOUSE_PLANNER_QA_PROJECT_IDS", "qa-project");
  try { await expect(syncGoogleBudget("sample-house", undefined, false, true)).rejects.toThrow("qa_reset_forbidden"); }
  finally { vi.unstubAllEnvs(); }
});
it("keeps row identity after an external insertion and deletion", async () => {
  const original = await consolidatedWorkbook(await writeWorkbook(createStarterWorkbook()));
  const workbook = await loadWorkbook(original);
  const previousId = readBudgetLines(workbook)[0].id;
  const sheet = workbook.getWorksheet("Presupuesto")!;
  sheet.insertRow(4, ["General", "Inserted", "", "", 10, null, 0, null, "Pendiente", 0]);
  const updated = await loadWorkbook(await consolidatedWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), true));
  const lines = readBudgetLines(updated);
  expect(lines[1].id).toBe(previousId);
  expect(lines[0].id).not.toBe(previousId);
  updated.getWorksheet("Presupuesto")!.spliceRows(5, 1);
  const next = await loadWorkbook(await consolidatedWorkbook(Buffer.from(await updated.xlsx.writeBuffer()), true));
  expect(readBudgetLines(next).map((line) => line.id)).toEqual([lines[0].id]);
});
it("rejects duplicate identity markers and invalid amounts", async () => {
  const workbook = await loadWorkbook(await consolidatedWorkbook(await writeWorkbook(createStarterWorkbook())));
  const sheet = workbook.getWorksheet("Presupuesto")!;
  sheet.insertRow(5, sheet.getRow(4).values);
  await expect(consolidatedWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), true)).rejects.toThrow("mismo identificador");
  sheet.spliceRows(5, 1); sheet.getCell("E4").value = "oops";
  await expect(consolidatedWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), true)).rejects.toThrow("importe");
});
it("assigns a new identity to a renamed copy inserted before its original", async () => {
  const baseline = await consolidatedWorkbook(await writeWorkbook(createStarterWorkbook()));
  const workbook = await loadWorkbook(baseline);
  const original = readBudgetLines(workbook)[0];
  const sheet = workbook.getWorksheet("Presupuesto")!;
  sheet.insertRow(4, sheet.getRow(4).values);
  sheet.getCell("B4").value = "Extras";
  const copied = Buffer.from(await workbook.xlsx.writeBuffer());
  expect(await needsGoogleRowIdentities(copied)).toBe(true);
  const repaired = await consolidatedWorkbook(copied, true, baseline);
  const lines = readBudgetLines(await loadWorkbook(repaired));
  expect(lines).toHaveLength(2);
  expect(lines.find(line => line.item === original.item)?.id).toBe(original.id);
  expect(lines.find(line => line.item === "Extras")?.id).not.toBe(original.id);
  expect(await needsGoogleRowIdentities(repaired)).toBe(false);
  expect(readBudgetLines(await loadWorkbook(await consolidatedWorkbook(repaired, true, baseline))).map(line => line.id)).toEqual(lines.map(line => line.id));
});
it("does not guess which identical copy owns the existing links", async () => {
  const baseline = await consolidatedWorkbook(await writeWorkbook(createStarterWorkbook()));
  const workbook = await loadWorkbook(baseline);
  const sheet = workbook.getWorksheet("Presupuesto")!;
  sheet.insertRow(4, sheet.getRow(4).values);
  await expect(consolidatedWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), true, baseline)).rejects.toThrow("nombre distinto");
});
it("supports renamed categories, copied categories, and deleting a category without reusing identities", async () => {
  const base = await consolidatedWorkbook(await writeWorkbook(createStarterWorkbook()));
  const workbook = await loadWorkbook(base);
  const sheet = workbook.getWorksheet("Presupuesto")!;
  const original = readBudgetLines(workbook)[0];
  sheet.insertRow(5, sheet.getRow(4).values);
  sheet.getCell("A5").value = "Categoría nueva";
  let imported = await consolidatedWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), true, base);
  const copied = readBudgetLines(await loadWorkbook(imported));
  expect(copied[0].id).toBe(original.id);
  expect(copied[1].id).not.toBe(original.id);
  const edited = await loadWorkbook(imported), updated = edited.getWorksheet("Presupuesto")!;
  updated.getCell("A4").value = "Categoría renombrada";
  updated.getCell("C4").value = "Tipo nuevo";
  updated.getCell("D4").value = "Subcategoría nueva";
  updated.spliceRows(5, 1);
  imported = await consolidatedWorkbook(Buffer.from(await edited.xlsx.writeBuffer()), true, imported);
  expect(readBudgetLines(await loadWorkbook(imported))).toEqual([expect.objectContaining({id:original.id,chapter:"Categoría renombrada",type:"Tipo nuevo",subcategory:"Subcategoría nueva"})]);
});
it("includes a new category appended below TOTAL and preserves references to the total", async () => {
  const base = await consolidatedWorkbook(await writeWorkbook(createStarterWorkbook()));
  const workbook = await loadWorkbook(base), sheet = workbook.getWorksheet("Presupuesto")!;
  let total = 0;
  sheet.eachRow((row, index) => { if (row.getCell(1).text === "TOTAL") total = index; });
  workbook.addWorksheet("Referencia").getCell("A1").value = {formula:`Presupuesto!E${total}`,result:0};
  sheet.getRow(total + 2).values = ["Categoría añadida", "Partida nueva", "", "", 321, null, 0, null, "Pendiente", 0];
  const imported = await loadWorkbook(await consolidatedWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), true, base));
  expect(readBudgetLines(imported).find(line => line.chapter === "Categoría añadida")?.objective).toBe(321);
  const budget = imported.getWorksheet("Presupuesto")!;
  expect(budget.getCell(total,1).value).toBeNull();
  expect(budget.getCell(total+4,5).result).toBe(321);
  expect(imported.getWorksheet("Referencia")!.getCell("A1").formula).toBe(`Presupuesto!E${total+4}`);
});
it("chooses sync direction without overwriting divergent versions", () => {
  expect(syncDirection("a", "a", "1", "1")).toBe("none");
  expect(syncDirection("b", "a", "1", "1")).toBe("push");
  expect(syncDirection("a", "a", "2", "1")).toBe("pull");
  expect(() => syncDirection("b", "a", "2", "1")).toThrow("ninguna se sobrescribió");
});
