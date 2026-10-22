import { createServer, request as requestHttp } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { createQaProxy, createRenewingQaTokenProvider, qaProxyRequestHeaders, qaProxyResponseHeaders, validateQaProxyAccount } from "../scripts/qa-cloud-proxy.mjs";
import { validateQaTarget } from "../scripts/qa-target-policy.mjs";

const target = validateQaTarget({ QA_BASE_URL: "http://localhost:8085", QA_TARGET_URL: "https://house-planner-qa-123456789.us-central1.run.app", QA_FIREBASE_PROJECT_ID: "house-planner-qa-example", QA_CLOUD_PROXY: "1" });
const account = "qa-runner@house-planner-qa-example.iam.gserviceaccount.com";
const source = { commit: "a".repeat(40), tree: "b".repeat(40) };
const metadata = { environment: "qa", isolated: true, emulator: false, cloudProjectId: target.cloudProjectId, primaryProjectId: "qa-primary", isolationProjectId: "qa-isolation", sourceCommit: source.commit, sourceTree: source.tree, service: "house-planner-qa", revision: "house-planner-qa-00001-abc" };
const token = (exp: number, overrides = {}) => `header.${Buffer.from(JSON.stringify({ aud: target.targetUrl, email: account, exp, ...overrides })).toString("base64url")}.signature`;

describe("private QA proxy authentication and request isolation", () => {
  it("accepts only the isolated QA runner identity and validated runtime/source", () => {
    expect(validateQaProxyAccount(account, target)).toBe(account);
    for (const other of ["qa-runner@example-house-planner.iam.gserviceaccount.com", "qa-runtime@house-planner-qa-example.iam.gserviceaccount.com", undefined]) expect(() => validateQaProxyAccount(other, target)).toThrow();
    expect(() => createQaProxy({ target, source, metadata: { ...metadata, sourceTree: "c".repeat(40) }, getIdToken: async () => "secret" })).toThrow();
  });

  it("renews expiring tokens once for concurrent requests and rejects wrong token audiences", async () => {
    let now = 1_000_000;
    const client = { request: vi.fn(async (options: Record<string, unknown>) => { expect(options).toHaveProperty("data"); return { data: { token: token(now / 1000 + 600) } }; }) };
    const getToken = createRenewingQaTokenProvider({ client, serviceAccount: account, audience: target.targetUrl, now: () => now });
    const first = await Promise.all([getToken(), getToken(), getToken()]);
    expect(new Set(first).size).toBe(1);
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request.mock.calls[0][0]).toMatchObject({ method: "POST", data: { audience: target.targetUrl, includeEmail: true } });
    now += 500_000;
    expect(await getToken()).toBe(first[0]);
    now += 50_000;
    expect(await getToken()).not.toBe(first[0]);
    expect(client.request).toHaveBeenCalledTimes(2);
    const wrong = createRenewingQaTokenProvider({ client: { request: async () => ({ data: { token: token(now / 1000 + 600, { aud: "https://house-planner-prod.example" }) } }) }, serviceAccount: account, audience: target.targetUrl, now: () => now });
    await expect(wrong()).rejects.toThrow("does not match");
  });

  it("preserves Firebase authentication and rewrites only a local QA origin", () => {
    const headers = qaProxyRequestHeaders({ host: "localhost:8085", authorization: "Bearer firebase-session", origin: target.baseUrl, referer: `${target.baseUrl}/projects/qa-primary`, "x-forwarded-host": "attacker.example", "x-serverless-authorization": "attacker-token" }, target, "iam-token");
    expect(headers).toMatchObject({ authorization: "Bearer firebase-session", origin: target.targetUrl, referer: `${target.targetUrl}/projects/qa-primary`, "x-serverless-authorization": "Bearer iam-token", "x-forwarded-proto": "https" });
    expect(headers["x-forwarded-host"]).toBeUndefined();
    expect(() => qaProxyRequestHeaders({ host: "localhost:8085", origin: "https://attacker.example" }, target, "iam-token")).toThrow();
    expect(() => qaProxyRequestHeaders({ host: "attacker.example" }, target, "iam-token")).toThrow();
    expect(qaProxyResponseHeaders({ location: `${target.targetUrl}/projects/qa-primary`, "set-cookie": ["__session=value; Secure; HttpOnly; SameSite=Lax"] }, target)).toMatchObject({ location: `${target.baseUrl}/projects/qa-primary`, "set-cookie": ["__session=value; HttpOnly; SameSite=Lax"] });
    expect(() => qaProxyResponseHeaders({ location: "//attacker.example/" }, target)).toThrow();
  });

  it("streams an authenticated multipart-style request and rejects cross-origin requests before minting", async () => {
    const received: Array<{ headers: Record<string, unknown>; body: string }> = [];
    const upstream = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => { received.push({ headers: request.headers, body }); response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ accepted: true })); });
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;
    const getIdToken = vi.fn(async () => "iam-token");
    const requestUpstream = ((_url: URL, options: Parameters<typeof requestHttp>[1], callback: Parameters<typeof requestHttp>[2]) => requestHttp(`http://127.0.0.1:${upstreamPort}`, options, callback)) as typeof requestHttp;
    const proxy = createQaProxy({ target, metadata, source, getIdToken, requestUpstream });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    const proxyPort = (proxy.address() as AddressInfo).port;
    const send = (origin: string) => new Promise<number>((resolve, reject) => {
      const request = requestHttp(`http://127.0.0.1:${proxyPort}/api/workbook/file`, { method: "POST", headers: { host: "localhost:8085", origin, authorization: "Bearer firebase-session", "content-type": "multipart/form-data; boundary=qa" } }, (response) => { response.resume(); response.on("end", () => resolve(response.statusCode!)); });
      request.on("error", reject); request.end("synthetic workbook bytes");
    });
    try {
      expect(await send("https://attacker.example")).toBe(403);
      expect(getIdToken).not.toHaveBeenCalled();
      expect(await send(target.baseUrl)).toBe(200);
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ body: "synthetic workbook bytes", headers: { authorization: "Bearer firebase-session", "x-serverless-authorization": "Bearer iam-token", origin: target.targetUrl } });
    } finally {
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
});
