import { WORKSPACE_TABS, type MemberRecord } from "./project";
import type { UsageAnalyticsFilter, UsageAnalyticsResponse, UsageBatch, UsageDailyRow, UsageEvent, UsageTotals } from "./usage-types";

export const USAGE_TIMEZONE = "America/Costa_Rica";
export const USAGE_RETENTION_DAYS = 90;
export const USAGE_SESSION_MS = 30 * 60_000;
export const USAGE_COOKIE = "house_planner_visitor";
export const USAGE_MAX_BYTES = 16 * 1024;
export const USAGE_MAX_EVENTS = 20;
export const USAGE_MAX_ACTIVE_MS = 60_000;
export const USAGE_CLIENT_ACTIONS = ["document.open", "document.download", "workbook.download"] as const;
export const USAGE_DEMO_ACTIONS = ["record.create", "record.update", "record.delete", "file.upload", "budget.save", "budget.publish", "budget.submit", "budget.restore", "approval.approve", "approval.reject", "assistant.message", "quote.analyze", "quote.message", "expense.save", ...USAGE_CLIENT_ACTIONS] as const;
export const USAGE_SERVER_ACTIONS = USAGE_DEMO_ACTIONS.filter(action => !USAGE_CLIENT_ACTIONS.includes(action as typeof USAGE_CLIENT_ACTIONS[number]));

export class UsageError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function isUsageOwner(email: string, adminEmail: string | undefined) {
  return Boolean(adminEmail?.trim()) && email.trim().toLowerCase() === adminEmail!.trim().toLowerCase();
}

export function usageDay(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: USAGE_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}

export function addUsageDays(day: string, amount: number) {
  return new Date(Date.parse(`${day}T12:00:00Z`) + amount * 86_400_000).toISOString().slice(0, 10);
}

export function usageDays(from: string, to: string) {
  const result: string[] = [];
  for (let day = from; day <= to; day = addUsageDays(day, 1)) result.push(day);
  return result;
}

function validDay(day: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(`${day}T12:00:00Z`)) && new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) === day;
}

export function parseUsageFilter(params: URLSearchParams, now = Date.now()): UsageAnalyticsFilter {
  const today = usageDay(now);
  const from = params.get("from") || addUsageDays(today, -29);
  const to = params.get("to") || today;
  if (!validDay(from) || !validDay(to) || from > to || to > today || from < addUsageDays(today, -89)) throw new UsageError("Select a valid range within the last 90 days");
  const requestedContext = params.get("context") || "all";
  if (!["all", "access", "demo", "project"].includes(requestedContext)) throw new UsageError("Invalid context");
  const projectId = params.get("projectId")?.trim() || null;
  if (projectId && (projectId.length > 160 || /[\u0000-\u001f/]/.test(projectId))) throw new UsageError("Invalid project");
  return { from, to, context: projectId ? "project" : requestedContext as UsageAnalyticsFilter["context"], projectId, includeOwner: params.get("includeOwner") === "true" || params.get("includeOwner") === "1" };
}

export function validateUsageBatch(value: unknown, member: MemberRecord | null, now = Date.now()): UsageBatch {
  if (!value || typeof value !== "object") throw new UsageError("Invalid analytics batch");
  const body = value as Record<string, unknown>;
  const currentEmail = member?.email.trim().toLowerCase() || null;
  if (body.expectedEmail !== currentEmail) throw new UsageError("Analytics identity changed", 409);
  if (!Array.isArray(body.events) || !body.events.length || body.events.length > USAGE_MAX_EVENTS) throw new UsageError("Use batches of 1 to 20 events");
  const events: UsageEvent[] = body.events.map(value => {
    if (!value || typeof value !== "object") throw new UsageError("Invalid event");
    const input = value as Record<string, unknown>;
    if (typeof input.id !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(input.id)) throw new UsageError("Invalid event id");
    if (input.kind !== "view" && input.kind !== "active" && input.kind !== "interaction") throw new UsageError("Invalid event kind");
    if (input.context !== "access" && input.context !== "demo" && input.context !== "project") throw new UsageError("Invalid event context");
    if (typeof input.section !== "string" || (input.section !== "access" && !WORKSPACE_TABS.includes(input.section as typeof WORKSPACE_TABS[number]))) throw new UsageError("Invalid section");
    if (input.context === "access" && input.section !== "access") throw new UsageError("Invalid access section");
    if (input.context !== "access" && input.section === "access" && !(input.context === "project" && member?.role === "admin" && !member.isPersonal)) throw new UsageError("Invalid workspace section");
    if (input.context === "project") {
      if (!member || member.status !== "approved" || input.projectId !== member.projectId) throw new UsageError("Project access required", 403);
      if (member.role !== "admin" && !member.permissions[input.section as typeof WORKSPACE_TABS[number]]) throw new UsageError("Section access required", 403);
    } else if (input.projectId !== undefined) throw new UsageError("Unexpected project");
    if (input.occurredAt !== undefined && (typeof input.occurredAt !== "number" || !Number.isFinite(input.occurredAt) || Math.abs(input.occurredAt - now) > 5 * 60_000)) throw new UsageError("Expired analytics event");
    const activeMs = input.kind === "active" ? input.activeMs : undefined;
    if (input.kind === "active" && (typeof activeMs !== "number" || !Number.isFinite(activeMs) || activeMs < 0 || activeMs > USAGE_MAX_ACTIVE_MS)) throw new UsageError("Invalid active time");
    if (input.kind === "interaction") {
      const actions: readonly string[] = input.context === "demo" ? USAGE_DEMO_ACTIONS : USAGE_CLIENT_ACTIONS;
      if (input.context === "access" || typeof input.action !== "string" || !actions.includes(input.action)) throw new UsageError("Invalid client action");
      if (input.context === "project" && ((input.action === "workbook.download" && !["budget", "overview"].includes(input.section)) || (input.action.startsWith("document.") && !["documents", "expenses", "site", "aesthetics", "quotes"].includes(input.section)))) throw new UsageError("Invalid action section");
    }
    return { id: input.id, kind: input.kind, context: input.context, section: input.section as UsageEvent["section"], ...(input.context === "project" ? { projectId: member!.projectId } : {}), ...(activeMs !== undefined ? { activeMs: Math.floor(activeMs as number) } : {}), ...(input.kind === "interaction" ? { action: input.action as string } : {}) };
  });
  return { events, expectedEmail: currentEmail };
}

export function usageScope(event: Pick<UsageEvent, "context" | "projectId">) {
  return event.context === "project" ? `project:${event.projectId}` : event.context;
}

export function usageActiveCredit(claimedMs: number, now: number, lastActiveAt: number, sessionStartedAt: number) {
  return Math.max(0, Math.min(claimedMs, USAGE_MAX_ACTIVE_MS, now - Math.max(lastActiveAt, sessionStartedAt)));
}

type Counter = Omit<UsageTotals, "visitors" | "users">;
const zeroCounters = (): Counter => ({ visits: 0, views: 0, actions: 0, activeMs: 0 });
export const emptyUsageTotals = (): UsageTotals => ({ ...zeroCounters(), visitors: 0, users: 0 });
type Accumulator = { counts: Counter; browsers: Set<string>; users: Set<string> };
function accumulator(): Accumulator { return { counts: zeroCounters(), browsers: new Set(), users: new Set() }; }
function count(target: Accumulator, row: UsageDailyRow, counters: Counter = row) {
  for (const key of ["visits", "views", "actions", "activeMs"] as const) target.counts[key] += counters[key] || 0;
  target.browsers.add(row.browserKey);
  if (row.uid) target.users.add(row.uid);
}
function totals(value: Accumulator): UsageTotals { return { ...value.counts, visitors: value.browsers.size, users: value.users.size }; }

export function summarizeUsage(rows: UsageDailyRow[], filters: UsageAnalyticsFilter, startedAt: string | null, projectOptions: UsageAnalyticsResponse["projectOptions"], ownerBrowserKeys: Set<string> = new Set()): UsageAnalyticsResponse {
  const visible = rows.filter(row => row.day >= filters.from && row.day <= filters.to && (filters.includeOwner || (!row.owner && !(row.uid === null && ownerBrowserKeys.has(row.browserKey)))));
  const matched = visible.filter(row => filters.context === "all" ? row.scope === "global" : row.context === filters.context && (!filters.projectId || row.projectId === filters.projectId));
  const overall = accumulator();
  const daily = new Map(usageDays(filters.from, filters.to).map(day => [day, accumulator()]));
  const sections = new Map<string, Accumulator>();
  const users = new Map<string, UsageAnalyticsResponse["users"][number]>();
  for (const row of matched) {
    count(overall, row);
    count(daily.get(row.day)!, row);
    for (const [section, counters] of Object.entries(row.sections)) {
      if (!sections.has(section)) sections.set(section, accumulator());
      count(sections.get(section)!, row, counters);
    }
    if (row.uid) {
      const current = users.get(row.uid) || { uid: row.uid, name: row.name || row.email, email: row.email, lastAt: new Date(row.lastAt).toISOString(), views: 0, actions: 0, activeMs: 0 };
      current.views += row.views; current.actions += row.actions; current.activeMs += row.activeMs;
      if (Date.parse(current.lastAt) <= row.lastAt) { current.lastAt = new Date(row.lastAt).toISOString(); current.name = row.name || row.email; current.email = row.email; }
      users.set(row.uid, current);
    }
  }
  const projects = new Map<string, Accumulator>();
  if (filters.context === "all" || filters.context === "project") for (const row of visible.filter(row => row.context === "project" && (!filters.projectId || row.projectId === filters.projectId))) {
    if (!projects.has(row.projectId!)) projects.set(row.projectId!, accumulator());
    count(projects.get(row.projectId!)!, row);
  }
  const projectNames = new Map(projectOptions.map(project => [project.projectId, project.name]));
  return {
    filters, metadata: { startedAt, timezone: USAGE_TIMEZONE, retentionDays: USAGE_RETENTION_DAYS }, totals: totals(overall),
    daily: [...daily].map(([day, value]) => ({ day, ...totals(value) })),
    sections: [...sections].map(([section, value]) => ({ section, ...totals(value) })).sort((a, b) => b.views - a.views || a.section.localeCompare(b.section)),
    projects: [...projects].map(([projectId, value]) => ({ projectId, name: projectNames.get(projectId) || projectId, ...totals(value) })).sort((a, b) => b.views - a.views || a.name.localeCompare(b.name)),
    projectOptions, users: [...users.values()].sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt)),
  };
}
