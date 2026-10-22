import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { DELETE, GET, PATCH, POST } from "@/app/api/folder-vault/route";
import { createVault, decryptVaultBytes, encryptVaultBytes, unwrapVault, type FolderVault } from "@/lib/folder-vault-crypto";
import { vaultAttemptRef } from "@/lib/folder-vault";
import { FOLDERS, type MemberRecord, MEMBERSHIPS, normalizeFolderAccess, normalizePermissions, USERS } from "@/lib/project";

const state = vi.hoisted(() => ({
  actor: null as MemberRecord | null,
  records: new Map<string, Record<string, unknown>>(),
  revision: 1,
  beforeTransaction: null as (() => void) | null,
  attemptsAllowed: true,
  startSession: vi.fn(async () => "2026-10-06T22:00:00.000Z"),
  endSession: vi.fn(async () => undefined),
  appendActivity: vi.fn(async () => ({ id: "event" })),
}));
vi.mock("@/lib/activity", () => ({ appendActivity: state.appendActivity }));
vi.mock("@/lib/auth", () => ({
  requireTabAccess: async (_tab: string, roles?: string[]) => state.actor && (!roles || roles.includes(state.actor.role)) ? state.actor : null,
  canAccessFolder: (actor: MemberRecord, _id: string, topId: string) => actor.role === "admin" || actor.folderAccess.mode === "all" || actor.folderAccess.folderIds.includes(topId),
}));
vi.mock("@/lib/firebase-admin", () => {
  const ref = (name: string, id: string) => ({ key: `${name}/${id}`, get: async () => {
    const data = state.records.get(`${name}/${id}`);
    return { exists: Boolean(data), data: () => data, updateTime: Timestamp.fromMillis(state.revision) };
  } });
  return { firestore: {
    collection: (name: string) => ({
      doc: (id: string) => ref(name, id),
      where: (field: string, _operator: string, value: unknown) => ({ get: async () => {
        const docs = [...state.records.entries()].filter(([key, data]) => key.startsWith(`${name}/`) && data[field] === value).map(([key, data]) => ({ id: key.slice(name.length + 1), data: () => data }));
        return { docs, empty: docs.length === 0 };
      } }),
    }),
    runTransaction: async (callback: (transaction: { get: (document: ReturnType<typeof ref>) => ReturnType<ReturnType<typeof ref>["get"]>; update: (document: ReturnType<typeof ref>, data: Record<string, unknown>) => void; delete: (document: ReturnType<typeof ref>) => void }) => Promise<unknown>) => {
      state.beforeTransaction?.(); state.beforeTransaction = null;
      const writes: (() => void)[] = [];
      const result = await callback({
        get: (document) => document.get(),
        update: (document, data) => writes.push(() => {
          const previous = state.records.get(document.key)!;
          const vault = { ...previous.vault as FolderVault } as Record<string, unknown>;
          for (const [field, value] of Object.entries(data)) if (field.startsWith("vault.")) vault[field.slice(6)] = value;
          state.records.set(document.key, { ...previous, vault }); state.revision += 1;
        }),
        delete: (document) => writes.push(() => { state.records.delete(document.key); }),
      });
      writes.forEach((write) => write());
      return result;
    },
  } };
});
vi.mock("@/lib/folders", () => ({
  listProjectFolders: async (projectId: string) => [...state.records.entries()].filter(([key, data]) => key.startsWith(`${FOLDERS}/`) && data.projectId === projectId).map(([key, data]) => ({ id: key.slice(FOLDERS.length + 1), name: data.name, parentId: null, encrypted: data.encrypted, createdAt: "" })),
  buildTopLevelFolderMap: (folders: Array<{ id: string }>) => new Map(folders.map((folder) => [folder.id, folder.id])),
  folderTopLevelId: (id: string, map: Map<string, string>) => map.get(id) ?? null,
}));
vi.mock("@/lib/folder-vault", async () => {
  const actual = await vi.importActual<typeof import("@/lib/folder-vault")>("@/lib/folder-vault");
  return { ...actual, consumeVaultUnlockAttempt: async () => ({ allowed: state.attemptsAllowed, retryAfter: state.attemptsAllowed ? 0 : 900 }), startVaultSession: state.startSession, endVaultSession: state.endSession };
});

let vault: FolderVault;
const actor: MemberRecord = { uid: "admin", name: "Admin", email: "admin@example.test", projectId: "p1", projectName: "House", isPersonal: false, role: "admin", status: "approved", permissions: normalizePermissions(null), folderAccess: normalizeFolderAccess(null) };
const password = "a long private password";
function request(method: string, body?: Record<string, unknown>, origin: string | null = "https://planner.example.test") {
  return new Request("https://planner.example.test/api/folder-vault?folderId=f1", { method, headers: { ...(origin ? { Origin: origin } : {}), "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
}

beforeAll(async () => { vi.stubEnv("HOUSE_PLANNER_VAULT_RECOVERY_KEY", "ab".repeat(32)); vault = (await createVault(password, "p1", "f1")).vault; });
beforeEach(() => {
  vi.stubEnv("HOUSE_PLANNER_PUBLIC_URL", "");
  vi.stubEnv("HOUSE_PLANNER_VAULT_RECOVERY_KEY", "ab".repeat(32));
  state.revision = 1; state.beforeTransaction = null; state.appendActivity.mockClear();
  state.actor = { ...actor }; state.records.clear(); state.attemptsAllowed = true; state.startSession.mockClear(); state.endSession.mockClear();
  state.records.set(`${FOLDERS}/f1`, { name: "Private", projectId: "p1", encrypted: true, vault });
  state.records.set(`${MEMBERSHIPS}/p1__member`, { projectId: "p1", uid: "member", status: "approved" });
  state.records.set(`${USERS}/member`, { name: "Member", email: "member@example.test" });
});

describe("encrypted folder API", () => {
  it("rejects mutations from other origins before trying passwords or sessions", async () => {
    for (const handler of [POST, PATCH, DELETE]) {
      expect((await handler(request("POST", { folderId: "f1", password }, "https://attacker.example.test"))).status).toBe(403);
      expect((await handler(request("POST", { folderId: "f1", password }, null))).status).toBe(403);
    }
    expect(state.startSession).not.toHaveBeenCalled();
  });

  it("accepts the public Cloud Run host while rejecting untrusted forwarded hosts", async () => {
    const proxied = (headers: Record<string, string>) => new Request("https://0.0.0.0:8080/api/folder-vault?folderId=f1", { method: "DELETE", headers });
    expect((await DELETE(proxied({ Origin: "https://planner.example.test", Host: "planner.example.test", "x-forwarded-proto": "https" }))).status).toBe(200);
    expect((await DELETE(proxied({ Origin: "https://attacker.example.test", Host: "planner.example.test", "x-forwarded-proto": "https", "x-forwarded-host": "attacker.example.test" }))).status).toBe(403);
    expect((await DELETE(proxied({ Origin: "https://attacker.example.test", Host: "planner.example.test@attacker.example.test", "x-forwarded-proto": "https" }))).status).toBe(403);
    expect((await DELETE(proxied({ Origin: "https://planner.example.test", Host: "planner.example.test", "x-forwarded-proto": "https,http" }))).status).toBe(403);
  });

  it("accepts the configured public URL and rejects malformed configuration", async () => {
    vi.stubEnv("HOUSE_PLANNER_PUBLIC_URL", "https://planner.example.test/");
    const proxied = () => new Request("http://0.0.0.0:8080/api/folder-vault?folderId=f1", { method: "DELETE", headers: { Origin: "https://planner.example.test" } });
    expect((await DELETE(proxied())).status).toBe(200);
    vi.stubEnv("HOUSE_PLANNER_PUBLIC_URL", "this is not a URL");
    expect((await DELETE(proxied())).status).toBe(403);
    vi.stubEnv("HOUSE_PLANNER_PUBLIC_URL", "file:///tmp/config");
    expect((await DELETE(new Request("http://0.0.0.0:8080/api/folder-vault?folderId=f1", { method: "DELETE", headers: { Origin: "null" } }))).status).toBe(403);
  });

  it("unlocks only with the password and returns no encryption material", async () => {
    const denied = await POST(request("POST", { folderId: "f1", password: "a wrong private password" }));
    expect(denied.status).toBe(403);
    expect(state.startSession).not.toHaveBeenCalled();
    const allowed = await POST(request("POST", { folderId: "f1", password }));
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("Cache-Control")).toBe("no-store");
    expect(await allowed.json()).toEqual({ unlocked: true, expiresAt: "2026-10-06T22:00:00.000Z" });
    expect(state.startSession).toHaveBeenCalledOnce();
  });

  it("rejects ungranted members, missing folders and too many attempts", async () => {
    state.actor = { ...actor, uid: "member", role: "viewer" };
    expect((await POST(request("POST", { folderId: "f1", password }))).status).toBe(404);
    state.actor = { ...actor };
    expect((await POST(request("POST", { folderId: "does-not-exist", password }))).status).toBe(404);
    state.attemptsAllowed = false;
    const limited = await POST(request("POST", { folderId: "f1", password }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("900");
    expect(state.startSession).not.toHaveBeenCalled();
  });

  it("denies public links both unlock and lock operations even with a correct password and matching grant", async () => {
    state.actor = { ...actor, uid: "public-link:guest", role: "viewer", anonymousLink: true, accessLinkId: "a".repeat(64) };
    state.records.set(`${FOLDERS}/f1`, { projectId: "p1", encrypted: true, vault: { ...vault, allowedUids: [state.actor.uid] } });
    expect((await POST(request("POST", { folderId: "f1", password }))).status).toBe(403);
    expect((await DELETE(request("DELETE"))).status).toBe(403);
    expect(state.startSession).not.toHaveBeenCalled();
    expect(state.endSession).not.toHaveBeenCalled();
  });

  it("lets only the administrator list and change grants, and invalidates sessions", async () => {
    const listing = await GET(request("GET"));
    expect(await listing.json()).toEqual({ folderId: "f1", allowedUids: [], users: [{ uid: "member", name: "Member", email: "member@example.test" }], passwordResetAvailable: true });
    state.actor = { ...actor, uid: "member", role: "viewer" };
    expect((await GET(request("GET"))).status).toBe(403);
    expect((await PATCH(request("PATCH", { folderId: "f1", allowedUids: ["member"] }))).status).toBe(403);
    state.actor = { ...actor };
    expect((await PATCH(request("PATCH", { folderId: "f1", allowedUids: ["outsider"] }))).status).toBe(400);
    const changed = await PATCH(request("PATCH", { folderId: "f1", allowedUids: ["member", "member"] }));
    expect(changed.status).toBe(200);
    const saved = state.records.get(`${FOLDERS}/f1`)!.vault as FolderVault;
    expect(saved.allowedUids).toEqual(["member"]);
    expect(saved.version).not.toBe(vault.version);
    expect(saved.wrappedKey).toBe(vault.wrappedKey);
    expect(state.endSession).toHaveBeenCalledWith(actor, "f1");
  });

  it("locks the session without needing the password", async () => {
    const result = await DELETE(request("DELETE"));
    expect(result.status).toBe(200);
    expect(state.endSession).toHaveBeenCalledWith(actor, "f1");
  });

  it("allows locked administrator reset without the old password, preserves files and grants, and clears their attempt limit", async () => {
    const before = { ...vault, allowedUids: ["member"] };
    state.records.set(`${FOLDERS}/f1`, { projectId: "p1", encrypted: true, vault: before });
    const dataKey = await unwrapVault(before, password, "p1", "f1");
    const ciphertext = encryptVaultBytes(Buffer.from("existing document"), dataKey, "document-context");
    const attempt = vaultAttemptRef(actor, "f1") as unknown as { key: string };
    state.records.set(attempt.key, { attempts: 5 });
    const result = await PATCH(request("PATCH", { folderId: "f1", action: "reset-password", newPassword: "my replacement password" }));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true, passwordReset: true });
    const saved = state.records.get(`${FOLDERS}/f1`)!.vault as FolderVault;
    expect(saved.allowedUids).toEqual(["member"]);
    expect(saved.version).not.toBe(before.version);
    expect(saved.salt).not.toBe(before.salt);
    expect(saved.recoveryWrappedKey).toBe(before.recoveryWrappedKey);
    await expect(unwrapVault(saved, password, "p1", "f1")).rejects.toThrow();
    const afterKey = await unwrapVault(saved, "my replacement password", "p1", "f1");
    expect(afterKey).toEqual(dataKey);
    expect(decryptVaultBytes(ciphertext, afterKey, "document-context").toString()).toBe("existing document");
    expect(state.records.has(attempt.key)).toBe(false);
    expect(state.endSession).toHaveBeenCalledWith(actor, "f1");
    expect(state.startSession).not.toHaveBeenCalled();
    expect(state.appendActivity).toHaveBeenCalledWith(expect.anything(), actor, expect.objectContaining({
      action: "folder.password_reset", target: expect.objectContaining({ label: "Encrypted folder" }), visibility: { adminOnly: true },
    }));
    expect(JSON.stringify(state.appendActivity.mock.calls)).not.toContain("my replacement password");
  });

  it.each(["viewer", "editor"] as const)("denies password resets to granted %s members", async (role) => {
    state.actor = { ...actor, uid: "member", role };
    state.records.set(`${FOLDERS}/f1`, { projectId: "p1", encrypted: true, vault: { ...vault, allowedUids: ["member"] } });
    expect((await PATCH(request("PATCH", { folderId: "f1", action: "reset-password", newPassword: "my replacement password" }))).status).toBe(403);
    expect(state.records.get(`${FOLDERS}/f1`)!.vault).toEqual({ ...vault, allowedUids: ["member"] });
    expect(state.appendActivity).not.toHaveBeenCalled();
  });

  it("fails resets safely for missing configuration, legacy keys, weak passwords and other projects", async () => {
    const reset = () => PATCH(request("PATCH", { folderId: "f1", action: "reset-password", newPassword: "my replacement password" }));
    vi.stubEnv("HOUSE_PLANNER_VAULT_RECOVERY_KEY", "invalid");
    expect((await reset()).status).toBe(503);
    expect(state.records.get(`${FOLDERS}/f1`)!.vault).toEqual(vault);
    vi.stubEnv("HOUSE_PLANNER_VAULT_RECOVERY_KEY", "ab".repeat(32));
    const legacy = { ...vault }; delete legacy.recoveryWrappedKey;
    state.records.set(`${FOLDERS}/f1`, { projectId: "p1", encrypted: true, vault: legacy });
    expect((await reset()).status).toBe(409);
    expect(state.records.get(`${FOLDERS}/f1`)!.vault).toEqual(legacy);
    expect((await PATCH(request("PATCH", { folderId: "f1", action: "reset-password", newPassword: "too short" }))).status).toBe(400);
    state.actor = { ...actor, projectId: "other-project" };
    expect((await reset()).status).toBe(404);
    expect(state.appendActivity).not.toHaveBeenCalled();
  });

  it("enrolls a legacy vault only after a successful administrator password unlock", async () => {
    const legacy = { ...vault }; delete legacy.recoveryWrappedKey;
    state.records.set(`${FOLDERS}/f1`, { projectId: "p1", encrypted: true, vault: legacy });
    expect((await GET(request("GET"))).status).toBe(200);
    expect((await (await GET(request("GET"))).json()).passwordResetAvailable).toBe(false);
    const failed = await POST(request("POST", { folderId: "f1", password: "wrong private password" }));
    expect(failed.status).toBe(403);
    expect(state.records.get(`${FOLDERS}/f1`)!.vault).toEqual(legacy);
    expect((await POST(request("POST", { folderId: "f1", password }))).status).toBe(200);
    const enrolled = state.records.get(`${FOLDERS}/f1`)!.vault as FolderVault;
    expect(enrolled.recoveryWrappedKey).toBeTruthy();
    expect(enrolled.version).toBe(legacy.version);
    expect(enrolled.wrappedKey).toBe(legacy.wrappedKey);
    expect((await (await GET(request("GET"))).json()).passwordResetAvailable).toBe(true);
    expect((await PATCH(request("PATCH", { folderId: "f1", action: "reset-password", newPassword: "my replacement password" }))).status).toBe(200);
  });

  it("keeps legacy password unlock available when recovery is not configured", async () => {
    const legacy = { ...vault }; delete legacy.recoveryWrappedKey;
    state.records.set(`${FOLDERS}/f1`, { projectId: "p1", encrypted: true, vault: legacy });
    vi.stubEnv("HOUSE_PLANNER_VAULT_RECOVERY_KEY", "");
    expect((await POST(request("POST", { folderId: "f1", password }))).status).toBe(200);
    expect(state.records.get(`${FOLDERS}/f1`)!.vault).toEqual(legacy);
  });

  it("does not overwrite concurrent folder changes or grant changes during reset", async () => {
    state.beforeTransaction = () => {
      state.revision += 1;
      state.records.set(`${FOLDERS}/f1`, { projectId: "p1", encrypted: true, vault: { ...vault, allowedUids: ["member"], version: "concurrent-grant" } });
    };
    const response = await PATCH(request("PATCH", { folderId: "f1", action: "reset-password", newPassword: "my replacement password" }));
    expect(response.status).toBe(409);
    expect(state.records.get(`${FOLDERS}/f1`)!.vault).toEqual({ ...vault, allowedUids: ["member"], version: "concurrent-grant" });
    expect(state.appendActivity).not.toHaveBeenCalled();
    expect(state.endSession).not.toHaveBeenCalled();
  });

  it("rejects tampered recovery material without changing the password", async () => {
    const changed = Buffer.from(vault.recoveryWrappedKey!, "base64"); changed[changed.length - 1] ^= 1;
    const corrupt = { ...vault, recoveryWrappedKey: changed.toString("base64") };
    state.records.set(`${FOLDERS}/f1`, { projectId: "p1", encrypted: true, vault: corrupt });
    expect((await PATCH(request("PATCH", { folderId: "f1", action: "reset-password", newPassword: "my replacement password" }))).status).toBe(409);
    expect(state.records.get(`${FOLDERS}/f1`)!.vault).toEqual(corrupt);
    expect(state.appendActivity).not.toHaveBeenCalled();
  });
});
