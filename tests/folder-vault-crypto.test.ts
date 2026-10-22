import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createVault, decryptVaultBytes, encryptVaultBytes, parseFolderVault, recoverVaultKey, resetVaultPassword, unwrapVault, VaultRecoveryConfigurationError } from "@/lib/folder-vault-crypto";

beforeEach(() => vi.stubEnv("HOUSE_PLANNER_VAULT_RECOVERY_KEY", "ab".repeat(32)));

describe("encrypted folder cryptography", () => {
  it("authenticates bytes, rejects a changed context, and uses a fresh nonce", () => {
    const key = randomBytes(32);
    const content = Buffer.from("private file contents");
    const encrypted = encryptVaultBytes(content, key, "project/p1/folder/f1/document/d1");
    expect(encrypted.includes(content)).toBe(false);
    expect(decryptVaultBytes(encrypted, key, "project/p1/folder/f1/document/d1")).toEqual(content);
    expect(encryptVaultBytes(content, key, "project/p1/folder/f1/document/d1")).not.toEqual(encrypted);
    expect(() => decryptVaultBytes(encrypted, key, "project/p2/folder/f1/document/d1")).toThrow();
    expect(() => decryptVaultBytes(encrypted, randomBytes(32), "project/p1/folder/f1/document/d1")).toThrow();
    const changed = Buffer.from(encrypted);
    changed[changed.length - 1] ^= 1;
    expect(() => decryptVaultBytes(changed, key, "project/p1/folder/f1/document/d1")).toThrow();
    expect(() => decryptVaultBytes(content, key, "project/p1/folder/f1/document/d1")).toThrow();
  });

  it("wraps the folder key with a password and binds it to the project and folder", async () => {
    const password = "a long private password";
    const { vault, dataKey } = await createVault(password, "p1", "f1");
    expect(parseFolderVault(vault)).toEqual(vault);
    expect(vault.allowedUids).toEqual([]);
    expect(JSON.stringify(vault)).not.toContain(password);
    expect(Buffer.from(vault.wrappedKey, "base64").includes(dataKey)).toBe(false);
    expect(Buffer.from(vault.recoveryWrappedKey!, "base64").includes(dataKey)).toBe(false);
    expect(recoverVaultKey(vault, "p1", "f1")).toEqual(dataKey);
    expect(await unwrapVault(vault, password, "p1", "f1")).toEqual(dataKey);
    await expect(unwrapVault(vault, "a wrong private password", "p1", "f1")).rejects.toThrow();
    await expect(unwrapVault(vault, password, "p2", "f1")).rejects.toThrow();
    await expect(unwrapVault(vault, password, "p1", "f2")).rejects.toThrow();
    // Access revocation changes only the session version, preserving the wrapped data key.
    expect(await unwrapVault({ ...vault, version: "new-grant-version" }, password, "p1", "f1")).toEqual(dataKey);
  });

  it("rejects weak passwords and malformed vault metadata", async () => {
    await expect(createVault("too short", "p1", "f1")).rejects.toThrow("12 and 128");
    await expect(createVault("x".repeat(129), "p1", "f1")).rejects.toThrow("12 and 128");
    const { vault } = await createVault("a long private password", "p1", "f1");
    expect(parseFolderVault({ ...vault, salt: "not-a-salt" })).toBeNull();
    expect(parseFolderVault({ ...vault, wrappedKey: "AA==" })).toBeNull();
    expect(parseFolderVault({ ...vault, allowedUids: [42] })).toBeNull();
    expect(parseFolderVault({ ...vault, recoveryWrappedKey: "AA==" })).toBeNull();
  });

  it("resets the password without changing file keys, recovery material or access grants", async () => {
    const { vault, dataKey } = await createVault("a long private password", "p1", "f1");
    vault.allowedUids = ["member"];
    const encrypted = encryptVaultBytes(Buffer.from("existing private document"), dataKey, "document-context");
    const reset = await resetVaultPassword(vault, "my replacement password", "p1", "f1");
    expect(reset.version).not.toBe(vault.version);
    expect(reset.salt).not.toBe(vault.salt);
    expect(reset.wrappedKey).not.toBe(vault.wrappedKey);
    expect(reset.allowedUids).toEqual(["member"]);
    expect(reset.recoveryWrappedKey).toBe(vault.recoveryWrappedKey);
    await expect(unwrapVault(reset, "a long private password", "p1", "f1")).rejects.toThrow();
    const recovered = await unwrapVault(reset, "my replacement password", "p1", "f1");
    expect(recovered).toEqual(dataKey);
    expect(decryptVaultBytes(encrypted, recovered, "document-context").toString()).toBe("existing private document");
  });

  it("rejects recovery wrapper swaps, corruption and a different recovery secret", async () => {
    const { vault } = await createVault("a long private password", "p1", "f1");
    expect(() => recoverVaultKey(vault, "p2", "f1")).toThrow();
    expect(() => recoverVaultKey(vault, "p1", "f2")).toThrow();
    expect(() => recoverVaultKey({ ...vault, recoveryWrappedKey: vault.wrappedKey }, "p1", "f1")).toThrow();
    const changed = Buffer.from(vault.recoveryWrappedKey!, "base64");
    changed[changed.length - 1] ^= 1;
    expect(() => recoverVaultKey({ ...vault, recoveryWrappedKey: changed.toString("base64") }, "p1", "f1")).toThrow();
    vi.stubEnv("HOUSE_PLANNER_VAULT_RECOVERY_KEY", "cd".repeat(32));
    expect(() => recoverVaultKey(vault, "p1", "f1")).toThrow();
  });

  it.each(["", "invalid", "ab".repeat(31), "gg".repeat(32)])("requires a valid recovery configuration before creating a vault (%s)", async (value) => {
    vi.stubEnv("HOUSE_PLANNER_VAULT_RECOVERY_KEY", value);
    await expect(createVault("a long private password", "p1", "f1")).rejects.toThrow(VaultRecoveryConfigurationError);
  });
});
