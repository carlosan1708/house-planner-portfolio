import { describe, expect, it } from "vitest";
import { membershipFromAcceptedInvitation } from "@/lib/access-reconciliation";

const invitation = {
  projectId: "project-one",
  status: "accepted",
  acceptedByUid: "user-one",
  email: "member@example.com",
  role: "viewer",
  permissions: { overview: true, budget: false, plan: true },
  folderAccess: { mode: "selected", folderIds: ["plans"], allowUnfiled: false },
  invitedBy: "owner@example.com",
};

describe("accepted invitation membership reconciliation", () => {
  it("rebuilds a verified missing membership with the invitation permissions", () => {
    expect(membershipFromAcceptedInvitation(
      "project-one",
      invitation,
      "user-one",
      { email: "MEMBER@example.com" },
    )).toMatchObject({
      projectId: "project-one",
      uid: "user-one",
      role: "viewer",
      status: "approved",
      permissions: { budget: false, plan: true },
      folderAccess: { mode: "selected", folderIds: ["plans"], allowUnfiled: false },
    });
  });

  it("rejects another project, uid, email, or invitation status", () => {
    expect(membershipFromAcceptedInvitation("other", invitation, "user-one", { email: invitation.email })).toBeNull();
    expect(membershipFromAcceptedInvitation("project-one", invitation, "other-user", { email: invitation.email })).toBeNull();
    expect(membershipFromAcceptedInvitation("project-one", invitation, "user-one", { email: "other@example.com" })).toBeNull();
    expect(membershipFromAcceptedInvitation("project-one", { ...invitation, status: "revoked" }, "user-one", { email: invitation.email })).toBeNull();
  });
});
