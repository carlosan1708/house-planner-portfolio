import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const verifier = resolve("scripts/release-source.mjs");
let directory = "";
let remote = "";

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function verify(command: string, ...args: string[]) {
  return spawnSync(process.execPath, [verifier, command, `--cwd=${directory}`, ...args], { encoding: "utf8" });
}

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "release-source-"));
  directory = join(root, "work");
  remote = join(root, "remote.git");
  execFileSync("git", ["init", "--bare", remote]);
  execFileSync("git", ["init", "-b", "main", directory]);
  git(directory, "config", "user.email", "qa@example.com");
  git(directory, "config", "user.name", "Release QA");
  writeFileSync(join(directory, "release.txt"), "one\n");
  git(directory, "add", "release.txt");
  git(directory, "commit", "-m", "initial release");
  git(directory, "remote", "add", "origin", remote);
  git(directory, "push", "-u", "origin", "main");
});

afterEach(() => rmSync(resolve(directory, ".."), { recursive: true, force: true }));

describe("release source provenance", () => {
  it("accepts a clean committed tree that is merged into origin/main", () => {
    const candidate = verify("candidate");
    expect(candidate.status, candidate.stderr).toBe(0);
    const source = JSON.parse(candidate.stdout) as { tree: string };
    const merged = verify("assert-main", `--tree=${source.tree}`);
    expect(merged.status, merged.stderr).toBe(0);
  });

  it("rejects tracked and untracked deployment changes", () => {
    writeFileSync(join(directory, "release.txt"), "dirty\n");
    let result = verify("candidate");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("uncommitted or untracked files");
    git(directory, "reset", "--hard", "HEAD");
    writeFileSync(join(directory, "untracked-feature.ts"), "export {};\n");
    result = verify("candidate");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("untracked-feature.ts");
  });

  it("rejects promotion until the candidate's exact tree is merged", () => {
    writeFileSync(join(directory, "release.txt"), "two\n");
    git(directory, "add", "release.txt");
    git(directory, "commit", "-m", "candidate feature");
    const source = JSON.parse(verify("candidate").stdout) as { tree: string };
    const beforeMerge = verify("assert-main", `--tree=${source.tree}`);
    expect(beforeMerge.status).not.toBe(0);
    expect(beforeMerge.stderr).toContain("not the exact tree merged into origin/main");
    git(directory, "push", "origin", "main");
    expect(verify("assert-main", `--tree=${source.tree}`).status).toBe(0);
  });
});
