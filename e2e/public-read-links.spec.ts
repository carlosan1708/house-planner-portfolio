import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";

// Run the real gateway and budget UI with local responses. The harmless harness
// cookies stand in for server session serialization; no Firebase data is used.
let server: Server;
let address: string;
const token = "public-link-test-capability";
const permissionKeys = ["overview", "activity", "budget", "quotes", "expenses", "documents", "notes", "aesthetics", "distribution", "approvals", "plan", "decisions", "site"];
const budget = {
  currency: "CRC", objective: 100, excess: 0, spent: 20, remaining: 80, percentUsed: 20,
  status: "within_objective", editingAllowed: true, planVersion: 1, actualsRevision: 0, sheetCount: 1, rowCount: 4, unsupported: [],
  lines: [{ id: "floor-1", row: 4, chapter: "Pisos", item: "Baldosa", type: "Construcción", subcategory: "Baño", objective: 100, excess: 0, quote: 100, paid: 20, supplier: "", status: "Pendiente" }],
  summaries: { chapter: [{ label: "Pisos", objective: 100, excess: 0, spent: 20, count: 1 }], type: [{ label: "Construcción", objective: 100, excess: 0, spent: 20, count: 1 }], subcategory: [{ label: "Baño", objective: 100, excess: 0, spent: 20, count: 1 }] },
};
const workbook = {
  id: "official-budget", name: "Budget", sheetOrder: ["category-1"], sheets: {
    "category-1": { id: "category-1", name: "Pisos", rowCount: 30, columnCount: 26,
      cellData: { 2: { 0: { v: "Chapter" }, 1: { v: "Item" }, 4: { v: "Objective" } }, 3: { 0: { v: "Pisos" }, 1: { v: "Baldosa" }, 2: { v: "Construcción" }, 3: { v: "Baño" }, 4: { v: 100 }, 6: { v: 100 }, 8: { v: "Pendiente" }, 9: { v: 20 }, 25: { v: "floor-1" } } },
      rowData: {}, columnData: {}, mergeData: [],
    },
  },
};

test.beforeAll(async () => {
  const bundle = await build({
    stdin: { contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import AuthGateway from './app/AuthGateway';
      import ReadAccessLinks from './app/components/ReadAccessLinks';
      import {readWorkspaceDestination} from './lib/workspace-navigation';
      const params = new URLSearchParams(location.search);
      const language = ['es','en'].includes(params.get('lang')) ? params.get('lang') : undefined;
      createRoot(document.getElementById('root')).render(location.pathname === '/manage'
        ? <main className="content" style={{maxWidth:1100,margin:'auto'}}><ReadAccessLinks projectId="sample-house" language={language||'es'} sections={[{id:'overview',label:'Resumen'},{id:'budget',label:'Presupuesto'},{id:'documents',label:'Documentos'}]} renderFolderPicker={()=>null}/></main>
        : <AuthGateway initialUser={window.__LINK_USER__} initialMode="default" initialInvite="" initialDestination={readWorkspaceDestination(location.href)} initialAccessLink={params.get('accessLink')||''} initialLanguage={language}/>);
    `, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, loader: { ".webp": "dataurl" }, outfile: "public-links.js", platform: "browser", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "public-link-workspace-leaves", setup(builder) {
      builder.onResolve({ filter: /^next\/(image|dynamic)$/ }, args => ({ path: args.path, namespace: "link-mocks" }));
      builder.onResolve({ filter: /^(firebase\/auth|@\/lib\/firebase-client)$/ }, args => ({ path: args.path, namespace: "link-mocks" }));
      builder.onResolve({ filter: /\/(AssistantPanel|ExpensesWorkspace|AestheticsWorkspace|NotesWorkspace|QuotesWorkspace|MobileCapture|DistributionAdmin|GoogleSheetsEditing|ActivityWorkspace)$/ }, args => ({ path: args.path.split("/").pop()!, namespace: "link-mocks" }));
      builder.onLoad({ filter: /.*/, namespace: "link-mocks" }, args => {
        const content = args.path === "firebase/auth"
          ? "const forbidden=async()=>{throw new Error('Public browsing must not authenticate with Firebase')};export const createUserWithEmailAndPassword=forbidden,signInWithEmailAndPassword=forbidden,signInWithPopup=forbidden,signOut=async()=>{},updateProfile=forbidden,sendEmailVerification=forbidden;export class GoogleAuthProvider{}"
          : args.path === "@/lib/firebase-client" ? "export const firebaseAuth={};"
            : args.path === "next/image" ? "export default function Image({fill,priority,...props}){return <img {...props}/>;}"
              : args.path === "next/dynamic" ? "export default ()=>function Distribution(){return null;}"
                : args.path === "ActivityWorkspace" ? "export default function Activity(){return null;}export function ActivitySummaryCard(){return null;}"
                  : args.path === "ExpensesWorkspace" ? "export default function Expenses(){return null;}export function ExpenseDialog({children}){return <div role='dialog'>{children}</div>;}export function MediaPreview(){return null;}"
                  : "export default function Leaf(){return null;}";
        return { contents: `import React from 'react';${content}`, loader: "tsx", resolveDir: process.cwd() };
      });
    } }],
  });
  const css = await readFile("app/globals.css", "utf8") + (bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text || "");
  server = createServer((request, response) => {
    if (request.url === "/public-links.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text); return; }
    const cookies = Object.fromEntries(String(request.headers.cookie || "").split(";").filter(Boolean).map(value => value.trim().split("=")));
    const accountRole = cookies.test_account_role === "editor" || cookies.test_account_role === "admin" ? cookies.test_account_role : null;
    const guest = !accountRole && cookies.test_public_link === "approved";
    const user = accountRole || guest ? {
      name: guest ? "Visitante del enlace" : "Existing Member", email: guest ? "" : "existing@example.test", projectId: "sample-house", projectName: "Sample", isPersonal: false,
      role: accountRole || "viewer", status: "approved", permissions: Object.fromEntries(permissionKeys.map(key => [key, guest ? key === "budget" : true])),
      folderAccess: { mode: "all", folderIds: [], allowUnfiled: true }, readOnlyLink: guest, anonymousLink: guest, linkDefaultLanguage: guest ? "en" : undefined,
    } : null;
    response.setHeader("content-type", "text/html");
    response.end(`<!doctype html><html style="--font-geist-sans:Arial;--font-geist-mono:monospace"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>window.__LINK_USER__=${JSON.stringify(user)}</script><script src="/public-links.js"></script></body></html>`);
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>(done => server.close(() => done())); });

type ApiCall = { path: string; method: string; body?: Record<string, unknown> };
async function mockProject(page: Page, options: { redemptionStatus?: number; defaultLanguage?: "es" | "en"; denyProfile?: boolean } = {}) {
  const calls: ApiCall[] = [];
  await page.route("**/api/**", async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    const body = request.postData() ? request.postDataJSON() as Record<string, unknown> : undefined;
    calls.push({ path, method: request.method(), body });
    if (path === "/api/access-links/redeem") {
      if (options.redemptionStatus) return route.fulfill({ status: options.redemptionStatus, json: { error: options.redemptionStatus === 401 ? "Account required" : "El enlace de lectura ha caducado o fue revocado." } });
      return route.fulfill({ headers: { "set-cookie": "test_public_link=approved; Path=/; SameSite=Lax" }, json: { ok: true, projectId: "sample-house", publicAccess: true, defaultLanguage: options.defaultLanguage || "en" } });
    }
    let data: unknown;
    switch (path) {
      case "/api/budget": data = budget; break;
      case "/api/workbook/editor": data = { workbook, rowMaps: { Pisos: { 4: 4 } } }; break;
      case "/api/workbook/drafts": data = { id: "existing-member-draft", revision: 1, workbook, rowMaps: { Pisos: { 4: 4 } } }; break;
      case "/api/projects": data = { projects: [{ id: "sample-house", name: "Sample", kind: "shared", role: "admin", active: true }], canCreateProjects: false }; break;
      case "/api/property-profile":
        if (options.denyProfile) return route.fulfill({ status: 403, json: { error: "Overview access required" } });
        data = { profile: null }; break;
      case "/api/files": data = { documents: [] }; break;
      case "/api/folders": data = { folders: [] }; break;
      case "/api/plan": data = { items: [] }; break;
      case "/api/countdowns": data = { countdowns: [] }; break;
      case "/api/notifications": data = { configured: false, sender: "", emailEnabled: true, recipients: [] }; break;
      case "/api/decisions": data = { decisions: [] }; break;
      case "/api/site-issues": data = { issues: [] }; break;
      case "/api/approvals": data = { approvals: [] }; break;
      case "/api/access": data = { users: [], canGrantProjectCreation: false }; break;
      case "/api/invitations": data = { invitations: [] }; break;
      case "/api/events/documents": data = { version: 1 }; break;
      case "/api/house-distribution": data = { ready: false }; break;
      case "/api/access-links": data = request.method() === "POST" ? { link: { ...body, id: "created-public-link", status: "active", createdAt: "2026-10-08T00:00:00Z", expiresAt: "2026-10-22T00:00:00Z", role: "viewer", redemptionCount: 0 }, accessUrl: `${address}/projects/sample-house/overview?accessLink=${token}` } : { links: [] }; break;
      default: data = {};
    }
    await route.fulfill({ json: data });
  });
  return calls;
}

test("unsigned visitors open a public link in its specified language with read-only budget controls", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const calls = await mockProject(page, { denyProfile: true });
  await page.addInitScript(() => localStorage.setItem("house-planner-language", "en"));
  await page.goto(`${address}/projects/sample-house/budget/chapter/Pisos?accessLink=${token}&lang=es&mode=demo`);
  await expect(page.locator(".topbar h1")).toHaveText("Presupuesto");
  await expect(page.getByRole("spinbutton", { name: "Baldosa Objetivo", exact: true })).toBeDisabled();
  await expect(page.locator(".sidebar nav").getByRole("button", { name: /Documentos$/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Iniciar sesión|Crear cuenta|Sign in|Create account/, exact: true })).toHaveCount(0);
  const url = new URL(page.url());
  expect(url.pathname).toBe("/projects/sample-house/budget/chapter/Pisos");
  expect(Object.fromEntries(url.searchParams)).toEqual({ lang: "es" });
  expect(calls.filter(call => call.path === "/api/access-links/redeem")).toEqual([{ path: "/api/access-links/redeem", method: "POST", body: { token, requestedProjectId: "sample-house" } }]);
  expect(calls.some(call => call.path === "/api/session" || call.path === "/api/workbook/drafts")).toBe(false);
  expect(calls.some(call => call.path === "/api/property-profile")).toBe(false);
  await expect(page.getByText("Proyecto no disponible", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("public-link-reader.png"), fullPage: true });
  await page.reload();
  await expect(page.getByRole("spinbutton", { name: "Baldosa Objetivo", exact: true })).toBeDisabled();
  expect(calls.filter(call => call.path === "/api/access-links/redeem")).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("a public link without lang uses the saved link language", async ({ page }) => {
  const calls = await mockProject(page, { defaultLanguage: "en", denyProfile: true });
  await page.addInitScript(() => localStorage.setItem("house-planner-language", "es"));
  await page.goto(`${address}/projects/sample-house/budget?accessLink=${token}`);
  await expect(page.locator(".topbar h1")).toHaveText("Budget");
  await expect(page).toHaveURL(/\/projects\/sample-house\/budget\?lang=en$/);
  await expect(page.locator(".budget-line-list")).toContainText("Baldosa");
  expect(calls.some(call => call.path === "/api/property-profile")).toBe(false);
  expect(await page.locator("html").getAttribute("lang")).toBe("en");
});

for (const role of ["editor", "admin"]) {
  test(`an existing ${role} keeps editable access after opening the public link`, async ({ page, context }) => {
    const calls = await mockProject(page);
    await context.addCookies([{ name: "test_account_role", value: role, url: address }]);
    await page.goto(`${address}/projects/sample-house/budget/chapter/Pisos?accessLink=${token}&lang=es`);
    await expect(page.getByRole("spinbutton", { name: "Baldosa Objetivo", exact: true })).toBeEnabled();
    await expect(page.locator(".sidebar nav").getByRole("button", { name: /Documentos$/ })).toBeVisible();
    expect(calls.some(call => call.path === "/api/workbook/drafts" && call.body?.action === "create")).toBe(true);
    expect(calls.some(call => call.path === "/api/session")).toBe(false);
    expect(new URL(page.url()).searchParams.has("accessLink")).toBe(false);
  });
}

test("an expired public link shows its failure without opening login or project APIs", async ({ page }) => {
  const calls = await mockProject(page, { redemptionStatus: 410 });
  await page.goto(`${address}/projects/sample-house/budget?accessLink=${token}&lang=es`);
  await expect(page.getByRole("alert")).toContainText("caducado o fue revocado");
  await expect(page.getByRole("button", { name: "Reintentar", exact: true })).toBeVisible();
  await expect(page.getByLabel("Correo", { exact: true })).toHaveCount(0);
  expect(calls.some(call => call.path === "/api/budget" || call.path === "/api/session")).toBe(false);
});

test("an account link still presents credentials after the account-required response", async ({ page }) => {
  const calls = await mockProject(page, { redemptionStatus: 401 });
  await page.goto(`${address}/projects/sample-house/budget?accessLink=${token}&lang=es`);
  await expect(page.getByLabel("Correo", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Iniciar sesión", exact: true })).toBeVisible();
  expect(calls.some(call => call.path === "/api/budget" || call.path === "/api/session")).toBe(false);
});

for (const width of [1440, 375]) {
  test(`public link controls work at ${width}px and include the selected language in the copied URL`, async ({ page }, testInfo) => {
    const calls = await mockProject(page);
    await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 });
    await page.goto(`${address}/manage?lang=es`);
    await page.getByRole("button", { name: "Nuevo enlace de lectura", exact: true }).click();
    await expect(page.getByLabel("Quién puede acceder")).toHaveValue("public");
    await page.getByLabel("Idioma predeterminado").selectOption("en");
    await page.getByLabel("Nombre del enlace").fill("Lectura para proveedores");
    await page.getByRole("button", { name: "Crear enlace de lectura", exact: true }).click();
    const url = new URL(await page.getByLabel("Enlace de acceso de lectura", { exact: true }).inputValue());
    expect(url.searchParams.get("accessLink")).toBe(token);
    expect(url.searchParams.get("lang")).toBe("en");
    expect(calls.find(call => call.path === "/api/access-links" && call.method === "POST")?.body).toMatchObject({ authentication: "public", defaultLanguage: "en" });
    await expect(page.locator(".read-link-record")).toContainText("Cualquiera con el enlace");
    await expect(page.locator(".read-link-record")).toContainText("Idioma predeterminado: English");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`public-link-controls-${width}.png`), fullPage: true });
  });
}
