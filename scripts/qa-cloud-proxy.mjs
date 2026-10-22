import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { request as requestHttps } from "node:https";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleAuth } from "google-auth-library";
import { validateQaEnvironment, validateQaTarget } from "./qa-target-policy.mjs";

const hopHeaders = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);

function cleanHeaders(input) {
  const extra = String(input.connection || "").toLowerCase().split(",").map((value) => value.trim());
  return Object.fromEntries(Object.entries(input).filter(([name]) => !hopHeaders.has(name.toLowerCase()) && !extra.includes(name.toLowerCase())));
}

export function validateQaProxyAccount(account, target) {
  if (target.emulator || !target.targetUrl || account !== `qa-runner@${target.cloudProjectId}.iam.gserviceaccount.com`) throw new Error("The private QA proxy requires the isolated project's qa-runner service account.");
  return account;
}

// IAM mints a new ID token before expiry; an auth-action token alone expires
// before a long regression finishes. WIF refreshes the underlying access token.
export function createRenewingQaTokenProvider({ client, serviceAccount, audience, now = Date.now }) {
  let cached;
  let pending;
  return async () => {
    if (cached && cached.expiresAt - 60_000 > now()) return cached.token;
    if (!pending) {
      pending = (async () => {
        const response = await client.request({
          url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(serviceAccount)}:generateIdToken`,
          method: "POST", data: { audience, includeEmail: true }, timeout: 30_000,
        });
        const token = response.data?.token;
        let claims;
        try { claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()); } catch { throw new Error("IAM did not return a valid QA ID token."); }
        if (claims.aud !== audience || claims.email !== serviceAccount || !Number.isFinite(claims.exp) || claims.exp * 1000 - now() < 90_000) throw new Error("IAM token does not match the isolated QA audience, identity, and expiry.");
        cached = { token, expiresAt: claims.exp * 1000 };
        return token;
      })().finally(() => { pending = undefined; });
    }
    return pending;
  };
}

export function qaProxyRequestHeaders(input, target, idToken) {
  const headers = cleanHeaders(input);
  const local = new URL(target.baseUrl);
  const upstream = new URL(target.targetUrl);
  if (![local.host, local.host.replace(/^localhost:/, "127.0.0.1:"), local.host.replace(/^127\.0\.0\.1:/, "localhost:")].includes(String(headers.host))) throw new Error("Invalid proxy host.");
  if (headers.origin) {
    if (headers.origin !== target.baseUrl) throw new Error("Invalid proxy request origin.");
    headers.origin = upstream.origin;
  }
  if (headers.referer) {
    const referer = new URL(String(headers.referer));
    if (referer.origin !== target.baseUrl) throw new Error("Invalid proxy request referer.");
    headers.referer = `${upstream.origin}${referer.pathname}${referer.search}`;
  }
  for (const name of ["forwarded", "x-forwarded-host", "x-forwarded-proto", "x-serverless-authorization"]) delete headers[name];
  headers.host = upstream.host;
  headers["x-forwarded-proto"] = "https";
  // Cloud Run's identity is separate from the Firebase Authorization header.
  headers["x-serverless-authorization"] = `Bearer ${idToken}`;
  return headers;
}

export function qaProxyResponseHeaders(input, target) {
  const headers = cleanHeaders(input);
  // Chromium trusts loopback, but Playwright's APIRequestContext does not send
  // Secure cookies over HTTP. Only this verified localhost QA transport adapts
  // the cookie; the upstream application still emits Secure cookies on HTTPS.
  if (headers["set-cookie"]) {
    const cookies = Array.isArray(headers["set-cookie"]) ? headers["set-cookie"] : [headers["set-cookie"]];
    headers["set-cookie"] = cookies.map((cookie) => String(cookie).replace(/;\s*Secure(?=\s*(?:;|$))/gi, ""));
  }
  if (headers.location) {
    const location = new URL(String(headers.location), target.targetUrl);
    if (location.origin !== target.targetUrl) throw new Error("QA proxy refuses redirects to another origin.");
    headers.location = `${target.baseUrl}${location.pathname}${location.search}${location.hash}`;
  }
  return headers;
}

export function createQaProxy({ target, metadata, source, getIdToken, requestUpstream = requestHttps }) {
  // A valid metadata response is required before any browser/Firebase request
  // can be forwarded. Production and a different source cannot pass this gate.
  validateQaEnvironment(metadata, target, source);
  if (!target.targetUrl || target.emulator) throw new Error("QA proxy requires a verified cloud target.");
  return createServer(async (incoming, outgoing) => {
    let upstream;
    try {
      const url = new URL(incoming.url, target.targetUrl);
      if (url.origin !== target.targetUrl) throw new Error("Invalid proxy request target.");
      // Validate host/origin before minting or attaching a token.
      const headers = qaProxyRequestHeaders(incoming.headers, target, "");
      headers["x-serverless-authorization"] = `Bearer ${await getIdToken()}`;
      upstream = requestUpstream(url, { method: incoming.method, headers, timeout: 10 * 60_000 }, (response) => {
        try {
          outgoing.writeHead(response.statusCode || 502, qaProxyResponseHeaders(response.headers, target));
          response.pipe(outgoing);
        } catch {
          response.destroy();
          outgoing.writeHead(502); outgoing.end("QA upstream redirect rejected.");
        }
      });
      upstream.on("timeout", () => upstream.destroy());
      upstream.on("error", () => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end("QA upstream request failed."); });
      incoming.on("aborted", () => upstream.destroy());
      incoming.pipe(upstream);
    } catch {
      upstream?.destroy();
      outgoing.writeHead(403); outgoing.end("QA proxy request rejected.");
    }
  });
}

async function main() {
  const target = validateQaTarget(process.env);
  const serviceAccount = validateQaProxyAccount(process.env.QA_SERVICE_ACCOUNT, target);
  const port = Number(new URL(target.baseUrl).port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("QA proxy requires an explicit unprivileged loopback port.");
  const source = { commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim() };
  const client = await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] }).getClient();
  const getIdToken = createRenewingQaTokenProvider({ client, serviceAccount, audience: target.targetUrl });
  const preflight = await fetch(`${target.targetUrl}/api/qa/environment`, { redirect: "error", headers: { "X-Serverless-Authorization": `Bearer ${await getIdToken()}` }, signal: AbortSignal.timeout(90_000) });
  if (!preflight.ok) throw new Error(`QA proxy preflight failed (${preflight.status}).`);
  const metadata = await preflight.json();
  const server = createQaProxy({ target, metadata, source, getIdToken });
  server.listen(port, "127.0.0.1", () => process.stdout.write(`Verified IAM-private QA proxy listening on 127.0.0.1:${port}.\n`));
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => server.close(() => process.exit(0)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(() => { process.stderr.write("QA proxy startup rejected; verify isolated target/source, WIF and QA-only ID-token permission.\n"); process.exitCode = 1; });
}
