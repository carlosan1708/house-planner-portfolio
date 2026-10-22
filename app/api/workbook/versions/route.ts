import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireApproved, requireTabAccess } from "@/lib/auth";
import { firestore, projectBucket } from "@/lib/firebase-admin";
import { CONFIG, projectConfigDoc, projectStoragePrefix, WORKBOOK_VERSIONS } from "@/lib/project";
import { loadWorkbook, setWorkbookCurrency, writeWorkbook } from "@/lib/workbook";
import { loadOfficialWorkbook } from "@/lib/workbook-store";
import { prepareWorkbookPaymentChange } from "@/lib/expense-ledger";
import { appendActivity } from "@/lib/activity";
import { syncAfterBudgetCommit } from "@/lib/google-budget";
import { completedUsageAction } from "@/lib/usage-actions";
import { loadProjectAuthorDisplay } from "@/lib/project-authors";

export async function GET() {
  const actor = await requireTabAccess("budget"); if (!actor) return NextResponse.json({ error: "Budget access required" }, { status: 403 });
  const snapshot = await firestore.collection(WORKBOOK_VERSIONS).where("projectId", "==", actor.projectId).get();
  const authors = await loadProjectAuthorDisplay(actor.projectId);
  const versions = snapshot.docs.map((document) => { const data = authors.redact(document.data()); return { id: document.id, kind: data.kind, planVersion: data.planVersion, actualsRevision: data.actualsRevision, createdBy: data.createdBy, createdAt: data.createdAt?.toDate?.().toISOString() || null }; }).sort((a, b) => Number(b.planVersion) - Number(a.planVersion) || Number(b.actualsRevision) - Number(a.actualsRevision));
  return NextResponse.json({ versions });
}

export async function POST(request: Request) {
  const actor = await requireApproved(["admin"]); if (!actor) return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  if (!projectBucket) return NextResponse.json({ error: "Storage is unavailable" }, { status: 503 });
  const body = await request.json() as { versionId?: string }; if (!body.versionId) return NextResponse.json({ error: "Version is required" }, { status: 400 });
  const source = await firestore.collection(WORKBOOK_VERSIONS).doc(body.versionId).get(); const data = source.data(); if (!source.exists || data?.projectId !== actor.projectId || !data.objectKey) return NextResponse.json({ error: "Version not found" }, { status: 404 });
  const [sourceBytes] = await projectBucket.file(data.objectKey).download(); const workbook = await loadWorkbook(sourceBytes);
  const { workbook: currentWorkbook, config } = await loadOfficialWorkbook(actor.projectId, { legacyOverrides: true });
  setWorkbookCurrency(workbook, config.currency);
  let paymentChange: Awaited<ReturnType<typeof prepareWorkbookPaymentChange>>;
  try { paymentChange = await prepareWorkbookPaymentChange(actor.projectId, currentWorkbook, workbook, { restorePlanOnly: true }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo conciliar el pagado histórico", code: "historical_paid_protected" }, { status: 422 }); }
  const bytes = await writeWorkbook(workbook); const planVersion = config.planVersion + 1; const objectKey = `${projectStoragePrefix(actor.projectId)}/workbooks/versions/plan-${planVersion}-actuals-${config.actualsRevision}-rollback-${randomUUID()}.xlsx`;
  await projectBucket.file(objectKey).save(bytes, { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { metadata: { kind: "rollback", sourceVersionId: source.id } } });
  let activityId = "";
  try { activityId = await firestore.runTransaction(async (transaction) => {
    const configRef = firestore.collection(CONFIG).doc(projectConfigDoc(actor.projectId));
    const latest = await transaction.get(configRef);
    if (Number(latest.data()?.workbookPlanVersion || 1) !== config.planVersion) throw new Error("Official plan changed during rollback");
    await paymentChange.validate(transaction);
    const activity = await appendActivity(transaction, actor, {
      category: "budget", action: "budget.restored",
      target: { type: "workbook", id: source.id, label: `Plan ${data.planVersion || source.id}`, section: "budget" },
      summaryParams: { sourcePlanVersion: Number(data.planVersion || 0), planVersion },
      changes: [{ field: "planVersion", before: config.planVersion, after: planVersion, format: "number" }],
    });
    transaction.set(firestore.collection(WORKBOOK_VERSIONS).doc(), { projectId: actor.projectId, kind: "rollback", sourceVersionId: source.id, planVersion, actualsRevision: config.actualsRevision, objectKey, createdBy: actor.email, createdAt: FieldValue.serverTimestamp() });
    transaction.set(configRef, { projectId: actor.projectId, workbookObjectKey: objectKey, workbookPlanVersion: planVersion, workbookUpdatedBy: actor.email, workbookUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
    paymentChange.write(transaction);
    return activity.id;
  }); } catch (error) {
    await projectBucket.file(objectKey).delete({ ignoreNotFound: true }).catch(() => undefined);
    throw error;
  }
  await completedUsageAction(actor, "budget.restore", "budget", activityId);
  return NextResponse.json({ ok: true, planVersion, ...await syncAfterBudgetCommit(actor.projectId) });
}
