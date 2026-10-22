import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FullResult, Reporter, TestCase, TestResult, TestStep } from "@playwright/test/reporter";

// Preserve granular feature outcomes even while a shared fixture lease requires
// the legacy feature flow to stay in a single serialized Playwright test.
export default class QaCaseReporter implements Reporter {
  private tests: Array<{ name: string; status: string; durationMs: number }> = [];
  private steps: Array<{ test: string; name: string; status: string; durationMs: number }> = [];

  onTestEnd(test: TestCase, result: TestResult) {
    this.tests.push({ name: test.titlePath().join(" › "), status: result.status, durationMs: result.duration });
  }

  onStepEnd(test: TestCase, _result: TestResult, step: TestStep) {
    if (step.category !== "test.step") return;
    this.steps.push({ test: test.title, name: step.title, status: step.error ? "failed" : "passed", durationMs: step.duration });
  }

  onEnd(result: FullResult) {
    const directory = resolve("test-results", "qa");
    mkdirSync(directory, { recursive: true });
    writeFileSync(resolve(directory, `${process.env.QA_REPORT_SUITE || "full"}-cases.json`), JSON.stringify({ status: result.status, tests: this.tests, featureCases: this.steps }, null, 2));
  }
}
