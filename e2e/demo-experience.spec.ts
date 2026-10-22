import { expect, test } from "@playwright/test";

test.use({ contextOptions: { reducedMotion: "reduce" } });

test.describe("representative fictional demo", () => {
  let privateRequests: string[];
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    privateRequests = []; errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith("/api/") && !path.startsWith("/api/usage")) privateRequests.push(path);
    });
    await page.route("**/api/usage/**", route => route.fulfill({ json: { ok: true } }));
    await page.addInitScript(() => localStorage.setItem("house-planner-language", "en"));
    await page.goto("/?mode=demo");
    await expect(page.getByRole("heading", { name: "Explore House Planner" })).toBeVisible();
  });
  test.afterEach(() => {
    expect(privateRequests).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("opens populated reviews, local notes, house model and scripted assistant", async ({ page }) => {
    const nav = page.getByRole("navigation", { name: "Project sections" });
    await page.getByRole("button", { name: /Compare a quote/ }).click();
    await expect(page.getByRole("heading", { name: "Review before you commit" })).toBeVisible();
    await expect(page.locator(".quote-result-head")).toContainText("EXAMPLE ANALYSIS");
    await expect(page.locator(".quote-verdict")).toContainText("USD 15,500");
    await page.getByPlaceholder("Ask a follow-up question…").fill("What is excluded?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.locator(".quote-chat-messages article.assistant")).toHaveCount(2);
    await nav.getByRole("button", { name: /Notes/ }).click();
    await expect(page.getByRole("heading", { name: "Notes and data" })).toBeVisible();
    await expect(page.locator(".notes-card")).toHaveCount(3);
    await page.getByRole("button", { name: "+ New note", exact: true }).click();
    await expect(page.getByLabel("Title", { exact: true })).toBeFocused();
    await page.getByLabel("Title", { exact: true }).fill("Local delivery decision");
    await page.getByLabel("Information or note", { exact: true }).fill("Confirm the fictional delivery on Friday.");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(page.locator(".notes-card")).toHaveCount(4);
    await nav.getByRole("button", { name: /House Distribution 3D/ }).click();
    await expect(page.locator(".distribution-rooms button")).toHaveCount(8);
    await page.locator(".distribution-rooms button").first().click();
    await expect(page.locator(".distribution-details")).toContainText("30.00 m²");
    await nav.getByRole("button", { name: /Documents/ }).click();
    await expect(page.getByRole("heading", { name: "Documents and folders" })).toBeVisible();
    await page.getByRole("button", { name: "Unfiled documents", exact: true }).click();
    await expect(page.getByText("Casa_Mirador_Project_Brief.txt", { exact: true })).toBeVisible();
    await nav.getByRole("button", { name: /Aesthetics/ }).click();
    await expect(page.locator(".aesthetics-page")).toBeVisible();
    await expect(page.locator(".aesthetic-stage img")).toHaveAttribute("src", "/demo/casa-mirador-living.svg");
    await page.getByRole("button", { name: "Open project assistant" }).click();
    const assistant = page.getByRole("dialog", { name: "Project assistant", exact: true });
    await expect(assistant).toContainText("Scripted demo");
    await assistant.getByRole("button", { name: "Show the sample budget and excess", exact: true }).click();
    await expect(assistant.locator(".assistant-message.assistant")).toContainText("$55,000");
    await expect(assistant.locator(".assistant-message.assistant")).toContainText("$6,200");
    await expect(assistant.locator(".assistant-proposal")).toHaveCount(0);
  });

  test("keeps the overview and existing USD budget in agreement", async ({ page }) => {
    await expect(page.locator(".demo-financials")).toContainText("$55,000");
    await expect(page.locator(".demo-financials")).toContainText("$6,200");
    await expect(page.locator(".demo-financials")).toContainText("$500");
    await page.getByRole("navigation", { name: "Project sections" }).getByRole("button", { name: /Budget/ }).click();
    await expect(page.getByRole("heading", { name: "Budget dashboard" })).toBeVisible();
    await expect(page.locator(".budget-metrics")).toContainText("55,000");
    await expect(page.locator(".budget-metrics")).toContainText("6,200");
    await expect(page.locator(".budget-line-card")).toHaveCount(3);
    const download = await page.request.get("/demo/House_Planner_Demo_en.xlsx");
    expect(download.ok()).toBe(true);
    expect(download.headers()["content-type"]).toContain("spreadsheetml");
  });

  test("keeps the richer overview usable on mobile in both languages", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".demo-hero-art img")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await testInfo.attach("demo-overview-mobile", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await page.getByRole("button", { name: "Measurements & areas", exact: true }).click();
    await expect(page.locator(".demo-measurements")).toContainText("120 m²");
    await page.locator(".mobile-workspace-nav").getByRole("button", { name: "Sections", exact: true }).click();
    await page.getByRole("dialog", { name: "Sections", exact: true }).getByRole("button", { name: "ES", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Explora House Planner" })).toBeVisible();
    await expect(page.locator(".demo-measurements")).toContainText("Medidas inventadas");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  test("renders distinct fictional local illustrations on desktop", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(page.locator(".demo-hero-art img")).toHaveJSProperty("complete", true);
    await expect(page.locator(".demo-hero-art img")).toHaveAttribute("src", /casa-mirador-exterior(?:\.[a-f0-9]+)?\.webp/);
    await testInfo.attach("demo-overview-desktop", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    const exteriorResponse = await page.request.get("/demo/casa-mirador-exterior.webp");
    expect(exteriorResponse.ok()).toBe(true);
    expect(exteriorResponse.headers()["content-type"]).toContain("image/webp");
    for (const name of ["living", "kitchen", "bath", "plan"]) {
      const response = await page.request.get(`/demo/casa-mirador-${name}.svg`);
      expect(response.ok()).toBe(true);
      expect(response.headers()["content-type"]).toContain("image/svg+xml");
    }
  });
});
