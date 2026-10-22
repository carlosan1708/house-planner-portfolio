import { describe, expect, it } from "vitest";
import { signInProjectId } from "@/lib/project";

describe("project sign-in preference", () => {
  it("opens personal space by default", () => {
    expect(signInProjectId({ personalId: "personal-1", favoriteProjectId: "shared-1", favoriteApproved: true })).toBe("personal-1");
  });

  it("opens an approved favorite only when explicitly enabled", () => {
    expect(signInProjectId({ personalId: "personal-1", favoriteProjectId: "shared-1", favoriteApproved: true, openFavoriteOnSignIn: true })).toBe("shared-1");
    expect(signInProjectId({ personalId: "personal-1", favoriteProjectId: "shared-1", favoriteApproved: false, openFavoriteOnSignIn: true })).toBe("personal-1");
  });

  it("opens a newly accepted invitation for that sign-in", () => {
    expect(signInProjectId({ personalId: "personal-1", invitedProjectId: "invited", favoriteProjectId: "shared-1", favoriteApproved: true, openFavoriteOnSignIn: true })).toBe("invited");
  });

  it("opens an explicitly requested approved project without changing the default preference", () => {
    expect(signInProjectId({ personalId: "personal-1", requestedProjectId: "qa-shared", requestedApproved: true })).toBe("qa-shared");
    expect(signInProjectId({ personalId: "personal-1", requestedProjectId: "qa-shared", requestedApproved: false })).toBe("personal-1");
  });
});
