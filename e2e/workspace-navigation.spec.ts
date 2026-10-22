import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { createDemoDistributionRecord } from "../lib/demo-distribution";

// Exercise the real workspace and budget editor without Firebase credentials or
// a production project. Unrelated workspaces are replaced by inexpensive leaves.
let server: Server;
let address: string;
type UploadRequest = { fileName: string; folderId: string | null; index: number };
const uploadHandlers = new Map<string, (body: Omit<UploadRequest, "index">) => Promise<{ status: number; json: unknown }>>();
let mockProjectId = 0;

type NavigationFolder = { id: string; name: string; parentId: string | null; createdAt: string };
type NavigationDocument = { id: string; name: string; folderId: string | null; contentType: string; size: number; uploadedBy: string; createdAt: string; downloadUrl: string; previewKind?: "pdf"; previewUrl?: string; description?: string };
type NavigationSiteIssue = { id: string; title: string; category: string; priority: string; status: string; assignee: string; dueDate: string | null; notes: string; photos: string[]; captureAttachments: never[] };
const nestedFolders: NavigationFolder[] = [
  { id: "plans-parent", name: "Planos", parentId: null, createdAt: "2026-10-05T12:00:00Z" },
  { id: "plans-child", name: "Instalaciones", parentId: "plans-parent", createdAt: "2026-10-05T12:00:00Z" },
  { id: "plans-grandchild", name: "Electricidad", parentId: "plans-child", createdAt: "2026-10-05T12:00:00Z" },
];
function documentRecord(name: string, folderId: string | null, id = name): NavigationDocument {
  return { id, name, folderId, contentType: "application/pdf", size: 1024, uploadedBy: "Navigation Tester", createdAt: "2026-10-05T12:00:00Z", downloadUrl: "/mock-download" };
}
const nestedDocuments = [documentRecord("Sin carpeta.pdf", null), documentRecord("Plano general.pdf", "plans-parent"), documentRecord("Instalaciones.pdf", "plans-child"), documentRecord("Electricidad.pdf", "plans-grandchild")];

function multipartUpload(body: string) {
  return {
    fileName: /name="file"; filename="([^"]+)"/.exec(body)?.[1] || "Uploaded file",
    folderId: /name="folderId"\r\n\r\n([^\r\n]*)/.exec(body)?.[1] || null,
  };
}

const sections = {
  overview: "Resumen", activity: "Actividad", budget: "Presupuesto", quotes: "Cotizaciones",
  expenses: "Compras/Gastos", documents: "Documentos", notes: "Notas", aesthetics: "Estética",
  distribution: "Distribución 3D", approvals: "Aprobaciones", plan: "Plan y cronograma",
  decisions: "Decisiones", site: "Progreso de obra", access: "Acceso",
};
const budget = {
  currency: "CRC", objective: 100, excess: 0, spent: 20, remaining: 80, percentUsed: 20,
  status: "within_objective", editingAllowed: true, planVersion: 1, actualsRevision: 0,
  sheetCount: 1, rowCount: 4, unsupported: [],
  lines: [{ id: "floor-1", row: 4, chapter: "Pisos", item: "Baldosa", type: "Construcción", subcategory: "Baño / ducha & más", objective: 100, excess: 0, quote: 100, paid: 20, supplier: "", status: "Pendiente" }],
  summaries: {
    chapter: [{ label: "Pisos", objective: 100, excess: 0, spent: 20, count: 1 }],
    type: [{ label: "Construcción", objective: 100, excess: 0, spent: 20, count: 1 }],
    subcategory: [{ label: "Baño / ducha & más", objective: 100, excess: 0, spent: 20, count: 1 }],
  },
};

function workbook(label = "Pisos") {
  return {
    id: "official-budget", name: "Budget", sheetOrder: ["category-1"],
    sheets: { "category-1": { id: "category-1", name: label, rowCount: 30, columnCount: 26,
      cellData: {
        2: { 0: { v: "Chapter" }, 1: { v: "Item" }, 4: { v: "Objective" } },
        3: { 0: { v: "Pisos" }, 1: { v: "Baldosa" }, 2: { v: "Construcción" }, 3: { v: "Baño / ducha & más" }, 4: { v: 100 }, 6: { v: 100 }, 8: { v: "Pendiente" }, 9: { v: 20 }, 25: { v: "floor-1" } },
      }, rowData: {}, columnData: {}, mergeData: [],
    } },
  };
}

test.beforeAll(async () => {
  const bundle = await build({
    stdin: { contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import HousePlanner from './app/HousePlanner';
      import AuthGateway from './app/AuthGateway';
      import {readWorkspaceDestination} from './lib/workspace-navigation';
      const params = new URLSearchParams(location.search);
      const role = params.get('role') || 'admin';
      const keys = ${JSON.stringify(Object.keys(sections).filter(key => key !== "access"))};
      const permissions = Object.fromEntries(keys.map(key => [key, key !== params.get('deny')]));
      const personal = params.has('personal') && !params.has('sessionProject');
      const user = {name:'Navigation Tester',email:'navigation@example.test',projectId:params.get('sessionProject')||(personal?'personal-space':'sample-house'),projectName:'Sample',isPersonal:personal,role,permissions,folderAccess:{mode:'all',folderIds:[],allowUnfiled:true},canViewPlatformAnalytics:params.has('platformOwner')};
      localStorage.setItem('house-planner-language','es');
      const destination = readWorkspaceDestination(location.href);
      createRoot(document.getElementById('root')).render(params.has('signedOut') || params.has('gateway')
        ? <AuthGateway initialUser={params.has('signedOut') ? null : {...user,status:'approved'}} initialMode="default" initialInvite={params.get('invite')||''} initialDestination={destination}/>
        : <HousePlanner mode="real" user={user} initialDestination={destination} onSwitchMode={()=>{}} onSignOut={()=>{}}/>);
    `, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, loader: { ".webp": "dataurl" }, outfile: "navigation.js", platform: "browser", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "navigation-workspace-leaves", setup(builder) {
      builder.onResolve({ filter: /^next\/(image|dynamic)$/ }, args => ({
        path: args.path === "next/dynamic" && /[\\/]app[\\/]HousePlanner\.tsx$/.test(args.importer) ? "next/dynamic:planner" : args.path,
        namespace: "navigation-mocks",
      }));
      builder.onResolve({ filter: /^(firebase\/auth|@\/lib\/firebase-client)$/ }, args => ({ path: args.path, namespace: "navigation-mocks" }));
      builder.onResolve({ filter: /\/(AssistantPanel|ExpensesWorkspace|AestheticsWorkspace|NotesWorkspace|QuotesWorkspace|MobileCapture|DistributionAdmin|GoogleSheetsEditing|ActivityWorkspace)$/ }, args => ({ path: args.path.split("/").pop()!, namespace: "navigation-mocks" }));
      builder.onLoad({ filter: /.*/, namespace: "navigation-mocks" }, args => {
        const content = args.path === "firebase/auth"
          ? "const credential={user:{getIdToken:async()=> 'local-navigation-token',emailVerified:true}}; export const createUserWithEmailAndPassword=async()=>credential,signInWithEmailAndPassword=async()=>credential,signInWithPopup=async()=>credential,signOut=async()=>{},updateProfile=async()=>{},sendEmailVerification=async()=>{}; export class GoogleAuthProvider{}"
          : args.path === "@/lib/firebase-client"
            ? "export const firebaseAuth={};"
            : args.path === "next/image"
          ? "export default function Image({fill,priority,...props}){return <img {...props}/>;}"
          : args.path === "next/dynamic"
            ? "export default ()=>function Distribution(){return <div data-testid='distribution-model'>Modelo 3D cargado</div>;}"
            : args.path === "next/dynamic:planner"
              // Opt into the real 3D workspace for its navigation contract;
              // its dynamic Viewer and all other existing cases remain leaves.
              ? "import DistributionWorkspace from './app/components/DistributionWorkspace.tsx'; export default ()=>function Distribution(props){return new URLSearchParams(location.search).has('realDistribution') ? <DistributionWorkspace {...props}/> : <div data-testid='distribution-model'>Modelo 3D cargado</div>;}"
            : args.path === "ActivityWorkspace"
              ? "export default function Activity({onNavigate}){return <button onClick={()=>onNavigate('documents','file-1')}>Abrir documento de actividad</button>;} export function ActivitySummaryCard({onNavigate}){return <button onClick={onNavigate}>Ver actividad</button>;}"
              : args.path === "ExpensesWorkspace"
                // Keep shared dialogs real for Budget payment details while
                // replacing only the unrelated top-level expenses workspace.
                // The extension bypasses this plugin's extensionless leaf rule.
                ? "export {ExpenseDialog,MediaPreview} from './app/components/ExpensesWorkspace.tsx'; export default function Leaf(){return null;}"
              : "export default function Leaf(){return null;}";
        return { contents: `import React from 'react';${content}`, loader: "tsx", resolveDir: process.cwd() };
      });
    } }],
  });
  const css = await readFile("app/globals.css", "utf8") + (bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text || "");
  server = createServer(async (request, response) => {
    if (request.method === "POST" && new URL(request.url || "/", "http://navigation.local").pathname === "/api/files") {
      const handler = uploadHandlers.get(String(request.headers["x-navigation-test"] || ""));
      if (!handler) { response.writeHead(500); response.end("Missing upload handler"); return; }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const result = await handler(multipartUpload(Buffer.concat(chunks).toString("utf8")));
      response.writeHead(result.status, { "content-type": "application/json" });
      response.end(JSON.stringify(result.json));
      return;
    }
    if (request.url === "/navigation.js") {
      response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles.find(file => file.path.endsWith(".js"))?.text || bundle.outputFiles[0].text);
    } else {
      response.setHeader("content-type", "text/html");
      response.end(`<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><style>html{--font-geist-sans:Arial;--font-geist-mono:monospace}${css}</style><div id="root"></div><script src="/navigation.js"></script></html>`);
    }
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

test.afterAll(async () => { if (server) await new Promise<void>(done => server.close(() => done())); });

type ApiCall = { path: string; method: string; body?: Record<string, unknown> };
async function mockProject(page: Page, options: { ready?: boolean; switchDenied?: boolean; canCreate?: boolean; failSave?: () => boolean; beforeCreate?: () => Promise<void>; failCreate?: () => boolean; beforePropertyProfile?: () => Promise<void>; propertyProfileDenied?: boolean; folders?: NavigationFolder[]; documents?: NavigationDocument[]; beforeUpload?: (request: UploadRequest) => Promise<void>; uploadStatus?: (request: UploadRequest) => number; siteIssues?: NavigationSiteIssue[]; beforePhotoUpload?: () => Promise<void>; apiFixtures?: Record<string, unknown> } = {}) {
  const calls: ApiCall[] = [];
  let revision = 1;
  let uploadIndex = 0;
  const documents = [...options.documents || []];
  const siteIssues = [...options.siteIssues || []];
  const uploadSession = `navigation-${++mockProjectId}`;
  await page.setExtraHTTPHeaders({ "x-navigation-test": uploadSession });
  uploadHandlers.set(uploadSession, async body => {
    const request = { ...body, index: ++uploadIndex };
    await options.beforeUpload?.(request);
    const status = options.uploadStatus?.(request) || 200;
    if (status >= 400) return { status, json: { error: "Upload rejected for this test" } };
    const document = documentRecord(request.fileName, request.folderId, `uploaded-${request.index}`);
    documents.unshift(document);
    return { status, json: { document } };
  });
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const body: Record<string, unknown> | undefined = request.postData()
      ? request.headers()["content-type"]?.startsWith("multipart/form-data")
        ? multipartUpload(request.postData()!)
        : request.postDataJSON() as Record<string, unknown>
      : undefined;
    calls.push({ path: url.pathname, method: request.method(), body });
    // Let native XHR transmit multipart bytes to a real HTTP endpoint. Keeping
    // its response pending exposes the server-processing phase without timers.
    if (url.pathname === "/api/files" && request.method() === "POST") return route.continue();
    if (request.method() === "GET" && options.apiFixtures?.[url.pathname] !== undefined) return route.fulfill({ json: options.apiFixtures[url.pathname] });
    let data: unknown;
    switch (url.pathname) {
      case "/api/session": {
        const next = new URL(page.url());
        if (request.method() === "DELETE") {
          next.searchParams.set("signedOut", "1");
          next.searchParams.delete("sessionProject");
        } else {
          next.searchParams.delete("signedOut");
          next.searchParams.set("sessionProject", String(body?.requestedProjectId || "sample-house"));
        }
        await page.evaluate(href => window.history.replaceState({}, "", href), next.toString());
        data = { status: "approved" };
        break;
      }
      case "/api/projects":
        if (request.method() === "POST") {
          const next = new URL(page.url()); next.searchParams.set("sessionProject", "new-house");
          await page.evaluate(href => window.history.replaceState({}, "", href), next.toString());
          data = { project: { id: "new-house", name: body?.name } };
        } else if (request.method() === "PATCH") {
          if (options.switchDenied) return route.fulfill({ status: 403, json: { error: "project access denied" } });
          const next = new URL(page.url()); next.searchParams.set("sessionProject", String(body?.projectId));
          await page.evaluate(href => window.history.replaceState({}, "", href), next.toString());
          data = { projectId: body?.projectId };
        } else data = { projects: [{ id: "sample-house", name: "Sample", kind: "shared", role: "admin", active: true }, { id: "other-house", name: "Other", kind: "shared", role: "viewer", active: false }], canCreateProjects: options.canCreate === true };
        break;
      case "/api/budget": data = budget; break;
      case "/api/overview": data = { imageIds: [], noteIds: [] }; break;
      case "/api/aesthetics": data = { folders: [], images: [] }; break;
      case "/api/notes": data = { notes: [] }; break;
      case "/api/property-profile":
        await options.beforePropertyProfile?.();
        if (options.propertyProfileDenied) return route.fulfill({ status: 403, json: { error: "Overview access required" } });
        data = { profile: null }; break;
      case "/api/files": data = { documents }; break;
      case "/api/folders": data = { folders: options.folders || [] }; break;
      case "/api/plan": data = { items: [] }; break;
      case "/api/countdowns": data = { countdowns: [] }; break;
      case "/api/notifications": data = { configured: false, sender: "", emailEnabled: true, recipients: [] }; break;
      case "/api/decisions": data = { decisions: [] }; break;
      case "/api/site-issues":
        if (request.method() === "PATCH") {
          const index = siteIssues.findIndex(issue => issue.id === body?.id);
          if (index < 0) return route.fulfill({ status: 404, json: { error: "Missing site issue" } });
          siteIssues[index] = { ...siteIssues[index], ...body };
          data = { id: body?.id };
        } else data = { issues: siteIssues };
        break;
      case "/api/site-issues/photo":
        if (request.method() === "POST") {
          await options.beforePhotoUpload?.();
          data = { key: "photo-key" };
        } else return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/AkAAAAASUVORK5CYII=", "base64") });
        break;
      case "/api/approvals": data = { approvals: [] }; break;
      case "/api/access": data = { users: [], canGrantProjectCreation: false }; break;
      case "/api/invitations": data = { invitations: [] }; break;
      case "/api/events/documents": data = { version: 1 }; break;
      case "/api/usage/events": data = { accepted: (body?.events as unknown[] || []).length }; break;
      case "/api/admin/analytics": data = {
        filters: { from: url.searchParams.get("from"), to: url.searchParams.get("to"), context: "all", projectId: null, includeOwner: false },
        metadata: { startedAt: null, timezone: "America/Costa_Rica", retentionDays: 90 },
        totals: { visits: 0, visitors: 0, users: 0, views: 0, actions: 0, activeMs: 0 },
        daily: [], sections: [], projects: [], projectOptions: [], users: [],
      }; break;
      case "/api/house-distribution": data = { ready: options.ready !== false }; break;
      case "/api/workbook/editor": data = { workbook: workbook(url.searchParams.get("label") || "Pisos"), rowMaps: { Pisos: { 4: 4 } } }; break;
      case "/api/workbook/drafts":
        if (body?.action === "save") {
          if (options.failSave?.()) return route.fulfill({ status: 500, json: { error: "Guardado de prueba fallido" } });
          data = { revision: ++revision };
        } else if (body?.action === "create") {
          await options.beforeCreate?.();
          if (options.failCreate?.()) return route.fulfill({ status: 503, json: { error: "No se pudo abrir la categoría de prueba" } });
          const scope = body.scope as { label?: string } | undefined;
          data = { id: "fresh-private-draft", revision, workbook: workbook(scope?.label), rowMaps: { Pisos: { 4: 4 } } };
        } else return route.fulfill({ status: 400, json: { error: "Unexpected draft action" } });
        break;
      default: return route.fulfill({ status: 500, json: { error: `Unhandled navigation API: ${url.pathname}` } });
    }
    await route.fulfill({ json: data });
  });
  return calls;
}

for (const [section, label] of Object.entries(sections)) {
  test(`opens the ${section} section directly and after reload`, async ({ page }) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await mockProject(page);
    await page.goto(`${address}/projects/sample-house/${section}`);
    await expect(page.locator(".topbar h1")).toHaveText(label);
    await expect(page.locator(".sidebar nav .active")).toContainText(label);
    await page.reload();
    await expect(page.locator(".topbar h1")).toHaveText(label);
    expect(errors).toEqual([]);
  });
}

test("Furniture stays under Distribution for a permitted viewer across nested routes, reload and legacy links", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1100 });
  const calls = await mockProject(page, {
    apiFixtures: { "/api/house-distribution": { ready: true, record: createDemoDistributionRecord("es") } },
  });
  const query = "?role=viewer&realDistribution=1";
  const nested = `/projects/sample-house/distribution/furniture${query}`;
  await page.goto(`${address}${nested}`);
  const tabs = page.getByRole("tablist", { name: "Vistas 3D", exact: true });
  const furniture = tabs.getByRole("tab", { name: "Mobiliario", exact: true });
  const distribution = tabs.getByRole("tab", { name: "Distribución", exact: true });
  const parentNavigation = page.locator(".sidebar nav");
  await expect(page.locator(".topbar h1")).toHaveText("Distribución 3D");
  await expect(parentNavigation.locator('[aria-current="page"]')).toContainText("Distribución 3D");
  await expect(parentNavigation.getByRole("button", { name: "Mobiliario", exact: true })).toHaveCount(0);
  await expect(furniture).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".furniture-item-grid button").first()).toBeVisible();
  await expect(page.locator(".distribution-form")).toHaveCount(0);

  await page.reload();
  await expect(page).toHaveURL(`${address}${nested}`);
  await expect(furniture).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".furniture-inventory")).toBeVisible();
  await distribution.click();
  await expect(page).toHaveURL(`${address}/projects/sample-house/distribution${query}`);
  await expect(distribution).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".furniture-inventory")).toHaveCount(0);
  await furniture.click();
  await expect(page).toHaveURL(`${address}${nested}`);
  await expect(parentNavigation.locator('[aria-current="page"]')).toContainText("Distribución 3D");
  const piece = page.locator(".furniture-item-grid button").first();
  const pieceName = await piece.locator("b").innerText();
  await piece.click();
  await expect(page.locator(".furniture-selected h3")).toHaveText(pieceName);
  await page.goBack();
  await expect(page).toHaveURL(`${address}/projects/sample-house/distribution${query}`);
  await expect(distribution).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".furniture-selected")).toHaveCount(0);
  await expect(page.locator(".distribution-empty h3")).toHaveText("Selecciona un espacio");
  await page.goForward();
  await expect(page).toHaveURL(`${address}${nested}`);
  await expect(furniture).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".furniture-inventory")).toBeVisible();

  await page.goto(`${address}/projects/sample-house/furniture${query}`);
  await expect(page).toHaveURL(`${address}${nested}`);
  await expect(furniture).toHaveAttribute("aria-selected", "true");
  const reads = calls.filter(call => call.path === "/api/house-distribution").length;
  await page.goto(`${address}${nested}&deny=distribution`);
  await expect(page.getByText("No tienes acceso a esta sección", { exact: true })).toBeVisible();
  await expect(tabs).toHaveCount(0);
  expect(calls.filter(call => call.path === "/api/house-distribution")).toHaveLength(reads);
  expect(calls.some(call => call.path === "/api/house-distribution" && call.method !== "GET")).toBe(false);
  expect(errors).toEqual([]);
});

test("overview highlights remain available after document navigation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const calls = await mockProject(page, { folders: nestedFolders, documents: nestedDocuments });
  await page.goto(`${address}/projects/sample-house/overview`);
  await expect(page.locator(".topbar h1")).toHaveText("Resumen");
  await expect(page.getByRole("heading", { name: "Fotos de la casa", exact: true })).toBeVisible();
  await expect(page.locator(".overview-document-total strong")).toHaveText(String(nestedDocuments.length));
  await expect(page.getByRole("heading", { name: "Medidas de la casa", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Notas destacadas", exact: true })).toBeVisible();
  await expect(page.locator(".overview-highlights")).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("button", { name: "Editar selección de fotos", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Seleccionar notas", exact: true })).toBeEnabled();
  await expect(page.locator(".overview-load-error")).toHaveCount(0);

  await page.getByRole("button", { name: /^Ver planos y documentos/ }).click();
  await expect(page).toHaveURL(/\/projects\/sample-house\/documents$/);
  await expect(page.locator(".topbar h1")).toHaveText("Documentos");
  await page.getByRole("button", { name: "Documentos sin carpeta", exact: true }).click();
  await expect(page.locator(".doc-row")).toHaveCount(1);
  await page.goBack();
  await expect(page).toHaveURL(/\/projects\/sample-house\/overview$/);
  await expect(page.locator(".overview-highlights")).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("button", { name: "Editar selección de fotos", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Seleccionar notas", exact: true })).toBeEnabled();
  await expect(page.locator(".overview-document-total strong")).toHaveText(String(nestedDocuments.length));
  await expect(page.locator(".overview-load-error")).toHaveCount(0);
  expect(["/api/overview", "/api/aesthetics", "/api/notes"].every(path => calls.some(call => call.path === path && call.method === "GET"))).toBe(true);
  expect(errors).toEqual([]);
});

test("menu, overview, activity and browser history keep the destination in the URL", async ({ page }) => {
  await mockProject(page);
  await page.goto(`${address}/projects/sample-house`);
  await expect(page.locator(".topbar h1")).toHaveText("Resumen");
  await page.locator(".sidebar nav").getByRole("button", { name: "Presupuesto" }).click();
  await expect(page).toHaveURL(/\/projects\/sample-house\/budget$/);
  await page.locator(".sidebar nav").getByRole("button", { name: "Documentos" }).click();
  await expect(page).toHaveURL(/\/documents$/);
  await page.goBack();
  await expect(page.locator(".topbar h1")).toHaveText("Presupuesto");
  await page.goForward();
  await expect(page.locator(".topbar h1")).toHaveText("Documentos");
  await page.locator(".sidebar nav").getByRole("button", { name: "Resumen" }).click();
  await page.getByRole("button", { name: "Ver actividad", exact: true }).click();
  await expect(page).toHaveURL(/\/activity$/);
  await page.getByRole("button", { name: "Abrir documento de actividad" }).click();
  await expect(page).toHaveURL(/\/documents\?item=file-1$/);
  await expect(page.locator(".topbar h1")).toHaveText("Documentos");
});

test("legacy links normalize while preserving invitation and connection parameters", async ({ page }) => {
  await mockProject(page);
  await page.goto(`${address}/?project=sample-house&section=documents&invite=invitation&google=connected&item=file-1`);
  await expect(page.locator(".topbar h1")).toHaveText("Documentos");
  const current = new URL(page.url());
  expect(current.pathname).toBe("/projects/sample-house/documents");
  expect(current.searchParams.has("project")).toBe(false);
  expect(current.searchParams.has("section")).toBe(false);
  expect(current.searchParams.get("invite")).toBe("invitation");
  expect(current.searchParams.get("google")).toBe("connected");
  expect(current.searchParams.get("item")).toBe("file-1");
});

test("nested document folders keep their contents through URLs, reload and browser history", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await mockProject(page, { folders: nestedFolders, documents: nestedDocuments });
  await page.goto(`${address}/projects/sample-house/documents`);
  await page.getByRole("button", { name: "Documentos sin carpeta", exact: true }).click();
  await expect(page.locator(".doc-row")).toHaveCount(1);
  await expect(page.locator(".doc-row")).toContainText("Sin carpeta.pdf");
  await page.getByRole("button", { name: "Abrir Planos", exact: true }).click();
  await expect(page).toHaveURL(`${address}/projects/sample-house/documents/folder/plans-parent`);
  await expect(page.locator(".doc-row")).toHaveCount(1);
  await expect(page.locator(".doc-row")).toContainText("Plano general.pdf");
  await page.getByRole("button", { name: "Abrir Instalaciones", exact: true }).click();
  await expect(page).toHaveURL(`${address}/projects/sample-house/documents/folder/plans-child`);
  await expect(page.locator(".doc-row")).toContainText("Instalaciones.pdf");
  await page.getByRole("button", { name: "Abrir Electricidad", exact: true }).click();
  await expect(page).toHaveURL(`${address}/projects/sample-house/documents/folder/plans-grandchild`);
  await expect(page.locator(".doc-row")).toHaveCount(1);
  await expect(page.locator(".doc-row")).toContainText("Electricidad.pdf");
  await page.reload();
  await expect(page.locator(".folder-breadcrumb")).toHaveText("Documentos/Planos/Instalaciones/Electricidad");
  await expect(page.locator(".doc-row")).toContainText("Electricidad.pdf");
  await page.goBack();
  await expect(page).toHaveURL(`${address}/projects/sample-house/documents/folder/plans-child`);
  await expect(page.locator(".doc-row")).toContainText("Instalaciones.pdf");
  await page.goForward();
  await expect(page.locator(".doc-row")).toContainText("Electricidad.pdf");
  await page.locator(".folder-breadcrumb").getByRole("button", { name: "Planos", exact: true }).click();
  await expect(page).toHaveURL(`${address}/projects/sample-house/documents/folder/plans-parent`);
  await expect(page.locator(".doc-row")).toContainText("Plano general.pdf");
  expect(errors).toEqual([]);
});

test("a nested folder opens directly for a viewer and shares its exact destination", async ({ page }) => {
  await mockProject(page, { folders: nestedFolders, documents: nestedDocuments });
  await page.addInitScript(() => {
    const copied: string[] = [];
    Object.assign(window, { navigationCopied: copied });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { copied.push(value); } } });
  });
  const folderUrl = `${address}/projects/sample-house/documents/folder/plans-grandchild`;
  await page.goto(`${folderUrl}?role=viewer&invite=private-token&item=private-record`);
  await expect(page.locator(".doc-row")).toHaveCount(1);
  await expect(page.locator(".doc-row")).toContainText("Electricidad.pdf");
  await expect(page.locator(".upload-button")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Carpeta de Electricidad.pdf", exact: true })).toHaveCount(0);
  await expect(page.locator(".doc-row .doc-folder-name")).toContainText("Electricidad");
  await page.locator(".topbar").getByRole("button", { name: "Copiar enlace", exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { navigationCopied: string[] }).navigationCopied)).toEqual([folderUrl]);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => { throw new Error("Clipboard denied"); } } }));
  await page.locator(".topbar").getByRole("button", { name: "Enlace copiado", exact: true }).click();
  const fallback = page.getByRole("dialog", { name: "Copiar enlace manualmente" });
  await expect(fallback.getByRole("textbox", { name: "Dirección para compartir" })).toHaveValue(folderUrl);
  await fallback.getByRole("button", { name: "Cerrar", exact: true }).click();
  await page.reload();
  await expect(page.locator(".doc-row")).toContainText("Electricidad.pdf");
});

test("a folder URL survives renaming and moving the folder", async ({ page }) => {
  const folders = nestedFolders.map(folder => ({ ...folder }));
  await mockProject(page, { folders, documents: nestedDocuments });
  const folderUrl = `${address}/projects/sample-house/documents/folder/plans-grandchild`;
  await page.goto(folderUrl);
  await expect(page.locator(".document-list h3")).toHaveText("Electricidad");
  const folder = folders.find(candidate => candidate.id === "plans-grandchild")!;
  folder.name = "Eléctricos revisados";
  folder.parentId = "plans-parent";
  await page.reload();
  await expect(page).toHaveURL(folderUrl);
  await expect(page.locator(".folder-breadcrumb")).toHaveText("Documentos/Planos/Eléctricos revisados");
  await expect(page.locator(".document-list h3")).toHaveText("Eléctricos revisados");
  await expect(page.locator(".doc-row")).toHaveCount(1);
  await expect(page.locator(".doc-row")).toContainText("Electricidad.pdf");
});

test("an unavailable folder never substitutes root documents, and denied document sections stay restricted", async ({ page }) => {
  const calls = await mockProject(page, { folders: nestedFolders, documents: nestedDocuments });
  await page.goto(`${address}/projects/sample-house/documents/folder/hidden-folder?role=viewer`);
  await expect(page.getByText("Carpeta no disponible", { exact: true })).toBeVisible();
  await expect(page.locator(".document-list")).toHaveCount(0);
  await expect(page.getByText("Sin carpeta.pdf", { exact: true })).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe("/projects/sample-house/documents/folder/hidden-folder");
  await page.getByRole("button", { name: "Abrir documentos", exact: true }).click();
  await expect(page).toHaveURL(/\/documents\?role=viewer$/);
  await page.getByRole("button", { name: "Documentos sin carpeta", exact: true }).click();
  await expect(page.locator(".doc-row")).toContainText("Sin carpeta.pdf");
  const fileReadsBeforeDenial = calls.filter(call => call.path === "/api/files").length;
  await page.goto(`${address}/projects/sample-house/documents/folder/plans-grandchild?role=viewer&deny=documents`);
  await expect(page.getByText("No tienes acceso a esta sección", { exact: true })).toBeVisible();
  await expect(page.locator(".document-list")).toHaveCount(0);
  expect(calls.filter(call => call.path === "/api/files").length).toBe(fileReadsBeforeDenial);
});

test("a signed-out folder destination survives sign-in for the requested project", async ({ page }) => {
  const calls = await mockProject(page, { folders: nestedFolders, documents: nestedDocuments });
  await page.goto(`${address}/projects/other-house/documents/folder/plans-grandchild?signedOut=1`);
  await page.getByRole("button", { name: /Abrir espacio privado/ }).click();
  await page.getByLabel("Correo", { exact: true }).fill("navigation@example.test");
  await page.getByLabel("Contraseña", { exact: true }).fill("local-password");
  await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
  await expect(page.locator(".doc-row")).toHaveCount(1);
  await expect(page.locator(".doc-row")).toContainText("Electricidad.pdf");
  expect(new URL(page.url()).pathname).toBe("/projects/other-house/documents/folder/plans-grandchild");
  expect(calls.find(call => call.path === "/api/session")?.body).toMatchObject({ requestedProjectId: "other-house" });
});

test("document upload reports native progress and stays busy while the server saves it", async ({ page }, testInfo) => {
  let releaseUpload!: () => void;
  let uploadStarted!: () => void;
  const uploadPending = new Promise<void>(resolve => { releaseUpload = resolve; });
  const started = new Promise<void>(resolve => { uploadStarted = resolve; });
  const calls = await mockProject(page, {
    folders: nestedFolders, documents: nestedDocuments,
    beforeUpload: async () => { uploadStarted(); await uploadPending; },
  });
  await page.goto(`${address}/projects/sample-house/documents/folder/plans-grandchild`);
  await expect(page.locator(".doc-row")).toContainText("Electricidad.pdf");
  try {
    await page.locator('input[type="file"][multiple]').setInputFiles({ name: "Nuevo plano.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(256 * 1024, 65) });
    await started;
    await expect(page.locator(".upload-progress[data-phase=processing]")).toBeVisible();
    await expect(page.getByRole("progressbar")).toHaveAttribute("value", "100");
    await expect(page.locator(".upload-progress")).toContainText("Nuevo plano.pdf");
    await expect(page.locator(".upload-progress")).toHaveAttribute("aria-busy", "true");
    await expect(page.locator(".upload-button")).toBeDisabled();
    await expect(page.locator(".doc-row")).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath("document-upload-processing.png"), fullPage: true });
    await mkdir("outputs/upload-folder-links", { recursive: true });
    await page.screenshot({ path: "outputs/upload-folder-links/document-upload-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".upload-progress")).toBeVisible();
    await page.screenshot({ path: "outputs/upload-folder-links/document-upload-mobile.png", fullPage: true });
    releaseUpload();
    await expect(page.locator(".toast")).toHaveText("1 archivo(s) subido(s)");
    await expect(page.locator(".upload-progress")).toHaveCount(0);
    await expect(page.locator(".upload-button")).toBeEnabled();
    await expect(page.locator(".doc-row")).toHaveCount(2);
    await expect(page.locator(".document-list")).toContainText("Nuevo plano.pdf");
    expect(calls.find(call => call.path === "/api/files" && call.method === "POST")?.body).toMatchObject({ fileName: "Nuevo plano.pdf", folderId: "plans-grandchild" });
  } finally { releaseUpload(); }
});

test("a partial upload failure refreshes accepted files and allows another upload", async ({ page }) => {
  let releaseFailure!: () => void;
  let secondStarted!: () => void;
  const pendingFailure = new Promise<void>(resolve => { releaseFailure = resolve; });
  const secondRequest = new Promise<void>(resolve => { secondStarted = resolve; });
  const calls = await mockProject(page, {
    folders: nestedFolders, documents: nestedDocuments,
    beforeUpload: async request => { if (request.index === 2) { secondStarted(); await pendingFailure; } },
    uploadStatus: request => request.index === 2 ? 500 : 200,
  });
  await page.goto(`${address}/projects/sample-house/documents/folder/plans-child`);
  await expect(page.locator(".doc-row")).toContainText("Instalaciones.pdf");
  const files = [{ name: "Aceptado.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(1024, 65) }, { name: "Reintento.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(2048, 66) }];
  try {
    await page.locator('input[type="file"][multiple]').setInputFiles(files);
    await secondRequest;
    await expect(page.locator(".upload-progress[data-phase=processing]")).toBeVisible();
    await expect(page.locator(".upload-progress")).toContainText("Archivo 2 / 2");
    await expect(page.locator(".upload-progress")).toContainText("1 / 2 guardados");
    await expect(page.locator(".upload-button")).toBeDisabled();
    releaseFailure();
    await expect(page.locator(".toast")).toHaveText("1 de 2 archivos subidos. No se pudieron subir los archivos restantes.");
    await expect(page.locator(".upload-progress")).toHaveCount(0);
    await expect(page.locator(".upload-button")).toBeEnabled();
    await expect(page.locator(".doc-row")).toHaveCount(2);
    await expect(page.locator(".document-list")).toContainText("Aceptado.pdf");
    await expect(page.locator(".doc-row").filter({ hasText: "Reintento.pdf" })).toHaveCount(0);
    await page.locator('input[type="file"][multiple]').setInputFiles(files[1]);
    await expect(page.locator(".toast")).toHaveText("1 archivo(s) subido(s)");
    await expect(page.locator(".upload-button")).toBeEnabled();
    await expect(page.locator(".doc-row")).toHaveCount(3);
    expect(calls.filter(call => call.path === "/api/files" && call.method === "POST")).toHaveLength(3);
    expect(new URL(page.url()).pathname).toBe("/projects/sample-house/documents/folder/plans-child");
  } finally { releaseFailure(); }
});

test("a pending site photo upload keeps its original draft and blocks changing entries", async ({ page }) => {
  let releasePhoto!: () => void;
  let photoStarted!: () => void;
  const photoPending = new Promise<void>(resolve => { releasePhoto = resolve; });
  const started = new Promise<void>(resolve => { photoStarted = resolve; });
  const baseIssue = { category: "observation", priority: "medium", status: "open", assignee: "", dueDate: null, notes: "Notas originales", captureAttachments: [] as never[] };
  const calls = await mockProject(page, {
    siteIssues: [{ ...baseIssue, id: "issue-a", title: "Registro A", photos: ["existing-photo"] }, { ...baseIssue, id: "issue-b", title: "Registro B", photos: [] }],
    beforePhotoUpload: async () => { photoStarted(); await photoPending; },
  });
  await page.goto(`${address}/projects/sample-house/site`);
  const issueA = page.locator(".issue-card").filter({ has: page.getByRole("heading", { name: "Registro A", exact: true }) });
  const issueB = page.locator(".issue-card").filter({ has: page.getByRole("heading", { name: "Registro B", exact: true }) });
  await issueA.getByRole("button", { name: "Editar", exact: true }).click();
  const editor = page.locator(".editor-panel");
  try {
    await editor.locator('input[type="file"]').setInputFiles({ name: "avance.png", mimeType: "image/png", buffer: Buffer.from("photo fixture") });
    await started;
    await expect(editor.locator(".upload-progress")).toBeVisible();
    await expect(editor.locator(".upload-progress")).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("button", { name: /Nuevo reporte/ })).toBeDisabled();
    for (const card of [issueA, issueB]) {
      await expect(card.getByRole("button", { name: "Editar", exact: true })).toBeDisabled();
      await expect(card.getByRole("button", { name: "Eliminar", exact: true })).toBeDisabled();
    }
    await expect(editor.getByRole("button", { name: "Cerrar editor", exact: true })).toBeDisabled();
    await expect(editor.getByRole("button", { name: "Cancelar", exact: true })).toBeDisabled();
    await expect(editor.getByRole("button", { name: "Guardar", exact: true })).toBeDisabled();
    await expect(editor.getByRole("button", { name: "Quitar foto", exact: true })).toBeDisabled();
    await editor.getByLabel("Título", { exact: true }).fill("Registro A corregido");
    await editor.getByLabel("Notas").fill("Notas editadas durante la carga");
    expect(calls.some(call => call.path === "/api/site-issues" && call.method !== "GET")).toBe(false);
    releasePhoto();
    await expect(editor.locator(".upload-progress")).toHaveCount(0);
    await expect(editor.locator(".photo-thumb")).toHaveCount(2);
    await expect(editor.getByLabel("Título", { exact: true })).toHaveValue("Registro A corregido");
    await expect(editor.getByLabel("Notas")).toHaveValue("Notas editadas durante la carga");
    await expect(page.getByRole("button", { name: /Nuevo reporte/ })).toBeEnabled();
    for (const card of [issueA, issueB]) {
      await expect(card.getByRole("button", { name: "Editar", exact: true })).toBeEnabled();
      await expect(card.getByRole("button", { name: "Eliminar", exact: true })).toBeEnabled();
    }
    await expect(editor.getByRole("button", { name: "Cerrar editor", exact: true })).toBeEnabled();
    await expect(editor.getByRole("button", { name: "Cancelar", exact: true })).toBeEnabled();
    await expect(editor.getByRole("button", { name: "Quitar foto", exact: true }).first()).toBeEnabled();
    await expect(editor.getByRole("button", { name: "Guardar", exact: true })).toBeEnabled();
    await editor.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(editor).toHaveCount(0);
    expect(calls.find(call => call.path === "/api/site-issues" && call.method === "PATCH")?.body).toMatchObject({ id: "issue-a", title: "Registro A corregido", notes: "Notas editadas durante la carga", photos: ["existing-photo", "photo-key"] });
    await expect(page.locator(".issue-card").filter({ hasText: "Registro A corregido" })).toContainText("2 foto(s)");
    await issueB.getByRole("button", { name: "Editar", exact: true }).click();
    await expect(editor.getByLabel("Título", { exact: true })).toHaveValue("Registro B");
    await expect(editor.locator(".photo-thumb")).toHaveCount(0);
  } finally { releasePhoto(); }
});

test("a signed-out category destination survives sign-in and selects the requested project", async ({ page }) => {
  const calls = await mockProject(page);
  await page.goto(`${address}/projects/other-house/budget/chapter/Pisos?signedOut=1`);
  await page.getByRole("button", { name: /Abrir espacio privado/ }).click();
  await page.getByLabel("Correo", { exact: true }).fill("navigation@example.test");
  await page.getByLabel("Contraseña", { exact: true }).fill("local-password");
  await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: "Baldosa Objetivo" })).toHaveValue("100");
  expect(new URL(page.url()).pathname).toBe("/projects/other-house/budget/chapter/Pisos");
  expect(calls.find(call => call.path === "/api/session")?.body).toMatchObject({ requestedProjectId: "other-house" });
  expect(calls.some(call => call.path === "/api/projects" && call.method === "PATCH")).toBe(false);
});

test("returning from the demo restores the private destination and loads its project", async ({ page }) => {
  const calls = await mockProject(page);
  await page.goto(`${address}/projects/sample-house/documents?gateway=1`);
  await expect(page.locator(".topbar h1")).toHaveText("Documentos");
  await expect.poll(() => calls.filter(call => call.path === "/api/files").length).toBeGreaterThan(0);
  const loadedBeforeDemo = calls.filter(call => call.path === "/api/files").length;
  await page.getByRole("button", { name: "Ver demo", exact: false }).click();
  await expect(page.locator(".demo-banner")).toBeVisible();
  await page.locator(".sidebar nav").getByRole("button", { name: "Presupuesto" }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Presupuesto");
  await page.locator(".topbar").getByRole("button", { name: "Proyecto real", exact: false }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Documentos");
  await expect(page.locator(".demo-banner")).toHaveCount(0);
  await expect.poll(() => calls.filter(call => call.path === "/api/files").length).toBeGreaterThan(loadedBeforeDemo);
  expect(new URL(page.url()).pathname).toBe("/projects/sample-house/documents");
  expect(new URL(page.url()).searchParams.has("mode")).toBe(false);
});

test("section and category copy buttons confirm copying and provide a manual fallback", async ({ page }) => {
  await mockProject(page);
  await page.addInitScript(() => {
    const copied: string[] = [];
    Object.assign(window, { navigationCopied: copied });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { copied.push(value); } } });
  });
  await page.goto(`${address}/projects/sample-house/budget/chapter/Pisos?role=editor&invite=private-token&item=private-record`);
  await expect(page.getByRole("spinbutton", { name: "Baldosa Objetivo" })).toBeVisible();
  await page.locator(".topbar").getByRole("button", { name: "Copiar enlace", exact: true }).click();
  await expect(page.locator(".topbar").getByRole("button", { name: "Enlace copiado", exact: true })).toBeVisible();
  await page.locator(".budget-editor-page").getByRole("button", { name: "Copiar enlace", exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { navigationCopied: string[] }).navigationCopied)).toEqual([
    `${address}/projects/sample-house/budget`, `${address}/projects/sample-house/budget/chapter/Pisos`,
  ]);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => { throw new Error("Clipboard denied"); } } }));
  await page.locator(".topbar").getByRole("button", { name: "Enlace copiado", exact: true }).click();
  const fallback = page.getByRole("dialog", { name: "Copiar enlace manualmente" });
  await expect(fallback.getByRole("textbox", { name: "Dirección para compartir" })).toHaveValue(`${address}/projects/sample-house/budget`);
  await fallback.getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(fallback).toHaveCount(0);
});

for (const identity of [
  { label: "viewer", path: "sample-house/overview?role=viewer" },
  { label: "restricted member", path: "sample-house/overview?role=viewer&deny=overview" },
  { label: "personal workspace", path: "personal-space/overview?personal=1" },
]) {
  for (const width of [1280, 390]) {
    test(`sign-out is available for ${identity.label} at ${width}px without Access permission`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      const calls = await mockProject(page);
      await page.goto(`${address}/projects/${identity.path}&gateway=1`);
      await expect(page.locator(".sidebar nav").getByRole("button", { name: "Acceso", exact: false })).toHaveCount(0);
      if (width <= 680) {
        await page.locator(".mobile-workspace-nav").getByRole("button", { name: "Secciones", exact: true }).click();
        await expect(page.locator(".mobile-sections-dialog").getByRole("button", { name: "Acceso", exact: true })).toHaveCount(0);
      }
      const signOut = page.locator(width <= 680 ? ".mobile-sections-dialog" : ".topbar").getByRole("button", { name: "Cerrar sesión", exact: true });
      await expect(signOut).toBeVisible();
      const bounds = await signOut.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await signOut.click();
      await expect(page.getByRole("button", { name: /Abrir espacio privado/ })).toBeVisible();
      expect(calls.filter(call => call.path === "/api/session").map(call => call.method)).toEqual(["DELETE"]);
      await expect(page.locator(".profile")).toHaveCount(0);
    });
  }
}

test("sign-out stays separate from exploring demo mode and returning to the authenticated project", async ({ page }) => {
  const calls = await mockProject(page);
  await page.goto(`${address}/projects/sample-house/overview?role=viewer&gateway=1`);
  await page.getByRole("button", { name: /Ver demo/ }).click();
  await expect(page.getByText("Demo con datos ficticios", { exact: true })).toBeVisible();
  await expect(page.locator(".topbar").getByRole("button", { name: "Cerrar sesión", exact: true })).toHaveCount(0);
  expect(calls.some(call => call.path === "/api/session")).toBe(false);
  await page.getByRole("button", { name: /Proyecto real/ }).click();
  await expect(page.locator(".topbar").getByRole("button", { name: "Cerrar sesión", exact: true })).toBeVisible();
});

for (const width of [1280, 390]) {
  test(`sign-out preserves unsaved budget edits on save failure and retries before closing the session at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    let failSave = true;
    const calls = await mockProject(page, { failSave: () => failSave });
    await page.goto(`${address}/projects/sample-house/budget/chapter/Pisos?role=editor&gateway=1`);
    const amount = page.getByRole("spinbutton", { name: "Baldosa Objetivo" });
    await expect(amount).toHaveValue("100");
    await amount.fill("999");
    const signOut = page.locator(width <= 680 ? ".mobile-sections-dialog" : ".topbar").getByRole("button", { name: "Cerrar sesión", exact: true });
    const attemptSignOut = async () => {
      if (width <= 680) await page.locator(".mobile-workspace-nav").getByRole("button", { name: "Secciones", exact: true }).click();
      await signOut.click();
      if (width <= 680) await expect(page.locator(".mobile-sections-dialog")).not.toBeVisible();
    };
    await attemptSignOut();
    await expect(page.getByText("Guardado de prueba fallido", { exact: false }).first()).toBeVisible();
    await expect(amount).toHaveValue("999");
    expect(calls.some(call => call.path === "/api/session")).toBe(false);
    if (width <= 680) await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("");
    failSave = false;
    await attemptSignOut();
    await expect(page.getByRole("button", { name: /Abrir espacio privado/ })).toBeVisible();
    const saveIndex = calls.findLastIndex(call => call.body?.action === "save");
    const logoutIndex = calls.findIndex(call => call.path === "/api/session" && call.method === "DELETE");
    expect(logoutIndex).toBeGreaterThan(saveIndex);
    const saved = calls[saveIndex].body?.workbook as ReturnType<typeof workbook>;
    expect(saved.sheets["category-1"].cellData[3][4].v).toBe(999);
  });
}

test("mobile share fallback fits the screen and section navigation stays usable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockProject(page);
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => { throw new Error("Clipboard denied"); } } }));
  await page.goto(`${address}/projects/sample-house/documents?role=viewer`);
  await page.locator(".topbar").getByRole("button", { name: "Copiar enlace", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Copiar enlace manualmente" });
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("mobile-share-fallback.png"), fullPage: true });
  await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
  await page.locator(".mobile-workspace-nav").getByRole("button", { name: "Presupuesto", exact: true }).click();
  await expect(page).toHaveURL(/\/budget\?role=viewer$/);
  await page.locator(".budget-line-list").getByRole("button", { name: /^Baldosa Pisos · Construcción/ }).click();
  await expect(page.getByRole("spinbutton", { name: "Baldosa Objetivo" })).toBeDisabled();
  await page.locator(".budget-editor-page").getByRole("button", { name: "Copiar enlace", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Dirección para compartir" })).toHaveValue(`${address}/projects/sample-house/budget/chapter/Pisos`);
});

test("switches project before loading records for a shared destination", async ({ page }) => {
  const calls = await mockProject(page);
  await page.goto(`${address}/projects/other-house/documents`);
  await expect(page.locator(".topbar h1")).toHaveText("Documentos");
  await expect.poll(() => calls.findIndex(call => call.path === "/api/files")).toBeGreaterThan(-1);
  const switchIndex = calls.findIndex(call => call.path === "/api/projects" && call.method === "PATCH");
  expect(switchIndex).toBeGreaterThan(-1);
  expect(calls[switchIndex].body).toMatchObject({ projectId: "other-house" });
  expect(calls.slice(0, switchIndex).filter(call => call.path !== "/api/projects")).toEqual([]);
  expect(calls.slice(0, switchIndex).some(call => ["/api/events/documents", "/api/notifications"].includes(call.path))).toBe(false);
  expect(new URL(page.url()).pathname).toBe("/projects/other-house/documents");
});

test("a denied project never requests records from the old active project", async ({ page }) => {
  const calls = await mockProject(page, { switchDenied: true });
  await page.goto(`${address}/projects/other-house/budget`);
  await expect(page.getByText("No tienes acceso a este proyecto", { exact: true })).toBeVisible();
  expect(calls.every(call => call.path === "/api/projects")).toBe(true);
  await expect(page.locator(".budget-table-editor")).toHaveCount(0);
});

test("a denied project link can return to the active project and load its records", async ({ page }) => {
  const calls = await mockProject(page, { switchDenied: true });
  await page.goto(`${address}/projects/other-house/budget`);
  await expect(page.getByText("No tienes acceso a este proyecto", { exact: true })).toBeVisible();
  expect(calls.every(call => call.path === "/api/projects")).toBe(true);
  await page.getByRole("button", { name: "Abrir mi proyecto", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/sample-house\/overview$/);
  await expect(page.locator(".topbar h1")).toHaveText("Resumen");
  for (const path of ["/api/property-profile", "/api/files", "/api/projects"]) {
    await expect.poll(() => calls.some(call => call.path === path && call.method === "GET")).toBe(true);
  }
  expect(calls.some(call => call.path === "/api/budget")).toBe(false);
  await page.locator(".sidebar nav").getByRole("button", { name: "Presupuesto" }).click();
  await expect(page.locator(".budget-line-list")).toContainText("Baldosa");
  await expect(page).toHaveURL(/\/projects\/sample-house\/budget$/);
  await expect.poll(() => calls.some(call => call.path === "/api/budget" && call.method === "GET")).toBe(true);
});

test("browser back from a denied destination loads the restored active project", async ({ page }) => {
  const calls = await mockProject(page, { switchDenied: true });
  await page.addInitScript(() => {
    const destination = location.href;
    history.replaceState({ housePlannerIndex: 0 }, "", "/projects/sample-house/budget");
    history.pushState({ housePlannerIndex: 1 }, "", destination);
  });
  await page.goto(`${address}/projects/other-house/budget`);
  await expect(page.getByText("No tienes acceso a este proyecto", { exact: true })).toBeVisible();
  expect(calls.every(call => call.path === "/api/projects")).toBe(true);
  await page.goBack();
  await expect(page.locator(".budget-line-list")).toContainText("Baldosa");
  await expect(page).toHaveURL(/\/projects\/sample-house\/budget$/);
  await expect.poll(() => calls.some(call => call.path === "/api/projects" && call.method === "GET")).toBe(true);
});

test("creating a project from the personal portal opens its new canonical URL", async ({ page }) => {
  const calls = await mockProject(page, { canCreate: true });
  await page.goto(`${address}/projects/personal-space/overview?personal=1`);
  await expect(page.locator(".topbar h1")).toHaveText("Proyectos");
  await page.getByRole("button", { name: "Nuevo proyecto", exact: false }).click();
  const dialog = page.getByRole("dialog", { name: "Crear proyecto" });
  await dialog.getByLabel("Nombre del proyecto").fill("Casa nueva");
  await expect(dialog.getByLabel("Moneda del proyecto")).toHaveValue("USD");
  await dialog.getByRole("button", { name: "Crear y abrir", exact: true }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Resumen");
  expect(new URL(page.url()).pathname).toBe("/projects/new-house/overview");
  expect(calls.find(call => call.path === "/api/projects" && call.method === "POST")?.body).toEqual({ name: "Casa nueva", currency: "USD" });
  expect(calls.some(call => call.path === "/api/projects" && call.method === "PATCH")).toBe(false);
});

test("denied sections and an unprepared 3D destination show explicit states", async ({ page }) => {
  const calls = await mockProject(page, { ready: false });
  await page.goto(`${address}/projects/sample-house/budget?role=viewer&deny=budget`);
  await expect(page.getByText("No tienes acceso a esta sección", { exact: true })).toBeVisible();
  expect(calls.some(call => call.path === "/api/budget")).toBe(false);
  await page.goto(`${address}/projects/sample-house/access?role=viewer`);
  await expect(page.getByText("No tienes acceso a esta sección", { exact: true })).toBeVisible();
  await page.goto(`${address}/projects/sample-house/distribution`);
  await expect(page.getByText("Distribución 3D todavía no preparada", { exact: true })).toBeVisible();
  await expect(page.getByTestId("distribution-model")).toHaveCount(0);
});

test("administrator opens direct workbook publishing and approvals without cloud credentials", async ({ page }) => {
  await mockProject(page);
  await page.goto(`${address}/projects/sample-house/budget`);
  await expect(page.getByRole("button", { name: /Add expense|Agregar gasto/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Editar presupuesto", exact: true }).click();
  await expect(page.getByText("Listo para editar el libro oficial", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Guardar", exact: true })).toBeVisible();
  await page.locator(".sidebar nav").getByRole("button", { name: "Aprobaciones" }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Aprobaciones");
});

for (const role of ["admin", "editor", "viewer"]) {
  test(`${role} opens Pisos with the appropriate workbook API and no other member draft`, async ({ page }) => {
    const calls = await mockProject(page);
    await page.goto(`${address}/projects/sample-house/budget/chapter/Pisos?role=${role}`);
    const amount = page.getByRole("spinbutton", { name: "Baldosa Objetivo", exact: true });
    await expect(amount).toHaveValue("100");
    if (role === "viewer") {
      await expect(amount).toBeDisabled();
      expect(calls.filter(call => call.path === "/api/workbook/editor").map(call => call.method)).toEqual(["GET"]);
      expect(calls.some(call => call.path === "/api/workbook/drafts")).toBe(false);
    } else {
      await expect(amount).toBeEnabled();
      expect(calls.filter(call => call.body?.action === "create").map(call => call.body)).toEqual([{ action: "create", scope: { key: "chapter", label: "Pisos" }, expectedCurrency: "CRC" }]);
      expect(calls.some(call => call.path === "/api/workbook/drafts" && call.method === "GET")).toBe(false);
    }
    await page.getByRole("button", { name: "Panel", exact: false }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/sample-house/budget\\?role=${role}$`));
    await expect(page.locator(".budget-editor-page")).toHaveCount(0);
  });
}

test("all category sheets, accented names and nonexistent categories have distinct destinations", async ({ page }) => {
  const calls = await mockProject(page);
  await page.goto(`${address}/projects/sample-house/budget/chapter`);
  await expect(page.getByRole("spinbutton", { name: "Baldosa Objetivo" })).toBeVisible();
  expect(calls.find(call => call.body?.action === "create")?.body?.scope).toEqual({ key: "chapter", all: true });
  await page.goto(`${address}/projects/sample-house/budget/subcategory/${encodeURIComponent("Baño / ducha & más")}?role=viewer`);
  await expect(page.getByRole("spinbutton", { name: "Baldosa Objetivo" })).toBeDisabled();
  await page.goto(`${address}/projects/sample-house/budget/chapter/Desconocido`);
  await expect(page.getByText(/La categoría «Desconocido» ya no existe en el presupuesto oficial/)).toBeVisible();
  await expect(page.locator(".budget-table-editor")).toHaveCount(0);
});

for (const width of [1280, 390]) {
  test(`budget category loading feedback prevents repeat clicks and recovers after failure at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    let releaseOpening!: () => void;
    let failOpening = true;
    const openingResponse = new Promise<void>(resolve => { releaseOpening = resolve; });
    const calls = await mockProject(page, { beforeCreate: () => openingResponse, failCreate: () => failOpening });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.goto(`${address}/projects/sample-house/budget?role=editor`);
      const item = page.locator(".budget-line-card-heading > button").first();
      const category = page.locator(".chart-legend button").first();
      const entry = width === 1280 ? item : category;
      await expect(entry).toBeEnabled();
      await entry.click();
      const status = page.getByRole("status").filter({ hasText: /^Abriendo Pisos…$/ });
      await expect(status).toBeVisible();
      await expect(page.getByRole("button", { name: "Abriendo…", exact: true }).first()).toBeDisabled();
      await expect(item).toBeDisabled();
      await expect(category).toBeDisabled();
      await expect(page.locator(".donut-segment[role='button']").first()).toHaveAttribute("aria-disabled", "true");
      // Disabled buttons and a second chart event must share the in-flight open.
      await item.evaluate(button => (button as HTMLButtonElement).click());
      await category.evaluate(button => (button as HTMLButtonElement).click());
      await page.locator(".donut-segment[role='button']").first().dispatchEvent("click");
      expect(calls.filter(call => call.body?.action === "create")).toHaveLength(1);
      await expect(page.getByRole("spinbutton", { name: "Baldosa Objetivo" })).toHaveCount(0);
      const bounds = await status.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await expect(status).toBeInViewport();
      await expect.poll(() => status.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const visible = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return visible !== null && element.contains(visible);
      }), { message: "Opening feedback must remain visible above the scrolled page, clear of the sticky header" }).toBe(true);
      await page.screenshot({ path: `test-results/budget-loading-feedback-${width}.png`, fullPage: true });

      releaseOpening();
      await expect(page.getByRole("alert")).toContainText("No se pudo abrir la categoría de prueba");
      await expect(status).toHaveCount(0);
      await expect(item).toBeEnabled();
      await expect(category).toBeEnabled();
      await expect(page).toHaveURL(/\/budget\?role=editor$/);
      failOpening = false;
      await entry.click();
      await expect(page.getByRole("spinbutton", { name: "Baldosa Objetivo" })).toHaveValue("100");
      await expect(page).toHaveURL(/\/budget\/chapter\/Pisos\?role=editor$/);
      expect(calls.filter(call => call.body?.action === "create")).toHaveLength(2);
      await expect(status).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally { releaseOpening(); }
  });
}

test("menu navigation waits for a category to open and saves the new draft before leaving", async ({ page }) => {
  let finishOpening!: () => void;
  let createStarted!: () => void;
  const createRequested = new Promise<void>((resolve) => { createStarted = resolve; });
  const openingResponse = new Promise<void>((resolve) => { finishOpening = resolve; });
  const calls = await mockProject(page, { beforeCreate: async () => { createStarted(); await openingResponse; } });
  await page.goto(`${address}/projects/sample-house/budget/chapter/Pisos?role=editor`);
  await createRequested;
  await page.locator(".sidebar nav").getByRole("button", { name: "Documentos" }).click();
  await expect(page).toHaveURL(/\/budget\/chapter\/Pisos\?role=editor$/);
  expect(calls.some(call => call.body?.action === "save")).toBe(false);
  finishOpening();
  await expect(page.locator(".topbar h1")).toHaveText("Documentos");
  await expect(page).toHaveURL(/\/documents\?role=editor$/);
  const saved = calls.find(call => call.body?.action === "save")?.body;
  expect(saved?.id).toBe("fresh-private-draft");
  expect((saved?.workbook as ReturnType<typeof workbook>).sheets["category-1"].cellData[3][4].v).toBe(100);
});

test("save failure keeps the category and URL during menu navigation until retry succeeds", async ({ page }) => {
  let failSave = true;
  const calls = await mockProject(page, { failSave: () => failSave });
  await page.goto(`${address}/projects/sample-house/budget/chapter/Pisos?role=editor`);
  const amount = page.getByRole("spinbutton", { name: "Baldosa Objetivo" });
  await expect(amount).toHaveValue("100");
  await amount.fill("999");
  await page.locator(".sidebar nav").getByRole("button", { name: "Documentos" }).click();
  await expect(page.getByText("Guardado de prueba fallido", { exact: false }).first()).toBeVisible();
  await expect(page).toHaveURL(/\/budget\/chapter\/Pisos\?role=editor$/);
  await expect(amount).toHaveValue("999");
  failSave = false;
  await page.locator(".sidebar nav").getByRole("button", { name: "Documentos" }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Documentos");
  await expect(page).toHaveURL(/\/documents\?role=editor$/);
  const saved = calls.filter(call => call.body?.action === "save").at(-1)?.body?.workbook as ReturnType<typeof workbook>;
  expect(saved.sheets["category-1"].cellData[3][4].v).toBe(999);
});

test("browser back is blocked on a failed save and can be retried", async ({ page }) => {
  let failSave = true;
  await mockProject(page, { failSave: () => failSave });
  await page.goto(`${address}/projects/sample-house/budget?role=editor`);
  await page.locator(".budget-line-list").getByRole("button", { name: /^Baldosa Pisos · Construcción/ }).click();
  await expect(page).toHaveURL(/\/budget\/chapter\/Pisos\?role=editor$/);
  await page.getByRole("spinbutton", { name: "Baldosa Objetivo" }).fill("999");
  await page.goBack();
  await expect(page.getByText("Guardado de prueba fallido", { exact: false }).first()).toBeVisible();
  await expect(page).toHaveURL(/\/budget\/chapter\/Pisos\?role=editor$/);
  await expect(page.getByRole("spinbutton", { name: "Baldosa Objetivo" })).toHaveValue("999");
  failSave = false;
  await page.goBack();
  await expect(page).toHaveURL(/\/budget\?role=editor$/);
  await expect(page.locator(".budget-editor-page")).toHaveCount(0);
});


test("platform analytics is available from personal space and to an owner with viewer role", async ({ page }) => {
  await mockProject(page);
  await page.goto(`${address}/projects/personal-space/analytics?personal&platformOwner`);
  await expect(page.locator(".topbar h1")).toHaveText("Uso de la app");
  await expect(page.locator(".analytics-workspace")).toBeVisible();
  await page.reload();
  await expect(page.locator(".analytics-workspace")).toBeVisible();
  await page.goto(`${address}/projects/sample-house/analytics?platformOwner&role=viewer`);
  await expect(page.locator(".analytics-workspace")).toBeVisible();
  await page.locator(".sidebar nav").getByRole("button", { name: "Resumen" }).click();
  await page.goBack();
  await expect(page.locator(".analytics-workspace")).toBeVisible();
});

test("project administrators cannot navigate to or request platform analytics", async ({ page }) => {
  const calls = await mockProject(page);
  await page.goto(`${address}/projects/sample-house/analytics`);
  await expect(page.getByText("No tienes acceso a esta sección")).toBeVisible();
  await expect(page.locator(".sidebar nav").getByRole("button", { name: "Uso de la app" })).toHaveCount(0);
  expect(calls.some(call => call.path === "/api/admin/analytics")).toBe(false);
});

test("platform analytics stays available while project loading waits and after a denied overview request", async ({ page }) => {
  let finishProfile!: () => void;
  let profileRequested!: () => void;
  const requested = new Promise<void>(resolve => { profileRequested = resolve; });
  const waiting = new Promise<void>(resolve => { finishProfile = resolve; });
  const calls = await mockProject(page, { propertyProfileDenied: true, beforePropertyProfile: async () => { profileRequested(); await waiting; } });
  await page.goto(`${address}/projects/sample-house/analytics?platformOwner&role=viewer`);
  await requested;
  await expect(page.locator(".analytics-workspace")).toBeVisible();
  await expect(page.getByText("Cargando proyecto…", { exact: true })).toHaveCount(0);
  finishProfile();
  await page.locator(".sidebar nav").getByRole("button", { name: "Documentos" }).click();
  await expect(page.getByText("Proyecto no disponible", { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.locator(".analytics-workspace")).toBeVisible();
  await expect(page.getByText("Proyecto no disponible", { exact: true })).toHaveCount(0);
  expect(calls.some(call => call.path === "/api/admin/analytics")).toBe(true);
});

test("navigation records visible sections once and does not count polling as views", async ({ page }) => {
  const calls = await mockProject(page);
  await page.goto(`${address}/projects/sample-house/overview`);
  const views = () => calls.filter(call => call.path === "/api/usage/events").flatMap(call => (call.body?.events || []) as Array<{ kind: string; section: string }>).filter(event => event.kind === "view").map(event => event.section);
  await expect.poll(views).toEqual(["overview"]);
  await page.locator(".sidebar nav").getByRole("button", { name: "Documentos" }).click();
  await expect.poll(views).toEqual(["overview", "documents"]);
  await page.goBack();
  await expect.poll(views).toEqual(["overview", "documents", "overview"]);
});

const phoneSizes = [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 844, height: 390 }];
const longMobileName = `Construcción y acabados ${"ReferenciaSinEspacios".repeat(6)}`;
const mobilePlan = Array.from({ length: 6 }, (_, index) => ({ id: `mobile-plan-${index}`, title: `${longMobileName} ${index + 1}`, phase: "Acabados y coordinación", owner: "Arquitectura y supervisión", startDate: "2026-10-05", endDate: "2026-11-15", status: "in_progress", dependsOn: [], notes: "Confirmar medidas y materiales antes de instalar. ".repeat(6) }));
const mobileDecisions = Array.from({ length: 6 }, (_, index) => ({ id: `mobile-decision-${index}`, title: `${longMobileName} ${index + 1}`, area: "Acabados", options: "Opción original\nAlternativa con instalación incluida", selected: "", owner: "Arquitectura", dueDate: "2026-11-15", status: "open", captureAttachments: [] }));
const mobileIssues: NavigationSiteIssue[] = Array.from({ length: 6 }, (_, index) => ({ id: `mobile-issue-${index}`, title: `${longMobileName} ${index + 1}`, category: "inspection", priority: "high", status: "open", assignee: "Supervisión de obra", dueDate: "2026-11-15", notes: "Revisar la impermeabilización y el nivel de piso antes de continuar. ".repeat(20), photos: [], captureAttachments: [] }));
const mobileApprovals = [{ id: "mobile-approval", kind: "workbook_draft", title: longMobileName, payload: JSON.stringify({ changeCount: 10 }), status: "pending", requested_by: "arquitectura@example.test", reviewed_by: null, created_at: "2026-10-05T12:00:00Z", reviewed_at: null, change_count: 10, details_complete: true, change_details: Array.from({ length: 10 }, (_, index) => ({ sheet: "Presupuesto", row: index + 27, column: 5, rowLabel: `${longMobileName} ${index + 1}`, groupLabel: "Mano de obra general", before: { value: 1000000 + index, formula: null, numberFormat: "₡#,##0" }, after: { value: 1200000 + index, formula: null, numberFormat: "₡#,##0" }, calculated: false })) }];
const mobileMember = { uid: "mobile-member", name: longMobileName, email: `${"supervision".repeat(10)}@example.test`, role: "editor", status: "approved", permissions: Object.fromEntries(Object.keys(sections).filter(key => key !== "access").map(key => [key, true])), folderAccess: { mode: "all", folderIds: [], allowUnfiled: true }, requestedAt: null, reviewedAt: null };
const mobileApiFixtures = {
  "/api/plan": { items: mobilePlan }, "/api/decisions": { decisions: mobileDecisions }, "/api/approvals": { approvals: mobileApprovals },
  "/api/access": { users: [mobileMember], canGrantProjectCreation: false }, "/api/access-links": { links: [] }, "/api/qa/reset": { available: false },
  "/api/countdowns": { countdowns: [{ id: "mobile-countdown", title: longMobileName, durationDays: 30, startedAt: "2026-10-01T12:00:00Z", dueAt: "2026-11-01T12:00:00Z", acknowledged: false, createdBy: "Navigation Tester", recipientUids: ["mobile-member"], notifyCurrentUser: true }] },
  "/api/notifications": { configured: false, sender: "", emailEnabled: false, recipients: [{ uid: "mobile-member", name: longMobileName, email: mobileMember.email, role: "editor" }] },
};

async function assertPhysicalPhoneBounds(page: Page) {
  // Chromium can widen innerWidth to fit an overflowing mobile control.
  // Measure against the physical phone width so that zoom-out cannot hide it.
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  const smallFields = await page.locator('.content input:not([type="checkbox"]):not([type="radio"]):not([type="file"]),.content select,.content textarea').evaluateAll(elements => elements.filter(element => element.getBoundingClientRect().width > 0 && Number.parseFloat(getComputedStyle(element).fontSize) < 16).map(element => element.getAttribute("aria-label") || element.closest("label")?.textContent));
  expect(smallFields, "Text fields should avoid automatic iOS focus zoom").toEqual([]);
}

async function phoneScreenshot(page: Page, section: string) {
  await mkdir("test-results/mobile-audit", { recursive: true });
  await page.screenshot({ path: `test-results/mobile-audit/populated-${page.viewportSize()!.width}-${section}.png` });
}

async function assertDialogFits(page: Page) {
  const dialog = page.locator('[role="dialog"]:visible');
  await expect(dialog).toBeVisible();
  const surface = dialog.locator(".confirm-card,.report-sheet").first();
  const bounds = await (await surface.count() ? surface : dialog.locator(":scope > div").first()).boundingBox();
  expect(bounds).not.toBeNull(); expect(bounds!.y).toBeGreaterThanOrEqual(-1);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
  await assertPhysicalPhoneBounds(page);
  return dialog;
}

test.describe("populated mobile workspaces", () => {
  test.use({ isMobile: true, hasTouch: true });
  for (const viewport of phoneSizes) {
    test(`documents keep long filenames, folder dialogs and PDF controls reachable at ${viewport.width}`, async ({ page, browserName }) => {
      test.skip(browserName !== "chromium"); await page.setViewportSize(viewport);
      const filename = `${longMobileName}.pdf`;
      const document = { ...documentRecord(filename, null, "mobile-pdf"), previewKind: "pdf" as const, previewUrl: "/mobile-preview.pdf", description: "Documento de referencia para instalaciones y acabados." };
      await page.route("**/mobile-preview.pdf", route => route.fulfill({ contentType: "application/pdf", body: "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF" }));
      await mockProject(page, { documents: [document], folders: nestedFolders, apiFixtures: mobileApiFixtures });
      await page.goto(`${address}/projects/sample-house/documents`);
      await page.getByRole("button", { name: "Documentos sin carpeta", exact: true }).click();
      await expect(page.locator(".doc-row")).toContainText(filename); await assertPhysicalPhoneBounds(page);
      await page.getByRole("button", { name: `Vista previa de ${filename}`, exact: true }).click();
      const preview = await assertDialogFits(page);
      const frame = await preview.locator("iframe").boundingBox(); expect(frame!.height).toBeGreaterThan(90); expect(frame!.height).toBeLessThan(viewport.height - 80);
      await phoneScreenshot(page, "documents-preview");
      await preview.getByRole("button", { name: "Cerrar vista previa", exact: true }).click(); await expect(preview).toHaveCount(0);
      await page.getByRole("button", { name: "Mover Planos", exact: true }).click();
      const moving = await assertDialogFits(page); await expect(moving.getByLabel("Buscar un destino")).toBeVisible();
      await moving.getByRole("button", { name: "Cancelar", exact: true }).click();
      await page.locator(".doc-row").getByRole("button", { name: /Describir/ }).click();
      const description = await assertDialogFits(page); await description.getByLabel("Descripción breve").fill("Revisar medidas antes de instalar.");
      await description.getByRole("button", { name: "Cancelar", exact: true }).click(); await assertPhysicalPhoneBounds(page);
    });

    test(`plan templates, timeline and editing remain usable at ${viewport.width}`, async ({ page, browserName }) => {
      test.skip(browserName !== "chromium"); await page.setViewportSize(viewport); await mockProject(page, { apiFixtures: mobileApiFixtures });
      await page.goto(`${address}/projects/sample-house/plan`); await expect(page.locator(".plan-card")).toHaveCount(6); await assertPhysicalPhoneBounds(page);
      await page.getByRole("button", { name: /Plantillas/ }).click(); const templates = await assertDialogFits(page);
      await expect(templates.getByRole("button", { name: "Usar plantilla", exact: true }).last()).toBeEnabled(); await phoneScreenshot(page, "plan-templates");
      await templates.getByRole("button", { name: "Cerrar", exact: true }).click();
      await page.getByRole("button", { name: "Cronograma", exact: true }).click(); await assertPhysicalPhoneBounds(page);
      await page.getByRole("button", { name: "Tarjetas", exact: true }).click();
      await page.locator(".plan-card").last().getByRole("button", { name: "Editar", exact: true }).click(); const editor = page.locator(".editor-panel");
      await expect(editor.getByLabel("Título", { exact: true })).toHaveValue(`${longMobileName} 6`); await assertPhysicalPhoneBounds(page);
      await editor.getByRole("button", { name: "Cancelar", exact: true }).click(); await page.getByLabel("Días de la cuenta regresiva", { exact: true }).fill("15"); await assertPhysicalPhoneBounds(page);
    });

    test(`decisions allow editing and dismissing confirmation after a long list at ${viewport.width}`, async ({ page, browserName }) => {
      test.skip(browserName !== "chromium"); await page.setViewportSize(viewport); await mockProject(page, { apiFixtures: mobileApiFixtures });
      await page.goto(`${address}/projects/sample-house/decisions`); await expect(page.locator(".decision-card")).toHaveCount(6); await assertPhysicalPhoneBounds(page);
      await page.locator(".decision-card").last().getByRole("button", { name: "Editar", exact: true }).click(); const editor = page.locator(".editor-panel");
      await expect(editor.getByLabel("Título", { exact: true })).toHaveValue(`${longMobileName} 6`); await assertPhysicalPhoneBounds(page); await phoneScreenshot(page, "decisions-editor");
      await editor.getByRole("button", { name: "Cancelar", exact: true }).click(); await page.locator(".decision-card").last().getByRole("button", { name: "Eliminar", exact: true }).click();
      const confirmation = await assertDialogFits(page); await confirmation.getByRole("button", { name: "Cancelar", exact: true }).click(); await expect(page.locator(".decision-card")).toHaveCount(6);
    });

    test(`site reports scroll to final actions and close on short screens at ${viewport.width}`, async ({ page, browserName }) => {
      test.skip(browserName !== "chromium"); await page.setViewportSize(viewport); await mockProject(page, { apiFixtures: mobileApiFixtures, siteIssues: mobileIssues });
      await page.goto(`${address}/projects/sample-house/site`); await expect(page.locator(".issue-card")).toHaveCount(6); await assertPhysicalPhoneBounds(page);
      await page.locator(".issue-card").last().getByRole("button", { name: "Reporte", exact: true }).click(); const report = await assertDialogFits(page);
      await report.getByRole("button", { name: "Cerrar", exact: true }).scrollIntoViewIfNeeded(); await expect(report.getByRole("button", { name: "Imprimir / Guardar PDF", exact: true })).toBeInViewport(); await phoneScreenshot(page, "site-report");
      await report.getByRole("button", { name: "Cerrar", exact: true }).click(); await expect(report).toHaveCount(0);
      await page.locator(".issue-card").last().getByRole("button", { name: "Editar", exact: true }).click(); await assertPhysicalPhoneBounds(page);
      await page.locator(".editor-panel").getByRole("button", { name: "Cancelar", exact: true }).click();
    });

    test(`approval differences preserve before and after values without viewport overflow at ${viewport.width}`, async ({ page, browserName }) => {
      test.skip(browserName !== "chromium"); await page.setViewportSize(viewport); await mockProject(page, { apiFixtures: mobileApiFixtures });
      await page.goto(`${address}/projects/sample-house/approvals`); await page.locator(".approval-labor-lines summary").click(); await expect(page.locator(".approval-diff-row")).toHaveCount(10);
      const last = page.locator(".approval-diff-row").last(); await last.scrollIntoViewIfNeeded(); expect((await last.locator(".approval-before").textContent())!.replace(/\D/g, "")).toBe("1000009"); expect((await last.locator(".approval-after").textContent())!.replace(/\D/g, "")).toBe("1200009"); await expect(last).toBeInViewport();
      await assertPhysicalPhoneBounds(page); await phoneScreenshot(page, "approvals-diff"); await page.getByRole("button", { name: /Aprobar$/ }).scrollIntoViewIfNeeded(); await expect(page.getByRole("button", { name: "Rechazar", exact: true })).toBeInViewport();
    });

    test(`access settings, delete cancellation and invitation fields fit at ${viewport.width}`, async ({ page, browserName }) => {
      test.skip(browserName !== "chromium"); await page.setViewportSize(viewport); await mockProject(page, { folders: nestedFolders, apiFixtures: mobileApiFixtures });
      await page.goto(`${address}/projects/sample-house/access`); await page.getByRole("button", { name: `Gestionar acceso de ${longMobileName}`, exact: true }).click(); await assertPhysicalPhoneBounds(page);
      await page.getByRole("button", { name: `Eliminar usuario ${longMobileName}`, exact: true }).click(); const confirmation = await assertDialogFits(page); await phoneScreenshot(page, "access-confirmation"); await confirmation.getByRole("button", { name: "Cancelar", exact: true }).click();
      await page.locator(".access-view-nav").getByRole("button", { name: /Invitaciones/ }).click(); await page.getByLabel("Correo de la cuenta", { exact: true }).fill("invitation@example.test"); await page.locator(".access-invite-permissions summary").click(); await assertPhysicalPhoneBounds(page);
      await page.getByRole("button", { name: "Crear invitación", exact: true }).scrollIntoViewIfNeeded(); await expect(page.getByRole("button", { name: "Crear invitación", exact: true })).toBeEnabled();
    });

    test(`budget editing uses reachable phone cards without a second vertical scroll at ${viewport.width}`, async ({ page, browserName }) => {
      test.skip(browserName !== "chromium"); await page.setViewportSize(viewport); await mockProject(page);
      await page.goto(`${address}/projects/sample-house/budget/chapter/Pisos?role=editor`);
      const amount = page.getByRole("spinbutton", { name: "Baldosa Objetivo", exact: true }); await expect(amount).toHaveValue("100"); await expect(amount).toHaveCSS("font-size", "16px");
      await assertPhysicalPhoneBounds(page); await amount.scrollIntoViewIfNeeded(); await expect(amount).toBeInViewport();
      const innerVerticalScrolls = await page.locator(".budget-editor-page *").evaluateAll(elements => elements.filter(element => element.clientHeight > 0 && element.scrollHeight > element.clientHeight + 5 && ["auto", "scroll"].includes(getComputedStyle(element).overflowY)).map(element => element.className));
      expect(innerVerticalScrolls).toEqual([]); await phoneScreenshot(page, "budget-editor");
    });
  }
});
