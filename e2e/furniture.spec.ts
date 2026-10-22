import { expect, test, type Page } from "@playwright/test";

test.use({ contextOptions: { reducedMotion: "reduce" } });

async function openFurniture(page: Page, language: "en" | "es" = "en") {
  const errors: string[] = [], privateRequests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/") && !path.startsWith("/api/usage")) privateRequests.push(path);
  });
  await page.route("**/api/usage/**", route => route.fulfill({ json: { ok: true } }));
  await page.addInitScript(value => localStorage.setItem("house-planner-language", value), language);
  await page.goto("/?mode=demo");
  const furnitureLabel = language === "es" ? "Mobiliario" : "Furniture";
  const distributionLabel = language === "es" ? "Distribución" : "Distribution";
  const mainLabel = language === "es" ? "Distribución 3D" : "House Distribution 3D";
  if (await page.locator(".mobile-workspace-nav").isVisible()) {
    await page.locator(".mobile-workspace-nav").getByRole("button", { name: language === "es" ? "Secciones" : "Sections", exact: true }).click();
    const menu = page.getByRole("navigation", { name: language === "es" ? "Todas las secciones" : "All sections" });
    await expect(menu.getByRole("button", { name: furnitureLabel, exact: true })).toHaveCount(0);
    await menu.getByRole("button", { name: mainLabel, exact: false }).click();
  } else {
    const navigation = page.getByRole("navigation", { name: language === "es" ? "Secciones del proyecto" : "Project sections" });
    await expect(navigation.getByRole("button", { name: furnitureLabel, exact: true })).toHaveCount(0);
    await navigation.getByRole("button", { name: mainLabel, exact: false }).click();
  }
  const tabs = page.getByRole("tablist", { name: language === "es" ? "Vistas 3D" : "3D views" });
  const distributionTab = tabs.getByRole("tab", { name: distributionLabel, exact: true });
  const furnitureTab = tabs.getByRole("tab", { name: furnitureLabel, exact: true });
  await expect(tabs.getByRole("tab")).toHaveCount(2);
  await expect(distributionTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".distribution-scene-wrap")).toHaveAttribute("data-furniture-count", "0");
  await expect(page.locator(".furniture-inventory")).toHaveCount(0);
  await furnitureTab.click();
  await expect(furnitureTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".furniture-workspace")).toBeVisible();
  await expect.poll(async () => Number(await page.locator(".distribution-scene-wrap").getAttribute("data-furniture-count"))).toBeGreaterThan(0);
  await expectParentNavigation(page, language);
  return { errors, privateRequests, distributionTab, furnitureTab };
}

async function expectParentNavigation(page: Page, language: "en" | "es") {
  const furnitureLabel = language === "es" ? "Mobiliario" : "Furniture";
  const mainLabel = language === "es" ? "Distribución 3D" : "House Distribution 3D";
  await expect(page.locator(".topbar h1")).toHaveText(mainLabel);
  await expect(page.locator(".sidebar nav button").filter({ hasText: furnitureLabel })).toHaveCount(0);
  await expect(page.locator('.sidebar nav [aria-current="page"]')).toContainText(mainLabel);
  if (await page.locator(".mobile-workspace-nav").isVisible()) {
    await page.locator(".mobile-workspace-nav").getByRole("button", { name: language === "es" ? "Secciones" : "Sections", exact: true }).click();
    const menu = page.getByRole("navigation", { name: language === "es" ? "Todas las secciones" : "All sections" });
    await expect(menu.getByRole("button", { name: furnitureLabel, exact: true })).toHaveCount(0);
    await expect(menu.getByRole("button", { name: mainLabel, exact: false })).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: language === "es" ? "Cerrar secciones" : "Close sections", exact: true }).click();
  }
}

test("desktop Furniture stays inside Distribution 3D with selectable proposals and keyboard tabs", async ({ page }, testInfo) => {
  // Allow software rendering to initialize the full Presentation before tab checks.
  test.slow();
  await page.setViewportSize({ width: 1440, height: 1100 });
  const state = await openFurniture(page);
  await expect(page.locator('.distribution-scene-wrap[data-render-mode="3d"] canvas')).toBeVisible();
  await expect(page.locator(".furniture-proposal-note")).toContainText("Furniture sizes and finishes are suggestions");
  const piece = page.locator(".furniture-item-grid button").first();
  const name = await piece.locator("b").innerText();
  await piece.click();
  await expect(piece).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".furniture-selected h3")).toHaveText(name);
  await expect(page.locator(".furniture-selected")).toContainText("Proposed footprint");
  await expect(page.locator(".furniture-selected .distribution-metrics")).toContainText(/\d+\.\d{2} × \d+\.\d{2} m/);
  await testInfo.attach("furniture-proposal", { body: await page.locator(".distribution-scene canvas").screenshot(), contentType: "image/png" });
  const proposedCount = await page.locator(".distribution-scene-wrap").getAttribute("data-furniture-count");
  await page.getByRole("button", { name: "Show complete house", exact: true }).click();
  await page.getByRole("button", { name: "Presentation", exact: true }).click();
  await expect(page.locator('[data-presentation="true"]')).toBeVisible();
  await expect(page.locator(".distribution-scene-wrap")).toHaveAttribute("data-furniture-count", proposedCount!);
  await expectParentNavigation(page, "en");
  await state.furnitureTab.focus();
  await state.furnitureTab.press("ArrowLeft");
  await expect(state.distributionTab).toBeFocused();
  await expect(state.distributionTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".distribution-scene-wrap")).toHaveAttribute("data-furniture-count", "0");
  await expect(page.locator('[data-view="volume"][data-presentation="false"]')).toBeVisible();
  await expect(page.locator(".furniture-inventory")).toHaveCount(0);
  await expect(page.locator(".distribution-rooms button")).toHaveCount(8);
  await state.distributionTab.press("End");
  await expect(state.furnitureTab).toBeFocused();
  await expect(state.furnitureTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".furniture-inventory")).toBeVisible();
  await expect.poll(async () => Number(await page.locator(".distribution-scene-wrap").getAttribute("data-furniture-count"))).toBeGreaterThan(0);
  await expectParentNavigation(page, "en");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
  expect(state.errors).toEqual([]);
  expect(state.privateRequests).toEqual([]);
});

test("Spanish desktop furniture labels and room inspection preserve the fictional model", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const state = await openFurniture(page, "es");
  await expect(page.locator(".furniture-workspace h2")).toContainText("Mobiliario");
  await expect(page.locator(".furniture-proposal-note")).toContainText("PROPUESTA DE MOBILIARIO");
  await expect(page.getByRole("checkbox", { name: "Tomacorrientes", exact: true })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Luces", exact: true })).not.toBeChecked();
  const piece = page.locator(".furniture-item-grid button").first();
  const name = await piece.locator("b").innerText();
  await piece.click();
  await expect(page.locator(".furniture-selected h3")).toHaveText(name);
  await expect(page.locator(".furniture-selected")).toContainText("Huella propuesta");
  await page.getByRole("button", { name: "Ver este espacio", exact: false }).click();
  await expect(page.locator(".distribution-details h3")).toBeVisible();
  await expect(page.locator(".distribution-details")).toContainText("Área calculada de zona");
  await expect(page.locator(".distribution-rooms button")).toHaveCount(8);
  await state.distributionTab.click();
  await expect(page.locator(".distribution-scene-wrap")).toHaveAttribute("data-furniture-count", "0");
  await expect(page.locator(".furniture-inventory")).toHaveCount(0);
  await state.furnitureTab.click();
  await expect(page.locator(".furniture-inventory")).toBeVisible();
  await expectParentNavigation(page, "es");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
  expect(state.errors).toEqual([]);
  expect(state.privateRequests).toEqual([]);
});

for (const language of ["en", "es"] as const) {
  test(`terrace furniture can be selected and its modeled space inspected (${language})`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    const state = await openFurniture(page, language);
    const terraceName = language === "es" ? "Terraza al jardín" : "Garden terrace";
    const sofa = page.locator('.furniture-item-grid button[data-furniture-id*="demo-terrace"]')
      .filter({ has: page.locator("b", { hasText: /sofa|sofá/i }) }).first();
    await expect(sofa).toContainText(terraceName);
    const name = await sofa.locator("b").innerText();
    await sofa.click();
    await expect(sofa).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".furniture-selected h3")).toHaveText(name);
    await expect(page.locator(".furniture-selected")).toContainText(terraceName);
    await page.getByRole("button", { name: language === "es" ? "Ver este espacio" : "Inspect this space", exact: false }).click();
    await expect(page.locator(".distribution-details h3")).toHaveText(terraceName);
    await expect(page.getByRole("button", { name: language === "es" ? "Enfocar espacio" : "Focus room", exact: true })).toBeVisible();
    await expect(page.locator(".distribution-rooms button")).toHaveCount(8);
    expect(state.errors).toEqual([]);
    expect(state.privateRequests).toEqual([]);
  });
}

test.describe("mobile furniture", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("touch inventory selection and view controls remain usable", async ({ page }, testInfo) => {
    const state = await openFurniture(page);
    await expect(page.locator('.distribution-scene-wrap[data-render-mode="3d"] canvas')).toBeVisible();
    await page.getByRole("button", { name: "Top view", exact: true }).tap();
    const piece = page.locator(".furniture-item-grid button").first();
    const name = await piece.locator("b").innerText();
    await piece.tap();
    await expect(page.locator(".furniture-selected h3")).toHaveText(name);
    await expect(page.locator(".furniture-selected")).toContainText("Proposed footprint");
    await state.distributionTab.tap();
    await expect(page.locator(".distribution-scene-wrap")).toHaveAttribute("data-furniture-count", "0");
    await expect(page.locator(".furniture-inventory")).toHaveCount(0);
    await state.furnitureTab.tap();
    await expect(page.locator(".furniture-inventory")).toBeVisible();
    await expectParentNavigation(page, "en");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await testInfo.attach("mobile-furniture", { body: await page.locator(".distribution-scene canvas").screenshot(), contentType: "image/png" });
    expect(state.errors).toEqual([]);
    expect(state.privateRequests).toEqual([]);
  });

  test("Spanish furniture remains selectable when WebGL is unavailable", async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(this: HTMLCanvasElement, type: string, ...args: unknown[]) {
        if (type.startsWith("webgl")) return null;
        return original.call(this, type as "2d", ...args as []) as never;
      } as typeof original;
    });
    const state = await openFurniture(page, "es");
    await expect(page.locator('.distribution-scene-wrap[data-render-mode="2d"]')).toBeVisible();
    const terracePiece = page.locator('.distribution-fallback polygon[data-furniture-id*="demo-terrace"]').first();
    await expect(terracePiece).toBeVisible();
    expect(await terracePiece.evaluate(element => {
      const polygon = element as SVGPolygonElement, box = polygon.ownerSVGElement!.viewBox.baseVal;
      return Array.from(polygon.points).every(point => point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height);
    })).toBe(true);
    const piece = page.locator(".furniture-item-grid button").first();
    const name = await piece.locator("b").innerText();
    await piece.tap();
    await expect(page.locator(".furniture-selected h3")).toHaveText(name);
    await expect(page.locator(".furniture-selected")).toContainText("Huella propuesta");
    await state.distributionTab.tap();
    await expect(page.locator(".distribution-scene-wrap")).toHaveAttribute("data-furniture-count", "0");
    await expect(page.locator(".furniture-inventory")).toHaveCount(0);
    await state.furnitureTab.tap();
    await expect(page.locator(".furniture-inventory")).toBeVisible();
    await expectParentNavigation(page, "es");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(state.errors).toEqual([]);
    expect(state.privateRequests).toEqual([]);
  });
});
