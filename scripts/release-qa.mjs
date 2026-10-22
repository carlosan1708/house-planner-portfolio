import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { RELEASE_QA_POLICY, validateReleaseQa } from "./release-qa-policy.mjs";

function gh(...args) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000, maxBuffer: 2 * 1024 * 1024 }).trim();
}

export function verifyReleaseQa(runId, candidate) {
  if (!/^[1-9][0-9]*$/.test(String(runId || ""))) throw new Error("A successful manual full QA GitHub run ID is required. Local evidence files cannot authorize promotion.");
  if (!/^[0-9a-f]{40,64}$/.test(candidate?.commit || "") || !/^[0-9a-f]{40,64}$/.test(candidate?.tree || "")) throw new Error("Valid candidate commit and tree are required to verify release QA.");
  const repository = RELEASE_QA_POLICY.repository;
  const api = (path) => JSON.parse(gh("api", `repos/${repository}/${path}`));
  const run = api(`actions/runs/${runId}`);
  const workflow = api(`actions/workflows/${RELEASE_QA_POLICY.workflowPath.split("/").at(-1)}`);
  if (!/^[0-9a-f]{40,64}$/.test(run.head_sha || "")) throw new Error("The GitHub workflow run is missing valid source provenance.");
  const workflowFile = api(`contents/${RELEASE_QA_POLICY.workflowPath}?ref=${run.head_sha}`);
  const candidateWorkflowBlob = execFileSync("git", ["rev-parse", `${candidate.commit}:${RELEASE_QA_POLICY.workflowPath}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const gitCommit = api(`git/commits/${candidate.commit}`);
  const artifacts = api(`actions/runs/${runId}/artifacts?per_page=100`);
  const matches = artifacts.artifacts?.filter((item) => item.name === RELEASE_QA_POLICY.artifactName);
  if (artifacts.total_count > 100 || matches?.length !== 1 || matches[0].expired) throw new Error("Exactly one unexpired release-qa-evidence artifact must belong to this GitHub run.");
  const artifact = api(`actions/artifacts/${matches[0].id}`);
  const directory = mkdtempSync(join(tmpdir(), "house-planner-release-qa-"));
  try {
    gh("run", "download", String(runId), "--repo", repository, "--name", RELEASE_QA_POLICY.artifactName, "--dir", directory);
    const files = readdirSync(directory);
    const path = join(directory, "release-qa-evidence.json");
    if (files.length !== 1 || files[0] !== "release-qa-evidence.json" || !statSync(path).isFile() || statSync(path).size > 256 * 1024) throw new Error("QA evidence artifact must contain only release-qa-evidence.json (at most 256 KiB).");
    const evidence = JSON.parse(readFileSync(path, "utf8"));
    return validateReleaseQa({ run, workflow, workflowFile, candidateWorkflowBlob, artifact, gitCommit, evidence, candidate });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const option = (name) => process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
  try {
    const result = verifyReleaseQa(option("run-id"), { commit: option("commit"), tree: option("tree") });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
