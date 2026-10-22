import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireApproved, requireTabAccess } from "@/lib/auth";
import { firestore, projectBucket } from "@/lib/firebase-admin";
import { CONFIG, projectConfigDoc, projectStoragePrefix, WORKBOOK_VERSIONS } from "@/lib/project";
import { loadWorkbook, scanUnsupportedFeatures, setWorkbookCurrency, writeWorkbook } from "@/lib/workbook";
import { readProjectCurrency, lockProjectCurrency } from "@/lib/project-currency";
import { getWorkbookPayments, workbookConfig } from "@/lib/workbook-store";
import { addPaymentWorkbookProjection, containsPaymentWorkbookProjection, PAYMENT_PROJECTION_VERSION, UNIFIED_PAYMENT_PROJECTION_VERSION, restoreHistoricalWorkbookPaid, stripUnifiedPaymentWorkbookProjection } from "@/lib/payment-workbook";
import { prepareWorkbookPaymentChange } from "@/lib/expense-ledger";
import { appendActivity } from "@/lib/activity";
import { googleBudgetRef, syncAfterBudgetCommit } from "@/lib/google-budget";
import { consolidatedWorkbook } from "@/lib/consolidated-workbook";
import { completedUsageAction } from "@/lib/usage-actions";

export async function GET(request: Request) {
  const actor = await requireTabAccess("budget");
  if (!actor) return NextResponse.json({ error: "Workbook access required" }, { status: 403 });
  if (!projectBucket) return NextResponse.json({ error: "Storage is unavailable" }, { status: 503 });
  const localOnly = new URL(request.url).searchParams.get("source") === "local";
  const local = localOnly ? (await firestore.collection(CONFIG).doc(projectConfigDoc(actor.projectId)).get()).data() : null;
  const config = local ? { objectKey: String(local.workbookObjectKey), fileName: String(local.workbookFileName || "Presupuesto.xlsx"), paymentsModelVersion: Number(local.paymentsModelVersion || 1), paymentLedgerRevision: Number(local.paymentLedgerRevision || 0) } : await workbookConfig(actor.projectId);
  const currency = await readProjectCurrency(actor.projectId);
  const [exists] = await projectBucket.file(config.objectKey).exists();
  if (!exists) return NextResponse.json({ error: "Workbook not found" }, { status: 404 });
  const [storedBytes] = await projectBucket.file(config.objectKey).download();
  const unsupported = await scanUnsupportedFeatures(storedBytes);
  let bytes = storedBytes;
  if (!unsupported.length) {
    const workbook = await loadWorkbook(await consolidatedWorkbook(storedBytes, false, undefined, currency));
    addPaymentWorkbookProjection(workbook, await getWorkbookPayments(actor.projectId), { includePaymentDetails: actor.role === "admin" || actor.permissions?.expenses === true, paymentsModelVersion: config.paymentsModelVersion, paymentLedgerRevision: config.paymentLedgerRevision, currency });
    const stamp = workbook.getWorksheet("_HousePlannerOffline") || workbook.addWorksheet("_HousePlannerOffline", { state: "veryHidden" });
    stamp.getCell("A1").value = actor.projectId; stamp.getCell("B1").value = config.objectKey;
    stamp.getCell("C1").value = config.paymentsModelVersion === 2 ? UNIFIED_PAYMENT_PROJECTION_VERSION : PAYMENT_PROJECTION_VERSION;
    bytes = await writeWorkbook(workbook);
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(config.fileName)}`,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function POST(request: Request) {
  const actor = await requireApproved(["admin"]);
  if (!actor) return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  if (!projectBucket) return NextResponse.json({ error: "Storage is unavailable" }, { status: 503 });
  let before: Awaited<ReturnType<typeof workbookConfig>>;
  try { before = await workbookConfig(actor.projectId); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Sincronización pendiente" }, { status: 409 }); }
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !/\.xlsx$/i.test(file.name)) return NextResponse.json({ error: "An .xlsx file is required" }, { status: 400 });
  if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: "Files are limited to 25 MB" }, { status: 413 });
  const originalBytes = Buffer.from(await file.arrayBuffer());
  const unsupported = await scanUnsupportedFeatures(originalBytes);
  const currency = await lockProjectCurrency(actor.projectId);
  if (unsupported.length && currency === "USD") return NextResponse.json({ error: "This workbook contains features that prevent safe USD formatting. Upload a compatible workbook." }, { status: 422 });
  let bytes = originalBytes;
  const linked = Boolean((await googleBudgetRef(actor.projectId).get()).data()?.fileId);
  if (linked && file.size > 5 * 1024 * 1024) return NextResponse.json({ error: "La sincronización con Google admite archivos de hasta 5 MB." }, { status: 413 });
  if (linked && unsupported.length) return NextResponse.json({ error: "Este archivo contiene funciones que no se pueden sincronizar con Google Sheets." }, { status: 422 });
  const payments = await getWorkbookPayments(actor.projectId);
  let paymentChange: Awaited<ReturnType<typeof prepareWorkbookPaymentChange>> | null = null;
  if (unsupported.length && (before.paymentsModelVersion === 2 || payments.some((payment) => !payment.deletedAt && payment.accountingMode === "ledger") || await containsPaymentWorkbookProjection(originalBytes)))
    return NextResponse.json({ error: "Este archivo contiene funciones que impiden conciliar sus pagos de forma segura. Descargá una copia compatible del presupuesto actual antes de subir cambios." }, { status: 422 });
  if (!unsupported.length) {
    const workbook = await loadWorkbook(originalBytes);
    setWorkbookCurrency(workbook, currency);
    const stamp = workbook.getWorksheet("_HousePlannerOffline");
    if (stamp && (stamp.getCell("A1").text !== actor.projectId || stamp.getCell("B1").text !== before.objectKey)) return NextResponse.json({ error: "El presupuesto cambió desde la descarga. Descarga la versión actual y concilia tus cambios sin conexión antes de subirla." }, { status: 409 });
    // Restore the historical baseline before a projected download becomes the source again.
    // Downloaded offline copies need stable row identities even without Google.
    try {
      const [baselineBytes] = await projectBucket.file(before.objectKey).download();
      const normalized = linked || Boolean(stamp) || payments.some((payment) => !payment.deletedAt && payment.accountingMode === "ledger")
        ? await loadWorkbook(await consolidatedWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), true, baselineBytes, currency))
        : workbook;
      const baseline = await loadWorkbook(baselineBytes);
      setWorkbookCurrency(baseline, currency);
      if (before.paymentsModelVersion === 2)
        stripUnifiedPaymentWorkbookProjection(normalized, baseline, payments, before.paymentLedgerRevision);
      else if (stamp?.getCell("C1").text === PAYMENT_PROJECTION_VERSION)
        restoreHistoricalWorkbookPaid(normalized, await loadWorkbook(await consolidatedWorkbook(baselineBytes, false, undefined, currency)), payments);
      else if (normalized.getWorksheet("_HousePlannerPayments"))
        return NextResponse.json({ error: "El resumen de pagos perdió su identificación. Descargá el presupuesto actual antes de editarlo." }, { status: 422 });
      paymentChange = await prepareWorkbookPaymentChange(actor.projectId, baseline, normalized);
      const offlineStamp = normalized.getWorksheet("_HousePlannerOffline");
      if (offlineStamp) normalized.removeWorksheet(offlineStamp.id);
      bytes = await writeWorkbook(normalized, currency);
    }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Archivo inválido" }, { status: 422 }); }
  }
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const objectKey = `${projectStoragePrefix(actor.projectId)}/workbooks/${randomUUID()}-${safeName}`;
  await projectBucket.file(objectKey).save(bytes, {
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    metadata: { metadata: { uploadedBy: actor.email, originalName: file.name } },
    resumable: false,
    preconditionOpts: { ifGenerationMatch: 0 },
  });
  const configRef = firestore.collection(CONFIG).doc(projectConfigDoc(actor.projectId));
  let activityId = "";
  try {
    activityId = await firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(configRef); const planVersion = Number(current.data()?.workbookPlanVersion || 1) + 1; const actualsRevision = Number(current.data()?.workbookActualsRevision || 0);
      if (current.data()?.workbookObjectKey !== before.objectKey) throw new Error("El presupuesto cambió durante la carga. Inténtalo de nuevo.");
      await paymentChange?.validate(transaction);
      const activity = await appendActivity(transaction, actor, {
        category: "budget", action: "budget.replaced",
        target: { type: "workbook", id: String(planVersion), label: file.name, section: "budget" },
        summaryParams: { unsupportedCount: unsupported.length },
        changes: [
          { field: "fileName", before: String(current.data()?.workbookFileName || ""), after: file.name, format: "text" },
          { field: "planVersion", before: planVersion - 1, after: planVersion, format: "number" },
        ],
      });
      transaction.set(firestore.collection(WORKBOOK_VERSIONS).doc(), { projectId: actor.projectId, kind: "owner_replacement", planVersion, actualsRevision, objectKey, unsupported, createdBy: actor.email, createdAt: FieldValue.serverTimestamp() });
      transaction.set(configRef, { projectId: actor.projectId, workbookObjectKey: objectKey, workbookFileName: file.name, workbookPlanVersion: planVersion, workbookUnsupported: unsupported, workbookUpdatedBy: actor.email, workbookUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
      paymentChange?.write(transaction);
      return activity.id;
    });
  } catch (error) {
    await projectBucket.file(objectKey).delete({ ignoreNotFound: true }).catch(() => undefined);
    throw error;
  }
  await completedUsageAction(actor, "file.upload", "budget", activityId);
  return NextResponse.json({ ok: true, fileName: file.name, unsupported, editingAllowed: unsupported.length === 0, ...await syncAfterBudgetCommit(actor.projectId) });
}
