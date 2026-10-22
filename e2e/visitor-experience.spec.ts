import { expect, test, type Locator, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import type { Server } from "node:http";
import { resolve } from "node:path";

type VisitorFixture = { server: Server; address: string; projectId: string; mutations: { method: string; path: string }[] };
const { createVisitorFixture } = createRequire(resolve(process.cwd(), "e2e/visitor-experience.spec.ts"))("./fixtures/visitor-house.cjs") as {
  createVisitorFixture: () => Promise<VisitorFixture>;
};
let fixture: VisitorFixture;
const labels = { aesthetics: "Ver diseño y referencias", distribution: "Explorar la casa en 3D", documents: "Ver planos y documentos" };
const overviewEntry = (page: Page, label: string) => page.getByRole("button", { name: new RegExp(`^${label}`) });
test.beforeAll(async () => { fixture = await createVisitorFixture(); });
test.afterAll(async () => {
  if (fixture) { fixture.server.closeAllConnections(); await new Promise<void>(done => fixture.server.close(() => done())); }
});

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
}
async function touchPan(page: Page, target: Locator) {
  await target.evaluate(element => element.scrollIntoView({ block: "center" }));
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  const x = Math.round(box!.x + box!.width * 0.45), y = Math.round(Math.min(box!.y + box!.height * 0.6, page.viewportSize()!.height - 110));
  expect(await target.evaluate((element, point) => element.contains(document.elementFromPoint(point.x, point.y)), { x, y })).toBe(true);
  const before = await page.evaluate(() => scrollY);
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 0 }] });
  try {
    for (let step = 1; step <= 8; step++) {
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - step * 15, id: 0 }] });
      await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => done())));
    }
  } finally { await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await session.detach(); }
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before + 35);
}

test.describe("read-only house presentation", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test.skip(({ browserName }) => browserName !== "chromium", "Touch regression uses Chromium CDP.");

  test("a visitor can explore the house photos, shared plans and real 3D without editing controls", async ({ page }) => {
    const errors: string[] = [];
    const mutations: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => {
      if (request.method() !== "GET" && new URL(request.url()).pathname.startsWith("/api/") && !request.url().includes("/api/usage/events")) mutations.push(request.url());
    });
    await page.goto(`${fixture.address}/projects/${fixture.projectId}/overview`);
    await expect(page.getByRole("button", { name: /Seleccionar fotos|Seleccionar notas/ })).toHaveCount(0);
    for (const label of Object.values(labels)) await expect(overviewEntry(page, label)).toBeVisible();
    const navigation = page.getByRole("navigation", { name: "Secciones del proyecto", exact: true });
    for (const name of ["Resumen", "Documentos", "Estética", "Distribución 3D"]) await expect(navigation.getByRole("button", { name, exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "Fachada prevista", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Foto siguiente", exact: true }).tap();
    await expect(page.getByRole("img", { name: "Luz y materiales de referencia", exact: true })).toBeVisible();

    await overviewEntry(page, labels.aesthetics).tap();
    await expect(page).toHaveURL(new RegExp(`/aesthetics$`));
    const card = page.locator(".aesthetic-grid article").nth(4);
    await touchPan(page, card.locator(".aesthetic-grid-image"));
    await card.locator(".aesthetic-grid-image").tap();
    await expect(page.getByRole("dialog", { name: "Vista de la casa 05", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cerrar imagen", exact: true }).tap();
    await touchPan(page, card.locator(".aesthetic-grid-image"));
    await expect(page.getByRole("button", { name: /Nueva carpeta|Subir imágenes|Seleccionar fotos/ })).toHaveCount(0);

    await navigation.getByRole("button", { name: "Resumen", exact: true }).tap();
    await overviewEntry(page, labels.documents).tap();
    await expect(page).toHaveURL(new RegExp(`/documents$`));
    await expect(page.getByRole("button", { name: /Subir archivos/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Abrir Planos compartidos", exact: true }).tap();
    await expect(page.getByRole("combobox", { name: /^Carpeta de / })).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: /en cotizaciones/ })).toHaveCount(0);
    await expect(page.locator(".quote-reference-document-toggle")).toHaveCount(0);
    await expect(page.locator(".doc-row .doc-folder-name").first()).toHaveText("Planos compartidos");
    await page.getByRole("button", { name: "Vista previa de Plano general.svg", exact: true }).tap();
    const preview = page.getByRole("dialog", { name: "Vista previa de Plano general.svg", exact: true });
    await expect(preview).toBeVisible();
    await preview.getByRole("button", { name: "Cerrar vista previa", exact: true }).tap();
    await expect(preview).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
    await touchPan(page, page.locator(".doc-row").nth(4).locator(".doc-preview-trigger"));

    await navigation.getByRole("button", { name: "Resumen", exact: true }).tap();
    await overviewEntry(page, labels.distribution).tap();
    await expect(page).toHaveURL(new RegExp(`/distribution$`));
    await expect(page.locator(".distribution-scene canvas")).toBeVisible();
    await expect(page.getByText("Corregir datos del espacio", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: /^Sala de la casa/ }).tap();
    await expect(page.locator(".distribution-details")).toContainText("Sala de la casa");
    await expectNoHorizontalOverflow(page);
    expect(mutations).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("the overview and navigation hide 3D while the model is not prepared", async ({ page }) => {
    await page.route("**/api/house-distribution?status=1", route => route.fulfill({ json: { ready: false } }));
    await page.goto(`${fixture.address}/projects/${fixture.projectId}/overview`);
    await expect(overviewEntry(page, labels.aesthetics)).toBeVisible();
    await expect(overviewEntry(page, labels.documents)).toBeVisible();
    await expect(overviewEntry(page, labels.distribution)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Distribución 3D", exact: true })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test("restricted readers receive no entry or resource fetch for unauthorized sections", async ({ page }) => {
    const resourceRequests: string[] = [];
    page.on("request", request => {
      const path = new URL(request.url()).pathname;
      if (["/api/aesthetics", "/api/house-distribution", "/api/files", "/api/folders"].includes(path)) resourceRequests.push(path);
    });
    await page.goto(`${fixture.address}/projects/${fixture.projectId}/overview?deny=documents,aesthetics,distribution`);
    await expect(page.getByRole("heading", { name: "Medidas de la casa", exact: true })).toBeVisible();
    for (const label of Object.values(labels)) await expect(overviewEntry(page, label)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Fotos de la casa", exact: true })).toHaveCount(0);
    const navigation = page.getByRole("navigation", { name: "Secciones del proyecto", exact: true });
    for (const name of ["Documentos", "Estética", "Distribución 3D"]) await expect(navigation.getByRole("button", { name, exact: true })).toHaveCount(0);
    expect(resourceRequests).toEqual([]);
    await expectNoHorizontalOverflow(page);
  });

  test("a visitor recognizes planned design and inspiration while swiping the overview without losing page scroll", async ({ page }) => {
    await page.goto(`${fixture.address}/projects/${fixture.projectId}/overview`);
    await expect(page.locator(".overview-photo-classification")).toHaveText("Diseño previsto");
    const stage = page.locator(".overview-photo-stage");
    await expect(stage).toHaveCSS("touch-action", "pan-y pinch-zoom");
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    const x = Math.round(box!.x + box!.width * 0.7), y = Math.round(box!.y + box!.height * 0.5);
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 0 }] });
    try {
      for (let step = 1; step <= 8; step++) {
        await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - step * 13, y, id: 0 }] });
        await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => done())));
      }
    } finally { await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await session.detach(); }
    await expect(page.locator(".overview-photo-classification")).toHaveText("Referencia de inspiración");
    await expect(page.getByRole("img", { name: "Luz y materiales de referencia", exact: true })).toBeVisible();
    await touchPan(page, stage);
    await expect(page.locator(".overview-photo-classification")).toHaveText("Referencia de inspiración");
    await expectNoHorizontalOverflow(page);
  });

  test("the complete house opens first and optional installations reset with the mobile view", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${fixture.address}/projects/${fixture.projectId}/distribution`);
    const canvas = page.locator(".distribution-scene canvas");
    await expect(canvas).toBeVisible();
    await expect(page.getByRole("button", { name: "Ver interior", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Fachada", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Vista de cochera", exact: true })).toBeVisible();
    await expect(canvas).toHaveCSS("touch-action", "pan-y pinch-zoom");
    await touchPan(page, canvas);
    const technical = page.locator(".distribution-technical");
    await expect(technical).toHaveJSProperty("open", false);
    await technical.locator("summary").tap();
    for (const name of ["Tomacorrientes", "Luces", "Apagadores", "Aire acondicionado", "Medidas"]) await expect(technical.getByRole("checkbox", { name, exact: true })).not.toBeChecked();
    await technical.getByRole("checkbox", { name: "Luces", exact: true }).check();
    await expect(technical.locator("summary")).toContainText("1 capa visible");
    await technical.getByRole("checkbox", { name: "Tomacorrientes", exact: true }).check();
    await expect(technical.locator("summary")).toContainText("2 capas visibles");
    await page.getByRole("button", { name: "Ver interior", exact: true }).tap();
    await expect(page.getByRole("button", { name: "Ver casa completa", exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^Sala de la casa/ }).tap();
    await expect(page.locator(".distribution-details")).toContainText("Tomacorrientes");
    await page.getByRole("button", { name: "Interactuar con el modelo", exact: true }).tap();
    await expect(canvas).toHaveCSS("touch-action", "none");
    await page.getByRole("button", { name: "Restablecer vista", exact: true }).tap();
    await expect(page.getByRole("button", { name: "Ver interior", exact: true })).toBeVisible();
    await expect(canvas).toHaveCSS("touch-action", "pan-y pinch-zoom");
    await expect(page.getByRole("button", { name: "Vista de cochera", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Explora sus espacios", exact: true })).toBeVisible();
    for (const name of ["Tomacorrientes", "Luces"]) await expect(technical.getByRole("checkbox", { name, exact: true })).not.toBeChecked();
    await touchPan(page, canvas);
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
});
