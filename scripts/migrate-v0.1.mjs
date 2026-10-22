import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

async function main() {
const projectId = process.env.GOOGLE_CLOUD_PROJECT || "example-house-planner";
const bucketName = process.env.HOUSE_PLANNER_BUCKET;
if (!bucketName) throw new Error("HOUSE_PLANNER_BUCKET is required");
const app = getApps()[0] || initializeApp({ credential: applicationDefault(), projectId, storageBucket: bucketName });
const db = getFirestore(app); const bucket = getStorage(app).bucket(bucketName); const project = "sample-house";
const configRef = db.collection("housePlannerConfig").doc("production"); const current = await configRef.get();
if (current.data()?.migrationV010At) { console.log("v0.1.0 migration already completed; no changes made."); process.exit(0); }

const approvals = await db.collection("housePlannerApprovals").where("projectId", "==", project).get();
const pendingWorkbook = approvals.docs.filter((document) => document.data().status === "pending" && String(document.data().kind || "").startsWith("workbook"));
if (pendingWorkbook.length) throw new Error(`Migration stopped: ${pendingWorkbook.length} workbook approval(s) are pending.`);

const legacyObjectKey = String(current.data()?.workbookObjectKey || "house-planner/production/workbooks/synthetic-budget.xlsx");
const fileName = String(current.data()?.workbookFileName || "synthetic-budget.xlsx");
const [source] = await bucket.file(legacyObjectKey).download(); const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(source);
const overrides = await db.collection("housePlannerWorkbookOverrides").where("projectId", "==", project).get();
for (const document of overrides.docs) { const value = document.data(); const sheet = workbook.getWorksheet(value.sheetName); if (sheet) sheet.getCell(Number(value.rowIndex) + 1, Number(value.columnIndex) + 1).value = value.value ?? null; }

const budget = workbook.getWorksheet("Presupuesto"); if (!budget) throw new Error("Presupuesto sheet is missing");
let mapping = workbook.getWorksheet("_HousePlanner"); if (!mapping) mapping = workbook.addWorksheet("_HousePlanner", { state: "veryHidden" }); mapping.state = "veryHidden";
mapping.getRow(1).values = ["Version", "1"]; mapping.getRow(2).values = ["Budget line UUID", "Sheet", "Row", "Chapter", "Item", "Fingerprint"];
if (mapping.rowCount > 2) mapping.spliceRows(3, mapping.rowCount - 2);
const lines = []; let mappingRow = 3;
for (let row = 4; row <= budget.rowCount; row += 1) {
  const chapter = String(budget.getCell(row, 1).text || "").trim(); const item = String(budget.getCell(row, 2).text || "").trim();
  if (!chapter || !item || /^TOTAL/i.test(chapter)) continue;
  const fingerprint = `${chapter}\u241f${item}\u241f${row}`; const id = createHash("sha256").update(fingerprint).digest("hex").slice(0, 24);
  mapping.getRow(mappingRow).values = [id, "Presupuesto", row, chapter, item, fingerprint]; mappingRow += 1;
  const objective = Number(budget.getCell(row, 5).value || 0); const quote = Number(budget.getCell(row, 7).value || 0); const paid = Number(budget.getCell(row, 15).value || 0);
  lines.push({ id, row, chapter, item, type: budget.getCell(row, 3).text, subcategory: budget.getCell(row, 4).text, objective, excess: Math.max(0, (paid || quote) - objective), quote, paid, supplier: budget.getCell(row, 16).text, status: budget.getCell(row, 14).text });
}
if (lines.length !== 89) throw new Error(`Migration stopped: expected 89 budget lines, found ${lines.length}.`);
const bytes = Buffer.from(await workbook.xlsx.writeBuffer()); const objectKey = "house-planner/production/workbooks/versions/plan-1-actuals-0.xlsx";
await bucket.file(objectKey).save(bytes, { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", resumable: false, metadata: { metadata: { kind: "v0.1.0_baseline", legacyOverridesApplied: "true" } } });
const batch = db.batch();
for (const line of lines) batch.set(db.collection("housePlannerBudgetLines").doc(line.id), { projectId: project, ...line, planVersion: 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
batch.set(db.collection("housePlannerWorkbookVersions").doc(), { projectId: project, kind: "v0.1.0_baseline", planVersion: 1, actualsRevision: 0, objectKey, legacyObjectKey, createdBy: "migration-v0.1.0", createdAt: FieldValue.serverTimestamp() });
batch.set(configRef, { workbookObjectKey: objectKey, workbookFileName: fileName, workbookPlanVersion: 1, workbookActualsRevision: 0, migrationV010At: FieldValue.serverTimestamp(), migrationV010LegacyObjectKey: legacyObjectKey, workbookUpdatedBy: "migration-v0.1.0", workbookUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
await batch.commit(); console.log(`Migrated ${lines.length} budget lines to ${objectKey}. Legacy overrides were applied and preserved.`);
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
