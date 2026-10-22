export const RELEASE_QA_POLICY = Object.freeze({
  repository: "carlosan1708/house-planner-portfolio",
  workflowPath: ".github/workflows/qa-regression.yml",
  branch: "main",
  artifactName: "release-qa-evidence",
  environment: "serverless-qa",
  service: "house-planner-qa",
  // Provisioning selects this project explicitly; production is never eligible.
  googleCloudProjects: ["house-planner-qa-example"],
  maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  requiredSuites: ["core", "expenses", "distribution", "notes", "documents", "aesthetics", "analytics", "permissions"],
});

const hashPattern = /^[0-9a-f]{40,64}$/;
const fail = (message) => { throw new Error(`Release QA rejected: ${message}. Production traffic was not changed.`); };
const time = (value, name) => {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) fail(`missing or invalid ${name}`);
  return result;
};

/** Validate evidence retrieved from authenticated GitHub APIs, never a caller-provided evidence file. */
export function validateReleaseQa({ run, workflow, workflowFile, candidateWorkflowBlob, artifact, gitCommit, evidence, candidate }, now = Date.now()) {
  const policy = RELEASE_QA_POLICY;
  if (!hashPattern.test(candidate?.commit || "") || !hashPattern.test(candidate?.tree || "")) fail("invalid candidate Git provenance");
  if (workflow?.path !== policy.workflowPath || workflow?.state !== "active") fail("untrusted or inactive QA workflow");
  if (run?.workflow_id !== workflow.id || run?.path !== policy.workflowPath) fail("wrong GitHub workflow");
  if (run?.head_repository?.full_name !== policy.repository || run?.repository?.full_name !== policy.repository) fail("wrong source repository");
  if (run?.head_branch !== policy.branch || run?.event !== "workflow_dispatch") fail("QA must be manually dispatched on main");
  if (!hashPattern.test(run?.head_sha || "") || !hashPattern.test(candidateWorkflowBlob || "") || workflowFile?.sha !== candidateWorkflowBlob) fail("trusted main workflow differs from the candidate release workflow");
  if (run?.status !== "completed" || run?.conclusion !== "success") fail("GitHub QA run did not succeed");
  if (gitCommit?.sha !== candidate.commit || gitCommit?.tree?.sha !== candidate.tree) fail("QA run does not match the candidate commit and tree");
  if (artifact?.name !== policy.artifactName || artifact?.expired || artifact?.workflow_run?.id !== run.id || artifact?.workflow_run?.head_sha !== run.head_sha) fail("artifact is expired or belongs to a different run");
  if (evidence?.schemaVersion !== 1 || evidence?.mode !== "full") fail("complete full-regression evidence is required");
  if (evidence?.aiMode !== "basic" || !Array.isArray(evidence?.integrationOmissions)) fail("basic live AI coverage and explicit integration limitations are required");
  if (Number(evidence?.github?.runId) !== run.id || Number(evidence?.github?.runAttempt) !== run.run_attempt || evidence?.github?.workflowCommit !== run.head_sha) fail("artifact does not belong to this run attempt and trusted workflow commit");
  if (evidence?.source?.commit !== candidate.commit || evidence?.source?.tree !== candidate.tree) fail("artifact source does not match the candidate");
  if (evidence?.target?.environment !== policy.environment || !policy.googleCloudProjects.includes(evidence?.target?.googleCloudProject) || evidence?.target?.service !== policy.service) fail("QA target is not the isolated serverless environment");
  if (!new RegExp(`^${policy.service}-[a-z0-9-]+$`).test(evidence?.target?.revision || "")) fail("missing QA revision provenance");
  if (!Array.isArray(evidence?.suites)) fail("missing suite results");
  const names = evidence.suites.map((suite) => suite?.name);
  if (new Set(names).size !== names.length || names.length !== policy.requiredSuites.length || policy.requiredSuites.some((name) => !names.includes(name))) fail("suite results are missing, duplicated, or unexpected");
  if (evidence.suites.some((suite) => suite?.status !== "passed")) fail("every required suite must pass without skips");
  if (evidence?.cleanup?.status !== "passed") fail("QA fixture cleanup must pass");
  const createdAt = time(run.created_at, "run creation timestamp");
  const updatedAt = time(run.updated_at, "run completion timestamp");
  const completedAt = time(evidence.completedAt, "evidence completion timestamp");
  const artifactCreatedAt = time(artifact.created_at, "artifact timestamp");
  if (updatedAt < createdAt || completedAt < createdAt || completedAt > updatedAt + 60_000 || artifactCreatedAt < createdAt || artifactCreatedAt > updatedAt + 60_000) fail("evidence timestamps do not belong to the run");
  if (now < updatedAt - 60_000 || now - completedAt > policy.maxAgeMs) fail("QA evidence is future dated or older than seven days");
  return {
    runId: run.id,
    runAttempt: run.run_attempt,
    url: `https://github.com/${policy.repository}/actions/runs/${run.id}`,
    source: { commit: candidate.commit, tree: candidate.tree },
    target: evidence.target,
    completedAt: evidence.completedAt,
    suites: names,
  };
}
