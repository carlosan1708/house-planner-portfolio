import { describe, expect, it } from "vitest";
import { normalizeQaRunId, normalizeQaRunSuite, qaRunLeaseAvailable, QA_RUN_LEASE_MS } from "@/lib/qa-run";
import { qaShouldResetAfterRun } from "@/lib/qa-run-policy";

describe("QA regression run lease", () => {
  it("accepts only bounded run ids and known suites", () => {
    expect(normalizeQaRunId("qa_20260831-abcdef")).toBe("qa_20260831-abcdef");
    expect(normalizeQaRunId("short")).toBe("");
    expect(normalizeQaRunId("../unsafe-run")).toBe("");
    expect(normalizeQaRunSuite("smoke")).toBe("smoke");
    expect(normalizeQaRunSuite("full")).toBe("full");
    expect(normalizeQaRunSuite("cleanup")).toBe("cleanup");
    expect(normalizeQaRunSuite("other")).toBeNull();
  });

  it("rejects overlapping runs while allowing renewals and expired leases", () => {
    const now = Date.now();
    expect(qaRunLeaseAvailable("", 0, "qa-current", now)).toBe(true);
    expect(qaRunLeaseAvailable("qa-current", now + QA_RUN_LEASE_MS, "qa-current", now)).toBe(true);
    expect(qaRunLeaseAvailable("qa-other", now + QA_RUN_LEASE_MS, "qa-current", now)).toBe(false);
    expect(qaRunLeaseAvailable("qa-other", now - 1, "qa-current", now)).toBe(true);
  });

  it("cleans successful suites and preserves failed state", () => {
    expect(qaShouldResetAfterRun("smoke", true)).toBe(true);
    expect(qaShouldResetAfterRun("full", true)).toBe(true);
    expect(qaShouldResetAfterRun("expenses", true)).toBe(true);
    expect(qaShouldResetAfterRun("aesthetics", true)).toBe(true);
    expect(qaShouldResetAfterRun("cleanup", true)).toBe(false);
    expect(qaShouldResetAfterRun("smoke", false)).toBe(false);
    expect(qaShouldResetAfterRun("full", false)).toBe(false);
    expect(qaShouldResetAfterRun("expenses", false)).toBe(false);
    expect(qaShouldResetAfterRun("aesthetics", false)).toBe(false);
  });
});
