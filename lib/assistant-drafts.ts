import { projectCurrency } from "./currency";
import { lockProjectCurrency, validateProjectCurrency } from "./project-currency";
import { FieldValue } from "firebase-admin/firestore";
import type { MemberRecord } from "./project";
import { AGENT_PROPOSALS, CONFIG, projectConfigDoc, projectStoragePrefix, WORKBOOK_DRAFTS } from "./project";
import { firestore, projectBucket } from "./firebase-admin";
import { ASSISTANT_FIELD_COLUMNS, type BudgetProposalChange } from "./assistant";
import { BUDGET_SHEET, type UniverWorkbook } from "./workbook";
import { editorPayload, workbookConfig } from "./workbook-store";

const draftObjectKey = (projectId: string, id: string, revision: number) => `${projectStoragePrefix(projectId)}/workbooks/drafts/${id}/revision-${revision}.json`;

function applyProposal(workbook: UniverWorkbook, changes: BudgetProposalChange[]) {
  const sheetId = workbook.sheetOrder.find((id) => workbook.sheets[id]?.name === BUDGET_SHEET);
  if (!sheetId) throw new Error("budget_sheet_missing");
  const sheet = workbook.sheets[sheetId];
  for (const change of changes) {
    const rowIndex = change.row - 1;
    const columnIndex = ASSISTANT_FIELD_COLUMNS[change.field] - 1;
    const row = sheet.cellData[rowIndex] ||= {};
    const current = row[columnIndex] || {};
    if (current.f) throw new Error("protected_cell");
    row[columnIndex] = { ...current, v: change.after };
  }
}

export async function confirmAssistantProposal(actor: MemberRecord, proposalId: string) {
  if (actor.role === "viewer" || (actor.role !== "admin" && !actor.permissions.budget)) throw new Error("budget_editor_access_required");
  if (!projectBucket) throw new Error("storage_unavailable");
  const proposalRef = firestore.collection(AGENT_PROPOSALS).doc(proposalId);
  const proposalSnapshot = await proposalRef.get();
  const proposal = proposalSnapshot.data();
  if (!proposalSnapshot.exists || proposal?.projectId !== actor.projectId || proposal?.createdByUid !== actor.uid) throw new Error("proposal_not_found");
  if (proposal.status === "confirmed" && proposal.draftId) return { draftId: String(proposal.draftId), reused: true };
  if (proposal.status !== "pending") throw new Error("proposal_not_pending");
  const currency = await lockProjectCurrency(actor.projectId);
  if (proposal.currency !== undefined && projectCurrency(proposal.currency) !== currency) throw new Error("stale_proposal_currency");
  const config = await workbookConfig(actor.projectId);
  if (config.currency !== undefined && config.currency !== currency) throw new Error("stale_proposal_currency");
  if (config.planVersion !== Number(proposal.basePlanVersion) || config.actualsRevision !== Number(proposal.baseActualsRevision)) throw new Error("stale_proposal");
  const payload = await editorPayload(actor.projectId);
  if (payload.currency !== undefined && payload.currency !== currency) throw new Error("stale_proposal_currency");
  if (!payload.editingAllowed) throw new Error("editing_disabled");
  const base = JSON.parse(JSON.stringify(payload.workbook)) as UniverWorkbook;
  const changed = JSON.parse(JSON.stringify(payload.workbook)) as UniverWorkbook;
  applyProposal(changed, proposal.changes as BudgetProposalChange[]);
  const draftRef = firestore.collection(WORKBOOK_DRAFTS).doc();
  const baseKey = draftObjectKey(actor.projectId, draftRef.id, 1);
  const changedKey = draftObjectKey(actor.projectId, draftRef.id, 2);
  await Promise.all([
    projectBucket.file(baseKey).save(JSON.stringify(base), { contentType: "application/json", resumable: false }),
    projectBucket.file(changedKey).save(JSON.stringify(changed), { contentType: "application/json", resumable: false }),
  ]);
  try {
    await firestore.runTransaction(async (transaction) => {
      await validateProjectCurrency(transaction, actor.projectId, currency);
      const currentConfig = await transaction.get(firestore.collection(CONFIG).doc(projectConfigDoc(actor.projectId)));
      if (Number(currentConfig.data()?.workbookPlanVersion || 1) !== config.planVersion || Number(currentConfig.data()?.workbookActualsRevision || 0) !== config.actualsRevision
        || config.objectKey && currentConfig.data()?.workbookObjectKey !== config.objectKey) throw new Error("stale_proposal");
      const fresh = await transaction.get(proposalRef);
      const data = fresh.data();
      if (data?.status === "confirmed" && data.draftId) throw new Error(`already_confirmed:${data.draftId}`);
      if (data?.status !== "pending" || data.createdByUid !== actor.uid) throw new Error("proposal_changed");
      transaction.set(draftRef, {
        projectId: actor.projectId, currency,
        status: "editing",
        revision: 2,
        basePlanVersion: config.planVersion,
        baseActualsRevision: config.actualsRevision,
        snapshotObjectKey: changedKey,
        scope: null,
        rowMaps: null,
        source: "assistant",
        assistantProposalId: proposalId,
        createdByUid: actor.uid,
        createdBy: actor.email,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(proposalRef, { status: "confirmed", draftId: draftRef.id, confirmedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("already_confirmed:")) return { draftId: message.slice("already_confirmed:".length), reused: true };
    throw error;
  }
  return { draftId: draftRef.id, reused: false };
}
