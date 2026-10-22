import { describe, expect, it } from "vitest";
import {
  MEMBERSHIPS,
  ACCESS_LINKS,
  MOBILE_CAPTURES,
  PURCHASES,
  EXPENSE_DOCUMENTS,
  EXPENSE_PAYMENTS,
  EXPENSE_PAYMENT_STATUSES,
  PROJECTS,
  USERS,
  personalProjectId,
  type MemberRecord,
} from "@/lib/project";
import {
  QA_RESETTABLE_COLLECTIONS,
  configuredQaCompanionEmail,
  configuredQaProjectIds,
  qaProjectIdentityAllowed,
  qaResetConfirmation,
  qaResetEligibility,
  validQaCompanionEmail,
  validQaResetConfirmation,
} from "@/lib/qa-reset-policy";

const uid = "qa-user";
const qaEmail = "qa.houseplanner@example.com";
const actor: MemberRecord = {
  uid,
  projectId: personalProjectId(uid),
  projectName: "QA workspace",
  isPersonal: true,
  email: qaEmail,
  name: "QA",
  role: "admin",
  status: "approved",
  permissions: { overview: true, activity: true, budget: true, quotes: true, expenses: true, documents: true, notes: true, aesthetics: true, distribution: true, approvals: true, plan: true, decisions: true, site: true },
  folderAccess: { mode: "all", folderIds: [], allowUnfiled: true },
};

describe("QA workspace reset policy", () => {
  it("allows only an explicitly configured QA owner in an allowlisted shared project", () => {
    expect(qaResetEligibility(actor, new Set([qaEmail]), new Set([actor.projectId])).allowed).toBe(false);
    expect(qaResetEligibility({ ...actor, projectId: "shared-project", isPersonal: false }, new Set([qaEmail]), new Set(["shared-project"]))).toEqual({ allowed: true, reason: null });
    expect(qaResetEligibility({ ...actor, projectId: "other-project", isPersonal: false }, new Set([qaEmail]), new Set(["shared-project"])).allowed).toBe(false);
    expect(qaResetEligibility({ ...actor, role: "editor" }, new Set([qaEmail])).allowed).toBe(false);
    expect(qaResetEligibility(actor, new Set(["another@example.com"])).allowed).toBe(false);
  });

  it("normalizes configured shared QA project ids", () => {
    expect(configuredQaProjectIds(" qa-one;qa-two\nqa-one ")).toEqual(new Set(["qa-one", "qa-two"]));
  });

  it("accepts only the exact configured QA companion email", () => {
    expect(configuredQaCompanionEmail(" QA.VIEWER@example.com ")).toBe("qa.viewer@example.com");
    expect(validQaCompanionEmail("QA.VIEWER@example.com", "qa.viewer@example.com")).toBe(true);
    expect(validQaCompanionEmail("someone-else@example.com", "qa.viewer@example.com")).toBe(false);
  });

  it("requires the allowlisted shared project to be owned by the QA actor", () => {
    const sharedActor = { ...actor, projectId: "shared-project", isPersonal: false };
    const allowlist = new Set(["shared-project"]);
    expect(qaProjectIdentityAllowed(sharedActor, { exists: true, ownerUid: uid, kind: "shared" }, allowlist)).toBe(true);
    expect(qaProjectIdentityAllowed(sharedActor, { exists: true, ownerUid: "someone-else", kind: "shared" }, allowlist)).toBe(false);
    expect(qaProjectIdentityAllowed(sharedActor, { exists: true, ownerUid: uid, kind: "personal" }, allowlist)).toBe(false);
    expect(qaProjectIdentityAllowed(sharedActor, { exists: false, ownerUid: uid, kind: "shared" }, allowlist)).toBe(false);
  });

  it("requires the exact project-specific destructive confirmation", () => {
    const phrase = qaResetConfirmation(actor.projectId);
    expect(validQaResetConfirmation(actor.projectId, phrase)).toBe(true);
    expect(validQaResetConfirmation(actor.projectId, phrase.toLowerCase())).toBe(false);
    expect(validQaResetConfirmation("another-project", phrase)).toBe(false);
  });

  it("never includes user, project, or membership roots in content deletion", () => {
    expect(new Set(QA_RESETTABLE_COLLECTIONS).size).toBe(QA_RESETTABLE_COLLECTIONS.length);
    expect(QA_RESETTABLE_COLLECTIONS).not.toContain(USERS);
    expect(QA_RESETTABLE_COLLECTIONS).not.toContain(PROJECTS);
    expect(QA_RESETTABLE_COLLECTIONS).not.toContain(MEMBERSHIPS);
    expect(QA_RESETTABLE_COLLECTIONS).toContain(MOBILE_CAPTURES);
    expect(QA_RESETTABLE_COLLECTIONS).toContain(ACCESS_LINKS);
    expect(QA_RESETTABLE_COLLECTIONS).toContain(PURCHASES);
    expect(QA_RESETTABLE_COLLECTIONS).toContain(EXPENSE_DOCUMENTS);
    expect(QA_RESETTABLE_COLLECTIONS).toContain(EXPENSE_PAYMENTS);
    expect(QA_RESETTABLE_COLLECTIONS).toContain(EXPENSE_PAYMENT_STATUSES);
    expect(QA_RESETTABLE_COLLECTIONS).toContain("housePlannerFolderVaultSessions");
    expect(QA_RESETTABLE_COLLECTIONS).toContain("housePlannerFolderVaultAttempts");
  });
});
