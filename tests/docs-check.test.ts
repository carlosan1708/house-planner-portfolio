import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { headingAnchors, prose, referenceError, traceabilityErrors } from "../scripts/check-docs.mjs";

describe("offline documentation references", () => {
  it("ignores example code and comments while keeping actual prose references", () => {
    const text = 'Read [guide](guide.md).\n```text\n[example](missing.md)\n```\n<!-- [scratch](missing.md) -->';
    expect(prose(text)).toContain("[guide](guide.md)");
    expect(prose(text)).not.toContain("missing.md");
  });
  it("handles Unicode headings and duplicate GitHub heading anchors", () => {
    expect([...headingAnchors("# Overview\n## Overview\n## Café and naïve notes\n")])
      .toEqual(["overview", "overview-1", "café-and-naïve-notes"]);
  });
  it("accepts existing encoded paths/anchors and rejects broken or escaping references", () => {
    const root = resolve(mkdtempSync(join(tmpdir(), "docs-links-")));
    try {
      const page = join(root, "README.md");
      writeFileSync(page, "# Start\n");
      writeFileSync(join(root, "A guide.md"), "# Usage\n");
      expect(referenceError(root, page, "A%20guide.md#usage")).toBeNull();
      expect(referenceError(root, page, "#start")).toBeNull();
      expect(referenceError(root, page, "https://example.com/missing")).toBeNull();
      expect(referenceError(root, page, "missing.md")).toContain("missing target");
      expect(referenceError(root, page, "A%20guide.md#wrong")).toContain("missing heading");
      expect(referenceError(root, page, "../private.md")).toContain("leaves repository");
      expect(referenceError(root, page, "%ZZ.md")).toContain("invalid URL encoding");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe("requirement-to-validation traceability", () => {
  it("accepts declared private-history metadata without importing original commit objects", () => {
    const root = resolve(mkdtempSync(join(tmpdir(), "docs-history-")));
    try {
      writeFileSync(join(root, "README.md"), "# Decision\n");
      const record = { requirement: "FR-001", decision: "README.md#decision", tasks: ["T001"],
        commits: ["a".repeat(40)], evidence: ["README.md#decision"], provenance: "private-history" };
      const required = new Set(["FR-001"]), tasks = new Set(["T001"]), archive = new Set(["a".repeat(40)]);
      expect(traceabilityErrors(root, [record], required, tasks, () => false, archive)).toEqual([]);
      expect(traceabilityErrors(root, [record], required, tasks, () => false)).toHaveLength(1);
      expect(traceabilityErrors(root, [{ ...record, provenance: undefined }], required, tasks, () => false, archive)).toHaveLength(1);
      expect(traceabilityErrors(root, [{ ...record, commits: ["b".repeat(40)] }], required, tasks, () => false, archive)).toHaveLength(1);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("rejects nominal FR mentions without actual decisions, tasks, commits and evidence", () => {
    const root = resolve(mkdtempSync(join(tmpdir(), "docs-trace-")));
    try {
      writeFileSync(join(root, "README.md"), "# Decision\n");
      const good = { requirement: "FR-001", decision: "README.md#decision", tasks: ["T001"],
        commits: ["a".repeat(40)], evidence: ["README.md#decision"] };
      const required = new Set(["FR-001"]), tasks = new Set(["T001"]);
      const exists = (commit: string) => commit === "a".repeat(40);
      expect(traceabilityErrors(root, [good], required, tasks, exists)).toEqual([]);
      expect(traceabilityErrors(root, [{ ...good, decision: "", tasks: ["T999"],
        commits: ["b".repeat(40)], evidence: ["missing.md"] }], required, tasks, exists).length).toBe(4);
      expect(traceabilityErrors(root, [good, good], required, tasks, exists)).toContain("Unknown or duplicate requirement: FR-001");
      expect(traceabilityErrors(root, [], required, tasks, exists)).toContain("Missing traceability: FR-001");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
