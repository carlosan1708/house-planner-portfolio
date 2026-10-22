import { describe, expect, it, vi } from "vitest";
import { QA_FIXTURE_IDS, QA_IDENTITIES, qaIdentityMembership, seedQaFixtures } from "@/lib/qa-fixtures.mjs";

describe("synthetic QA identity matrix", () => {
  it("provides six separate identities with outsider confined to another project", () => {
    expect(QA_IDENTITIES).toHaveLength(6);
    expect(new Set(QA_IDENTITIES.map((identity) => identity.email)).size).toBe(6);
    expect(QA_IDENTITIES.filter((identity) => identity.projectId === "qa-primary")).toHaveLength(5);
    expect(QA_IDENTITIES.find((identity) => identity.key === "outsider")).toMatchObject({ role: "admin", projectId: "qa-isolation" });
    const restricted = qaIdentityMembership(QA_IDENTITIES.find((identity) => identity.key === "restricted")!, "synthetic-restricted");
    expect(restricted).toMatchObject({ role: "viewer", permissions: { documents: true, notes: true, budget: false, expenses: false, distribution: false }, folderAccess: { mode: "selected", folderIds: [QA_FIXTURE_IDS.visibleFolder], allowUnfiled: false } });
  });
  it("denies production seeding before any credential, database or storage access", async () => {
    const access = vi.fn(() => { throw new Error("resource accessed"); });
    const resources = { auth: { getUserByEmail: access }, firestore: { batch: access }, bucket: { name: "production", file: access }, env: { GOOGLE_CLOUD_PROJECT: "example-house-planner" } };
    await expect(seedQaFixtures(resources as never)).rejects.toThrow("Isolated QA");
    expect(access).not.toHaveBeenCalled();
  });
  it("validates every password and bucket before provisioning any identity", async () => {
    const access = vi.fn();
    const env = { HOUSE_PLANNER_ENVIRONMENT: "qa", GOOGLE_CLOUD_PROJECT: "house-planner-qa-test", HOUSE_PLANNER_BUCKET: "house-planner-qa-test-files" };
    await expect(seedQaFixtures({ auth: { getUserByEmail: access }, firestore: { batch: access }, bucket: { name: env.HOUSE_PLANNER_BUCKET }, provisionAuth: true, env } as never)).rejects.toThrow("QA_OWNER_PASSWORD");
    expect(access).not.toHaveBeenCalled();
    await expect(seedQaFixtures({ auth: {}, firestore: {}, bucket: { name: "production" }, env } as never)).rejects.toThrow("bucket mismatch");
  });
});
