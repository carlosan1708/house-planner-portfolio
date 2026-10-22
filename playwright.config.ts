import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
if (!["127.0.0.1", "localhost"].includes(new URL(baseURL).hostname)) throw new Error("Routine browser tests must use a local mock/demo server. Use the guarded QA runner for cloud tests.");
const compatibility = process.env.PLAYWRIGHT_COMPATIBILITY === "1";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results/playwright",
  testIgnore: ["qa-regression.spec.ts", "qa-analytics.spec.ts", "qa-permissions.spec.ts"],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"], ["html", { outputFolder: "playwright-report/local", open: "never" }]],
  use: { baseURL, trace: "retain-on-failure" },
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : { command: process.env.CI ? "npm run start -- --hostname 127.0.0.1" : "npm run dev -- --webpack --hostname 127.0.0.1", url: baseURL, reuseExistingServer: !process.env.CI, timeout: 120_000, env: { GOOGLE_CLOUD_PROJECT: "demo-house-planner-qa", HOUSE_PLANNER_ENVIRONMENT: "qa", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099", STORAGE_EMULATOR_HOST: "http://127.0.0.1:9199", FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199", NEXT_PUBLIC_HOUSE_PLANNER_ENVIRONMENT: "qa", NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-house-planner-qa", NEXT_PUBLIC_FIREBASE_API_KEY: "demo-key", NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "demo-house-planner-qa.firebaseapp.com", NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "demo-house-planner-qa.firebasestorage.app", NEXT_PUBLIC_FIREBASE_APP_ID: "demo-app", NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "000000000000", NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099", HOUSE_PLANNER_BUCKET: "demo-house-planner-qa.firebasestorage.app", HOUSE_PLANNER_ADMIN_EMAIL: "", HOUSE_PLANNER_PUBLIC_URL: baseURL, QA_AI_ENABLED: "0" } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }, ...(compatibility ? [{ name: "firefox", use: { ...devices["Desktop Firefox"] } }, { name: "webkit", use: { ...devices["Desktop Safari"] } }, { name: "mobile-chromium", use: { ...devices["Pixel 7"] } }] : [])],
});
