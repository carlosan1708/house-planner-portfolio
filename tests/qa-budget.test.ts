import { describe, expect, it } from "vitest";
import { assertQaBillingTarget, parseQaBudgetMessage, prepareQaBudgetLedger, qaBudgetStatus, reserveQaBudget, type QaBudgetLedger } from "../lib/qa-budget-policy.mjs";

const now = new Date("2026-10-08T12:00:00Z");
const message = (overrides = {}) => ({ message: { data: Buffer.from(JSON.stringify({ budgetDisplayName: "House Planner QA total USD6.00", currencyCode: "USD", budgetAmount: 6, costAmount: 5.75, costIntervalStart: "2026-10-01T00:00:00Z", ...overrides })).toString("base64") } });
describe("isolated QA early cutoff", () => {
  it("cuts off at $5.75 and ignores delayed prior-month reports", () => {
    expect(parseQaBudgetMessage(message(), now)).toMatchObject({ cutoff: true, period: "2026-10" });
    expect(parseQaBudgetMessage(message({ costAmount: 5.74 }), now)?.cutoff).toBe(false);
    expect(parseQaBudgetMessage(message({ costAmount: 4 }), now)?.cutoff).toBe(false);
    expect(parseQaBudgetMessage(message({ costIntervalStart: "2026-09-01T00:00:00Z" }), now)).toBeNull();
  });
  it("accepts only matching signed old/new budget pairs during the in-place transition", () => {
    for (const [budgetDisplayName, budgetAmount] of [["House Planner QA total USD5", 5], ["House Planner QA total USD5.50", 5.5], ["House Planner QA total USD6.00", 6]] as const) {
      expect(parseQaBudgetMessage(message({ budgetDisplayName, budgetAmount, costAmount: 5.74 }), now)?.cutoff).toBe(false);
      expect(parseQaBudgetMessage(message({ budgetDisplayName, budgetAmount }), now)?.cutoff).toBe(true);
      for (const wrongAmount of [5, 5.5, 6].filter((value) => value !== budgetAmount)) {
        expect(() => parseQaBudgetMessage(message({ budgetDisplayName, budgetAmount: wrongAmount }), now)).toThrow("Unexpected QA budget");
      }
    }
  });
  it("rejects another budget, currency and invalid costs", () => {
    for (const value of [{ budgetDisplayName: "Production" }, { currencyCode: "EUR" }, { costAmount: -1 }, { costAmount: "4" }, { budgetAmount: 50 }]) expect(() => parseQaBudgetMessage(message(value), now)).toThrow();
  });
  it("cannot select a production project or arbitrary push identity", () => {
    const env = { HOUSE_PLANNER_ENVIRONMENT: "qa", GOOGLE_CLOUD_PROJECT: "house-planner-qa-example", QA_BUDGET_PUSH_EMAIL: "qa-budget-push@house-planner-qa-example.iam.gserviceaccount.com", QA_BUDGET_PUSH_AUDIENCE: "https://house-planner-qa-000000000000.us-central1.run.app" };
    expect(assertQaBillingTarget(env).projectId).toBe("house-planner-qa-example");
    expect(() => assertQaBillingTarget({ ...env, GOOGLE_CLOUD_PROJECT: "example-house-planner" })).toThrow();
    expect(() => assertQaBillingTarget({ ...env, QA_BUDGET_PUSH_EMAIL: "other@example.com" })).toThrow();
  });
});

describe("durable QA reservation ledger", () => {
  const reserve = (state: unknown, kind: string, id: string, at = now) => reserveQaBudget(state, { kind, id }, at);

  it("includes the base allowance and persists one charge per reservation ID", () => {
    const first = reserve(undefined, "build", "candidate-sha");
    expect(first.status).toMatchObject({ reservedEstimateUsd: 0.85, builds: 1, regressions: 0, estimateOnly: true });
    const retry = reserve(first.state, "build", "candidate-sha");
    expect(retry.changed).toBe(false);
    expect(retry.state).toEqual(first.state);
    expect(first.state.schemaVersion).toBe(1);
    const regression = reserve(first.state, "regression", "github-123-attempt1");
    expect(regression.status.reservedEstimateUsd).toBe(1);
    expect(regression.status.regressions).toBe(1);
    expect(Object.keys(first.state.reservations)).toHaveLength(1); // No mutation of fetched state.
  });

  it("allows eleven builds, rejects the twelfth and keeps regressions limited to ten", () => {
    for (const [kind, maximum] of [["build", 11], ["regression", 10]] as const) {
      let state: QaBudgetLedger | undefined;
      for (let index = 0; index < maximum; index++) state = reserve(state, kind, `run-${index}`).state;
      expect(qaBudgetStatus(state, now)[kind === "build" ? "builds" : "regressions"]).toBe(maximum);
      expect(() => reserve(state, kind, "extra")).toThrow("monthly reservation cutoff");
      expect(reserve(state, kind, "run-0").changed).toBe(false);
    }
  });

  it("preserves the exhausted $5.20 ledger and permits one build plus one regression below $5.75", () => {
    let state: QaBudgetLedger | undefined;
    for (let index = 0; index < 10; index++) state = reserve(state, "build", `b${index}`).state;
    for (let index = 0; index < 8; index++) state = reserve(state, "regression", `r${index}`).state;
    const existing = structuredClone(state);
    expect(prepareQaBudgetLedger(existing, now)).toEqual(existing);
    expect(qaBudgetStatus(existing, now)).toMatchObject({ reservedEstimateUsd: 5.2, builds: 10, regressions: 8, cutoffUsd: 5.75, monthlyTargetUsd: 6 });
    state = reserve(existing, "build", "final-build").state;
    expect(qaBudgetStatus(state, now).reservedEstimateUsd).toBe(5.55);
    state = reserve(state, "regression", "final-regression").state;
    expect(qaBudgetStatus(state, now)).toMatchObject({ reservedEstimateUsd: 5.7, builds: 11, regressions: 9 });
    expect(qaBudgetStatus(existing, now).reservedEstimateUsd).toBe(5.2);
    expect(() => reserve(state, "regression", "extra-regression")).toThrow("monthly reservation cutoff");
    expect(() => reserve(state, "build", "extra-build")).toThrow("monthly reservation cutoff");
    expect(reserve(state, "regression", "final-regression").changed).toBe(false);
  });

  it("rejects stored forecasts above $5.75 even when operation counts are valid", () => {
    let state: QaBudgetLedger | undefined;
    for (let index = 0; index < 11; index++) state = reserve(state, "build", `b${index}`).state;
    for (let index = 0; index < 9; index++) state = reserve(state, "regression", `r${index}`).state;
    const entry = state!.reservations["regression:r0"];
    const overBudget = { ...state, reservations: { ...state!.reservations, "regression:r9": entry } };
    expect(() => prepareQaBudgetLedger(overBudget, now)).toThrow("forecast cutoff");
  });

  it("rolls forward only a valid older month and preserves counts in a legacy valid ledger", () => {
    const prior = reserve(undefined, "build", "candidate", new Date("2026-09-08T12:00:00Z")).state;
    const fresh = prepareQaBudgetLedger(prior, now);
    expect(fresh).toMatchObject({ period: "2026-10", reservations: {}, baseAllowanceUsd: 0.5 });
    const current = reserve(undefined, "build", "candidate").state;
    const legacy = { period: current.period, reservations: current.reservations, baseAllowanceUsd: current.baseAllowanceUsd };
    expect(prepareQaBudgetLedger(legacy, now)).toEqual(current);
    expect(reserve(legacy, "build", "candidate").changed).toBe(false);
    expect(() => prepareQaBudgetLedger({ ...prior, baseAllowanceUsd: 0 }, now)).toThrow("allowance");
  });

  it.each([
    null,
    {},
    { period: "2026-10", baseAllowanceUsd: 0.5, reservations: [], schemaVersion: 1 },
    { period: "2026-13", baseAllowanceUsd: 0.5, reservations: {}, schemaVersion: 1 },
    { period: "2026-11", baseAllowanceUsd: 0.5, reservations: {}, schemaVersion: 1 },
    { period: "2026-10", baseAllowanceUsd: 0.5, reservations: {}, schemaVersion: 2 },
    { period: "2026-10", baseAllowanceUsd: "0.5", reservations: {}, schemaVersion: 1 },
    { period: "2026-10", baseAllowanceUsd: 0.5, reservations: {}, paidAllowanceReset: true },
  ])("rejects malformed or future stored ledger %#", (ledger) => {
    expect(() => prepareQaBudgetLedger(ledger, now)).toThrow();
  });

  it("rejects tampered reservation prices, IDs, timestamps and stored excess counts", () => {
    const base = reserve(undefined, "build", "one").state;
    const entry = base.reservations["build:one"];
    for (const changed of [{ ...entry, amountUsd: -1 }, { ...entry, amountUsd: 0.01 }, { ...entry, kind: "other" }, { ...entry, createdAt: "bad-date" }, { ...entry, createdAt: "2026-09-01T00:00:00Z" }, { ...entry, createdAt: "2026-10-09T00:00:00Z" }]) {
      expect(() => prepareQaBudgetLedger({ ...base, reservations: { "build:one": changed } }, now)).toThrow();
    }
    expect(() => prepareQaBudgetLedger({ ...base, reservations: { "build:../escape": entry } }, now)).toThrow();
    expect(() => prepareQaBudgetLedger({ ...base, reservations: Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`build:${index}`, entry])) }, now)).toThrow("operation limits");
  });

  it("rejects unknown actions and unsafe reservation IDs", () => {
    for (const [kind, id] of [["server", "1"], ["build", ""], ["regression", "../escape"], ["build", "x".repeat(121)]]) {
      expect(() => reserve(undefined, kind, id)).toThrow("reservation ID");
    }
  });
});
