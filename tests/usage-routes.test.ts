import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MEMBER_PERMISSIONS, type MemberRecord } from "@/lib/project";
import { UsageError } from "@/lib/usage";

const mock = vi.hoisted(() => ({ member: vi.fn(), owner: vi.fn(), ingest: vi.fn(), read: vi.fn(), cleanup: vi.fn(), scheduler: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSessionMember: mock.member, requirePlatformOwner: mock.owner }));
vi.mock("@/lib/scheduler-auth", () => ({ verifySchedulerRequest: mock.scheduler }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "dd80230c-7a65-4c15-88e5-764ae0791234" }) }) }));
vi.mock("@/lib/usage-store", () => ({ ingestUsage: mock.ingest, readUsageAnalytics: mock.read, cleanupUsage: mock.cleanup, usageVisitor: (value: string) => value, usageCookieOptions: { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 90 * 86_400 } }));

import { POST as events } from "@/app/api/usage/events/route";
import { GET as analytics } from "@/app/api/admin/analytics/route";
import { POST as cleanup } from "@/app/api/usage/cleanup/route";

const actor: MemberRecord = { uid: "u1", name: "User", email: "user@example.com", projectId: "p1", projectName: "House", role: "admin", status: "approved", isPersonal: false, permissions: DEFAULT_MEMBER_PERMISSIONS, folderAccess: { mode: "all", folderIds: [], allowUnfiled: true } };
const batch = { expectedEmail: null, events: [{ id: "event-00001", kind: "view", context: "access", section: "access" }] };
const request = (body: unknown = batch, overrides: HeadersInit = {}) => new Request("https://app.test/api/usage/events", { method: "POST", headers: { Origin: "https://app.test", "Content-Type": "application/json", ...overrides }, body: JSON.stringify(body) });

beforeEach(() => {
  Object.values(mock).forEach(fn => fn.mockReset()); mock.member.mockResolvedValue(null); mock.owner.mockResolvedValue(actor);
  mock.ingest.mockResolvedValue({ accepted: 1, excluded: false }); mock.read.mockResolvedValue({ totals: { views: 1 } });
  mock.scheduler.mockResolvedValue(false); mock.cleanup.mockResolvedValue({ deleted: 0 });
  vi.stubEnv("HOUSE_PLANNER_PUBLIC_URL", "https://app.test");
});

describe("analytics HTTP boundaries", () => {
  it("accepts guest usage privately, sets an HttpOnly visitor cookie and ignores supplied identities/content", async () => {
    const response = await events(request({ ...batch, uid: "spoofed", events: [{ ...batch.events[0], content: "private" }] }));
    expect(response.status).toBe(202); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    const recorded = mock.ingest.mock.calls[0][2][0];
    expect(recorded).not.toHaveProperty("content"); expect(recorded).not.toHaveProperty("uid");
  });

  it("rejects foreign origins and oversized bodies before database reads", async () => {
    expect((await events(request(batch, { Origin: "https://attacker.test" }))).status).toBe(403);
    expect((await events(request(batch, { "Content-Length": "16385" }))).status).toBe(413);
    expect((await events(request({ ...batch, secret: "a".repeat(16_385) }))).status).toBe(413);
    expect(mock.member).not.toHaveBeenCalled(); expect(mock.ingest).not.toHaveBeenCalled();
  });

  it("accepts the real proxy host when standalone exposes an internal request URL", async () => {
    const host = "candidate---house-planner-prod-abc-uc.a.run.app";
    const proxied = new Request("http://localhost:8080/api/usage/events", {
      method: "POST", headers: { Origin: `https://${host}`, Host: host, "x-forwarded-proto": "https", "Content-Type": "application/json" }, body: JSON.stringify(batch),
    });
    expect((await events(proxied)).status).toBe(202);
    expect(mock.ingest).toHaveBeenCalledOnce();
  });

  it("rejects external origins, spoofed forwarded hosts and malformed proxy values", async () => {
    const realHost = "candidate---house-planner-prod-abc-uc.a.run.app";
    const hostileHeaders: Array<Record<string, string>> = [
      {}, { "x-forwarded-host": "attacker.test" }, { Host: "attacker.test/path" }, { Host: "attacker.test@real.test" },
      { Host: "attacker.test", "x-forwarded-proto": "https,http" }, { Host: "attacker.test", "x-forwarded-proto": "javascript" },
    ];
    for (const overrides of hostileHeaders) {
      const proxied = new Request("http://localhost:8080/api/usage/events", {
        method: "POST", headers: { Origin: "https://attacker.test", Host: realHost, "x-forwarded-proto": "https", "Content-Type": "application/json", ...overrides }, body: JSON.stringify(batch),
      });
      expect((await events(proxied)).status).toBe(403);
    }
    expect(mock.ingest).not.toHaveBeenCalled();
  });

  it("excludes unauthenticated headless QA before it records browser visits", async () => {
    const response = await events(request(batch, { "User-Agent": "Mozilla/5.0 HeadlessChrome/130" }));
    expect(response.status).toBe(202); expect(await response.json()).toEqual({ accepted: 0, excluded: true });
    expect(mock.ingest).not.toHaveBeenCalled();
  });

  it("rejects stale identity batches and arbitrary project claims", async () => {
    mock.member.mockResolvedValue(actor);
    expect((await events(request())).status).toBe(409);
    expect((await events(request({ expectedEmail: actor.email, events: [{ id: "event-00001", kind: "view", context: "project", section: "documents", projectId: "other" }] }))).status).toBe(403);
    expect(mock.ingest).not.toHaveBeenCalled();
  });

  it("propagates durable rate limits and logs only a generic ingestion failure code", async () => {
    mock.ingest.mockRejectedValueOnce(new UsageError("Analytics rate exceeded", 429));
    const limited = await events(request()); expect(limited.status).toBe(429); expect(limited.headers.get("retry-after")).toBe("60");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mock.ingest.mockRejectedValueOnce(new Error("private error details"));
    const unavailable = await events(request()); expect(unavailable.status).toBe(503);
    expect(warning).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ module: "analytics", code: "event_ingestion_unavailable" })); warning.mockRestore();
  });

  it("requires the platform owner for global metrics and validates dates before querying", async () => {
    mock.owner.mockResolvedValue(null);
    expect((await analytics(new Request("https://app.test/api/admin/analytics"))).status).toBe(403); expect(mock.read).not.toHaveBeenCalled();
    mock.owner.mockResolvedValue(actor);
    expect((await analytics(new Request("https://app.test/api/admin/analytics?from=2026-02-30"))).status).toBe(400);
    const response = await analytics(new Request("https://app.test/api/admin/analytics?projectId=foreign-project"));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("private, no-store");
    expect(mock.read.mock.calls[0][0]).toMatchObject({ projectId: "foreign-project", context: "project", includeOwner: false });
  });

  it("allows cleanup only with scheduler OIDC authentication", async () => {
    expect((await cleanup(new Request("https://app.test/api/usage/cleanup", { method: "POST" }))).status).toBe(401); expect(mock.cleanup).not.toHaveBeenCalled();
    mock.scheduler.mockResolvedValue(true);
    const response = await cleanup(new Request("https://app.test/api/usage/cleanup", { method: "POST" }));
    expect(response.status).toBe(200); expect(mock.cleanup).toHaveBeenCalledOnce(); expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
