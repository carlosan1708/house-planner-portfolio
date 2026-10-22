import { expect, test, type Locator, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { mkdir, readFile } from "node:fs/promises";

let server: Server;
let address: string;

test.beforeAll(async () => {
  await mkdir("test-results/overview", { recursive: true });
  const bundle = await build({
    stdin: {
      contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import OverviewHighlights from './app/components/OverviewHighlights';
        const params=new URLSearchParams(location.search);
        const denied=params.has('denied');
        const documents=[
          {id:'plan',name:'Plano de casa.pdf',contentType:'application/pdf',size:102400,folderId:'plans'},
          {id:'budget',name:'Presupuesto.xlsx',contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',size:51200},
          {id:'permit',name:'Permiso.pdf',contentType:'application/pdf',size:76800,folderId:'permits'},
        ];
        const profile={revisionLabelEn:'Revision 9',revisionLabelEs:'Revisión 9',measurements:[
          {id:'area',labelEn:'House area',labelEs:'Área de la casa',value:'199 m²',emphasis:true},
          {id:'front',labelEn:'Frontage',labelEs:'Frente',value:'13.30 m',emphasis:false},
          {id:'height',labelEn:'Interior height',labelEs:'Altura interior',value:'2.80 m',emphasis:false},
        ]};
        createRoot(document.getElementById('root')).render(
          <OverviewHighlights mode="real" language="es" projectId="test-project" projectName="Demo Pavilion"
            canEdit={!params.has('viewer')} canOpenAesthetics={!denied} canOpenNotes={!denied} canOpenDocuments={!denied}
            documents={denied?[]:documents} propertyProfile={profile}
            onNavigate={section=>{window.lastSection=section;}}/>
        );
      `,
      loader: "tsx",
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    outfile: "overview.js",
    platform: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{
      name: "image",
      setup(builder) {
        builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: "image", namespace: "image" }));
        builder.onLoad({ filter: /.*/, namespace: "image" }, () => ({
          contents: "import React from 'react';export default function Image({fill,priority,unoptimized,...props}){return <img {...props} style={fill?{position:'absolute',inset:0,width:'100%',height:'100%',...props.style}:props.style}/>;}",
          loader: "tsx",
          resolveDir: process.cwd(),
        }));
      },
    }],
  });
  const css = await readFile("app/globals.css", "utf8") + (bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text || "");
  const javascript = bundle.outputFiles.find((file) => file.path.endsWith(".js"))!.text;
  server = createServer((request, response) => {
    if (request.url === "/overview.js") {
      response.setHeader("content-type", "text/javascript");
      response.end(javascript);
    } else if (request.url?.startsWith("/photo-")) {
      response.setHeader("content-type", "image/svg+xml");
      const color = request.url.includes("1") ? "#78948b" : "#a5b7c5";
      response.end(`<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="${color}"/><path d="M240 380V210L480 80L720 210V380Z" fill="#ece4d5"/><rect x="430" y="240" width="100" height="140" fill="#736254"/></svg>`);
    } else {
      response.setHeader("content-type", "text/html");
      response.end(`<html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{--font-geist-sans:Arial;padding:20px}#root{max-width:1320px;margin:auto}</style><div id="root"></div><script src="/overview.js"></script></html>`);
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

test.afterAll(async () => {
  if (server) await new Promise<void>((done) => server.close(() => done()));
});

const images = [
  { id: "front", folderId: "exterior", name: "Fachada principal", caption: "Vista de la entrada", mediaType: "image", imageUrl: "/photo-1.svg", thumbnailUrl: "/photo-1.svg" },
  { id: "garden", folderId: "exterior", name: "Jardín lateral", caption: "Área verde", mediaType: "image", imageUrl: "/photo-2.svg", thumbnailUrl: "/photo-2.svg" },
  { id: "interior", folderId: "interior", name: "Sala interior", caption: "Acabados de sala", mediaType: "image", imageUrl: "/photo-3.svg", thumbnailUrl: "/photo-3.svg" },
  { id: "plan-pdf", folderId: "plans", name: "Plano completo.pdf", caption: "Plano", mediaType: "pdf", imageUrl: "/layout.pdf", thumbnailUrl: "/layout.pdf" },
];

const notes = [
  { id: "finish", title: "Acabados aprobados", content: "Usar porcelanato Volte White en la sala.", aiEnabled: true, createdAt: "2026-10-08T12:00:00Z", updatedAt: "2026-10-08T12:00:00Z" },
  { id: "delivery", title: "Entrega de ventanas", content: "Confirmar medidas finales antes de fabricar.", aiEnabled: false, createdAt: "2026-10-08T12:00:00Z", updatedAt: "2026-10-08T12:00:00Z" },
  { id: "private", title: "Nota sin destacar", content: "Esta nota todavía no se ha elegido.", aiEnabled: false, createdAt: "2026-10-08T12:00:00Z", updatedAt: "2026-10-08T12:00:00Z" },
];

type Selection = { imageIds: string[]; noteIds: string[] };

async function mockOverview(page: Page, options: { failFirstSave?: boolean } = {}) {
  const selection: Selection = { imageIds: ["front", "garden"], noteIds: ["finish"] };
  const patches: Partial<Selection>[] = [];
  const resourceRequests: string[] = [];
  await page.route("**/api/overview", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: selection });
      return;
    }
    expect(route.request().method()).toBe("PATCH");
    const patch = route.request().postDataJSON() as Partial<Selection>;
    patches.push(patch);
    if (options.failFirstSave && patches.length === 1) {
      await route.fulfill({ status: 500, json: { error: "No se pudo guardar la selección" } });
      return;
    }
    if (patch.imageIds) selection.imageIds = patch.imageIds;
    if (patch.noteIds) selection.noteIds = patch.noteIds;
    await route.fulfill({ json: selection });
  });
  await page.route("**/api/aesthetics", async (route) => {
    resourceRequests.push("aesthetics");
    await route.fulfill({ json: { folders: [{ id: "exterior", name: "Exterior" }, { id: "interior", name: "Interior" }, { id: "plans", name: "Planos" }], images } });
  });
  await page.route("**/api/notes", async (route) => {
    resourceRequests.push("notes");
    await route.fulfill({ json: { notes } });
  });
  return { selection, patches, resourceRequests };
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
}

for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 390, height: 844 }]) {
  test(`shows only chosen house photos, compact notes and measured dimensions on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockOverview(page);
    await page.goto(address);

    await expect(page.getByRole("heading", { name: "Fotos de la casa", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Documentos", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Medidas de la casa", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Notas destacadas", exact: true })).toBeVisible();
    await expect(page.getByText("199 m²", { exact: true })).toBeVisible();
    await expect(page.getByText("13.30 m", { exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Medida aprox.", exact: true })).toBeVisible();
    await expect(page.locator(".overview-document-total strong")).toHaveText("3");
    await expect(page.locator(".overview-document-counts > div").filter({ has: page.getByText("PDF", { exact: true }) }).locator("dd")).toHaveText("2");
    await expect(page.locator(".overview-document-counts > div").filter({ has: page.getByText("Hojas de cálculo", { exact: true }) }).locator("dd")).toHaveText("1");
    await expect(page.locator(".overview-measurement-card table tbody tr")).toHaveCount(3);
    await expect(page.locator(".overview-notes-card table tbody tr")).toHaveCount(1);
    await expect(page.getByText("Acabados aprobados", { exact: true })).toBeVisible();
    await expect(page.getByText("Nota sin destacar", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("img", { name: /Fachada principal|Vista de la entrada/ })).toBeVisible();
    await page.getByRole("button", { name: "Foto siguiente", exact: true }).click();
    await expect(page.getByRole("img", { name: /Jardín lateral|Área verde/ })).toBeVisible();
    await page.getByRole("button", { name: "Foto siguiente", exact: true }).click();
    await expect(page.getByRole("img", { name: /Fachada principal|Vista de la entrada/ })).toBeVisible();
    await expect(page.getByRole("img", { name: /Sala interior|Acabados de sala/ })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `test-results/overview/overview-${viewport.name}.png`, fullPage: true });
  });

  test(`saves independent photo and note selections and restores them after reload on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const mock = await mockOverview(page);
    await page.goto(address);
    await page.getByRole("button", { name: "Editar selección de fotos", exact: true }).click();
    const photos = page.getByRole("dialog");
    await expect(photos.getByRole("checkbox", { name: /Fachada principal/ })).toBeChecked();
    await expect(photos.getByRole("checkbox", { name: /Jardín lateral/ })).toBeChecked();
    await expect(photos.getByRole("checkbox", { name: /Plano completo/ })).toHaveCount(0);
    await photos.getByRole("checkbox", { name: /Jardín lateral/ }).uncheck();
    await photos.getByRole("checkbox", { name: /Sala interior/ }).check();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `test-results/overview/overview-photo-selection-${viewport.name}.png` });
    await photos.getByRole("button", { name: "Guardar selección", exact: true }).click();
    await expect(photos).toHaveCount(0);
    expect(mock.selection).toEqual({ imageIds: ["front", "interior"], noteIds: ["finish"] });

    await page.getByRole("button", { name: "Seleccionar notas", exact: true }).click();
    const notePicker = page.getByRole("dialog");
    await expect(notePicker.getByRole("checkbox", { name: /Acabados aprobados/ })).toBeChecked();
    await notePicker.getByRole("checkbox", { name: /Entrega de ventanas/ }).check();
    await notePicker.getByRole("searchbox", { name: "Buscar notas", exact: true }).fill("ventanas");
    await expect(notePicker.getByRole("checkbox")).toHaveCount(1);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `test-results/overview/overview-note-selection-${viewport.name}.png` });
    await notePicker.getByRole("button", { name: "Guardar selección", exact: true }).click();
    await expect(notePicker).toHaveCount(0);
    expect(mock.selection).toEqual({ imageIds: ["front", "interior"], noteIds: ["finish", "delivery"] });
    expect(mock.patches).toEqual([{ imageIds: ["front", "interior"] }, { noteIds: ["finish", "delivery"] }]);

    await page.reload();
    await expect(page.getByText("Acabados aprobados", { exact: true })).toBeVisible();
    await expect(page.getByText("Entrega de ventanas", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Foto siguiente", exact: true }).click();
    await expect(page.getByRole("img", { name: /Sala interior|Acabados de sala/ })).toBeVisible();
    await page.getByRole("button", { name: "Editar selección de fotos", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: /Jardín lateral/ })).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: /Sala interior/ })).toBeChecked();
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expectNoHorizontalOverflow(page);
  });

  test(`removes a selected photo while search and folder filters hide it on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const mock = await mockOverview(page);
    await page.goto(address);
    await page.getByRole("button", { name: "Editar selección de fotos", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Editar selección de fotos", exact: true });
    await picker.getByRole("combobox", { name: "Carpeta", exact: true }).selectOption("interior");
    await picker.getByRole("searchbox", { name: "Buscar fotos", exact: true }).fill("Sala");
    await expect(picker.getByRole("checkbox")).toHaveCount(1);
    const selected = picker.getByRole("region", { name: "Fotos seleccionadas", exact: true });
    const remove = selected.getByRole("button", { name: "Quitar del resumen: Fachada principal", exact: true });
    if (viewport.name === "mobile") expect((await remove.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await remove.click();
    await expect(selected).toBeFocused();
    await expect(remove).toHaveCount(0);
    await expect(selected.getByRole("button", { name: "Quitar del resumen: Jardín lateral", exact: true })).toBeVisible();
    await expect(picker.getByRole("checkbox", { name: /Sala interior/ })).not.toBeChecked();
    await picker.getByRole("button", { name: "Guardar selección", exact: true }).click();
    expect(mock.patches).toEqual([{ imageIds: ["garden"] }]);
    await page.reload();
    await expect(page.locator(".overview-photo-stage img")).toHaveAttribute("alt", "Área verde");
    await page.getByRole("button", { name: "Editar selección de fotos", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: /Fachada principal/ })).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: /Jardín lateral/ })).toBeChecked();
    await expectNoHorizontalOverflow(page);
  });

  test(`clears only the overview selection and keeps source photos after reload on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const mock = await mockOverview(page);
    await page.goto(address);
    await page.getByRole("button", { name: "Editar selección de fotos", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Editar selección de fotos", exact: true });
    await picker.getByRole("button", { name: "Quitar todas del resumen", exact: true }).click();
    await expect(picker.getByRole("checkbox", { checked: true })).toHaveCount(0);
    await expect(picker.getByText(/las imágenes seguirán en Estética/)).toBeVisible();
    await expect(picker.getByRole("button", { name: "Quitar todas del resumen", exact: true })).toBeDisabled();
    await picker.getByRole("button", { name: "Guardar selección", exact: true }).click();
    expect(mock.patches).toEqual([{ imageIds: [] }]);
    expect(mock.selection.noteIds).toEqual(["finish"]);
    await page.reload();
    await expect(page.locator(".overview-photo-stage")).toHaveCount(0);
    await expect(page.getByText("Acabados aprobados", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Editar selección de fotos", exact: true }).click();
    await expect(page.getByRole("checkbox")).toHaveCount(3);
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test(`canceling removals preserves the saved photo selection on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const mock = await mockOverview(page);
    await page.goto(address);
    await page.getByRole("button", { name: "Editar selección de fotos", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Editar selección de fotos", exact: true });
    await picker.getByRole("button", { name: "Quitar del resumen: Fachada principal", exact: true }).click();
    await picker.getByRole("button", { name: "Quitar todas del resumen", exact: true }).click();
    await picker.getByRole("button", { name: "Cancelar", exact: true }).click();
    expect(mock.patches).toEqual([]);
    expect(mock.selection.imageIds).toEqual(["front", "garden"]);
    await page.getByRole("button", { name: "Editar selección de fotos", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: /Fachada principal/ })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: /Jardín lateral/ })).toBeChecked();
  });
}

async function swipePhoto(page: Page, surface: Locator, dx: number, dy = 0) {
  await surface.scrollIntoViewIfNeeded();
  const bounds = (await surface.boundingBox())!;
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  const session = await page.context().newCDPSession(page);
  try {
    if (!dy) {
      await session.send("Input.synthesizeScrollGesture", { x, y, xDistance: dx, speed: 400, gestureSourceType: "touch", preventFling: true });
      return;
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 0 }] });
    for (let step = 1; step <= 8; step++) {
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx * step / 8, y: y + dy * step / 8, id: 0 }] });
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally { await session.detach(); }
}

test("enlarges photos, adapts to rotation and restores focus and scroll after closing", async ({ browser, browserName }) => {
  test.skip(browserName !== "chromium", "Physical touch gestures use Chromium's browser input protocol.");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    const mock = await mockOverview(page);
    await page.goto(`${address}/?viewer`);
    const opener = page.locator(".overview-photo-open");
    await expect(opener).toBeVisible();
    await swipePhoto(page, opener, -110);
    await expect(page.locator(".overview-photo-stage img")).toHaveAttribute("alt", "Área verde");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await opener.scrollIntoViewIfNeeded();
    const beforePan = await page.evaluate(() => scrollY);
    await swipePhoto(page, opener, 0, -110);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(beforePan);
    await expect(page.locator(".overview-photo-stage img")).toHaveAttribute("alt", "Área verde");
    // Begin the viewer independently of Chromium's native page-scroll fling.
    await page.reload();
    await expect(opener).toBeVisible();
    await page.evaluate(() => scrollTo(0, 80));
    const originalScroll = await page.evaluate(() => scrollY);
    await opener.tap();
    const viewer = page.locator(".overview-image-viewer");
    await expect(viewer).toBeVisible();
    await expect(viewer.getByRole("button", { name: "Cerrar imagen", exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
    await swipePhoto(page, viewer.locator(".overview-image-viewer-stage"), -110);
    await expect(viewer.getByRole("heading", { name: "Jardín lateral", exact: true })).toBeVisible();
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(viewer).toBeVisible();
    const layout = await viewer.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const stage = element.querySelector(".overview-image-viewer-stage")!.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height, stageHeight: stage.height, fit: getComputedStyle(element.querySelector("img")!).objectFit };
    });
    expect(layout.width).toBe(844);
    expect(layout.height).toBe(390);
    expect(layout.stageHeight).toBeGreaterThan(180);
    expect(layout.fit).toBe("contain");
    for (const button of await viewer.getByRole("button").all()) {
      const box = (await button.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(390);
    }
    await page.screenshot({ path: "test-results/overview/overview-viewer-landscape.png" });
    await page.keyboard.press("ArrowRight");
    await expect(viewer.getByRole("heading", { name: "Fachada principal", exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await viewer.getByRole("button", { name: "Cerrar imagen", exact: true }).tap();
    await expect(viewer).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
    expect(await page.evaluate(() => scrollY)).toBe(originalScroll);
    await opener.press("Enter");
    await expect(viewer).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
    expect(mock.patches).toEqual([]);
  } finally { await context.close(); }
});

test("keeps chosen content visible for viewers without selection controls", async ({ page }) => {
  const mock = await mockOverview(page);
  await page.goto(`${address}/?viewer`);
  await expect(page.getByRole("img", { name: /Fachada principal|Vista de la entrada/ })).toBeVisible();
  await expect(page.getByText("Acabados aprobados", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Editar selección de fotos|Seleccionar notas/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Foto siguiente", exact: true }).click();
  await expect(page.getByRole("img", { name: /Jardín lateral|Área verde/ })).toBeVisible();
  expect(mock.patches).toEqual([]);
});

test("does not fetch photos or notes without the corresponding project permissions", async ({ page }) => {
  const mock = await mockOverview(page);
  await page.goto(`${address}/?denied`);
  await expect(page.getByRole("heading", { name: "Medidas de la casa", exact: true })).toBeVisible();
  await expect(page.getByText("199 m²", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Editar selección de fotos|Seleccionar notas/ })).toHaveCount(0);
  await expect(page.getByRole("img", { name: /Fachada principal|Vista de la entrada/ })).toHaveCount(0);
  await expect(page.getByText("Acabados aprobados", { exact: true })).toHaveCount(0);
  expect(mock.resourceRequests).toEqual([]);
});

test("retains unsaved photo choices after a failed save and can retry", async ({ page }) => {
  const mock = await mockOverview(page, { failFirstSave: true });
  await page.goto(address);
  await page.getByRole("button", { name: "Editar selección de fotos", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox", { name: /Jardín lateral/ }).uncheck();
  await dialog.getByRole("checkbox", { name: /Sala interior/ }).check();
  await dialog.getByRole("button", { name: "Guardar selección", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("No se pudo guardar la selección");
  await expect(dialog.getByRole("checkbox", { name: /Fachada principal/ })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /Jardín lateral/ })).not.toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /Sala interior/ })).toBeChecked();
  expect(mock.selection.imageIds).toEqual(["front", "garden"]);
  await dialog.getByRole("button", { name: "Guardar selección", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(mock.selection.imageIds).toEqual(["front", "interior"]);
  await page.getByRole("button", { name: "Foto siguiente", exact: true }).click();
  await expect(page.getByRole("img", { name: /Sala interior|Acabados de sala/ })).toBeVisible();
});
