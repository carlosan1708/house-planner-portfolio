import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

function git(cwd, ...args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    const detail = error?.stderr?.toString().trim() || error?.message || "Git command failed";
    throw new Error(detail);
  }
}

export function inspectReleaseSource(cwd = process.cwd()) {
  const root = git(cwd, "rev-parse", "--show-toplevel");
  const changes = git(root, "status", "--porcelain=v1", "--untracked-files=all");
  if (changes) {
    const preview = changes.split(/\r?\n/).slice(0, 12).join("\n");
    throw new Error(`Deployment source contains uncommitted or untracked files. Commit the complete release and deploy from a clean checkout.\n${preview}`);
  }
  return {
    root,
    commit: git(root, "rev-parse", "HEAD"),
    tree: git(root, "rev-parse", "HEAD^{tree}"),
    branch: git(root, "branch", "--show-current"),
  };
}

export function assertTreeMerged(tree, cwd = process.cwd()) {
  if (!/^[0-9a-f]{40,64}$/i.test(tree || "")) throw new Error("Candidate revision is missing valid Git tree provenance.");
  const root = git(cwd, "rev-parse", "--show-toplevel");
  const mainCommit = git(root, "rev-parse", "refs/remotes/origin/main");
  const mainTree = git(root, "rev-parse", "refs/remotes/origin/main^{tree}");
  if (tree !== mainTree) {
    throw new Error(`Candidate Git tree ${tree} is not the exact tree merged into origin/main (${mainTree}). Production traffic was not changed.`);
  }
  return { root, tree, mainCommit, mainTree };
}

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const command = process.argv[2];
    const cwd = option("cwd") || process.cwd();
    const result = command === "candidate"
      ? inspectReleaseSource(cwd)
      : command === "assert-main"
        ? assertTreeMerged(option("tree"), cwd)
        : (() => { throw new Error("Usage: release-source.mjs candidate|assert-main [--tree=<git-tree>] [--cwd=<path>]"); })();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
