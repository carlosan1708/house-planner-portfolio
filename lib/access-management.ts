export type MemberAccessState = "active" | "pending" | "rejected" | "revoked";
export type MemberAccessSource = "direct" | "read_link";

type MembershipAccessData = {
  status?: unknown;
  removed?: unknown;
  reviewedAt?: unknown;
  accessLinkBlocked?: unknown;
  accessLinkId?: unknown;
};

/** Administrative presentation only. Authorization still uses the effective membership status. */
export function memberAccessState(data: MembershipAccessData): MemberAccessState {
  if (data.removed === true) return "revoked";
  if (data.status === "approved") return "active";
  // A redeemed link that has expired, been revoked, or disappeared resolves to rejected.
  if (data.accessLinkId) return "revoked";
  if (data.status === "rejected") return "rejected";
  // Revocation stores pending for compatibility with the existing authorization model.
  // reviewedBy alone may come from editing a request's permissions before approval.
  if (data.accessLinkBlocked === true || data.reviewedAt) return "revoked";
  return "pending";
}
