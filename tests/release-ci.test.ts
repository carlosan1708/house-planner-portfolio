import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RELEASE_CI_POLICY as policy, classifyReleaseChanges, validateReleaseCi, verifyReleaseCi } from "../scripts/release-ci.mjs";

const commit = "a".repeat(40), tree = "b".repeat(40), merge = "c".repeat(40), baseline = "9".repeat(40), now = Date.parse("2026-10-13T20:00:00Z");
const changed = (path: string, status = "M", newMode = status === "D" ? "000000" : "100644") => ({ path, status, newMode, oldMode: status === "A" ? "000000" : "100644", oldBlob: (status === "A" ? "0" : "d").repeat(40), newBlob: (status === "D" ? "0" : "e").repeat(40) });
function evidence() {
  const repo = { id: Number(policy.repositoryId), full_name: policy.repository, private: true, default_branch: "main" };
  return {
    repository: repo, candidate: { commit, tree }, baselineAncestor: true, deployedTree: "d".repeat(40), baselineCommit: { sha: baseline, tree: { sha: "d".repeat(40) } },
    run: { id: 456, run_attempt: 2, workflow_id: 789, path: policy.workflowPath, repository: repo, head_repository: repo, head_sha: merge, head_branch: "main", event: "push", status: "completed", conclusion: "success", created_at: "2026-10-13T18:00:00Z", updated_at: "2026-10-13T19:00:00Z" },
    workflow: { id: 789, path: policy.workflowPath, state: "active" }, workflowFile: { sha: policy.trustedWorkflowBlob }, candidateWorkflowBlob: String(policy.trustedWorkflowBlob), candidateBrowserScopeBlob: String(policy.trustedBrowserScopeBlob),
    mergeCommit: { sha: merge, tree: { sha: tree }, parents: [{ sha: baseline }, { sha: commit }] },
    candidateCommit: { sha: commit, tree: { sha: tree } }, mainCommit: { sha: merge, tree: { sha: tree } },
    jobs: { total_count: 1, jobs: [{ name: "validate", run_id: 456, head_sha: merge, run_attempt: 2, status: "completed", conclusion: "success", started_at: "2026-10-13T18:01:00Z", completed_at: "2026-10-13T18:59:00Z", steps: [...policy.requiredSteps, ...policy.browserSteps].map((name: string) => ({ name, status: "completed", conclusion: "success" })) }] },
    changes: [changed("app/components/BudgetWorkspace.tsx"), changed("specs/003-demo-localization/validation.md", "A")],
  };
}

describe("trusted CI release for every change", () => {
  it("accepts standard main merge CI only for the exact candidate tree", () => {
    const result = validateReleaseCi(evidence(), now);
    expect(result.source).toEqual({ commit, tree });
    expect(result.mergeCommit).toBe(merge);
    expect(result.cleanup.status).toBe("not-required");
    expect(result.validationMode).toBe("ci");
  });
  it.each(["pull_request", "workflow_dispatch", "pull_request_target"])("rejects %s evidence for promotion", (event) => { const input = evidence(); input.run.event = event; expect(() => validateReleaseCi(input, now)).toThrow(); });
  it("rejects wrong repo identity/private flag or disabled workflow", () => {
    for (const mutate of [(x: ReturnType<typeof evidence>) => { x.repository = { ...x.repository, private: false }; }, (x: ReturnType<typeof evidence>) => { x.run.head_repository = { ...x.repository, id: 999 }; }, (x: ReturnType<typeof evidence>) => { x.workflow.state = "disabled_manually"; }]) { const input = evidence(); mutate(input); expect(() => validateReleaseCi(input, now)).toThrow(); }
  });
  it("rejects a recreated or different repository even when run IDs agree", () => { const input = evidence(); const other = { ...input.repository, id: 999 }; input.repository = other; input.run.repository = other; input.run.head_repository = other; expect(() => validateReleaseCi(input, now)).toThrow("configured private repository"); });
  it("rejects modified workflow despite a green run", () => { const input = evidence(); input.candidateWorkflowBlob = "f".repeat(40); expect(() => validateReleaseCi(input, now)).toThrow("immutable reviewed"); });
  it("rejects squash/direct push, wrong second parent, altered tree, missing ancestry and advanced main", () => {
    for (const mutate of [(x: ReturnType<typeof evidence>) => { x.mergeCommit.parents.pop(); }, (x: ReturnType<typeof evidence>) => { x.mergeCommit.parents[1].sha = "f".repeat(40); }, (x: ReturnType<typeof evidence>) => { x.candidateCommit.tree.sha = "f".repeat(40); }, (x: ReturnType<typeof evidence>) => { x.baselineAncestor = false; }, (x: ReturnType<typeof evidence>) => { x.mainCommit.sha = "f".repeat(40); }]) { const input = evidence(); mutate(input); expect(() => validateReleaseCi(input, now)).toThrow(); }
  });
  it.each(["failure", "skipped", "cancelled"])("rejects an omitted or %s applicable browser check", (conclusion) => { const input = evidence(); input.jobs.jobs[0].steps.at(-1)!.conclusion = conclusion; expect(() => validateReleaseCi(input, now)).toThrow("omitted or unsuccessful"); });
  it("rejects incomplete/duplicate checks, another attempt and pagination", () => {
    for (const mutate of [(x: ReturnType<typeof evidence>) => { x.jobs.jobs[0].steps.pop(); }, (x: ReturnType<typeof evidence>) => { x.jobs.jobs[0].steps.push(x.jobs.jobs[0].steps[0]); }, (x: ReturnType<typeof evidence>) => { x.jobs.jobs[0].run_attempt = 1; }, (x: ReturnType<typeof evidence>) => { x.jobs.total_count = 101; }]) { const input = evidence(); mutate(input); expect(() => validateReleaseCi(input, now)).toThrow(); }
  });
  it("allows only the expected optional failure-artifact skip", () => { const input = evidence(); input.jobs.jobs[0].steps.push({ name: "Run actions/upload-artifact@v4", status: "completed", conclusion: "skipped" }); expect(validateReleaseCi(input, now).runId).toBe(456); });
  it("accepts the trusted Node post step but rejects unknown post steps", () => { const input = evidence(); input.jobs.jobs[0].steps.push({ name: "Post Run actions/setup-node@v4", status: "completed", conclusion: "success" }); expect(validateReleaseCi(input, now).runId).toBe(456); input.jobs.jobs[0].steps.at(-1)!.name = "Post Run unknown/action@v4"; expect(() => validateReleaseCi(input, now)).toThrow("unexpected CI step"); });
  it("rejects missing production provenance and a baseline tree different from active production", () => { for (const mutate of [(x: ReturnType<typeof evidence>) => { x.deployedTree = ""; }, (x: ReturnType<typeof evidence>) => { x.baselineCommit.tree.sha = "f".repeat(40); }, (x: ReturnType<typeof evidence>) => { x.baselineCommit.sha = "f".repeat(40); }]) { const input = evidence(); mutate(input); expect(() => validateReleaseCi(input, now)).toThrow(); } });
  it("rejects previously merged server changes that have not been deployed", () => { const input = evidence(); input.mergeCommit.parents[0].sha = "f".repeat(40); input.baselineCommit.sha = "f".repeat(40); input.baselineCommit.tree.sha = "a".repeat(40); expect(() => validateReleaseCi(input, now)).toThrow("currently deployed production tree"); });
  it("accepts a later server release only when its entire baseline is already deployed", () => { const input = evidence(); input.mergeCommit.parents[0].sha = "f".repeat(40); input.baselineCommit.sha = "f".repeat(40); const result = validateReleaseCi(input, now); expect(result.scope.baseline).toBe("f".repeat(40)); expect(result.scope.baselineTree).toBe(input.deployedTree); input.changes.push(changed("app/api/documents/featured/route.ts", "A")); expect(validateReleaseCi(input, now).scope.classification).toBe("standard-ci"); });
  it("rejects stale/future CI and local evidence instead of authentic GitHub runs", () => { expect(() => validateReleaseCi(evidence(), now + policy.maxAgeMs)).toThrow("stale"); expect(() => validateReleaseCi(evidence(), now - 2 * 60 * 60 * 1000)).toThrow("future"); expect(() => verifyReleaseCi("./local.json", { commit, tree })).toThrow("local evidence"); });
  it("accepts justified browser skips for docs but rejects them for application changes", () => {
    const input = evidence(); input.changes = [changed("docs/README.md")];
    for (const step of input.jobs.jobs[0].steps) if (policy.browserSteps.includes(step.name)) step.conclusion = "skipped";
    expect(validateReleaseCi(input, now).browser.required).toBe(false);
    input.changes.push(changed("app/new-widget.tsx"));
    expect(() => validateReleaseCi(input, now)).toThrow("applicable browser check");
  });
  it("rejects a changed browser selector even with green workflow evidence", () => {
    const input = evidence(); input.candidateBrowserScopeBlob = "f".repeat(40);
    expect(() => validateReleaseCi(input, now)).toThrow("browser-scope helper");
  });
  it("requires every standard unit/build/static step even when browsers do not apply", () => {
    for (const name of ["Run npm run lint", "Run npm test", "Run npm run build -- --webpack"]) {
      const input = evidence(); input.jobs.jobs[0].steps.find(step => step.name === name)!.conclusion = "skipped";
      expect(() => validateReleaseCi(input, now)).toThrow("omitted or unsuccessful");
    }
  });

});

describe("standard CI source inventory", () => {
  it.each(["app/api/files/route.ts", "lib/auth.ts", "lib/project.ts", "lib/folder-vault.ts", "lib/qa-budget-policy.mjs", "scripts/deploy-qa.ps1", "scripts/qa-local.mjs", "scripts/release-ci.mjs", "e2e/qa-regression.spec.ts", "package.json", "models/model.json", "app/new-server.ts", ".specify/memory/constitution.md"])("accepts %s with standard trusted CI instead of requiring cloud QA", (path) => {
    const input = evidence(); input.changes.push(changed(path));
    const result = validateReleaseCi(input, now);
    expect(result.scope.classification).toBe("standard-ci");
    expect(result.scope.files).toContain(path);
  });
  it("accepts added, modified, removed and executable regular files in stable source order", () => {
    const changes = [changed("app/new-server.ts", "A"), changed("lib/auth.ts"), changed("app/obsolete.ts", "D"), changed("scripts/runner.sh", "A", "100755")];
    expect(classifyReleaseChanges(changes, baseline)).toEqual({ classification: "standard-ci", baseline, files: changes.map(({ path }) => path) });
    expect(classifyReleaseChanges([{ ...changed("scripts/runner.sh", "M", "100644"), oldMode: "100755" }], baseline).files).toEqual(["scripts/runner.sh"]);
  });
  it("does not relax the independently pinned CI workflow when its path appears in the source inventory", () => {
    const input = evidence(); input.changes.push(changed(".github/workflows/ci.yml")); input.candidateWorkflowBlob = "f".repeat(40);
    expect(() => validateReleaseCi(input, now)).toThrow("immutable reviewed baseline");
  });
  it("rejects missing, empty, duplicated or malformed inventories", () => {
    for (const changes of [undefined, [], [changed("docs/README.md"), changed("docs/README.md")], [null]]) expect(() => classifyReleaseChanges(changes, baseline)).toThrow();
    expect(() => classifyReleaseChanges([changed("docs/README.md")], "invalid")).toThrow("complete source diff");
  });
  it.each(["/lib/auth.ts", "C:/lib/auth.ts", "docs/../lib/auth.ts", "docs/./README.md", "docs//README.md", "docs/README.md/", "docs\\README.md", "docs/README\n.md"])("rejects unsafe source path %s", (path) => {
    expect(() => classifyReleaseChanges([changed(path)], baseline)).toThrow("source path");
  });
  it("rejects symlinks, gitlinks, unknown statuses and incomplete blob provenance", () => {
    for (const change of [changed("app/file.ts", "M", "120000"), changed("app/file.ts", "M", "160000"), changed("app/file.ts", "R"), { ...changed("app/file.ts"), oldMode: "120000" }, { ...changed("app/file.ts", "A"), oldBlob: "d".repeat(40) }, { ...changed("app/file.ts", "D"), newBlob: "e".repeat(40) }, { ...changed("app/file.ts"), newBlob: "0".repeat(40) }, { ...changed("app/file.ts"), oldBlob: "invalid" }, { ...changed("app/file.ts"), newBlob: undefined }, { ...changed("app/file.ts"), newBlob: { toString: () => "e".repeat(40) } }]) expect(() => classifyReleaseChanges([change], baseline)).toThrow("status/mode/blob");
  });
});

describe("deployment CI/cloud lane integration", () => {
  it("keeps the standard CI workflow pinned to its independently reviewed blob", () => {
    const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const blob = createHash("sha1").update(`blob ${Buffer.byteLength(workflow)}\0`).update(workflow).digest("hex");
    expect(blob).toBe(policy.trustedWorkflowBlob);
  });
  it("defaults to standard CI for every change and preserves the explicitly selected cloud lane before traffic", () => {
    const script = readFileSync(new URL("../scripts/deploy-gcp.ps1", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    expect(script).toContain('[string]$ValidationMode = "ci"');
    expect(script).not.toContain("presentation-only");
    expect(script).toContain("-ValidationMode cloud -QaRunId GITHUB_RUN_ID");
    const match = script.match(/  if \(\$ValidationMode -eq "ci"\) \{([\s\S]*?)  \} else \{([\s\S]*?)  \}\n  Write-Host "Routing production traffic/);
    expect(match).not.toBeNull();
    const ci = match![1], cloud = match![2];
    for (const required of ['gcloud run services describe $Service --project $ProjectId --region $Region', '$CurrentTraffic.Count -ne 1 -or $CurrentTraffic[0].percent -ne 100', 'gcloud run revisions describe $CurrentTraffic[0].revisionName --project $ProjectId --region $Region', 'HOUSE_PLANNER_SOURCE_TREE', '--deployed-tree=$DeployedTree']) expect(ci).toContain(required);
    expect(ci.indexOf('gcloud run revisions describe')).toBeLessThan(ci.indexOf('$CiJson = & node $ReleaseCiScript'));
    expect(cloud).toContain('$QaJson = & node $ReleaseQaScript "--run-id=$QaRunId" "--commit=$RevisionCommit" "--tree=$RevisionTree"');
    expect(cloud).toContain('$QaProject -eq $ProjectId -or $QaEnvironment -ne "qa"');
    expect(cloud).not.toContain('$ReleaseCiScript');
    expect(ci).not.toContain('$ReleaseQaScript');
    expect(ci).toContain('throw "Trusted CI release verification failed. Production traffic was not changed."');
    expect(script.indexOf('gcloud run services update-traffic')).toBeGreaterThan(script.indexOf('$QaJson = & node $ReleaseQaScript'));
  });
});


describe("optional full regression boundary", () => {
  it("pins the browser selector used by standard CI", () => {
    const helper = readFileSync(new URL("../scripts/ci-browser-scope.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    expect(createHash("sha1").update(`blob ${Buffer.byteLength(helper)}\0`).update(helper).digest("hex")).toBe(policy.trustedBrowserScopeBlob);
  });
  it("keeps full browser and authenticated emulator work out of automatic CI", () => {
    const standard = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
    expect(standard).not.toContain("npm run test:e2e"); expect(standard).not.toContain("npm run qa:local");
    const full = readFileSync(new URL("../.github/workflows/full-regression.yml", import.meta.url), "utf8");
    expect(full).toMatch(/on:\s+workflow_dispatch:/); expect(full).not.toMatch(/^  (push|pull_request|schedule):/m);
    expect(full).toContain("npm run test:e2e"); expect(full).toContain("npm run qa:local -- --suite=permissions");
  });
});
