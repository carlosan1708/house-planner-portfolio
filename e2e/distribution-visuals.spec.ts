import { expect, test, type Page } from "@playwright/test";

test.use({ contextOptions: { reducedMotion: "reduce" } });

async function openDistribution(page: Page) {
  await page.route("**/api/usage/**", route => route.fulfill({ json: { ok: true } }));
  await page.addInitScript(() => localStorage.setItem("house-planner-language", "en"));
  await page.goto("/?mode=demo");
  if (await page.locator(".mobile-workspace-nav").isVisible()) {
    await page.locator(".mobile-workspace-nav").getByRole("button", { name: "Sections", exact: true }).click();
    await page.getByRole("navigation", { name: "All sections" }).getByRole("button", { name: /House Distribution 3D/ }).click();
  } else await page.getByRole("navigation", { name: "Project sections" }).getByRole("button", { name: /House Distribution 3D/ }).click();
  await expect(page.locator(".distribution-rooms button")).toHaveCount(8);
  await page.getByRole("button", { name: "Show interior", exact: true }).click();
  await expect(page.locator('[data-view="interior"]')).toBeVisible();
}

test("demo 3D materials, labels and camera controls render distinct usable views", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await openDistribution(page);
  await expect(page.locator('[data-render-mode="3d"]')).toBeVisible();
  const canvas = page.locator(".distribution-scene canvas");
  await expect(canvas).toBeVisible();
  await expect(page.locator(".distribution-scene-wrap")).toHaveAttribute("data-furniture-count", "0");
  const initial = await canvas.screenshot();
  await testInfo.attach("technical-interior", { body: initial, contentType: "image/png" });

  const materials = page.getByRole("button", { name: "Materials", exact: true });
  await expect(materials).toHaveAttribute("aria-pressed", "true");
  await materials.click();
  await expect(materials).toHaveAttribute("aria-pressed", "false");
  expect((await canvas.screenshot()).equals(initial)).toBe(false);
  await materials.click();
  await expect(materials).toHaveAttribute("aria-pressed", "true");
  const labels = page.getByRole("button", { name: "Room labels", exact: true });
  await expect(labels).toHaveAttribute("aria-pressed", "true");
  const labelled = await canvas.screenshot();
  await labels.click();
  await expect(labels).toHaveAttribute("aria-pressed", "false");
  expect((await canvas.screenshot()).equals(labelled)).toBe(false);
  await labels.click();

  await page.getByRole("button", { name: "Top view", exact: true }).click();
  expect((await canvas.screenshot()).equals(initial)).toBe(false);
  await page.getByRole("button", { name: "Reset view", exact: true }).click();
  await expect(page.locator('[data-view="volume"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Show interior", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Front view", exact: true }).click();
  await testInfo.attach("exterior-front", { body: await canvas.screenshot(), contentType: "image/png" });
  await expect(canvas).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("technical Presentation changes the rendered exterior and returns to an unfurnished interior", async ({ page }, testInfo) => {
  // Software rendering compiles the Presentation shaders independently of the technical controls.
  test.slow();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await openDistribution(page);
  await expect(page.locator('[data-render-mode="3d"]')).toBeVisible();
  const canvas = page.locator(".distribution-scene canvas");
  await expect(canvas).toBeVisible();
  await page.getByRole("button", { name: "Show complete house", exact: true }).click();
  await page.getByRole("button", { name: "Front view", exact: true }).click();
  const exterior = await canvas.screenshot();
  const presentation = page.getByRole("button", { name: "Presentation", exact: true });
  await expect(presentation).toHaveAttribute("aria-pressed", "false");
  await presentation.click();
  await expect(presentation).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-presentation="true"]')).toBeVisible();
  await expect(page.locator(".distribution-scene-wrap")).toHaveAttribute("data-furniture-count", "0");
  const presented = await canvas.screenshot();
  expect(presented.equals(exterior)).toBe(false);
  await testInfo.attach("exterior-presentation", { body: presented, contentType: "image/png" });
  await presentation.click();
  await expect(presentation).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator('[data-presentation="false"]')).toBeVisible();
  await expect(page.locator(".distribution-scene-wrap")).toHaveAttribute("data-furniture-count", "0");
  expect((await canvas.screenshot()).equals(presented)).toBe(false);
  await page.getByRole("button", { name: "Show interior", exact: true }).click();
  await expect(page.locator('[data-view="interior"]')).toBeVisible();
  await expect(canvas).toHaveCount(1);
  expect(errors).toEqual([]);
});

for (const initialMaterials of [true, false]) {
  test(`technical Presentation materials ${initialMaterials ? "on to off" : "off to on"} render distinct unfurnished views`, async ({ page }, testInfo) => {
    // Limit each case to two Presentation initializations on the software-rendered CI runner.
    test.slow();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1100 });
    await openDistribution(page);
    await expect(page.locator('[data-render-mode="3d"]')).toBeVisible();
    const canvas = page.locator(".distribution-scene canvas");
    await expect(canvas).toBeVisible();
    const materials = page.getByRole("button", { name: "Materials", exact: true });
    await expect(materials).toHaveAttribute("aria-pressed", "true");
    if (!initialMaterials) await materials.click();
    await expect(materials).toHaveAttribute("aria-pressed", String(initialMaterials));
    await page.getByRole("button", { name: "Show complete house", exact: true }).click();
    const presentation = page.getByRole("button", { name: "Presentation", exact: true });
    await expect(presentation).toHaveAttribute("aria-pressed", "false");
    await presentation.click();
    await expect(presentation).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-presentation="true"]')).toBeVisible();
    await expect(page.locator(".distribution-scene-wrap")).toHaveAttribute("data-furniture-count", "0");
    const presented = await canvas.screenshot();
    await materials.click();
    await expect(materials).toHaveAttribute("aria-pressed", String(!initialMaterials));
    await expect(presentation).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-presentation="true"]')).toBeVisible();
    await expect(page.locator(".distribution-scene-wrap")).toHaveAttribute("data-furniture-count", "0");
    const changed = await canvas.screenshot();
    expect(changed.equals(presented)).toBe(false);
    await testInfo.attach(`presentation-materials-${initialMaterials ? "off" : "on"}`, { body: changed, contentType: "image/png" });
    await expect(canvas).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}

test("room selection, fixture layers and focus preserve fictional model measurements", async ({ page }, testInfo) => {
  const errors: string[] = [];
  const privateRequests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/") && !path.startsWith("/api/usage")) privateRequests.push(path);
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await openDistribution(page);
  await expect(page.locator('[data-render-mode="3d"]')).toBeVisible();
  const canvas = page.locator(".distribution-scene canvas");
  const originalCanvas = await canvas.elementHandle();
  for (const [name, area, extent] of [
    ["Living & dining", "30.00 m²", "6.00 × 5.00 m"],
    ["Guest bedroom", "18.00 m²", "4.50 × 4.00 m"],
    ["Kitchen", "15.00 m²", "3.00 × 5.00 m"],
  ]) {
    await page.locator(".distribution-rooms").getByRole("button", { name: new RegExp(`^${name}`) }).click();
    await expect(page.locator(".distribution-details h3")).toHaveText(name);
    await expect(page.locator(".distribution-metrics")).toContainText(area);
    await expect(page.locator(".distribution-metrics")).toContainText(extent);
    expect(await canvas.evaluate((element, previous) => element === previous, originalCanvas)).toBe(true);
  }
  await page.getByRole("button", { name: "Focus room", exact: true }).click();
  const focused = await canvas.screenshot();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  expect((await canvas.screenshot()).equals(focused)).toBe(false);
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("3D canvas is not visible");
  const dragX = bounds.x + bounds.width / 2, dragY = bounds.y + bounds.height / 2;
  await page.mouse.move(dragX, dragY); await page.mouse.down();
  await page.mouse.move(dragX + 90, dragY + 30, { steps: 8 });
  await page.mouse.move(dragX, dragY, { steps: 8 }); await page.mouse.up();
  await expect(page.locator(".distribution-details h3")).toHaveText("Kitchen");
  await page.getByRole("checkbox", { name: "Switches", exact: true }).check();
  await page.getByRole("checkbox", { name: "Air conditioning", exact: true }).check();
  await expect(page.locator(".distribution-details h3")).toHaveText("Kitchen");
  await page.getByRole("checkbox", { name: "Dimensions", exact: true }).check();
  await expect(page.locator(".distribution-dimension-summary")).toContainText("3.00 × 5.00 m");
  await page.getByRole("button", { name: "Roof", exact: true }).click();
  await expect(page.locator(".distribution-dimension-summary")).toContainText("12.80 × 10.80 m");
  await page.getByRole("button", { name: "Entire property", exact: true }).click();
  await expect(page.locator(".distribution-details")).toContainText("336.00 m²");
  await expect(page.locator(".distribution-dimension-summary")).toContainText("16.00 × 21.00 m");
  await testInfo.attach("property-dimensions", { body: await canvas.screenshot(), contentType: "image/png" });
  expect(errors).toEqual([]);
  expect(privateRequests).toEqual([]);
});

test.describe("mobile demo viewer", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("keeps actual 3D controls reachable and room inspection usable by touch", async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await openDistribution(page);
    await expect(page.locator('[data-render-mode="3d"]')).toBeVisible();
    const canvas = page.locator(".distribution-scene canvas");
    await expect(canvas).toBeVisible();
    await page.getByRole("button", { name: "Top view", exact: true }).tap();
    await testInfo.attach("mobile-top-view", { body: await canvas.screenshot(), contentType: "image/png" });
    await page.locator(".distribution-rooms").getByRole("button", { name: /^Primary bedroom/ }).tap();
    await expect(page.locator(".distribution-details h3")).toHaveText("Primary bedroom");
    await expect(page.locator(".distribution-metrics")).toContainText("18.00 m²");
    await page.getByRole("button", { name: "Focus room", exact: true }).tap();
    await page.getByRole("button", { name: "Show complete house", exact: true }).tap();
    await page.getByRole("button", { name: "Front view", exact: true }).tap();
    await expect(page.getByRole("button", { name: "Show interior", exact: true })).toBeVisible();
    await page.locator(".mobile-workspace-nav").getByRole("button", { name: "Sections", exact: true }).click();
    await page.getByRole("dialog", { name: "Sections", exact: true }).getByRole("button", { name: "ES", exact: true }).click();
    const camera = await page.locator(".distribution-camera").boundingBox();
    const appearance = await page.locator(".distribution-display").boundingBox();
    expect(camera).not.toBeNull(); expect(appearance).not.toBeNull();
    expect(camera!.y + camera!.height).toBeLessThanOrEqual(appearance!.y);
    await page.screenshot({ path: testInfo.outputPath("mobile-volume.png"), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(errors).toEqual([]);
  });
});
