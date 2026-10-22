import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { applyFeaturedDocumentsChange, type FeaturedDocumentsChange } from "../lib/featured-documents";

// Render the real HousePlanner Documents integration on an isolated localhost
// server. Synthetic HTTP fixtures exercise browser state, not backend permissions.
let server: Server, address: string;
test.beforeAll(async () => {
  const bundle = await build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import HousePlanner from './app/HousePlanner';import {readWorkspaceDestination} from './lib/workspace-navigation';
      const params=new URLSearchParams(location.search),mode=params.get('mode')==='demo'?'demo':'real',language=params.get('lang')==='es'?'es':'en';localStorage.setItem('house-planner-language',language);
      const keys=['overview','activity','budget','quotes','expenses','documents','notes','aesthetics','distribution','approvals','plan','decisions','site'];
      const user={name:'Synthetic Reviewer',email:'reviewer@example.test',projectId:'featured-project',projectName:'Synthetic House',role:params.get('role')||'admin',permissions:Object.fromEntries(keys.map(key=>[key,true])),folderAccess:{mode:'all',folderIds:[],allowUnfiled:true}};
      createRoot(document.getElementById('root')).render(<HousePlanner mode={mode} user={user} initialLanguage={language} initialDestination={readWorkspaceDestination(location.href)} onSwitchMode={()=>{}} onSignOut={()=>{}}/>);`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, loader: { ".webp": "dataurl" }, outfile: "featured-documents.js", platform: "browser", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "featured-browser-adapters", setup(builder) {
      builder.onResolve({ filter: /^(next\/(image|dynamic)|@\/lib\/usage-client)$/ }, args => ({ path: args.path, namespace: "featured-adapters" }));
      builder.onResolve({ filter: /\/(AssistantPanel|ExpensesWorkspace|AestheticsWorkspace|NotesWorkspace|QuotesWorkspace|MobileCapture|DistributionAdmin|GoogleSheetsEditing|ActivityWorkspace)$/ }, args => ({ path: args.path.split("/").pop()!, namespace: "featured-adapters" }));
      builder.onLoad({ filter: /.*/, namespace: "featured-adapters" }, args => ({
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
    const path = new URL(request.url || "/", "http://featured.local").pathname;
    if (path === "/featured-documents.js") { response.setHeader("content-type", "text/javascript"); response.end(script); return; }
    if (path === "/og.png" || /^\/demo\/[a-zA-Z0-9_.-]+$/.test(path)) {
      try { response.end(await readFile(`public${path}`)); } catch { response.writeHead(404); response.end("Missing synthetic asset"); } return;
    }
    if (path === "/synthetic-preview") { response.setHeader("content-type", "text/html"); response.end("<p>Synthetic plan preview</p>"); return; }
    if (path === "/synthetic-download") { response.setHeader("content-disposition", 'attachment; filename="Synthetic.pdf"'); response.end("Synthetic download"); return; }
    if (path.startsWith("/api/")) { response.writeHead(500); response.end("Unexpected unmocked request"); return; }
    response.setHeader("content-type", "text/html");
    response.end(`<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><style>html{--font-geist-sans:Arial;--font-geist-mono:monospace}${css}</style><div id="root"></div><script src="/featured-documents.js"></script></html>`);
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>(done => server.close(() => done())); });

const createdAt = "2026-10-14T12:00:00Z";
const folders = [
  { id: "plans", name: "Plans", parentId: null, createdAt },
  { id: "structural", name: "Structural drawings with a deliberately long folder name", parentId: "plans", createdAt },
  { id: "contracts", name: "Contracts", parentId: null, createdAt },
  { id: "vault", name: "Protected vault", parentId: null, createdAt, encrypted: true, unlocked: true },
  { id: "vault-child", name: "Private nested folder", parentId: "vault", createdAt },
  { id: "invoice", name: "Factura", parentId: null, createdAt },
  { id: "invoice-child", name: "Receipts", parentId: "invoice", createdAt },
  { id: "purchases", name: "Compras", parentId: null, createdAt },
  { id: "orphan", name: "Unavailable ancestry", parentId: "absent", createdAt },
];
const documentRecord = (id: string, name: string, folderId: string | null, extra = {}) => ({ id, name, folderId, contentType: "application/pdf", size: 1024, uploadedBy: "Synthetic Reviewer", createdAt, downloadUrl: "/synthetic-download", ...extra });
const records = [
  documentRecord("unfiled", "Unfiled summary.pdf", null),
  documentRecord("plan", "General plan.pdf", "plans", { description: "Approved reference plan", previewKind: "pdf", previewUrl: "/synthetic-preview", quoteReferenceSupported: true }),
  documentRecord("structure", "Structural design.pdf", "structural", { description: "Foundation drawing" }),
  documentRecord("contract", "Signed contract.pdf", "contracts"),
  documentRecord("vault-document", "Excluded vault descendant.pdf", "vault-child"),
  documentRecord("encrypted", "Excluded encrypted file.pdf", "vault", { encrypted: true }),
  documentRecord("receipt", "Excluded invoice descendant.pdf", "invoice-child"),
  documentRecord("purchase", "Excluded purchase file.pdf", "purchases"),
  documentRecord("orphan-document", "Excluded orphaned file.pdf", "orphan"),
];
type Call = { path: string; method: string; body?: Record<string, unknown> };
async function fixture(page: Page, options: { ids?: string[]; readFailures?: number; saveFailures?: number; limitFailures?: number; documents?: ReturnType<typeof documentRecord>[] } = {}) {
  const calls: Call[] = [], state = { ids: [...(options.ids || ["plan"])], readFailures: options.readFailures || 0, saveFailures: options.saveFailures || 0, limitFailures: options.limitFailures || 0 };
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method(), body = request.postData() ? request.postDataJSON() as Record<string, unknown> : undefined;
    calls.push({ path, method, body });
    if (path === "/api/documents/featured") {
      if (method === "GET") {
        if (state.readFailures-- > 0) return route.fulfill({ status: 500, json: { error: "Synthetic read failure" } });
      } else if (method === "PATCH") {
        if (state.saveFailures-- > 0) return route.fulfill({ status: 500, json: { error: "Synthetic save failure" } });
        if (state.limitFailures-- > 0) return route.fulfill({ status: 409, json: { error: "Synthetic global limit" } });
        state.ids = applyFeaturedDocumentsChange(state.ids, body as FeaturedDocumentsChange);
      } else return route.fulfill({ status: 405, json: {} });
      // hidden represents a valid selection outside this reviewer's permission.
      // unrepresented simulates a stale files response while the selection read is current.
      return route.fulfill({ json: { documentIds: state.ids.filter(id => id !== "hidden") } });
    }
    // Language preference persistence is independent of project/file mutations.
    if (path === "/api/notifications" && method === "PATCH") return route.fulfill({ json: { ok: true } });
    if (method !== "GET") return route.fulfill({ status: 500, json: { error: `Unexpected file or project mutation: ${path}` } });
    const responses: Record<string, unknown> = {
      "/api/projects": { projects: [{ id: "featured-project", name: "Synthetic House", kind: "shared", role: "admin", active: true }], canCreateProjects: false },
      "/api/budget": { currency: "CRC", objective: 100, excess: 0, spent: 0, remaining: 100, percentUsed: 0, status: "within_objective", editingAllowed: true, lines: [], summaries: { chapter: [], type: [], subcategory: [] } },
      "/api/overview": { imageIds: [], noteIds: [] }, "/api/aesthetics": { folders: [], images: [] }, "/api/notes": { notes: [] },
      "/api/property-profile": { profile: null }, "/api/files": { documents: options.documents || records }, "/api/folders": { folders }, "/api/plan": { items: [] },
      "/api/countdowns": { countdowns: [] }, "/api/notifications": { configured: false, sender: "", emailEnabled: true, recipients: [] },
      "/api/decisions": { decisions: [] }, "/api/site-issues": { issues: [] }, "/api/approvals": { approvals: [] },
      "/api/access": { users: [], canGrantProjectCreation: false }, "/api/invitations": { invitations: [] },
      "/api/events/documents": { version: 1 }, "/api/house-distribution": { ready: false },
    };
    return route.fulfill({ status: path in responses ? 200 : 500, json: responses[path] || { error: `Unhandled synthetic API: ${path}` } });
  });
  return { calls, state, writes: () => calls.filter(call => call.method !== "GET" && call.path !== "/api/notifications"), saves: () => calls.filter(call => call.path === "/api/documents/featured" && call.method === "PATCH") };
}
const rows = (page: Page) => page.locator(".featured-document-row");
async function open(page: Page, query = "") {
  await page.goto(`${address}/projects/featured-project/documents${query}`);
  await expect(page.getByRole("heading", { name: "Featured documents", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose documents" })).toBeEnabled();
}
async function picker(page: Page) { await page.getByRole("button", { name: "Choose documents" }).click(); return page.getByRole("dialog", { name: "Choose featured documents", exact: true }); }
async function assertWidth(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); }
async function navigate(page: Page, name: "Documents" | "Plan & schedule") {
  const desktop = page.locator(".sidebar nav").getByRole("button", { name, exact: false });
  if (await desktop.isVisible()) { await desktop.click(); return; }
  const primary = page.locator(".mobile-workspace-nav").getByRole("button", { name, exact: false });
  if (await primary.count()) { await primary.click(); return; }
  await page.locator(".mobile-workspace-nav").getByRole("button", { name: "Sections", exact: true }).click();
  await page.locator(".mobile-sections-dialog").getByRole("button", { name, exact: false }).click();
}
async function locale(page: Page, language: "en" | "es") {
  const desktop = page.locator(".top-actions .language-switch").getByRole("button", { name: language.toUpperCase(), exact: true });
  if (await desktop.isVisible()) { await desktop.click(); return; }
  await page.locator(".mobile-workspace-nav").getByRole("button", { name: /^(Sections|Secciones)$/ }).click();
  const menu = page.locator(".mobile-sections-dialog");
  await menu.getByRole("button", { name: language.toUpperCase(), exact: true }).click();
  await expect(menu).toBeHidden();
}

for (const width of [1280, 320]) {
  test(`saved cross-folder entry points, reload, preview, path navigation and drops preserve files at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 }); const api = await fixture(page); await open(page);
    await expect(rows(page)).toHaveCount(1); await expect(rows(page)).toContainText("General plan.pdf");
    await expect(page.locator(".document-folders")).toContainText("Plans");
    const dialog = await picker(page);
    await dialog.getByLabel("Folder", { exact: true }).selectOption("folder:structural");
    await dialog.getByRole("checkbox", { name: /Structural design.pdf/ }).check();
    await dialog.getByLabel("Folder", { exact: true }).selectOption("folder:contracts");
    await dialog.getByRole("checkbox", { name: /Signed contract.pdf/ }).check();
    await dialog.getByLabel("Folder", { exact: true }).selectOption("");
    await dialog.getByLabel("Search documents", { exact: true }).fill("Foundation drawing");
    await expect(dialog.getByRole("checkbox", { name: /Structural design.pdf/ })).toBeChecked();
    await assertWidth(page);
    for (const button of await dialog.locator("button").all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await dialog.getByRole("button", { name: "Save selection", exact: true }).click();
    await expect(dialog).toBeHidden(); await expect(rows(page)).toHaveCount(3);
    expect(api.saves()[0].body).toEqual({ addIds: ["structure", "contract"], removeIds: [] });
    await page.reload(); await expect(rows(page)).toHaveCount(3);
    const plan = rows(page).filter({ hasText: "General plan.pdf" });
    await expect(plan).toHaveAttribute("draggable", "false");
    await expect(plan.locator("select,input,.delete-document-button,.description-document-button")).toHaveCount(0);
    await expect(plan.getByRole("link", { name: "Download General plan.pdf", exact: true })).toHaveAttribute("href", "/synthetic-download");
    await plan.getByRole("button", { name: "Preview General plan.pdf", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Preview General plan.pdf", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close preview", exact: true }).click();
    await page.locator(".featured-documents-panel").evaluate(element => {
      const transfer = new DataTransfer(); transfer.setData("application/x-house-planner-document", "structure");
      element.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    // Download links have native draggable behavior even when the row itself
    // is draggable=false. A bubbling child drag must not acquire a file-move ID.
    const download = plan.getByRole("link", { name: "Download General plan.pdf", exact: true });
    const drag = await download.evaluate(element => {
      const transfer = new DataTransfer(); transfer.setData("text/uri-list", (element as HTMLAnchorElement).href);
      const event = new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }); element.dispatchEvent(event);
      const target = [...document.querySelectorAll(".folder-card")].find(folder => folder.textContent?.includes("Contracts"))!;
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      return { canceled: event.defaultPrevented, fileId: transfer.getData("application/x-house-planner-document"), textId: transfer.getData("text/plain") };
    });
    expect(drag).toEqual({ canceled: true, fileId: "", textId: "" });
    await assertWidth(page);
    const path = rows(page).filter({ hasText: "Structural design.pdf" }).locator(".featured-document-path");
    await expect(path).toBeVisible(); await expect(path).toHaveText("Plans / Structural drawings with a deliberately long folder name");
    expect((await path.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await path.click(); await expect(page).toHaveURL(/\/documents\/folder\/structural$/);
    await expect(page.locator(".doc-row")).toHaveCount(1); await expect(page.locator(".doc-row")).toContainText("Structural design.pdf");
    await page.locator(".folder-breadcrumb").getByRole("button", { name: "Documents", exact: true }).click();
    await page.getByRole("group", { name: "Document views" }).getByRole("button", { name: "Unfiled documents", exact: true }).click();
    await expect(page.locator(".doc-row")).toHaveCount(1); await expect(page.locator(".doc-row")).toContainText("Unfiled summary.pdf");
    await page.getByRole("group", { name: "Document views" }).getByRole("button", { name: "Featured", exact: true }).click();
    await expect(rows(page)).toHaveCount(3); expect(api.writes()).toEqual(api.saves()); expect(api.state.ids).toEqual(["plan", "structure", "contract"]);
  });
}

test("Cancel, native Escape and backdrop discard drafts without saving and restore focus", async ({ page }) => {
  const api = await fixture(page); await open(page);
  for (const action of ["cancel", "escape", "backdrop"]) {
    const dialog = await picker(page); await dialog.getByRole("checkbox", { name: /Signed contract.pdf/ }).check();
    if (action === "cancel") await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    else if (action === "escape") await page.keyboard.press("Escape");
    else await page.mouse.click(2, 2);
    await expect(dialog).toBeHidden(); await expect(page.getByRole("button", { name: "Choose documents" })).toBeFocused();
    await expect(rows(page)).toHaveCount(1); expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  }
  expect(api.writes()).toEqual([]);
});

test("failed save and global limit keep previous list and draft; retry submits the same delta", async ({ page }) => {
  const api = await fixture(page, { saveFailures: 1, limitFailures: 1 }); await open(page);
  const dialog = await picker(page); await dialog.getByRole("checkbox", { name: /Signed contract.pdf/ }).check();
  await dialog.getByRole("button", { name: "Save selection", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("could not be saved"); await expect(dialog.getByRole("checkbox", { name: /Signed contract.pdf/ })).toBeChecked();
  expect(api.state.ids).toEqual(["plan"]); await expect(rows(page)).toHaveCount(1);
  await dialog.getByRole("button", { name: "Save selection", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("up to 30"); expect(api.state.ids).toEqual(["plan"]);
  await dialog.getByRole("button", { name: "Save selection", exact: true }).click();
  await expect(dialog).toBeHidden(); await expect(rows(page)).toHaveCount(2);
  expect(api.saves().map(call => call.body)).toEqual(Array(3).fill({ addIds: ["contract"], removeIds: [] }));
});

test("stale and inaccessible selections survive a visible-only delta; protected and reserved candidates stay absent", async ({ page }) => {
  const api = await fixture(page, { ids: ["plan", "unrepresented", "hidden", "vault-document", "encrypted", "receipt", "purchase", "orphan-document"] }); await open(page);
  await expect(rows(page)).toHaveCount(1); const dialog = await picker(page);
  await expect(dialog.locator(".featured-documents-candidate")).toHaveCount(4);
  await expect(dialog).not.toContainText("Excluded"); await expect(dialog).not.toContainText("hidden"); await expect(dialog).not.toContainText("unrepresented");
  await dialog.getByRole("checkbox", { name: /General plan.pdf/ }).uncheck(); await dialog.getByRole("checkbox", { name: /Signed contract.pdf/ }).check();
  await dialog.getByRole("button", { name: "Save selection", exact: true }).click(); await expect(dialog).toBeHidden();
  expect(api.saves()[0].body).toEqual({ addIds: ["contract"], removeIds: ["plan"] });
  expect(api.state.ids).toEqual(["unrepresented", "hidden", "vault-document", "encrypted", "receipt", "purchase", "orphan-document", "contract"]);
  await expect(rows(page)).toHaveCount(1); await expect(rows(page)).toContainText("Signed contract.pdf");
});

test("a read failure blocks accidental empty writes until explicit retry", async ({ page }) => {
  const api = await fixture(page, { readFailures: 1 }); await page.goto(`${address}/projects/featured-project/documents`);
  await expect(page.getByRole("alert")).toContainText("could not be loaded"); await expect(page.getByRole("button", { name: "Choose documents" })).toBeDisabled();
  expect(api.writes()).toEqual([]); await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(rows(page)).toHaveCount(1); const dialog = await picker(page); await expect(dialog.getByRole("checkbox", { name: /General plan.pdf/ })).toBeChecked();
  await page.keyboard.press("Escape"); expect(api.writes()).toEqual([]);
});

test("viewers can read selected entry points and full paths without curation controls", async ({ page }) => {
  const api = await fixture(page, { documents: records.map(record => record.id === "plan" ? { ...record, uploadedBy: "Demo Visitor" } : record) }); await page.goto(`${address}/projects/featured-project/documents?role=viewer&lang=es`);
  await expect(page.getByRole("heading", { name: "Documentos destacados", exact: true })).toBeVisible(); await expect(rows(page)).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Seleccionar documentos" })).toHaveCount(0); await expect(rows(page).locator(".featured-document-path")).toBeVisible();
  await expect(rows(page).locator("select,input,.delete-document-button")).toHaveCount(0);
  // Real authors are private content, even when their name matches a demo label.
  await expect(rows(page)).toContainText("Demo Visitor"); await expect(rows(page)).not.toContainText("Visitante Demo"); expect(api.writes()).toEqual([]);
});

for (const width of [1280, 320]) {
  test(`demo selection survives navigation and EN/ES without project requests at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 }); const requests: string[] = [];
    await page.route("**/api/**", route => { requests.push(route.request().url()); return route.fulfill({ status: 403, json: { error: "Demo must remain local" } }); });
    await open(page, "?mode=demo"); await expect(rows(page)).toContainText("Demo_Quote.txt");
    let dialog = await picker(page); await dialog.getByRole("checkbox", { name: /Demo_Quote.txt/ }).uncheck();
    await dialog.getByRole("button", { name: "Save selection", exact: true }).click(); await expect(rows(page)).toHaveCount(0);
    const empty = page.locator(".featured-documents-panel>.empty-state"); await expect(empty).toContainText("No featured documents yet");
    expect((await empty.boundingBox())!.height).toBeLessThan(200); await assertWidth(page);
    await navigate(page, "Plan & schedule");
    await navigate(page, "Documents"); await expect(rows(page)).toHaveCount(0);

    // Exercise the ordinary demo upload handler, then curate the new record.
    // Its system author localizes; the visitor's filename stays exactly as typed.
    const customName = "Custom privado.txt";
    await page.getByRole("button", { name: "Open Plans", exact: true }).click();
    await page.locator('input[type="file"][multiple]').setInputFiles({ name: customName, mimeType: "text/plain", buffer: Buffer.from("Synthetic visitor note.") });
    await expect(page.locator(".doc-row").filter({ hasText: customName })).toContainText("Demo Visitor");
    await page.locator(".folder-breadcrumb").getByRole("button", { name: "Documents", exact: true }).click();
    dialog = await picker(page); await dialog.getByRole("checkbox", { name: /Custom privado.txt/ }).check();
    await dialog.getByRole("button", { name: "Save selection", exact: true }).click();
    const custom = rows(page).filter({ hasText: customName }); await expect(custom).toContainText("Demo Visitor");

    await locale(page, "es"); await expect(page.getByRole("heading", { name: "Documentos destacados", exact: true })).toBeVisible();
    await expect(custom.locator("b")).toHaveText(customName); await expect(custom).toContainText("Visitante Demo"); await expect(custom).not.toContainText("Demo Visitor");
    await page.getByRole("button", { name: "Seleccionar documentos" }).click(); dialog = page.getByRole("dialog", { name: "Seleccionar documentos destacados", exact: true });
    await dialog.getByLabel("Carpeta", { exact: true }).selectOption("folder:demo-quotes");
    await dialog.getByRole("checkbox", { name: /Cotizacion_demo.txt/ }).check(); await expect(dialog).toContainText("Cotizaciones"); await assertWidth(page);
    await dialog.getByRole("button", { name: "Guardar selección", exact: true }).click(); await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).filter({ hasText: "Cotizacion_demo.txt" })).toContainText("Cotizacion_demo.txt");
    await custom.locator(".featured-document-path").click(); await expect(page.locator(".folder-breadcrumb .current")).toHaveText("Planos");
    await expect(page.locator(".doc-row").filter({ hasText: customName })).toContainText("Visitante Demo");
    await expect(page.locator(".doc-row").filter({ hasText: customName }).locator("b")).toHaveText(customName);
    await page.locator(".folder-breadcrumb").getByRole("button", { name: "Documentos", exact: true }).click(); await expect(rows(page)).toHaveCount(2);

    await locale(page, "en"); await expect(custom.locator("b")).toHaveText(customName); await expect(custom).toContainText("Demo Visitor");
    const quote = rows(page).filter({ hasText: "Demo_Quote.txt" }); await expect(quote).toContainText("Demo_Quote.txt");
    await expect(quote.locator(".featured-document-path")).toHaveText("Quotes");
    await quote.locator(".featured-document-path").click(); await expect(page.locator(".folder-breadcrumb .current")).toHaveText("Quotes"); await expect(page.locator(".doc-row")).toContainText("Demo_Quote.txt");
    await page.locator(".folder-breadcrumb").getByRole("button", { name: "Documents", exact: true }).click(); await expect(rows(page)).toHaveCount(2);
    await expect(custom).toContainText("Demo Visitor"); await expect(quote).toContainText("Demo_Quote.txt");
    await navigate(page, "Plan & schedule"); await navigate(page, "Documents"); await expect(rows(page)).toHaveCount(2);
    await expect(custom.locator("b")).toHaveText(customName); await expect(custom).toContainText("Demo Visitor");
    expect(requests).toEqual([]);
  });
}


test("native touch scroll reaches the last candidate and rotation retains the draft and accessible footer", async ({ browser, browserName }) => {
  test.skip(browserName !== "chromium", "Native touch input uses the Chromium protocol.");
  const context = await browser.newContext({ viewport: { width: 320, height: 720 }, isMobile: true, hasTouch: true });
  const page = await context.newPage(), session = await context.newCDPSession(page);
  try {
    const candidates = [records[1], ...Array.from({ length: 40 }, (_, index) => documentRecord(`mobile-${index + 1}`, `Mobile candidate ${String(index + 1).padStart(2, "0")}.pdf`, "structural"))];
    const api = await fixture(page, { documents: candidates }); await open(page);
    const originalOverflow = await page.evaluate(() => document.body.style.overflow);
    await page.getByRole("button", { name: "Choose documents" }).tap();
    const dialog = page.getByRole("dialog", { name: "Choose featured documents", exact: true });
    const list = dialog.locator(".featured-documents-candidates");
    await expect(dialog).toBeVisible(); await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
    expect(await list.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    const pageScroll = await page.evaluate(() => scrollY);
    const bounds = (await list.boundingBox())!;
    const swipeList = async () => {
      const box = (await list.boundingBox())!, x = box.x + box.width / 2, y = box.y + box.height * .8, distance = box.height * .6;
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let step = 1; step <= 8; step++) await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - distance * step / 8 }] });
      // A stationary pause before lift models a deliberate swipe and avoids
      // a compositor fling consuming the user's subsequent checkbox tap.
      await page.waitForTimeout(100);
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - distance }] });
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    await swipeList();
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => scrollY)).toBe(pageScroll);
    // Reach the end through native gestures, without setting scrollTop or asking
    // Playwright to scroll the checkbox into view on the application's behalf.
    for (let attempt = 0; attempt < 20; attempt++) {
      if (await list.evaluate(element => element.scrollTop + element.clientHeight >= element.scrollHeight - 2)) break;
      await swipeList();
    }
    await expect.poll(() => list.evaluate(element => element.scrollTop + element.clientHeight >= element.scrollHeight - 2)).toBe(true);
    const last = dialog.getByRole("checkbox", { name: /Mobile candidate 40.pdf/ });
    const lastBounds = (await last.boundingBox())!;
    expect(lastBounds.y).toBeGreaterThanOrEqual(bounds.y); expect(lastBounds.y + lastBounds.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1);
    await last.tap(); await expect(last).toBeChecked(); await expect(dialog.locator(".featured-documents-count")).toHaveText("2 / 30 selected");
    for (const viewport of [{ width: 320, height: 720 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport); await expect(last).toBeChecked();
      await expect(page.locator("body")).toHaveCSS("overflow", "hidden"); await assertWidth(page);
      const box = (await dialog.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width); expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      for (const name of ["Save selection", "Cancel"]) {
        const button = dialog.getByRole("button", { name, exact: true }); await expect(button).toBeVisible();
        const buttonBounds = (await button.boundingBox())!;
        expect(buttonBounds.height).toBeGreaterThanOrEqual(44); expect(buttonBounds.width).toBeGreaterThanOrEqual(44);
        expect(buttonBounds.y).toBeGreaterThanOrEqual(0); expect(buttonBounds.y + buttonBounds.height).toBeLessThanOrEqual(viewport.height);
      }
    }
    await dialog.getByRole("button", { name: "Cancel", exact: true }).tap(); await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe(originalOverflow);
    await expect(rows(page)).toHaveCount(1); expect(api.writes()).toEqual([]);
    const surface = page.locator(".featured-documents-panel>.section-head"); await surface.scrollIntoViewIfNeeded();
    const surfaceBounds = (await surface.boundingBox())!, before = await page.evaluate(() => scrollY);
    const x = surfaceBounds.x + surfaceBounds.width / 2, y = Math.min(220, Math.max(140, surfaceBounds.y + surfaceBounds.height / 2)), dy = before > 50 ? 120 : -120;
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let step = 1; step <= 8; step++) await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + dy * step / 8 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => page.evaluate(() => scrollY)).not.toBe(before);
  } finally { await context.close(); }
});
