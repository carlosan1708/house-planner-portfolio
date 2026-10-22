/** Bundle with esbuild into .qa-tools before use. No network access in plan mode. */
import { readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { planPaymentMigration } from "../lib/payment-migration";
import { loadWorkbook, readBudgetLines, scanUnsupportedFeatures, setWorkbookCurrency, writeWorkbook } from "../lib/workbook";
import { addPaymentWorkbookProjection } from "../lib/payment-workbook";
import { projectCurrency } from "../lib/currency";

const argument = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) || "";
async function main() {
const inputPath = argument("snapshot");
if (!inputPath) throw new Error("Provide --snapshot=<private reviewed snapshot.json>");
type Snapshot = Parameters<typeof planPaymentMigration>[0] & { workbookPath: string; cloudProjectId: string; storageBucket: string };
const snapshot = JSON.parse(await readFile(inputPath, "utf8")) as Snapshot;
snapshot.currency = projectCurrency(snapshot.currency);
const bytes = await readFile(snapshot.workbookPath);
if ((await scanUnsupportedFeatures(bytes)).length) throw new Error("The source contains unsupported features; do not rewrite it during migration");
if (createHash("sha256").update(bytes).digest("hex") !== snapshot.source.sha256) throw new Error("The offline workbook does not match the reviewed snapshot");
const lineSnapshot = (lines: ReturnType<typeof readBudgetLines>) => lines.map(({ id, item, paid, outsideObjective }) => ({ id, item, paid, outsideObjective: outsideObjective === true }));
const original = await loadWorkbook(bytes);
setWorkbookCurrency(original, snapshot.currency);
snapshot.lines = lineSnapshot(readBudgetLines(original));
const plan = planPaymentMigration(snapshot);
const approval = argument("apply");
if (!approval) {
  const output = argument("output");
  if (!output) throw new Error("Plan mode requires --output=<private manifest.json>");
  await writeFile(output, JSON.stringify(plan, null, 2));
  process.stdout.write(JSON.stringify({ mode: "offline-plan", manifestSha256: plan.manifestSha256, recordsRetained: plan.preservedPaymentIds.length, imports: plan.imports.length, totals: plan.totals }) + "\n");
} else {
  if (approval !== plan.manifestSha256 || !/^gs:\/\/.+\/backups\//.test(argument("backup")) || !/^[a-f0-9]{40}$/.test(argument("release")) || !argument("operator"))
    throw new Error("Apply requires the exact reviewed manifest SHA, verified backup URI, compatible release commit and operator identity");
  if (!snapshot.cloudProjectId || !snapshot.storageBucket || plan.imports.length > 350) throw new Error("Invalid migration target or too many writes for one atomic activation");
  // Credentials are loaded only after every explicit apply guard succeeds.
  const [{ applicationDefault, initializeApp }, { getFirestore, FieldValue }, { getStorage }] = await Promise.all([
    import("firebase-admin/app"), import("firebase-admin/firestore"), import("firebase-admin/storage"),
  ]);
  const app = initializeApp({ projectId: snapshot.cloudProjectId, storageBucket: snapshot.storageBucket, credential: applicationDefault() });
  const db = getFirestore(app), bucket = getStorage(app).bucket(snapshot.storageBucket);
  const { CONFIG, EXPENSE_PAYMENTS, PROJECTS, WORKBOOK_VERSIONS, projectConfigDoc, projectStoragePrefix } = await import("../lib/project");
  const configRef = db.collection(CONFIG).doc(projectConfigDoc(snapshot.projectId));
  const projectRef = db.collection(PROJECTS).doc(snapshot.projectId);
  if (projectCurrency((await projectRef.get()).data()?.currency) !== snapshot.currency) throw new Error("The project currency changed; regenerate and review the migration");
  const [sourceMetadata] = await bucket.file(snapshot.source.objectKey).getMetadata();
  if (String(sourceMetadata.generation) !== snapshot.source.generation) throw new Error("The source generation is no longer current");
  const sourceFile = bucket.file(snapshot.source.objectKey, { generation: snapshot.source.generation });
  const [liveBytes] = await sourceFile.download();
  if (createHash("sha256").update(liveBytes).digest("hex") !== snapshot.source.sha256) throw new Error("The reviewed source generation changed");
  const normalize = (value: unknown): unknown => value && typeof value === "object" && "toDate" in value
    ? (value as { toDate(): Date }).toDate().toISOString() : Array.isArray(value) ? value.map(normalize)
      : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalize(child)])) : value;
  addPaymentWorkbookProjection(original, [...snapshot.payments, ...plan.imports], { paymentsModelVersion: 2, paymentLedgerRevision: 1, includePaymentDetails: false, currency: snapshot.currency });
  const objectKey = `${projectStoragePrefix(snapshot.projectId)}/workbooks/versions/payments-v2-${randomUUID()}.xlsx`;
  await bucket.file(objectKey).save(await writeWorkbook(original), { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", resumable: false, preconditionOpts: { ifGenerationMatch: 0 } });
  // Keep an unreferenced immutable candidate if validation fails; never delete another attempt's recovery source.
  await db.runTransaction(async (transaction) => {
    const [configSnapshot, paymentsSnapshot, projectSnapshot] = await Promise.all([transaction.get(configRef), transaction.get(db.collection(EXPENSE_PAYMENTS).where("projectId", "==", snapshot.projectId)), transaction.get(projectRef)]);
    if (!projectSnapshot.exists || projectCurrency(projectSnapshot.data()?.currency) !== snapshot.currency) throw new Error("The project currency changed; regenerate and review the migration");
    const config = configSnapshot.data();
    if (config?.paymentsModelVersion === 2) throw new Error("The project has already been migrated; do not reapply");
    if (config?.workbookObjectKey !== snapshot.source.objectKey || Number(config?.workbookPlanVersion || 1) !== snapshot.source.planVersion || Number(config?.workbookActualsRevision || 0) !== snapshot.source.actualsRevision)
      throw new Error("The official workbook changed; regenerate and review the migration");
    const current = planPaymentMigration({ ...snapshot, payments: paymentsSnapshot.docs.map((document) => ({ ...(normalize(document.data()) as Record<string, unknown>), id: document.id })) });
    if (current.manifestSha256 !== approval) throw new Error("Payments or receipts changed; regenerate and review the migration");
    const { appendActivity } = await import("../lib/activity");
    await appendActivity(transaction, { uid: "payments-v2-migration", email: argument("operator"), name: "Migración de pagos", role: "admin", projectId: snapshot.projectId }, {
      category: "expense", action: "expense.payments_model_migrated", source: "system", target: { type: "workbook", id: plan.manifestSha256, label: "Pagos unificados", section: "expenses" },
      summaryParams: { retained: plan.preservedPaymentIds.length, imported: plan.imports.length, manifestSha256: plan.manifestSha256, release: argument("release"), backup: argument("backup") },
      changes: [{ field: "paid", before: plan.totals.legacyPaid, after: plan.totals.paid, format: snapshot.currency === "USD" ? "currency_usd" : "currency_crc" }],
    });
    for (const payment of plan.imports) transaction.create(db.collection(EXPENSE_PAYMENTS).doc(payment.id), { ...payment, createdBy: argument("operator"), updatedBy: argument("operator"), createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    transaction.set(projectRef, { currencyLocked: true }, { merge: true });
    transaction.set(configRef, { paymentsModelVersion: 2, paymentLedgerRevision: 1, paymentProjectionPending: true, paymentMigrationManifest: plan.manifestSha256,
      workbookObjectKey: objectKey, workbookPlanVersion: snapshot.source.planVersion + 1, workbookActualsRevision: snapshot.source.actualsRevision + 1,
      workbookUpdatedBy: argument("operator"), workbookUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
    transaction.create(db.collection(WORKBOOK_VERSIONS).doc(), { projectId: snapshot.projectId, kind: "payment_model_migration", objectKey,
      planVersion: snapshot.source.planVersion + 1, actualsRevision: snapshot.source.actualsRevision + 1, manifestSha256: plan.manifestSha256, backup: argument("backup"), createdAt: FieldValue.serverTimestamp() });
  });
  process.stdout.write(JSON.stringify({ mode: "applied", manifestSha256: plan.manifestSha256, objectKey, totals: plan.totals }) + "\n");
}
}
main().catch((error) => { process.stderr.write((error instanceof Error ? error.message : "Migration failed") + "\n"); process.exitCode = 1; });
