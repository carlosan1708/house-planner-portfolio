import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Data = Record<string, unknown>;
type Ref = { id: string };
const mock = vi.hoisted(() => ({
  records: new Map<string, Data>(), writes: [] as Array<{ id: string; data: Data }>, version: 0,
}));
vi.mock("@/lib/auth", () => ({ canAccessFolder: vi.fn() }));
vi.mock("@/lib/firebase-admin", () => ({ firestore: {
  collection: (name: string) => ({ doc: (id: string): Ref => {
    if (name !== "housePlannerDocumentSearchUsage") throw new Error("Unexpected collection");
    return { id };
  } }),
  runTransaction: async (callback: (transaction: {
    getAll: (...refs: Ref[]) => Promise<Array<{ data: () => Data | undefined }>>;
    set: (ref: Ref, data: Data) => void;
  }) => Promise<unknown>) => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const version = mock.version, current = new Map([...mock.records].map(([id, data]) => [id, structuredClone(data)]));
      const writes: Array<{ id: string; data: Data }> = [];
      await callback({
        getAll: async (...refs) => refs.map(ref => ({ data: () => current.get(ref.id) })),
        set: (ref, data) => writes.push({ id: ref.id, data }),
      });
      if (version !== mock.version) continue;
      writes.forEach(write => { mock.records.set(write.id, write.data); mock.writes.push(write); });
      if (writes.length) mock.version += 1;
      return;
    }
    throw new Error("Synthetic transaction contention");
  },
} }));

import { DOCUMENT_SEARCH_LIMITS, reserveDocumentSearch } from "@/lib/document-search-quota";
const actor = { uid: "synthetic-user", projectId: "synthetic-project" };
const now = Date.parse("2026-10-16T14:00:00Z");
const day = "2026-10-16", month = "2026-10";
const key = (...parts: string[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
const keys = {
  user: key("user-day", actor.uid, day), projectDay: key("project-day", actor.projectId, day),
  projectMonth: key("project-month", actor.projectId, month), cooldown: key("cooldown", actor.uid),
};

beforeEach(() => { mock.records.clear(); mock.writes.length = 0; mock.version = 0; });

describe("durable semantic search reservations", () => {
  it("atomically reserves user-day, project-day, project-month and cooldown with hashed identifiers only", async () => {
    await reserveDocumentSearch(actor, now);
    expect(mock.records.size).toBe(4); expect(mock.records.get(keys.user)?.count).toBe(1);
    expect(mock.records.get(keys.projectDay)?.count).toBe(1); expect(mock.records.get(keys.projectMonth)?.count).toBe(1);
    expect(mock.records.get(keys.cooldown)?.lastReservedAtMs).toBe(now);
    expect([...mock.records.keys()].every(id => /^[0-9a-f]{64}$/.test(id))).toBe(true);
    const serialized = JSON.stringify([...mock.records]);
    expect(serialized).not.toMatch(/synthetic-user|synthetic-project|query|description|email|response|results/);
    expect(mock.writes.every(write => Object.keys(write.data).every(field => ["count", "expiresAt", "lastReservedAtMs"].includes(field)))).toBe(true);
  });

  it("makes cooldown global across the same account's projects and never refunds a reserved failure", async () => {
    await reserveDocumentSearch(actor, now);
    const writes = mock.writes.length;
    await expect(reserveDocumentSearch({ ...actor, projectId: "other-project" }, now + 1)).rejects.toMatchObject({ code: "search_limit", status: 429, retryAfter: 10 });
    expect(mock.writes).toHaveLength(writes); expect(mock.records.get(keys.user)?.count).toBe(1);
    await reserveDocumentSearch({ ...actor, projectId: "other-project" }, now + DOCUMENT_SEARCH_LIMITS.cooldownMs);
    expect(mock.records.get(keys.user)?.count).toBe(2);
    expect(mock.records.get(key("project-day", "other-project", day))?.count).toBe(1);
  });

  it("enforces the20account-wide daily limit even when the account switches projects", async () => {
    mock.records.set(keys.user, { count: 19 });
    await reserveDocumentSearch({ ...actor, projectId: "project-one" }, now);
    await expect(reserveDocumentSearch({ ...actor, projectId: "project-two" }, now + 10_000)).rejects.toMatchObject({ code: "search_limit", status: 429, retryAfter: 35990 });
    expect(mock.records.get(keys.user)?.count).toBe(20);
    expect(mock.records.has(key("project-day", "project-two", day))).toBe(false);
  });

  it.each([
    ["user", 20, 36000], ["projectDay", 100, 36000], ["projectMonth", 1000, 1332000],
  ] as const)("enforces the%s ceiling before any partial write", async (scope, limit, retryAfter) => {
    mock.records.set(keys[scope], { count: limit });
    await expect(reserveDocumentSearch(actor, now)).rejects.toMatchObject({ code: "search_limit", status: 429, retryAfter });
    expect(mock.writes).toEqual([]);
  });

  it("prevents concurrent requests from bypassing the same account cooldown", async () => {
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => reserveDocumentSearch(actor, now)));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected").every(result => result.reason.code === "search_limit")).toBe(true);
    expect(mock.records.get(keys.user)?.count).toBe(1); expect(mock.records.get(keys.projectDay)?.count).toBe(1);
  });

  it("prevents different concurrent accounts from exceeding a shared project ceiling", async () => {
    mock.records.set(keys.projectDay, { count: 99 });
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => reserveDocumentSearch({ ...actor, uid: `user-${index}` }, now)));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(mock.records.get(keys.projectDay)?.count).toBe(100); expect(mock.records.get(keys.projectMonth)?.count).toBe(1);
  });

  it("resets daily ceilings at UTC midnight while preserving the current month and cooldown", async () => {
    mock.records.set(keys.user, { count: 20 }); mock.records.set(keys.projectDay, { count: 100 }); mock.records.set(keys.projectMonth, { count: 99 });
    await reserveDocumentSearch(actor, Date.parse("2026-10-17T00:00:00Z"));
    expect(mock.records.get(key("user-day", actor.uid, "2026-10-17"))?.count).toBe(1);
    expect(mock.records.get(key("project-day", actor.projectId, "2026-10-17"))?.count).toBe(1);
    expect(mock.records.get(keys.projectMonth)?.count).toBe(100);
  });

  it("keeps the cooldown across the day boundary instead of opening a second immediate reservation", async () => {
    const late = Date.parse("2026-10-16T23:59:58Z"); await reserveDocumentSearch(actor, late);
    await expect(reserveDocumentSearch(actor, late + 4000)).rejects.toMatchObject({ code: "search_limit", retryAfter: 6 });
    expect(mock.records.has(key("user-day", actor.uid, "2026-10-17"))).toBe(false);
  });

  it("resets the monthly ceiling independently at the start of the next month", async () => {
    mock.records.set(keys.projectMonth, { count: 1000 });
    await reserveDocumentSearch(actor, Date.parse("2026-11-01T00:00:00Z"));
    expect(mock.records.get(key("project-month", actor.projectId, "2026-11"))?.count).toBe(1);
  });

  it.each([-1, 1.5, "0", Infinity, NaN, null, undefined])("fails closed on corrupt durable counters instead of resetting them: %j", async value => {
    mock.records.set(keys.projectDay, { count: value });
    await expect(reserveDocumentSearch(actor, now)).rejects.toMatchObject({ code: "semantic_unavailable", status: 503 });
    expect(mock.writes).toEqual([]);
  });
});
