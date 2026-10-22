// Verify authorization and tenant isolation before model-dependent features.
export const FULL_QA_SUITES = Object.freeze(["permissions", "core", "expenses", "distribution", "notes", "documents", "aesthetics", "analytics"]);
export const QA_IDENTITIES = Object.freeze({
  OWNER: "qa.houseplanner.20260830@example.com",
  COMPANION: "qa.houseplanner.viewer.20260831@example.com",
  EDITOR: "qa.houseplanner.editor@example.com",
  VIEWER: "qa.houseplanner.reader@example.com",
  RESTRICTED: "qa.houseplanner.restricted@example.com",
  OUTSIDER: "qa.houseplanner.outside@example.com",
});

// Validate before fetching a target, signing in, acquiring a lease, or resetting data.
export function validateQaTarget(env) {
  if (!env.QA_BASE_URL || !env.QA_FIREBASE_PROJECT_ID) throw new Error("Set QA_BASE_URL and QA_FIREBASE_PROJECT_ID explicitly; production defaults are forbidden.");
  const url = new URL(env.QA_BASE_URL);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("QA_BASE_URL must be a bare origin.");
  const local = ["127.0.0.1", "localhost"].includes(url.hostname);
  const proxy = local && env.QA_CLOUD_PROXY === "1";
  if (proxy) {
    if (url.protocol !== "http:" || !env.QA_TARGET_URL) throw new Error("A Cloud Run proxy requires explicit QA_TARGET_URL.");
    const upstream = validateQaTarget({ ...env, QA_BASE_URL: env.QA_TARGET_URL, QA_CLOUD_PROXY: "0", QA_TARGET_URL: "" });
    if (upstream.emulator) throw new Error("A QA cloud proxy must target the separate QA Cloud Run service.");
    return { ...upstream, baseUrl: url.origin, targetUrl: upstream.baseUrl };
  }
  if (local) {
    if (url.protocol !== "http:" || env.QA_FIREBASE_PROJECT_ID !== "demo-house-planner-qa") throw new Error("Local QA requires the demo-house-planner-qa emulator project.");
  } else {
    if (url.protocol !== "https:" || !/^([a-z0-9-]+---)?house-planner-qa-[a-z0-9-]+(?:\.[a-z0-9-]+)?\.run\.app$/.test(url.hostname)) throw new Error("QA must target the separate house-planner-qa Cloud Run service; production and tagged production candidates are forbidden.");
    if (!/^house-planner-qa-[a-z0-9-]+$/.test(env.QA_FIREBASE_PROJECT_ID)) throw new Error("QA_FIREBASE_PROJECT_ID must name a separate house-planner-qa- cloud project.");
  }
  if (env.QA_PROJECT_ID && env.QA_PROJECT_ID !== "qa-primary") throw new Error("QA_PROJECT_ID must be qa-primary.");
  if (env.QA_ISOLATION_PROJECT_ID && env.QA_ISOLATION_PROJECT_ID !== "qa-isolation") throw new Error("QA_ISOLATION_PROJECT_ID must be qa-isolation.");
  return { baseUrl: url.origin, cloudProjectId: env.QA_FIREBASE_PROJECT_ID, emulator: local };
}

export function validateQaEnvironment(metadata, target, source) {
  if (metadata?.environment !== "qa" || metadata.isolated !== true || metadata.emulator !== target.emulator || metadata.cloudProjectId !== target.cloudProjectId || metadata.primaryProjectId !== "qa-primary" || metadata.isolationProjectId !== "qa-isolation") throw new Error("QA preflight did not confirm the expected isolated runtime, Firebase project, and fixture projects.");
  if (!/^[0-9a-f]{40}$/.test(source.commit) || !/^[0-9a-f]{40}$/.test(source.tree) || metadata.sourceCommit !== source.commit || metadata.sourceTree !== source.tree) throw new Error("QA runtime source commit/tree does not match the checked-out candidate.");
  if (!target.emulator && (metadata.service !== "house-planner-qa" || !/^house-planner-qa-[a-z0-9-]+$/.test(metadata.revision || ""))) throw new Error("QA preflight did not confirm a separate QA Cloud Run revision.");
  return metadata;
}

export function qaSuitePlan(requested) {
  if (requested === "full") return [...FULL_QA_SUITES];
  if (["smoke", "cleanup", ...FULL_QA_SUITES].includes(requested)) return [requested];
  throw new Error(`Unknown QA suite: ${requested}`);
}

export function qaReportStatus(report, exitCode) {
  const stats = report?.stats;
  if (exitCode !== 0 || !stats || Number(stats.expected || 0) < 1 || Number(stats.unexpected || 0) > 0 || Number(stats.skipped || 0) > 0 || Number(stats.flaky || 0) > 0 || (report.errors?.length || 0) > 0) return "failed";
  return "passed";
}

export function qaBudgetReservation(target, requested, env, now = Date.now()) {
  if (target.emulator || requested === "cleanup") return null;
  if (env.GITHUB_RUN_ID && (!/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID) || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT || "1"))) throw new Error("Invalid GitHub QA run identity for cost reservation.");
  return { kind: "regression", id: env.GITHUB_RUN_ID ? `gh-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT || "1"}` : `local-${now}` };
}
