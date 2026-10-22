import { expect, test, type Locator, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { mkdir, readFile } from "node:fs/promises";

// Keep the actual shell, folder routing, gallery and dialogs together. These
// tests use synthetic APIs and local image bytes, without Firebase or live AI.
let server: Server;
let address: string;
const projectId = "mobile-house";
const sections = ["overview", "activity", "budget", "quotes", "expenses", "documents", "notes", "aesthetics", "distribution", "approvals", "plan", "decisions", "site"];
const createdAt = "2026-10-11T12:00:00Z";
const image = (index: number, folderId = "interior") => ({
  id: `photo-${index}`, folderId, name: `Referencia ${String(index).padStart(2, "0")}.jpg`,
  caption: "Materiales y luz natural para la casa", notes: "Conservar las proporciones y confirmar los acabados.",
  width: 1200, height: 800, createdAt, mediaType: "image", contentType: "image/jpeg",
  imageUrl: "/mobile-photo.svg", thumbnailUrl: "/mobile-photo.svg",
});
const budgetLine = { id: "floor-1", row: 4, chapter: "Pisos", item: "Baldosa", type: "Construcción", subcategory: "Interior", objective: 100, excess: 0, quote: 100, paid: 20, supplier: "", status: "Pendiente" };
const workbook = {
  id: "official-budget", name: "Budget", sheetOrder: ["category-1"],
  sheets: { "category-1": { id: "category-1", name: "Pisos", rowCount: 30, columnCount: 26,
    cellData: {
      2: { 0: { v: "Chapter" }, 1: { v: "Item" }, 4: { v: "Objective" } },
      3: { 0: { v: "Pisos" }, 1: { v: "Baldosa" }, 2: { v: "Construcción" }, 3: { v: "Interior" }, 4: { v: 100 }, 6: { v: 100 }, 8: { v: "Pendiente" }, 9: { v: 20 }, 25: { v: "floor-1" } },
    }, rowData: {}, columnData: {}, mergeData: [],
  } },
};

test.beforeAll(async () => {
  await mkdir("test-results/mobile-experience", { recursive: true });
  const bundle = await build({
    stdin: {
      contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import HousePlanner from './app/HousePlanner';
        import {readWorkspaceDestination} from './lib/workspace-navigation';
        const params=new URLSearchParams(location.search);
        const user={name:'Mobile Tester',email:'mobile@example.test',projectId:'${projectId}',projectName:'Casa móvil',role:params.get('role')||'admin',permissions:Object.fromEntries(${JSON.stringify(sections)}.map(key=>[key,key!==params.get('deny')])),folderAccess:{mode:'all',folderIds:[],allowUnfiled:true}};
        localStorage.setItem('house-planner-language','es');
        createRoot(document.getElementById('root')).render(<HousePlanner mode="real" user={user} initialDestination={readWorkspaceDestination(location.href)} onSwitchMode={()=>{}} onSignOut={()=>{}}/>);
      `,
      resolveDir: process.cwd(), loader: "tsx",
    },
    bundle: true, write: false, loader: { ".webp": "dataurl" }, outfile: "mobile.js", platform: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "mobile-workspace-leaves", setup(builder) {
      builder.onResolve({ filter: /^next\/(image|dynamic)$/ }, args => ({ path: args.path, namespace: "mobile-mocks" }));
      builder.onResolve({ filter: /\/(AssistantPanel|GoogleSheetsEditing|ExpensesWorkspace|NotesWorkspace|QuotesWorkspace|MobileCapture|DistributionAdmin|ActivityWorkspace)$/ }, args => ({ path: args.path.split("/").pop()!, namespace: "mobile-mocks" }));
      builder.onLoad({ filter: /.*/, namespace: "mobile-mocks" }, args => {
        const contents = args.path === "next/image"
          ? "export default function Image({fill,priority,unoptimized,...props}){return <img {...props} style={fill?{position:'absolute',inset:0,width:'100%',height:'100%'}:{}}/>;}"
          : args.path === "next/dynamic"
            ? "export default ()=>function Distribution(){return <div>Modelo 3D</div>;}"
            : args.path === "ExpensesWorkspace"
              ? "export default function Leaf(){return null;} export function ExpenseDialog({children}){return <>{children}</>;} export function MediaPreview(){return null;}"
            : args.path === "ActivityWorkspace"
              ? "export default function Activity(){return <div>Actividad</div>;} export function ActivitySummaryCard(){return null;}"
              : "export default function Leaf(){return null;}";
        return { contents: `import React from 'react';${contents}`, loader: "tsx", resolveDir: process.cwd() };
      });
    } }],
  });
  const css = await readFile("app/globals.css", "utf8") + (bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text || "");
  server = createServer((request, response) => {
    if (request.url === "/mobile.js") {
      response.setHeader("content-type", "text/javascript");
      response.end(bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text);
    } else if (request.url === "/mobile-photo.svg") {
      response.setHeader("content-type", "image/svg+xml");
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="#e9e1d2"/><rect x="80" y="90" width="430" height="390" fill="#abc5b4"/><rect x="620" y="320" width="440" height="330" rx="30" fill="#b78461"/><path d="M0 680H1200" stroke="#c9b494" stroke-width="240"/></svg>');
    } else {
      response.setHeader("content-type", "text/html");
      response.end(`<html><meta name="viewport" content="width=device-width, initial-scale=1"><style>html{--font-geist-sans:Arial;--font-geist-mono:monospace}${css}</style><div id="root"></div><script src="/mobile.js"></script></html>`);
    }
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

test.afterAll(async () => { if (server) await new Promise<void>(done => server.close(() => done())); });

async function mockProject(page: Page, options: { failSave?: () => boolean } = {}) {
  const payload = {
    folders: [
      { id: "interior", name: "Interior", kind: "images", parentId: null, sortOrder: 0, carouselImageIds: ["photo-1", "photo-2"], createdAt },
      { id: "kitchen", name: "Cocina y materiales", kind: "images", parentId: "interior", sortOrder: 1, carouselImageIds: [], createdAt },
      { id: "exterior", name: "Exterior", kind: "images", parentId: null, sortOrder: 2, carouselImageIds: ["photo-19"], createdAt },
    ],
    images: [...Array.from({ length: 18 }, (_, index) => image(index + 1)), image(19, "exterior"), image(20, "kitchen")],
  };
  const errors: string[] = [];
  const aestheticPatches: Record<string, unknown>[] = [];
  const savedWorkbooks: unknown[] = [];
  let revision = 1;
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/workbook/drafts") {
      const body = request.postDataJSON();
      if (body.action === "save") {
        if (options.failSave?.()) return route.fulfill({ status: 500, json: { error: "Guardado de prueba fallido" } });
        savedWorkbooks.push(body.workbook);
        return route.fulfill({ json: { revision: ++revision } });
      }
      return route.fulfill({ json: { id: "mobile-draft", revision, workbook, rowMaps: { Pisos: { 4: 4 } } } });
    }
    if (path === "/api/aesthetics" && request.method() === "PATCH") {
      const body = request.postDataJSON();
      aestheticPatches.push(body);
      const current = payload.images.find(item => item.id === body.id);
      if (body.action === "notes" && current) current.notes = body.notes;
      if (body.action === "move_image" && current) current.folderId = body.folderId;
      return route.fulfill({ json: { image: current } });
    }
    const data: Record<string, unknown> = {
      "/api/aesthetics": payload,
      "/api/projects": { projects: [{ id: projectId, name: "Casa móvil", kind: "shared", role: "admin", active: true }], canCreateProjects: false },
      "/api/budget": { currency: "CRC", objective: 100, excess: 0, spent: 20, remaining: 80, percentUsed: 20, status: "within_objective", editingAllowed: true, planVersion: 1, actualsRevision: 0, sheetCount: 1, rowCount: 4, unsupported: [], lines: [budgetLine], summaries: { chapter: [{ label: "Pisos", objective: 100, excess: 0, spent: 20, count: 1 }], type: [], subcategory: [] } },
      "/api/workbook/editor": { workbook, rowMaps: { Pisos: { 4: 4 } } },
      "/api/property-profile": { profile: null },
      "/api/files": { documents: [] }, "/api/folders": { folders: [] },
      "/api/plan": { items: [] }, "/api/countdowns": { countdowns: [] },
      "/api/notifications": { configured: false, sender: "", emailEnabled: true, recipients: [] },
      "/api/decisions": { decisions: [] }, "/api/site-issues": { issues: [] },
      "/api/approvals": { approvals: [] }, "/api/access": { users: [], canGrantProjectCreation: false },
      "/api/invitations": { invitations: [] }, "/api/house-distribution": { ready: true },
      "/api/overview": { imageIds: [], noteIds: [] }, "/api/notes": { notes: [] },
      "/api/events/documents": { version: 1 }, "/api/usage/events": { accepted: 1 },
    };
    await route.fulfill({ json: data[path] || {} });
  });
  return { payload, errors, savedWorkbooks, aestheticPatches };
}

async function openGallery(page: Page) {
  await page.goto(`${address}/projects/${projectId}/aesthetics/folder/interior`);
  await expect(page.locator(".aesthetic-grid article")).toHaveCount(18);
}

async function expectNoHorizontalOverflow(page: Page) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(page.viewportSize()!.width);
}

async function positionForPan(page: Page, target: Locator) {
  await target.evaluate(element => element.scrollIntoView({ block: "center", inline: "nearest" }));
  const bounds = await target.boundingBox();
  expect(bounds).not.toBeNull();
  const x = Math.round(bounds!.x + Math.min(bounds!.width / 2, 70));
  const y = Math.round(bounds!.y + bounds!.height / 2);
  // Assert the touch starts inside the target rather than the sticky header or
  // fixed navigation; wheel/scrollIntoView alone cannot catch touch-action:none.
  const inside = await target.evaluate((element, point) => element.contains(document.elementFromPoint(point.x, point.y)), { x, y });
  expect(inside).toBe(true);
  return { x, y };
}

async function touchPan(page: Page, target: Locator) {
  const { x, y } = await positionForPan(page, target);
  const before = await page.evaluate(() => window.scrollY);
  // Movement alone does not establish that Chromium completed its native
  // scrolling gesture and can activate the next touch control.
  const completion = await page.evaluateHandle(() => {
    const state = { released: false, ended: false };
    const onEnd = () => { if (state.released) state.ended = true; };
    document.addEventListener("scrollend", onEnd);
    return { state, onEnd };
  });
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 0, radiusX: 4, radiusY: 4, force: 1 }] });
    try {
      for (let step = 1; step <= 8; step++) {
        await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - step * 15, id: 0, radiusX: 4, radiusY: 4, force: 1 }] });
        await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => done())));
      }
    } finally {
      await completion.evaluate(({ state }) => { state.released = true; });
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before + 45);
    await expect.poll(() => completion.evaluate(({ state }) => state.ended), { message: "Native page scroll did not finish after touch release" }).toBe(true);
    await expect(page.locator(".aesthetic-drag-tray")).toHaveCount(0);
    await expect(page.locator(".aesthetic-viewer")).toHaveCount(0);
  } finally {
    await session.detach();
    await completion.evaluate(({ onEnd }) => document.removeEventListener("scrollend", onEnd));
    await completion.dispose();
  }
}

test.describe("touch mobile experience in the real shell", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test.skip(({ browserName }) => browserName !== "chromium", "Native touch-pan regression uses Chromium CDP.");

  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 700 }, { width: 844, height: 390 }]) {
    test(`editor can swipe photos and card details at ${viewport.width}×${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const { errors } = await mockProject(page);
      await openGallery(page);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `test-results/mobile-experience/top-${viewport.width}.png` });
      await touchPan(page, page.locator(".aesthetic-grid article").nth(4).locator(".aesthetic-grid-image"));
      await touchPan(page, page.locator(".aesthetic-grid article").nth(7).locator(".aesthetic-image-details b"));
      await page.screenshot({ path: `test-results/mobile-experience/gallery-${viewport.width}.png` });
      const lastImage = page.locator(".aesthetic-grid article").last().locator(".aesthetic-grid-image");
      await lastImage.scrollIntoViewIfNeeded();
      await expect(lastImage).toBeInViewport();
      await lastImage.tap();
      await expect(page.getByRole("dialog", { name: "Referencia 18.jpg", exact: true })).toBeVisible();
      await page.screenshot({ path: `test-results/mobile-experience/viewer-${viewport.width}.png` });
      const close = page.getByRole("button", { name: "Cerrar imagen", exact: true });
      await expect(close).toBeInViewport();
      await close.tap();
      await expect(page.locator(".aesthetic-viewer")).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    });
  }

  test("compact folder picker keeps photos reachable and respects folder history", async ({ page }) => {
    const { errors } = await mockProject(page);
    await openGallery(page);
    const picker = page.locator(".aesthetic-mobile-folder-picker").getByRole("combobox", { name: "Carpeta", exact: true });
    await expect(picker).toHaveValue("interior");
    await expect(page.locator(".aesthetic-folder-strip")).toBeHidden();
    await picker.selectOption("kitchen");
    await expect(page).toHaveURL(new RegExp(`/aesthetics/folder/kitchen$`));
    await expect(page.locator(".aesthetic-grid article")).toHaveCount(1);
    await expect(page.locator(".aesthetic-grid")).toContainText("Referencia 20.jpg");
    await picker.selectOption("exterior");
    await expect(page.locator(".aesthetic-grid")).toContainText("Referencia 19.jpg");
    await page.goBack();
    await expect(picker).toHaveValue("kitchen");
    await expect(page.locator(".aesthetic-grid")).toContainText("Referencia 20.jpg");
    await page.goBack();
    await expect(picker).toHaveValue("interior");
    await expect(page.locator(".aesthetic-grid article")).toHaveCount(18);
    await expectNoHorizontalOverflow(page);
    const topbar = await page.locator(".topbar").boundingBox();
    expect(topbar!.height).toBeLessThanOrEqual(88);
    const carousel = await page.locator(".aesthetic-carousel").boundingBox();
    expect(carousel!.y).toBeLessThan(500);
    expect(errors).toEqual([]);
  });

  test("closing nested image notes and the viewer restores gallery touch scroll", async ({ page }) => {
    const { errors } = await mockProject(page);
    await openGallery(page);
    const card = page.locator(".aesthetic-grid article").nth(4);
    await card.locator(".aesthetic-grid-image").tap();
    const viewer = page.getByRole("dialog", { name: "Referencia 05.jpg", exact: true });
    await expect(viewer).toBeVisible();
    const beforeNotes = await page.evaluate(() => document.body.style.overflow);
    await viewer.getByRole("button", { name: "Notas de Referencia 05.jpg", exact: true }).tap();
    const notes = page.getByRole("dialog", { name: "Notas de la imagen", exact: true });
    await expect(notes).toBeVisible();
    await notes.getByLabel("Notas", { exact: true }).fill("Confirmar madera clara y mantener luz natural.");
    await notes.getByRole("button", { name: "Guardar notas", exact: true }).tap();
    await expect(notes).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe(beforeNotes);
    await viewer.getByRole("button", { name: "Cerrar imagen", exact: true }).tap();
    await touchPan(page, card.locator(".aesthetic-grid-image"));
    await card.getByRole("button", { name: "Notas de Referencia 05.jpg", exact: true }).tap();
    await expect(notes.getByLabel("Notas", { exact: true })).toHaveValue("Confirmar madera clara y mantener luz natural.");
    await notes.getByRole("button", { name: "Cancelar", exact: true }).tap();
    await touchPan(page, page.locator(".aesthetic-grid article").nth(7).locator(".aesthetic-grid-image"));
    expect(errors).toEqual([]);
  });

  test("labeled mobile navigation opens all sections and closes without trapping scroll", async ({ page }) => {
    const { errors } = await mockProject(page);
    await openGallery(page);
    const navigation = page.getByRole("navigation", { name: "Secciones del proyecto", exact: true });
    await expect(navigation.getByRole("button", { name: "Estética", exact: true })).toHaveAttribute("aria-current", "page");
    const sectionMenu = navigation.getByRole("button", { name: "Secciones", exact: true });
    await expect(sectionMenu).toBeInViewport();
    const menuBounds = await navigation.boundingBox();
    expect(menuBounds!.height).toBeLessThanOrEqual(90);
    await sectionMenu.tap();
    const chooser = page.getByRole("dialog", { name: "Secciones", exact: true });
    await expect(chooser).toBeVisible();
    await page.screenshot({ path: "test-results/mobile-experience/sections-390.png" });
    await expect(chooser.getByRole("button", { name: "Progreso de obra", exact: true })).toBeInViewport();
    await chooser.getByRole("button", { name: "Cerrar secciones", exact: true }).tap();
    await expect(chooser).not.toBeVisible();
    await touchPan(page, page.locator(".aesthetic-grid article").nth(4).locator(".aesthetic-grid-image"));
    await sectionMenu.tap();
    await chooser.getByRole("button", { name: "Plan y cronograma", exact: true }).tap();
    await expect(page.locator(".topbar h1")).toHaveText("Plan y cronograma");
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await expect(chooser).not.toBeVisible();
    await navigation.getByRole("button", { name: "Estética", exact: true }).tap();
    await expect(page.locator(".aesthetic-grid article")).toHaveCount(18);
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test("short landscape dialogs keep notes and folder actions reachable", async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    const { errors } = await mockProject(page);
    await openGallery(page);
    const card = page.locator(".aesthetic-grid article").nth(4);
    await card.locator(".aesthetic-grid-image").tap();
    const viewer = page.getByRole("dialog", { name: "Referencia 05.jpg", exact: true });
    await viewer.getByRole("button", { name: "Notas de Referencia 05.jpg", exact: true }).tap();
    const notes = page.getByRole("dialog", { name: "Notas de la imagen", exact: true });
    await expect(notes).toBeVisible();
    const noteBounds = await notes.boundingBox();
    expect(noteBounds!.y).toBeGreaterThanOrEqual(0);
    expect(noteBounds!.y + noteBounds!.height).toBeLessThanOrEqual(390);
    await notes.getByRole("button", { name: "Cancelar", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/mobile-experience/notes-landscape.png" });
    await notes.getByRole("button", { name: "Cancelar", exact: true }).tap();
    await viewer.getByRole("button", { name: "Cerrar imagen", exact: true }).tap();
    await touchPan(page, card.locator(".aesthetic-grid-image"));
    await page.getByRole("button", { name: /Nueva subcarpeta/ }).tap();
    const folder = page.getByRole("dialog", { name: "Crear carpeta", exact: true });
    await folder.getByRole("button", { name: "Cancelar", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/mobile-experience/folder-landscape.png" });
    await folder.getByRole("button", { name: "Cancelar", exact: true }).tap();
    await expect(folder).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test("section chooser only exposes the member's permitted destinations", async ({ page }) => {
    const { errors } = await mockProject(page);
    await page.goto(`${address}/projects/${projectId}/aesthetics/folder/interior?role=viewer&deny=plan`);
    await expect(page.locator(".aesthetic-grid article")).toHaveCount(18);
    await page.locator(".mobile-workspace-nav").getByRole("button", { name: "Secciones", exact: true }).tap();
    const chooser = page.getByRole("dialog", { name: "Secciones", exact: true });
    await expect(chooser.getByRole("button", { name: "Plan y cronograma", exact: true })).toHaveCount(0);
    await expect(chooser.getByRole("button", { name: "Acceso", exact: true })).toHaveCount(0);
    await expect(chooser.getByRole("button", { name: "Uso de la app", exact: true })).toHaveCount(0);
    await expect(chooser.getByRole("button", { name: "Estética", exact: true })).toHaveAttribute("aria-current", "page");
    await chooser.getByRole("button", { name: "Cerrar secciones", exact: true }).tap();
    expect(errors).toEqual([]);
  });

  test("closing the section chooser preserves budget edits when saving fails and retries safely", async ({ page }) => {
    let failSave = true;
    const { errors, savedWorkbooks } = await mockProject(page, { failSave: () => failSave });
    await page.goto(`${address}/projects/${projectId}/budget/chapter/Pisos?role=editor`);
    const amount = page.getByRole("spinbutton", { name: "Baldosa Objetivo", exact: true });
    await expect(amount).toHaveValue("100");
    await amount.fill("999");
    const menu = page.locator(".mobile-workspace-nav").getByRole("button", { name: "Secciones", exact: true });
    await menu.tap();
    const chooser = page.getByRole("dialog", { name: "Secciones", exact: true });
    await chooser.getByRole("button", { name: "Plan y cronograma", exact: true }).tap();
    await expect(chooser).not.toBeVisible();
    await expect(page.getByText("Guardado de prueba fallido", { exact: false }).first()).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/budget/chapter/Pisos\\?role=editor$`));
    await expect(amount).toHaveValue("999");
    failSave = false;
    await menu.tap();
    await chooser.getByRole("button", { name: "Plan y cronograma", exact: true }).tap();
    await expect(page.locator(".topbar h1")).toHaveText("Plan y cronograma");
    await expect(chooser).not.toBeVisible();
    const saved = savedWorkbooks.at(-1) as typeof workbook;
    expect(saved.sheets["category-1"].cellData[3][4].v).toBe(999);
    expect(errors).toEqual([]);
  });
});

test("desktop mouse dragging still works and pointer cancellation clears the tray", async ({ page }) => {
  const { errors } = await mockProject(page);
  await openGallery(page);
  const photo = page.locator(".aesthetic-grid article").nth(4).locator(".aesthetic-grid-image");
  await photo.scrollIntoViewIfNeeded();
  const bounds = await photo.boundingBox();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  await expect(page.locator(".aesthetic-drag-tray")).toBeVisible();
  await page.mouse.up();
  await expect(page.locator(".aesthetic-drag-tray")).toHaveCount(0);
  await page.getByRole("button", { name: "Cerrar imagen", exact: true }).click();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  await expect(page.locator(".aesthetic-drag-tray")).toBeVisible();
  await photo.dispatchEvent("pointercancel", { pointerType: "mouse", pointerId: 1, bubbles: true });
  await expect(page.locator(".aesthetic-drag-tray")).toHaveCount(0);
  await page.mouse.up();
  expect(errors).toEqual([]);
});

test("desktop native gallery drag survives pointer cancellation and Escape cancels without moving the image", async ({ page }) => {
  const { errors, payload, aestheticPatches } = await mockProject(page);
  await openGallery(page);
  const card = page.locator(".aesthetic-grid article").nth(4);
  const handle = card.locator(".aesthetic-card-drag-handle");
  await handle.scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const events: string[] = [];
    Object.assign(window, { nativeGalleryDragEvents: events });
    document.addEventListener("dragstart", event => {
      if ((event.target as HTMLElement).closest(".aesthetic-card-drag-handle")) events.push("dragstart");
    }, true);
    document.addEventListener("pointercancel", () => events.push("pointercancel"), true);
  });
  const source = await handle.boundingBox();
  expect(source).not.toBeNull();
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
  await page.mouse.down();
  try {
    // Exceed the browser's native drag threshold. Native HTML dragstart cancels
    // its pointer stream; the tray must remain available until dragend/drop.
    await page.mouse.move(source!.x - 45, source!.y + source!.height + 45, { steps: 8 });
    await expect.poll(() => page.evaluate(() => (window as unknown as { nativeGalleryDragEvents: string[] }).nativeGalleryDragEvents)).toEqual(["dragstart", "pointercancel"]);
    await expect(page.locator(".aesthetic-drag-tray")).toBeVisible();
    await expect(card).toHaveClass(/dragging/);
    await page.keyboard.press("Escape");
  } finally {
    await page.mouse.up();
  }
  await expect(page.locator(".aesthetic-drag-tray")).toHaveCount(0);
  await expect(card).not.toHaveClass(/dragging/);
  await expect(page.locator(".aesthetic-grid article")).toHaveCount(18);
  expect(payload.images.find(item => item.id === "photo-5")!.folderId).toBe("interior");
  expect(aestheticPatches).toEqual([]);
  expect(errors).toEqual([]);
});
