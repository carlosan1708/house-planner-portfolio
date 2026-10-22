import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";

// Real DocumentSearch + HousePlanner, synthetic metadata and mocked semantic
// responses only. No cloud, document content extraction or live AI calls.
let server: Server, address: string;
test.beforeAll(async () => {
  const bundle = await build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import HousePlanner from './app/HousePlanner';import {readWorkspaceDestination} from './lib/workspace-navigation';
      const params=new URLSearchParams(location.search),mode=params.get('mode')==='demo'?'demo':'real',language=params.get('lang')==='en'?'en':'es';localStorage.setItem('house-planner-language',language);
      const keys=['overview','activity','budget','quotes','expenses','documents','notes','aesthetics','distribution','approvals','plan','decisions','site'];
      const user={name:'Synthetic Reviewer',email:'reviewer@example.test',projectId:'search-project',projectName:'Synthetic House',role:params.get('role')||'admin',anonymousLink:params.has('anonymous'),permissions:Object.fromEntries(keys.map(key=>[key,true])),folderAccess:{mode:'all',folderIds:[],allowUnfiled:true}};
      createRoot(document.getElementById('root')).render(<HousePlanner mode={mode} user={user} initialLanguage={language} initialDestination={readWorkspaceDestination(location.href)} onSwitchMode={()=>{}} onSignOut={()=>{}}/>);`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, loader: { ".webp": "dataurl" }, outfile: "document-search.js", platform: "browser", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "search-browser-adapters", setup(builder) {
      builder.onResolve({ filter: /^(next\/(image|dynamic)|@\/lib\/usage-client)$/ }, args => ({ path: args.path, namespace: "search-adapters" }));
      builder.onResolve({ filter: /\/(AssistantPanel|ExpensesWorkspace|AestheticsWorkspace|NotesWorkspace|QuotesWorkspace|MobileCapture|DistributionAdmin|GoogleSheetsEditing|ActivityWorkspace)$/ }, args => ({ path: args.path.split("/").pop()!, namespace: "search-adapters" }));
      builder.onLoad({ filter: /.*/, namespace: "search-adapters" }, args => ({
        contents: `import React from 'react';${args.path === "next/image" ? "export default function Image({fill,priority,unoptimized,...props}){return <img {...props}/>;}"
          : args.path === "@/lib/usage-client" ? "export const useUsageTracking=()=>{},flushUsageBeforeTransition=async()=>{},trackDemoAction=()=>{},trackUsageInteraction=()=>{};"
          : args.path === "next/dynamic" ? "export default ()=>function OptionalDynamic(){return null;}"
          : args.path === "ExpensesWorkspace" ? "export default function Leaf(){return null;}export function ExpenseDialog({children}){return <>{children}</>;}export function MediaPreview(){return null;}"
          : args.path === "ActivityWorkspace" ? "export default function Leaf(){return null;}export function ActivitySummaryCard(){return null;}"
          : "export default function Leaf(){return null;}"}`, loader: "tsx", resolveDir: process.cwd(),
      }));
    } }],
  });
  const script = bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  const css = await readFile("app/globals.css", "utf8") + (bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text || "");
  server = createServer(async (request, response) => {
    const path = new URL(request.url || "/", "http://search.local").pathname;
    if (path === "/document-search.js") { response.setHeader("content-type", "text/javascript"); response.end(script); return; }
    if (path === "/og.png" || /^\/demo\/[a-zA-Z0-9_.-]+$/.test(path)) { try { response.end(await readFile(`public${path}`)); } catch { response.writeHead(404); response.end("Synthetic asset missing"); } return; }
    if (path === "/synthetic-preview") { response.setHeader("content-type", "text/html"); response.end("<p>Permiso municipal sintético</p>"); return; }
    if (path === "/synthetic-download") { response.setHeader("content-disposition", 'attachment; filename="Synthetic.pdf"'); response.end("Synthetic download"); return; }
    if (path.startsWith("/api/")) { response.writeHead(500); response.end("Unexpected unmocked request"); return; }
    response.setHeader("content-type", "text/html"); response.end(`<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><style>html{--font-geist-sans:Arial;--font-geist-mono:monospace}${css}</style><div id="root"></div><script src="/document-search.js"></script></html>`);
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done)); address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>(done => server.close(() => done())); });
const createdAt = "2026-10-16T12:00:00Z";
const folders = [
  { id: "plans", name: "Anteproyecto", parentId: null, createdAt },
  { id: "nested", name: "Planos y documentación detallada de la casa con un nombre muy largo", parentId: "plans", createdAt },
  { id: "legal", name: "Documentos legales", parentId: null, createdAt },
  { id: "vault", name: "Carpeta protegida", parentId: null, encrypted: true, unlocked: false, createdAt },
  { id: "vault-child", name: "Documentos privados", parentId: "vault", createdAt },
];
const record = (id: string, name: string, folderId: string | null, description = "", extra = {}) => ({ id, name, folderId, description, contentType: "application/pdf", size: 1024, uploadedBy: "Synthetic Reviewer", createdAt, downloadUrl: "/synthetic-download", ...extra });
const permitName = "Resolución de licencia municipal y requisitos generales de la construcción.pdf";
const documents = [
  record("featured", "Plano destacado.pdf", "plans", "Plano general aprobado"),
  record("permit", permitName, "legal", "Licencia municipal para iniciar las obras", { previewUrl: "/synthetic-preview", previewKind: "pdf" }),
  record("kitchen", "Distribución.pdf", "nested", "Ubicación de muebles y electrodomésticos en la cocina"),
  record("unfiled", "Recibo.pdf", null, "Documento sin clasificar"),
  record("private", "Secret.pdf", "vault-child", "Licencia municipal privada", { encrypted: true }),
];
async function fixture(page: Page, semantic: { status?: number; code?: string; results?: { id: string; score?: number }[] } = {}) {
  const calls: { path: string; method: string; body?: unknown }[] = [];
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method(); calls.push({ path, method, body: request.postData() ? request.postDataJSON() : undefined });
    if (path === "/api/documents/search") return route.fulfill({ status: semantic.status || 200, json: semantic.code ? { code: semantic.code } : { mode: "semantic", results: semantic.results || [{ id: "permit", score: 0.93 }], searchedCount: 4, totalCount: 4 } });
    if (path === "/api/notifications" && method === "PATCH") return route.fulfill({ json: { ok: true } });
    const responses: Record<string, unknown> = {
      "/api/projects": { projects: [{ id: "search-project", name: "Synthetic House", kind: "shared", role: "admin", active: true }], canCreateProjects: false },
      "/api/budget": { currency: "CRC", objective: 100, excess: 0, spent: 0, remaining: 100, percentUsed: 0, status: "within_objective", editingAllowed: true, lines: [], summaries: { chapter: [], type: [], subcategory: [] } },
      "/api/overview": { imageIds: [], noteIds: [] }, "/api/aesthetics": { folders: [], images: [] }, "/api/notes": { notes: [] },
      "/api/property-profile": { profile: null }, "/api/files": { documents }, "/api/folders": { folders }, "/api/plan": { items: [] },
      "/api/countdowns": { countdowns: [] }, "/api/notifications": { configured: false, sender: "", emailEnabled: true, recipients: [] },
      "/api/decisions": { decisions: [] }, "/api/site-issues": { issues: [] }, "/api/approvals": { approvals: [] },
      "/api/access": { users: [], canGrantProjectCreation: false }, "/api/invitations": { invitations: [] },
      "/api/events/documents": { version: 1 }, "/api/house-distribution": { ready: false }, "/api/documents/featured": { documentIds: ["featured"] },
    };
    return route.fulfill({ status: method === "GET" && path in responses ? 200 : 500, json: responses[path] || { error: "Unexpected mutation or API" } });
  });
  return { calls, searches: () => calls.filter(call => call.path === "/api/documents/search") };
}
const search = (page: Page) => page.getByRole("region", { name: "Buscar en todos los documentos", exact: true });
const results = (page: Page) => search(page).locator(".document-search-result");
async function open(page: Page, query = "") { await page.goto(`${address}/projects/search-project/documents${query}`); await expect(search(page)).toBeVisible(); }
async function width(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); }

for (const viewport of [{ width: 1280, height: 900 }, { width: 320, height: 740 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`global description, meaning, preview, folder path and featured continuity at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport); const api = await fixture(page); await open(page);
    await expect(page.locator(".featured-document-row")).toHaveCount(1);
    const input = search(page).getByRole("searchbox"); await input.fill("electrodomesticos"); await expect(results(page)).toHaveCount(1); await expect(results(page)).toContainText("Distribución.pdf");
    await expect(results(page)).toContainText("Anteproyecto / Planos y documentación detallada"); expect(api.searches()).toEqual([]); await width(page);
    await input.fill("permiso para construir"); await expect(results(page)).toHaveCount(0); await search(page).getByRole("button", { name: "Buscar por significado", exact: true }).click();
    await expect(results(page)).toHaveCount(1); await expect(results(page)).toContainText(permitName); await expect(results(page)).toContainText("Por significado"); await expect(results(page)).not.toContainText("93%");
    await page.screenshot({ path: test.info().outputPath("search-results.png"), fullPage: true });
    expect(api.searches()).toHaveLength(1); expect(api.searches()[0].body).toEqual({ query: "permiso para construir", language: "es" });
    for (const control of await search(page).locator("button,input").all()) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await results(page).getByRole("button", { name: `Abrir ${permitName}`, exact: true }).click(); const dialog = page.getByRole("dialog", { name: `Vista previa de ${permitName}`, exact: true }); await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape"); await expect(dialog).toBeHidden(); await expect(results(page).getByRole("button", { name: `Abrir ${permitName}`, exact: true })).toBeFocused();
    await results(page).getByRole("button", { name: `Abrir carpeta de ${permitName}: Documentos legales`, exact: true }).click(); await expect(page).toHaveURL(/\/documents\/folder\/legal$/);
    await expect(search(page).getByRole("searchbox")).toHaveValue(""); await expect(page.locator(".doc-row")).toHaveCount(1); await expect(page.locator(".doc-row")).toContainText(permitName);
    await search(page).getByRole("searchbox").fill("sin clasificar"); await results(page).getByRole("button", { name: "Abrir carpeta de Recibo.pdf: Sin carpeta", exact: true }).click();
    await expect(page).toHaveURL(/\/documents$/); await expect(page.getByRole("heading", { name: "Documentos sin carpeta", exact: true })).toBeVisible(); await expect(page.locator(".doc-row")).toContainText("Recibo.pdf");
    await page.getByRole("group", { name: "Vistas de documentos" }).getByRole("button", { name: "Destacados", exact: true }).click(); await expect(page.locator(".featured-document-row")).toHaveCount(1); await expect(page.locator(".featured-document-row")).toContainText("Plano destacado.pdf");
    await width(page); expect(api.calls.filter(call => call.method !== "GET" && call.path !== "/api/notifications")).toEqual(api.searches());
  });
}
test("semantic failure preserves text results, clear restores focus and false IDs never become document links", async ({ page }) => {
  const api = await fixture(page, { status: 503, code: "semantic_unavailable" }); await open(page); const input = search(page).getByRole("searchbox"); await input.fill("Licencia municipal");
  await search(page).getByRole("button", { name: "Buscar por significado" }).click(); await expect(search(page).locator(".document-search-message")).toContainText("no está disponible");
  await expect(results(page)).toHaveCount(1); await expect(results(page)).toContainText("Por texto"); await expect(search(page)).not.toContainText("Secret.pdf"); expect(api.searches()).toHaveLength(1);
  await page.route("**/api/documents/search", route => route.fulfill({ json: { mode: "semantic", results: [{ id: "forged", name: "Invented" }, { id: "private" }, { id: "permit" }] } }));
  await search(page).getByRole("button", { name: "Buscar por significado" }).click(); await expect(results(page)).toHaveCount(1); await expect(results(page)).toContainText("Por significado"); await expect(search(page)).not.toContainText("Invented");
  await search(page).getByRole("button", { name: "Limpiar" }).click(); await expect(input).toHaveValue(""); await expect(input).toBeFocused(); await expect(results(page)).toHaveCount(0); await expect(page.locator(".featured-document-row")).toHaveCount(1);
});
test("an old semantic response cannot replace a changed query or survive cancellation", async ({ page }) => {
  await fixture(page); let release!: () => void; const gate = new Promise<void>(done => { release = done; }); let requests = 0;
  await page.route("**/api/documents/search", async route => { requests++; await gate; try { await route.fulfill({ json: { mode: "semantic", results: [{ id: "permit" }] } }); } catch { /* Browser deliberately aborted the obsolete request. */ } });
  await open(page); const input = search(page).getByRole("searchbox"); await input.fill("permiso para construir"); await search(page).getByRole("button", { name: "Buscar por significado" }).click(); await expect.poll(() => requests).toBe(1);
  await expect(search(page).getByRole("button", { name: "Cancelar", exact: true })).toBeVisible(); await input.fill("electrodomésticos"); release();
  await expect(results(page)).toHaveCount(1); await expect(results(page)).toContainText("Distribución.pdf"); await expect(results(page)).not.toContainText(permitName); await expect(results(page)).toContainText("Por texto");
  await input.press("Escape"); await expect(input).toHaveValue(""); await expect(input).toBeFocused(); await expect(results(page)).toHaveCount(0);
});
for (const mode of ["demo", "anonymous"]) test(`${mode} search keeps text available and never calls semantic AI`, async ({ page }) => {
  const api = await fixture(page); await open(page, mode === "demo" ? "?mode=demo" : "?anonymous=1"); await search(page).getByRole("searchbox").fill(mode === "demo" ? "demo" : "municipal");
  await search(page).getByRole("button", { name: "Buscar por significado" }).click(); await expect(search(page).locator(".document-search-message")).toBeVisible(); expect(api.searches()).toHaveLength(0); await expect(results(page)).not.toHaveCount(0);
});
