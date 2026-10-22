import { beforeEach, describe, expect, it, vi } from "vitest";
import { memberAccessState } from "@/lib/access-management";
import { MEMBERSHIPS } from "@/lib/project";

const mock = vi.hoisted(() => ({
  memberships: [] as Array<{ id: string; data: () => Record<string, unknown> }>,
  resolve: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireApproved: async () => ({ projectId: "project-a", role: "admin" }) }));
vi.mock("@/lib/firebase-admin", () => ({ firestore: {
  collection: (name: string) => ({
    where: () => ({ get: async () => ({ docs: name === MEMBERSHIPS ? mock.memberships : [] }) }),
    doc: (uid: string) => ({ get: async () => ({ data: () => ({ email: `${uid}@example.com`, name: uid }) }) }),
  }),
  batch: () => ({ set: vi.fn(), commit: vi.fn() }),
} }));
vi.mock("@/lib/access-links", () => ({ resolveMembershipAccess: mock.resolve }));
vi.mock("@/lib/activity", () => ({ appendActivity: vi.fn(), commitActivity: vi.fn(), diffChanges: vi.fn() }));
vi.mock("@/lib/usage-actions", () => ({ recordActivityUsage: vi.fn() }));
vi.mock("@/lib/folders", () => ({ findExpenseInvoiceFolder: vi.fn(), findExpensePurchaseFolder: vi.fn() }));

import { GET } from "@/app/api/access/route";

beforeEach(() => {
  mock.memberships = [];
  mock.resolve.mockReset().mockImplementation(async (data) => data);
});

describe("administrative member states", () => {
  it("keeps a new or unreviewed request pending", () => {
    expect(memberAccessState({})).toBe("pending");
    expect(memberAccessState({ status: "pending" })).toBe("pending");
    expect(memberAccessState({ status: "pending", reviewedAt: null, accessLinkBlocked: false })).toBe("pending");
  });

  it("does not mistake preapproval permission editing for an access decision", () => {
    const request = { status: "pending", reviewedBy: "admin@example.com" };
    expect(memberAccessState(request)).toBe("pending");
  });

  it.each([
    { status: "pending", accessLinkBlocked: true },
    { status: "pending", reviewedAt: "2026-10-09T02:00:00Z" },
    { status: "pending", reviewedAt: { toDate: () => new Date("2026-10-09T02:00:00Z") } },
  ])("separates revoked access from pending requests: %j", (data) => {
    expect(memberAccessState(data)).toBe("revoked");
  });

  it("distinguishes a rejected request from an unavailable redeemed link", () => {
    expect(memberAccessState({ status: "rejected", accessLinkBlocked: true, reviewedAt: "2026-10-09T02:00:00Z" })).toBe("rejected");
    expect(memberAccessState({ status: "rejected", accessLinkId: "redeemed-link" })).toBe("revoked");
  });

  it("recognizes explicitly restored access despite historical review markers", () => {
    expect(memberAccessState({ status: "approved", accessLinkBlocked: false, reviewedAt: "2026-10-09T02:00:00Z" })).toBe("active");
    expect(memberAccessState({ status: "approved", accessLinkId: "active-link" })).toBe("active");
    expect(memberAccessState({ status: "approved", removed: true })).toBe("revoked");
  });
});

describe("access directory response", () => {
  it("uses effective link access and retains authorization statuses while distinguishing directory states", async () => {
    const records = [
      { uid: "active", status: "approved" },
      { uid: "request", status: "pending" },
      { uid: "revoked", status: "pending", accessLinkBlocked: true },
      { uid: "rejected", status: "rejected", accessLinkBlocked: true },
      { uid: "active-link", status: "approved", accessLinkId: "active-policy" },
      { uid: "expired-link", status: "approved", accessLinkId: "expired-policy" },
      { uid: "removed", status: "rejected", removed: true },
    ];
    mock.memberships = records.map((data) => ({ id: data.uid, data: () => ({ projectId: "project-a", ...data }) }));
    mock.resolve.mockImplementation(async (data) => data.accessLinkId === "expired-policy" ? { ...data, status: "rejected" } : data);

    const response = await GET();
    const { users } = await response.json();
    expect(response.status).toBe(200);
    expect(Object.fromEntries(users.map((user: { uid: string; status: string; accessState: string }) => [user.uid, [user.status, user.accessState]]))).toEqual({
      active: ["approved", "active"],
      request: ["pending", "pending"],
      revoked: ["pending", "revoked"],
      rejected: ["rejected", "rejected"],
      "active-link": ["approved", "active"],
      "expired-link": ["rejected", "revoked"],
    });
    expect(Object.fromEntries(users.map((user: { uid: string; accessSource: string }) => [user.uid, user.accessSource]))).toEqual({
      active: "direct",
      request: "direct",
      revoked: "direct",
      rejected: "direct",
      "active-link": "read_link",
      "expired-link": "read_link",
    });
    expect(users.every((user: Record<string, unknown>) => !("accessLinkId" in user))).toBe(true);
    expect(mock.resolve).toHaveBeenCalledTimes(6);
  });
});
