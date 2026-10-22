import { describe, expect, it } from "vitest";
import { activityHashForPayload, activityIntegrity, activityMatches, canViewActivity, diffChanges } from "@/lib/activity";
import type { MemberRecord } from "@/lib/project";

const member: MemberRecord = {
  uid: "editor-1", projectId: "project-a", projectName: "Project A", isPersonal: false,
  email: "editor@example.com", name: "Editor", role: "editor", status: "approved",
  permissions: { overview: true, activity: true, budget: true, quotes: true, expenses: false, documents: true, notes: false, aesthetics: true, distribution: false, approvals: true, plan: false, decisions: true, site: false },
  folderAccess: { mode: "selected", folderIds: ["folder-visible"], allowUnfiled: false },
};

const basePayload = {
  schemaVersion: 1, projectId: "project-a", sequence: 1, previousHash: "", category: "document", action: "document.uploaded", source: "user",
  actorUid: "admin-1", actorName: "Admin", actorEmail: "admin@example.com", actorRole: "admin",
  target: { type: "document", id: "doc-1", label: "Invoice.pdf", section: "documents", exists: true },
  summaryParams: {}, changes: [], changeCount: 0, occurredAt: "2026-08-31T12:00:00.000Z",
  visibility: { requiredTabs: ["documents"], folderTopLevelId: "folder-visible", folderTopLevelIds: [], allowUnfiledRequired: false, adminOnly: false }, detailsObjectKey: null,
};

describe("project activity", () => {
  it("creates stable integrity hashes and detects modified records", () => {
    const integrityHash = activityHashForPayload(basePayload);
    expect(activityIntegrity({ ...basePayload, integrityHash })).toBe("verified");
    expect(activityIntegrity({ ...basePayload, target: { ...basePayload.target, label: "Changed.pdf" }, integrityHash })).toBe("invalid");
  });

  it("enforces project, section, folder and administrator visibility", () => {
    expect(canViewActivity(member, basePayload)).toBe(true);
    expect(canViewActivity({ ...member, permissions: { ...member.permissions, activity: false } }, basePayload)).toBe(false);
    expect(canViewActivity(member, { ...basePayload, projectId: "project-b" })).toBe(false);
    expect(canViewActivity(member, { ...basePayload, visibility: { ...basePayload.visibility, requiredTabs: ["expenses"] } })).toBe(false);
    expect(canViewActivity(member, { ...basePayload, visibility: { ...basePayload.visibility, folderTopLevelId: "folder-hidden" } })).toBe(false);
    expect(canViewActivity(member, { ...basePayload, visibility: { ...basePayload.visibility, folderTopLevelId: null, allowUnfiledRequired: true } })).toBe(false);
    expect(canViewActivity(member, { ...basePayload, visibility: { ...basePayload.visibility, adminOnly: true } })).toBe(false);
    expect(canViewActivity({ ...member, role: "admin" }, { ...basePayload, visibility: { ...basePayload.visibility, adminOnly: true } })).toBe(true);
  });

  it("filters structured activity without searching sensitive content", () => {
    expect(activityMatches(basePayload, { category: "document", actorUid: "admin-1", from: Date.parse("2026-08-31T00:00:00Z") })).toBe(true);
    expect(activityMatches(basePayload, { category: "budget" })).toBe(false);
    expect(activityMatches(basePayload, { to: Date.parse("2026-08-30T23:59:59Z") })).toBe(false);
  });

  it("emits only real before/after differences", () => {
    expect(diffChanges({ amount: 400000, status: "open" }, { amount: 500000, status: "open" }, { amount: "currency_crc" })).toEqual([
      { field: "amount", before: 400000, after: 500000, format: "currency_crc" },
    ]);
    expect(diffChanges({ status: "open" }, { status: "open" })).toEqual([]);
  });
});
