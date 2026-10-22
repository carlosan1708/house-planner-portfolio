import { defineConfig, devices } from "@playwright/test";
import { validateQaTarget } from "./scripts/qa-target-policy.mjs";

const target = validateQaTarget(process.env);
const reportSuite = process.env.QA_REPORT_SUITE || process.env.QA_REGRESSION_SUITE || "full";

export default defineConfig({
  testDir: "./e2e",
  testMatch: process.env.QA_REGRESSION_SUITE === "analytics" ? "qa-analytics.spec.ts" : process.env.QA_REGRESSION_SUITE === "permissions" ? "qa-permissions.spec.ts" : "qa-regression.spec.ts",
  globalSetup: "./e2e/qa/preflight.ts",
  outputDir: `test-results/qa/browser-${reportSuite}`,
  timeout: 30 * 60_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [
    ["list"],
    ["./e2e/qa/reporter.ts"],
    ["html", { outputFolder: `playwright-report/qa/${reportSuite}`, open: "never" }],
    ["json", { outputFile: process.env.QA_REPORT_FILE || `test-results/qa/${reportSuite}.json` }],
  ],
  use: {
    baseURL: target.baseUrl,
    // Scale-to-zero QA can need a longer first request while clients warm up.
    actionTimeout: 60_000,
    navigationTimeout: 90_000,
    ignoreHTTPSErrors: false,
  },
  projects: [{ name: "qa-chromium", use: { ...devices["Desktop Chrome"] } }],
});
