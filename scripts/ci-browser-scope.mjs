import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const BROWSER_SMOKE = "e2e/ci-smoke.spec.ts";
const features = [
  [/ProjectCurrencyDialog|^app\/(HousePlanner\.tsx|api\/projects\/route\.ts)$|^lib\/(currency|project-currency|project)\.ts$/, "e2e/project-currency.spec.ts"],
  [/aesthetic/i, "e2e/aesthetics-workspace.spec.ts"],
  [/distribution|house-distribution/i, "e2e/distribution.spec.ts"],
  [/countdown/i, "e2e/countdown-completion.spec.ts"],
  [/budget|expenses|workbook/i, "e2e/budget-purchase-links.spec.ts"],
  [/quote/i, "e2e/quotes-upload-progress.spec.ts"],
  [/featured|OverviewHighlights/i, "e2e/featured-documents.spec.ts"],
  [/folder-vault|vault-documents/i, "e2e/folder-vault.spec.ts"],
  [/access-links|public-read|AuthGateway|lib\/auth\./i, "e2e/public-read-links.spec.ts"],
  [/workspace-navigation/i, "e2e/workspace-navigation.spec.ts"],
];

export function selectBrowserTests(paths) {
  if (!Array.isArray(paths) || paths.some(path => typeof path !== "string" || !path || /[\\\x00-\x1f]/.test(path) || path.startsWith("/") || path.split("/").some(part => !part || part === "." || part === ".."))) throw new Error("Invalid browser-scope source paths");
  const tests = new Set();
  for (const path of paths) {
    if (/^e2e\/(?!qa[-/])[a-z0-9-]+\.spec\.ts$/.test(path)) tests.add(path);
    if (/^(app|lib|public|models)\//.test(path) || /^(package(-lock)?\.json|next\.config\.[^/]+|playwright\.config\.ts|scripts\/ci-browser-scope\.mjs)$/.test(path)) {
      tests.add(BROWSER_SMOKE);
      for (const [pattern, test] of features) if (pattern.test(path)) tests.add(test);
    }
  }
  const selected = [...tests].sort();
  return { required: selected.length > 0, tests: selected, reason: selected.length ? "Browser-facing source or browser coverage changed; bounded affected tests selected" : "No browser-facing source or routine browser coverage changed" };
}

function git(...args) { return execFileSync("git", args, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }).trim(); }
export function changedBrowserPlan(base, head) {
  if (!/^[a-f0-9]{40}$/.test(base) || !/^[a-f0-9]{40}$/.test(head)) throw new Error("Exact base/head SHAs required for browser scope");
  const paths = git("diff", "--name-only", "--no-renames", "-z", base, head).split("\0").filter(Boolean);
  return { base, head, paths, ...selectBrowserTests(paths) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")) : {};
  const head = option("head") || event.pull_request?.head?.sha || git("rev-parse", "HEAD");
  const base = option("base") || event.pull_request?.base?.sha || (process.env.GITHUB_EVENT_NAME === "push" ? git("rev-parse", "HEAD^1") : "");
  const plan = changedBrowserPlan(base, head);
  mkdirSync(".qa-tools", { recursive: true });
  writeFileSync(".qa-tools/ci-browser-plan.json", JSON.stringify(plan, null, 2) + "\n");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `required=${plan.required}\n`);
  console.log(JSON.stringify(plan));
  if (process.argv.includes("--run") && plan.required) {
    const result = spawnSync(process.execPath, [resolve("node_modules/@playwright/test/cli.js"), "test", ...plan.tests, "--workers=2"], { stdio: "inherit", env: process.env });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  }
}
