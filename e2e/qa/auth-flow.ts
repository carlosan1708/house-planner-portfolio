import { expect, test, type Page } from "@playwright/test";

/** Identity reads can safely recover two ECONNRESETs; HTTP failures are never retried. */
export function readQaIdentity(page: Page) {
  return page.request.get("/api/me", { failOnStatusCode: false, maxRetries: 2 });
}

/** Link redemption can show the credential form asynchronously without an entry card. */
export async function openQaCredentials(page: Page) {
  const emailInput = page.locator('input[name="email"]');
  const privateEntry = page.getByRole("button", { name: /Open private workspace|Abrir espacio privado/i });
  await expect.poll(async () => {
    if (await emailInput.isVisible()) return true;
    if (await privateEntry.isVisible() && await privateEntry.isEnabled()) {
      try { await privateEntry.click({ timeout: 2_000 }); }
      catch (error) {
        // A form appearing during the click makes its old entry disappear.
        if (!(await emailInput.isVisible())) throw error;
      }
    }
    return emailInput.isVisible();
  }, { timeout: 60_000, intervals: [250, 500, 1_000], message: "QA credentials did not appear after the private entry or account-link transition" }).toBe(true);
  return emailInput;
}

/** Keep diagnostics useful without storing query capabilities or credential values. */
export async function attachQaSignInDiagnostics(page: Page, identity: string, phase: string) {
  const visible = (selector: string) => page.locator(selector).isVisible().catch(() => false);
  const status = await page.request.get("/api/me", { timeout: 5_000 }).then(response => response.status()).catch(() => null);
  const pathname = new URL(page.url()).pathname;
  await test.info().attach("sign-in-diagnostics", {
    contentType: "application/json",
    body: Buffer.from(JSON.stringify({
      identity, phase, pathname, meStatus: status,
      emailVisible: await visible('input[name="email"]'),
      passwordVisible: await visible('input[name="password"]'),
      credentialsVisible: await visible("form.auth-form"),
      privateEntryVisible: await page.getByRole("button", { name: /Open private workspace|Abrir espacio privado/i }).isVisible().catch(() => false),
      readLinkErrorVisible: await visible('.auth-error[role="alert"]'),
      projectVisible: await visible(".topbar h1"),
    }, null, 2)),
  });
}
