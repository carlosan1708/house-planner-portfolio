import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import sharp from "sharp";

export type QaFixture = { name: string; mimeType: string; buffer: Buffer; path: string };

function pdfBuffer(text: string) {
  const lines = text.split(/\s+/).reduce<string[]>((result, word) => {
    const last = result.length - 1;
    if (last < 0 || result[last].length + word.length + 1 > 72) result.push(word);
    else result[last] += ` ${word}`;
    return result;
  }, []);
  const stream = `BT /F1 12 Tf 16 TL 72 720 Td ${lines.map((line, index) => `${index ? "T* " : ""}(${line.replace(/([\\()])/g, "\\$1")}) Tj`).join("\n")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

async function docxBuffer(text: string) {
  const xmlText = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.folder("_rels")?.file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.folder("word")?.file("document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${xmlText}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

async function workbookBuffer(withSecondPaidLine = false) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Presupuesto", { views: [{ state: "frozen", xSplit: 2, ySplit: 3 }] });
  sheet.mergeCells("A1:R1");
  sheet.getCell("A1").value = "QA Regression Budget";
  sheet.getRow(3).values = ["Capítulo", "Partida", "Tipo", "Subcategoría", "Objetivo", "Exceso sobre objetivo", "Cotización vigente", "Diferencia vs objetivo", "Estado", "Precio pagado", "Proveedor / nota", "Costo usado", "Alerta", "Fuente / evidencia", "Base de precio", "Fecha revisión", "Referencia reglamento", "Obligatorio"];
  // Statuses deliberately contradict the amount pattern. Regression must prove
  // that Estado is manual and never inferred from quote or paid-price values.
  sheet.getRow(4).values = ["QA Structure", "QA Completed concrete", "Work", "Foundation", 1000, { formula: "MAX(0,L4-E4)", result: 0 }, 1000, { formula: "E4-G4", result: 0 }, "Pendiente", 1000, "QA Supplier", { formula: "IF(J4>0,J4,G4)", result: 1000 }, { formula: 'IF(L4>E4,"SOBRE OBJETIVO","OK")', result: "OK" }, "QA receipt", "Synthetic", "2026-08-31", "QA-001", true];
  sheet.getRow(5).values = ["QA Finishes", "QA In progress tile", "Material", "Interior", 800, { formula: "MAX(0,L5-E5)", result: 0 }, 700, { formula: "E5-G5", result: 100 }, "Completada", withSecondPaidLine ? 700 : 0, "QA Tile", { formula: "IF(J5>0,J5,G5)", result: 700 }, { formula: 'IF(L5>E5,"SOBRE OBJETIVO","OK")', result: "OK" }, "", "Synthetic", "2026-08-31", "QA-002", false];
  sheet.getRow(6).values = ["QA Garden", "QA Pending plants", "Material", "Exterior", 600, { formula: "MAX(0,L6-E6)", result: 0 }, 0, { formula: "E6-G6", result: 600 }, "En progreso", 0, "", { formula: "IF(J6>0,J6,G6)", result: "" }, { formula: 'IF(L6="","SIN DATOS",IF(L6>E6,"SOBRE OBJETIVO","OK"))', result: "SIN DATOS" }, "", "Synthetic", "2026-08-31", "QA-003", false];
  sheet.getRow(3).font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
  sheet.getRow(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF25262D" } };
  [5, 6, 7, 8, 10, 12].forEach((column) => { sheet.getColumn(column).numFmt = "₡#,##0"; sheet.getColumn(column).width = 16; });
  sheet.getColumn(2).width = 30;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function imageBuffer() {
  // A readable offer is required to verify multimodal supplier comparison.
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640">
    <rect width="960" height="640" fill="white"/>
    <g fill="#202020" font-family="Arial, sans-serif" font-size="28">
      <text x="48" y="72">QA Supplier 2 - synthetic contractor offer</text>
      <text x="48" y="140">100 meters of THHN 12 AWG copper cable</text>
      <text x="48" y="200">Unit price: CRC 600 per meter</text>
      <text x="48" y="260">Cable total: CRC 60000</text>
      <text x="48" y="320">Delivery: CRC 1500; installation excluded</text>
      <text x="48" y="380">Delivery time: 5 business days</text>
      <text x="48" y="440">Payment: on delivery; warranty: not stated</text>
      <text x="48" y="500">Taxes: not stated</text>
    </g>
  </svg>`)).png().toBuffer();
}

export async function createQaFixtures(runId: string, withSecondPaidLine = false) {
  const directory = join(process.cwd(), "test-results", `qa-fixtures-${runId}`);
  await mkdir(directory, { recursive: true });
  const token = `QA-REFERENCE-${runId}`;
  const definitions = [
    { name: `${runId}-budget.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: await workbookBuffer(withSecondPaidLine) },
    { name: `${runId}-contract.pdf`, mimeType: "application/pdf", buffer: pdfBuffer(`${token}: inspection date is September 15 2026. Contractor quote: 100 meters of THHN 12 AWG copper cable at CRC 650 per meter, CRC 65000 total.`) },
    { name: `${runId}-notes.docx`, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: await docxBuffer(`${token}: Word reference for QA regression. QA Supplier 3 contractor offer: 110 meters of THHN 12 AWG copper cable at CRC 620 per meter, CRC 68200 cable total. Delivery costs CRC 2000 and takes 7 business days. Installation excluded. Payment: 50 percent deposit, remainder on delivery. Taxes and warranty are not stated.`) },
    { name: `${runId}-receipt.png`, mimeType: "image/png", buffer: await imageBuffer() },
  ];
  const fixtures: Record<string, QaFixture> = {};
  for (const definition of definitions) {
    const path = join(directory, definition.name);
    await writeFile(path, definition.buffer);
    const key = definition.mimeType.includes("spreadsheet") ? "workbook" : definition.mimeType === "application/pdf" ? "pdf" : definition.mimeType.includes("wordprocessing") ? "docx" : "image";
    fixtures[key] = { ...definition, path };
  }
  return { fixtures, token, directory };
}
