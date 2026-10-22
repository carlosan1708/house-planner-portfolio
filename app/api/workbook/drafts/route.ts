import { currencyFromNumberFormat, isProjectCurrency } from "@/lib/currency";
import { lockProjectCurrency } from "@/lib/project-currency";
import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireTabAccess } from "@/lib/auth";
import { firestore, projectBucket } from "@/lib/firebase-admin";
import { APPROVALS, BUDGET_LINES, CONFIG, projectConfigDoc, projectScopedId, projectStoragePrefix, WORKBOOK_DRAFTS, WORKBOOK_VERSIONS } from "@/lib/project";
import { editorPayload, generatedEditorPayload, loadOfficialWorkbook, workbookConfig } from "@/lib/workbook-store";
import { prepareWorkbookPaymentChange } from "@/lib/expense-ledger";
import { applyUniverChanges, prepareBudgetRows, diffGeneratedUniverWorkbooks, diffUniverWorkbooks, loadWorkbook, readBudgetLines, UnsafeGeneratedWorkbookError, writeWorkbook, type UniverWorkbook, type WorkbookScope } from "@/lib/workbook";
import { canCommitWorkbookVersion, nextDraftRevision } from "@/lib/drafts";
import { appendActivity } from "@/lib/activity";
import { approvalChangeDetails } from "@/lib/approval-diff";
import { googleSyncMessage, syncAfterBudgetCommit } from "@/lib/google-budget";
import { completedUsageAction } from "@/lib/usage-actions";
import { loadProjectAuthorDisplay } from "@/lib/project-authors";

const draftObjectKey = (projectId: string, id: string, revision: number) => `${projectStoragePrefix(projectId)}/workbooks/drafts/${id}/revision-${revision}.json`;

function auditWorkbookChanges(changes: ReturnType<typeof diffUniverWorkbooks>, base: UniverWorkbook) {
  return approvalChangeDetails(changes, base).filter((change) => !change.calculated).map((change) => ({
    field: `${change.sheet} · ${change.rowLabel} · C${change.column}`,
    before: change.before?.value ?? null,
    after: change.after?.value ?? null,
    format: currencyFromNumberFormat(String(change.after?.numberFormat || change.before?.numberFormat || "")) === "USD" ? "currency_usd" as const : currencyFromNumberFormat(String(change.after?.numberFormat || change.before?.numberFormat || "")) === "CRC" ? "currency_crc" as const : typeof (change.after?.value ?? change.before?.value) === "number" ? "number" as const : "text" as const,
  }));
}

export async function GET(request: Request) {
  try { return await getDraft(request); }
  catch (error) { return NextResponse.json({ error: googleSyncMessage(error), code: "draft_read_failed" }, { status: 503 }); }
}

async function getDraft(request: Request) {
  const actor = await requireTabAccess("budget", ["admin", "editor"]); if (!actor) return NextResponse.json({ error: "Workbook editor access required" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  const authors = await loadProjectAuthorDisplay(actor.projectId);
  if (!id) {
    const snapshot = await firestore.collection(WORKBOOK_DRAFTS).where("projectId", "==", actor.projectId).where("createdByUid", "==", actor.uid).get();
    return NextResponse.json({ drafts: snapshot.docs.map((doc) => ({ id: doc.id, ...authors.redact(doc.data()), snapshotObjectKey: undefined })) });
  }
  const document = await firestore.collection(WORKBOOK_DRAFTS).doc(id).get(); const data = document.data();
  if (!document.exists || data?.projectId !== actor.projectId || (actor.role !== "admin" && data?.createdByUid !== actor.uid)) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  if (!projectBucket || !data?.snapshotObjectKey) return NextResponse.json({ error: "Draft snapshot unavailable" }, { status: 503 });
  const [bytes] = await projectBucket.file(data.snapshotObjectKey).download();
  return NextResponse.json({ draft: { id: document.id, ...authors.redact(data), snapshotObjectKey: undefined }, workbook: JSON.parse(bytes.toString("utf8")) });
}

export async function POST(request: Request) {
  try { return await mutateDraft(request); }
  catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "La solicitud de guardado llegó incompleta. Inténtalo de nuevo.", code: "invalid_json" }, { status: 400 });
    return NextResponse.json({ error: googleSyncMessage(error), code: "draft_operation_failed" }, { status: 409 });
  }
}

async function mutateDraft(request: Request) {
  const actor = await requireTabAccess("budget", ["admin", "editor"]); if (!actor) return NextResponse.json({ error: "Workbook editor access required" }, { status: 403 });
  if (!projectBucket) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });
  const body = await request.json() as { action?: string; id?: string; revision?: number; workbook?: UniverWorkbook; scope?: WorkbookScope; expectedCurrency?: unknown };
  if (body.action === "create") {
    if (body.expectedCurrency !== undefined && !isProjectCurrency(body.expectedCurrency)) return NextResponse.json({ error: "Invalid project currency" }, { status: 400 });
    const currency = await lockProjectCurrency(actor.projectId);
    if (body.expectedCurrency !== undefined && body.expectedCurrency !== currency) return NextResponse.json({ error: "Project currency changed. Refresh before opening a budget draft.", code: "currency_changed" }, { status: 409 });
    const scope = body.scope && ["chapter", "type", "subcategory"].includes(body.scope.key) && (body.scope.all || typeof body.scope.label === "string") ? body.scope : null;
    const config = await workbookConfig(actor.projectId); const payload = scope ? await generatedEditorPayload(actor.projectId, scope) : { ...(await editorPayload(actor.projectId)), rowMaps: null }; const ref = firestore.collection(WORKBOOK_DRAFTS).doc(); const key = draftObjectKey(actor.projectId, ref.id, 1);
    if (!payload.editingAllowed) return NextResponse.json({ error: "This workbook contains unsupported content and cannot be edited safely" }, { status: 422 });
    await projectBucket.file(key).save(JSON.stringify(payload.workbook), { contentType: "application/json", resumable: false });
    await ref.set({ projectId: actor.projectId, status: "editing", revision: 1, basePlanVersion: config.planVersion, baseActualsRevision: config.actualsRevision, snapshotObjectKey: key, scope, rowMaps: payload.rowMaps, createdByUid: actor.uid, createdBy: actor.email, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    return NextResponse.json({ id: ref.id, revision: 1, workbook: payload.workbook, rowMaps: payload.rowMaps }, { status: 201 });
  }
  if (!body.id) return NextResponse.json({ error: "Draft id is required" }, { status: 400 });
  const draftId = body.id; const ref = firestore.collection(WORKBOOK_DRAFTS).doc(draftId); const document = await ref.get(); const data = document.data();
  if (!document.exists || data?.projectId !== actor.projectId || (actor.role !== "admin" && data?.createdByUid !== actor.uid)) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  if (data?.googleOperation && Number(data.googleOperationExpires) > Date.now()) return NextResponse.json({ error: "Google editing operation in progress. Try again shortly." }, { status: 409 });
  if (body.action === "save") {
    if (!body.workbook || !Number.isInteger(body.revision)) return NextResponse.json({ error: "Workbook and revision are required" }, { status: 400 });
    const nextRevision = Number(body.revision) + 1; const key = `${projectStoragePrefix(actor.projectId)}/workbooks/drafts/${draftId}/revision-${nextRevision}-${randomUUID()}.json`;
    await projectBucket.file(key).save(JSON.stringify(body.workbook), { contentType: "application/json", resumable: false });
    try { await firestore.runTransaction(async (transaction) => { const fresh = await transaction.get(ref); if (fresh.data()?.googleOperation && Number(fresh.data()?.googleOperationExpires) > Date.now()) throw new Error("Google editing in progress"); const check = nextDraftRevision(Number(fresh.data()?.revision || 0), Number(body.revision), String(fresh.data()?.status || "")); if (!check.ok) throw new Error(check.reason); transaction.update(ref, { revision: nextRevision, snapshotObjectKey: key, updatedAt: FieldValue.serverTimestamp() }); }); }
    catch { return NextResponse.json({ error: "Draft changed in another browser", code: "revision_conflict" }, { status: 409 }); }
    await completedUsageAction(actor, "budget.save", "budget", `draft:${draftId}:${nextRevision}`);
    return NextResponse.json({ revision: nextRevision });
  }
  if (body.action === "publish") {
    if (actor.role !== "admin") return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
    if (data?.status !== "editing" || !data.snapshotObjectKey) return NextResponse.json({ error: "Workbook is not editable" }, { status: 409 });
    const config = await workbookConfig(actor.projectId);
    if (config.planVersion !== Number(data.basePlanVersion)) return NextResponse.json({ error: "The official plan changed after editing began. Reopen the workbook.", code: "stale_base" }, { status: 409 });
    const [baseBytes, snapshotBytes] = await Promise.all([projectBucket.file(draftObjectKey(actor.projectId, draftId, 1)).download(), projectBucket.file(String(data.snapshotObjectKey)).download()]);
    const baseSnapshot = JSON.parse(baseBytes[0].toString("utf8")) as UniverWorkbook;
    const currentSnapshot = JSON.parse(snapshotBytes[0].toString("utf8")) as UniverWorkbook;
    const changes = diffUniverWorkbooks(baseSnapshot, currentSnapshot);
    if (!changes.length) return NextResponse.json({ error: "There are no workbook changes to publish", code: "no_changes" }, { status: 422 });
    const { workbook } = await loadOfficialWorkbook(actor.projectId, { legacyOverrides: true });
    const baseline = await loadWorkbook(await writeWorkbook(workbook));
    const rowMaps = data.rowMaps as Record<string, Record<number, number>> | null;
    let promotedChanges: ReturnType<typeof diffUniverWorkbooks>;
    try {
      promotedChanges = rowMaps ? diffGeneratedUniverWorkbooks(baseSnapshot, currentSnapshot, rowMaps, prepareBudgetRows(workbook, baseSnapshot, currentSnapshot)) : changes;
    } catch (error) {
      if (error instanceof UnsafeGeneratedWorkbookError) return NextResponse.json({ error: error.message, code: "unsafe_generated_snapshot" }, { status: 422 });
      throw error;
    }
    if (!promotedChanges.length) return NextResponse.json({ error: "There are no workbook changes to publish", code: "no_changes" }, { status: 422 });
    applyUniverChanges(workbook, promotedChanges);
    let paymentChange: Awaited<ReturnType<typeof prepareWorkbookPaymentChange>>;
    try { paymentChange = await prepareWorkbookPaymentChange(actor.projectId, baseline, workbook); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo conciliar el pagado histórico", code: "historical_paid_protected" }, { status: 422 }); }
    const planVersion = config.planVersion + 1; const objectKey = `${projectStoragePrefix(actor.projectId)}/workbooks/versions/plan-${planVersion}-actuals-${config.actualsRevision}-${randomUUID()}.xlsx`;
    await projectBucket.file(objectKey).save(await writeWorkbook(workbook), { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { metadata: { kind: "admin_publish", draftId, planVersion: String(planVersion) } } });
    const lines = readBudgetLines(workbook);
    const auditChanges = auditWorkbookChanges(promotedChanges, baseSnapshot);
    const detailObjectKey = `${projectStoragePrefix(actor.projectId)}/activity-details/budget-publish-${draftId}-${planVersion}-${randomUUID()}.json`;
    if (auditChanges.length > 80) await projectBucket.file(detailObjectKey).save(JSON.stringify(auditChanges), { contentType: "application/json", resumable: false });
    let activityId = "";
    try {
      activityId = await firestore.runTransaction(async (transaction) => {
        const configRef = firestore.collection(CONFIG).doc(projectConfigDoc(actor.projectId)); const [freshDraft, freshConfig] = await Promise.all([transaction.get(ref), transaction.get(configRef)]);
        if ((freshDraft.data()?.googleOperation && Number(freshDraft.data()?.googleOperationExpires) > Date.now()) || freshDraft.data()?.status !== "editing" || freshDraft.data()?.snapshotObjectKey !== data.snapshotObjectKey) throw new Error("Draft changed while publishing");
        const currentPlanVersion = Number(freshConfig.data()?.workbookPlanVersion || 1); const actualsRevision = Number(freshConfig.data()?.workbookActualsRevision || 0);
        if (!canCommitWorkbookVersion(config.planVersion, currentPlanVersion, config.actualsRevision, actualsRevision)) throw new Error("Official workbook changed while publishing");
        await paymentChange.validate(transaction);
        const activity = await appendActivity(transaction, actor, {
          category: "budget", action: "budget.published", source: data.source === "assistant" ? "assistant" : "user",
          target: { type: "workbook", id: draftId, label: `Plan ${planVersion}`, section: "budget" },
          summaryParams: { planVersion, changeCount: auditChanges.length }, changes: auditChanges, changeCount: auditChanges.length,
          detailsObjectKey: auditChanges.length > 80 ? detailObjectKey : null,
        });
        transaction.set(firestore.collection(WORKBOOK_VERSIONS).doc(), { projectId: actor.projectId, kind: "admin_publish", planVersion, actualsRevision, objectKey, draftId, createdBy: actor.email, createdAt: FieldValue.serverTimestamp() });
        transaction.set(configRef, { projectId: actor.projectId, workbookObjectKey: objectKey, workbookPlanVersion: planVersion, workbookUpdatedBy: actor.email, workbookUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
        paymentChange.write(transaction);
        for (const line of lines) transaction.set(firestore.collection(BUDGET_LINES).doc(projectScopedId(actor.projectId, line.id)), { projectId: actor.projectId, ...line, planVersion, actualsRevision, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        transaction.update(ref, { status: "published", changeCount: promotedChanges.length, publishedAt: FieldValue.serverTimestamp(), publishedBy: actor.email, updatedAt: FieldValue.serverTimestamp() });
        return activity.id;
      });
    } catch {
      await projectBucket.file(objectKey).delete({ ignoreNotFound: true }).catch(() => undefined);
      if (auditChanges.length > 80) await projectBucket.file(detailObjectKey).delete({ ignoreNotFound: true }).catch(() => undefined);
      return NextResponse.json({ error: "The workbook changed while publishing. Reopen it and try again.", code: "publish_conflict" }, { status: 409 });
    }
    await completedUsageAction(actor, "budget.publish", "budget", activityId);
    return NextResponse.json({ status: "published", planVersion, changeCount: promotedChanges.length, ...await syncAfterBudgetCommit(actor.projectId) });
  }
  if (body.action === "submit") {
    if (actor.role === "admin") return NextResponse.json({ error: "Administrators publish changes directly" }, { status: 400 });
    if (data?.status !== "editing") return NextResponse.json({ error: "Draft is not editable" }, { status: 409 });
    const [baseBytes, draftBytes] = await Promise.all([projectBucket.file(draftObjectKey(actor.projectId, draftId, 1)).download(), projectBucket.file(String(data.snapshotObjectKey)).download()]);
    const baseSnapshot = JSON.parse(baseBytes[0].toString("utf8")) as UniverWorkbook;
    const draftSnapshot = JSON.parse(draftBytes[0].toString("utf8")) as UniverWorkbook;
    const changes = diffUniverWorkbooks(baseSnapshot, draftSnapshot);
    if (!changes.length) return NextResponse.json({ error: "There are no workbook changes to submit", code: "no_changes" }, { status: 422 });
    const diffObjectKey = `${projectStoragePrefix(actor.projectId)}/workbooks/drafts/${draftId}/approval-diff.json`;
    await projectBucket.file(diffObjectKey).save(JSON.stringify(changes), { contentType: "application/json", resumable: false });
    const approval = firestore.collection(APPROVALS).doc();
    const auditChanges = auditWorkbookChanges(changes, baseSnapshot);
    let activityId = "";
    try {
      activityId = await firestore.runTransaction(async (transaction) => {
        const fresh = await transaction.get(ref);
        if ((fresh.data()?.googleOperation && Number(fresh.data()?.googleOperationExpires) > Date.now()) || fresh.data()?.status !== "editing" || fresh.data()?.revision !== data.revision || fresh.data()?.snapshotObjectKey !== data.snapshotObjectKey) throw new Error("Draft changed while submitting");
        const activity = await appendActivity(transaction, actor, {
          category: "budget", action: "budget.submitted", source: data.source === "assistant" ? "assistant" : "user",
          target: { type: "approval", id: approval.id, label: `Workbook draft #${draftId.slice(0, 8)}`, section: "approvals" },
          summaryParams: { changeCount: auditChanges.length }, changes: auditChanges, changeCount: auditChanges.length,
          detailsObjectKey: auditChanges.length > 80 ? diffObjectKey : null,
        });
        transaction.update(ref, { status: "submitted", diffObjectKey, changeCount: changes.length, submittedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
        transaction.set(approval, { projectId: actor.projectId, kind: "workbook_draft", title: `Workbook draft #${draftId.slice(0, 8)} · ${changes.length} cell change${changes.length === 1 ? "" : "s"}`, payload: { draftId, basePlanVersion: data.basePlanVersion, revision: data.revision, changeCount: changes.length, preview: changes.slice(0, 40) }, status: "pending", requestedBy: actor.email, createdAt: FieldValue.serverTimestamp() });
        return activity.id;
      });
    } catch { return NextResponse.json({ error: "The draft changed while submitting. Wait for saving to finish and try again.", code: "submit_conflict" }, { status: 409 }); }
    await completedUsageAction(actor, "budget.submit", "approvals", activityId);
    return NextResponse.json({ status: "submitted", approvalId: approval.id }, { status: 202 });
  }
  return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
}
