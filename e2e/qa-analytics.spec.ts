import { expect, test, type BrowserContext } from "@playwright/test";

// Focused, read-only candidate checks. Unit and component tests cover the
// platform owner's positive path; this QA account owns only its isolated
// project and must never receive global analytics access.
const expectedEmail = "qa.houseplanner.20260830@example.com";
const projectId = "qa-primary";
const email = (process.env.QA_OWNER_EMAIL || "").toLowerCase();
const password = process.env.QA_OWNER_PASSWORD || "";
const baseURL = process.env.QA_BASE_URL!;
const userAgent = "Mozilla/5.0 HeadlessChrome/140.0.0.0 Safari/537.36 HousePlanner-Playwright-QA";
const projectPath = `/projects/${projectId}`;
type QaUser = { email: string; projectId: string; role: string; status: string; isPersonal: boolean; canViewPlatformAnalytics: boolean };

test.setTimeout(5 * 60_000);
test.use({ userAgent });

test("candidate rejects public analytics requests and excludes headless access visits", async ({ request }) => {
  const denied = await request.get("/api/admin/analytics");
  expect(denied.status()).toBe(403);
  expect(denied.headers()["cache-control"]).toContain("private, no-store");
  const excluded = await request.post("/api/usage/events", {
    headers: { Origin: baseURL, "User-Agent": userAgent },
    data: { expectedEmail: null, events: [{ id: `qa-analytics-access-${Date.now()}`, kind: "view", context: "access", section: "access" }] },
  });
  expect(excluded.status()).toBe(202);
  expect(await excluded.json()).toEqual({ accepted: 0, excluded: true });
});

test("candidate refuses project administrators, preserves navigation and excludes authenticated QA", async ({ browser }, testInfo) => {
  expect(email && password, "Fixed QA owner credentials are required").toBeTruthy();
  expect(email).toBe(expectedEmail);
  expect(process.env.QA_PROJECT_ID || projectId).toBe(projectId);
  let authentication: BrowserContext | null = await browser.newContext({ baseURL, userAgent });
  let context: BrowserContext | null = null;
  try {
    const signIn = await authentication.newPage();
    await signIn.goto(`${projectPath}/overview`, { waitUntil: "domcontentloaded" });
    const emailInput = signIn.locator('input[name="email"]');
    const openPrivate = signIn.getByRole("button", { name: /Open private workspace|Abrir espacio privado/i });
    for (let attempt = 0; attempt < 2 && !(await emailInput.isVisible()); attempt += 1) {
      await expect(openPrivate).toBeVisible();
      await openPrivate.click();
      await emailInput.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
    }
    await expect(signIn.locator("form.auth-form")).toHaveAttribute("method", "post");
    await signIn.locator('input[name="email"]').fill(email);
    await signIn.locator('input[name="password"]').fill(password);
    await signIn.getByRole("button", { name: /^(Sign in|Iniciar sesión)$/i }).click();
    await expect.poll(async () => (await signIn.request.get("/api/me")).status(), { timeout: 60_000 }).toBe(200);
    const state = await authentication.storageState({ indexedDB: true });
    await authentication.close(); authentication = null;
    context = await browser.newContext({ baseURL, userAgent, storageState: state });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const identity = await page.request.get("/api/me");
    expect(identity.status()).toBe(200);
    const me = await identity.json() as { user: QaUser };
    expect(me.user).toMatchObject({ email, projectId, role: "admin", status: "approved", isPersonal: false, canViewPlatformAnalytics: false });

    const denied = await page.request.get("/api/admin/analytics");
    expect(denied.status()).toBe(403);
    expect(denied.headers()["cache-control"]).toContain("private, no-store");
    const dashboardRequests: string[] = [];
    page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/admin/analytics") dashboardRequests.push(request.url()); });
    await page.goto(`${projectPath}/analytics`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/Section access required|No tienes acceso a esta sección/, { exact: true })).toBeVisible();
    await expect(page.locator(".analytics-workspace")).toHaveCount(0);
    await expect(page.locator(".sidebar nav").getByRole("button", { name: /App usage|Uso de la app/ })).toHaveCount(0);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(/Section access required|No tienes acceso a esta sección/, { exact: true })).toBeVisible();
    expect(dashboardRequests).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("qa-project-admin-analytics-denied.png"), fullPage: true });

    await page.locator(".sidebar nav").getByRole("button", { name: /Overview|Resumen/ }).click();
    await expect(page).toHaveURL(new RegExp(`${projectPath}/overview(?:[?#]|$)`));
    await expect(page.locator(".sidebar nav .nav-item.active")).toHaveText(/Overview|Resumen/);
    await page.locator(".sidebar nav").getByRole("button", { name: /Documents|Documentos/ }).click();
    await expect(page).toHaveURL(new RegExp(`${projectPath}/documents(?:[?#]|$)`));
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${projectPath}/overview(?:[?#]|$)`));
    await expect(page.locator(".sidebar nav .nav-item.active")).toHaveText(/Overview|Resumen/);

    // Use a non-headless header on this one request to exercise the independent
    // server-side QA identity/project exclusion, rather than only the UA guard.
    const excluded = await page.request.post("/api/usage/events", {
      headers: { Origin: baseURL, "User-Agent": "Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36" },
      data: { expectedEmail: email, events: [{ id: `qa-analytics-project-${Date.now()}`, kind: "view", context: "project", section: "overview", projectId }] },
    });
    expect(excluded.status()).toBe(202);
    expect(await excluded.json()).toEqual({ accepted: 0, excluded: true });
    expect(errors).toEqual([]);
  } finally {
    await authentication?.close();
    await context?.close();
  }
});
