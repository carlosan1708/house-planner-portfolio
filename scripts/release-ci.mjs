import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectReleaseSource, assertTreeMerged } from "./release-source.mjs";
import { selectBrowserTests } from "./ci-browser-scope.mjs";

export const RELEASE_CI_POLICY = Object.freeze({
  repository: "carlosan1708/house-planner-portfolio", repositoryId: 0, workflowPath: ".github/workflows/ci.yml", branch: "main",
  trustedWorkflowBlob: "d7cd7ed9b08ec51cd357d037a54636fe05fa0c9d",
  maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  browserScopePath: "scripts/ci-browser-scope.mjs",
  trustedBrowserScopeBlob: "f5f66ba967166f47ea5c70acf18a52b5cab48560",
  requiredSteps: ["Set up job", "Run actions/checkout@v4", "Run actions/setup-node@v4", "Run npm ci", "Run npm run docs:check", "Select applicable Playwright coverage", "Run npm run lint", "Run npm test", "Run npm run build -- --webpack"],
  browserSteps: ["Run npx playwright install --with-deps chromium", "Applicable Playwright coverage"],
});
const hash = /^[a-f0-9]{40}$/;
const fail = (message) => { throw new Error(`Release CI rejected: ${message}. Production traffic was not changed.`); };
const emptyBlob = "0".repeat(40);
const regularModes = new Set(["100644", "100755"]);
const hasBlob = (value) => typeof value === "string" && hash.test(value) && value !== emptyBlob;

// Inventory every changed regular file; standard checks cover every change.
// Browser applicability is derived independently from the complete source diff.
export function classifyReleaseChanges(changes, baseline) {
  if (!hash.test(baseline || "") || !Array.isArray(changes) || !changes.length) fail("missing complete source diff");
  const seen = new Set();
  for (const change of changes) {
    const path = change?.path;
    if (typeof path !== "string" || !path || seen.has(path) || /[\\\x00-\x1f]/.test(path) || /^[A-Za-z]:/.test(path) || path.split("/").some((part) => !part || part === "." || part === "..")) fail("invalid or duplicate source path");
    seen.add(path);
    const valid = change.status === "A"
      ? change.oldMode === "000000" && change.oldBlob === emptyBlob && regularModes.has(change.newMode) && hasBlob(change.newBlob)
      : change.status === "M"
        ? regularModes.has(change.oldMode) && regularModes.has(change.newMode) && hasBlob(change.oldBlob) && hasBlob(change.newBlob)
        : change.status === "D"
          ? regularModes.has(change.oldMode) && hasBlob(change.oldBlob) && change.newMode === "000000" && change.newBlob === emptyBlob
          : false;
    if (!valid) fail(`unsupported source status/mode/blob: ${path}`);
  }
  return { classification: "standard-ci", baseline, files: [...seen] };
}

export function validateReleaseCi(input, now = Date.now()) {
  const { repository, run, workflow, workflowFile, candidateWorkflowBlob, candidateBrowserScopeBlob, mergeCommit, candidateCommit, mainCommit, jobs, changes, candidate, baselineAncestor, baselineCommit, deployedTree } = input;
  const policy = RELEASE_CI_POLICY;
  if (!hash.test(candidate?.commit || "") || !hash.test(candidate?.tree || "")) fail("invalid candidate provenance");
  if (!hash.test(deployedTree || "")) fail("the currently deployed production tree is required");
  if (repository?.full_name !== policy.repository || repository?.private !== true || repository?.id !== policy.repositoryId || repository.default_branch !== "main") fail("repository must be the configured private repository");
  for (const source of [run?.repository, run?.head_repository]) if (source?.id !== repository.id || source.full_name !== policy.repository || source.private !== true) fail("run repository identity/privacy mismatch");
  if (workflow?.path !== policy.workflowPath || workflow?.state !== "active" || workflow.id !== run?.workflow_id || ![policy.workflowPath, `${policy.workflowPath}@main`, `${policy.workflowPath}@refs/heads/main`].includes(run?.path)) fail("untrusted or inactive CI workflow");
  if (run?.event !== "push" || run?.head_branch !== "main" || run?.status !== "completed" || run?.conclusion !== "success" || !Number.isSafeInteger(run?.id) || run.id < 1 || !Number.isSafeInteger(run?.run_attempt) || run.run_attempt < 1) fail("successful push CI on main is required");
  if (workflowFile?.sha !== policy.trustedWorkflowBlob || candidateWorkflowBlob !== policy.trustedWorkflowBlob) fail("CI workflow differs from the immutable reviewed baseline");
  if (candidateBrowserScopeBlob !== policy.trustedBrowserScopeBlob) fail("browser-scope helper differs from the immutable reviewed baseline");
  if (mergeCommit?.sha !== run.head_sha || mergeCommit?.parents?.length !== 2 || mergeCommit.parents[1]?.sha !== candidate.commit || !hash.test(mergeCommit.parents[0]?.sha || "") || mergeCommit.parents[0].sha === candidate.commit) fail("CI must test a normal two-parent merge of the exact candidate");
  if (mergeCommit.tree?.sha !== candidate.tree || candidateCommit?.sha !== candidate.commit || candidateCommit?.tree?.sha !== candidate.tree || mainCommit?.sha !== mergeCommit.sha || mainCommit?.tree?.sha !== candidate.tree || baselineAncestor !== true) fail("candidate/main merge tree or ancestry differs");
  if (baselineCommit?.sha !== mergeCommit.parents[0].sha || !hash.test(baselineCommit?.tree?.sha || "") || baselineCommit.tree.sha !== deployedTree) fail("first merge parent differs from the currently deployed production tree; refresh the release baseline and revalidate");
  const created = Date.parse(run.created_at), completed = Date.parse(run.updated_at);
  if (!Number.isFinite(created) || !Number.isFinite(completed) || completed < created || now < completed - 60_000 || now - completed > policy.maxAgeMs) fail("CI is stale, future dated or has invalid timestamps");
  if (!Array.isArray(jobs?.jobs) || jobs.total_count !== 1 || jobs.jobs.length !== 1) fail("exactly one standard CI validation job is required");
  const job = jobs.jobs[0];
  if (job.name !== "validate" || job.run_id !== run.id || job.head_sha !== run.head_sha || (job.run_attempt !== undefined && job.run_attempt !== run.run_attempt) || job.status !== "completed" || job.conclusion !== "success") fail("CI job identity/attempt/result mismatch");
  const started = Date.parse(job.started_at), ended = Date.parse(job.completed_at);
  if (!Number.isFinite(started) || !Number.isFinite(ended) || started < created || ended < started || ended > completed + 60_000) fail("CI job timestamps do not belong to this run");
  if (!Array.isArray(job.steps)) fail("missing CI steps");
  const scope = { ...classifyReleaseChanges(changes, mergeCommit.parents[0].sha), baselineTree: baselineCommit.tree.sha, deployedTree };
  const browser = selectBrowserTests(scope.files);
  const optional = new Set(["Complete job", "Run actions/upload-artifact@v4", "Post Run actions/setup-node@v4", "Post Run actions/checkout@v4"]);
  const names = new Set();
  for (const step of job.steps) {
    if (names.has(step.name)) fail("duplicated CI step");
    names.add(step.name);
    if (policy.browserSteps.includes(step.name)) {
      const expected = browser.required ? "success" : "skipped";
      if (step.status !== "completed" || step.conclusion !== expected) fail(`applicable browser check omitted or unsuccessful: ${step.name}`);
      continue;
    }
    if (!policy.requiredSteps.includes(step.name) && !optional.has(step.name)) fail(`unexpected CI step: ${step.name}`);
    if (step.status !== "completed" || (step.conclusion !== "success" && !(optional.has(step.name) && step.conclusion === "skipped"))) fail(`CI step omitted or unsuccessful: ${step.name}`);
  }
  if ([...policy.requiredSteps, ...policy.browserSteps].some(name => !names.has(name))) fail("required CI checks are missing");
  return { validationMode: "ci", runId: run.id, runAttempt: run.run_attempt, url: `https://github.com/${policy.repository}/actions/runs/${run.id}`, source: candidate, mergeCommit: mergeCommit.sha, scope, browser, checks: [...policy.requiredSteps, ...(browser.required ? policy.browserSteps : [])], cleanup: { status: "not-required", basis: "standard CI does not seed authenticated emulator fixtures" }, limitations: ["Full browser/emulator regression is optional and was not required", "No live cloud, AI, email or Google Sheets integration claim"] };
}

function command(cwd, executable, args) { return execFileSync(executable, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }).trim(); }
export function verifyReleaseCi(runId, candidate, deployedTree, cwd = process.cwd()) {
  if (!/^[1-9][0-9]*$/.test(String(runId || ""))) fail("a GitHub CI run ID is required; local evidence cannot authorize promotion");
  if (!hash.test(candidate?.commit || "") || !hash.test(candidate?.tree || "")) fail("full candidate commit/tree hashes are required");
  if (!hash.test(deployedTree || "")) fail("a full deployed production tree hash is required");
  const source = inspectReleaseSource(cwd);
  assertTreeMerged(candidate.tree, source.root);
  const api = (path) => JSON.parse(command(source.root, "gh", ["api", `repos/${RELEASE_CI_POLICY.repository}${path}`]));
  const repository = api("");
  const run = api(`/actions/runs/${runId}`);
  if (!hash.test(run.head_sha || "") || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) fail("missing CI run provenance");
  const workflow = api(`/actions/workflows/${RELEASE_CI_POLICY.workflowPath.split("/").at(-1)}`);
  const workflowFile = api(`/contents/${RELEASE_CI_POLICY.workflowPath}?ref=${run.head_sha}`);
  const candidateWorkflowBlob = command(source.root, "git", ["rev-parse", `${candidate.commit}:${RELEASE_CI_POLICY.workflowPath}`]);
  const candidateBrowserScopeBlob = command(source.root, "git", ["rev-parse", `${candidate.commit}:${RELEASE_CI_POLICY.browserScopePath}`]);
  const candidateCommit = api(`/git/commits/${candidate.commit}`);
  const mergeCommit = api(`/git/commits/${run.head_sha}`);
  const mainHash = command(source.root, "git", ["rev-parse", "refs/remotes/origin/main"]);
  const mainReference = api("/git/ref/heads/main");
  if (mainReference.ref !== "refs/heads/main" || mainReference.object?.type !== "commit" || mainReference.object.sha !== mainHash) fail("local origin/main is stale; refresh and recheck the live main reference");
  const mainCommit = api(`/git/commits/${mainReference.object.sha}`);
  if (![candidate.commit, mergeCommit.sha].includes(source.commit) || source.tree !== candidate.tree || mergeCommit.parents?.length !== 2 || !hash.test(mergeCommit.parents[0]?.sha || "")) fail("clean local source differs from the candidate or normal merge");
  const baselineCommit = api(`/git/commits/${mergeCommit.parents[0].sha}`);
  let baselineAncestor = false;
  try { command(source.root, "git", ["merge-base", "--is-ancestor", mergeCommit.parents[0].sha, candidate.commit]); baselineAncestor = true; } catch { /* Reject below. */ }
  const jobs = api(`/actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=100`);
  const raw = command(source.root, "git", ["diff", "--raw", "--no-renames", "--abbrev=40", "-z", mergeCommit.parents[0].sha, candidate.commit]);
  const tokens = raw.split("\0"), changes = [];
  while (tokens.length && tokens[0]) {
    const metadata = tokens.shift().match(/^:(\d{6}) (\d{6}) ([a-f0-9]{40}) ([a-f0-9]{40}) ([A-Z])$/);
    const path = tokens.shift();
    if (!metadata || !path) fail("unparseable complete Git source diff");
    changes.push({ oldMode: metadata[1], newMode: metadata[2], oldBlob: metadata[3], newBlob: metadata[4], status: metadata[5], path });
  }
  return validateReleaseCi({ repository, run, workflow, workflowFile, candidateWorkflowBlob, candidateBrowserScopeBlob, mergeCommit, candidateCommit, mainCommit, jobs, changes, candidate, baselineAncestor, baselineCommit, deployedTree });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = (name) => process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
  try { process.stdout.write(`${JSON.stringify(verifyReleaseCi(option("run-id"), { commit: option("commit"), tree: option("tree") }, option("deployed-tree")))}\n`); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
