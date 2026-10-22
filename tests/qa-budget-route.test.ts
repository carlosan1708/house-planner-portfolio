import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/qa/budget/route";

const state = vi.hoisted(() => ({ verify: vi.fn(), set: vi.fn(), billingRequest: vi.fn(), getClient: vi.fn(), collection: vi.fn(), doc: vi.fn() }));
vi.mock("@/lib/firebase-admin", () => ({ firestore: { collection: state.collection } }));
vi.mock("google-auth-library", () => ({
  OAuth2Client: class { verifyIdToken(options: unknown) { return state.verify(options); } },
  GoogleAuth: class { getClient() { return state.getClient(); } },
}));

const now = new Date("2026-10-08T12:00:00Z");
const pushEmail = "qa-budget-push@house-planner-qa-example.iam.gserviceaccount.com";
const audience = "https://house-planner-qa-000000000000.us-central1.run.app";
const body = (overrides = {}) => ({ message: { data: Buffer.from(JSON.stringify({ budgetDisplayName: "House Planner QA total USD6.00", currencyCode: "USD", budgetAmount: 6, costAmount: 5.75, costIntervalStart: "2026-10-01T00:00:00Z", ...overrides })).toString("base64") } });
const request = (data: unknown = body(), authorization = "Bearer signed-pubsub-token") => new Request(`${audience}/api/qa/budget`, { method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json" }, body: typeof data === "string" ? data : JSON.stringify(data) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv("HOUSE_PLANNER_ENVIRONMENT", "qa");
  vi.stubEnv("GOOGLE_CLOUD_PROJECT", "house-planner-qa-example");
  vi.stubEnv("QA_BUDGET_PUSH_EMAIL", pushEmail);
  vi.stubEnv("QA_BUDGET_PUSH_AUDIENCE", audience);
  state.verify.mockResolvedValue({ getPayload: () => ({ email_verified: true, email: pushEmail }) });
  state.collection.mockReturnValue({ doc: state.doc });
  state.doc.mockReturnValue({ set: state.set });
  state.set.mockResolvedValue(undefined);
  state.getClient.mockResolvedValue({ request: state.billingRequest });
  state.billingRequest.mockResolvedValue({});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("isolated QA budget webhook", () => {
  it("does not expose a billing handler in production", async () => {
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "example-house-planner");
    expect((await POST(request())).status).toBe(404);
    expect(state.verify).not.toHaveBeenCalled();
    expect(state.set).not.toHaveBeenCalled();
    expect(state.billingRequest).not.toHaveBeenCalled();
  });

  it("requires a valid Google JWT and the exact push identity", async () => {
    expect((await POST(request(body(), ""))).status).toBe(401);
    state.verify.mockRejectedValueOnce(new Error("invalid signature"));
    expect((await POST(request())).status).toBe(401);
    state.verify.mockResolvedValueOnce({ getPayload: () => ({ email_verified: true, email: "qa-runner@example.com" }) });
    expect((await POST(request())).status).toBe(403);
    state.verify.mockResolvedValueOnce({ getPayload: () => ({ email_verified: "false", email: pushEmail }) });
    expect((await POST(request())).status).toBe(403);
    expect(state.set).not.toHaveBeenCalled();
    expect(state.billingRequest).not.toHaveBeenCalled();
  });

  it("acknowledges signed malformed payloads without data writes or repeated cutoff attempts", async () => {
    for (const value of ["{", {}, { message: { data: "not-base64-json" } }, body({ budgetDisplayName: "Production" }), body({ currencyCode: "EUR" }), "x".repeat(20_001)]) {
      const response = await POST(request(value));
      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({ acknowledged: true, ignored: true });
    }
    expect(state.set).not.toHaveBeenCalled();
    expect(state.billingRequest).not.toHaveBeenCalled();
  });

  it("ignores stale month's budget even when it is over the cutoff", async () => {
    const response = await POST(request(body({ costIntervalStart: "2026-09-01T00:00:00Z", costAmount: 8 })));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ acknowledged: true, stale: true });
    expect(state.set).not.toHaveBeenCalled();
    expect(state.billingRequest).not.toHaveBeenCalled();
  });

  it("stores a below-cutoff report without removing an earlier sticky cutoff", async () => {
    const response = await POST(request(body({ costAmount: 5.74 })));
    expect(response.status).toBe(200);
    expect(state.set).toHaveBeenCalledWith({ budgetPeriod: "2026-10", reportedCostUsd: 5.74, reportedAt: now }, { merge: true });
    expect(state.billingRequest).not.toHaveBeenCalled();
  });

  it("accepts signed reports from both prior budgets during the in-place transition", async () => {
    for (const [budgetDisplayName, budgetAmount] of [["House Planner QA total USD5.50", 5.5], ["House Planner QA total USD5", 5]] as const) {
      const response = await POST(request(body({ budgetDisplayName, budgetAmount, costAmount: 5.74 })));
      expect(response.status).toBe(200);
      expect(state.set).toHaveBeenLastCalledWith({ budgetPeriod: "2026-10", reportedCostUsd: 5.74, reportedAt: now }, { merge: true });
    }
    expect(state.billingRequest).not.toHaveBeenCalled();
  });

  it("disables billing only for the fixed QA project at the exact $5.75 threshold", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(state.verify).toHaveBeenCalledWith({ idToken: "signed-pubsub-token", audience });
    expect(state.collection).toHaveBeenCalledWith("housePlannerQaControls");
    expect(state.doc).toHaveBeenCalledWith("budget");
    expect(state.set).toHaveBeenCalledWith({ budgetPeriod: "2026-10", reportedCostUsd: 5.75, reportedAt: now, cutoffPeriod: "2026-10" }, { merge: true });
    expect(state.billingRequest).toHaveBeenCalledTimes(1);
    expect(state.billingRequest).toHaveBeenCalledWith({ url: "https://cloudbilling.googleapis.com/v1/projects/house-planner-qa-example/billingInfo", method: "PUT", data: { billingAccountName: "" } });
  });

  it("asks Pub/Sub to retry a failed cutoff without removing the stored block", async () => {
    state.billingRequest.mockRejectedValueOnce(new Error("transient billing error"));
    expect((await POST(request())).status).toBe(503);
    expect(state.set).toHaveBeenCalledWith(expect.objectContaining({ cutoffPeriod: "2026-10" }), { merge: true });
    expect(state.billingRequest).toHaveBeenCalledTimes(1);
    expect((await POST(request())).status).toBe(200);
    expect(state.billingRequest).toHaveBeenCalledTimes(2);
  });

  it("retries a failed control write before attempting billing changes", async () => {
    state.set.mockRejectedValueOnce(new Error("transient Firestore failure"));
    expect((await POST(request())).status).toBe(503);
    expect(state.billingRequest).not.toHaveBeenCalled();
  });
});
