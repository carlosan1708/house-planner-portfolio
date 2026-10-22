import { expect, it } from "vitest";
import { reconcileBudgetMetadata, sameBudgetContent } from "@/lib/google-budget-content";
import { createStarterWorkbook, writeWorkbook, loadWorkbook } from "@/lib/workbook";

it("keeps drafts valid for recalculation and formatting, but detects changed inputs and formulas", async () => {
  const workbook = createStarterWorkbook();
  workbook.addWorksheet("Notas").getCell("A1").value = { formula: "1+1", result: 2 };
  const original = await writeWorkbook(workbook);
  const other = await loadWorkbook(original);
  const sheet = other.getWorksheet("Presupuesto")!;
  other.getWorksheet("Notas")!.getCell("A1").value = { formula: "1+1", result: 3 };
  sheet.getCell("A4").font = { bold: true, color: { argb: "FFFF0000" } };
  expect(await sameBudgetContent(original, Buffer.from(await other.xlsx.writeBuffer()))).toBe(true);
  sheet.getCell("E4").value = 123;
  expect(await sameBudgetContent(original, Buffer.from(await other.xlsx.writeBuffer()))).toBe(false);
  sheet.getCell("E4").value = workbook.getWorksheet("Presupuesto")!.getCell("E4").value;
  other.getWorksheet("Notas")!.getCell("A1").value = { formula: "1+2", result: 3 };
  expect(await sameBudgetContent(original, Buffer.from(await other.xlsx.writeBuffer()))).toBe(false);
});

it("reconciles a local amount while preserving Google's formatting, and refuses divergent edits", async () => {
  const base = await writeWorkbook(createStarterWorkbook());
  const local = await loadWorkbook(base), remote = await loadWorkbook(base);
  local.getWorksheet("Presupuesto")!.getCell("E4").value = 123;
  remote.getWorksheet("Presupuesto")!.getCell("A4").font = { bold: true, color: { argb: "FFFF0000" } };
  const bytes = async (w: typeof local) => Buffer.from(await w.xlsx.writeBuffer());
  const merged = await reconcileBudgetMetadata(base, await bytes(local), await bytes(remote));
  expect(merged).not.toBeNull();
  const result = await loadWorkbook(merged!);
  expect(result.getWorksheet("Presupuesto")!.getCell("E4").value).toBe(123);
  expect(result.getWorksheet("Presupuesto")!.getCell("A4").font.color?.argb).toBe("FFFF0000");
  remote.getWorksheet("Presupuesto")!.getCell("E4").value = 456;
  expect(await reconcileBudgetMetadata(base, await bytes(local), await bytes(remote))).toBeNull();
  remote.getWorksheet("Presupuesto")!.getCell("E4").value = 0;
  local.getWorksheet("Presupuesto")!.insertRow(4, ["New", "Line", "", "", 10]);
  expect(await reconcileBudgetMetadata(base, await bytes(local), base)).not.toBeNull();
  expect(await reconcileBudgetMetadata(base, await bytes(local), await bytes(remote))).toBeNull();
});
