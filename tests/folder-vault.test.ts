import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { consumeVaultUnlockAttempt, endVaultSession, hasVaultGrant, startVaultSession, VAULT_ATTEMPTS, VAULT_SESSIONS, vaultAccess, vaultCookieName, vaultRootFolder } from "@/lib/folder-vault";
import { createVault, resetVaultPassword, type FolderVault } from "@/lib/folder-vault-crypto";
import { FOLDERS, type MemberRecord, normalizeFolderAccess, normalizePermissions, SESSION_COOKIE } from "@/lib/project";

const state = vi.hoisted(() => ({ cookies: new Map<string, string>(), records: new Map<string, Record<string, unknown>>(), cookieOptions: [] as Record<string, unknown>[], queue: Promise.resolve() }));
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => state.cookies.has(name) ? { value: state.cookies.get(name) } : undefined,
  set: (name: string, value: string, options: Record<string, unknown>) => { state.cookies.set(name, value); state.cookieOptions.push(options); },
}) }));
vi.mock("@/lib/firebase-admin", () => {
  const ref = (collection: string, id: string) => ({
    key: `${collection}/${id}`,
    get: async () => ({ data: () => state.records.get(`${collection}/${id}`), exists: state.records.has(`${collection}/${id}`), updateTime: Timestamp.fromMillis(123_000) }),
    set: async (data: Record<string, unknown>) => { state.records.set(`${collection}/${id}`, data); },
    delete: async () => { state.records.delete(`${collection}/${id}`); },
  });
  return {
    adminAuth: {},
    firestore: {
      collection: (collection: string) => ({ doc: (id: string) => ref(collection, id) }),
      runTransaction: (callback: (transaction: { get: (document: ReturnType<typeof ref>) => ReturnType<ReturnType<typeof ref>["get"]>; set: (document: ReturnType<typeof ref>, data: Record<string, unknown>) => void }) => Promise<unknown>) => {
        const result = state.queue.then(() => callback({ get: (document) => document.get(), set: (document, data) => { state.records.set(document.key, data); } }));
        state.queue = result.then(() => undefined);
        return result;
      },
    },
  };
});

const actor: MemberRecord = { uid: "u1", name: "Member", email: "member@example.test", projectId: "p1", projectName: "House", isPersonal: false, role: "viewer", status: "approved", permissions: normalizePermissions(null), folderAccess: normalizeFolderAccess(null) };
const folders = [
  { id: "f1", name: "Private", parentId: null, createdAt: "", encrypted: true },
  { id: "child", name: "Inside", parentId: "f1", createdAt: "" },
  { id: "ordinary", name: "Ordinary", parentId: null, createdAt: "" },
];
let vault: FolderVault;
let dataKey: Buffer;

beforeEach(async () => {
  vi.stubEnv("HOUSE_PLANNER_VAULT_RECOVERY_KEY", "ab".repeat(32));
  state.cookies.clear(); state.records.clear(); state.cookieOptions.length = 0; state.queue = Promise.resolve();
  state.cookies.set(SESSION_COOKIE, "firebase-session-1");
  const created = await createVault("a long private password", "p1", "f1");
  vault = { ...created.vault, allowedUids: [actor.uid] }; dataKey = created.dataKey;
  state.records.set(`${FOLDERS}/f1`, { projectId: "p1", encrypted: true, vault });
});

describe("encrypted folder access and sessions", () => {
  it("inherits folder protection and rejects cycles or missing ancestors", () => {
    expect(vaultRootFolder(folders, "child")?.id).toBe("f1");
    expect(vaultRootFolder(folders, "ordinary")).toBeNull();
    expect(vaultRootFolder(folders, null)).toBeNull();
    expect(() => vaultRootFolder([{ id: "loop", name: "Loop", parentId: "loop", createdAt: "" }], "loop")).toThrow("hierarchy");
    expect(() => vaultRootFolder([{ id: "orphan", name: "Orphan", parentId: "missing", createdAt: "" }], "orphan")).toThrow("hierarchy");
  });

  it("requires both a separate administrator grant and a password session", async () => {
    expect((await vaultAccess(actor, folders)).get("f1")).toEqual({ granted: true, key: null });
    const expiresAt = await startVaultSession(actor, "f1", vault, dataKey);
    const access = (await vaultAccess(actor, folders)).get("f1")!;
    expect(access.key).toEqual(dataKey);
    expect(access.expiresAt).toBe(new Date(expiresAt).getTime());
    expect(access.revision).toEqual(Timestamp.fromMillis(123_000));
    expect(state.cookieOptions.at(-1)).toMatchObject({ httpOnly: true, sameSite: "strict", path: "/", maxAge: 900 });
    const storedSession = [...state.records.entries()].find(([key]) => key.startsWith(`${VAULT_SESSIONS}/`))![1];
    expect(Buffer.from(String(storedSession.encryptedKey), "base64").includes(dataKey)).toBe(false);
    expect(storedSession).not.toHaveProperty("password");
    expect(storedSession).not.toHaveProperty("key");
    expect((await vaultAccess({ ...actor, uid: "other" }, folders)).get("f1")).toEqual({ granted: false, key: null });
    expect((await vaultAccess({ ...actor, role: "admin", uid: "owner" }, folders)).get("f1")).toEqual({ granted: true, key: null });
  });

  it("invalidates sessions on login changes, expiry, permission loss and grant changes", async () => {
    await startVaultSession(actor, "f1", vault, dataKey);
    state.cookies.set(SESSION_COOKIE, "firebase-session-2");
    expect((await vaultAccess(actor, folders)).get("f1")?.key).toBeNull();
    state.cookies.set(SESSION_COOKIE, "firebase-session-1");
    expect((await vaultAccess({ ...actor, permissions: { ...actor.permissions, documents: false } }, folders)).get("f1")).toEqual({ granted: false, key: null });
    expect((await vaultAccess({ ...actor, folderAccess: { mode: "selected", folderIds: [], allowUnfiled: false } }, folders)).get("f1")).toEqual({ granted: false, key: null });
    state.records.set(`${FOLDERS}/f1`, { projectId: "p1", encrypted: true, vault: { ...vault, version: "new-version" } });
    expect((await vaultAccess(actor, folders)).get("f1")?.key).toBeNull();
    state.records.set(`${FOLDERS}/f1`, { projectId: "p1", encrypted: true, vault });
    const storedSession = [...state.records.entries()].find(([key]) => key.startsWith(`${VAULT_SESSIONS}/`))![1];
    storedSession.expiresAt = Timestamp.fromMillis(Date.now() - 1);
    expect((await vaultAccess(actor, folders)).get("f1")?.key).toBeNull();
  });

  it("never grants anonymous links encrypted access, even with a matching grant and an existing unlocked session", async () => {
    await startVaultSession(actor, "f1", vault, dataKey);
    const guest = { ...actor, anonymousLink: true, accessLinkId: "a".repeat(64) };
    expect(hasVaultGrant(guest, vault)).toBe(false);
    expect(hasVaultGrant({ ...guest, role: "admin" }, vault)).toBe(false);
    expect((await vaultAccess(guest, folders)).get("f1")).toEqual({ granted: false, key: null });
    await expect(startVaultSession(guest, "f1", vault, dataKey)).rejects.toThrow("access denied");
    expect([...state.records.keys()].filter((key) => key.startsWith(`${VAULT_SESSIONS}/`))).toHaveLength(1);
  });

  it("rejects stolen or corrupt sessions and removes the server session when locked", async () => {
    await startVaultSession(actor, "f1", vault, dataKey);
    const other = { ...actor, uid: "other" };
    state.records.set(`${FOLDERS}/f1`, { projectId: "p1", encrypted: true, vault: { ...vault, allowedUids: [actor.uid, other.uid] } });
    expect((await vaultAccess(other, folders)).get("f1")).toEqual({ granted: true, key: null });
    const storedSession = [...state.records.entries()].find(([key]) => key.startsWith(`${VAULT_SESSIONS}/`))![1];
    storedSession.encryptedKey = randomBytes(64).toString("base64");
    expect((await vaultAccess(actor, folders)).get("f1")?.key).toBeNull();
    await endVaultSession(actor, "f1");
    expect(state.cookies.get(vaultCookieName("p1", "f1"))).toBe("");
    expect([...state.records.keys()].some((key) => key.startsWith(`${VAULT_SESSIONS}/`))).toBe(false);
  });

  it("replaces the previous unlock token when the same browser unlocks again", async () => {
    await startVaultSession(actor, "f1", vault, dataKey);
    const previousToken = state.cookies.get(vaultCookieName("p1", "f1"))!;
    await startVaultSession(actor, "f1", vault, dataKey);
    expect(state.cookies.get(vaultCookieName("p1", "f1"))).not.toBe(previousToken);
    expect([...state.records.keys()].filter((key) => key.startsWith(`${VAULT_SESSIONS}/`))).toHaveLength(1);
    state.cookies.set(vaultCookieName("p1", "f1"), previousToken);
    expect((await vaultAccess(actor, folders)).get("f1")?.key).toBeNull();
  });

  it("applies the five-attempt limit atomically across concurrent unlocks", async () => {
    const attempts = await Promise.all(Array.from({ length: 9 }, () => consumeVaultUnlockAttempt(actor, "f1")));
    expect(attempts.filter((attempt) => attempt.allowed)).toHaveLength(5);
    expect(attempts.filter((attempt) => !attempt.allowed)).toHaveLength(4);
    expect(attempts.at(-1)?.retryAfter).toBeGreaterThan(0);
    expect((await consumeVaultUnlockAttempt({ ...actor, uid: "other" }, "f1")).allowed).toBe(true);
    const rateRecord = [...state.records.entries()].find(([key]) => key.startsWith(`${VAULT_ATTEMPTS}/`))![1];
    expect(rateRecord).toMatchObject({ projectId: "p1", folderId: "f1", uid: actor.uid });
    rateRecord.until = Date.now() - 1;
    expect((await consumeVaultUnlockAttempt(actor, "f1")).allowed).toBe(true);
  });

  it("invalidates previously unlocked browsers after an administrator resets the password", async () => {
    await startVaultSession(actor, "f1", vault, dataKey);
    const reset = await resetVaultPassword(vault, "my replacement password", "p1", "f1");
    state.records.set(`${FOLDERS}/f1`, { projectId: "p1", encrypted: true, vault: reset });
    expect((await vaultAccess(actor, folders)).get("f1")).toEqual({ granted: true, key: null });
  });
});
