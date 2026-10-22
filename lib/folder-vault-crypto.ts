import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scrypt } from "node:crypto";

const MAGIC = Buffer.from("HPV1");
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export type FolderVault = {
  version: string;
  salt: string;
  wrappedKey: string;
  recoveryWrappedKey?: string;
  allowedUids: string[];
};

export class VaultRecoveryConfigurationError extends Error {
  constructor() { super("Folder password recovery is not configured"); }
}

export function vaultRecoveryConfigured() {
  return /^[a-fA-F0-9]{64}$/.test(process.env.HOUSE_PLANNER_VAULT_RECOVERY_KEY || "");
}

function recoveryKey() {
  if (!vaultRecoveryConfigured()) throw new VaultRecoveryConfigurationError();
  return Buffer.from(process.env.HOUSE_PLANNER_VAULT_RECOVERY_KEY!, "hex");
}

export function validateVaultPassword(password: unknown): asserts password is string {
  if (typeof password !== "string" || password.length < 12 || password.length > 128) {
    throw new Error("Use a password between 12 and 128 characters");
  }
}

function strictBase64(value: unknown, bytes?: number) {
  if (typeof value !== "string" || !value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("Invalid encrypted folder");
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value || (bytes !== undefined && decoded.length !== bytes)) throw new Error("Invalid encrypted folder");
  return decoded;
}

export function parseFolderVault(value: unknown): FolderVault | null {
  if (!value || typeof value !== "object") return null;
  const vault = value as Partial<FolderVault>;
  if (typeof vault.version !== "string" || !vault.version || vault.version.length > 100 || !Array.isArray(vault.allowedUids)) return null;
  if (vault.allowedUids.length > 250 || vault.allowedUids.some((uid) => typeof uid !== "string" || !uid || uid.length > 128)) return null;
  try {
    strictBase64(vault.salt, 16);
    strictBase64(vault.wrappedKey, MAGIC.length + IV_BYTES + TAG_BYTES + KEY_BYTES);
    if (vault.recoveryWrappedKey !== undefined) strictBase64(vault.recoveryWrappedKey, MAGIC.length + IV_BYTES + TAG_BYTES + KEY_BYTES);
  } catch {
    return null;
  }
  return { version: vault.version, salt: vault.salt!, wrappedKey: vault.wrappedKey!,
    ...(vault.recoveryWrappedKey !== undefined ? { recoveryWrappedKey: vault.recoveryWrappedKey } : {}),
    allowedUids: [...new Set(vault.allowedUids)] };
}

export function encryptVaultBytes(bytes: Buffer, key: Buffer, context: string): Buffer {
  if (key.length !== KEY_BYTES || !context) throw new Error("Invalid encryption context");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptVaultBytes(bytes: Buffer, key: Buffer, context: string): Buffer {
  if (key.length !== KEY_BYTES || !context || bytes.length < MAGIC.length + IV_BYTES + TAG_BYTES || !bytes.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Invalid encrypted content");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(MAGIC.length, MAGIC.length + IV_BYTES));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(bytes.subarray(MAGIC.length + IV_BYTES, MAGIC.length + IV_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(bytes.subarray(MAGIC.length + IV_BYTES + TAG_BYTES)), decipher.final()]);
}

async function passwordKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, { N: 65_536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

function wrapContext(projectId: string, folderId: string) {
  return JSON.stringify(["house-planner-folder-key-v1", projectId, folderId]);
}

function recoveryContext(projectId: string, folderId: string) {
  return JSON.stringify(["house-planner-folder-recovery-v1", projectId, folderId]);
}

export function wrapVaultRecovery(dataKey: Buffer, projectId: string, folderId: string): string {
  const key = recoveryKey();
  try {
    if (dataKey.length !== KEY_BYTES) throw new Error("Invalid encrypted folder");
    return encryptVaultBytes(dataKey, key, recoveryContext(projectId, folderId)).toString("base64");
  } finally { key.fill(0); }
}

export function recoverVaultKey(vault: FolderVault, projectId: string, folderId: string): Buffer {
  const key = recoveryKey();
  try {
    const parsed = parseFolderVault(vault);
    if (!parsed?.recoveryWrappedKey) throw new Error("Folder password recovery is unavailable");
    const dataKey = decryptVaultBytes(strictBase64(parsed.recoveryWrappedKey), key, recoveryContext(projectId, folderId));
    if (dataKey.length !== KEY_BYTES) throw new Error("Invalid encrypted folder");
    return dataKey;
  } finally { key.fill(0); }
}

export async function resetVaultPassword(vault: FolderVault, password: string, projectId: string, folderId: string): Promise<FolderVault> {
  validateVaultPassword(password);
  const dataKey = recoverVaultKey(vault, projectId, folderId);
  const salt = randomBytes(16);
  let wrappingKey: Buffer | undefined;
  try {
    wrappingKey = await passwordKey(password, salt);
    return { ...vault, version: randomUUID(), salt: salt.toString("base64"),
      wrappedKey: encryptVaultBytes(dataKey, wrappingKey, wrapContext(projectId, folderId)).toString("base64") };
  } finally {
    dataKey.fill(0);
    wrappingKey?.fill(0);
  }
}

export async function createVault(password: string, projectId: string, folderId: string): Promise<{ vault: FolderVault; dataKey: Buffer }> {
  validateVaultPassword(password);
  if (!vaultRecoveryConfigured()) throw new VaultRecoveryConfigurationError();
  const salt = randomBytes(16);
  const dataKey = randomBytes(KEY_BYTES);
  let wrappingKey: Buffer | undefined;
  try {
    const recoveryWrappedKey = wrapVaultRecovery(dataKey, projectId, folderId);
    wrappingKey = await passwordKey(password, salt);
    return {
      vault: { version: randomUUID(), salt: salt.toString("base64"), wrappedKey: encryptVaultBytes(dataKey, wrappingKey, wrapContext(projectId, folderId)).toString("base64"), recoveryWrappedKey, allowedUids: [] },
      dataKey,
    };
  } catch (error) {
    dataKey.fill(0);
    throw error;
  } finally {
    wrappingKey?.fill(0);
  }
}

export async function unwrapVault(vault: FolderVault, password: string, projectId: string, folderId: string): Promise<Buffer> {
  validateVaultPassword(password);
  const parsed = parseFolderVault(vault);
  if (!parsed) throw new Error("Invalid encrypted folder");
  const wrappingKey = await passwordKey(password, strictBase64(parsed.salt, 16));
  try {
    const dataKey = decryptVaultBytes(strictBase64(parsed.wrappedKey), wrappingKey, wrapContext(projectId, folderId));
    if (dataKey.length !== KEY_BYTES) throw new Error("Invalid encrypted folder");
    return dataKey;
  } finally {
    wrappingKey.fill(0);
  }
}
