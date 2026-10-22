import { createHash } from "node:crypto";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const cloudProjectId = process.env.GOOGLE_CLOUD_PROJECT || "example-house-planner";
const targetProjectId = process.env.HOUSE_PLANNER_PROJECT_ID || "sample-house";
const apply = process.argv.includes("--apply");
const app = getApps()[0] || initializeApp({ credential: applicationDefault(), projectId: cloudProjectId });
const db = getFirestore(app);
const folders = await db.collection("housePlannerFolders").where("projectId", "==", targetProjectId).get();
const invoiceFolder = folders.docs.find((item) => item.data().parentId == null && String(item.data().name || "").trim().toLocaleLowerCase() === "factura");
if (!invoiceFolder) throw new Error(`Factura folder was not found for ${targetProjectId}`);

const [rawFiles, records] = await Promise.all([
  db.collection("housePlannerDocuments").where("projectId", "==", targetProjectId).get(),
  db.collection("housePlannerExpenseDocuments").where("projectId", "==", targetProjectId).get(),
]);
const wrapped = new Set(records.docs.flatMap((item) => Array.isArray(item.data().fileIds) ? item.data().fileIds : []));
const candidates = rawFiles.docs.filter((item) => !item.data().deletedAt && item.data().folderId === invoiceFolder.id && !wrapped.has(item.id));
const planned = candidates.map((file) => ({
  id: `legacy-${createHash("sha256").update(`${targetProjectId}\u241f${file.id}`).digest("hex").slice(0, 32)}`,
  fileId: file.id,
  title: String(file.data().fileName || "Comprobante").slice(0, 160),
}));

process.stdout.write(`${apply ? "Applying" : "Dry run:"} ${planned.length} Factura file wrapper(s) for ${targetProjectId}.\n`);
for (const item of planned) process.stdout.write(`- ${item.fileId} -> ${item.id} (${item.title})\n`);
if (!apply) {
  process.stdout.write("Run with --apply after a verified backup.\n");
  process.exit(0);
}

let batch = db.batch();
let count = 0;
for (const item of planned) {
  const file = rawFiles.docs.find((candidate) => candidate.id === item.fileId);
  const createdAt = file?.data().createdAt || FieldValue.serverTimestamp();
  batch.set(db.collection("housePlannerExpenseDocuments").doc(item.id), {
    projectId: targetProjectId,
    title: item.title,
    documentType: "invoice",
    documentDate: "",
    vendor: "",
    reference: "",
    notes: "",
    amount: null,
    currency: "CRC",
    purchaseId: null,
    purchaseTitle: "",
    budgetLineId: null,
    budgetLineLabel: "",
    fileIds: [item.fileId],
    createdBy: String(file?.data().uploadedBy || "migration"),
    createdAt,
    updatedBy: "migration",
    updatedAt: FieldValue.serverTimestamp(),
    deletedAt: null,
    migration: "legacy-factura-v1",
  }, { merge: false });
  batch.set(db.collection("housePlannerDocuments").doc(item.fileId), { expenseDocumentId: item.id, mediaRole: "financial_document", source: "expense_document", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  count += 2;
  if (count >= 400) { await batch.commit(); batch = db.batch(); count = 0; }
}
if (count) await batch.commit();

const verify = await db.collection("housePlannerExpenseDocuments").where("projectId", "==", targetProjectId).get();
const verifiedIds = new Set(verify.docs.filter((item) => !item.data().deletedAt).flatMap((item) => Array.isArray(item.data().fileIds) ? item.data().fileIds : []));
const missing = planned.filter((item) => !verifiedIds.has(item.fileId));
if (missing.length) throw new Error(`Migration verification failed for ${missing.map((item) => item.fileId).join(", ")}`);
process.stdout.write(`Migration verified: ${planned.length} wrapper(s), no files moved or copied.\n`);
