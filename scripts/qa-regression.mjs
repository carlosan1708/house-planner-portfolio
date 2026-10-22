import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { FULL_QA_SUITES, QA_IDENTITIES, qaBudgetReservation, qaReportStatus, qaSuitePlan, validateQaEnvironment, validateQaTarget } from "./qa-target-policy.mjs";

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

loadEnvFile(resolve(process.cwd(), ".env.qa.local"));
const requested = process.argv.find((argument) => argument.startsWith("--suite="))?.split("=")[1] || "full";
const resultDirectory = resolve("test-results", "qa");
mkdirSync(resultDirectory, { recursive: true });
for (const name of ["release-qa-evidence.json", "summary.json", "summary.md", ...[...FULL_QA_SUITES, "smoke", "cleanup"].flatMap((suite) => [`${suite}.json`, `${suite}-cases.json`])]) rmSync(resolve(resultDirectory, name), { force: true });

async function run() {
  const plan = qaSuitePlan(requested);
  const target = validateQaTarget(process.env);
  const aiMode = process.env.QA_AI_MODE || "basic";
  if (!["basic", "disabled", "extended"].includes(aiMode) || (aiMode === "extended" && !target.emulator)) throw new Error("Cloud QA permits basic or disabled AI only; extended checks require a local approved integration setup.");
  const source = { commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim() };
  const reservation = qaBudgetReservation(target, requested, process.env);
  if (reservation) {
    const status = await new Promise((done) => {
      const child = spawn(process.execPath, [resolve("scripts", "qa-budget-control.mjs"), "--action=reserve", `--kind=${reservation.kind}`, `--id=${reservation.id}`], { stdio: "inherit", env: { ...process.env, QA_FIREBASE_PROJECT_ID: target.cloudProjectId } });
      child.once("error", () => done(1)); child.once("exit", (code) => done(code ?? 1));
    });
    if (status !== 0) throw new Error("QA cost reservation rejected the cloud regression before target access or sign-in.");
  }
  const response = await fetch(`${target.baseUrl}/api/qa/environment`, { signal: AbortSignal.timeout(90_000), redirect: "error", cache: "no-store" });
  if (!response.ok) throw new Error(`Isolated QA preflight rejected the target (${response.status}). No credentials were sent.`);
  const metadata = validateQaEnvironment(await response.json(), target, source);
  if (plan.some((suite) => ["core", "smoke"].includes(suite)) && aiMode === "basic" && (!metadata.ai?.enabled || metadata.ai.callLimit > 4 || metadata.ai.callLimit < 2)) throw new Error("Basic AI QA requires an enabled server-enforced allowance of 2–4 calls.");
  const identities = plan.includes("permissions") ? Object.keys(QA_IDENTITIES) : ["OWNER", ...(plan.some((suite) => ["core", "expenses", "documents", "aesthetics"].includes(suite)) ? ["COMPANION"] : [])];
  for (const role of identities) {
    const email = process.env[`QA_${role}_EMAIL`] || QA_IDENTITIES[role];
    if (email.toLowerCase() !== QA_IDENTITIES[role] || !process.env[`QA_${role}_PASSWORD`]) throw new Error(`QA_${role}_PASSWORD is required for the fixed synthetic ${role.toLowerCase()} identity in the separate QA project.`);
  }
  const runId = `qa-${process.env.GITHUB_RUN_ID || Date.now()}-${process.env.GITHUB_RUN_ATTEMPT || "1"}`;
  const env = { ...process.env, QA_BASE_URL: target.baseUrl, QA_PROJECT_ID: "qa-primary", QA_ISOLATION_PROJECT_ID: "qa-isolation", QA_EXPECTED_SOURCE_COMMIT: source.commit, QA_EXPECTED_SOURCE_TREE: source.tree, QA_RUN_ID: runId, QA_AI_MODE: aiMode, ...Object.fromEntries(Object.entries(QA_IDENTITIES).map(([role, email]) => [`QA_${role}_EMAIL`, email])) };
  const results = [];
  const bin = resolve(process.cwd(), "node_modules", "@playwright", "test", "cli.js");
  async function execute(name) {
    const reportPath = resolve(resultDirectory, `${name}.json`);
    rmSync(reportPath, { force: true });
    rmSync(resolve(resultDirectory, `${name}-cases.json`), { force: true });
    const suite = name === "core" ? "full" : name;
    const startedAt = Date.now();
    const code = await new Promise((done) => {
      const child = spawn(process.execPath, [bin, "test", "--config=playwright.qa.config.ts"], { stdio: "inherit", env: { ...env, QA_REGRESSION_SUITE: suite, QA_REPORT_SUITE: name, QA_REPORT_FILE: reportPath } });
      child.once("error", (error) => { process.stderr.write(`${error.message}\n`); done(1); });
      child.once("exit", (exitCode) => done(exitCode ?? 1));
    });
    let report = null;
    try { if (existsSync(reportPath)) report = JSON.parse(readFileSync(reportPath, "utf8")); } catch { /* An incomplete report is a failure, then attempt cleanup. */ }
    let cases = null;
    try { cases = JSON.parse(readFileSync(resolve(resultDirectory, `${name}-cases.json`), "utf8")); } catch { /* Failures before discovery can have no case manifest. */ }
    const result = { name, status: qaReportStatus(report, code), durationMs: Date.now() - startedAt, tests: report?.stats || null, cases };
    results.push(result);
    return result;
  }
  // Shared projects are intentionally serialized. Every feature has its own lease and report.
  let failed = false;
  for (const name of plan) {
    if (failed) { results.push({ name, status: "not_run", reason: "Earlier suite failed; preserve bounded execution and clean up." }); continue; }
    failed = (await execute(name)).status !== "passed";
  }
  const cleanup = requested === "cleanup" ? results[0] : await execute("cleanup");
  const aiOmissions = aiMode === "extended" ? [] : ["live assistant document-grounding in Spanish and English", "assistant-origin budget proposal", "live web price comparison", "audio/video AI inputs and audio output", ...(aiMode === "disabled" ? ["live quote analysis and quote follow-up"] : [])];
  const integrationOmissions = [...aiOmissions, "live Google Sheets/Drive OAuth integration (separate QA credentials not configured)", "platform-owner analytics on a deployed synthetic-data backend (positive path covered by unit and mocked browser tests)", "real outbound notification email (QA delivery disabled)", ...(target.targetUrl ? ["direct public HTTPS cookie transport (IAM-private QA uses an authenticated loopback proxy)"] : [])];
  const summary = { requested, source, target: metadata, aiMode, aiOmissions, integrationOmissions, suites: results, cleanup: { status: cleanup.status }, completedAt: new Date().toISOString() };
  writeFileSync(resolve(resultDirectory, "summary.json"), JSON.stringify(summary, null, 2));
  const lines = ["## Isolated QA regression", "", `AI tier: ${aiMode}. Full means every product suite; advanced live AI scenarios have separate coverage.`, "", "| Suite | Status |", "| --- | --- |", ...results.map((result) => `| ${result.name} | ${result.status} |`), "", `Cleanup: ${cleanup.status}`, "", `Live checks omitted by isolation and budget policy: ${integrationOmissions.join("; ")}.`];
  const markdown = `${lines.join("\n")}\n`;
  writeFileSync(resolve(resultDirectory, "summary.md"), markdown);
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: "a" });
  const passed = !failed && cleanup.status === "passed";
  if (passed && aiMode === "basic" && !target.emulator && requested === "full" && FULL_QA_SUITES.every((name) => results.some((result) => result.name === name && result.status === "passed"))) {
    writeFileSync(resolve(resultDirectory, "release-qa-evidence.json"), JSON.stringify({ schemaVersion: 1, mode: "full", aiMode, integrationOmissions, github: { runId: Number(process.env.GITHUB_RUN_ID), runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT), workflowCommit: process.env.GITHUB_SHA }, source, target: { environment: "serverless-qa", googleCloudProject: metadata.cloudProjectId, service: metadata.service, revision: metadata.revision }, suites: results.filter((result) => FULL_QA_SUITES.includes(result.name)).map(({ name, status }) => ({ name, status })), cleanup: { status: "passed" }, completedAt: summary.completedAt }, null, 2));
  }
  process.exitCode = passed ? 0 : 1;
}

run().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  let plan = [];
  try { plan = qaSuitePlan(requested); } catch { /* Invalid requests execute no suites. */ }
  if (!existsSync(resolve(resultDirectory, "summary.json"))) {
    const summary = { requested, status: "failed", failure: error.message, suites: plan.map((name) => ({ name, status: "not_run", reason: "Preflight or cost guard rejected execution before sign-in." })), cleanup: { status: "not_run" }, completedAt: new Date().toISOString() };
    const markdown = `## Isolated QA rejected before execution\n\n${error.message}\n\nNo authenticated suites or cleanup ran.\n`;
    writeFileSync(resolve(resultDirectory, "summary.json"), JSON.stringify(summary, null, 2));
    writeFileSync(resolve(resultDirectory, "summary.md"), markdown);
    if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: "a" });
  }
  process.exitCode = 2;
});
