import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { mkdir, readFile } from "node:fs/promises";

let server: Server, address: string;
const runtimeErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { const errors: string[] = []; runtimeErrors.set(page, errors); page.on("pageerror", error => errors.push(error.message)); });
test.afterEach(({ page }) => { expect(runtimeErrors.get(page)).toEqual([]); });
const longName = "SupervisiónDeConstrucción".repeat(5);
const date = "2026-10-05T12:00:00Z";
const notes = Array.from({ length: 8 }, (_, index) => ({ id: `note-${index}`, title: `${longName} ${index + 1}`, content: "Confirmar las medidas y materiales antes de instalar. ".repeat(12), aiEnabled: false, createdBy: "QA", updatedBy: "QA", createdAt: date, updatedAt: date }));
const purchase = { id: "purchase-1", title: longName, amount: 1200000, currency: "CRC", vendor: "Proveedor de acabados", reference: "Referencia", notes: "Confirmar antes de instalar.", purchaseDate: "2026-10-05", budgetLineId: "line-1", budgetLineLabel: longName, outsideObjective: false, coverPhotoId: "photo-1", photos: [{ id: "photo-1", name: "Producto.png", contentType: "image/png", size: 1024, previewUrl: "/broken.png", thumbnailUrl: "/broken.png", downloadUrl: "/broken.png" }], createdAt: date, updatedAt: date };
const line = { id: "line-1", row: 4, chapter: "Acabados", item: longName, supplier: "Proveedor", paid: 200000, objective: 1000000, quote: 1200000, excess: 0, type: "Construcción", subcategory: "Interior", status: "Pendiente" };

test.beforeAll(async () => {
  const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import Capture from './app/components/MobileCapture';import Assistant from './app/components/AssistantPanel';import Notes from './app/components/NotesWorkspace';import Expenses from './app/components/ExpensesWorkspace';const view=location.pathname.slice(1);createRoot(document.getElementById('root')).render(<main className="content">{view==='notes'?<Notes language="es" canEdit={true}/>:view==='expenses'?<Expenses language="es" mode="real" isOwner={true}/>:<><h1>Herramientas móviles</h1><div style={{height:900}}>Contenido del proyecto</div>{view==='assistant'?<Assistant language="es" role="admin" canBudget={true} canDocuments={true} canNotes={true} onOpenBudget={()=>{document.body.dataset.budget='opened'}}/>:<Capture language="es" userEmail="qa@example.test" activeProjectId="project-1" activeProjectName="QA móvil" projects={[{id:'project-1',name:'QA móvil',kind:'shared',role:'admin',active:true}]} destinations={{expense:true,site_issue:true,decision:true}} onProjectChange={()=>{}} onCompleted={()=>{}}/>}</>}</main>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, outfile: "tools.js", platform: "browser", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "tools-image", setup(builder) { builder.onResolve({ filter: /^next\/image$/ }, args => ({ path: args.path, namespace: "tools-image" })); builder.onLoad({ filter: /.*/, namespace: "tools-image" }, () => ({ contents: "import React from 'react';export default function Image({fill,priority,...props}){return <img {...props}/>} ", loader: "tsx", resolveDir: process.cwd() })); } }] });
  const css = await readFile("app/globals.css", "utf8") + (bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text || "");
  server = createServer((request, response) => {
    if (request.url === "/tools.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text); }
    else { response.setHeader("content-type", "text/html"); response.end(`<!doctype html><html style="--font-geist-sans:Arial;--font-geist-mono:monospace"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{--workspace-topbar-height:0px}.content{padding:16px}</style><div id="root"></div><script src="/tools.js"></script></html>`); }
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done)); address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  await mkdir("test-results/mobile-audit", { recursive: true });
});
test.afterAll(async () => { if (server) await new Promise<void>(done => server.close(() => done())); });

async function mockTools(page: Page) {
  await page.route("**/broken.png", route => route.fulfill({ status: 500, body: "Synthetic photo error" }));
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    const responses: Record<string, unknown> = { "/api/notes": { notes }, "/api/expenses": { expenses: [], budgetLines: [line], summary: { total: 200000 } }, "/api/expenses/purchases": { purchases: [purchase] }, "/api/expenses/documents": { documents: [], purchases: [purchase] }, "/api/expenses/payments": { payments: [], completedLineIds: [] }, "/api/site-issues": { issues: [{ id: "issue-1", title: "Revisión de obra", category: "inspection", status: "open" }] }, "/api/decisions": { decisions: [{ id: "decision-1", title: "Acabados", status: "open" }] }, "/api/assistant/conversations": { conversations: [] } };
    return route.fulfill({ json: responses[path] || {} });
  });
}
async function physicalBounds(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 1); }
async function focusIsInside(page: Page) { expect(await page.getByRole("dialog").evaluate(element => element.contains(document.activeElement))).toBe(true); }

test.describe("mobile tools and content", () => {
  test.use({ isMobile: true, hasTouch: true });
  for (const viewport of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    test(`notes edit from the last card reveals and focuses the form at ${viewport.width}`, async ({ page, browserName }) => {
      test.skip(browserName !== "chromium"); await page.setViewportSize(viewport); await mockTools(page); await page.goto(`${address}/notes`);
      await expect(page.locator(".notes-card")).toHaveCount(8); await page.locator(".notes-card").last().getByRole("button", { name: "Editar", exact: true }).click();
      const title = page.getByLabel("Título", { exact: true }); await expect(title).toHaveValue(`${longName} 8`); await expect(title).toBeFocused(); await expect(title).toBeInViewport(); await expect(title).toHaveCSS("font-size", "16px"); await physicalBounds(page);
      await page.screenshot({ path: `test-results/mobile-audit/populated-${viewport.width}-notes.png` }); await page.getByRole("button", { name: "Cancelar", exact: true }).click(); await expect(page.locator(".notes-form")).toHaveCount(0);
    });

    test(`purchase form and failed photo preview remain dismissible with keyboard-sized space at ${viewport.width}`, async ({ page, browserName }) => {
      test.skip(browserName !== "chromium"); await page.setViewportSize(viewport); await mockTools(page); await page.goto(`${address}/expenses`);
      const trigger = page.getByRole("button", { name: /Nueva compra/ }).first(); await trigger.click(); const form = page.getByRole("dialog", { name: "Compra", exact: true });
      await form.getByText("Más detalles opcionales", { exact: true }).click(); await expect(form.getByLabel("Proveedor", { exact: true })).toHaveCSS("font-size", "16px");
      await page.evaluate(() => { document.documentElement.style.setProperty("--workspace-visible-height", "320px"); document.documentElement.style.setProperty("--workspace-visible-top", "24px"); });
      const surface = await form.locator(".expense-form").boundingBox(); expect(surface!.y).toBeGreaterThanOrEqual(24); expect(surface!.height).toBeLessThanOrEqual(320);
      await form.getByRole("button", { name: "Guardar compra", exact: true }).scrollIntoViewIfNeeded(); await expect(form.getByRole("button", { name: "Guardar compra", exact: true })).toBeInViewport();
      await page.keyboard.press("Escape"); await expect(form).toHaveCount(0); await expect(trigger).toBeFocused(); expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
      await page.evaluate(() => { document.documentElement.style.removeProperty("--workspace-visible-height"); document.documentElement.style.removeProperty("--workspace-visible-top"); });
      await page.locator(".purchase-cover").first().click();
      const detail = page.getByRole("dialog").first(); await expect(detail).toBeVisible();
      await detail.locator(".purchase-carousel button").first().click();
      const preview = page.getByRole("dialog", { name: "Producto.png", exact: true }); await expect(preview).toBeVisible();
      await expect(preview.getByRole("button", { name: /Reintentar/ })).toBeVisible(); await physicalBounds(page);
      await page.screenshot({ path: `test-results/mobile-audit/populated-${viewport.width}-expenses-photo-error.png` });
      await page.keyboard.press("Escape"); await expect(preview).toHaveCount(0); await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0); expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
    });

    test(`assistant keeps focus in its dialog and returns to its launcher at ${viewport.width}`, async ({ page, browserName }) => {
      test.skip(browserName !== "chromium"); await page.setViewportSize(viewport); await mockTools(page); await page.goto(`${address}/assistant`);
      const trigger = page.getByRole("button", { name: "Abrir asistente del proyecto", exact: true }); await trigger.click(); await expect(page.getByRole("dialog")).toBeFocused();
      await page.keyboard.press("Shift+Tab"); await focusIsInside(page); await page.keyboard.press("Tab"); await focusIsInside(page); await physicalBounds(page);
      await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0); await expect(trigger).toBeFocused(); expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
    });

    test(`capture crop retains zoom and image center through rotation and cancels stale drags at ${viewport.width}`, async ({ page, browserName }) => {
      test.skip(browserName !== "chromium"); await page.setViewportSize(viewport); await mockTools(page); await page.goto(`${address}/capture`);
      const trigger = page.getByRole("button", { name: "Nueva captura de obra", exact: true }); await trigger.click(); const dialog = page.getByRole("dialog"); await expect(dialog).toBeFocused(); await page.keyboard.press("Shift+Tab"); await focusIsInside(page); await page.keyboard.press("Tab"); await focusIsInside(page);
      const photo = await page.evaluate(() => { const canvas = document.createElement("canvas"); canvas.width = 1200; canvas.height = 900; const context = canvas.getContext("2d")!; context.fillStyle = "#548b69"; context.fillRect(0, 0, 1200, 900); context.fillStyle = "#ffffff"; context.fillRect(500, 350, 200, 200); return canvas.toDataURL("image/png").split(",")[1]; });
      await dialog.locator('input[type="file"][accept="image/*"]').setInputFiles({ name: "crop.png", mimeType: "image/png", buffer: Buffer.from(photo, "base64") });
      const crop = dialog.locator(".capture-crop-viewport"); const image = crop.locator("img"); await expect(image).toBeVisible(); await dialog.getByLabel("Zoom", { exact: true }).fill("2");
      const center = async () => crop.evaluate(element => { const image = element.querySelector("img")!; const container = element.getBoundingClientRect(), box = image.getBoundingClientRect(); return { x: (container.x + container.width / 2 - box.x) / box.width, y: (container.y + container.height / 2 - box.y) / box.height, covers: box.width >= container.width && box.height >= container.height }; });
      const before = await center(); await page.setViewportSize(viewport.width === 844 ? { width: 390, height: 844 } : { width: 844, height: 390 });
      await expect(dialog.getByLabel("Zoom", { exact: true })).toHaveValue("2"); await expect.poll(async () => (await center()).covers).toBe(true); const after = await center(); expect(after.x).toBeCloseTo(before.x, 2); expect(after.y).toBeCloseTo(before.y, 2);
      const transform = await image.evaluate(element => element.style.transform);
      await crop.scrollIntoViewIfNeeded(); const cropBox = await crop.boundingBox(); const x = cropBox!.x + cropBox!.width / 2, y = cropBox!.y + cropBox!.height / 2;
      await page.mouse.move(x, y); await page.mouse.down(); await crop.dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse" }); await page.mouse.move(x + 20, y + 15); await page.mouse.up(); expect(await image.evaluate(element => element.style.transform)).toBe(transform);
      await physicalBounds(page); await page.screenshot({ path: `test-results/mobile-audit/populated-${viewport.width}-capture-rotated.png` }); await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused(); expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
    });

    test(`private entry and back reveal the start of the correct screen at ${viewport.width}`, async ({ page, browserName }) => {
      test.skip(browserName !== "chromium"); await page.setViewportSize(viewport); await page.addInitScript(() => localStorage.setItem("house-planner-language", "es"));
      await page.goto("/"); await page.locator(".real-entry").click();
      await expect(page.locator(".credentials-panel h1")).toHaveText("Bienvenido de nuevo."); await expect.poll(() => page.evaluate(() => scrollY)).toBe(0); await expect(page.locator(".credentials-panel h1")).toBeInViewport(); await expect(page.getByLabel("Correo", { exact: true })).toHaveCSS("font-size", "16px"); await physicalBounds(page);
      await page.getByRole("button", { name: "Volver", exact: true }).click(); await expect(page.locator(".unified-entry h1")).toBeVisible(); await expect.poll(() => page.evaluate(() => scrollY)).toBe(0); await expect(page.locator(".unified-entry h1")).toBeInViewport(); await physicalBounds(page);
    });
  }
});
