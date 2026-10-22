import type { ProjectCurrency } from "./currency";

export const PROJECT_ID = "sample-house";
export const LEGACY_PROJECT_ID = PROJECT_ID;
export const PROJECTS = "housePlannerProjects";
export const MEMBERSHIPS = "housePlannerProjectMemberships";
export const USERS = "housePlannerUsers";
export const APPROVALS = "housePlannerApprovals";
export const OVERRIDES = "housePlannerWorkbookOverrides";
export const DOCUMENTS = "housePlannerDocuments";
export const PROJECT_NOTES = "housePlannerNotes";
export const FOLDERS = "housePlannerFolders";
export const PLAN_ITEMS = "housePlannerPlanItems";
export const COUNTDOWNS = "housePlannerCountdowns";
export const PROPERTY_PROFILES = "housePlannerPropertyProfiles";
export const QUOTE_ANALYSES = "housePlannerQuoteAnalyses";
export const DECISIONS = "housePlannerDecisions";
export const SITE_ISSUES = "housePlannerSiteIssues";
export const INVITATIONS = "housePlannerInvitations";
export const ACCESS_LINKS = "housePlannerAccessLinks";
export const EXPENSES = "housePlannerExpenses";
export const PURCHASES = "housePlannerPurchases";
export const EXPENSE_DOCUMENTS = "housePlannerExpenseDocuments";
export const EXPENSE_PAYMENTS = "housePlannerExpensePayments";
export const EXPENSE_PAYMENT_STATUSES = "housePlannerExpensePaymentStatuses";
export const MOBILE_CAPTURES = "housePlannerMobileCaptures";
export const AESTHETIC_FOLDERS = "housePlannerAestheticFolders";
export const AESTHETIC_IMAGES = "housePlannerAestheticImages";
export const BUDGET_LINES = "housePlannerBudgetLines";
export const WORKBOOK_DRAFTS = "housePlannerWorkbookDrafts";
export const WORKBOOK_VERSIONS = "housePlannerWorkbookVersions";
export const WORKBOOK_SYNC_JOBS = "housePlannerWorkbookSyncJobs";
export const CATEGORY_SHEETS = "housePlannerCategorySheets";
export const AGENT_CONVERSATIONS = "housePlannerAgentConversations";
export const AGENT_PROPOSALS = "housePlannerAgentProposals";
export const NOTIFICATION_PREFERENCES = "housePlannerNotificationPreferences";
export const NOTIFICATION_JOBS = "housePlannerNotificationJobs";
export const NOTIFICATION_DELIVERIES = "housePlannerNotificationDeliveries";
export const CONFIG = "housePlannerConfig";
export const CONFIG_DOC = "production";
export const SESSION_COOKIE = "house_planner_session";
export const ACTIVE_PROJECT_COOKIE = "house_planner_project";
export const PUBLIC_ACCESS_LINK_COOKIE = "house_planner_public_access";
export const SESSION_DAYS = 5;

export type ProjectRole = "admin" | "editor" | "viewer";
export const WORKSPACE_TABS = ["overview", "activity", "budget", "quotes", "expenses", "documents", "notes", "aesthetics", "distribution", "approvals", "plan", "decisions", "site"] as const;
export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];
export type MemberPermissions = Record<WorkspaceTab, boolean>;
export type FolderAccess = {
  mode: "all" | "selected";
  folderIds: string[];
  allowUnfiled: boolean;
};
export const DEFAULT_MEMBER_PERMISSIONS: MemberPermissions = {
  overview: true,
  activity: true,
  budget: true,
  quotes: true,
  expenses: false,
  documents: true,
  notes: false,
  aesthetics: true,
  distribution: false,
  approvals: true,
  plan: true,
  decisions: true,
  site: true,
};
export const DEFAULT_FOLDER_ACCESS: FolderAccess = {
  mode: "all",
  folderIds: [],
  allowUnfiled: true,
};

export function normalizePermissions(value: unknown): MemberPermissions {
  if (!value || typeof value !== "object") return { ...DEFAULT_MEMBER_PERMISSIONS };
  const permissions = value as Partial<Record<WorkspaceTab, unknown>>;
  return Object.fromEntries(
    WORKSPACE_TABS.map((tab) => [
      tab,
      (tab === "expenses" || tab === "distribution" || tab === "notes")
        ? permissions[tab] === true
        : tab === "quotes" && permissions[tab] === undefined
          ? permissions.documents !== false
          : tab === "aesthetics" && permissions[tab] === undefined
            ? permissions.documents !== false
            : permissions[tab] !== false,
    ]),
  ) as MemberPermissions;
}

export function normalizeFolderAccess(value: unknown): FolderAccess {
  if (!value || typeof value !== "object") return { ...DEFAULT_FOLDER_ACCESS };
  const access = value as Partial<FolderAccess>;
  if (access.mode !== "selected") return { ...DEFAULT_FOLDER_ACCESS };
  const folderIds = Array.isArray(access.folderIds)
    ? [...new Set(access.folderIds.filter(
        (id): id is string => typeof id === "string" && id.length > 0 && id.length <= 160,
      ))].slice(0, 250)
    : [];
  return {
    mode: "selected",
    folderIds,
    allowUnfiled: access.allowUnfiled === true,
  };
}

export type AccessStatus = "pending" | "approved" | "rejected";
export type MemberRecord = {
  uid: string;
  projectId: string;
  projectName: string;
  projectCurrency?: ProjectCurrency;
  isPersonal: boolean;
  email: string;
  name: string;
  role: ProjectRole;
  status: AccessStatus;
  permissions: MemberPermissions;
  folderAccess: FolderAccess;
  accessLinkId?: string;
  anonymousLink?: boolean;
  linkDefaultLanguage?: "es" | "en";
};

export const personalProjectId = (uid: string) => `personal-${uid}`;
export const membershipId = (projectId: string, uid: string) => `${projectId}__${uid}`;
export const projectConfigDoc = (projectId: string) => projectId === LEGACY_PROJECT_ID ? CONFIG_DOC : projectId;
export const projectStoragePrefix = (projectId: string) => projectId === LEGACY_PROJECT_ID ? "house-planner/production" : `house-planner/projects/${projectId}`;
export const projectScopedId = (projectId: string, id: string) => projectId === LEGACY_PROJECT_ID ? id : `${projectId}__${id}`;

export function signInProjectId({ personalId, invitedProjectId, requestedProjectId, requestedApproved, favoriteProjectId, openFavoriteOnSignIn, favoriteApproved }: {
  personalId: string;
  invitedProjectId?: string;
  requestedProjectId?: string;
  requestedApproved?: boolean;
  favoriteProjectId?: string;
  openFavoriteOnSignIn?: boolean;
  favoriteApproved?: boolean;
}) {
  if (invitedProjectId) return invitedProjectId;
  if (requestedProjectId && requestedApproved) return requestedProjectId;
  if (openFavoriteOnSignIn && favoriteProjectId && favoriteApproved) return favoriteProjectId;
  return personalId;
}
