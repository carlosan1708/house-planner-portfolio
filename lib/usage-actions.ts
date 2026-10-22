import type { MemberRecord, WorkspaceTab } from "./project";
import { recordUsageAction } from "./usage-store";

type UsageActor = Pick<MemberRecord, "uid" | "email" | "projectId">;

// Only these completed business operations become usage metadata. Their labels,
// payloads and before/after values never enter the analytics store.
const ACTIVITY_ACTIONS: Record<string, string> = {
  "project.created": "record.create",
  "access.invited": "record.create",
  "access.invitation_accepted": "record.update",
  "access.invitation_revoked": "record.delete",
  "access.permissions_changed": "record.update",
  "access.folders_changed": "record.update",
  "access.member_access_changed": "record.update",
  "access.member_removed": "record.delete",
  "access.link_created": "record.create",
  "access.link_updated": "record.update",
  "access.link_revoked": "record.delete",
  "document.uploaded": "file.upload",
  "document.moved": "record.update",
  "document.quote_reference_updated": "record.update",
  "document.description_updated": "record.update",
  "document.deleted": "record.delete",
  "folder.created": "record.create",
  "folder.renamed": "record.update",
  "folder.moved": "record.update",
  "folder.deleted": "record.delete",
  "aesthetic.folder_created": "record.create",
  "aesthetic.image_uploaded": "file.upload",
  "aesthetic.folder_renamed": "record.update",
  "aesthetic.carousel_updated": "record.update",
  "aesthetic.caption_updated": "record.update",
  "aesthetic.notes_updated": "record.update",
  "aesthetic.classification_updated": "record.update",
  "aesthetic.image_moved": "record.update",
  "aesthetic.folder_deleted": "record.delete",
  "aesthetic.image_deleted": "record.delete",
  "expense.created": "record.create",
  "expense.updated": "record.update",
  "expense.deleted": "record.delete",
  "expense.receipt_linked": "record.update",
  "expense.receipt_unlinked": "record.update",
  "expense.invoice_uploaded": "file.upload",
  "expense.invoice_deleted": "record.delete",
  "expense.purchase_created": "record.create",
  "expense.purchase_updated": "record.update",
  "expense.purchase_deleted": "record.delete",
  "expense.purchase_photo_added": "file.upload",
  "expense.purchase_photo_deleted": "record.delete",
  "expense.document_created": "record.create",
  "expense.document_updated": "record.update",
  "expense.document_deleted": "record.delete",
  "expense.document_files_added": "file.upload",
  "expense.document_file_deleted": "record.delete",
  "expense.payment_created": "record.create",
  "expense.payment_updated": "record.update",
  "expense.payment_status_updated": "record.update",
  "expense.payment_deleted": "record.delete",
  "expense.mobile_capture_added": "file.upload",
  "decision.mobile_capture_added": "file.upload",
  "site.mobile_capture_added": "file.upload",
  "countdown.created": "record.create",
  "countdown.acknowledged": "record.update",
  "countdown.completed": "record.update",
  "countdown.recipients_updated": "record.update",
  "countdown.deleted": "record.delete",
  "plan.created": "record.create",
  "plan.updated": "record.update",
  "plan.deleted": "record.delete",
  "plan.template_applied": "record.create",
  "decision.created": "record.create",
  "decision.updated": "record.update",
  "decision.deleted": "record.delete",
  "site_issue.created": "record.create",
  "site_issue.updated": "record.update",
  "site_issue.deleted": "record.delete",
  "budget.published": "budget.publish",
  "budget.submitted": "budget.submit",
  "budget.restored": "budget.restore",
  "budget.replaced": "file.upload",
  "budget.approved": "approval.approve",
  "budget.rejected": "approval.reject",
};

export function activityUsageAction(action: string, source?: string): string | null {
  return source === "system" || !Object.hasOwn(ACTIVITY_ACTIONS, action) ? null : ACTIVITY_ACTIONS[action];
}

export async function completedUsageAction(actor: UsageActor, action: string, section: WorkspaceTab, operationId: string) {
  try {
    await recordUsageAction(actor, action, section, operationId);
  } catch {
    // Analytics must never turn a committed business operation into a failure.
  }
}

export async function recordActivityUsage(actor: UsageActor, input: { action: string; source?: string; target: { section: WorkspaceTab } }, operationId: string) {
  const action = activityUsageAction(input.action, input.source);
  if (action) await completedUsageAction(actor, action, input.target.section, operationId);
}
