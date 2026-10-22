import { describe, expect, it } from "vitest";
import { DEFAULT_MEMBER_PERMISSIONS, type MemberRecord } from "@/lib/project";
import { addUsageDays, isUsageOwner, parseUsageFilter, summarizeUsage, usageActiveCredit, usageDay, validateUsageBatch } from "@/lib/usage";
import type { UsageDailyRow, UsageEvent } from "@/lib/usage-types";

const now = Date.parse("2026-10-06T18:00:00Z");
const member: MemberRecord = { uid: "u1", projectId: "p1", projectName: "House", email: "user@example.com", name: "User", role: "editor", status: "approved", isPersonal: false, permissions: DEFAULT_MEMBER_PERMISSIONS, folderAccess: { mode: "all", folderIds: [], allowUnfiled: true } };
const event: UsageEvent = { id: "event-0001", kind: "view", context: "project", section: "documents", projectId: "p1" };
const row = (overrides: Partial<UsageDailyRow> = {}): UsageDailyRow => ({ day: "2026-10-06", scope: "global", context: "all", projectId: null, browserKey: "browser1", uid: "u1", name: "User", email: "user@example.com", owner: false, visits: 1, views: 2, actions: 1, activeMs: 1000, lastAt: now, sections: { documents: { visits: 1, views: 2, actions: 1, activeMs: 1000 } }, ...overrides });

describe("analytics validation", () => {
  it("recognizes only the configured platform owner and fails closed without configuration", () => {
    expect(isUsageOwner("OWNER@EXAMPLE.COM", " owner@example.com ")).toBe(true);
    expect(isUsageOwner("project-admin@example.com", "owner@example.com")).toBe(false);
    expect(isUsageOwner("", undefined)).toBe(false);
  });

  it("uses Costa Rica calendar days and accepts exactly the supported 90-day window", () => {
    expect(usageDay(Date.parse("2026-10-06T05:59:59Z"))).toBe("2026-10-05");
    expect(usageDay(Date.parse("2026-10-06T06:00:00Z"))).toBe("2026-10-06");
    const earliest = addUsageDays("2026-10-06", -89);
    expect(parseUsageFilter(new URLSearchParams({ from: earliest, to: "2026-10-06" }), now).from).toBe(earliest);
    expect(() => parseUsageFilter(new URLSearchParams({ from: addUsageDays(earliest, -1), to: "2026-10-06" }), now)).toThrow("90 days");
    expect(() => parseUsageFilter(new URLSearchParams({ from: "2026-09-31" }), now)).toThrow();
    expect(() => parseUsageFilter(new URLSearchParams({ to: "2026-10-07" }), now)).toThrow();
    expect(parseUsageFilter(new URLSearchParams({ projectId: "p2" }), now).context).toBe("project");
  });

  it("binds the batch to the authenticated identity and active project permissions", () => {
    expect(validateUsageBatch({ expectedEmail: member.email, events: [event] }, member, now).events[0]).toEqual(event);
    expect(() => validateUsageBatch({ expectedEmail: null, events: [event] }, member, now)).toThrow("identity changed");
    expect(() => validateUsageBatch({ expectedEmail: member.email, events: [event] }, null, now)).toThrow("identity changed");
    expect(() => validateUsageBatch({ expectedEmail: member.email, events: [{ ...event, projectId: "p2" }] }, member, now)).toThrow("Project access");
    expect(() => validateUsageBatch({ expectedEmail: member.email, events: [{ ...event, section: "expenses" }] }, member, now)).toThrow("Section access");
    expect(() => validateUsageBatch({ expectedEmail: member.email, events: [event] }, { ...member, status: "rejected" }, now)).toThrow("Project access");
  });

  it("accepts shared-project administrator access views but rejects personal/editor access views", () => {
    const access = { ...event, section: "access" };
    expect(validateUsageBatch({ expectedEmail: member.email, events: [access] }, { ...member, role: "admin" }, now).events[0].section).toBe("access");
    expect(() => validateUsageBatch({ expectedEmail: member.email, events: [access] }, member, now)).toThrow();
    expect(() => validateUsageBatch({ expectedEmail: member.email, events: [access] }, { ...member, role: "admin", isPersonal: true }, now)).toThrow();
  });

  it("permits demo actions and explicit permitted file interactions but rejects client business writes", () => {
    expect(() => validateUsageBatch({ expectedEmail: member.email, events: [{ ...event, kind: "interaction", action: "budget.save" }] }, member, now)).toThrow("Invalid client action");
    expect(validateUsageBatch({ expectedEmail: null, events: [{ ...event, kind: "interaction", context: "demo", projectId: undefined, action: "budget.save", section: "budget" }] }, null, now).events[0].action).toBe("budget.save");
    expect(validateUsageBatch({ expectedEmail: member.email, events: [{ ...event, kind: "interaction", action: "document.open", section: "quotes" }] }, member, now).events[0].section).toBe("quotes");
    expect(() => validateUsageBatch({ expectedEmail: member.email, events: [{ ...event, kind: "interaction", action: "document.open", section: "budget" }] }, member, now)).toThrow("action section");
    expect(() => validateUsageBatch({ expectedEmail: member.email, events: Array.from({ length: 21 }, () => event) }, member, now)).toThrow();
    expect(() => validateUsageBatch({ expectedEmail: member.email, events: [{ ...event, kind: "active", activeMs: 60_001 }] }, member, now)).toThrow();
    expect(() => validateUsageBatch({ expectedEmail: member.email, events: [{ ...event, occurredAt: now - 301_000 }] }, member, now)).toThrow("Expired");
    const sanitized = validateUsageBatch({ expectedEmail: member.email, events: [{ ...event, privateText: "secret", uid: "spoofed" }] }, member, now).events[0];
    expect(sanitized).not.toHaveProperty("privateText"); expect(sanitized).not.toHaveProperty("uid");
  });
});

describe("analytics summaries", () => {
  it("unions identities across days, browsers and login without adding duplicate metric rows", () => {
    const filters = parseUsageFilter(new URLSearchParams({ from: "2026-10-05", to: "2026-10-06" }), now);
    const response = summarizeUsage([
      row({ day: "2026-10-05", uid: null, name: "", email: "" }),
      row(), row({ browserKey: "browser2" }),
      row({ scope: "project:p1", context: "project", projectId: "p1" }),
      row({ browserKey: "ownerBrowser", uid: "owner", owner: true }),
    ], filters, null, [{ projectId: "p1", name: "House" }, { projectId: "p2", name: "No activity" }]);
    expect(response.totals).toEqual({ visits: 3, visitors: 2, users: 1, views: 6, actions: 3, activeMs: 3000 });
    expect(response.daily.map(day => day.visitors)).toEqual([1, 2]);
    expect(response.users).toHaveLength(1); expect(response.users[0].views).toBe(4);
    expect(response.projects[0].views).toBe(2); expect(response.projectOptions).toHaveLength(2);
    expect(summarizeUsage([row({ owner: true })], { ...filters, includeOwner: true }, null, []).totals.views).toBe(2);
    expect(summarizeUsage([row()], { ...filters, projectId: "p2", context: "project" }, null, response.projectOptions).totals.views).toBe(0);
  });

  it("caps active time to one elapsed browser clock across overlapping tabs", () => {
    expect(usageActiveCredit(60_000, 120_000, 60_000, 0)).toBe(60_000);
    expect(usageActiveCredit(60_000, 120_010, 120_000, 0)).toBe(10);
    expect(usageActiveCredit(60_000, 300_000, 0, 0)).toBe(60_000);
    expect(usageActiveCredit(0, 120_000, 0, 0)).toBe(0);
  });
});
