import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { GoogleAuth, Impersonated, OAuth2Client } from "google-auth-library";
import { firestore } from "./firebase-admin";
import { projectScopedId } from "./project";

export const GOOGLE_CONNECTIONS = "housePlannerGoogleConnections";
export const GOOGLE_STATE_COOKIE = "house_planner_google_state";
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function googleConfigured() {
  return Boolean(process.env.HOUSE_PLANNER_GOOGLE_SERVICE_ACCOUNT || googleOAuthConfigured());
}

export function googleOAuthConfigured() {
  return Boolean(process.env.HOUSE_PLANNER_GOOGLE_CLIENT_ID && process.env.HOUSE_PLANNER_GOOGLE_CLIENT_SECRET && /^[a-f0-9]{64}$/i.test(process.env.HOUSE_PLANNER_GOOGLE_TOKEN_KEY || "") && process.env.HOUSE_PLANNER_PUBLIC_URL);
}

export function googleOAuth() {
  if (!googleOAuthConfigured()) throw new Error("Google Sheets connection is not configured on this server");
  return new OAuth2Client(process.env.HOUSE_PLANNER_GOOGLE_CLIENT_ID, process.env.HOUSE_PLANNER_GOOGLE_CLIENT_SECRET,
    `${process.env.HOUSE_PLANNER_PUBLIC_URL!.replace(/\/$/, "")}/api/google-sheets/callback`);
}

export function sealGoogleSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(process.env.HOUSE_PLANNER_GOOGLE_TOKEN_KEY!, "hex"), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}

export async function serviceGoogle() {
  const targetPrincipal = process.env.HOUSE_PLANNER_GOOGLE_SERVICE_ACCOUNT;
  if (!targetPrincipal) throw new Error("Falta configurar la cuenta de servicio de Google Sheets.");
  const sourceClient = await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] }).getClient();
  return new Impersonated({ sourceClient, targetPrincipal, targetScopes: ["https://www.googleapis.com/auth/drive"], lifetime: 3600 });
}

export function openGoogleSecret(value: string) {
  const bytes = Buffer.from(value, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(process.env.HOUSE_PLANNER_GOOGLE_TOKEN_KEY!, "hex"), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
}

export function googleConnectionRef(projectId: string, uid: string) {
  return firestore.collection(GOOGLE_CONNECTIONS).doc(projectScopedId(projectId, uid));
}

export async function connectedGoogle(projectId: string, uid: string) {
  const client = googleOAuth();
  const connection = await googleConnectionRef(projectId, uid).get();
  if (!connection.data()?.token) throw new Error("Connect Google Sheets first");
  client.setCredentials({ refresh_token: openGoogleSecret(connection.data()!.token) });
  return client;
}

export async function createGoogleWorkbook(client: OAuth2Client, bytes: Buffer, name: string, folderId?: string) {
  if (bytes.length > 5 * 1024 * 1024) throw new Error("This workbook exceeds the 5 MB advanced editing limit");
  const boundary = `house_planner_${randomBytes(16).toString("hex")}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, mimeType: "application/vnd.google-apps.spreadsheet", ...(folderId ? { parents: [folderId] } : {}) })}\r\n--${boundary}\r\nContent-Type: ${XLSX_MIME}\r\n\r\n`),
    bytes, Buffer.from(`\r\n--${boundary}--`),
  ]);
  const response = await client.request<{ id: string }>({ url: "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, data: body, timeout: 60_000, retry: false });
  return response.data.id;
}

export async function createGoogleFolder(client: OAuth2Client, name: string) {
  const response = await client.request<{ id: string }>({ url: "https://www.googleapis.com/drive/v3/files?fields=id", method: "POST", data: { name, mimeType: "application/vnd.google-apps.folder" }, retry: false });
  return response.data.id;
}

export async function googleFileState(client: OAuth2Client, fileId: string) {
  if (!/^[\w-]+$/.test(fileId)) throw new Error("Invalid spreadsheet id");
  // Drive v3 omits ETags for native Sheets. v2 exposes the revision guard
  // needed for conditional replacement of a Google Workspace document.
  const response = await client.request<{ version: string; etag: string; labels: { trashed: boolean } }>({ url: `https://www.googleapis.com/drive/v2/files/${fileId}?fields=version,etag,labels/trashed` });
  if (response.data.labels?.trashed) throw new Error("La hoja consolidada está en la papelera. Restáurala en Drive.");
  return { version: response.data.version, etag: response.data.etag || "" };
}

export async function updateGoogleWorkbook(client: OAuth2Client, fileId: string, bytes: Buffer, etag: string) {
  if (!etag) throw new Error("Google did not provide a revision guard; no changes were sent");
  if (bytes.length > 5 * 1024 * 1024) throw new Error("La hoja supera el límite de sincronización de 5 MB");
  // Every retry keeps the original ETag: a changed document is never replaced.
  // Google occasionally returns a transient 5xx while converting an XLSX.
  const response = await client.request<{ version: string }>({ url: `https://www.googleapis.com/upload/drive/v2/files/${fileId}?uploadType=media&convert=true&fields=version`, method: "PUT", headers: { "Content-Type": XLSX_MIME, "If-Match": etag }, data: bytes, timeout: 60_000, retry: true, retryConfig: { retry: 2, httpMethodsToRetry: ["PUT"], statusCodesToRetry: [[429, 429], [500, 599]], noResponseRetries: 0 } });
  return response.data.version;
}

export async function downloadGoogleWorkbook(client: OAuth2Client, fileId: string) {
  if (!/^[\w-]+$/.test(fileId)) throw new Error("Invalid spreadsheet id");
  const response = await client.request<ArrayBuffer>({ url: `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(XLSX_MIME)}`, responseType: "arraybuffer", timeout: 60_000 });
  return Buffer.from(response.data);
}

export async function readStableGoogleWorkbook(client: OAuth2Client, fileId: string) {
  // Google may finish recalculating between the metadata read and XLSX export.
  // Retry the entire read, never combine bytes with another revision's ETag.
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await googleFileState(client, fileId);
    const bytes = await downloadGoogleWorkbook(client, fileId);
    const after = await googleFileState(client, fileId);
    if (before.version === after.version) return { bytes, state: after };
  }
  throw new Error("Google sigue actualizando la hoja. Tu borrador se conserva; espera unos segundos y pulsa Guardar de nuevo.");
}
