import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RELEASE_QA_POLICY, validateReleaseQa } from "../scripts/release-qa-policy.mjs";
import { verifyReleaseQa } from "../scripts/release-qa.mjs";

const commit = "a".repeat(40);
const tree = "b".repeat(40);
const now = Date.parse("2026-10-08T12:00:00Z");

function trustedEvidence() {
  return {
    candidate: { commit, tree },
    run: {
      id: 123,
      run_attempt: 2,
      workflow_id: 789,
      path: String(RELEASE_QA_POLICY.workflowPath),
      repository: { full_name: String(RELEASE_QA_POLICY.repository) },
      head_repository: { full_name: String(RELEASE_QA_POLICY.repository) },
      head_branch: "main",
      head_sha: commit,
      event: "workflow_dispatch",
      status: "completed",
      conclusion: "success",
      created_at: "2026-10-08T10:00:00Z",
      updated_at: "2026-10-08T11:00:00Z",
    },
    workflow: { id: 789, path: String(RELEASE_QA_POLICY.workflowPath), state: "active" },
    workflowFile: { sha: "d".repeat(40) },
    candidateWorkflowBlob: "d".repeat(40),
    gitCommit: { sha: commit, tree: { sha: tree } },
    artifact: {
      name: RELEASE_QA_POLICY.artifactName,
      expired: false,
      workflow_run: { id: 123, head_sha: commit },
      created_at: "2026-10-08T10:59:00Z",
    },
    evidence: {
      schemaVersion: 1,
      mode: "full",
      aiMode: "basic",
      integrationOmissions: ["Advanced live AI and Google Sheets OAuth require separate approval"],
      github: { runId: 123, runAttempt: 2, workflowCommit: commit },
      source: { commit, tree },
      target: { environment: "serverless-qa", googleCloudProject: RELEASE_QA_POLICY.googleCloudProjects[0], service: "house-planner-qa", revision: "house-planner-qa-example" },
      suites: RELEASE_QA_POLICY.requiredSuites.map((name) => ({ name, status: "passed" })),
      cleanup: { status: "passed" },
      completedAt: "2026-10-08T10:58:00Z",
    },
  };
}

describe("trusted release QA gate", () => {
  it("accepts all suites plus cleanup only for the exact main commit/tree", () => {
    const result = validateReleaseQa(trustedEvidence(), now);
    expect(result.source).toEqual({ commit, tree });
    expect(result.suites).toEqual(RELEASE_QA_POLICY.requiredSuites);
    expect(result.runAttempt).toBe(2);
    expect(result.url).toContain("/actions/runs/123");
  });

  it.each(["failure", "cancelled", "skipped", "timed_out"])("rejects a %s GitHub run even when artifact says passed", (conclusion) => {
    const input = trustedEvidence();
    input.run.conclusion = conclusion;
    expect(() => validateReleaseQa(input, now)).toThrow("GitHub QA run did not succeed");
  });

  it("rejects untrusted workflow, branch, event and repository", () => {
    const mutations = [
      (input: ReturnType<typeof trustedEvidence>) => { input.run.path = ".github/workflows/untrusted.yml"; },
      (input: ReturnType<typeof trustedEvidence>) => { input.workflow.state = "disabled_manually"; },
      (input: ReturnType<typeof trustedEvidence>) => { input.run.head_branch = "codex/feature"; },
      (input: ReturnType<typeof trustedEvidence>) => { input.run.event = "push"; },
      (input: ReturnType<typeof trustedEvidence>) => { input.run.head_repository.full_name = "attacker/house-planner"; },
    ];
    for (const mutate of mutations) {
      const input = trustedEvidence();
      mutate(input);
      expect(() => validateReleaseQa(input, now)).toThrow("Release QA rejected");
    }
  });

  it("accepts main's trusted workflow dispatch testing an explicit candidate commit", () => {
    const input = trustedEvidence();
    input.run.head_sha = "c".repeat(40);
    input.artifact.workflow_run.head_sha = input.run.head_sha;
    input.evidence.github.workflowCommit = input.run.head_sha;
    expect(validateReleaseQa(input, now).source.commit).toBe(commit);
  });

  it("rejects evidence naming another commit even when tree is unchanged", () => {
    const input = trustedEvidence();
    input.evidence.source.commit = "c".repeat(40);
    expect(() => validateReleaseQa(input, now)).toThrow("artifact source");
  });

  it("rejects a run with a different release workflow file", () => {
    const input = trustedEvidence();
    input.workflowFile.sha = "e".repeat(40);
    expect(() => validateReleaseQa(input, now)).toThrow("main workflow differs");
  });

  it("checks the source tree against GitHub's Git commit API", () => {
    const input = trustedEvidence();
    input.gitCommit.tree.sha = "c".repeat(40);
    expect(() => validateReleaseQa(input, now)).toThrow("candidate commit and tree");
    const falseArtifact = trustedEvidence();
    falseArtifact.evidence.source.tree = "c".repeat(40);
    expect(() => validateReleaseQa(falseArtifact, now)).toThrow("artifact source");
  });

  it("rejects partial, skipped, duplicate and cleanup-failed runs", () => {
    const mutations = [
      (input: ReturnType<typeof trustedEvidence>) => { input.evidence.mode = "smoke"; },
      (input: ReturnType<typeof trustedEvidence>) => { input.evidence.aiMode = "disabled"; },
      (input: ReturnType<typeof trustedEvidence>) => { input.evidence.suites.pop(); },
      (input: ReturnType<typeof trustedEvidence>) => { input.evidence.suites[1].status = "skipped"; },
      (input: ReturnType<typeof trustedEvidence>) => { input.evidence.suites[1].name = input.evidence.suites[0].name; },
      (input: ReturnType<typeof trustedEvidence>) => { input.evidence.cleanup.status = "failed"; },
    ];
    for (const mutate of mutations) {
      const input = trustedEvidence();
      mutate(input);
      expect(() => validateReleaseQa(input, now)).toThrow("Release QA rejected");
    }
  });

  it("rejects production and arbitrary cloud targets", () => {
    for (const project of ["example-house-planner", "untrusted-qa"]) {
      const input = trustedEvidence();
      input.evidence.target.googleCloudProject = project;
      expect(() => validateReleaseQa(input, now)).toThrow("isolated serverless");
    }
    const input = trustedEvidence();
    input.evidence.target.service = "house-planner-prod";
    expect(() => validateReleaseQa(input, now)).toThrow("isolated serverless");
  });

  it("rejects artifacts from other runs and prior rerun attempts", () => {
    const input = trustedEvidence();
    input.artifact.workflow_run.id = 456;
    expect(() => validateReleaseQa(input, now)).toThrow("different run");
    const previousAttempt = trustedEvidence();
    previousAttempt.evidence.github.runAttempt = 1;
    expect(() => validateReleaseQa(previousAttempt, now)).toThrow("run attempt");
  });

  it("rejects expired, old, future-dated and incoherent evidence", () => {
    const input = trustedEvidence();
    input.artifact.expired = true;
    expect(() => validateReleaseQa(input, now)).toThrow("expired");
    expect(() => validateReleaseQa(trustedEvidence(), now + RELEASE_QA_POLICY.maxAgeMs)).toThrow("older than seven days");
    expect(() => validateReleaseQa(trustedEvidence(), now - 2 * 60 * 60 * 1000)).toThrow("future dated");
    const incoherent = trustedEvidence();
    incoherent.evidence.completedAt = "2026-10-08T09:00:00Z";
    expect(() => validateReleaseQa(incoherent, now)).toThrow("timestamps");
  });

  it("does not accept a local evidence path as promotion authority", () => {
    expect(() => verifyReleaseQa("./fake-evidence.json", { commit, tree })).toThrow("Local evidence files cannot authorize");
  });

  it("places both evidence and deployed-QA checks before the traffic mutation", () => {
    const script = readFileSync("scripts/deploy-gcp.ps1", "utf8");
    const traffic = script.indexOf("gcloud run services update-traffic");
    expect(script.indexOf("if (-not $QaRunId)")).toBeLessThan(traffic);
    expect(script.indexOf("Trusted full QA verification failed")).toBeLessThan(traffic);
    expect(script.indexOf("Deployed QA revision does not match")).toBeLessThan(traffic);
    expect(script).not.toContain("HOUSE_PLANNER_QA_EMAILS=qa.houseplanner");
  });
});
