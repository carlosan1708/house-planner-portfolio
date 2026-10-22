import { expect, test, type Locator } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import JSZip from "jszip";

let server: Server;
let address: string;

function planPdfFixture() {
  const stream = "BT /F1 22 Tf 72 720 Td (Planos layout regression) Tj ET 72 72 468 620 re S";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(pdf);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}

async function expectPdfFillsPreview(preview: Locator, compact: boolean) {
  await expect.poll(async () => preview.evaluate((element, isCompact) => {
    const frame = element.querySelector("iframe")!.getBoundingClientRect();
    const container = element.getBoundingClientRect();
    const toolbar = element.querySelector(".aesthetic-pdf-controls")!.getBoundingClientRect();
    const availableHeight = container.height - (isCompact ? 0 : toolbar.height);
    return { widthFits: Math.abs(container.width - frame.width) < 2, heightFits: Math.abs(availableHeight - frame.height) < 2, bottomFits: Math.abs(container.bottom - frame.bottom) < 2, tallEnough: frame.height > 200 };
  }, compact)).toEqual({ widthFits: true, heightFits: true, bottomFits: true, tallEnough: true });
}

test.beforeAll(async () => {
  await mkdir("test-results/upload-folder-links", { recursive: true });
  const bundle = await build({
    stdin: { contents: `
      import React, {useEffect,useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import Aesthetics from './app/components/AestheticsWorkspace';
      const params=new URLSearchParams(location.search);
      const real=params.has('real')||location.pathname.startsWith('/projects/');
      const readFolder=()=>location.pathname.split('/')[4]==='folder'?decodeURIComponent(location.pathname.split('/')[5]):null;
      function Harness(){
        const [folderId,setFolderId]=useState(readFolder);
        useEffect(()=>{const pop=()=>setFolderId(readFolder());addEventListener('popstate',pop);return()=>removeEventListener('popstate',pop);},[]);
        const navigate=(id)=>{history.pushState(null,'','/projects/test-project/aesthetics'+(id?'/folder/'+encodeURIComponent(id):''));setFolderId(id);};
        return <Aesthetics mode={real?'real':'demo'} language={params.has('es')?'es':'en'} canEdit={!params.has('viewer')} projectId={real?'test-project':undefined} routeFolderId={folderId} onRouteFolderChange={real?navigate:undefined}/>;
      }
      createRoot(document.getElementById('root')).render(<Harness/>);
    `, loader: "tsx", resolveDir: process.cwd() },
    bundle: true, write: false, loader: { ".webp": "dataurl" }, outfile: "aesthetics.js", platform: "browser", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "image", setup(builder) {
      builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: "image", namespace: "image" }));
      builder.onLoad({ filter: /.*/, namespace: "image" }, () => ({ contents: "import React from 'react';export default function Image({fill,priority,unoptimized,...props}){return <img {...props} style={fill?{position:'absolute',inset:0,width:'100%',height:'100%'}:{}}/>;}", loader: "tsx", resolveDir: process.cwd() }));
    } }],
  });
  const css = await readFile("app/globals.css", "utf8") + (bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text || "");
  server = createServer((request, response) => {
    if (request.url === "/aesthetics.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles.find((file) => file.path.endsWith(".js"))!.text); }
    else if (request.url === "/og.png") { response.setHeader("content-type", "image/png"); response.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=", "base64")); }
    else if (request.url === "/layout-plan.pdf") { response.setHeader("content-type", "application/pdf"); response.end(planPdfFixture()); }
    else { response.setHeader("content-type", "text/html"); response.end(`<html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}body{padding:20px}</style><div id="root"></div><script src="/aesthetics.js"></script></html>`); }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>((done) => server.close(() => done())); });

const realFolders = [
  { id: "interior", name: "Interior", kind: "images", carouselImageIds: [], createdAt: "2026-10-05T12:00:00Z" },
  { id: "kitchen", name: "Kitchen", kind: "images", parentId: "interior", carouselImageIds: [], createdAt: "2026-10-05T12:00:00Z" },
  { id: "materials", name: "Materials", kind: "images", parentId: "kitchen", carouselImageIds: [], createdAt: "2026-10-05T12:00:00Z" },
];

for (const viewport of [{ name: "desktop", width: 1581, height: 886 }, { name: "mobile", width: 390, height: 844 }]) {
  test(`removes deprecated photos from their named Exterior carousel on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const folders = [
      { id: "exterior", name: "Exterior", kind: "images", carouselImageIds: ["old-1", "old-2", "new-exterior"], createdAt: "2026-10-05T12:00:00Z" },
      { id: "interior", name: "Interior", kind: "images", carouselImageIds: ["old-1", "old-2"], createdAt: "2026-10-05T12:00:00Z" },
      { id: "deprecated", name: "Deprecado", kind: "images", carouselImageIds: [], createdAt: "2026-10-05T12:00:00Z" },
    ];
    const images = [
      { id: "old-1", folderId: "deprecated", name: "anterior-1.png" },
      { id: "old-2", folderId: "deprecated", name: "anterior-2.png" },
      { id: "new-exterior", folderId: "exterior", name: "nueva-exterior.png" },
    ].map((image) => ({ ...image, caption: "", width: 1, height: 1, mediaType: "image", contentType: "image/png", createdAt: "2026-10-05T12:00:00Z", imageUrl: "/og.png", thumbnailUrl: "/og.png" }));
    const patches: Array<{ action: string; id: string; imageIds: string[] }> = [];
    await page.route("**/api/aesthetics", async (route) => {
      if (route.request().method() === "GET") { await route.fulfill({ json: { folders, images } }); return; }
      expect(route.request().method()).toBe("PATCH");
      const patch = route.request().postDataJSON();
      expect(patch).toMatchObject({ action: "carousel", id: "exterior" });
      patches.push(patch);
      folders.find((folder) => folder.id === patch.id)!.carouselImageIds = patch.imageIds;
      await route.fulfill({ json: { ok: true } });
    });

    await page.goto(`${address}/projects/test-project/aesthetics/folder/deprecated?es&viewer`);
    await expect(page.getByRole("heading", { name: "Deprecado", exact: true })).toBeVisible();
    await expect(page.locator(".aesthetic-grid article")).toHaveCount(2);
    await expect(page.locator(".aesthetic-image-actions")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Quitar del carrusel|Mostrar en carrusel/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Elegir fotos del carrusel" })).toHaveCount(0);
    expect(patches).toEqual([]);

    await page.goto(`${address}/projects/test-project/aesthetics/folder/deprecated?es`);
    const cards = page.locator(".aesthetic-grid article");
    await expect(cards).toHaveCount(2);
    for (const image of images.filter((image) => image.folderId === "deprecated")) {
      const card = cards.filter({ hasText: image.name });
      await expect(card.getByRole("button", { name: /Mostrar en carrusel · Deprecado$/ })).toBeVisible();
      await expect(card.getByRole("button", { name: /Quitar del carrusel · Interior$/ })).toBeVisible();
      await card.getByRole("button", { name: /Quitar del carrusel · Exterior$/ }).click();
      await expect(card.getByRole("button", { name: /Quitar del carrusel · Exterior$/ })).toHaveCount(0);
      await expect(card.getByRole("button", { name: /Quitar del carrusel · Interior$/ })).toBeVisible();
      await expect(card.getByRole("button", { name: /Mostrar en carrusel · Deprecado$/ })).toBeEnabled();
    }
    expect(patches).toEqual([
      { action: "carousel", id: "exterior", imageIds: ["old-2", "new-exterior"] },
      { action: "carousel", id: "exterior", imageIds: ["new-exterior"] },
    ]);
    expect(folders.find((folder) => folder.id === "deprecated")!.carouselImageIds).toEqual([]);
    expect(folders.find((folder) => folder.id === "interior")!.carouselImageIds).toEqual(["old-1", "old-2"]);
    expect(images.filter((image) => image.folderId === "deprecated").map((image) => image.id)).toEqual(["old-1", "old-2"]);
    await page.reload();
    await expect(cards).toHaveCount(2);
    await expect(cards.getByRole("button", { name: /Quitar del carrusel · Exterior$/ })).toHaveCount(0);
    await expect(cards.getByRole("button", { name: /Quitar del carrusel · Interior$/ })).toHaveCount(2);
    await page.screenshot({ path: `test-results/upload-folder-links/carousel-removal-deprecated-${viewport.name}.png`, fullPage: true });

    await page.goto(`${address}/projects/test-project/aesthetics/folder/interior?es`);
    await expect(page.locator(".aesthetic-thumbnail-preview")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Mostrar anterior-1.png", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Mostrar anterior-2.png", exact: true })).toBeVisible();
    await page.goto(`${address}/projects/test-project/aesthetics/folder/exterior?es`);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Exterior", exact: true })).toBeVisible();
    await expect(page.locator(".aesthetic-thumbnail-preview")).toHaveCount(1);
    await expect(page.locator(".aesthetic-thumbnail-preview")).toHaveAccessibleName("Mostrar nueva-exterior.png");
    await expect(page.locator(".aesthetic-stage")).toContainText("nueva-exterior.png");
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText("nueva-exterior.png");
    const width = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
    expect(width.content).toBeLessThanOrEqual(width.viewport);
    await page.screenshot({ path: `test-results/upload-folder-links/carousel-removal-exterior-${viewport.name}.png`, fullPage: true });
  });

  test(`plan PDF fills its carousel and full viewer on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const plan = { id: "layout-plan", folderId: "plans", name: "layout-plan.pdf", caption: "", width: 612, height: 792, mediaType: "pdf", contentType: "application/pdf", createdAt: "2026-10-05T12:00:00Z", imageUrl: "/layout-plan.pdf", thumbnailUrl: "/layout-plan.pdf" };
    await page.route("**/api/aesthetics", (route) => route.fulfill({ json: { folders: [...realFolders, { id: "plans", name: "Planos", kind: "plans", carouselImageIds: [plan.id], createdAt: plan.createdAt }], images: [plan] } }));
    await page.goto(`${address}/projects/test-project/aesthetics/folder/plans?es`);
    const stage = page.locator(".aesthetic-pdf-stage");
    const compact = stage.locator(".aesthetic-pdf-preview");
    await expect(compact.locator("iframe")).toBeVisible();
    await stage.getByRole("button", { name: "Acercar", exact: true }).click();
    await expect(compact.locator("iframe")).toHaveAttribute("src", /#zoom=125$/);
    await stage.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/upload-folder-links/plan-pdf-${viewport.name}.png`, fullPage: true });
    await expectPdfFillsPreview(compact, true);
    await stage.getByRole("button", { name: "Restablecer zoom a 100%" }).click();
    await expect(compact.locator("iframe")).toHaveAttribute("src", /#zoom=100$/);
    await expectPdfFillsPreview(compact, true);
    await stage.getByRole("button", { name: "Abrir plano", exact: true }).click();
    const viewer = page.getByRole("dialog", { name: plan.name });
    const expanded = viewer.locator(".aesthetic-pdf-preview");
    await expect(viewer).toBeVisible();
    await expectPdfFillsPreview(expanded, false);
    await viewer.getByRole("button", { name: "Acercar", exact: true }).click();
    await expect(expanded.locator("iframe")).toHaveAttribute("src", /#zoom=125$/);
    await expectPdfFillsPreview(expanded, false);
    await page.screenshot({ path: `test-results/upload-folder-links/plan-pdf-viewer-${viewport.name}.png`, fullPage: true });
    await viewer.locator(".close").click();
    await expect(viewer).toHaveCount(0);
    await expectPdfFillsPreview(compact, true);
    const width = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
    expect(width.content).toBeLessThanOrEqual(width.viewport);
  });
}

test("shares nested folder URLs and restores their selection after back and refresh", async ({ page }) => {
  await page.route("**/api/aesthetics", (route) => route.fulfill({ json: { folders: realFolders, images: [] } }));
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: async (url: string) => { (window as unknown as { copiedUrl: string }).copiedUrl = url; } } }));
  await page.goto(`${address}/?real`);
  await expect(page.getByRole("heading", { name: "Interior", exact: true })).toBeVisible();
  await page.locator(".aesthetic-folder-strip").getByRole("button", { name: /Interior \/ Kitchen \/ Materials/ }).click();
  await expect(page).toHaveURL(`${address}/projects/test-project/aesthetics/folder/materials`);
  await expect(page.getByRole("heading", { name: "Materials", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { copiedUrl: string }).copiedUrl)).toBe(`${address}/projects/test-project/aesthetics/folder/materials`);
  await page.locator(".aesthetic-folder-strip").getByRole("button", { name: /Interior \/ Kitchen 0 images/ }).click();
  await expect(page.getByRole("heading", { name: "Kitchen", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Materials", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Materials", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/upload-folder-links/aesthetics-folder-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const size = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
  expect(size.content).toBeLessThanOrEqual(size.viewport);
  await page.screenshot({ path: "test-results/upload-folder-links/aesthetics-folder-mobile.png", fullPage: true });
});

test("waits for folders to load and keeps unavailable folder links explicit", async ({ page }) => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/aesthetics", async (route) => { await ready; await route.fulfill({ json: { folders: realFolders, images: [] } }); });
  await page.goto(`${address}/projects/test-project/aesthetics/folder/restricted?viewer`);
  await expect(page.getByRole("heading", { name: "Preparing Interior, Exterior, and Plans" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Folder unavailable" })).toHaveCount(0);
  release();
  await expect(page.getByRole("heading", { name: "Folder unavailable" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Interior", exact: true })).toHaveCount(0);
  await expect(page.locator(".aesthetic-gallery")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New folder", exact: true })).toHaveCount(0);
  await page.locator(".aesthetic-folder-strip").getByRole("button", { name: /Interior \/ Kitchen \/ Materials/ }).click();
  await expect(page.getByRole("heading", { name: "Materials", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy link", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add images" })).toHaveCount(0);
});

test("shows real upload status and refreshes accepted files when a batch stops", async ({ page }) => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  let uploads = 0;
  const images: Array<Record<string, unknown>> = [];
  await page.route("**/api/aesthetics", async (route) => {
    if (route.request().method() === "GET") { await route.fulfill({ json: { folders: realFolders, images } }); return; }
    uploads += 1;
    if (uploads === 1) await ready;
    if (uploads === 2) { await route.fulfill({ status: 400, json: { error: "Image could not be saved" } }); return; }
    const name = uploads === 1 ? "first.png" : "retry.png";
    images.push({ id: name, folderId: "interior", name, caption: "", width: 1, height: 1, mediaType: "image", contentType: "image/png", createdAt: "2026-10-05T12:00:00Z", imageUrl: "/og.png", thumbnailUrl: "/og.png" });
    await route.fulfill({ json: { image: images.at(-1) } });
  });
  await page.goto(`${address}/?real`);
  await expect(page.getByRole("heading", { name: "Interior", exact: true })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles([
    { name: "first.png", mimeType: "image/png", buffer: Buffer.alloc(100_000) },
    { name: "second.png", mimeType: "image/png", buffer: Buffer.alloc(300_000) },
  ]);
  await expect(page.locator(".upload-progress")).toBeVisible();
  await expect(page.locator(".upload-progress")).toHaveAttribute("aria-busy", "true");
  await expect(page.locator(".upload-progress")).toContainText("File 1 / 2");
  await expect(page.getByRole("button", { name: "Add images" })).toBeDisabled();
  await page.screenshot({ path: "test-results/upload-folder-links/aesthetics-upload-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/upload-folder-links/aesthetics-upload-mobile.png", fullPage: true });
  release();
  await expect(page.getByRole("alert")).toContainText("Image could not be saved");
  await expect(page.locator(".upload-progress")).toContainText("Upload stopped");
  await expect(page.locator(".upload-progress")).toContainText("1 / 2 saved");
  await expect(page.locator(".upload-progress")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".aesthetic-gallery")).toContainText("first.png");
  await page.locator('input[type="file"]').setInputFiles({ name: "retry.png", mimeType: "image/png", buffer: Buffer.alloc(100) });
  await expect(page.locator(".aesthetic-gallery")).toContainText("retry.png");
  await expect(page.locator(".upload-progress")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("disables file drops until an image move and its refresh finish while keeping folder navigation available", async ({ page }) => {
  let releaseMove!: () => void;
  let releaseRefresh!: () => void;
  const moveReady = new Promise<void>((resolve) => { releaseMove = resolve; });
  const refreshReady = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  let holdRefresh = false;
  let refreshStarted = false;
  let uploads = 0;
  const images = [{ id: "existing", folderId: "interior", name: "existing.png", caption: "", width: 1, height: 1, mediaType: "image", contentType: "image/png", createdAt: "2026-10-05T12:00:00Z", imageUrl: "/og.png", thumbnailUrl: "/og.png" }];
  await page.route("**/api/aesthetics", async (route) => {
    if (route.request().method() === "PATCH") {
      expect(route.request().postDataJSON()).toMatchObject({ action: "move_image", id: "existing", folderId: "kitchen" });
      await moveReady;
      images[0].folderId = "kitchen";
      holdRefresh = true;
      await route.fulfill({ json: { ok: true } });
      return;
    }
    if (route.request().method() === "GET") {
      if (holdRefresh) { holdRefresh = false; refreshStarted = true; await refreshReady; }
      await route.fulfill({ json: { folders: realFolders, images } });
      return;
    }
    uploads += 1;
    expect(route.request().postData()).toContain('name="folderId"\r\n\r\nmaterials');
    images.push({ ...images[0], id: "after-move", folderId: "materials", name: "after-move.png" });
    await route.fulfill({ json: { image: images.at(-1) } });
  });
  await page.goto(`${address}/?real`);
  await expect(page.getByRole("heading", { name: "Interior", exact: true })).toBeVisible();
  await page.getByLabel("Move existing.png to folder").selectOption("kitchen");
  const dropzone = page.getByRole("button", { name: "Drop images here or choose files" });
  await expect(dropzone).toBeDisabled();
  await expect(dropzone).toHaveAttribute("tabindex", "-1");
  await expect(dropzone).toContainText("Please wait until the current change finishes.");
  await page.locator(".aesthetic-folder-strip").getByRole("button", { name: /Interior \/ Kitchen \/ Materials/ }).click();
  await expect(page.getByRole("heading", { name: "Materials", exact: true })).toBeVisible();
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(100)], "after-move.png", { type: "image/png" }));
    return data;
  });
  await dropzone.dispatchEvent("dragenter", { dataTransfer: transfer });
  await dropzone.dispatchEvent("dragover", { dataTransfer: transfer });
  await expect(dropzone).not.toHaveClass(/dragging/);
  expect(await transfer.evaluate((data) => data.dropEffect)).toBe("none");
  await dropzone.dispatchEvent("drop", { dataTransfer: transfer });
  const interior = page.locator(".aesthetic-folder-strip").getByRole("button", { name: /Interior 1 image/ });
  await interior.dispatchEvent("dragenter", { dataTransfer: transfer });
  await interior.dispatchEvent("dragover", { dataTransfer: transfer });
  await expect(interior).not.toHaveClass(/drop-hover/);
  expect(await transfer.evaluate((data) => data.dropEffect)).toBe("none");
  await interior.dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page).toHaveURL(`${address}/projects/test-project/aesthetics/folder/materials`);
  expect(uploads).toBe(0);
  await page.screenshot({ path: "test-results/upload-folder-links/aesthetics-disabled-dropzone.png", fullPage: true });

  releaseMove();
  await expect.poll(() => refreshStarted).toBe(true);
  await expect(dropzone).toBeDisabled();
  await dropzone.dispatchEvent("drop", { dataTransfer: transfer });
  expect(uploads).toBe(0);
  releaseRefresh();
  await expect(dropzone).toBeEnabled();
  await expect(dropzone).toHaveAttribute("tabindex", "0");
  await dropzone.dispatchEvent("dragenter", { dataTransfer: transfer });
  await expect(dropzone).toHaveClass(/dragging/);
  await dropzone.dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.locator(".aesthetic-grid article").filter({ hasText: "after-move.png" })).toBeVisible();
  expect(uploads).toBe(1);
  await expect(dropzone).toBeEnabled();
});

test("creates multiple nested subfolders and combines photos from different folders", async ({ page }) => {
  await page.goto(address);
  await expect(page.getByRole("button", { name: /Play/ })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "New subfolder" }).click();
  await expect(page.getByLabel("Inside folder")).toHaveValue("demo-interior");
  await page.getByLabel("Folder name").fill("Cocina");
  await page.getByRole("button", { name: "Save folder" }).click();
  await expect(page.getByRole("heading", { name: "Cocina", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New subfolder" }).click();
  await page.getByLabel("Folder name").fill("Materiales");
  await page.getByRole("button", { name: "Save folder" }).click();
  await expect(page.locator(".aesthetic-folder-strip")).toContainText("Interior / Cocina / Materiales");
  await page.locator(".aesthetic-folder-strip").getByRole("button", { name: /Interior 3 images/ }).click();
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "New subfolder" }).click();
  await page.getByLabel("Folder name").fill("Baño principal");
  await page.getByRole("button", { name: "Save folder" }).click();
  await page.getByRole("button", { name: "Choose carousel photos" }).click();
  await page.getByLabel("Source folder").selectOption("demo-exterior");
  await page.getByRole("checkbox", { name: "Terrace.jpg" }).check();
  await expect(page.locator(".aesthetic-thumbnail-card")).toHaveCount(1);
  await page.getByLabel("Source folder").selectOption("demo-interior");
  await page.getByRole("checkbox", { name: /Kitchen.jpg/ }).check();
  await expect(page.locator(".aesthetic-thumbnail-card")).toHaveCount(2);
  await page.getByRole("button", { name: "Move Kitchen.jpg left" }).click();
  await expect(page.locator(".aesthetic-thumbnail-preview").first()).toHaveAccessibleName("Show Kitchen.jpg");
  await page.getByRole("button", { name: "Show Terrace.jpg" }).click();
  await expect(page.locator(".aesthetic-stage")).toContainText("Terrace.jpg");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.locator(".aesthetic-folder-strip").getByRole("button", { name: /Exterior/ }).click();
  await page.getByLabel("Move Terrace.jpg to folder").selectOption("demo-interior");
  await page.locator(".aesthetic-folder-strip").getByRole("button", { name: /Interior \/ Baño principal/ }).click();
  await expect(page.locator(".aesthetic-thumbnail-card")).toHaveCount(2);
  await page.getByRole("button", { name: "Show Terrace.jpg" }).click();
  await expect(page.locator(".aesthetic-stage")).toContainText("Terrace.jpg");
  await page.getByRole("button", { name: "Choose carousel photos" }).click();
  await page.getByRole("checkbox", { name: "Terrace.jpg" }).uncheck();
  await expect(page.locator(".aesthetic-thumbnail-card")).toHaveCount(1);
  await page.screenshot({ path: "test-results/aesthetics-desktop.png", fullPage: true });
});

test("shows the Spanish photo selector on mobile without overflow and hides editing for viewers", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${address}/?es`);
  await page.getByRole("button", { name: "Elegir fotos del carrusel" }).click();
  await page.getByLabel("Carpeta de origen").selectOption("demo-exterior");
  await page.getByRole("checkbox", { name: "Terraza.jpg" }).check();
  await expect(page.locator(".aesthetic-thumbnail-card")).toHaveCount(4);
  const size = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
  expect(size.content).toBeLessThanOrEqual(size.viewport);
  await page.screenshot({ path: "test-results/aesthetics-mobile.png", fullPage: true });
  await page.goto(`${address}/?viewer`);
  await expect(page.locator(".aesthetic-stage")).toBeVisible();
  await expect(page.getByRole("button", { name: "New subfolder" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Choose carousel photos" })).toHaveCount(0);
});

test("downloads a folder ZIP for a mobile viewer and reports preparation failures", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const folders = [
    { id: "interior", name: "Interiór", kind: "images", carouselImageIds: ["outside"], createdAt: "2026-01-01" },
    { id: "kitchen", name: "Cocina", kind: "images", parentId: "interior", carouselImageIds: [], createdAt: "2026-01-01" },
    { id: "exterior", name: "Exterior", kind: "images", carouselImageIds: [], createdAt: "2026-01-01" },
  ];
  const images = [
    { id: "kitchen-photo", folderId: "kitchen", name: "Cocina.jpg" },
    { id: "outside", folderId: "exterior", name: "Exterior.jpg" },
  ].map((image) => ({ ...image, caption: "", width: 100, height: 100, mediaType: "image", contentType: "image/jpeg", imageUrl: "/og.png", thumbnailUrl: "/og.png", createdAt: "2026-01-01" }));
  const archive = new JSZip(); archive.file("Interiór/Cocina/Cocina.jpg", "original child photo");
  const archiveBytes = await archive.generateAsync({ type: "nodebuffer" });
  let release = () => {}; const pending = new Promise<void>((resolve) => { release = resolve; });
  const requests: string[] = []; let fail = false;
  await page.route("**/api/aesthetics", (route) => route.fulfill({ json: { folders, images } }));
  await page.route("**/api/aesthetics/archive?*", async (route) => {
    requests.push(new URL(route.request().url()).searchParams.get("folderId")!);
    if (fail) { await route.fulfill({ status: 503, json: { error: "No se pudo completar la descarga de todas las imágenes." } }); return; }
    await pending;
    await route.fulfill({ body: archiveBytes, headers: { "Content-Type": "application/zip", "Content-Disposition": "attachment; filename=\"imagenes.zip\"; filename*=UTF-8''Interi%C3%B3r-imagenes.zip" } });
  });
  await page.goto(`${address}/?real&viewer&es`);
  await page.locator(".aesthetic-gallery-source select").selectOption("exterior");
  await expect(page.locator("#aesthetic-archive-help")).toContainText("esta carpeta y sus subcarpetas");
  let downloads = 0; page.on("download", () => downloads++);
  const received = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descargar imágenes" }).click();
  await expect(page.getByRole("button", { name: "Preparando ZIP…" })).toBeDisabled();
  release();
  const download = await received;
  expect(download.suggestedFilename()).toBe("Interiór-imagenes.zip");
  const saved = await JSZip.loadAsync(await readFile((await download.path())!));
  expect(Object.keys(saved.files).filter((name) => !saved.files[name].dir)).toEqual(["Interiór/Cocina/Cocina.jpg"]);
  expect(await saved.file("Interiór/Cocina/Cocina.jpg")!.async("string")).toBe("original child photo");
  expect(requests).toEqual(["interior"]);
  await expect(page.getByRole("button", { name: "Descargar imágenes" })).toBeEnabled();
  fail = true;
  await page.getByRole("button", { name: "Descargar imágenes" }).click();
  await expect(page.getByRole("alert")).toContainText("No se pudo completar la descarga de todas las imágenes.");
  expect(downloads).toBe(1);
  await page.screenshot({ path: "test-results/aesthetics-download-mobile.png", fullPage: true });
});

test("touch browsing keeps page scroll available and the open image adapts to landscape", async ({ browser, browserName }) => {
  test.skip(browserName !== "chromium", "Native touch input uses the Chromium protocol.");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  const swipe = async (surface: Locator, dx: number, dy: number) => {
    await surface.scrollIntoViewIfNeeded();
    const bounds = (await surface.boundingBox())!;
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    if (dy) {
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let step = 1; step <= 5; step++) await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx * step / 5, y: y + dy * step / 5 }] });
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else await session.send("Input.synthesizeScrollGesture", { x, y, xDistance: dx, speed: 400, gestureSourceType: "touch", preventFling: true });
  };
  try {
    await page.goto(`${address}/?viewer&es`);
    const stage = page.locator(".aesthetic-stage");
    await expect(page.getByRole("button", { name: /Reproducir/ })).toHaveAttribute("aria-pressed", "false");
    await swipe(stage, -120, 0);
    await expect(stage).toContainText("Cocina.jpg");
    await expect(page.locator(".aesthetic-viewer")).toHaveCount(0);
    await stage.scrollIntoViewIfNeeded();
    const beforeScroll = await page.evaluate(() => scrollY);
    await swipe(stage, 0, -120);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(beforeScroll);
    await expect(stage).toContainText("Cocina.jpg");
    // Start the viewer scenario independently of the browser's native scroll fling.
    await page.reload();
    await stage.tap();
    const viewer = page.locator(".aesthetic-viewer-dialog");
    await expect(viewer).toHaveAttribute("aria-label", "Sala principal.jpg");
    await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
    await swipe(viewer.locator(".aesthetic-viewer-stage"), -120, 0);
    await expect(viewer).toHaveAttribute("aria-label", "Cocina.jpg");
    await viewer.getByRole("button", { name: "Foto anterior" }).tap();
    await expect(viewer).toHaveAttribute("aria-label", "Sala principal.jpg");
    for (const viewport of [{ width: 844, height: 390 }, { width: 667, height: 375 }]) {
      await page.setViewportSize(viewport);
      await expect(viewer).toHaveAttribute("aria-label", "Sala principal.jpg");
      const image = viewer.locator(".aesthetic-viewer-stage img");
      await expect(image).toHaveCSS("object-fit", "contain");
      const imageBox = (await image.boundingBox())!;
      expect(imageBox.height).toBeGreaterThan(150);
      expect(imageBox.x).toBeGreaterThanOrEqual(0);
      expect(imageBox.y).toBeGreaterThanOrEqual(0);
      expect(imageBox.x + imageBox.width).toBeLessThanOrEqual(viewport.width);
      expect(imageBox.y + imageBox.height).toBeLessThanOrEqual(viewport.height);
      for (const control of await viewer.locator(".aesthetic-viewer-toolbar button").all()) {
        const bounds = (await control.boundingBox())!;
        expect(bounds.width).toBeGreaterThanOrEqual(44); expect(bounds.height).toBeGreaterThanOrEqual(44);
        expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
      }
    }
    await page.screenshot({ path: "test-results/aesthetics-touch-landscape.png" });
    await viewer.getByRole("button", { name: "Notas de Sala principal.jpg" }).tap();
    const notes = page.getByRole("dialog", { name: "Notas de la imagen" });
    await expect(notes).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(notes).toHaveCount(0);
    await expect(viewer).toBeVisible();
    await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
    await viewer.getByRole("button", { name: "Cerrar imagen" }).tap();
    await expect(viewer).toHaveCount(0);
    await expect(stage).toBeFocused();
    await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
  } finally { await context.close(); }
});

test("edits image notes from gallery, carousel and viewer without changing captions or other images", async ({ page }) => {
  await page.goto(address);
  await expect(page.getByRole("button", { name: /Play/ })).toHaveAttribute("aria-pressed", "false");
  const gallery = page.locator(".aesthetic-gallery");
  const notes = page.getByRole("dialog", { name: "Image notes", exact: true });
  const initialNotes = "Keep natural light coming in.\nCombine light wood with warm textiles.";
  const savedNotes = "Revisar el acabado de la madera.\nPreferir iluminación cálida.\nConfirmar con el proveedor.";

  await gallery.getByRole("button", { name: "Notes for Main living room.jpg", exact: true }).click();
  await expect(notes).toContainText("Main living room.jpg");
  await expect(notes.getByLabel("Notes", { exact: true })).toHaveValue(initialNotes);
  await expect(notes.getByLabel("Notes", { exact: true })).toBeFocused();
  await expect(notes.getByLabel("Notes", { exact: true })).toHaveAttribute("maxlength", "5000");
  await notes.getByLabel("Notes", { exact: true }).fill(savedNotes);
  await notes.getByRole("button", { name: "Save notes", exact: true }).click();
  await expect(notes).toHaveCount(0);
  await expect(gallery).toContainText("Natural light and warm tones");
  await expect(page.locator(".aesthetic-drag-tray")).toHaveCount(0);

  await page.locator(".aesthetic-carousel").getByRole("button", { name: "Notes for Main living room.jpg", exact: true }).click();
  await expect(notes.getByLabel("Notes", { exact: true })).toHaveValue(savedNotes);
  await notes.getByLabel("Notes", { exact: true }).fill("This draft should be discarded.");
  await page.keyboard.press("Escape");
  await expect(notes.getByLabel("Notes", { exact: true })).toHaveValue("This draft should be discarded.");
  await notes.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.locator(".aesthetic-stage").click();
  const viewer = page.locator(".aesthetic-viewer");
  await expect(viewer).toBeVisible();
  await viewer.getByRole("button", { name: "Notes for Main living room.jpg", exact: true }).click();
  await expect(notes.getByLabel("Notes", { exact: true })).toHaveValue(savedNotes);
  await page.screenshot({ path: "test-results/aesthetics-notes-desktop.png" });
  await notes.getByLabel("Notes", { exact: true }).fill("");
  await notes.getByRole("button", { name: "Save notes", exact: true }).click();
  await expect(notes).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: "Notes for Main living room.jpg", exact: true })).toHaveAttribute("data-has-notes", "false");
  await viewer.getByRole("button", { name: "Notes for Main living room.jpg", exact: true }).click();
  await expect(notes.getByLabel("Notes", { exact: true })).toHaveValue("");
  await notes.getByRole("button", { name: "Cancel", exact: true }).click();
  await viewer.locator(".close").click();
  await expect(viewer).toHaveCount(0);

  await gallery.getByRole("button", { name: "Notes for Kitchen.jpg", exact: true }).click();
  await expect(notes.getByLabel("Notes", { exact: true })).toHaveValue("");
  await notes.getByLabel("Notes", { exact: true }).fill("Una nota solo para la cocina.");
  await notes.getByRole("button", { name: "Save notes", exact: true }).click();
  await gallery.getByRole("button", { name: "Notes for Main living room.jpg", exact: true }).click();
  await expect(notes.getByLabel("Notes", { exact: true })).toHaveValue("");
  await notes.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(gallery).toContainText("Light wood and stone");
});

test("shows image notes and the empty state to viewers without editing controls", async ({ page }) => {
  await page.goto(`${address}/?viewer`);
  await expect(page.getByRole("button", { name: /Play/ })).toHaveAttribute("aria-pressed", "false");
  await page.locator(".aesthetic-carousel").getByRole("button", { name: "Notes for Main living room.jpg", exact: true }).click();
  const notes = page.getByRole("dialog", { name: "Image notes", exact: true });
  await expect(notes).toContainText("Keep natural light coming in.");
  await expect(notes).toContainText("Combine light wood with warm textiles.");
  await expect(notes.locator("textarea")).toHaveCount(0);
  await expect(notes.getByRole("button", { name: "Save notes", exact: true })).toHaveCount(0);
  await notes.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator(".aesthetic-gallery").getByRole("button", { name: "Notes for Kitchen.jpg", exact: true }).click();
  await expect(notes).toContainText("No notes for this image yet.");
  await notes.getByRole("button", { name: "Close", exact: true }).click();
  await expect(notes).toHaveCount(0);
});

test("opens Spanish notes on mobile without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${address}/?es`);
  await page.locator(".aesthetic-gallery").getByRole("button", { name: "Notas de Cocina.jpg", exact: true }).click();
  const notes = page.getByRole("dialog", { name: "Notas de la imagen", exact: true });
  const mobileNotes = `Una observación con una referencia larga: ${"material".repeat(80)}\nConfirmar el acabado.`;
  await notes.getByLabel("Notas", { exact: true }).fill(mobileNotes);
  const bounds = await notes.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  const size = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
  expect(size.content).toBeLessThanOrEqual(size.viewport);
  await notes.getByRole("button", { name: "Guardar notas", exact: true }).click();
  await page.locator(".aesthetic-gallery").getByRole("button", { name: "Notas de Cocina.jpg", exact: true }).click();
  await expect(notes.getByLabel("Notas", { exact: true })).toHaveValue(mobileNotes);
  await page.screenshot({ path: "test-results/aesthetics-notes-mobile.png" });
  await notes.getByRole("button", { name: "Cancelar", exact: true }).click();
});

test("saves notes through the image API, restores them on reload and retains drafts after failed saves", async ({ page }) => {
  const stored = {
    folders: [{ id: "interior", name: "Interior", kind: "images", carouselImageIds: ["photo-1"], createdAt: "2026-08-01T12:00:00Z" }],
    images: [{ id: "photo-1", folderId: "interior", name: "Detalle.jpg", caption: "Caption remains unchanged", notes: "", mediaType: "image", contentType: "image/jpeg", width: 1200, height: 800, createdAt: "2026-08-01T12:00:00Z", imageUrl: "/og.png", thumbnailUrl: "/og.png" }],
  };
  const patches: Record<string, unknown>[] = [];
  let failNextSave = false;
  let delayedSave: Promise<void> | null = null;
  let finishSave = () => {};
  await page.route("**/api/aesthetics", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: stored });
      return;
    }
    const body = route.request().postDataJSON();
    patches.push(body);
    if (delayedSave) {
      const pending = delayedSave;
      delayedSave = null;
      await pending;
    }
    if (failNextSave) {
      failNextSave = false;
      await route.fulfill({ status: 503, json: { error: "Unable to save image notes" } });
      return;
    }
    stored.images[0].notes = body.notes;
    await route.fulfill({ json: { image: stored.images[0] } });
  });
  await page.goto(`${address}/?real`);
  const notes = page.getByRole("dialog", { name: "Image notes", exact: true });
  const savedNotes = "Primera observación.\nSegunda observación.";
  await page.locator(".aesthetic-gallery").getByRole("button", { name: "Notes for Detalle.jpg", exact: true }).click();
  await notes.getByLabel("Notes", { exact: true }).fill(savedNotes);
  delayedSave = new Promise<void>((resolve) => { finishSave = resolve; });
  await notes.getByRole("button", { name: "Save notes", exact: true }).click();
  try {
    await expect(notes.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
    await expect(notes).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(notes).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(notes).toBeFocused();
  } finally {
    finishSave();
  }
  await expect(notes).toHaveCount(0);
  expect(patches).toEqual([{ action: "notes", id: "photo-1", notes: savedNotes }]);
  await page.reload();
  await page.locator(".aesthetic-gallery").getByRole("button", { name: "Notes for Detalle.jpg", exact: true }).click();
  await expect(notes.getByLabel("Notes", { exact: true })).toHaveValue(savedNotes);
  const draft = "El borrador debe mantenerse.\nReintentar luego.";
  await notes.getByLabel("Notes", { exact: true }).fill(draft);
  failNextSave = true;
  await notes.getByRole("button", { name: "Save notes", exact: true }).click();
  await expect(notes.getByRole("alert")).toContainText("Unable to save image notes");
  await expect(notes.getByLabel("Notes", { exact: true })).toHaveValue(draft);
  expect(stored.images[0].notes).toBe(savedNotes);
  await notes.getByRole("button", { name: "Save notes", exact: true }).click();
  await expect(notes).toHaveCount(0);
  await expect(page.locator(".aesthetic-gallery")).toContainText("Caption remains unchanged");
  await page.reload();
  await page.locator(".aesthetic-carousel").getByRole("button", { name: "Notes for Detalle.jpg", exact: true }).click();
  await expect(notes.getByLabel("Notes", { exact: true })).toHaveValue(draft);
});
