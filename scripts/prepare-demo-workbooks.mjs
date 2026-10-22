import ExcelJS from "exceljs";
import JSZip from "jszip";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourcePath = fileURLToPath(new URL("../public/demo/House_Planner_Demo.xlsx", import.meta.url));
const visibleCopy = [
  ["House Planner - Demo budget", "House Planner - Presupuesto de demostración"],
  ["Chapter", "Capítulo"], ["Item", "Partida"], ["Type", "Tipo"], ["Subcategory", "Subcategoría"],
  ["Objective", "Objetivo"], ["Excess over objective", "Exceso sobre objetivo"],
  ["Current quote", "Cotización actual"], ["Difference vs objective", "Diferencia con el objetivo"],
  ["Status", "Estado"], ["Actual spent", "Gasto real"], ["Supplier / note", "Proveedor / nota"],
  ["Control cost", "Costo de control"], ["Alert", "Alerta"], ["Source / evidence", "Fuente / evidencia"],
  ["Pricing basis", "Base del precio"], ["Review date", "Fecha de revisión"],
  ["Regulation reference", "Referencia normativa"], ["Required", "Requerido"],
  ["Structure", "Estructura"], ["Concrete and reinforcement", "Concreto y refuerzo"],
  ["Construction", "Construcción"], ["Foundation", "Cimentación"], ["Finishes", "Acabados"],
  ["Floors and wall finishes", "Pisos y acabados de paredes"], ["Interior", "Interior"],
  ["Interiors", "Interiores"], ["Kitchen cabinetry", "Muebles de cocina"], ["Furniture", "Mobiliario"], ["Kitchen", "Cocina"],
  ["Demo Builder", "Constructora Demo"], ["Demo Finishes", "Acabados Demo"],
  ["Completed", "Completada"], ["In progress", "En progreso"], ["Pending", "Pendiente"],
  ["completed", "completada"], ["completed", "completadas"], ["in progress", "en progreso"],
  ["pending", "pendiente"], ["pending", "pendientes"],
  ["NO DATA", "SIN DATOS"], ["OVER OBJECTIVE", "SOBRE OBJETIVO"], ["OUTSIDE OBJECTIVE", "FUERA DE OBJETIVO"],
  ["Invalid status", "Estado no válido"],
  ["Choose Pending, In progress or Completed.", "Seleccioná Pendiente, En progreso o Completada."],
];

function textInLanguage(text, language) {
  const legend = text.match(/^([✓◐○]\s+)(\d+)(\s+)(completadas?|completed|en progreso|in progress|pendientes?|pending)$/);
  if (legend) {
    const count = Number(legend[2]);
    const status = legend[4].startsWith("complet") ? ["completed", count === 1 ? "completada" : "completadas"]
      : ["en progreso", "in progress"].includes(legend[4]) ? ["in progress", "en progreso"]
      : ["pending", count === 1 ? "pendiente" : "pendientes"];
    return `${legend[1]}${legend[2]}${legend[3]}${status[language === "es" ? 1 : 0]}`;
  }
  const pair = visibleCopy.find((copy) => copy.includes(text));
  return pair ? pair[language === "es" ? 1 : 0] : text;
}

// Keep formula operators, references and numeric constants; only localize quoted display/status literals.
function formulaInLanguage(formula, language) {
  return formula.replace(/"((?:[^"]|"")*)"/g, (_literal, value) => {
    const localized = value.includes(",") ? value.split(",").map((item) => textInLanguage(item, language)).join(",") : textInLanguage(value, language);
    return `"${localized}"`;
  });
}

export async function buildDemoWorkbook(language) {
  if (!["en", "es"].includes(language)) throw new Error("Unsupported demo workbook language");
  // The committed public fixture contains synthetic USD amounts; no FX conversion or private data is used.
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await readFile(sourcePath));
  const budget = workbook.getWorksheet("Presupuesto");
  const mapping = workbook.getWorksheet("_HousePlanner");
  if (!budget || !mapping || mapping.state !== "veryHidden") throw new Error("Invalid public demo workbook protocol");
  budget.eachRow((row) => row.eachCell((cell) => {
    if (typeof cell.value === "string") cell.value = textInLanguage(cell.value, language);
    else if (cell.value && typeof cell.value === "object" && "formula" in cell.value) {
      const value = { ...cell.value, formula: formulaInLanguage(cell.value.formula, language) };
      if (typeof value.result === "string") value.result = textInLanguage(value.result, language);
      cell.value = value;
    }
    if (cell.dataValidation?.type) {
      const validation = { ...cell.dataValidation };
      if (validation.formulae) validation.formulae = validation.formulae.map((formula) => typeof formula === "string" ? formulaInLanguage(formula, language) : formula);
      for (const key of ["errorTitle", "error", "promptTitle", "prompt"]) if (typeof validation[key] === "string") validation[key] = textInLanguage(validation[key], language);
      cell.dataValidation = validation;
    }
  }));
  for (const group of budget.conditionalFormattings) for (const rule of group.rules) {
    if (rule.formulae) rule.formulae = rule.formulae.map((formula) => formulaInLanguage(formula, language));
    if (typeof rule.text === "string") rule.text = textInLanguage(rule.text, language);
  }
  // Keep protocol sheet names, version, source rows and existing UUIDs. Update only localized fingerprints.
  for (let row = 3; row <= mapping.rowCount; row++) {
    const sourceRow = Number(mapping.getCell(row, 3).value);
    const id = mapping.getCell(row, 1).value;
    if (typeof id !== "string" || !id || !Number.isInteger(sourceRow)) throw new Error("Invalid public demo line identity");
    const chapter = String(budget.getCell(sourceRow, 1).value);
    const item = String(budget.getCell(sourceRow, 2).value);
    mapping.getCell(row, 4).value = chapter;
    mapping.getCell(row, 5).value = item;
    mapping.getCell(row, 6).value = `${chapter}\u241f${item}\u241f${sourceRow}`;
  }
  const bytes = await workbook.xlsx.writeBuffer();
  const zip = await JSZip.loadAsync(bytes);
  // Preserve source document dates and fixed ZIP entry dates for reproducible committed assets.
  const fixedDate = workbook.created;
  zip.forEach((_name, file) => { file.date = fixedDate; });
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 }, platform: "DOS" });
}

async function main() {
  const localized = new Map();
  for (const language of ["en", "es"]) localized.set(language, await buildDemoWorkbook(language));
  for (const language of ["en", "es"]) {
    const output = fileURLToPath(new URL(`../public/demo/House_Planner_Demo_${language}.xlsx`, import.meta.url));
    await writeFile(output, localized.get(language));
    console.log(`Prepared synthetic demo workbook (${language}).`);
  }
  // Keep the legacy download alias identical to the English-first public demo.
  await writeFile(sourcePath, localized.get("en"));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
