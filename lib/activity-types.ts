import type { ProjectRole, WorkspaceTab } from "./project";

export const ACTIVITY_CATEGORIES = ["project", "budget", "expense", "document", "aesthetic", "access", "plan", "decision", "site"] as const;
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];
export type ActivitySource = "user" | "assistant" | "system";
export type ActivityValueFormat = "text" | "currency_crc" | "currency_usd" | "date" | "status" | "list" | "number";

export type ActivityChange = {
  field: string;
  before: unknown;
  after: unknown;
  format?: ActivityValueFormat;
};

export type ActivityVisibility = {
  requiredTabs: WorkspaceTab[];
  folderTopLevelId?: string | null;
  folderTopLevelIds?: string[];
  allowUnfiledRequired?: boolean;
  adminOnly?: boolean;
};

export type ActivityEvent = {
  id: string;
  sequence: number;
  category: ActivityCategory;
  action: string;
  source: ActivitySource;
  actor: { uid: string; name: string; role: ProjectRole };
  target: { type: string; id: string; label: string; section: WorkspaceTab; exists: boolean };
  summaryParams: Record<string, unknown>;
  changes: ActivityChange[];
  changeCount: number;
  occurredAt: string;
  visibility: ActivityVisibility;
  integrity: "verified" | "invalid";
  hasDetails: boolean;
};

export type ActivityPage = {
  events: ActivityEvent[];
  nextCursor: string | null;
};
