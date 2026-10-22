import { describe, expect, it } from "vitest";
import { FULL_QA_SUITES, QA_IDENTITIES, qaBudgetReservation, qaReportStatus, qaSuitePlan, validateQaEnvironment, validateQaTarget } from "../scripts/qa-target-policy.mjs";

const env = { QA_BASE_URL: "https://house-planner-qa-123456789.us-central1.run.app", QA_FIREBASE_PROJECT_ID: "house-planner-qa-example" };
const source = { commit: "a".repeat(40), tree: "b".repeat(40) };
const metadata = { environment: "qa", isolated: true, emulator: false, cloudProjectId: env.QA_FIREBASE_PROJECT_ID, primaryProjectId: "qa-primary", isolationProjectId: "qa-isolation", sourceCommit: source.commit, sourceTree: source.tree, service: "house-planner-qa", revision: "house-planner-qa-00001-abc" };

describe("authenticated QA fails closed before sign-in or mutation", () => {
  it("requires an explicit separate Cloud Run target and separate Firebase project", () => {
    expect(validateQaTarget(env)).toMatchObject({ cloudProjectId: env.QA_FIREBASE_PROJECT_ID, emulator: false });
    for (const url of [undefined, "https://house-planner.example.com", "https://candidate-abc---house-planner-prod-example-uc.a.run.app", "https://evil.example/", "http://house-planner-qa-123456789.us-central1.run.app", `${env.QA_BASE_URL}/projects/qa-primary`, `${env.QA_BASE_URL}?project=qa-primary`]) expect(() => validateQaTarget({ ...env, QA_BASE_URL: url })).toThrow();
    expect(() => validateQaTarget({ ...env, QA_FIREBASE_PROJECT_ID: "example-house-planner" })).toThrow();
    expect(() => validateQaTarget({ ...env, QA_PROJECT_ID: "private-project-placeholder" })).toThrow();
  });

  it("separates emulator loopback from an explicit authenticated Cloud Run proxy", () => {
    expect(validateQaTarget({ QA_BASE_URL: "http://localhost:3000", QA_FIREBASE_PROJECT_ID: "demo-house-planner-qa" }).emulator).toBe(true);
    expect(() => validateQaTarget({ ...env, QA_BASE_URL: "http://localhost:8085" })).toThrow();
    const proxy = { ...env, QA_BASE_URL: "http://localhost:8085", QA_TARGET_URL: env.QA_BASE_URL, QA_CLOUD_PROXY: "1" };
    expect(validateQaTarget(proxy)).toMatchObject({ emulator: false, targetUrl: env.QA_BASE_URL, baseUrl: "http://localhost:8085" });
    expect(() => validateQaTarget({ ...proxy, QA_TARGET_URL: "https://house-planner.example.com" })).toThrow();
  });

  it("requires server metadata to agree on isolation, exact source, project and revision", () => {
    const target = validateQaTarget(env);
    expect(validateQaEnvironment(metadata, target, source)).toEqual(metadata);
    for (const mismatch of [{ environment: "production" }, { isolated: false }, { emulator: true }, { cloudProjectId: "example-house-planner" }, { primaryProjectId: "other-project" }, { sourceCommit: "c".repeat(40) }, { sourceTree: "c".repeat(40) }, { service: "house-planner-prod" }, { revision: "house-planner-prod-00001-abc" }]) expect(() => validateQaEnvironment({ ...metadata, ...mismatch }, target, source)).toThrow();
  });
});

describe("full QA coverage and report truthfulness", () => {
  it("reserves every paid regression consistently while emulators and cleanup remain free", () => {
    const target = validateQaTarget(env);
    expect(qaBudgetReservation(target, "full", { GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "2" })).toEqual({ kind: "regression", id: "gh-123-2" });
    expect(qaBudgetReservation(target, "permissions", {}, 456)).toEqual({ kind: "regression", id: "local-456" });
    expect(qaBudgetReservation(target, "cleanup", {})).toBeNull();
    expect(qaBudgetReservation({ ...target, emulator: true }, "full", {})).toBeNull();
    expect(() => qaBudgetReservation(target, "full", { GITHUB_RUN_ID: "not-a-run" })).toThrow();
  });
  it("aggregates every focused suite and the six-user permissions matrix", () => {
    expect(qaSuitePlan("full")).toEqual(["permissions", "core", "expenses", "distribution", "notes", "documents", "aesthetics", "analytics"]);
    expect(new Set(FULL_QA_SUITES).size).toBe(8);
    expect(new Set(Object.values(QA_IDENTITIES)).size).toBe(6);
    expect(() => qaSuitePlan("typo")).toThrow();
  });

  it("fails a suite for omitted tests, empty discovery, runner failure or report errors", () => {
    const passed = { stats: { expected: 6, unexpected: 0, skipped: 0, flaky: 0 }, errors: [] };
    expect(qaReportStatus(passed, 0)).toBe("passed");
    expect(qaReportStatus(passed, 1)).toBe("failed");
    expect(qaReportStatus(null, 0)).toBe("failed");
    for (const stats of [{ expected: 0 }, { skipped: 1 }, { unexpected: 1 }, { flaky: 1 }]) expect(qaReportStatus({ ...passed, stats: { ...passed.stats, ...stats } }, 0)).toBe("failed");
    expect(qaReportStatus({ ...passed, errors: [{ message: "Cleanup failed" }] }, 0)).toBe("failed");
  });
});
