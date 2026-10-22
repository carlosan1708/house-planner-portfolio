import { currencyFromNumberFormat } from "@/lib/currency";
import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireApproved, requireTabAccess } from "@/lib/auth";
import { firestore, projectBucket } from "@/lib/firebase-admin";
import { APPROVALS, BUDGET_LINES, CONFIG, projectConfigDoc, projectScopedId, projectStoragePrefix, WORKBOOK_DRAFTS, WORKBOOK_VERSIONS } from "@/lib/project";
import { applyLegacyOverrides, applyUniverChanges, BUDGET_SHEET, prepareBudgetRows, diffGeneratedUniverWorkbooks, diffUniverWorkbooks, loadWorkbook, readBudgetLines, UnsafeGeneratedWorkbookError, writeWorkbook, type BudgetLine, type UniverWorkbook } from "@/lib/workbook";
import { loadOfficialWorkbook, workbookConfig } from "@/lib/workbook-store";
import { prepareWorkbookPaymentChange } from "@/lib/expense-ledger";
import { syncAfterBudgetCommit } from "@/lib/google-budget";
import { approvalChangeDetails } from "@/lib/approval-diff";
import { appendActivity } from "@/lib/activity";
import { completedUsageAction } from "@/lib/usage-actions";
import { loadProjectAuthorDisplay, type ProjectAuthorDisplay } from "@/lib/project-authors";

function approval(document: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot, authors: ProjectAuthorDisplay) {
  const data = authors.redact(document.data()!);
  const iso = (value: unknown) => typeof value === "object" && value && "toDate" in value
    ? (value as FirebaseFirestore.Timestamp).toDate().toISOString()
    : null;
  return {
    id: document.id,
    kind: data.kind,
    title: data.title,
    payload: JSON.stringify(data.payload || {}),
    status: data.status,
    requested_by: data.requestedBy,
    reviewed_by: data.reviewedBy || null,
    created_at: iso(data.createdAt) || new Date(0).toISOString(),
    reviewed_at: iso(data.reviewedAt),
  };
}

async function approvalWithDetails(document: FirebaseFirestore.QueryDocumentSnapshot, projectId: string, authors: ProjectAuthorDisplay) {
  const item = approval(document, authors);
  const data = document.data();
  if (data.kind !== "workbook_draft" || !projectBucket) return item;
  const draftId = String(data.payload?.draftId || "");
  if (!draftId) return item;
  try {
    const draft = await firestore.collection(WORKBOOK_DRAFTS).doc(draftId).get();
    if (draft.data()?.projectId !== projectId) return item;
    const diffObjectKey = String(draft.data()?.diffObjectKey || "");
    if (!diffObjectKey) return { ...item, change_count: Number(data.payload?.changeCount || 0), details_complete: false };
    const [diffBytes, baseBytes] = await Promise.all([
      projectBucket.file(diffObjectKey).download(),
      projectBucket.file(`${projectStoragePrefix(projectId)}/workbooks/drafts/${draftId}/revision-1.json`).download(),
    ]);
    const changes = JSON.parse(diffBytes[0].toString("utf8")) as ReturnType<typeof diffUniverWorkbooks>;
    const base = JSON.parse(baseBytes[0].toString("utf8")) as UniverWorkbook;
    return { ...item, change_count: changes.length, change_details: approvalChangeDetails(changes, base), details_complete: true };
  } catch {
    return { ...item, change_count: Number(data.payload?.changeCount || 0), details_complete: false };
  }
}

export async function GET() {
  const actor = await requireTabAccess("approvals");
  if (!actor) return NextResponse.json({ error: "Approvals access required" }, { status: 403 });
  const snapshot = await firestore.collection(APPROVALS).where("projectId", "==", actor.projectId).get();
  const authors = await loadProjectAuthorDisplay(actor.projectId);
  const items = (await Promise.all(snapshot.docs.map((document) => approvalWithDetails(document, actor.projectId, authors)))).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return NextResponse.json({ approvals: items });
}

export async function PATCH(request: Request) {
  const actor = await requireApproved(["admin"]);
  if (!actor) return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  const body = await request.json() as { id?: string; action?: "approved" | "rejected" };
  if (!body.id || !["approved", "rejected"].includes(body.action || "")) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const approvalId = body.id;
  const ref = firestore.collection(APPROVALS).doc(approvalId);
  const pending = await ref.get();
  if (!pending.exists || pending.data()?.projectId !== actor.projectId || pending.data()?.status !== "pending") return NextResponse.json({ error: "Approval is unavailable" }, { status: 409 });
  const pendingData = pending.data()!;
  let promoted: { objectKey: string; planVersion: number; draftId: string; lines: BudgetLine[] } | null = null;
  let auditChanges: Array<{ field: string; before: unknown; after: unknown; format: "currency_crc" | "currency_usd" | "number" | "text" }> = [];
  let activityDetailsObjectKey: string | null = null;
  let activitySource: "user" | "assistant" = "user";
  let paymentChange: Awaited<ReturnType<typeof prepareWorkbookPaymentChange>> | null = null;
  let legacyProjection: { objectKey: string; planVersion: number; actualsRevision: number } | null = null;
  if (body.action === "approved" && pendingData.kind === "workbook_changes") {
    const currentConfig = await firestore.collection(CONFIG).doc(projectConfigDoc(actor.projectId)).get();
    if (Number(currentConfig.data()?.currencyCorrectionPlanVersion || 0) > 0) return NextResponse.json({ error: "Project currency changed. Reopen these changes in a new budget draft.", code: "stale_currency" }, { status: 409 });
    const { workbook, sourceBytes, config } = await loadOfficialWorkbook(actor.projectId, { legacyOverrides: true });
    const baseline = await loadWorkbook(await writeWorkbook(workbook));
    const changes = Array.isArray(pendingData.payload?.changes) ? pendingData.payload.changes : [];
    // Legacy overrides are applied before column migration when the source is loaded.
    const candidate = await loadWorkbook(sourceBytes);
    const rawBudget = candidate.getWorksheet(BUDGET_SHEET);
    const paidColumn = /obligatorio|required/i.test(rawBudget?.getCell("I3").text || "") && /estado|status/i.test(rawBudget?.getCell("N3").text || "") ? 15 : 10;
    // Apply financial/identity edits to the current normalized view so existing overrides remain present.
    const guardedChanges = changes.filter((change: { sheetName?: string; columnIndex?: number }) => change.sheetName === BUDGET_SHEET &&
      [0, 1, 25, paidColumn - 1].includes(Number(change.columnIndex))).map((change: { sheetName: string; rowIndex: number; columnIndex: number; value: unknown }) => ({ ...change, columnIndex: change.columnIndex === paidColumn - 1 ? 9 : change.columnIndex }));
    applyLegacyOverrides(workbook, guardedChanges);
    try { paymentChange = await prepareWorkbookPaymentChange(actor.projectId, baseline, workbook); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo conciliar el pagado histórico", code: "historical_paid_protected" }, { status: 422 }); }
    if (paymentChange.paymentsModelVersion === 2) {
      if (!projectBucket) return NextResponse.json({ error: "Storage is unavailable" }, { status: 503 });
      // Publish the normalized source too: v2 financial amounts cannot live in overrides.
      const otherChanges = changes.filter((change: { sheetName?: string; columnIndex?: number }) => change.sheetName !== BUDGET_SHEET || ![0, 1, 25, paidColumn - 1].includes(Number(change.columnIndex)));
      applyLegacyOverrides(workbook, otherChanges);
      const objectKey = `${projectStoragePrefix(actor.projectId)}/workbooks/versions/approval-${approvalId}-${randomUUID()}.xlsx`;
      await projectBucket.file(objectKey).save(await writeWorkbook(workbook), { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", resumable: false, preconditionOpts: { ifGenerationMatch: 0 } });
      legacyProjection = { objectKey, planVersion: config.planVersion + 1, actualsRevision: config.actualsRevision };
    }
  }
  if (body.action === "rejected" && pendingData.kind === "workbook_draft") {
    const draftId = String(pendingData.payload?.draftId || "");
    const draft = draftId ? await firestore.collection(WORKBOOK_DRAFTS).doc(draftId).get() : null;
    activitySource = draft?.data()?.source === "assistant" ? "assistant" : "user";
  }
  if (body.action === "approved" && pendingData.kind === "workbook_draft") {
    if (!projectBucket) return NextResponse.json({ error: "Storage is unavailable" }, { status: 503 });
    const draftId = String(pendingData.payload?.draftId || ""); const draft = await firestore.collection(WORKBOOK_DRAFTS).doc(draftId).get(); const draftData = draft.data();
    if (!draft.exists || draftData?.projectId !== actor.projectId || draftData?.status !== "submitted" || !draftData.snapshotObjectKey) return NextResponse.json({ error: "Draft is unavailable" }, { status: 409 });
    const config = await workbookConfig(actor.projectId); if (config.planVersion !== Number(draftData.basePlanVersion)) return NextResponse.json({ error: "The official plan changed after this draft began", code: "stale_base" }, { status: 409 });
    const [snapshotBytes, baseBytes] = await Promise.all([
      projectBucket.file(draftData.snapshotObjectKey).download(),
      projectBucket.file(`${projectStoragePrefix(actor.projectId)}/workbooks/drafts/${draftId}/revision-1.json`).download(),
    ]);
    const snapshot = JSON.parse(snapshotBytes[0].toString("utf8")) as UniverWorkbook;
    const base = JSON.parse(baseBytes[0].toString("utf8")) as UniverWorkbook;
    activitySource = draftData.source === "assistant" ? "assistant" : "user";
    const { workbook } = await loadOfficialWorkbook(actor.projectId, { legacyOverrides: true });
    const baseline = await loadWorkbook(await writeWorkbook(workbook));
    const changes = diffUniverWorkbooks(base, snapshot);
    const rowMaps = draftData.rowMaps as Record<string, Record<number, number>> | null;
    let promotedChanges: ReturnType<typeof diffUniverWorkbooks>;
    try {
      promotedChanges = rowMaps ? diffGeneratedUniverWorkbooks(base, snapshot, rowMaps, prepareBudgetRows(workbook, base, snapshot)) : changes;
    } catch (error) {
      if (error instanceof UnsafeGeneratedWorkbookError) return NextResponse.json({ error: error.message, code: "unsafe_generated_snapshot" }, { status: 422 });
      throw error;
    }
    applyUniverChanges(workbook, promotedChanges);
    try { paymentChange = await prepareWorkbookPaymentChange(actor.projectId, baseline, workbook); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo conciliar el pagado histórico", code: "historical_paid_protected" }, { status: 422 }); }
    const candidate = await writeWorkbook(workbook); const planVersion = config.planVersion + 1; const objectKey = `${projectStoragePrefix(actor.projectId)}/workbooks/versions/plan-${planVersion}-actuals-${config.actualsRevision}-${randomUUID()}.xlsx`;
    await projectBucket.file(objectKey).save(candidate, { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { metadata: { kind: "approved_draft", draftId, planVersion: String(planVersion) } } });
    auditChanges = approvalChangeDetails(promotedChanges, base).filter((change) => !change.calculated).map((change) => ({
      field: `${change.sheet} · ${change.rowLabel} · C${change.column}`,
      before: change.before?.value ?? null,
      after: change.after?.value ?? null,
      format: currencyFromNumberFormat(String(change.after?.numberFormat || change.before?.numberFormat || "")) === "USD" ? "currency_usd" as const : currencyFromNumberFormat(String(change.after?.numberFormat || change.before?.numberFormat || "")) === "CRC" ? "currency_crc" : typeof (change.after?.value ?? change.before?.value) === "number" ? "number" : "text",
    }));
    if (auditChanges.length > 80) {
      activityDetailsObjectKey = `${projectStoragePrefix(actor.projectId)}/activity-details/budget-approval-${approvalId}-${randomUUID()}.json`;
      await projectBucket.file(activityDetailsObjectKey).save(JSON.stringify(auditChanges), { contentType: "application/json", resumable: false });
    }
    promoted = { objectKey, planVersion, draftId, lines: readBudgetLines(workbook) };
  }
  let activityId = "";
  try { activityId = await firestore.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists || snap.data()?.projectId !== actor.projectId || snap.data()?.status !== "pending") throw new Error("Approval is unavailable");
    const data = snap.data()!;
    if (data.kind === "workbook_changes" && body.action === "approved" && JSON.stringify(data.payload?.changes) !== JSON.stringify(pendingData.payload?.changes)) throw new Error("Approval changed while reviewing its historical payments");
    const configRef = firestore.collection(CONFIG).doc(projectConfigDoc(actor.projectId));
    const config = body.action === "approved" && (data.kind === "workbook_draft" || data.kind === "workbook_changes") ? await transaction.get(configRef) : null;
    if (body.action === "approved" && data.kind === "workbook_changes" && Number(config?.data()?.currencyCorrectionPlanVersion || 0) > 0) throw new Error("legacy_currency_stale");
    await paymentChange?.validate(transaction);
    const previewChanges = auditChanges.length ? auditChanges : (Array.isArray(data.payload?.preview) ? data.payload.preview.slice(0, 80).map((change: { sheet?: string; row?: number; column?: number; before?: { v?: unknown }; after?: { v?: unknown } }) => ({ field: `${change.sheet || "Workbook"} · R${change.row || ""}C${change.column || ""}`, before: change.before?.v ?? null, after: change.after?.v ?? null, format: typeof (change.after?.v ?? change.before?.v) === "number" ? "number" as const : "text" as const })) : []);
    const activity = await appendActivity(transaction, actor, {
      category: "budget", action: body.action === "approved" ? "budget.approved" : "budget.rejected", source: activitySource,
      target: { type: "approval", id: approvalId, label: String(data.title || "Workbook change"), section: "approvals" },
      summaryParams: { changeCount: Number(data.payload?.changeCount || previewChanges.length), planVersion: promoted?.planVersion || null },
      changes: previewChanges, changeCount: Number(data.payload?.changeCount || previewChanges.length), detailsObjectKey: activityDetailsObjectKey,
    });
    if (body.action === "approved" && data.kind === "workbook_changes") {
      const changes = Array.isArray(data.payload?.changes) ? data.payload.changes : [];
      if (legacyProjection) {
        transaction.set(firestore.collection(WORKBOOK_VERSIONS).doc(), { projectId: actor.projectId, kind: "legacy_approval", ...legacyProjection, createdBy: actor.email, createdAt: FieldValue.serverTimestamp() });
        transaction.set(configRef, { workbookObjectKey: legacyProjection.objectKey, workbookPlanVersion: legacyProjection.planVersion, workbookUpdatedBy: actor.email, workbookUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
      for (const change of legacyProjection ? [] : changes) {
        const id = projectScopedId(actor.projectId, `${actor.projectId}:${encodeURIComponent(change.sheetName)}:${change.rowIndex}:${change.columnIndex}`);
        transaction.set(firestore.collection("housePlannerWorkbookOverrides").doc(id), {
          projectId: actor.projectId,
          ...change,
          updatedBy: actor.email,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
    paymentChange?.write(transaction);
    if (data.kind === "workbook_draft") {
      const draftId = String(data.payload?.draftId || "");
      if (body.action === "approved" && promoted) {
        if (Number(config?.data()?.workbookPlanVersion || 1) !== Number(data.payload?.basePlanVersion || 1)) throw new Error("Official plan changed");
        transaction.set(firestore.collection(WORKBOOK_VERSIONS).doc(), { projectId: actor.projectId, kind: "draft_approval", planVersion: promoted.planVersion, actualsRevision: Number(config?.data()?.workbookActualsRevision || 0), objectKey: promoted.objectKey, draftId, createdBy: actor.email, createdAt: FieldValue.serverTimestamp() });
        transaction.set(configRef, { projectId: actor.projectId, workbookObjectKey: promoted.objectKey, workbookPlanVersion: promoted.planVersion, workbookUpdatedBy: actor.email, workbookUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
        for (const line of promoted.lines) transaction.set(firestore.collection(BUDGET_LINES).doc(projectScopedId(actor.projectId, line.id)), { projectId: actor.projectId, ...line, planVersion: promoted.planVersion, actualsRevision: Number(config?.data()?.workbookActualsRevision || 0), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        transaction.update(firestore.collection(WORKBOOK_DRAFTS).doc(draftId), { status: "approved", approvedAt: FieldValue.serverTimestamp(), approvedBy: actor.email });
      } else transaction.update(firestore.collection(WORKBOOK_DRAFTS).doc(draftId), { status: "rejected", rejectedAt: FieldValue.serverTimestamp(), rejectedBy: actor.email });
    }
    transaction.update(ref, { status: body.action, reviewedBy: actor.email, reviewedAt: FieldValue.serverTimestamp() });
    return activity.id;
  }); } catch (error) {
    if (promoted && projectBucket) await projectBucket.file(promoted.objectKey).delete({ ignoreNotFound: true }).catch(() => undefined);
    if (legacyProjection && projectBucket) await projectBucket.file(legacyProjection.objectKey).delete({ ignoreNotFound: true }).catch(() => undefined);
    if (activityDetailsObjectKey && projectBucket) await projectBucket.file(activityDetailsObjectKey).delete({ ignoreNotFound: true }).catch(() => undefined);
    if (error instanceof Error && error.message === "legacy_currency_stale") return NextResponse.json({ error: "Project currency changed. Reopen these changes in a new budget draft.", code: "stale_currency" }, { status: 409 });
    throw error;
  }
  await completedUsageAction(actor, body.action === "approved" ? "approval.approve" : "approval.reject", "approvals", activityId);
  return NextResponse.json({ ok: true, ...(promoted || legacyProjection ? await syncAfterBudgetCommit(actor.projectId) : {}) });
}
