import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCESS_LINKS, AccessLinkError, accessLinkTokenHash, createAccessLinkToken, effectiveAccessLinkMembership, redeemAccessLink, redeemPublicAccessLink, resolveMembershipAccess, resolvePublicAccessLink } from "@/lib/access-links";
import { GET, POST, PATCH } from "@/app/api/access-links/route";
import { POST as redeem } from "@/app/api/access-links/redeem/route";
import { PATCH as editMember } from "@/app/api/access/route";
import { GET as listProjects, PATCH as switchProject } from "@/app/api/projects/route";
import { POST as signIn, DELETE as signOut } from "@/app/api/session/route";
import { GET as listInvitations, POST as inviteMember } from "@/app/api/invitations/route";
import { eligibleCountdownRecipients } from "@/lib/notification-service";
import { DEFAULT_MEMBER_PERMISSIONS, FOLDERS, INVITATIONS, LEGACY_PROJECT_ID, MEMBERSHIPS, membershipId, PROJECTS, PUBLIC_ACCESS_LINK_COOKIE, USERS, WORKSPACE_TABS, type MemberRecord } from "@/lib/project";

const mock = vi.hoisted(() => ({
  data: new Map<string, Record<string, unknown>>(),
  actor: null as MemberRecord | null,
  authIdentity: { uid: "reader", email: "reader@example.com", name: "Reader", email_verified: true },
  events: [] as unknown[],
  cookieSet: vi.fn(),
  beforeGet: null as ((ref: { path: string }) => void | Promise<void>) | null,
  beforeGetAll: null as ((refs: Array<{ path: string }>) => void | Promise<void>) | null,
  failAudit: false,
  accountIdentity: undefined as Pick<MemberRecord, "uid" | "email" | "name"> | null | undefined,
}));

vi.mock("firebase-admin/firestore", () => ({ FieldValue: {
  serverTimestamp: () => new Date("2026-10-04T12:00:00Z"),
  delete: () => ({ operation: "delete" }),
  increment: (by: number) => ({ operation: "increment", by }),
} }));

vi.mock("@/lib/firebase-admin", () => {
  type Reference = { id: string; path: string; get: () => Promise<ReturnType<typeof snapshot>>; set: (value: Record<string, unknown>, options?: { merge?: boolean }) => Promise<void> };
  function snapshot(ref: Reference) { return { id: ref.id, ref, exists: mock.data.has(ref.path), data: () => mock.data.get(ref.path) }; }
  function write(ref: Reference, value: Record<string, unknown>, options?: { merge?: boolean }) {
    const next = options?.merge ? { ...mock.data.get(ref.path) } : {};
    for (const [key, item] of Object.entries(value)) {
      const operation = item && typeof item === "object" && "operation" in item ? item as { operation: string; by?: number } : null;
      if (operation?.operation === "delete") delete next[key];
      else next[key] = operation?.operation === "increment" ? Number(next[key] || 0) + Number(operation.by) : item;
    }
    mock.data.set(ref.path, next);
  }
  function collection(name: string, filters: Array<[string, unknown]> = [], maximum = Infinity) {
    return {
      doc: (id = "generated") => {
        const ref: Reference = { id, path: `${name}/${id}`, get: async () => snapshot(ref), set: async (value, options) => { write(ref, value, options); } };
        return ref;
      },
      where: (field: string, _operator: string, value: unknown) => collection(name, [...filters, [field, value]]),
      limit: (count: number) => collection(name, filters, count),
      get: async () => {
        const docs = [...mock.data].filter(([path, data]) => path.startsWith(`${name}/`) && filters.every(([key, value]) => data[key] === value)).slice(0, maximum).map(([path]) => snapshot(collection(name).doc(path.slice(name.length + 1))));
        return { docs, empty: docs.length === 0 };
      },
    };
  }
  function batch() {
    const writes: Array<() => void> = [];
    return { set: (ref: Reference, value: Record<string, unknown>, options?: { merge?: boolean }) => writes.push(() => write(ref, value, options)), commit: async () => { writes.forEach((apply) => apply()); } };
  }
  return { firestore: {
    collection, batch,
    runTransaction: async (callback: (transaction: unknown) => Promise<unknown>) => {
      const changes = batch();
      const result = await callback({ get: async (ref: Reference) => { await mock.beforeGet?.(ref); return ref.path ? snapshot(ref) : ref.get(); }, getAll: async (...refs: Reference[]) => { await mock.beforeGetAll?.(refs); return refs.map(snapshot); }, set: changes.set });
      await changes.commit();
      return result;
    },
  }, adminAuth: { verifyIdToken: async () => mock.authIdentity, createSessionCookie: async () => "session-cookie" }, projectBucket: null };
});

vi.mock("@/lib/auth", () => ({
  getSessionMember: async () => mock.actor,
  getSessionAccountIdentity: async () => mock.accountIdentity === undefined ? mock.actor?.anonymousLink ? null : mock.actor : mock.accountIdentity,
  requireApproved: async (roles?: string[]) => mock.actor?.status === "approved" && (!roles || roles.includes(mock.actor.role)) ? mock.actor : null,
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: mock.cookieSet }) }));
vi.mock("@/lib/folders", () => ({ ensureExpenseInvoiceFolder: vi.fn(), ensureExpensePurchaseFolder: vi.fn(), findExpenseInvoiceFolder: () => null, findExpensePurchaseFolder: () => null }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/gmail", () => ({ gmailConfiguration: vi.fn(), sendGmailMessage: vi.fn() }));
vi.mock("@/lib/usage-actions", () => ({ recordActivityUsage: vi.fn() }));
vi.mock("@/lib/activity", async () => {
  const { firestore } = await import("@/lib/firebase-admin");
  return {
    appendActivity: async (_transaction: unknown, _actor: unknown, event: unknown) => { if (mock.failAudit) throw new Error("audit failed"); mock.events.push(event); return { id: "event" }; },
    commitActivity: async (_actor: unknown, event: unknown, mutate: (transaction: unknown) => void) => firestore.runTransaction(async (transaction) => { mock.events.push(event); mutate(transaction); }),
    diffChanges: (before: Record<string, unknown>, after: Record<string, unknown>) => Object.keys(after).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).map((field) => ({ field, before: before[field], after: after[field] })),
  };
});

const identity = { uid: "reader", email: "reader@example.com", name: "Reader" };
const token = "a".repeat(43);
const id = accessLinkTokenHash(token);
const projectId = "project-one";
const owner: MemberRecord = { ...identity, uid: "owner", email: "owner@example.com", role: "admin", status: "approved", projectId, projectName: "Project", isPersonal: false, permissions: DEFAULT_MEMBER_PERMISSIONS, folderAccess: { mode: "all", folderIds: [], allowUnfiled: true } };
const policy = () => ({ projectId, label: "Contractor", role: "viewer", status: "active", permissions: { ...DEFAULT_MEMBER_PERMISSIONS, budget: true, notes: false }, folderAccess: { mode: "selected", folderIds: ["plans"], allowUnfiled: false }, createdBy: owner.email, expiresAt: new Date(Date.now() + 86_400_000), redemptionCount: 0 });
const key = `${MEMBERSHIPS}/${membershipId(projectId, identity.uid)}`;
const request = (body: unknown, path = "/api/access-links") => new Request(`https://houseplanner.example${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const allHidden = Object.fromEntries(WORKSPACE_TABS.map((tab) => [tab, false]));

beforeEach(() => {
  mock.authIdentity.email_verified = true;
  mock.data.clear(); mock.events = []; mock.actor = owner; mock.cookieSet.mockClear(); mock.beforeGet = null; mock.beforeGetAll = null; mock.failAudit = false; mock.accountIdentity = undefined;
  mock.data.set(`${ACCESS_LINKS}/${id}`, policy());
  mock.data.set(`${PROJECTS}/${projectId}`, { name: "Project", kind: "shared" });
  mock.data.set(`${USERS}/${identity.uid}`, { ...identity, emailVerified: true });
  mock.data.set(`${MEMBERSHIPS}/${membershipId(projectId, owner.uid)}`, { projectId, uid: owner.uid, status: "approved", role: "admin" });
});

afterEach(() => vi.unstubAllEnvs());

describe("verified mailbox ownership for project invitations", () => {
  const invitationToken = "v".repeat(43);
  const invitationKey = `${INVITATIONS}/${accessLinkTokenHash(invitationToken)}`;
  const pending = () => ({ projectId, email: identity.email, role: "viewer", status: "pending", createdAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000), permissions: { ...DEFAULT_MEMBER_PERMISSIONS, budget: false } });
  const sessionRequest = (body: unknown = {}) => new Request("https://houseplanner.example/api/session", { method: "POST", headers: { Authorization: "Bearer id-token", "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it("keeps an unverified password account in its personal workspace without consuming an email invitation", async () => {
    mock.authIdentity.email_verified = false;
    mock.data.delete(`${USERS}/${identity.uid}`);
    mock.data.set(invitationKey, pending());
    const response = await signIn(sessionRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ projectId: "personal-reader" });
    expect(mock.data.has(key)).toBe(false);
    expect(mock.data.get(invitationKey)?.status).toBe("pending");
    expect(mock.data.get(`${USERS}/${identity.uid}`)).toMatchObject({ emailVerified: false, legacyAccess: false });
    expect(mock.events).toHaveLength(0);
  });

  it("rejects an explicit invitation for an unverified mailbox before any writes or session cookies", async () => {
    mock.authIdentity.email_verified = false;
    mock.data.set(invitationKey, pending());
    const before = new Map(mock.data);
    const response = await signIn(sessionRequest({ inviteToken: invitationToken }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "email_verification_required" });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mock.data).toEqual(before);
    expect(mock.events).toHaveLength(0);
  });

  it("does not bootstrap a platform administrator from an unverified matching email", async () => {
    mock.authIdentity.email_verified = false;
    vi.stubEnv("HOUSE_PLANNER_ADMIN_EMAIL", identity.email);
    mock.data.delete(`${USERS}/${identity.uid}`);
    const response = await signIn(sessionRequest());
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mock.data.has(`${USERS}/${identity.uid}`)).toBe(false);
    expect(mock.data.has(`${MEMBERSHIPS}/${membershipId(LEGACY_PROJECT_ID, identity.uid)}`)).toBe(false);
  });

  it("accepts a pending invitation after a verified sign-in and records verified ownership", async () => {
    mock.data.set(invitationKey, pending());
    const response = await signIn(sessionRequest({ inviteToken: invitationToken }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ projectId });
    expect(mock.data.get(key)).toMatchObject({ status: "approved", role: "viewer", permissions: { budget: false } });
    expect(mock.data.get(invitationKey)?.status).toBe("accepted");
    expect(mock.data.get(`${USERS}/${identity.uid}`)?.emailVerified).toBe(true);
  });

  it.each([false, undefined])("leaves a pending invitation instead of pregranting an existing account with verified flag %s", async (emailVerified) => {
    mock.data.set(`${USERS}/${identity.uid}`, { ...identity, emailVerified });
    const response = await inviteMember(request({ email: identity.email, role: "viewer" }, "/api/invitations"));
    expect(response.status).toBe(201);
    expect(mock.data.has(key)).toBe(false);
    const created = await response.json();
    expect(created.invitation).toMatchObject({ email: identity.email, status: "pending" });
  });
});

describe("reusable read-only access", () => {
  it("creates unpredictable 32-byte tokens and only persists their hashes", () => {
    const first = createAccessLinkToken(); const second = createAccessLinkToken();
    expect(Buffer.from(first.token, "base64url")).toHaveLength(32);
    expect(first.token).not.toBe(second.token);
    expect(first.id).toMatch(/^[a-f0-9]{64}$/);
    expect(first.id).not.toContain(first.token);
  });
  it.each(["", "short", "a".repeat(44), "/".repeat(43)])("rejects malformed capabilities %s", (value) => expect(() => accessLinkTokenHash(value)).toThrow(AccessLinkError));
  it("approves any signed-in account as a viewer and allows another account to use the same link", async () => {
    await redeemAccessLink(identity, token, projectId);
    await redeemAccessLink({ ...identity, uid: "second", email: "second@example.com" }, token);
    expect(mock.data.get(key)).toMatchObject({ role: "viewer", status: "approved", accessLinkId: id, permissions: { budget: true, notes: false } });
    expect(mock.data.get(`${MEMBERSHIPS}/${membershipId(projectId, "second")}`)).toMatchObject({ role: "viewer", accessLinkId: id });
    expect(mock.data.get(`${ACCESS_LINKS}/${id}`)?.redemptionCount).toBe(2);
  });
  it("redeems idempotently without incrementing use count on reload", async () => {
    await redeemAccessLink(identity, token); await redeemAccessLink(identity, token);
    expect(mock.data.get(`${ACCESS_LINKS}/${id}`)?.redemptionCount).toBe(1);
  });
  it("enforces viewer even if a stored link or membership attempts to grant admin", async () => {
    mock.data.set(`${ACCESS_LINKS}/${id}`, { ...policy(), role: "admin" });
    await redeemAccessLink(identity, token);
    expect(mock.data.get(key)?.role).toBe("viewer");
    expect(effectiveAccessLinkMembership({ ...mock.data.get(key), role: "admin" }, policy()).role).toBe("viewer");
  });
  it.each(["admin", "editor", "viewer"])("preserves independently approved %s membership", async (role) => {
    const direct = { projectId, uid: identity.uid, status: "approved", role, permissions: { budget: false }, folderAccess: { mode: "all" } };
    mock.data.set(key, direct);
    await redeemAccessLink(identity, token);
    expect(mock.data.get(key)).toEqual(direct);
    expect(mock.events).toHaveLength(0);
  });
  it("uses changes to section and folder policy immediately", async () => {
    await redeemAccessLink(identity, token);
    mock.data.set(`${ACCESS_LINKS}/${id}`, { ...policy(), permissions: { ...DEFAULT_MEMBER_PERMISSIONS, budget: false }, folderAccess: { mode: "selected", folderIds: ["new-plans"], allowUnfiled: true } });
    expect(await resolveMembershipAccess(mock.data.get(key)!)).toMatchObject({ permissions: { budget: false }, folderAccess: { folderIds: ["new-plans"], allowUnfiled: true } });
  });
  it.each(["revoked", "expired", "missing", "other-project"])("withdraws memberships sourced from a %s link", async (condition) => {
    await redeemAccessLink(identity, token);
    if (condition === "missing") mock.data.delete(`${ACCESS_LINKS}/${id}`);
    else mock.data.set(`${ACCESS_LINKS}/${id}`, { ...policy(), ...(condition === "expired" ? { expiresAt: new Date(0) } : condition === "other-project" ? { projectId: "other" } : { status: "revoked" }) });
    expect((await resolveMembershipAccess(mock.data.get(key)!)).status).toBe("rejected");
  });
  it("rejects unknown, expired, revoked and wrong-project links without creating membership", async () => {
    await expect(redeemAccessLink(identity, "b".repeat(43))).rejects.toMatchObject({ status: 404 });
    await expect(redeemAccessLink(identity, token, "other")).rejects.toMatchObject({ status: 403 });
    mock.data.set(`${ACCESS_LINKS}/${id}`, { ...policy(), expiresAt: new Date(0) });
    await expect(redeemAccessLink(identity, token)).rejects.toMatchObject({ status: 410 });
    mock.data.set(`${ACCESS_LINKS}/${id}`, { ...policy(), status: "revoked" });
    await expect(redeemAccessLink(identity, token)).rejects.toMatchObject({ status: 410 });
    expect(mock.data.has(key)).toBe(false);
  });
  it.each([{ status: "rejected", reviewedBy: owner.email }, { status: "pending", accessLinkBlocked: true }])("does not bypass an administrator's individual access decision", async (decision) => {
    mock.data.set(key, { projectId, uid: identity.uid, ...decision });
    await expect(redeemAccessLink(identity, token)).rejects.toMatchObject({ status: 403 });
    expect(mock.data.get(key)?.status).toBe(decision.status);
  });
  it("keeps a removed membership rejected even if stale stored permissions approve it", async () => {
    const removed = { projectId, uid: identity.uid, removed: true, status: "approved", role: "admin", permissions: DEFAULT_MEMBER_PERMISSIONS, folderAccess: { mode: "all" } };
    expect(await resolveMembershipAccess(removed)).toMatchObject({ status: "rejected", permissions: allHidden, folderAccess: { mode: "selected", folderIds: [], allowUnfiled: false } });
    expect(effectiveAccessLinkMembership({ ...removed, accessLinkId: id }, policy())).toMatchObject({ status: "rejected", permissions: allHidden });
  });
  it("requires a new administrator invitation to readmit a removed user through either an old or new link", async () => {
    const removed = { projectId, uid: identity.uid, removed: true, status: "approved", accessLinkId: id };
    mock.data.set(key, removed);
    const newToken = "b".repeat(43);
    mock.data.set(`${ACCESS_LINKS}/${accessLinkTokenHash(newToken)}`, policy());
    await expect(redeemAccessLink(identity, token)).rejects.toMatchObject({ status: 403 });
    await expect(redeemAccessLink(identity, newToken)).rejects.toMatchObject({ status: 403 });
    expect(mock.data.get(key)).toEqual(removed);
    expect(mock.events).toHaveLength(0);
  });
});

describe("removed project member sign-in and readmission", () => {
  const removedAt = new Date("2026-10-03T12:00:00Z");
  const invitationToken = "c".repeat(43);
  const invitationId = accessLinkTokenHash(invitationToken);
  const signInRequest = (body: unknown) => new Request("https://houseplanner.example/api/session", { method: "POST", headers: { Authorization: "Bearer id-token", "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const removedMember = () => ({ projectId, uid: identity.uid, removed: true, removedAt, removedEmail: identity.email, removedEmails: [identity.email], status: "rejected", role: "viewer", accessLinkBlocked: true, permissions: allHidden, folderAccess: { mode: "selected", folderIds: [], allowUnfiled: false } });
  const pendingInvitation = (createdAt: Date) => ({ projectId, email: identity.email, role: "viewer", status: "pending", createdAt, expiresAt: new Date(Date.now() + 86_400_000), permissions: { ...DEFAULT_MEMBER_PERMISSIONS, budget: false }, folderAccess: { mode: "selected", folderIds: ["plans"], allowUnfiled: false } });

  it("hides old invitations revoked by removal while keeping other invitations visible", async () => {
    mock.data.set(`${INVITATIONS}/${invitationId}`, { ...pendingInvitation(removedAt), status: "revoked", revokedReason: "member_removed", removedMemberUid: identity.uid });
    mock.data.set(`${INVITATIONS}/new-invite`, pendingInvitation(new Date("2026-10-04T12:00:00Z")));
    expect((await (await listInvitations()).json()).invitations.map((invitation: { id: string }) => invitation.id)).toEqual(["new-invite"]);
  });

  it("anonymizes the removed inviter on remaining invitations", async () => {
    mock.data.set(key, removedMember());
    mock.data.set(`${INVITATIONS}/${invitationId}`, { ...pendingInvitation(removedAt), email: "other@example.com", invitedBy: identity.email });
    expect((await (await listInvitations()).json()).invitations[0]).toMatchObject({ email: "other@example.com", invitedBy: "Usuario desactivado" });
  });

  it("does not recreate a removed legacy membership on ordinary sign-in", async () => {
    mock.data.set(`${USERS}/${identity.uid}`, { ...identity, legacyAccess: true, multiTenantReady: true, status: "approved" });
    const legacyKey = `${MEMBERSHIPS}/${membershipId(LEGACY_PROJECT_ID, identity.uid)}`;
    const removed = { ...removedMember(), projectId: LEGACY_PROJECT_ID };
    mock.data.set(legacyKey, removed);
    const response = await signIn(signInRequest({ requestedProjectId: LEGACY_PROJECT_ID }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ projectId: "personal-reader" });
    expect(mock.data.get(legacyKey)).toEqual(removed);
  });

  it("rejects an old invitation even if its pending status was not migrated", async () => {
    const removed = removedMember();
    mock.data.set(key, removed);
    mock.data.set(`${INVITATIONS}/${invitationId}`, pendingInvitation(new Date("2026-10-02T12:00:00Z")));
    const response = await signIn(signInRequest({ inviteToken: invitationToken }));
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mock.data.get(key)).toEqual(removed);
  });

  it("rechecks an invitation that is revoked while sign-in is in flight", async () => {
    const removed = removedMember();
    mock.data.set(key, { ...removed, removed: false, status: "approved" });
    mock.data.set(`${INVITATIONS}/${invitationId}`, pendingInvitation(new Date("2026-10-04T12:00:00Z")));
    mock.beforeGetAll = (refs) => {
      if (refs.some((ref) => ref.path === `${INVITATIONS}/${invitationId}`)) {
        mock.data.set(key, removed);
        mock.data.set(`${INVITATIONS}/${invitationId}`, { ...pendingInvitation(new Date("2026-10-04T12:00:00Z")), status: "revoked" });
        mock.beforeGetAll = null;
      }
    };
    const response = await signIn(signInRequest({ inviteToken: invitationToken }));
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mock.data.get(key)).toEqual(removed);
    expect(mock.events).toHaveLength(0);
  });

  it("accepts a new invitation while preserving the previous removal record", async () => {
    mock.data.set(key, removedMember());
    mock.data.set(`${INVITATIONS}/${invitationId}`, pendingInvitation(new Date("2026-10-04T12:00:00Z")));
    const response = await signIn(signInRequest({ inviteToken: invitationToken }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ projectId });
    expect(mock.data.get(key)).toMatchObject({ removed: false, removedAt, removedEmail: identity.email, removedEmails: [identity.email], status: "approved", accessLinkBlocked: false, permissions: { budget: false }, folderAccess: { folderIds: ["plans"] } });
    expect(mock.data.get(`${INVITATIONS}/${invitationId}`)?.status).toBe("accepted");
  });

  it("lets an administrator issue a new invitation and keeps the removal history and other project memberships", async () => {
    mock.data.set(key, { ...removedMember(), accessLinkId: id });
    const otherKey = `${MEMBERSHIPS}/${membershipId("other-project", identity.uid)}`;
    const other = { projectId: "other-project", uid: identity.uid, status: "approved", role: "editor" };
    mock.data.set(otherKey, other);
    mock.data.set(`${INVITATIONS}/${invitationId}`, pendingInvitation(new Date("2026-10-02T12:00:00Z")));
    const response = await inviteMember(request({ email: identity.email, role: "viewer", permissions: { ...DEFAULT_MEMBER_PERMISSIONS, budget: false } }, "/api/invitations"));
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(mock.data.get(key)).toMatchObject({ removed: false, removedAt, removedEmail: identity.email, removedEmails: [identity.email], status: "approved", accessLinkBlocked: false, role: "viewer", permissions: { budget: false } });
    expect(mock.data.get(key)?.accessLinkId).toBeUndefined();
    expect(mock.data.get(`${INVITATIONS}/${invitationId}`)?.status).toBe("revoked");
    expect(mock.data.get(otherKey)).toEqual(other);
    const accepted = await signIn(signInRequest({ inviteToken: new URL(created.inviteUrl).searchParams.get("invite") }));
    expect(accepted.status).toBe(200);
    expect(mock.data.get(key)?.removedAt).toEqual(removedAt);
    await redeemAccessLink(identity, token);
    expect(mock.data.get(key)?.permissions).toMatchObject({ budget: false });
    expect(mock.data.get(key)?.accessLinkId).toBeUndefined();
  });
});

describe("access link APIs", () => {
  it("creates a viewer URL with a 14-day expiry and no token in persisted data or listing", async () => {
    const response = await POST(request({ label: "Site reader", role: "admin", permissions: DEFAULT_MEMBER_PERMISSIONS }));
    expect(response.status).toBe(201);
    const created = await response.json(); const url = new URL(created.accessUrl);
    expect(url.pathname).toBe(`/projects/${projectId}/overview`);
    expect(created.link.role).toBe("viewer");
    expect(new Date(created.link.expiresAt).getTime() - Date.now()).toBeGreaterThan(13.99 * 86_400_000);
    const raw = url.searchParams.get("accessLink")!;
    expect(created.link.id).toBe(accessLinkTokenHash(raw));
    expect(JSON.stringify(mock.data.get(`${ACCESS_LINKS}/${created.link.id}`))).not.toContain(raw);
    expect(JSON.stringify(await (await GET()).json())).not.toContain(raw);
    expect(created.link).toMatchObject({ authentication: "account", defaultLanguage: "es" });
    expect(url.searchParams.get("lang")).toBe("es");
  });
  it("creates an anonymous link with the selected default language", async () => {
    const response = await POST(request({ label: "Public plans", authentication: "public", defaultLanguage: "en" }));
    const created = await response.json();
    expect(response.status).toBe(201);
    expect(created.link).toMatchObject({ role: "viewer", authentication: "public", defaultLanguage: "en" });
    expect(new URL(created.accessUrl).searchParams.get("lang")).toBe("en");
    expect(mock.data.get(`${ACCESS_LINKS}/${created.link.id}`)).toMatchObject({ authentication: "public", defaultLanguage: "en" });
  });
  it("opens the first permitted section when overview is disabled", async () => {
    const response = await POST(request({ label: "Plans only", authentication: "public", defaultLanguage: "en", permissions: { ...allHidden, documents: true } }));
    const created = await response.json();
    expect(new URL(created.accessUrl).pathname).toBe(`/projects/${projectId}/documents`);
    mock.actor = null;
    const accepted = await redeem(request({ token: new URL(created.accessUrl).searchParams.get("accessLink") }));
    expect(await accepted.json()).toMatchObject({ defaultSection: "documents", defaultLanguage: "en", publicAccess: true });
  });
  it.each([{ authentication: "anyone" }, { defaultLanguage: "fr" }, { authentication: null }, { defaultLanguage: null }])("rejects invalid access settings %j", async (settings) => {
    expect((await POST(request({ label: "Invalid", ...settings }))).status).toBe(400);
  });
  it("updates language while keeping the original authentication policy immutable", async () => {
    const updated = await PATCH(request({ id, action: "update", defaultLanguage: "en" }));
    expect((await updated.json()).link).toMatchObject({ authentication: "account", defaultLanguage: "en" });
    expect((await PATCH(request({ id, action: "update", defaultLanguage: "fr" }))).status).toBe(400);
    expect((await PATCH(request({ id, action: "update", authentication: "public" }))).status).toBe(400);
    expect(mock.data.get(`${ACCESS_LINKS}/${id}`)?.authentication).toBeUndefined();
  });
  it.each([null, "viewer", "editor"])("rejects administration from %s", async (role) => {
    mock.actor = role ? { ...owner, role: role as "viewer" | "editor" } : null;
    expect((await GET()).status).toBe(403);
    expect((await POST(request({ label: "Denied" }))).status).toBe(403);
    expect((await PATCH(request({ id, action: "revoke" }))).status).toBe(403);
  });
  it("rejects policies with no visible section", async () => {
    expect((await POST(request({ label: "Hidden", permissions: allHidden }))).status).toBe(400);
    expect((await PATCH(request({ id, action: "update", permissions: allHidden }))).status).toBe(400);
  });
  it("limits selected folders to existing top-level folders in this project", async () => {
    mock.data.set(`${FOLDERS}/plans`, { projectId, parentId: null });
    mock.data.set(`${FOLDERS}/child`, { projectId, parentId: "plans" });
    mock.data.set(`${FOLDERS}/other`, { projectId: "other", parentId: null });
    const response = await PATCH(request({ id, action: "update", folderAccess: { mode: "selected", folderIds: ["plans", "child", "other", "missing"], allowUnfiled: false } }));
    expect((await response.json()).link.folderAccess.folderIds).toEqual(["plans"]);
  });
  it("rejects managing another project's link", async () => {
    mock.data.set(`${ACCESS_LINKS}/${id}`, { ...policy(), projectId: "other" });
    expect((await PATCH(request({ id, action: "revoke" }))).status).toBe(404);
    expect((await (await GET()).json()).links).toHaveLength(0);
  });
  it("updates policies and revokes access for existing recipients", async () => {
    await redeemAccessLink(identity, token);
    await PATCH(request({ id, action: "update", permissions: { ...DEFAULT_MEMBER_PERMISSIONS, budget: false } }));
    expect((await resolveMembershipAccess(mock.data.get(key)!)).permissions.budget).toBe(false);
    await PATCH(request({ id, action: "revoke" }));
    expect((await resolveMembershipAccess(mock.data.get(key)!)).status).toBe("rejected");
    expect((await redeem(request({ token }, "/api/access-links/redeem"))).status).toBe(410);
  });
  it("requires a session and sets the active project when a signed-in recipient accepts", async () => {
    mock.actor = null;
    expect((await redeem(request({ token }))).status).toBe(401);
    mock.actor = { ...owner, ...identity, projectId: "personal-reader" };
    const response = await redeem(request({ token, requestedProjectId: projectId }));
    expect(await response.json()).toEqual({ ok: true, projectId, publicAccess: false, defaultLanguage: "es", defaultSection: "overview" });
    expect(response.headers.get("set-cookie")).toContain(`house_planner_project=${projectId}`);
    expect(response.cookies.get(PUBLIC_ACCESS_LINK_COOKIE)?.maxAge).toBe(0);
  });
  it("grants the shared project on sign-in and returns its id", async () => {
    const response = await signIn(new Request("https://houseplanner.example/api/session", { method: "POST", headers: { Authorization: "Bearer id-token", "Content-Type": "application/json" }, body: JSON.stringify({ accessLinkToken: token, requestedProjectId: projectId }) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, projectId, defaultLanguage: "es", defaultSection: "overview" });
    expect(mock.data.get(key)).toMatchObject({ role: "viewer", accessLinkId: id });
    expect(response.headers.get("set-cookie")).toContain(`house_planner_project=${projectId}`);
    expect(response.cookies.get(PUBLIC_ACCESS_LINK_COOKIE)?.maxAge).toBe(0);
  });
  it("does not resurrect legacy access rejected by an administrator during sign-in", async () => {
    mock.data.set(`${USERS}/${identity.uid}`, { ...identity, legacyAccess: true, multiTenantReady: true, status: "approved" });
    mock.data.set(`${ACCESS_LINKS}/${id}`, { ...policy(), projectId: LEGACY_PROJECT_ID });
    const legacyKey = `${MEMBERSHIPS}/${membershipId(LEGACY_PROJECT_ID, identity.uid)}`;
    const denied = { projectId: LEGACY_PROJECT_ID, uid: identity.uid, status: "rejected", role: "viewer", reviewedBy: owner.email, accessLinkBlocked: true };
    mock.data.set(legacyKey, denied);
    const response = await signIn(new Request("https://houseplanner.example/api/session", { method: "POST", headers: { Authorization: "Bearer id-token", "Content-Type": "application/json" }, body: JSON.stringify({ accessLinkToken: token, requestedProjectId: LEGACY_PROJECT_ID }) }));
    expect(response.status).toBe(403);
    expect(mock.data.get(legacyKey)).toEqual(denied);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

describe("anonymous public link acceptance", () => {
  beforeEach(() => {
    mock.actor = null;
    mock.data.set(`${ACCESS_LINKS}/${id}`, { ...policy(), authentication: "public", defaultLanguage: "en", role: "admin" });
  });
  it("opens without authentication and creates only a viewer capability session", async () => {
    const beforeUsers = [...mock.data].filter(([path]) => path.startsWith(`${USERS}/`));
    const beforeMemberships = [...mock.data].filter(([path]) => path.startsWith(`${MEMBERSHIPS}/`));
    const response = await redeem(request({ token, requestedProjectId: projectId }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, projectId, publicAccess: true, defaultLanguage: "en", defaultSection: "overview" });
    expect(response.cookies.get(PUBLIC_ACCESS_LINK_COOKIE)).toMatchObject({ value: token, httpOnly: true, sameSite: "lax", path: "/" });
    expect(response.cookies.get(PUBLIC_ACCESS_LINK_COOKIE)?.maxAge).toBeLessThanOrEqual(86_400);
    expect(response.cookies.get(PUBLIC_ACCESS_LINK_COOKIE)?.maxAge).toBeGreaterThan(86_390);
    expect([...mock.data].filter(([path]) => path.startsWith(`${USERS}/`))).toEqual(beforeUsers);
    expect([...mock.data].filter(([path]) => path.startsWith(`${MEMBERSHIPS}/`))).toEqual(beforeMemberships);
    expect(mock.events).toEqual([]);
    expect(await resolvePublicAccessLink(token)).toMatchObject({ role: "viewer", status: "approved", anonymousLink: true, accessLinkId: id, permissions: { notes: false }, folderAccess: { folderIds: ["plans"] } });
    expect(mock.data.get(`${ACCESS_LINKS}/${id}`)?.redemptionCount).toBe(1);
  });
  it("caps guest cookies at fourteen days even for a longer stored expiry", async () => {
    mock.data.set(`${ACCESS_LINKS}/${id}`, { ...policy(), authentication: "public", expiresAt: new Date(Date.now() + 30 * 86_400_000) });
    expect((await redeemPublicAccessLink(token))?.maxAge).toBe(14 * 86_400);
  });
  it.each(["unknown", "expired", "revoked", "wrong-project", "project-deleted"])("denies %s capabilities without creating a session", async (condition) => {
    if (condition === "expired") mock.data.set(`${ACCESS_LINKS}/${id}`, { ...policy(), authentication: "public", expiresAt: new Date(0) });
    if (condition === "revoked") mock.data.set(`${ACCESS_LINKS}/${id}`, { ...policy(), authentication: "public", status: "revoked" });
    if (condition === "project-deleted") mock.data.delete(`${PROJECTS}/${projectId}`);
    const response = await redeem(request({ token: condition === "unknown" ? "b".repeat(43) : token, requestedProjectId: condition === "wrong-project" ? "other" : projectId }));
    expect(response.status).toBe(condition === "unknown" || condition === "project-deleted" ? 404 : condition === "wrong-project" ? 403 : 410);
    expect(response.cookies.get(PUBLIC_ACCESS_LINK_COOKIE)).toBeUndefined();
    expect(mock.data.has(key)).toBe(false);
  });
  it("preserves an authenticated administrator's independently approved access", async () => {
    mock.actor = owner;
    const ownerKey = `${MEMBERSHIPS}/${membershipId(projectId, owner.uid)}`;
    const existing = { projectId, uid: owner.uid, role: "admin", status: "approved", permissions: DEFAULT_MEMBER_PERMISSIONS };
    mock.data.set(ownerKey, existing);
    const response = await redeem(request({ token, requestedProjectId: projectId }));
    expect(await response.json()).toEqual({ ok: true, projectId, publicAccess: false, defaultLanguage: "en", defaultSection: "overview" });
    expect(mock.data.get(ownerKey)).toEqual(existing);
    expect(response.cookies.get(PUBLIC_ACCESS_LINK_COOKIE)?.maxAge).toBe(0);
    expect(response.cookies.get("house_planner_project")?.value).toBe(projectId);
    expect(mock.data.get(`${ACCESS_LINKS}/${id}`)?.redemptionCount).toBe(0);
  });
  it("grants a signed-in account without independent project access the link viewer policy", async () => {
    mock.actor = { ...owner, ...identity, projectId: "personal-reader" };
    const response = await redeem(request({ token }));
    expect(await response.json()).toMatchObject({ publicAccess: false, projectId, defaultLanguage: "en" });
    expect(mock.data.get(key)).toMatchObject({ role: "viewer", status: "approved", accessLinkId: id, permissions: { notes: false } });
    expect((await resolveMembershipAccess(mock.data.get(key)!)).linkDefaultLanguage).toBe("en");
    expect(response.cookies.get(PUBLIC_ACCESS_LINK_COOKIE)?.maxAge).toBe(0);
  });
  it("uses the underlying account when accepting a new link from guest mode", async () => {
    mock.actor = { ...owner, uid: `access-link-${id}`, email: "", anonymousLink: true, role: "viewer" };
    mock.accountIdentity = identity;
    const response = await redeem(request({ token }));
    expect(await response.json()).toMatchObject({ publicAccess: false });
    expect(mock.data.get(key)).toMatchObject({ uid: identity.uid, accessLinkId: id });
    expect([...mock.data.keys()].some((path) => path.startsWith(`${MEMBERSHIPS}/`) && path.includes("access-link-"))).toBe(false);
  });
  it("clears the guest capability on sign-out", async () => {
    const response = await signOut();
    expect(response.cookies.get(PUBLIC_ACCESS_LINK_COOKIE)).toMatchObject({ value: "", maxAge: 0 });
  });
});

describe("legacy account public link acceptance", () => {
  const legacyKey = `${MEMBERSHIPS}/${membershipId(LEGACY_PROJECT_ID, identity.uid)}`;
  const legacyPermissions = { ...DEFAULT_MEMBER_PERMISSIONS, budget: false, notes: true, expenses: true, distribution: true };
  const legacyFolders = { mode: "selected", folderIds: ["private-plans"], allowUnfiled: true };
  const legacyIdentity = (role = "editor") => ({ ...identity, status: "approved", role, permissions: legacyPermissions, folderAccess: legacyFolders });

  beforeEach(() => {
    mock.actor = null;
    mock.accountIdentity = identity;
    mock.data.set(`${PROJECTS}/${LEGACY_PROJECT_ID}`, { name: "Sample House", kind: "shared" });
    mock.data.set(`${ACCESS_LINKS}/${id}`, { ...policy(), projectId: LEGACY_PROJECT_ID, authentication: "public", defaultLanguage: "en", permissions: { ...allHidden, budget: true } });
    mock.data.set(`${USERS}/${identity.uid}`, legacyIdentity());
  });

  it.each(["admin", "editor", "viewer"])("preserves an approved legacy %s account before its first membership exists", async (role) => {
    const account = legacyIdentity(role);
    mock.data.set(`${USERS}/${identity.uid}`, account);
    const linkBefore = mock.data.get(`${ACCESS_LINKS}/${id}`);
    const response = await redeem(request({ token, requestedProjectId: LEGACY_PROJECT_ID }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, projectId: LEGACY_PROJECT_ID, publicAccess: false, defaultLanguage: "en", defaultSection: "budget" });
    expect(mock.data.get(legacyKey)).toMatchObject({ projectId: LEGACY_PROJECT_ID, uid: identity.uid, status: "approved", role, permissions: legacyPermissions, folderAccess: legacyFolders });
    expect(mock.data.get(legacyKey)?.accessLinkId).toBeUndefined();
    expect(mock.data.get(`${USERS}/${identity.uid}`)).toEqual(account);
    expect(mock.data.get(`${ACCESS_LINKS}/${id}`)).toEqual(linkBefore);
    expect(mock.events).toEqual([]);
    expect(response.cookies.get(PUBLIC_ACCESS_LINK_COOKIE)).toMatchObject({ value: "", maxAge: 0 });
    expect(response.cookies.get("house_planner_project")?.value).toBe(LEGACY_PROJECT_ID);
  });

  it.each(["legacy-member", undefined])("normalizes legacy role %s and missing permissions exactly as an active legacy session", async (role) => {
    mock.data.set(`${USERS}/${identity.uid}`, { ...identity, status: "approved", role, multiTenantReady: false });
    const response = await redeem(request({ token, requestedProjectId: LEGACY_PROJECT_ID }));

    expect(response.status).toBe(200);
    expect(mock.data.get(legacyKey)).toMatchObject({ role: "editor", status: "approved", permissions: DEFAULT_MEMBER_PERMISSIONS, folderAccess: { mode: "all", folderIds: [], allowUnfiled: true } });
    expect(mock.data.get(legacyKey)?.accessLinkId).toBeUndefined();
    expect(mock.data.get(`${ACCESS_LINKS}/${id}`)?.redemptionCount).toBe(0);
    expect(mock.events).toEqual([]);
  });

  it.each([
    { label: "pending legacy account", account: { status: "pending" } },
    { label: "rejected legacy account", account: { status: "rejected" } },
    { label: "legacy account without approval", account: { status: undefined } },
    { label: "already migrated account", account: { multiTenantReady: true } },
  ])("uses only the link viewer policy for a $label", async ({ account }) => {
    mock.data.set(`${USERS}/${identity.uid}`, { ...legacyIdentity("admin"), ...account });
    const response = await redeem(request({ token, requestedProjectId: LEGACY_PROJECT_ID }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ projectId: LEGACY_PROJECT_ID, publicAccess: false });
    expect(mock.data.get(legacyKey)).toMatchObject({ role: "viewer", status: "approved", accessLinkId: id, permissions: { ...allHidden, budget: true }, folderAccess: { mode: "selected", folderIds: ["plans"], allowUnfiled: false } });
    expect(mock.data.get(`${ACCESS_LINKS}/${id}`)?.redemptionCount).toBe(1);
  });

  it("never carries legacy account permissions into another project", async () => {
    mock.data.set(`${USERS}/${identity.uid}`, legacyIdentity("admin"));
    mock.data.set(`${ACCESS_LINKS}/${id}`, { ...policy(), authentication: "public", permissions: { ...allHidden, budget: true } });
    const response = await redeem(request({ token, requestedProjectId: projectId }));

    expect(response.status).toBe(200);
    expect(mock.data.has(legacyKey)).toBe(false);
    expect(mock.data.get(key)).toMatchObject({ projectId, role: "viewer", accessLinkId: id, permissions: { ...allHidden, budget: true }, folderAccess: { mode: "selected", folderIds: ["plans"], allowUnfiled: false } });
    expect(mock.data.get(`${ACCESS_LINKS}/${id}`)?.redemptionCount).toBe(1);
  });

  it.each([
    { label: "individually rejected", membership: { status: "rejected", accessLinkBlocked: true } },
    { label: "reviewed pending", membership: { status: "pending", reviewedBy: owner.email } },
    { label: "removed", membership: { status: "approved", removed: true } },
  ])("does not restore inherited access over an existing $label membership", async ({ membership }) => {
    mock.data.set(`${USERS}/${identity.uid}`, legacyIdentity("admin"));
    const existing = { projectId: LEGACY_PROJECT_ID, uid: identity.uid, role: "viewer", ...membership, permissions: allHidden };
    mock.data.set(legacyKey, existing);
    const before = [...mock.data];
    const response = await redeem(request({ token, requestedProjectId: LEGACY_PROJECT_ID }));

    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect([...mock.data]).toEqual(before);
    expect(mock.events).toEqual([]);
  });

  it("uses the existing independently granted membership rather than wider historical account permissions", async () => {
    mock.data.set(`${USERS}/${identity.uid}`, legacyIdentity("admin"));
    const direct = { projectId: LEGACY_PROJECT_ID, uid: identity.uid, status: "approved", role: "viewer", permissions: { ...allHidden, documents: true }, folderAccess: { mode: "selected", folderIds: ["current-plans"], allowUnfiled: false } };
    mock.data.set(legacyKey, direct);
    const response = await redeem(request({ token, requestedProjectId: LEGACY_PROJECT_ID }));

    expect(response.status).toBe(200);
    expect(mock.data.get(legacyKey)).toEqual(direct);
    expect(mock.data.get(`${ACCESS_LINKS}/${id}`)?.redemptionCount).toBe(0);
    expect(mock.events).toEqual([]);
  });

  it("does not restore legacy permissions over an existing pending membership", async () => {
    mock.data.set(`${USERS}/${identity.uid}`, legacyIdentity("admin"));
    mock.data.set(legacyKey, { projectId: LEGACY_PROJECT_ID, uid: identity.uid, status: "pending", role: "editor" });
    const response = await redeem(request({ token, requestedProjectId: LEGACY_PROJECT_ID }));

    expect(response.status).toBe(200);
    expect(mock.data.get(legacyKey)).toMatchObject({ role: "viewer", status: "approved", accessLinkId: id, permissions: { ...allHidden, budget: true } });
    expect(mock.data.get(`${ACCESS_LINKS}/${id}`)?.redemptionCount).toBe(1);
  });

  it("fails without writes or cookies when checking the legacy account fails", async () => {
    const before = [...mock.data];
    mock.beforeGet = (ref) => { if (ref.path === `${USERS}/${identity.uid}`) throw new Error("account read failed"); };
    mock.beforeGetAll = (refs) => { if (refs.some((ref) => ref.path === `${USERS}/${identity.uid}`)) throw new Error("account read failed"); };
    const response = await redeem(request({ token, requestedProjectId: LEGACY_PROJECT_ID }));

    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect([...mock.data]).toEqual(before);
    expect(mock.events).toEqual([]);
  });
});

describe("membership administration and project switching", () => {
  it("detaches a customized member, preserving effective folder access", async () => {
    await redeemAccessLink(identity, token);
    mock.data.set(`${ACCESS_LINKS}/${id}`, { ...policy(), folderAccess: { mode: "selected", folderIds: ["updated"], allowUnfiled: true } });
    await editMember(request({ uid: identity.uid, action: "permissions", permissions: { ...DEFAULT_MEMBER_PERMISSIONS, budget: false } }));
    expect(mock.data.get(key)).toMatchObject({ status: "approved", role: "viewer", permissions: { budget: false }, folderAccess: { folderIds: ["updated"] } });
    expect(mock.data.get(key)?.accessLinkId).toBeUndefined();
    await PATCH(request({ id, action: "revoke" }));
    expect((await resolveMembershipAccess(mock.data.get(key)!)).status).toBe("approved");
  });
  it("does not let an individually revoked recipient accept the same link again", async () => {
    await redeemAccessLink(identity, token);
    await editMember(request({ uid: identity.uid, action: "revoke", role: "viewer" }));
    await expect(redeemAccessLink(identity, token)).rejects.toMatchObject({ status: 403 });
    expect(mock.data.get(key)?.accessLinkId).toBeUndefined();
  });
  it.each(["revoke", "reject"])("withdraws membership and pending invitation tokens together on %s, preserving other projects", async (action) => {
    const inviteToken = "d".repeat(43);
    const inviteKey = `${INVITATIONS}/${accessLinkTokenHash(inviteToken)}`;
    const invitation = { projectId, email: identity.email, role: "viewer", status: "pending", createdAt: new Date("2026-10-01T00:00:00Z"), expiresAt: new Date(Date.now() + 86_400_000) };
    mock.data.set(inviteKey, invitation);
    mock.data.set(`${INVITATIONS}/another-project`, { ...invitation, projectId: "other-project" });
    mock.data.set(`${INVITATIONS}/another-user`, { ...invitation, email: "other@example.com" });
    mock.data.set(`${INVITATIONS}/prior-account-email`, { ...invitation, email: "old@example.com", acceptedByUid: identity.uid });
    mock.data.set(key, { projectId, uid: identity.uid, role: "viewer", status: "approved", permissions: { ...DEFAULT_MEMBER_PERMISSIONS, budget: false }, folderAccess: { mode: "selected", folderIds: ["plans"], allowUnfiled: false } });
    const response = await editMember(request({ uid: identity.uid, action, role: "viewer" }));
    expect(response.status).toBe(200);
    expect(mock.data.get(key)).toMatchObject({ status: action === "revoke" ? "pending" : "rejected", accessLinkBlocked: true, role: "viewer", permissions: { budget: false } });
    expect(mock.data.get(inviteKey)?.status).toBe("revoked");
    expect(mock.data.get(`${INVITATIONS}/prior-account-email`)?.status).toBe("revoked");
    expect(mock.data.get(`${INVITATIONS}/another-project`)).toEqual({ ...invitation, projectId: "other-project" });
    expect(mock.data.get(`${INVITATIONS}/another-user`)?.status).toBe("pending");
    const denied = await signIn(new Request("https://houseplanner.example/api/session", { method: "POST", headers: { Authorization: "Bearer id-token", "Content-Type": "application/json" }, body: JSON.stringify({ inviteToken }) }));
    expect(denied.status).toBe(403);
    expect(denied.headers.get("set-cookie")).toBeNull();
    expect(mock.data.get(key)?.status).toBe(action === "revoke" ? "pending" : "rejected");
    const newInvitation = await inviteMember(request({ email: identity.email, role: "viewer", permissions: { ...DEFAULT_MEMBER_PERMISSIONS, budget: false } }, "/api/invitations"));
    expect(newInvitation.status).toBe(201);
    const created = await newInvitation.json();
    const accepted = await signIn(new Request("https://houseplanner.example/api/session", { method: "POST", headers: { Authorization: "Bearer id-token", "Content-Type": "application/json" }, body: JSON.stringify({ inviteToken: new URL(created.inviteUrl).searchParams.get("invite") }) }));
    expect(accepted.status).toBe(200);
    expect(mock.data.get(key)).toMatchObject({ status: "approved", role: "viewer", accessLinkBlocked: false, permissions: { budget: false } });
  });
  it("does not accept a previously read token when access is revoked during sign-in", async () => {
    const inviteToken = "d".repeat(43);
    const inviteKey = `${INVITATIONS}/${accessLinkTokenHash(inviteToken)}`;
    mock.data.set(inviteKey, { projectId, email: identity.email, role: "viewer", status: "pending", createdAt: new Date("2026-10-01T00:00:00Z"), expiresAt: new Date(Date.now() + 86_400_000) });
    mock.data.set(key, { projectId, uid: identity.uid, role: "viewer", status: "approved" });
    mock.beforeGetAll = async (refs) => {
      if (refs.some((ref) => ref.path === inviteKey)) {
        mock.beforeGetAll = null;
        expect((await editMember(request({ uid: identity.uid, action: "revoke", role: "viewer" }))).status).toBe(200);
      }
    };
    const response = await signIn(new Request("https://houseplanner.example/api/session", { method: "POST", headers: { Authorization: "Bearer id-token", "Content-Type": "application/json" }, body: JSON.stringify({ inviteToken }) }));
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mock.data.get(key)?.status).toBe("pending");
    expect(mock.data.get(inviteKey)?.status).toBe("revoked");
  });
  it("blocks legacy pending invitations created before an individual access withdrawal", async () => {
    const inviteToken = "d".repeat(43);
    mock.data.set(`${INVITATIONS}/${accessLinkTokenHash(inviteToken)}`, { projectId, email: identity.email, status: "pending", createdAt: new Date("2026-10-01T00:00:00Z"), expiresAt: new Date(Date.now() + 86_400_000) });
    const revoked = { projectId, uid: identity.uid, role: "viewer", status: "pending", accessLinkBlocked: true, reviewedAt: new Date("2026-10-04T12:00:00Z") };
    mock.data.set(key, revoked);
    const response = await signIn(new Request("https://houseplanner.example/api/session", { method: "POST", headers: { Authorization: "Bearer id-token", "Content-Type": "application/json" }, body: JSON.stringify({ inviteToken }) }));
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mock.data.get(key)).toEqual(revoked);
  });
  it("accepts a new administrator invitation issued after the withdrawal cutoff", async () => {
    const inviteToken = "d".repeat(43);
    mock.data.set(`${INVITATIONS}/${accessLinkTokenHash(inviteToken)}`, { projectId, email: identity.email, role: "viewer", status: "pending", createdAt: new Date("2026-10-05T00:00:00Z"), expiresAt: new Date(Date.now() + 86_400_000), permissions: { ...DEFAULT_MEMBER_PERMISSIONS, budget: false } });
    mock.data.set(key, { projectId, uid: identity.uid, role: "viewer", status: "rejected", accessLinkBlocked: true, reviewedAt: new Date("2026-10-04T12:00:00Z") });
    const response = await signIn(new Request("https://houseplanner.example/api/session", { method: "POST", headers: { Authorization: "Bearer id-token", "Content-Type": "application/json" }, body: JSON.stringify({ inviteToken }) }));
    expect(response.status).toBe(200);
    expect(mock.data.get(key)).toMatchObject({ status: "approved", role: "viewer", accessLinkBlocked: false, permissions: { budget: false } });
  });
  it("preserves an idempotent direct approval's role, permissions and review history", async () => {
    const member = { projectId, uid: identity.uid, role: "viewer", status: "approved", accessLinkBlocked: false, permissions: { ...DEFAULT_MEMBER_PERMISSIONS, budget: false }, folderAccess: { mode: "selected", folderIds: ["plans"], allowUnfiled: false }, reviewedAt: new Date("2026-10-01T00:00:00Z") };
    mock.data.set(key, member);
    expect((await editMember(request({ uid: identity.uid, action: "approve", role: "viewer" }))).status).toBe(200);
    expect(mock.data.get(key)).toEqual(member);
    expect(mock.events).toHaveLength(0);
  });
  it("leaves member and tokens unchanged when revocation would exceed transaction limits", async () => {
    const member = { projectId, uid: identity.uid, role: "viewer", status: "approved" };
    mock.data.set(key, member);
    for (let index = 0; index < 498; index++) mock.data.set(`${INVITATIONS}/pending-${index}`, { projectId, email: identity.email, status: "pending" });
    expect((await editMember(request({ uid: identity.uid, action: "revoke", role: "viewer" }))).status).toBe(409);
    expect(mock.data.get(key)).toEqual(member);
    expect(mock.data.get(`${INVITATIONS}/pending-0`)?.status).toBe("pending");
    expect(mock.events).toHaveLength(0);
  });
  it("rolls back member and invitation changes when the audit write fails", async () => {
    const member = { projectId, uid: identity.uid, role: "viewer", status: "approved" };
    const invitation = { projectId, email: identity.email, status: "pending" };
    mock.data.set(key, member); mock.data.set(`${INVITATIONS}/pending`, invitation); mock.failAudit = true;
    await expect(editMember(request({ uid: identity.uid, action: "reject", role: "viewer" }))).rejects.toThrow("audit failed");
    expect(mock.data.get(key)).toEqual(member);
    expect(mock.data.get(`${INVITATIONS}/pending`)).toEqual(invitation);
  });
  it("rejects revocation after administrator access is withdrawn, leaving pending tokens intact", async () => {
    const member = { projectId, uid: identity.uid, role: "viewer", status: "approved" };
    mock.data.set(key, member); mock.data.set(`${INVITATIONS}/pending`, { projectId, email: identity.email, status: "pending" });
    mock.data.set(`${MEMBERSHIPS}/${membershipId(projectId, owner.uid)}`, { projectId, uid: owner.uid, role: "admin", status: "rejected" });
    expect((await editMember(request({ uid: identity.uid, action: "revoke" }))).status).toBe(403);
    expect(mock.data.get(key)).toEqual(member);
    expect(mock.data.get(`${INVITATIONS}/pending`)?.status).toBe("pending");
  });
  it("hides revoked link projects from project selection and rejects switching to them", async () => {
    await redeemAccessLink(identity, token);
    mock.data.set(`${ACCESS_LINKS}/${id}`, { ...policy(), status: "revoked" });
    mock.actor = { ...owner, ...identity, projectId: "personal-reader", isPersonal: true };
    mock.data.set(`${MEMBERSHIPS}/personal-reader__reader`, { uid: "reader", projectId: "personal-reader", status: "approved", role: "admin" });
    mock.data.set(`${PROJECTS}/personal-reader`, { name: "Personal", kind: "personal" });
    const listed = await (await listProjects()).json();
    expect(listed.projects.map((project: { id: string }) => project.id)).not.toContain(projectId);
    expect((await switchProject(request({ projectId }))).status).toBe(403);
  });
  it("lets an authenticated recipient recover by choosing an independently authorized personal workspace", async () => {
    mock.actor = { ...owner, ...identity, projectId, role: "viewer", status: "rejected", accessLinkId: id };
    mock.data.set(`${MEMBERSHIPS}/personal-reader__reader`, { uid: "reader", projectId: "personal-reader", status: "approved", role: "admin" });
    mock.data.set(`${PROJECTS}/personal-reader`, { name: "Personal", kind: "personal" });
    const response = await switchProject(request({ projectId: "personal-reader" }));
    expect(response.status).toBe(200);
    expect(mock.cookieSet).toHaveBeenCalledWith("house_planner_project", "personal-reader", expect.objectContaining({ httpOnly: true }));
    expect((await switchProject(request({ projectId: "personal-owner" }))).status).toBe(403);
  });
  it("excludes revoked or expired links from countdown email recipients", async () => {
    mock.data.delete(`${MEMBERSHIPS}/${membershipId(projectId, owner.uid)}`);
    await redeemAccessLink(identity, token);
    expect(await eligibleCountdownRecipients(projectId)).toEqual([expect.objectContaining({ uid: identity.uid, role: "viewer" })]);
    mock.data.set(`${ACCESS_LINKS}/${id}`, { ...policy(), permissions: { ...DEFAULT_MEMBER_PERMISSIONS, plan: false } });
    expect(await eligibleCountdownRecipients(projectId)).toEqual([]);
    mock.data.set(`${ACCESS_LINKS}/${id}`, { ...policy(), status: "revoked" });
    expect(await eligibleCountdownRecipients(projectId)).toEqual([]);
    mock.data.set(`${ACCESS_LINKS}/${id}`, { ...policy(), expiresAt: new Date(0) });
    expect(await eligibleCountdownRecipients(projectId)).toEqual([]);
  });
});
