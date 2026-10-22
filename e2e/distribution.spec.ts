import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { DistributionRecord, DistributionRequest, BuildingFace } from "../lib/house-distribution";
import { modelSources } from "../lib/house-distribution";
import JSZip from "jszip";
import { expectDistributionExportImages } from "./distribution-export-assertions";
let server: Server, url: string, temp: string, seed: DistributionRecord;
async function openTechnicalDetails(page: Page) {
  const details = page.locator(".distribution-technical");
  await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");
}
test.beforeAll(async () => {
  temp = await mkdtemp(join(tmpdir(), "distribution-browser-"));
  const path = join(temp, "model.json"); execFileSync(process.execPath, ["scripts/prepare-demo-house.mjs", path, "blueprint"]);
  seed = { model: JSON.parse(await readFile(path, "utf8")), revision: 1, roomCorrections: {}, fixtureCorrections: {}, updatedAt: "2026-09-08" };
  // Browser-only synthetic additions exercise property, support and quantity rendering.
  const source = seed.model.rooms[0].source;
  seed.model.surfaces!.push({ id: "demo-property", kind: "property", polygon: [[-6, -4], [14, -4], [14, 26], [-6, 26]], source, notes: "Invented property; no client plan.", measurements: [] });
  seed.model.surfaces![0].measurements.push({ value: 48.24, status: "approximate", source, note: "Invented roof quantity for browser regression.", label: { en: "Estimated sloped roof area", es: "Área inclinada estimada del techo" }, unit: "m²" });
  const supportFaces: BuildingFace[] = [];
  for (let index = 1; index <= 4; index++) {
    const x = index * 1.5, y = -.8;
    supportFaces.push(
      { id: `demo-post-${index}-front`, kind: "wall", vertices: [[x, y, 0], [x + .3, y, 0], [x + .3, y, 3]] },
      { id: `demo-post-${index}-side`, kind: "wall", vertices: [[x, y, 0], [x, y + .3, 0], [x, y + .3, 3]] },
    );
  }
  seed.model.envelope!.faces.push(...supportFaces);
  const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import Workspace from './app/components/DistributionWorkspace';import Admin from './app/components/DistributionAdmin';const params=new URLSearchParams(location.search);const language=params.get('lang')==='es'?'es':'en';createRoot(document.getElementById('root')).render(params.has('admin')?<Admin language={language} documents={[{id:'latest-blueprint',name:'Plans.pdf',contentType:'application/pdf'}]} onReady={()=>document.body.dataset.ready='true'}/>:<Workspace language={language} canEdit={!params.has('viewer')}/>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, outfile: join(temp, "bundle.js"), platform: "browser", define: { "process.env.NODE_ENV": '"production"' } });
  const script = bundle.outputFiles.find(file => file.path.endsWith(".js"));
  if (!script) throw new Error("Distribution browser bundle did not emit JavaScript");
  const emittedCss = bundle.outputFiles.filter(file => file.path.endsWith(".css")).map(file => file.text).join("\n");
  const css = `${await readFile("app/components/distribution.css", "utf8")}\n${emittedCss}`;
  server = createServer((req, res) => { if (req.url === "/bundle.js") { res.setHeader("content-type", "text/javascript"); res.end(script.text); } else { res.setHeader("content-type", "text/html"); res.end(`<html><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{--forest:#214f3d;--line:#e3e6e2;--muted:#748079;--ink:#1d2924}*{box-sizing:border-box}body{margin:0;padding:24px;background:#f5f6f3;color:#1d2924;font-family:Arial}button,input,textarea,select{font:inherit}${css}</style><div id="root"></div><script src="/bundle.js"></script></html>`); } });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done)); url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  await mkdir("outputs/house-distribution", { recursive: true });
});
test.afterAll(async () => {
  if (server?.listening) await new Promise<void>(done => server.close(() => done()));
  if (temp && (resolve(temp).startsWith(resolve(tmpdir()) + "\\") || resolve(temp).startsWith(resolve(tmpdir()) + "/"))) await rm(temp, { recursive: true, force: true });
});
test.beforeEach(async ({ page }) => {
  let record = structuredClone(seed);
  let request: DistributionRequest | null = null;
  await page.route("**/api/house-distribution**", async route => {
    const req = route.request(), address = new URL(req.url());
    if (address.pathname.endsWith("/requests")) {
      if (req.method() === "POST") request ||= { status: "requested", sourceDocumentIds: req.postDataJSON().sourceDocumentIds, notes: "", preparationNotes: "", revision: 1, updatedAt: "" };
      if (req.method() === "PATCH") request = { ...request!, status: "in_preparation", preparationNotes: req.postDataJSON().preparationNotes, revision: 2 };
      return route.fulfill({ json: { request } });
    }
    if (address.searchParams.has("status")) return route.fulfill({ json: { ready: request?.status === "ready", revision: 0 } });
    if (req.method() === "POST") { record = { ...record, model: req.postDataJSON().model }; request = { status: "ready", sourceDocumentIds: record.model.sourceDocumentIds, notes: "", preparationNotes: "", revision: 3, updatedAt: "" }; }
    if (req.method() === "PATCH") { const body = req.postDataJSON(); record = { ...record, revision: record.revision + 1, roomCorrections: { ...record.roomCorrections, [body.id]: body.correction } }; }
    return route.fulfill({ json: { record } });
  });
});

test.describe("touch model navigation", () => {
  test.use({ isMobile: true, hasTouch: true });
  for (const viewport of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    test(`page scrolling remains available over the model until interaction is enabled at ${viewport.width}`, async ({ page, browserName }, testInfo) => {
      test.skip(browserName !== "chromium"); await page.setViewportSize(viewport);
      await page.goto(`${url}?lang=es&viewer=1`);
      const canvas = page.locator(".distribution-scene canvas"); await expect(canvas).toBeVisible();
      await expect(canvas).toHaveCSS("touch-action", "pan-y pinch-zoom");
      const panCanvas = async () => {
        await canvas.evaluate(element => element.scrollIntoView({ block: "center" }));
        const box = await canvas.boundingBox();
        const x = Math.round(box!.x + box!.width * .45), y = Math.round(Math.min(box!.y + box!.height * .6, viewport.height - 55));
        const before = await page.evaluate(() => scrollY); const session = await page.context().newCDPSession(page);
        await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 0 }] });
        for (let step = 1; step <= 8; step++) { await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - step * 12, id: 0 }] }); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve))); }
        await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await session.detach();
        return before;
      };
      const before = await panCanvas(); await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before + 30);
      await page.getByRole("button", { name: "Interactuar con el modelo", exact: true }).click(); await expect(canvas).toHaveCSS("touch-action", "none");
      const interacting = await panCanvas(); await expect.poll(() => page.evaluate(() => scrollY)).toBe(interacting);
      await page.getByRole("button", { name: "Volver a desplazar la página", exact: true }).click();
      await expect(canvas).toHaveCSS("touch-action", "pan-y pinch-zoom"); const restored = await panCanvas(); await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(restored + 30);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
      await page.screenshot({ path: testInfo.outputPath(`distribution-touch-${viewport.width}.png`) });
    });
  }
});

test("exports the latest saved complete model for Codex even with hidden layers and read-only access", async ({ page }) => {
  let reads = 0;
  const latest = structuredClone(seed);
  latest.revision = 9;
  latest.roomCorrections.office = { name: "Oficina para diseñar" };
  latest.fixtureCorrections[latest.model.fixtures[0].id] = { removed: true };
  await page.route("**/api/house-distribution", route => route.fulfill({ json: { record: ++reads === 1 ? seed : latest } }));
  await page.goto(`${url}?lang=es&viewer=1`);
  await expect(page.locator(".distribution-scene canvas")).toBeVisible();
  await openTechnicalDetails(page);
  await expect(page.getByRole("checkbox", { name: "Luces", exact: true })).not.toBeChecked();
  await page.getByRole("checkbox", { name: "Luces", exact: true }).uncheck();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar para Codex", exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("demo-pavilion-interiores-codex-r1.zip");
  const zip = await JSZip.loadAsync(await readFile((await download.path())!));
  const model = JSON.parse(await zip.file("modelo.json")!.async("string"));
  const manifest = await expectDistributionExportImages(zip, latest.revision, true);
  expect(model.rooms).toHaveLength(4);
  expect(model.rooms.filter((r: { sectionHeight?: unknown }) => r.sectionHeight)).toHaveLength(1);
  expect(model.rooms.find((r: { id: string }) => r.id === "office").sectionHeight).toMatchObject({ min: { value: 2.92, status: "approximate" }, max: { value: 3.32, status: "approximate" } });
  expect(model.envelope.roofUnderside).toHaveLength(2);
  expect(model.rooms.find((r: { id: string }) => r.id === "office").name).toBe("Oficina para diseñar");
  expect(model.fixtures.filter((f: { kind: string }) => f.kind === "light")).toHaveLength(4);
  expect(model.fixtures).toHaveLength(7);
  expect(model.fixtures.find((f: { id: string }) => f.id === "ceiling-light").mount).toBe("ceiling");
  expect(model.fixtures.some((f: { id: string }) => f.id === "living-outlet")).toBe(false);
  expect(manifest.recordRevision).toBe(9);
  expect(await zip.file("planta.svg")!.async("string")).toContain("Oficina para diseñar");
  expect(reads).toBe(2);
  await expect(page.getByRole("status")).toContainText("Descomprime el ZIP");
  await writeFile("outputs/house-distribution/export-planta.png", await zip.file("imagenes/planta.png")!.async("nodebuffer"));
  await writeFile("outputs/house-distribution/export-vista-3d.png", await zip.file("imagenes/vista-3d.png")!.async("nodebuffer"));
  await page.screenshot({ path: "outputs/house-distribution/export-codex.png", fullPage: true });
  await page.locator(".distribution-scene canvas").dispatchEvent("webglcontextlost");
  await expect(page.getByText("3D no disponible.", { exact: false })).toBeVisible();
  const fallbackPending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar para Codex", exact: true }).click();
  const fallbackDownload = await fallbackPending;
  const fallbackZip = await JSZip.loadAsync(await readFile((await fallbackDownload.path())!));
  await expectDistributionExportImages(fallbackZip, latest.revision, false);
  await expect(page.getByRole("status")).toContainText("captura 3D no estuvo disponible");
});

test("shows section-derived ranges separately from pending finished ceiling heights", async ({ page }) => {
  await page.goto(`${url}?lang=es&viewer=1`);
  await page.getByRole("button", { name: /^Office/ }).click();
  await expect(page.getByRole("region", { name: "Altura bajo cubierta · cortes" })).toContainText("2.92 m");
  await expect(page.getByRole("region", { name: "Altura bajo cubierta · cortes" })).toContainText("3.32 m");
  await expect(page.locator(".distribution-details")).toContainText("Altura bajo cubierta");
  await expect(page.locator(".distribution-details")).toContainText("Sin confirmar");
  await page.getByText("Notas del corte", { exact: true }).click();
  await expect(page.locator(".distribution-details")).toContainText("Synthetic test evidence; no real construction measurement.");
  await page.getByRole("button", { name: "Ver interior", exact: true }).click();
  await page.getByRole("button", { name: "Ver casa completa", exact: true }).click();
  await expect(page.locator(".distribution-hint")).toContainText("Alturas bajo cubierta trazadas");
  await page.screenshot({ path: "outputs/house-distribution/section-heights-office.png", fullPage: true });
});

test("regenerates the synthetic entrance and exports its saved architecture and support footprints", async ({ page }) => {
  await page.goto(`${url}?lang=es&viewer=1`);
  await expect(page.locator(".distribution-scene canvas")).toBeVisible();
  await expect(page.getByRole("button",{name:"Ver interior",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Fachada",exact:true}).click();
  await openTechnicalDetails(page);
  const pending=page.waitForEvent("download");
  await page.getByRole("button",{name:"Exportar para Codex",exact:true}).click();
  const download=await pending;
  const zip=await JSZip.loadAsync(await readFile((await download.path())!));
  const manifest=await expectDistributionExportImages(zip,seed.revision,true);
  const model=JSON.parse(await zip.file("modelo.json")!.async("string"));
  expect(model).toEqual(seed.model);
  expect(manifest.counts).toMatchObject({rooms:4,walls:5,openings:3,fixtures:8});
  const plan=await zip.file("planta.svg")!.async("string");
  expect(plan.match(/data-support-id="demo-post-/g)).toHaveLength(4);
  expect(plan).toContain('data-opening-id="entry"');
  expect(plan).toContain('data-opening-id="shared-door"');
  expect(model.openings.find((o:{id:string})=>o.id==="entry").wallId).toBe("front");
  const measurements=JSON.parse(await zip.file("medidas.json")!.async("string"));
  expect(measurements.measurements.filter((m:{entityType:string;entityId:string;measurement:string})=>m.entityType==="support"&&/^default:demo-post-/.test(m.entityId)&&m.measurement==="displayWidth")).toHaveLength(4);
  await writeFile("outputs/house-distribution/entry-plan-corrections.png",await zip.file("imagenes/vista-3d.png")!.async("nodebuffer"));
  await page.screenshot({path:"outputs/house-distribution/entry-plan-corrections-ui.png",fullPage:true});
});

test("rechecks source access on export and handles unavailable models without a download", async ({ page }) => {
  await page.goto(`${url}?lang=es&viewer=1`);
  await openTechnicalDetails(page);
  const button = page.getByRole("button", { name: "Exportar para Codex", exact: true });
  await expect(button).toBeVisible();
  let downloads = 0; page.on("download", () => downloads++);
  await page.route("**/api/house-distribution", route => route.fulfill({ status: 403, json: { error: "Blueprint access denied" } }));
  await button.click();
  await expect(page.getByRole("alert")).toContainText("No se pudo exportar");
  await expect(button).toBeEnabled();
  expect(downloads).toBe(0);
  await page.route("**/api/house-distribution", route => route.fulfill({ json: { record: null } }));
  await button.click();
  await expect(page.getByRole("alert")).toContainText("No se pudo exportar");
  expect(downloads).toBe(0);
});
test("desktop cutaway, room inventory, layers and corrections", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1100 }); await page.goto(url);
  await expect(page.locator("canvas")).toBeVisible();
  await page.getByRole("button", { name: "Show interior", exact: true }).click();
  const canvas = page.locator("canvas"), bounds = await canvas.boundingBox();
  await canvas.click({ position: { x: bounds!.width * .5, y: bounds!.height * .55 } });
  await expect(page.locator(".distribution-details h3")).toBeVisible();
  await page.mouse.move(bounds!.x + bounds!.width * .5, bounds!.y + bounds!.height * .5);
  await page.mouse.down(); await page.mouse.move(bounds!.x + bounds!.width * .6, bounds!.y + bounds!.height * .55, { steps: 5 }); await page.mouse.up();
  await page.getByRole("button", { name: /^Living room ≈/ }).click();
  await expect(page.locator(".distribution-details h3")).toHaveText("Living room");
  await page.getByText("Room installations", { exact: true }).click();
  await expect(page.locator(".distribution-counts strong")).toHaveText(["1", "1", "1+", "—"]);
  await expect(page.locator(".distribution-fixtures button")).toHaveCount(3);
  await openTechnicalDetails(page);
  await page.getByRole("checkbox", { name: "Dimensions", exact: true }).check();
  await page.getByRole("button", { name: "Top view" }).click();
  await page.getByRole("button", { name: "Reset view" }).click();
  await expect(page.locator(".distribution-dimension-summary")).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Dimensions", exact: true })).not.toBeChecked();
  await page.screenshot({ path: "outputs/house-distribution/desktop.png", fullPage: true });
  await page.getByRole("button", { name: /^Living room ≈/ }).click();
  await page.getByText("Correct room details", { exact: true }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Sala familiar");
  await page.getByRole("button", { name: "Save correction", exact: true }).click();
  await expect(page.locator(".distribution-details h3")).toHaveText("Sala familiar");
  expect(errors).toEqual([]);
});

test("dimensions work without selection and roof/property views show distinct measurements", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 }); await page.goto(`${url}?lang=es`);
  await expect(page.locator("canvas")).toBeVisible();
  await openTechnicalDetails(page);
  const before = await page.locator("canvas").screenshot();
  await page.getByRole("checkbox", { name: "Medidas", exact: true }).check();
  await expect(page.locator(".distribution-dimension-summary")).toContainText("8.00 × 6.00 m");
  const after = await page.locator("canvas").screenshot();
  expect(after.equals(before)).toBe(false);
  await page.getByRole("checkbox", { name: "Medidas", exact: true }).uncheck();
  await expect(page.locator(".distribution-dimension-summary")).toHaveCount(0);
  await page.getByRole("button", { name: "Techo", exact: true }).click();
  await expect(page.locator(".distribution-details")).toContainText("Área de proyección horizontal");
  await expect(page.locator(".distribution-details")).toContainText("Área inclinada estimada del techo");
  await expect(page.locator(".distribution-dimension-summary")).toContainText("8.00 × 6.00 m");
  await page.screenshot({ path: "outputs/house-distribution/roof.png", fullPage: true });
  await page.getByRole("button", { name: "Terreno completo", exact: true }).click();
  await expect(page.locator(".distribution-dimension-summary")).toContainText("20.00 × 30.00 m");
  await expect(page.locator(".distribution-details")).toContainText("600.00 m²");
  await page.screenshot({ path: "outputs/house-distribution/property.png", fullPage: true });
  await page.getByRole("button", { name: "Casa", exact: true }).click();
  await page.getByRole("button", { name: /^Terrace/ }).click();
  await expect(page.locator(".distribution-details h3")).toHaveText("Terrace");
  await expect(page.locator(".distribution-dimension-summary")).toContainText("3.00 × 6.00 m");
  await page.getByRole("checkbox", { name: "Aire acondicionado", exact: true }).check();
  await page.getByRole("button", { name: "Vista superior", exact: true }).click();
  await page.screenshot({ path: "outputs/house-distribution/tracks-ac.png", fullPage: true });
});
test("section volume preserves interior navigation and exposes synthetic reference levels", async ({ page }) => {
  const carport = structuredClone(seed);
  const terrace = carport.model.rooms.find(room => room.id === "terrace")!;
  terrace.id = "carport"; terrace.name = "Cochera demo"; terrace.notes = "Invented carport for browser regression.";
  for (let index = 1; index <= 4; index++) {
    const light = structuredClone(carport.model.fixtures.find(fixture => fixture.id === "ceiling-light")!);
    light.id = `carport-light-${index}`; light.roomId = "carport"; light.type = "Luz aérea de cochera demo";
    light.position = [-1.5, index]; carport.model.fixtures.push(light);
  }
  await page.route("**/api/house-distribution", route => route.fulfill({ json: { record: carport } }));
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1100 }); await page.goto(`${url}?lang=es`);
  await expect(page.locator("canvas")).toBeVisible();
  await page.getByRole("button", { name: "Ver interior", exact: true }).click();
  const interior = await page.locator("canvas").screenshot();
  await page.getByRole("button", { name: "Ver casa completa", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ver interior", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Restablecer vista", exact: true }).click();
  expect((await page.locator("canvas").screenshot()).equals(interior)).toBe(false);
  await page.screenshot({ path: "outputs/house-distribution/volume-synthetic.png", fullPage: true });
  await openTechnicalDetails(page);
  await page.getByRole("checkbox", { name: "Luces", exact: true }).check();
  await page.getByRole("button",{name:"Fachada",exact:true}).click();
  await page.screenshot({path:"outputs/house-distribution/entry-lintel-mounted-lights.png",fullPage:true});
  await page.getByRole("button",{name:/^Cochera/}).click();
  await expect(page.locator(".distribution-details h3")).toHaveText("Cochera demo");
  await expect(page.locator(".distribution-details")).toContainText("3.00 × 6.00 m");
  await expect(page.locator(".distribution-details")).toContainText("Invented carport for browser regression.");
  await page.getByText("Instalaciones del espacio", { exact: true }).click();
  await expect(page.locator(".distribution-fixtures").getByRole("button", { name: /Luz aérea de cochera/ })).toHaveCount(4);
  await page.getByRole("button",{name:"Vista de cochera",exact:true}).click();
  await page.screenshot({path:"outputs/house-distribution/carport-synthetic.png",fullPage:true});
  await page.getByRole("button",{name:"Restablecer vista",exact:true}).click();
  const roofBefore=await page.locator("canvas").screenshot();
  await page.getByText("Fuente de la cubierta", { exact: true }).click();
  await page.getByRole("combobox",{name:"Cubierta visible"}).selectOption("flat");
  await expect(page.locator(".distribution-roof-variant")).toContainText("Independent synthetic alternative.");
  expect((await page.locator("canvas").screenshot()).equals(roofBefore)).toBe(false);
  await page.screenshot({path:"outputs/house-distribution/section-variant-synthetic.png",fullPage:true});
  await page.getByRole("combobox",{name:"Cubierta visible"}).selectOption("");
  await page.getByText("Niveles de cortes y cotas pendientes", { exact: true }).click();
  await expect(page.locator(".distribution-model-notes").filter({hasText:"Niveles de cortes y cotas pendientes"})).toContainText("3.40 m");
  await expect(page.locator(".distribution-model-notes").filter({hasText:"Niveles de cortes y cotas pendientes"})).toContainText("0.00 m");
  await expect(page.locator(".distribution-model-notes").filter({hasText:"Niveles de cortes y cotas pendientes"})).toContainText("Entire envelope is invented for regression tests.");
  await page.getByRole("button", { name: "Ver interior", exact: true }).click();
  await page.getByRole("button", { name: /^Office/ }).click();
  await expect(page.locator(".distribution-details h3")).toHaveText("Office");
  await expect(page.locator(".distribution-reported-area")).toContainText("48.00 m²");
  await page.getByText("Áreas del plano y zonas calculadas",{exact:true}).click();
  await expect(page.locator(".distribution-model-notes").first()).toContainText("48.00 m²");
  await expect(page.locator(".distribution-model-notes").first()).toContainText("50.00 m²");
  await page.getByRole("button", { name: "Techo", exact: true }).click();
  await expect(page.locator(".distribution-details")).toContainText("extensión añadida de cochera");
  await page.getByRole("button", { name: "Restablecer vista", exact: true }).click();
  await page.screenshot({ path: "outputs/house-distribution/roof-volume-synthetic.png", fullPage: true });
  expect(errors).toEqual([]);
});
test.describe("touch viewer", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("supports touch selection and a readable room list", async ({ page }) => {
    await page.goto(url);
    await expect(page.locator("canvas")).toBeVisible();
    await page.getByRole("button", { name: "Interact with the model", exact: true }).click();
    const box = await page.locator("canvas").boundingBox();
    await page.touchscreen.tap(box!.x + box!.width * .5, box!.y + box!.height * .55);
    await expect(page.locator(".distribution-details h3")).toBeVisible();
    await page.locator(".distribution-rooms").getByRole("button", { name: /^Office/ }).tap();
    await expect(page.locator(".distribution-details h3")).toHaveText("Office");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
test("mobile Spanish and WebGL fallback remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => { const original = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function(this: HTMLCanvasElement, type: string, ...args: unknown[]) { if (type.startsWith("webgl")) return null; return original.call(this, type as "2d", ...args as []) as never; } as typeof original; });
  await page.goto(`${url}?lang=es&viewer=1`);
  await expect(page.getByText("3D no disponible.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: /^Office/ }).click();
  await expect(page.locator(".distribution-details h3")).toHaveText("Office");
  await expect(page.getByText("Corregir datos del espacio", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await openTechnicalDetails(page);
  const exportReady = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar para Codex", exact: true }).click();
  const exportDownload = await exportReady;
  const zip = await JSZip.loadAsync(await readFile((await exportDownload.path())!));
  await expectDistributionExportImages(zip, seed.revision, false);
  expect(JSON.parse(await zip.file("modelo.json")!.async("string")).rooms).toHaveLength(4);
  await expect(page.getByRole("status")).toContainText("Descomprime el ZIP");
  await page.screenshot({ path: "outputs/house-distribution/mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Terreno completo", exact: true }).click();
  await expect(page.locator(".distribution-dimension-summary")).toContainText("20.00 × 30.00 m");
  await expect(page.locator("svg text").filter({ hasText: "30.00" })).toBeVisible();
  await page.screenshot({ path: "outputs/house-distribution/property-mobile.png", fullPage: true });
});
test("owner request, preparation and explicit reviewed-package import", async ({ page }) => {
  await page.goto(`${url}?admin=1`);
  await page.getByRole("checkbox", { name: "Plans.pdf" }).check();
  await page.getByRole("button", { name: "Request 3D distribution", exact: true }).click();
  await expect(page.locator(".distribution-badge")).toHaveText("Requested");
  await page.getByText("Admin · Prepare and import model", { exact: true }).click();
  await page.getByRole("textbox", { name: "Preparation notes", exact: true }).fill("Model reviewed against plans");
  await page.getByRole("button", { name: "Start preparation", exact: true }).click();
  await expect(page.locator(".distribution-badge")).toHaveText("In preparation");
  const imported = page.waitForRequest(request => request.method() === "POST" && new URL(request.url()).pathname === "/api/house-distribution");
  await page.getByLabel("Import reviewed model (.json)", { exact: true }).setInputFiles({ name: "model.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(seed.model)) });
  await expect(page.locator(".distribution-badge")).toHaveText("Ready");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  expect(modelSources((await imported).postDataJSON().model).every(s => s.documentId === "latest-blueprint")).toBe(true);
});
