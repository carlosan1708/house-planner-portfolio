import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { OAuth2Client } from "google-auth-library";

function runGcloud(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn("gcloud", args, { stdio: ["pipe", "pipe", "pipe"], shell: process.platform === "win32" });
    let output = "";
    let error = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { error += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve(output) : reject(new Error(error || `gcloud exited with ${code}`)));
    if (input !== undefined) child.stdin.end(input); else child.stdin.end();
  });
}

const clientArgument = process.argv.indexOf("--client");
const clientPath = clientArgument >= 0 ? process.argv[clientArgument + 1] : "";
const fromSecretManager = process.argv.includes("--from-secret-manager");
const expectedSender = String(process.argv[process.argv.indexOf("--sender") + 1] || "").toLowerCase();
if ((!clientPath && !fromSecretManager) || !expectedSender) throw new Error("Usage: node scripts/connect-gmail.mjs (--client <oauth-client.json> | --from-secret-manager) --sender <gmail-address>");

const credentials = fromSecretManager ? null : JSON.parse(await readFile(clientPath, "utf8"));
const source = fromSecretManager ? {
  client_id: String(await runGcloud(["secrets", "versions", "access", "latest", "--secret", "house-planner-gmail-client-id", "--project", "example-house-planner"])).trim(),
  client_secret: String(await runGcloud(["secrets", "versions", "access", "latest", "--secret", "house-planner-gmail-client-secret", "--project", "example-house-planner"])).trim(),
} : credentials.installed || credentials.web;
if (!source?.client_id || !source?.client_secret) throw new Error("The OAuth client file is invalid.");

let resolveCode;
let rejectCode;
const codePromise = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
const server = createServer((request, response) => {
  const url = new URL(request.url || "/", "http://localhost");
  if (url.searchParams.get("error")) {
    response.end("House Planner Gmail authorization was cancelled. You can close this tab.");
    rejectCode(new Error(url.searchParams.get("error")));
    return;
  }
  const code = url.searchParams.get("code");
  if (!code) { response.statusCode = 400; response.end("Missing authorization code."); return; }
  response.end("House Planner Gmail authorization completed. You can close this tab.");
  resolveCode(code);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Could not start the local OAuth callback.");
const redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;
const oauth = new OAuth2Client(source.client_id, source.client_secret, redirectUri);
const authorizationUrl = oauth.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: ["openid", "email", "https://www.googleapis.com/auth/gmail.send"],
});
process.stdout.write(`Open this URL in the browser and sign in with ${expectedSender}:\n${authorizationUrl}\n`);

const timeout = setTimeout(() => rejectCode(new Error("Authorization timed out.")), 600_000);
const code = await codePromise;
clearTimeout(timeout);
server.close();
const { tokens } = await oauth.getToken(code);
if (!tokens.refresh_token || !tokens.id_token) throw new Error("Google did not return the required offline credentials.");
const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: source.client_id });
const authorizedEmail = String(ticket.getPayload()?.email || "").toLowerCase();
if (authorizedEmail !== expectedSender) throw new Error(`Authorized account ${authorizedEmail} does not match ${expectedSender}.`);

async function ensureSecret(name) {
  try {
    await runGcloud(["secrets", "describe", name, "--project", "example-house-planner"]);
  } catch {
    await runGcloud(["secrets", "create", name, "--project", "example-house-planner", "--replication-policy", "automatic"]);
  }
}

async function addSecret(name, value) {
  await ensureSecret(name);
  await runGcloud(["secrets", "versions", "add", name, "--project", "example-house-planner", "--data-file=-"], value);
}

await addSecret("house-planner-gmail-client-id", source.client_id);
await addSecret("house-planner-gmail-client-secret", source.client_secret);
await addSecret("house-planner-gmail-refresh-token", tokens.refresh_token);
process.stdout.write(`Gmail sender ${authorizedEmail} connected. Credentials were stored in Secret Manager.\n`);
