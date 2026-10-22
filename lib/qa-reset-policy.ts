import type { MemberRecord } from "./project";
import {
  AGENT_CONVERSATIONS,
  ACCESS_LINKS,
  AGENT_PROPOSALS,
  AESTHETIC_FOLDERS,
  AESTHETIC_IMAGES,
  APPROVALS,
  BUDGET_LINES,
  CATEGORY_SHEETS,
  COUNTDOWNS,
  DECISIONS,
  DOCUMENTS,
  EXPENSES,
  EXPENSE_DOCUMENTS,
  EXPENSE_PAYMENTS,
  EXPENSE_PAYMENT_STATUSES,
  FOLDERS,
  INVITATIONS,
  MOBILE_CAPTURES,
  NOTIFICATION_DELIVERIES,
  NOTIFICATION_JOBS,
  OVERRIDES,
  PLAN_ITEMS,
  PURCHASES,
  PROJECT_NOTES,
  QUOTE_ANALYSES,
  SITE_ISSUES,
  WORKBOOK_DRAFTS,
  WORKBOOK_SYNC_JOBS,
  WORKBOOK_VERSIONS,
} from "./project";

export const QA_RESETTABLE_COLLECTIONS = [
  APPROVALS,
  OVERRIDES,
  DOCUMENTS,
  FOLDERS,
  PLAN_ITEMS,
  "housePlannerFolderVaultSessions",
  "housePlannerFolderVaultAttempts",
  QUOTE_ANALYSES,
  COUNTDOWNS,
  DECISIONS,
  SITE_ISSUES,
  INVITATIONS,
  ACCESS_LINKS,
  MOBILE_CAPTURES,
  NOTIFICATION_JOBS,
  NOTIFICATION_DELIVERIES,
  EXPENSES,
  PURCHASES,
  EXPENSE_DOCUMENTS,
  EXPENSE_PAYMENTS,
  EXPENSE_PAYMENT_STATUSES,
  BUDGET_LINES,
  WORKBOOK_DRAFTS,
  WORKBOOK_VERSIONS,
  WORKBOOK_SYNC_JOBS,
  CATEGORY_SHEETS,
  AGENT_CONVERSATIONS,
  AGENT_PROPOSALS,
  PROJECT_NOTES,
  AESTHETIC_FOLDERS,
  AESTHETIC_IMAGES,
] as const;

export const qaResetConfirmation = (projectId: string) => `RESET ${projectId}`;
export const DEFAULT_QA_COMPANION_EMAIL = "qa.houseplanner.viewer.20260831@example.com";

export function configuredQaCompanionEmail(value = process.env.HOUSE_PLANNER_QA_COMPANION_EMAIL || DEFAULT_QA_COMPANION_EMAIL) {
  return value.trim().toLowerCase();
}

export function configuredQaEmails(value = process.env.HOUSE_PLANNER_QA_EMAILS || "") {
  return new Set(value.split(/[,;\s]+/).map((email) => email.trim().toLowerCase()).filter(Boolean));
}

export function configuredQaProjectIds(value = process.env.HOUSE_PLANNER_QA_PROJECT_IDS || "") {
  return new Set(value.split(/[,;\s]+/).map((projectId) => projectId.trim()).filter(Boolean));
}

export function qaResetEligibility(
  actor: MemberRecord,
  configuredEmails = configuredQaEmails(),
  configuredProjectIds = configuredQaProjectIds(),
) {
  if (actor.role !== "admin") return { allowed: false as const, reason: "admin_required" };
  if (!configuredEmails.has(actor.email.trim().toLowerCase()))
    return { allowed: false as const, reason: "qa_account_required" };
  const shared = !actor.isPersonal && configuredProjectIds.has(actor.projectId);
  if (!shared) return { allowed: false as const, reason: "qa_project_required" };
  return { allowed: true as const, reason: null };
}

export function qaProjectIdentityAllowed(
  actor: MemberRecord,
  project: { exists: boolean; ownerUid?: unknown; kind?: unknown },
  configuredProjectIds = configuredQaProjectIds(),
) {
  return project.exists
    && !actor.isPersonal
    && configuredProjectIds.has(actor.projectId)
    && project.kind === "shared"
    && project.ownerUid === actor.uid;
}

export function validQaResetConfirmation(projectId: string, value: unknown) {
  return typeof value === "string" && value === qaResetConfirmation(projectId);
}

export function validQaCompanionEmail(value: unknown, configuredEmail = configuredQaCompanionEmail()) {
  return typeof value === "string" && value.trim().toLowerCase() === configuredEmail;
}
