import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { DEFAULT_MEMBER_PERMISSIONS, MEMBERSHIPS, type MemberRecord } from "@/lib/project";
import type { UsageDailyRow, UsageEvent } from "@/lib/usage-types";

const mock = vi.hoisted(() => ({
  data: new Map<string, Record<string, unknown>>(), cookies: new Map<string, string>(), queryReads: [] as string[],
  queue: Promise.resolve(), fail: false, hang: false,
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => mock.cookies.has(name) ? { value: mock.cookies.get(name) } : undefined, set: (name: string, value: string) => mock.cookies.set(name, value) }) }));
vi.mock("@/lib/firebase-admin", () => {
  const copy = (data?: Record<string, unknown>) => data && { ...data, ...(data.sections ? { sections: Object.fromEntries(Object.entries(data.sections as Record<string, Record<string, number>>).map(([key, value]) => [key, { ...value }])) } : {}) };
  const numberValue = (value: unknown): number | string => value && typeof value === "object" && "toMillis" in value ? (value as { toMillis: () => number }).toMillis() : typeof value === "number" ? value : String(value || "");
  const compare = (a: number | string, b: number | string) => a < b ? -1 : a > b ? 1 : 0;
  const snap = (ref: Ref) => ({ id: ref.id, exists: mock.data.has(ref.path), ref, data: () => copy(mock.data.get(ref.path)) });
  class Ref {
    constructor(public path: string) {}
    get id() { return this.path.split("/").at(-1)!; }
    collection(name: string) { return new Query(`${this.path}/${name}`); }
    async get() { return snap(this); }
    async delete() { mock.data.delete(this.path); }
  }
  class Query {
    constructor(public path: string, public field = "__name__", public pageSize = Infinity, public condition?: { field: string; operator: string; value: unknown }, public cursor?: string) {}
    doc(id: string) { return new Ref(`${this.path}/${id}`); }
    orderBy(field: unknown) { return new Query(this.path, typeof field === "string" ? field : "__name__", this.pageSize, this.condition, this.cursor); }
    where(field: string, operator: string, value: unknown) { return new Query(this.path, this.field, this.pageSize, { field, operator, value }, this.cursor); }
    limit(size: number) { return new Query(this.path, this.field, size, this.condition, this.cursor); }
    startAfter(document: { ref: Ref }) { return new Query(this.path, this.field, this.pageSize, this.condition, document.ref.path); }
    async get() {
      mock.queryReads.push(this.path);
      const fields = this.path.split("/").length + 1;
      let rows = [...mock.data.entries()].filter(([path, data]) => {
        if (!path.startsWith(`${this.path}/`) || path.split("/").length !== fields) return false;
        if (!this.condition) return true;
        const comparison = compare(numberValue(data[this.condition.field]), numberValue(this.condition.value));
        return this.condition.operator === "==" ? comparison === 0 : comparison <= 0;
      });
      rows.sort(([a, da], [b, db]) => this.field === "__name__" ? a.localeCompare(b) : compare(numberValue(da[this.field]), numberValue(db[this.field])) || a.localeCompare(b));
      if (this.cursor) rows = rows.filter(([path]) => path > this.cursor!);
      const docs = rows.slice(0, this.pageSize).map(([path]) => snap(new Ref(path)));
      return { docs, size: docs.length, empty: docs.length === 0 };
    }
  }
  return { firestore: {
    collection: (name: string) => new Query(name),
    getAll: async (...refs: Ref[]) => refs.map(snap),
    runTransaction: (callback: (transaction: unknown) => Promise<unknown>) => {
      const result = mock.queue.then(async () => {
        if (mock.fail) throw new Error("database unavailable");
        if (mock.hang) return new Promise<never>(() => undefined);
        const writes: { ref: Ref; data: Record<string, unknown>; merge?: boolean }[] = [];
        const result = await callback({
          getAll: async (...refs: Ref[]) => { if (writes.length) throw new Error("read after write"); return refs.map(snap); },
          set: (ref: Ref, data: Record<string, unknown>, options?: { merge: boolean }) => writes.push({ ref, data: copy(data)!, merge: options?.merge }),
        });
        writes.forEach(({ ref, data, merge }) => mock.data.set(ref.path, { ...(merge ? mock.data.get(ref.path) : {}), ...data }));
        return result;
      });
      mock.queue = result.then(() => undefined, () => undefined); return result;
    },
    batch: () => {
      const paths: string[] = [];
      return { delete: (ref: Ref) => paths.push(ref.path), commit: async () => { if (paths.length > 400) throw new Error("oversized batch"); paths.forEach(path => mock.data.delete(path)); } };
    },
  } };
});

import { ANALYTICS_COLLECTIONS, cleanupUsage, ingestUsage, readUsageAnalytics, recordUsageAction } from "@/lib/usage-store";
import { parseUsageFilter, USAGE_COOKIE, USAGE_SESSION_MS, usageDay } from "@/lib/usage";
const visitor = "dd80230c-7a65-4c15-88e5-764ae0791234";
const otherVisitor = "dd80230c-7a65-4c15-88e5-764ae0795678";
const now = Date.parse("2026-10-06T18:00:00Z");
const actor: MemberRecord = { uid: "u1", name: "User", email: "user@example.com", projectId: "p1", projectName: "House", role: "admin", status: "approved", isPersonal: false, permissions: DEFAULT_MEMBER_PERMISSIONS, folderAccess: { mode: "all", folderIds: [], allowUnfiled: true } };
const view = (id = "event-0001", overrides: Partial<UsageEvent> = {}): UsageEvent => ({ id, kind: "view", context: "access", section: "access", ...overrides });
const values = (collection: string) => [...mock.data.entries()].filter(([path]) => path.startsWith(`${collection}/`));
const globalRows = () => values(ANALYTICS_COLLECTIONS.days).filter(([path, row]) => path.includes("/usageRows/") && row.scope === "global").map(([, row]) => row as UsageDailyRow);

beforeEach(() => {
  mock.data.clear(); mock.cookies.clear(); mock.queryReads.length = 0; mock.queue = Promise.resolve(); mock.fail = false; mock.hang = false;
  // These aggregation cases use a fully mocked database and explicitly model production analytics.
  vi.stubEnv("HOUSE_PLANNER_ENVIRONMENT", "production");
  vi.stubEnv("HOUSE_PLANNER_ADMIN_EMAIL", "owner@example.com"); vi.stubEnv("HOUSE_PLANNER_QA_EMAILS", "qa@example.com"); vi.stubEnv("HOUSE_PLANNER_QA_PROJECT_IDS", "qa-project");
});
afterEach(() => vi.unstubAllEnvs());

describe("durable analytics aggregation", () => {
  it("counts public-link guests as anonymous visitors while retaining their project scope", async () => {
    const guest: MemberRecord = { ...actor, uid: `access-link-${"a".repeat(64)}`, email: "", name: "Guest", role: "viewer", anonymousLink: true, accessLinkId: "a".repeat(64) };
    await ingestUsage(visitor, guest, [view("guest-first", { context: "project", section: "documents", projectId: "p1" })], now);
    await ingestUsage(otherVisitor, guest, [view("guest-second", { context: "project", section: "documents", projectId: "p1" })], now);
    const rows = values(ANALYTICS_COLLECTIONS.days).filter(([path]) => path.includes("/usageRows/"));
    expect(rows).toHaveLength(4);
    expect(rows.filter(([, row]) => row.scope === "project:p1")).toHaveLength(2);
    rows.forEach(([, row]) => expect(row).toMatchObject({ uid: null, name: "", email: "", owner: false }));
    values(ANALYTICS_COLLECTIONS.events).forEach(([, event]) => expect(event).toMatchObject({ uid: null, projectId: "p1", owner: false }));
    expect(JSON.stringify([...mock.data])).not.toContain(guest.uid);
    const filters = parseUsageFilter(new URLSearchParams({ from: usageDay(now), to: usageDay(now), projectId: "p1" }), now);
    expect((await readUsageAnalytics(filters)).totals).toMatchObject({ users: 0, visitors: 2, views: 2 });
  });

  it("continues to count authenticated link recipients as accounts", async () => {
    const member: MemberRecord = { ...actor, role: "viewer", accessLinkId: "a".repeat(64), anonymousLink: false };
    await ingestUsage(visitor, member, [view("account-link-view", { context: "project", section: "documents", projectId: "p1" })], now);
    expect(globalRows()[0]).toMatchObject({ uid: actor.uid, name: actor.name, email: actor.email, owner: false });
    const filters = parseUsageFilter(new URLSearchParams({ from: usageDay(now), to: usageDay(now) }), now);
    expect((await readUsageAnalytics(filters)).totals).toMatchObject({ users: 1, visitors: 1, views: 1 });
  });

  it("excludes QA project telemetry before normalizing a public-link guest", async () => {
    const guest: MemberRecord = { ...actor, uid: "access-link-qa", projectId: "qa-project", email: "", anonymousLink: true };
    expect(await ingestUsage(visitor, guest, [view("guest-qa", { context: "project", projectId: "qa-project", section: "documents" })], now)).toEqual({ accepted: 0, excluded: true });
    expect(mock.data.size).toBe(0);
  });

  it("deduplicates across requests and transactions without extending the session on retries", async () => {
    await Promise.all([ingestUsage(visitor, null, [view()], now), ingestUsage(visitor, null, [view()], now)]);
    expect(globalRows()[0].views).toBe(1); expect(globalRows()[0].visits).toBe(1);
    const result = await ingestUsage(visitor, null, [view()], now + USAGE_SESSION_MS + 1);
    expect(result.accepted).toBe(0); expect(values(ANALYTICS_COLLECTIONS.sessions)).toHaveLength(1);
    await ingestUsage(otherVisitor, null, [view()], now);
    expect(globalRows().reduce((sum, row) => sum + row.views, 0)).toBe(2);
  });

  it("keeps one global session through demo, sign-in and project changes and counts project entry once", async () => {
    await ingestUsage(visitor, null, [view()], now);
    await ingestUsage(visitor, null, [view("event-0002", { context: "demo", section: "overview" })], now + 1000);
    await ingestUsage(visitor, actor, [view("event-0003", { context: "project", section: "documents", projectId: "p1" })], now + 2000);
    await ingestUsage(visitor, { ...actor, projectId: "p2" }, [view("event-0004", { context: "project", section: "documents", projectId: "p2" })], now + 3000);
    await ingestUsage(visitor, actor, [view("event-0005", { context: "project", section: "documents", projectId: "p1" })], now + 4000);
    expect(values(ANALYTICS_COLLECTIONS.sessions)).toHaveLength(1);
    expect(globalRows().reduce((sum, row) => sum + row.visits, 0)).toBe(1);
    const projectRows = values(ANALYTICS_COLLECTIONS.days).filter(([path, row]) => path.includes("usageRows") && row.context === "project");
    expect(projectRows.map(([, row]) => row.visits)).toEqual([1, 1]);
    await ingestUsage(visitor, actor, [view("event-0006", { context: "project", section: "documents", projectId: "p1" })], now + 4000 + USAGE_SESSION_MS);
    expect(values(ANALYTICS_COLLECTIONS.sessions)).toHaveLength(2);
    expect(globalRows().reduce((sum, row) => sum + row.visits, 0)).toBe(2);
  });

  it("uses a separate active clock, distributes batch time and caps competing tabs", async () => {
    await ingestUsage(visitor, actor, [view("first-view")], now);
    await ingestUsage(visitor, actor, [view("mid-view")], now + 30_000);
    await ingestUsage(visitor, actor, [
      view("active-0001", { kind: "active", context: "project", projectId: "p1", section: "documents", activeMs: 20_000 }),
      view("active-0002", { kind: "active", context: "project", projectId: "p1", section: "budget", activeMs: 20_000 }),
    ], now + 60_000);
    expect(globalRows()[0].activeMs).toBe(40_000);
    expect(globalRows()[0].sections.budget.activeMs).toBe(20_000);
    await Promise.all([
      ingestUsage(visitor, actor, [view("tab-one-000", { kind: "active", activeMs: 60_000 })], now + 120_000),
      ingestUsage(visitor, actor, [view("tab-two-000", { kind: "active", activeMs: 60_000 })], now + 120_000),
    ]);
    expect(globalRows()[0].activeMs).toBe(100_000);
    await ingestUsage(visitor, actor, [view("inactive000", { kind: "active", activeMs: 0 })], now + 150_000);
    const browser = values(ANALYTICS_COLLECTIONS.browsers)[0][1];
    expect(browser.lastAt).toBe(now + 120_000);
  });

  it("counts new-day activity while attributing an ongoing visit to its start day", async () => {
    const beforeMidnight = Date.parse("2026-10-07T05:55:00Z");
    await ingestUsage(visitor, null, [view("before-midnight")], beforeMidnight);
    await ingestUsage(visitor, null, [view("after-midnight")], beforeMidnight + 10 * 60_000);
    expect(globalRows().map(row => [row.day, row.visits, row.views])).toEqual([["2026-10-06", 1, 1], ["2026-10-07", 0, 1]]);
  });

  it("preserves two queued minute heartbeats while sharing one elapsed-time budget", async () => {
    await ingestUsage(visitor, actor, [view("queued-first-view")], now);
    await ingestUsage(visitor, actor, [
      view("queued-active-one", { kind: "active", activeMs: 60_000 }),
      view("queued-active-two", { kind: "active", activeMs: 60_000 }),
    ], now + 120_000);
    expect(globalRows()[0].activeMs).toBe(120_000);
  });

  it("excludes QA in the server, including configured project IDs and fixed QA identities", async () => {
    expect((await ingestUsage(visitor, { ...actor, email: "qa@example.com" }, [view()], now)).excluded).toBe(true);
    expect((await ingestUsage(visitor, { ...actor, email: "qa.houseplanner.viewer.20260831@example.com" }, [view()], now)).excluded).toBe(true);
    expect((await ingestUsage(visitor, actor, [view("project-qa", { context: "project", projectId: "qa-project", section: "overview" })], now)).excluded).toBe(true);
    expect(mock.data.size).toBe(0);
  });

  it("never ingests anonymous or member telemetry anywhere in the isolated QA runtime", async () => {
    vi.stubEnv("HOUSE_PLANNER_ENVIRONMENT", "qa");
    mock.fail = true;
    expect(await ingestUsage(visitor, null, [view("anonymous-qa-view")], now)).toEqual({ accepted: 0, excluded: true });
    expect(await ingestUsage(visitor, actor, [view("member-qa-view", { context: "project", projectId: "unlisted-qa-project", section: "overview" })], now)).toEqual({ accepted: 0, excluded: true });
    mock.cookies.set(USAGE_COOKIE, visitor);
    await expect(recordUsageAction(actor, "record.create", "notes", "qa-action")).resolves.toBeUndefined();
    expect(mock.data.size).toBe(0);
    expect(mock.queryReads).toEqual([]);
  });

  it("applies durable rate limits and preserves successful business actions when usage fails", async () => {
    for (let index = 0; index < 30; index++) await ingestUsage(visitor, null, [view(`rate-event-${index}`)], now + index);
    await expect(ingestUsage(visitor, null, [view("rate-event-extra")], now + 31)).rejects.toMatchObject({ status: 429 });
    await expect(ingestUsage(visitor, null, [view("next-minute-event")], now + 60_000)).resolves.toMatchObject({ accepted: 1 });
    mock.cookies.set(USAGE_COOKIE, visitor); mock.fail = true;
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(recordUsageAction(actor, "record.create", "notes", "private-operation-id")).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledWith(JSON.stringify({ module: "analytics", code: "server_action_unavailable" }));
    warning.mockRestore();
  });

  it("charges duplicate requests to the request limit without adding views or extending activity", async () => {
    for (let index = 0; index < 30; index++) await ingestUsage(visitor, null, [view()], now + index);
    await expect(ingestUsage(visitor, null, [view()], now + 31)).rejects.toMatchObject({ status: 429 });
    expect(globalRows()[0].views).toBe(1);
    expect(values(ANALYTICS_COLLECTIONS.browsers)[0][1].lastAt).toBe(now);
  });

  it("limits waiting on an unavailable database to 1.5 seconds without exposing operation details", async () => {
    vi.useFakeTimers(); mock.hang = true; mock.cookies.set(USAGE_COOKIE, visitor);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const tracked = recordUsageAction(actor, "record.create", "notes", "secret-operation-id");
      await vi.advanceTimersByTimeAsync(1500);
      await expect(tracked).resolves.toBeUndefined();
      expect(warning).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ module: "analytics", code: "server_action_unavailable" }));
    } finally { warning.mockRestore(); vi.useRealTimers(); }
  });
});

describe("analytics queries and retention", () => {
  it("aliases a removed member only inside that project's analytics and retains their usage counts", async () => {
    await ingestUsage(visitor, actor, [view("removed-project-view", { context: "project", projectId: "p1", section: "overview" })], now);
    await ingestUsage(visitor, { ...actor, projectId: "p2" }, [view("other-project-view", { context: "project", projectId: "p2", section: "overview" })], now + 1000);
    mock.data.set(`${MEMBERSHIPS}/p1__${actor.uid}`, { projectId: "p1", uid: actor.uid, removed: true, removedEmail: actor.email, removedAt: Timestamp.fromMillis(now + 2000) });
    const filters = parseUsageFilter(new URLSearchParams({ from: usageDay(now), to: usageDay(now), context: "project", projectId: "p1" }), now);
    const removedProject = await readUsageAnalytics(filters);
    expect(removedProject.totals).toMatchObject({ views: 1, users: 1 });
    expect(removedProject.users).toMatchObject([{ uid: actor.uid, name: "Usuario desactivado", email: "", views: 1 }]);
    expect((await readUsageAnalytics({ ...filters, projectId: "p2" })).users).toMatchObject([{ name: actor.name, email: actor.email }]);
    expect((await readUsageAnalytics({ ...filters, context: "all", projectId: null })).users).toMatchObject([{ name: actor.name, email: actor.email }]);
    expect(globalRows()[0].email).toBe(actor.email);
  });

  it("paginates all summaries and project options and never reads raw event history", async () => {
    const day = usageDay(now);
    for (let index = 0; index < 805; index++) {
      mock.data.set(`${ANALYTICS_COLLECTIONS.days}/${day}/usageRows/row${String(index).padStart(4, "0")}`, {
        day, scope: "global", context: "all", projectId: null, browserKey: `browser${index}`, uid: `user${index}`, name: "User", email: "u@example.com", owner: false, lastAt: now, visits: 1, views: 1, actions: 0, activeMs: 0, sections: {},
      });
      mock.data.set(`housePlannerProjects/project${String(index).padStart(4, "0")}`, { name: `Project ${index}` });
    }
    const response = await readUsageAnalytics(parseUsageFilter(new URLSearchParams({ from: day, to: day }), now));
    expect(response.totals.views).toBe(805); expect(response.totals.users).toBe(805); expect(response.projectOptions).toHaveLength(805);
    expect(mock.queryReads.filter(path => path.includes("usageRows"))).toHaveLength(3);
    expect(mock.queryReads).not.toContain(ANALYTICS_COLLECTIONS.events);
  });

  it("excludes owner-associated anonymous history while retaining other accounts on the browser", async () => {
    await ingestUsage(visitor, null, [view("owner-anon-view")], now);
    await ingestUsage(visitor, { ...actor, uid: "owner", email: "owner@example.com" }, [view("owner-signin-view", { context: "project", projectId: "p1", section: "overview" })], now + 1000);
    await ingestUsage(visitor, actor, [view("shared-user-view", { context: "project", projectId: "p1", section: "overview" })], now + 2000);
    const filters = parseUsageFilter(new URLSearchParams({ from: usageDay(now), to: usageDay(now) }), now);
    expect((await readUsageAnalytics(filters)).totals).toMatchObject({ views: 1, visitors: 1, users: 1 });
    expect((await readUsageAnalytics({ ...filters, includeOwner: true })).totals.views).toBe(3);
  });

  it("deletes every expired child page before its parent and retains metadata/current records", async () => {
    const expiredAt = Timestamp.fromMillis(now - 1);
    const currentAt = Timestamp.fromMillis(now + 1);
    mock.data.set(`${ANALYTICS_COLLECTIONS.days}/2026-01-01`, { expiresAt: expiredAt });
    for (let index = 0; index < 805; index++) mock.data.set(`${ANALYTICS_COLLECTIONS.days}/2026-01-01/usageRows/row${index}`, { expiresAt: expiredAt });
    for (const collection of [ANALYTICS_COLLECTIONS.events, ANALYTICS_COLLECTIONS.sessions, ANALYTICS_COLLECTIONS.scopes, ANALYTICS_COLLECTIONS.browsers]) {
      for (let index = 0; index < 405; index++) mock.data.set(`${collection}/old${index}`, { expiresAt: expiredAt });
      mock.data.set(`${collection}/current`, { expiresAt: currentAt });
    }
    mock.data.set(`${ANALYTICS_COLLECTIONS.metadata}/usage`, { schemaVersion: 1 });
    const result = await cleanupUsage(now);
    expect(result.deleted).toBe(805 + 1 + 405 * 4);
    expect(mock.data.size).toBe(5); expect(mock.data.has(`${ANALYTICS_COLLECTIONS.metadata}/usage`)).toBe(true);
  });
});
