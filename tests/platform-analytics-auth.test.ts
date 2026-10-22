import { beforeEach, describe, expect, it, vi } from "vitest";
import { publicMember, requirePlatformOwner } from "@/lib/auth";
import { normalizeFolderAccess, normalizePermissions, type MemberRecord } from "@/lib/project";

const state = vi.hoisted(() => ({ email: "owner@example.test", role: "viewer", status: "approved", canCreateProjects: false, signedIn: true }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (key: string) => state.signedIn && (key === "house_planner_session" || key === "house_planner_project") ? { value: key === "house_planner_session" ? "valid-session" : "p1" } : undefined }) }));
vi.mock("@/lib/firebase-admin", () => ({
  adminAuth: { verifySessionCookie: async () => ({ uid: "u1", email: state.email }) },
  firestore: { collection: (name: string) => ({ doc: () => ({ get: async () => ({ exists: true, data: () => name === "housePlannerUsers" ? { email: state.email, name: "Owner", canCreateProjects: state.canCreateProjects } : name === "housePlannerProjects" ? { name: "House", kind: "shared" } : { projectId: "p1", role: state.role, status: state.status } }) }) }) },
}));

beforeEach(() => {
  state.email = "owner@example.test"; state.role = "viewer"; state.status = "approved"; state.canCreateProjects = false; state.signedIn = true;
  vi.stubEnv("HOUSE_PLANNER_ADMIN_EMAIL", "owner@example.test");
});

describe("platform analytics authorization", () => {
  it("allows the approved platform owner regardless of project role", async () => {
    expect((await requirePlatformOwner())?.email).toBe("owner@example.test");
  });
  it.each(["admin", "editor", "viewer"])("rejects other %s accounts even with project-creation permission", async (role) => {
    state.email = "other@example.test"; state.role = role; state.canCreateProjects = true;
    expect(await requirePlatformOwner()).toBeNull();
  });
  it.each(["pending", "rejected"])("rejects the owner's %s membership", async (status) => {
    state.status = status;
    expect(await requirePlatformOwner()).toBeNull();
  });
  it("denies missing configuration and visitors", async () => {
    vi.stubEnv("HOUSE_PLANNER_ADMIN_EMAIL", ""); expect(await requirePlatformOwner()).toBeNull();
    state.signedIn = false; expect(await requirePlatformOwner()).toBeNull();
  });
  it("exposes the capability only as a server-derived property outside project permissions", () => {
    const member: MemberRecord = { uid: "u1", name: "Owner", email: state.email, projectId: "p1", projectName: "House", isPersonal: true, role: "admin", status: "approved", permissions: normalizePermissions({ analytics: true }), folderAccess: normalizeFolderAccess(null) };
    expect(publicMember(member)?.canViewPlatformAnalytics).toBe(true);
    expect(publicMember({ ...member, email: "other@example.test" })?.canViewPlatformAnalytics).toBe(false);
    expect(publicMember(member)?.permissions).not.toHaveProperty("analytics");
  });
});
