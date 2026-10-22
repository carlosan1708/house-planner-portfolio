import type { WorkspaceTab } from "./project";

export type UsageContext = "access" | "demo" | "project";
export type UsageSection = WorkspaceTab | "access";
export type UsageEvent = {
  id: string;
  kind: "view" | "active" | "interaction";
  context: UsageContext;
  section: UsageSection;
  projectId?: string;
  activeMs?: number;
  action?: string;
  occurredAt?: number;
};
export type UsageBatch = { events: UsageEvent[]; expectedEmail: string | null };
export type UsageTotals = { visits: number; visitors: number; users: number; views: number; actions: number; activeMs: number };
export type UsageAnalyticsFilter = {
  from: string;
  to: string;
  context: "all" | UsageContext;
  projectId: string | null;
  includeOwner: boolean;
};
export type UsageAnalyticsResponse = {
  filters: UsageAnalyticsFilter;
  metadata: { startedAt: string | null; timezone: "America/Costa_Rica"; retentionDays: 90 };
  totals: UsageTotals;
  daily: Array<UsageTotals & { day: string }>;
  sections: Array<UsageTotals & { section: string }>;
  projects: Array<UsageTotals & { projectId: string; name: string }>;
  projectOptions: Array<{ projectId: string; name: string }>;
  users: Array<{ uid: string; name: string; email: string; lastAt: string; views: number; actions: number; activeMs: number }>;
};

/** One row contains both identities; its counters are counted only once. */
export type UsageDailyRow = {
  day: string;
  scope: string;
  context: "all" | UsageContext;
  projectId: string | null;
  browserKey: string;
  uid: string | null;
  name: string;
  email: string;
  owner: boolean;
  lastAt: number;
  visits: number;
  views: number;
  actions: number;
  activeMs: number;
  sections: Record<string, { visits: number; views: number; actions: number; activeMs: number }>;
};
