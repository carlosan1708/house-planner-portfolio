import { execFileSync } from "node:child_process";
import { validateQaEnvironment, validateQaTarget } from "../../scripts/qa-target-policy.mjs";

export default async function preflight() {
  const target = validateQaTarget(process.env);
  const source = {
    commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim(),
  };
  const response = await fetch(`${target.baseUrl}/api/qa/environment`, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error(`Isolated QA preflight failed (${response.status}); authenticated QA is blocked.`);
  validateQaEnvironment(await response.json(), target, source);
}
