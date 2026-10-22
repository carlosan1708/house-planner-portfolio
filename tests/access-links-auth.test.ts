import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionAccountIdentity, getSessionMember, publicMember, requireApproved, requireTabAccess } from "@/lib/auth";
import { ACCESS_LINKS, accessLinkTokenHash } from "@/lib/access-links";
import { ACTIVE_PROJECT_COOKIE, DEFAULT_MEMBER_PERMISSIONS, MEMBERSHIPS, PROJECTS, PUBLIC_ACCESS_LINK_COOKIE, SESSION_COOKIE, USERS } from "@/lib/project";

const mock = vi.hoisted(() => ({ data: new Map<string, Record<string, unknown>>(), session: "session-cookie", activeProject: "shared", publicToken: undefined as string | undefined, verify: vi.fn(), reads: [] as string[], failRead: false }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => {
  const value = name === SESSION_COOKIE ? mock.session : name === ACTIVE_PROJECT_COOKIE ? mock.activeProject : name === PUBLIC_ACCESS_LINK_COOKIE ? mock.publicToken : undefined;
  return value === undefined ? undefined : { value };
} }) }));
vi.mock("@/lib/activity", () => ({ appendActivity: vi.fn() }));
vi.mock("@/lib/firebase-admin", () => {
  function snapshot(path: string) { return { exists: mock.data.has(path), data: () => mock.data.get(path) }; }
  return { adminAuth: { verifySessionCookie: mock.verify }, firestore: { collection: (name: string) => ({
    doc: (id: string) => ({ get: async () => { mock.reads.push(`${name}/${id}`); if (mock.failRead) throw new Error("unavailable"); return snapshot(`${name}/${id}`); } }),
    where: (field: string, _operator: string, value: unknown) => ({ get: async () => ({ docs: [...mock.data].filter(([path, data]) => path.startsWith(`${name}/`) && data[field] === value).map(([path]) => snapshot(path)) }) }),
  }) } };
});

const id = "a".repeat(64);
const link = () => ({ projectId: "shared", status: "active", expiresAt: new Date(Date.now() + 86_400_000), permissions: { ...DEFAULT_MEMBER_PERMISSIONS, budget: false, distribution: true }, folderAccess: { mode: "selected", folderIds: ["plans"], allowUnfiled: false } });

beforeEach(() => {
  mock.data.clear(); mock.session = "session-cookie"; mock.activeProject = "shared"; mock.publicToken = undefined; mock.reads = []; mock.failRead = false;
  mock.verify.mockReset().mockResolvedValue({ uid: "reader", email: "reader@example.com" });
  mock.data.set(`${USERS}/reader`, { email: "reader@example.com", name: "Reader", role: "admin", status: "approved" });
  mock.data.set(`${PROJECTS}/shared`, { name: "Shared", kind: "shared" });
  mock.data.set(`${PROJECTS}/personal-reader`, { name: "Personal", kind: "personal" });
  mock.data.set(`${MEMBERSHIPS}/shared__reader`, { uid: "reader", projectId: "shared", role: "admin", status: "approved", accessLinkId: id, permissions: DEFAULT_MEMBER_PERMISSIONS });
  mock.data.set(`${ACCESS_LINKS}/${id}`, link());
});

describe("public read-only capability sessions", () => {
  const token = "p".repeat(43);
  const publicId = accessLinkTokenHash(token);
  beforeEach(() => {
    mock.publicToken = token;
    mock.data.set(`${ACCESS_LINKS}/${publicId}`, { ...link(), authentication: "public", defaultLanguage: "en", role: "admin" });
  });
  it("admits an unauthenticated guest without reading users or memberships", async () => {
    mock.session = "";
    const member = await getSessionMember();
    expect(member).toMatchObject({ projectId: "shared", email: "", role: "viewer", status: "approved", anonymousLink: true, accessLinkId: publicId, linkDefaultLanguage: "en", permissions: { budget: false, distribution: true } });
    expect(mock.verify).not.toHaveBeenCalled();
    expect(mock.reads).toEqual([`${ACCESS_LINKS}/${publicId}`, `${PROJECTS}/shared`]);
    expect(publicMember(member)).toMatchObject({ anonymousLink: true, readOnlyLink: true, canViewPlatformAnalytics: false, linkDefaultLanguage: "en" });
    expect(publicMember(member)).not.toHaveProperty("accessLinkId");
    expect(JSON.stringify(publicMember(member))).not.toContain(token);
    expect(publicMember(member)?.projectCurrency).toBe("CRC");
  });
  it("serializes the current project denomination for public capabilities", async () => {
    mock.data.set(`${PROJECTS}/shared`, { name: "Shared", kind: "shared", currency: "USD" });
    const member = await getSessionMember();
    expect(member?.projectCurrency).toBe("USD");
    expect(publicMember(member)?.projectCurrency).toBe("USD");
  });
  it("limits a signed-in administrator to the public policy", async () => {
    mock.data.set(`${MEMBERSHIPS}/shared__reader`, { projectId: "shared", role: "admin", status: "approved", permissions: DEFAULT_MEMBER_PERMISSIONS });
    expect(await getSessionMember()).toMatchObject({ role: "viewer", permissions: { budget: false }, anonymousLink: true });
    expect(await requireApproved(["admin", "editor"])).toBeNull();
    expect(await requireTabAccess("budget")).toBeNull();
    expect(await requireTabAccess("documents")).toMatchObject({ role: "viewer" });
    expect(mock.verify).not.toHaveBeenCalled();
  });
  it("reads current policy changes on the next request", async () => {
    expect((await getSessionMember())?.linkDefaultLanguage).toBe("en");
    mock.data.set(`${ACCESS_LINKS}/${publicId}`, { ...link(), authentication: "public", defaultLanguage: "es", permissions: { ...DEFAULT_MEMBER_PERMISSIONS, budget: true }, folderAccess: { mode: "selected", folderIds: ["new"], allowUnfiled: true } });
    expect(await getSessionMember()).toMatchObject({ linkDefaultLanguage: "es", permissions: { budget: true }, folderAccess: { folderIds: ["new"], allowUnfiled: true } });
  });
  it.each(["revoked", "expired", "missing", "account", "project-deleted", "malformed", "empty", "unavailable"])("fails closed for %s capabilities despite a valid account session", async (condition) => {
    if (condition === "missing") mock.data.delete(`${ACCESS_LINKS}/${publicId}`);
    else if (condition === "project-deleted") mock.data.delete(`${PROJECTS}/shared`);
    else if (condition === "malformed") mock.publicToken = "invalid";
    else if (condition === "empty") mock.publicToken = "";
    else if (condition === "unavailable") mock.failRead = true;
    else mock.data.set(`${ACCESS_LINKS}/${publicId}`, { ...link(), authentication: condition === "account" ? "account" : "public", ...(condition === "expired" ? { expiresAt: new Date(0) } : condition === "revoked" ? { status: "revoked" } : {}) });
    expect(await getSessionMember()).toBeNull();
    expect(await requireApproved()).toBeNull();
    expect(mock.verify).not.toHaveBeenCalled();
  });
  it("can verify the underlying account identity only for explicitly accepting an account link", async () => {
    expect(await getSessionAccountIdentity()).toEqual({ uid: "reader", name: "Reader", email: "reader@example.com" });
    expect(await getSessionMember()).toMatchObject({ anonymousLink: true });
  });
});

describe("server authentication for read-only link recipients", () => {
  it("reads authoritative currency without changing language or legacy records", async () => {
    expect((await getSessionMember())?.projectCurrency).toBe("CRC");
    expect(mock.data.get(`${PROJECTS}/shared`)).not.toHaveProperty("currency");
    mock.data.set(`${PROJECTS}/shared`, { name: "Shared", kind: "shared", currency: "USD" });
    expect(publicMember(await getSessionMember())?.projectCurrency).toBe("USD");
  });
  it("reads current link permissions and folders, overriding stale membership data", async () => {
    expect(await getSessionMember()).toMatchObject({ projectId: "shared", role: "viewer", status: "approved", permissions: { budget: false, distribution: true }, folderAccess: { mode: "selected", folderIds: ["plans"], allowUnfiled: false } });
    expect(mock.verify).toHaveBeenCalledWith("session-cookie", true);
  });
  it("denies editor/admin operations and disabled sections through existing guards", async () => {
    expect(await requireApproved(["admin", "editor"])).toBeNull();
    expect(await requireTabAccess("budget")).toBeNull();
    expect(await requireTabAccess("documents", ["admin", "editor"])).toBeNull();
    expect(await requireTabAccess("documents")).toMatchObject({ role: "viewer" });
  });
  it.each(["revoked", "expired", "missing"])("denies project APIs for an already signed-in user after the link is %s", async (condition) => {
    if (condition === "missing") mock.data.delete(`${ACCESS_LINKS}/${id}`);
    else mock.data.set(`${ACCESS_LINKS}/${id}`, { ...link(), ...(condition === "expired" ? { expiresAt: new Date(0) } : { status: "revoked" }) });
    expect(await requireApproved()).toBeNull();
    expect(await requireTabAccess("documents")).toBeNull();
    expect(await getSessionMember()).toMatchObject({ projectId: "shared", status: "rejected", role: "viewer" });
  });
  it("preserves the selected project after revocation even when a personal workspace is authorized", async () => {
    mock.data.set(`${ACCESS_LINKS}/${id}`, { ...link(), status: "revoked" });
    mock.data.set(`${MEMBERSHIPS}/personal-reader__reader`, { uid: "reader", projectId: "personal-reader", role: "admin", status: "approved", permissions: DEFAULT_MEMBER_PERMISSIONS });
    expect(await getSessionMember()).toMatchObject({ projectId: "shared", status: "rejected", isPersonal: false });
    expect(await requireApproved(["admin"])).toBeNull();
    expect(await requireTabAccess("budget", ["admin", "editor"])).toBeNull();
  });
  it("excludes a revoked link when selecting the first available project", async () => {
    mock.activeProject = "missing";
    mock.data.set(`${ACCESS_LINKS}/${id}`, { ...link(), status: "revoked" });
    mock.data.set(`${MEMBERSHIPS}/direct__reader`, { uid: "reader", projectId: "direct", role: "editor", status: "approved", permissions: DEFAULT_MEMBER_PERMISSIONS });
    expect(await getSessionMember()).toMatchObject({ projectId: "direct", role: "editor" });
  });
  it("keeps independently approved access when links are revoked", async () => {
    mock.data.set(`${MEMBERSHIPS}/shared__reader`, { uid: "reader", projectId: "shared", role: "editor", status: "approved", permissions: DEFAULT_MEMBER_PERMISSIONS });
    mock.data.set(`${ACCESS_LINKS}/${id}`, { ...link(), status: "revoked" });
    expect(await getSessionMember()).toMatchObject({ projectId: "shared", status: "approved", role: "editor" });
  });
  it.each([undefined, id])("denies active sessions immediately after membership removal, with link %s", async (accessLinkId) => {
    mock.data.set(`${MEMBERSHIPS}/shared__reader`, { uid: "reader", projectId: "shared", role: "admin", status: "approved", removed: true, accessLinkId, permissions: DEFAULT_MEMBER_PERMISSIONS, folderAccess: { mode: "all" } });
    mock.data.set(`${MEMBERSHIPS}/personal-reader__reader`, { uid: "reader", projectId: "personal-reader", role: "admin", status: "approved", permissions: DEFAULT_MEMBER_PERMISSIONS });
    expect(await getSessionMember()).toMatchObject({ projectId: "shared", status: "rejected", permissions: { documents: false, budget: false }, folderAccess: { mode: "selected", folderIds: [], allowUnfiled: false } });
    expect(await requireApproved()).toBeNull();
    expect(await requireTabAccess("documents")).toBeNull();
  });
  it("requires a verified session for all link recipients", async () => {
    mock.session = "";
    expect(await getSessionMember()).toBeNull();
    mock.session = "invalid"; mock.verify.mockRejectedValue(new Error("revoked"));
    expect(await getSessionMember()).toBeNull();
  });
});
