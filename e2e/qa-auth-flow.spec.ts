import { createServer } from "node:http";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { openQaCredentials, attachQaSignInDiagnostics, readQaIdentity } from "./qa/auth-flow";

async function withIdentityServer(browser: Browser, resetCount: number, status: number, check: (page: Page, attempts: () => number) => Promise<void>) {
  let attempts = 0;
  const server = createServer((request, response) => {
    attempts += 1;
    if (attempts <= resetCount) { request.socket.destroy(); return; }
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify({ user: { email: "synthetic-reader@example.test", role: "viewer" } }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const context = await browser.newContext({ baseURL: `http://127.0.0.1:${(server.address() as { port: number }).port}` });
  try { await check(await context.newPage(), () => attempts); }
  finally {
    await context.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("QA sign-in waits for an asynchronous account-link credential form", async ({ page }) => {
  await page.setContent('<main>Opening the shared project…</main>');
  await page.evaluate(() => window.setTimeout(() => {
    document.querySelector("main")!.innerHTML = '<form class="auth-form" method="post"><input name="email" type="email"><input name="password" type="password"><button>Sign in</button></form>';
  }, 200));
  const email = await openQaCredentials(page);
  await email.fill("synthetic-reader@example.test");
  await expect(email).toHaveValue("synthetic-reader@example.test");
});

test("QA sign-in opens the normal private entry", async ({ page }) => {
  await page.setContent('<main><button onclick="this.parentElement.innerHTML=\'<input name=email type=email>\'">Open private workspace</button></main>');
  await expect(await openQaCredentials(page)).toBeVisible();
});

test("QA sign-in retries private entry clicks while hydration is pending", async ({ page }) => {
  test.setTimeout(5_000);
  await page.setContent('<main><button onclick="if(this.dataset.ready) this.parentElement.innerHTML=\'<input name=email type=email>\'">Open private workspace</button></main>');
  await page.evaluate(() => window.setTimeout(() => { document.querySelector("button")!.dataset.ready = "true"; }, 400));
  await expect(await openQaCredentials(page)).toBeVisible();
});

test("QA sign-in diagnostics omit link tokens and credential values", async ({ page }, testInfo) => {
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<input name="email" value="synthetic-reader@example.test"><input name="password" type="password" value="synthetic-secret">' }));
  await page.goto("http://127.0.0.1/credentials?accessLink=synthetic-capability&invite=synthetic-invitation");
  await attachQaSignInDiagnostics(page, "VIEWER", "credentials");
  const diagnostic = testInfo.attachments.find(item => item.name === "sign-in-diagnostics")!.body!.toString();
  expect(JSON.parse(diagnostic)).toMatchObject({ identity: "VIEWER", phase: "credentials", pathname: "/credentials", emailVisible: true, passwordVisible: true });
  expect(diagnostic).not.toMatch(/synthetic-capability|synthetic-invitation|synthetic-secret|synthetic-reader|accessLink|invite=/);
});

test("QA identity reads recover two connection resets and return the original identity", async ({ browser }) => {
  await withIdentityServer(browser, 2, 200, async (page, attempts) => {
    const response = await readQaIdentity(page);
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ user: { email: "synthetic-reader@example.test", role: "viewer" } });
    expect(attempts()).toBe(3);
  });
});

test("QA identity reads stop after two retries on persistent connection resets", async ({ browser }) => {
  await withIdentityServer(browser, Number.POSITIVE_INFINITY, 200, async (page, attempts) => {
    await expect(readQaIdentity(page)).rejects.toThrow(/Failed after 3 attempt/);
    expect(attempts()).toBe(3);
  });
});

test("QA identity reads preserve HTTP denial without retrying it", async ({ browser }) => {
  await withIdentityServer(browser, 0, 403, async (page, attempts) => {
    expect((await readQaIdentity(page)).status()).toBe(403);
    expect(attempts()).toBe(1);
  });
});
