import { beforeEach, describe, expect, it, vi } from "vitest";
import { INVITATIONS, MEMBERSHIPS, membershipId, PROJECTS, USERS } from "@/lib/project";

const mock = vi.hoisted(() => {
  const records = new Map<string, Record<string, unknown>>();
  const actor = vi.fn();
  const append = vi.fn();
  const timestamp = { toMillis: () => Date.parse("2026-10-09T02:00:00Z"), toDate: () => new Date("2026-10-09T02:00:00Z") };
  type Ref = { path: string; id: string };
  const snapshot = (ref: Ref) => ({ ...ref, ref, exists: records.has(ref.path), data: () => records.get(ref.path) });
  const collection = (name: string) => {
    const query = (filters: [string, unknown][] = []) => ({
      kind: "query", name, filters,
      where: (field: string, _operator: string, value: unknown) => query([...filters, [field, value]]),
      get: async () => ({ docs: [...records].filter(([path, data]) => path.startsWith(`${name}/`) && filters.every(([field, value]) => data[field] === value)).map(([path]) => snapshot({ path, id: path.slice(name.length + 1) })) }),
    });
    return { ...query(), doc: (id: string) => {
      const ref = { path: `${name}/${id}`, id };
      return { ...ref, get: async () => snapshot(ref) };
    } };
  };
  const runTransaction = async (callback: (transaction: unknown) => Promise<unknown>) => {
    const staged: [Ref, Record<string, unknown>][] = [];
    const transaction = {
      getAll: async (...refs: Ref[]) => refs.map(snapshot),
      get: async (ref: Ref & { kind?: string; get?: () => unknown }) => ref.kind === "query" ? ref.get!() : snapshot(ref),
      set: (ref: Ref, data: Record<string, unknown>) => staged.push([ref, data]),
    };
    const result = await callback(transaction);
    for (const [ref, values] of staged) {
      const data = { ...records.get(ref.path) };
      for (const [field, value] of Object.entries(values)) {
        if (value && typeof value === "object" && "union" in value) data[field] = [...new Set([...(Array.isArray(data[field]) ? data[field] : []), ...(value as { union: unknown[] }).union])];
        else if (value && typeof value === "object" && "deleted" in value) delete data[field];
        else data[field] = value;
      }
      records.set(ref.path, data);
    }
    return result;
  };
  return { records, actor, append, timestamp, collection, runTransaction };
});

vi.mock("@/lib/auth", () => ({ requireApproved: mock.actor }));
vi.mock("@/lib/firebase-admin", () => ({ firestore: { collection: mock.collection, runTransaction: mock.runTransaction, batch: () => ({ set: vi.fn(), commit: vi.fn() }) } }));
vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => mock.timestamp, delete: () => ({ deleted: true }), arrayUnion: (...union: unknown[]) => ({ union }) } }));
vi.mock("@/lib/activity", () => ({ appendActivity: mock.append, commitActivity: vi.fn(), diffChanges: vi.fn() }));
vi.mock("@/lib/usage-actions", () => ({ recordActivityUsage: vi.fn() }));
vi.mock("@/lib/access-links", () => ({ resolveMembershipAccess: async (data: unknown) => data }));
vi.mock("@/lib/folders", () => ({ findExpenseInvoiceFolder: vi.fn(), findExpensePurchaseFolder: vi.fn() }));

import { DELETE, GET, PATCH } from "@/app/api/access/route";

const projectId = "project-a";
const targetKey = `${MEMBERSHIPS}/${membershipId(projectId, "member")}`;
const adminKey = `${MEMBERSHIPS}/${membershipId(projectId, "admin")}`;
const request = (body: unknown, method = "DELETE") => new Request("https://example.com/api/access", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("HOUSE_PLANNER_ADMIN_EMAIL", "platform@example.com");
  mock.records.clear();
  mock.append.mockResolvedValue({ id: "removal-event" });
  mock.actor.mockResolvedValue({ uid: "admin", projectId, email: "owner@example.com", name: "Owner", role: "admin", status: "approved" });
  mock.records.set(adminKey, { uid: "admin", projectId, role: "admin", status: "approved" });
  mock.records.set(targetKey, { uid: "member", projectId, role: "editor", status: "approved", accessLinkId: "old-link" });
  mock.records.set(`${USERS}/member`, { email: "Member@Example.com", name: "Andres", canCreateProjects: true });
  mock.records.set(`${PROJECTS}/${projectId}`, { ownerUid: "admin", name: "Project A" });
});

describe("removing a project member", () => {
  it("keeps contributions and other projects while hiding and denying this membership", async () => {
    const identity = mock.records.get(`${USERS}/member`);
    mock.records.set(`${MEMBERSHIPS}/project-b__member`, { uid: "member", projectId: "project-b", status: "approved" });
    mock.records.set("housePlannerDocuments/report", { projectId, uploadedBy: "Member@Example.com", title: "Report", storagePath: "report.pdf" });
    const response = await DELETE(request({ uid: "member" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ removedUid: "member" });
    const membership = mock.records.get(targetKey)!;
    expect(membership).toMatchObject({ status: "rejected", removed: true, removedEmail: "member@example.com", removedEmails: ["member@example.com"], accessLinkBlocked: true, folderAccess: { mode: "selected", folderIds: [], allowUnfiled: false } });
    expect(Object.values(membership.permissions as Record<string, boolean>).every((enabled) => !enabled)).toBe(true);
    expect(membership.accessLinkId).toBeUndefined();
    expect(mock.records.get(`${USERS}/member`)).toBe(identity);
    expect(mock.records.get(`${MEMBERSHIPS}/project-b__member`)?.status).toBe("approved");
    expect(mock.records.get("housePlannerDocuments/report")).toMatchObject({ uploadedBy: "Member@Example.com", storagePath: "report.pdf" });
    expect(mock.append).toHaveBeenCalledOnce();
    expect(mock.append.mock.calls[0][2]).toMatchObject({ action: "access.member_removed", target: { label: "Usuario desactivado", exists: false } });
    const listing = await GET().then((result) => result.json());
    expect(listing.users.map((user: { uid: string }) => user.uid)).toEqual(["admin"]);
    expect((await PATCH(request({ uid: "member", action: "approve" }, "PATCH"))).status).toBe(404);
  });

  it("revokes and hides all old invitations only for this member and project", async () => {
    for (const [id, data] of Object.entries({
      pending: { projectId, email: "member@example.com", status: "pending" },
      accepted: { projectId, email: "prior@example.com", acceptedByUid: "member", status: "accepted" },
      revoked: { projectId, email: "member@example.com", status: "revoked" },
      expired: { projectId, email: "member@example.com", status: "expired" },
      unrelated: { projectId, email: "other@example.com", status: "pending" },
      otherProject: { projectId: "project-b", email: "member@example.com", status: "pending" },
    })) mock.records.set(`${INVITATIONS}/${id}`, data);
    await DELETE(request({ uid: "member" }));
    expect(mock.records.get(`${INVITATIONS}/pending`)?.status).toBe("revoked");
    expect(mock.records.get(`${INVITATIONS}/pending`)).toMatchObject({ revokedReason: "member_removed", removedMemberUid: "member" });
    expect(mock.records.get(`${INVITATIONS}/accepted`)?.status).toBe("revoked");
    expect(mock.records.get(targetKey)?.removedEmails).toEqual(["member@example.com", "prior@example.com"]);
    expect(mock.records.get(`${INVITATIONS}/revoked`)?.revokedReason).toBe("member_removed");
    expect(mock.records.get(`${INVITATIONS}/expired`)?.revokedReason).toBe("member_removed");
    expect(mock.records.get(`${INVITATIONS}/unrelated`)?.status).toBe("pending");
    expect(mock.records.get(`${INVITATIONS}/otherProject`)?.status).toBe("pending");
    await GET();
    expect(mock.records.get(targetKey)?.removed).toBe(true);
  });

  it.each(["pending", "rejected"])("also removes a %s member", async (status) => {
    mock.records.set(targetKey, { ...mock.records.get(targetKey), status });
    expect((await DELETE(request({ uid: "member" }))).status).toBe(200);
    expect(mock.records.get(targetKey)?.removed).toBe(true);
  });

  it("is idempotent and preserves the original history cutoff", async () => {
    await DELETE(request({ uid: "member" }));
    const cutoff = mock.records.get(targetKey)?.removedAt;
    expect((await DELETE(request({ uid: "member" }))).status).toBe(200);
    expect(mock.records.get(targetKey)?.removedAt).toBe(cutoff);
    expect(mock.append).toHaveBeenCalledOnce();
  });

  it("denies a non-administrator before any transaction", async () => {
    mock.actor.mockResolvedValue(null);
    expect((await DELETE(request({ uid: "member" }))).status).toBe(403);
    expect(mock.records.get(targetKey)?.removed).toBeUndefined();
    expect(mock.append).not.toHaveBeenCalled();
  });

  it("rechecks administrator access inside the transaction", async () => {
    mock.records.set(adminKey, { ...mock.records.get(adminKey), status: "rejected" });
    expect((await DELETE(request({ uid: "member" }))).status).toBe(403);
    expect(mock.records.get(targetKey)?.removed).toBeUndefined();
  });

  it.each([{}, { uid: 1 }, { uid: "" }, { uid: " " }, { uid: "bad/path" }, { uid: "x".repeat(129) }])("validates the target uid %j", async (body) => {
    expect((await DELETE(request(body))).status).toBe(400);
    expect(mock.append).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON", async () => {
    expect((await DELETE(new Request("https://example.com/api/access", { method: "DELETE", body: "{" }))).status).toBe(400);
  });

  it("does not remove oneself, another administrator, or the project/platform owner", async () => {
    expect((await DELETE(request({ uid: "admin" }))).status).toBe(400);
    mock.records.set(targetKey, { ...mock.records.get(targetKey), role: "admin" });
    expect((await DELETE(request({ uid: "member" }))).status).toBe(400);
    mock.records.set(targetKey, { ...mock.records.get(targetKey), role: "editor" });
    mock.records.set(`${PROJECTS}/${projectId}`, { ownerUid: "member" });
    expect((await DELETE(request({ uid: "member" }))).status).toBe(400);
    mock.records.set(`${PROJECTS}/${projectId}`, { ownerUid: "admin" });
    mock.records.set(`${USERS}/member`, { email: "PLATFORM@example.com" });
    expect((await DELETE(request({ uid: "member" }))).status).toBe(400);
    expect(mock.append).not.toHaveBeenCalled();
  });

  it("rejects missing and cross-project membership records", async () => {
    mock.records.delete(targetKey);
    expect((await DELETE(request({ uid: "member" }))).status).toBe(404);
    mock.records.set(targetKey, { uid: "member", projectId: "other", status: "approved" });
    expect((await DELETE(request({ uid: "member" }))).status).toBe(404);
    expect(mock.append).not.toHaveBeenCalled();
  });

  it("rolls back a failed audit write", async () => {
    mock.append.mockRejectedValueOnce(new Error("audit failed"));
    await expect(DELETE(request({ uid: "member" }))).rejects.toThrow("audit failed");
    expect(mock.records.get(targetKey)?.status).toBe("approved");
    expect(mock.records.get(targetKey)?.removed).toBeUndefined();
  });
});
