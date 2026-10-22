import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";

// The complete public demo runs on an isolated random localhost port. Only browser
// adapters and tracking are mocked; the actual workspaces and seed projections render.
let server: Server, address: string;
test.beforeAll(async () => {
  const bundle = await build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import AuthGateway from './app/AuthGateway';const value=new URLSearchParams(location.search).get('lang');const lang=value==='es'||value==='en'?value:undefined;createRoot(document.getElementById('root')).render(<AuthGateway initialUser={null} initialMode="demo" initialInvite="" initialLanguage={lang}/>);`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, loader: { ".webp": "dataurl" }, outfile: "demo-localization.js", platform: "browser", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "local-demo-browser-adapters", setup(builder) {
      builder.onResolve({ filter: /^(next\/(image|dynamic)|firebase\/auth|@\/lib\/firebase-client|@\/lib\/usage-client)$/ }, args => ({ path: args.path, namespace: "demo-adapters" }));
      builder.onLoad({ filter: /.*/, namespace: "demo-adapters" }, args => {
        const content = args.path === "next/image" ? "export default function Image({fill,priority,unoptimized,...props}){return <img {...props}/>;}"
          : args.path === "next/dynamic" ? "export default ()=>function OptionalDynamic(){return null;}"
          : args.path === "firebase/auth" ? "export const createUserWithEmailAndPassword=async()=>{},signInWithEmailAndPassword=async()=>{},signInWithPopup=async()=>{},signOut=async()=>{},updateProfile=async()=>{},sendEmailVerification=async()=>{};export class GoogleAuthProvider{}"
          : args.path === "@/lib/firebase-client" ? "export const firebaseAuth={};"
          : "export const useUsageTracking=()=>{},flushUsageBeforeTransition=async()=>{},trackDemoAction=()=>{},trackUsageInteraction=()=>{};";
        return { contents: `import React from 'react';${content}`, loader: "tsx", resolveDir: process.cwd() };
      });
    } }],
  });
  const script = bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  const css = await readFile("app/globals.css", "utf8") + (bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text || "");
  server = createServer(async (request, response) => {
    const path = new URL(request.url || "/", "http://demo.local").pathname;
    if (path === "/demo-localization.js") { response.setHeader("content-type", "text/javascript"); response.end(script); return; }
    if (path === "/og.png" || /^\/demo\/[a-zA-Z0-9_.-]+$/.test(path)) {
      try { response.setHeader("content-type", path.endsWith(".png") ? "image/png" : "text/plain; charset=utf-8"); response.end(await readFile(`public${path}`)); }
      catch { response.writeHead(404); response.end("Missing synthetic fixture"); } return;
    }
    if (path.startsWith("/api/")) { response.writeHead(403, { "content-type": "application/json" }); response.end(JSON.stringify({ error: "No project API in public demo harness" })); return; }
    response.setHeader("content-type", "text/html");
    response.end(`<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><style>html{--font-geist-sans:Arial;--font-geist-mono:monospace}${css}</style><div id="root"></div><script src="/demo-localization.js"></script></html>`);
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>(done => server.close(() => done())); });

const menus = {
  overview: ["Overview", "Resumen"], budget: ["Budget", "Presupuesto"], expenses: ["Purchases/Expenses", "Compras/Gastos"],
  documents: ["Documents", "Documentos"], approvals: ["Approvals", "Aprobaciones"], plan: ["Plan & schedule", "Plan y cronograma"],
  decisions: ["Decisions", "Decisiones"], site: ["Site progress", "Progreso de obra"], activity: ["Activity", "Actividad"], aesthetics: ["Aesthetics", "Estética"],
} as const;
async function locale(page: Page, language: "en" | "es") {
  await page.getByRole("button", { name: language.toUpperCase(), exact: true }).click();
}
async function section(page: Page, name: keyof typeof menus, language: "en" | "es") {
  await page.locator(".sidebar nav").getByRole("button", { name: menus[name][language === "es" ? 1 : 0], exact: false }).click();
}
async function openDemo(page: Page, language: "en" | "es" = "en") {
  await page.goto(`${address}/?mode=demo&lang=${language}`);
  await expect(page.locator(".demo-banner")).toBeVisible();
}

test("@entry the actual Next public entry honors an explicit Spanish demo URL", async ({ page }) => {
  await page.goto("/?mode=demo&lang=es");
  await expect(page.locator(".sidebar .project-switcher")).toContainText("Casa Mirador");
  await section(page, "plan", "es");
  await expect(page.locator(".countdown-copy")).toContainText("Confirmar acabados de cocina");
  await expect(page.locator(".plan-card").first()).toContainText("Cimentación y losa");
});

test("@entry the English demo presents USD in the README views", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?mode=demo&lang=en");
  await expect(page.locator(".sidebar .project-switcher")).toContainText("Mirador House");
  await expect(page.locator(".demo-banner")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: testInfo.outputPath("demo-overview.png"), animations: "disabled" });
  await section(page, "budget", "en");
  await expect(page.locator(".page-intro .overline")).toContainText("USD");
  await expect(page.locator(".budget-metrics")).toContainText("$55,000");
  await expect(page.locator(".budget-dashboard")).not.toContainText(/CRC|₡/);
  await page.screenshot({ path: testInfo.outputPath("demo-budget.png"), animations: "disabled" });
});

test("fresh demo visits default to English while retaining a chosen Spanish preference", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "language", { get: () => "es-CR" }));
  await page.goto(`${address}/?mode=demo`);
  await expect(page.locator(".demo-banner")).toContainText("Explore, edit and download freely");
  await expect(page.locator(".sidebar .project-switcher")).toContainText("Mirador House");
  await locale(page, "es");
  await page.goto(`${address}/?mode=demo`);
  await expect(page.locator(".sidebar .project-switcher")).toContainText("Casa Mirador");
});

test("demo USD amounts stay consistent across sections and downloadable examples", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openDemo(page);
  await expect(page.locator(".sidebar")).toContainText(/Demo visitor/i);
  await section(page, "budget", "en");
  await expect(page.locator(".page-intro .overline")).toContainText("USD");
  await expect(page.locator(".budget-metrics")).toContainText("$55,000");
  await expect(page.locator(".budget-dashboard")).not.toContainText(/CRC|₡/);
  await page.getByRole("button", { name: "Edit budget", exact: true }).click();
  await expect(page.locator(".budget-table-editor thead")).toContainText("Objective · USD");
  await expect(page.getByRole("spinbutton", { name: "Concrete and reinforcement Objective", exact: true })).toHaveValue("30000");
  await page.getByRole("button", { name: "← Dashboard", exact: true }).click();
  await section(page, "expenses", "en");
  await expect(page.locator(".expenses-page")).not.toContainText(/CRC|₡/);
  await section(page, "approvals", "en");
  await expect(page.locator(".approval-before").first()).toContainText("$");
  await expect(page.locator(".content")).not.toContainText(/CRC|₡/);
  await section(page, "activity", "en");
  await expect(page.locator(".activity-change-list").filter({ hasText: "$400" })).toContainText("$500");
  await expect(page.locator(".content")).not.toContainText(/CRC|₡/);
  for (const name of ["Demo_Quote.txt", "Demo_Invoice.txt", "Cotizacion_demo.txt", "Factura_demo.txt"]) {
    const contents = await (await page.request.get(`${address}/demo/${name}`)).text();
    expect(contents).toContain("USD");
    expect(contents).not.toMatch(/CRC|₡/);
  }
  await locale(page, "es");
  await section(page, "budget", "es");
  await expect(page.locator(".page-intro .overline")).toContainText("USD");
  await expect(page.locator(".budget-dashboard")).not.toContainText(/CRC|₡/);
});

test("owned demo content follows EN and ES across every primary section without project requests", async ({ page }) => {
  const requests: string[] = [];
  await page.route("**/api/**", route => { requests.push(route.request().url()); return route.fulfill({ status: 403, json: { error: "Unexpected project request" } }); });
  await openDemo(page);
  await section(page, "documents", "en");
  await page.getByRole("button", { name: "Open Quotes", exact: true }).click();
  const contents = {
    overview: ["RENDERED FROM THE 3D MODEL", "RENDER DEL MODELO 3D"],
    approvals: ["20% labor adjustment and scope review", "Ajuste de mano de obra del 20% y revisión del alcance"],
    plan: ["Foundation and slab", "Cimentación y losa"],
    decisions: ["Countertop material", "Material de la encimera"],
    site: ["Water pooling near temporary entrance", "Acumulación de agua junto a la entrada temporal"],
    activity: ["Kitchen_invoice.pdf", "Factura_cocina.pdf"],
  } as const;
  for (const language of ["en", "es", "en"] as const) {
    await locale(page, language);
    for (const name of Object.keys(contents) as Array<keyof typeof contents>) {
      await section(page, name, language);
      await expect(page.locator(".content")).toContainText(contents[name][language === "es" ? 1 : 0]);
      if (name === "plan") await expect(page.locator(".countdown-copy")).toContainText(language === "es" ? "Confirmar acabados de cocina" : "Confirm kitchen finishes");
    }
    await section(page, "documents", language);
    await expect(page.locator(".doc-row")).toContainText(language === "es" ? "Cotizacion_demo.txt" : "Demo_Quote.txt");
  }
  expect(requests).toEqual([]);
});

test("a selected plan phase, unsaved edits, dates and saved custom text survive locale changes", async ({ page }) => {
  await openDemo(page); await section(page, "plan", "en");
  const filter = page.getByLabel("Filter by phase", { exact: true });
  await filter.selectOption({ label: "Structure" }); const phaseKey = await filter.inputValue();
  const card = page.locator(".plan-card"); await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.locator(".editor-panel");
  const dates = await editor.locator('input[type="date"]').evaluateAll(fields => fields.map(field => (field as HTMLInputElement).value));
  await editor.getByLabel("Title", { exact: true }).fill("My bilingual visit task");
  await editor.getByLabel("Notes").fill("My note stays exactly as typed.");
  await locale(page, "es");
  await expect(page.getByLabel("Filtrar por fase", { exact: true })).toHaveValue(phaseKey);
  await expect(card).toHaveCount(1);
  await expect(editor.getByLabel("Título", { exact: true })).toHaveValue("My bilingual visit task");
  expect(await editor.locator('input[type="date"]').evaluateAll(fields => fields.map(field => (field as HTMLInputElement).value))).toEqual(dates);
  await editor.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(card).toContainText("My bilingual visit task");
  await locale(page, "en");
  await expect(filter).toHaveValue(phaseKey); await expect(card).toHaveCount(1);
  await expect(card).toContainText("My note stays exactly as typed.");
  await card.getByRole("button", { name: "Edit", exact: true }).click();
  expect(await editor.locator('input[type="date"]').evaluateAll(fields => fields.map(field => (field as HTMLInputElement).value))).toEqual(dates);
});

test("budget row values stay intact when category labels change language", async ({ page }) => {
  await openDemo(page); await section(page, "budget", "en");
  await page.getByRole("button", { name: "Edit budget", exact: true }).click();
  const objective = page.getByRole("spinbutton", { name: "Concrete and reinforcement Objective", exact: true });
  await objective.fill("123456");
  const rowCount = await page.locator(".budget-table-editor tbody tr").count();
  await locale(page, "es");
  await expect(page.getByRole("spinbutton", { name: "Concreto y refuerzo Objetivo", exact: true })).toHaveValue("123456");
  await expect(page.locator(".budget-table-editor tbody tr")).toHaveCount(rowCount);
  await locale(page, "en"); await expect(objective).toHaveValue("123456");
});

test("expense tabs localize the same purchases, documents and paid-line relationships", async ({ page }) => {
  await openDemo(page); await section(page, "expenses", "en");
  for (const language of ["en", "es", "en"] as const) {
    await locale(page, language);
    await page.locator(".expense-tabs").getByRole("button", { name: language === "es" ? "Productos" : "Products", exact: false }).click();
    await expect(page.locator(".purchase-card")).toHaveCount(1);
    await expect(page.locator(".purchase-card")).toContainText(language === "es" ? "Grifería para cocina" : "Kitchen faucet");
    await page.locator(".expense-tabs").getByRole("button", { name: language === "es" ? "Comprobantes" : "Documents", exact: false }).click();
    await expect(page.locator(".document-card")).toHaveCount(1);
    await expect(page.locator(".document-card")).toContainText(language === "es" ? "Factura grifería" : "Faucet invoice");
    await page.locator(".expense-tabs").getByRole("button", { name: language === "es" ? "Partidas pagadas" : "Paid lines", exact: false }).click();
    await expect(page.locator(".paid-line")).toHaveCount(1);
    await expect(page.locator(".paid-line")).toContainText(language === "es" ? "Muebles de cocina" : "Kitchen cabinetry");
  }
});

test("aesthetic seed labels translate while custom image notes and carousel membership remain intact", async ({ page }) => {
  await openDemo(page); await section(page, "aesthetics", "en");
  await expect(page.locator(".aesthetic-thumbnail-card")).toHaveCount(3);
  await page.locator(".aesthetic-gallery").getByRole("button", { name: "Notes for Main living room.jpg", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Image notes", exact: true });
  await dialog.getByLabel("Notes", { exact: true }).fill("My uploaded style note stays in its own language.");
  await dialog.getByRole("button", { name: "Save notes", exact: true }).click();
  await locale(page, "es");
  await expect(page.locator(".aesthetic-stage")).toContainText("Sala principal.jpg");
  await expect(page.locator(".aesthetic-thumbnail-card")).toHaveCount(3);
  await page.locator(".aesthetic-gallery").getByRole("button", { name: "Notas de Sala principal.jpg", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Notas de la imagen", exact: true });
  await expect(dialog.getByLabel("Notas", { exact: true })).toHaveValue("My uploaded style note stays in its own language.");
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await locale(page, "en");
  await expect(page.locator(".aesthetic-stage")).toContainText("Main living room.jpg");
  await expect(page.locator(".aesthetic-thumbnail-card")).toHaveCount(3);
});


test("applied template tasks keep their dependency graph, dates and identity when language changes", async ({ page }) => {
  await openDemo(page); await section(page, "plan", "en");
  await page.getByRole("button", { name: /Templates/ }).click();
  const catalog = page.getByRole("dialog", { name: "Plan templates", exact: true });
  await expect(catalog).toContainText("Costa Rica construction plan");
  await catalog.locator(".template-option").filter({ hasText: "Basic home build" }).getByRole("button", { name: "Use template", exact: true }).click();
  const start = page.getByRole("dialog", { name: "Project start date", exact: true });
  await start.getByLabel("Start date", { exact: true }).fill("2026-11-01");
  await start.getByRole("button", { name: "Apply template", exact: true }).click();
  await expect(page.locator(".plan-card")).toHaveCount(7);
  const foundation = page.locator(".plan-card").filter({ has: page.getByRole("heading", { name: "Foundation", exact: true }) });
  await expect(foundation.locator(".project-deps")).toContainText("Site preparation");
  const sameCard = await foundation.elementHandle();
  await foundation.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.locator(".editor-panel");
  const dates = await editor.locator('input[type="date"]').evaluateAll(fields => fields.map(field => (field as HTMLInputElement).value));
  expect(dates[0]).toBe("2026-11-11");
  await editor.getByRole("button", { name: "Close editor", exact: true }).click();
  await locale(page, "es");
  await expect(page.locator(".plan-card")).toHaveCount(7);
  const translated = page.locator(".plan-card").filter({ has: page.getByRole("heading", { name: "Cimentación", exact: true }) });
  await expect(translated.locator(".project-deps")).toContainText("Preparación del terreno");
  await expect(translated.locator(".project-notes")).toContainText("Encofrar, reforzar, colar y curar la cimentación.");
  expect(await sameCard!.evaluate(card => card.isConnected)).toBe(true);
  await translated.getByRole("button", { name: "Editar", exact: true }).click();
  expect(await editor.locator('input[type="date"]').evaluateAll(fields => fields.map(field => (field as HTMLInputElement).value))).toEqual(dates);
  await editor.getByRole("button", { name: "Cerrar editor", exact: true }).click();
  await locale(page, "en");
  await expect(foundation.locator(".project-deps")).toContainText("Site preparation");
  await expect(page.locator(".plan-card")).toHaveCount(7);
});
