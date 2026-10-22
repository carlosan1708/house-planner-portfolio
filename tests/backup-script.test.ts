import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("production backup contract", () => {
  const script = readFileSync(join(process.cwd(), "scripts", "backup-production.ps1"), "utf8");

  it("backs up the complete production object tree, including real photos and documents", () => {
    expect(script).toContain('$SourceRoot = "gs://$Bucket/house-planner"');
    expect(script).toContain("$SourceObjects.Count");
    expect(script).toContain("$BackupObjects.Count");
    expect(script).toContain("$BackupBytes -ne $SourceBytes");
  });

  it("waits for a successful Firestore export instead of reporting an async start as complete", () => {
    expect(script).toContain("while (-not $Operation.done)");
    expect(script).toContain('operationState -ne "SUCCESSFUL"');
    expect(script).toContain("Backup completed and verified");
  });
});
