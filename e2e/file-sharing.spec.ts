import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";

// Real Documents/Aesthetics controls with synthetic HTTP contracts. Backend
// authorization and public delivery are exercised separately by route tests.
let server: Server, address: string;
test.beforeAll(async () => {
  const bundle = await build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import HousePlanner from './app/HousePlanner';import {readWorkspaceDestination} from './lib/workspace-navigation';
      const p=new URLSearchParams(location.search),language=p.has('es')?'es':'en';localStorage.setItem('house-planner-language',language);
      const keys=['overview','activity','budget','quotes','expenses','documents','notes','aesthetics','distribution','approvals','plan','decisions','site'];
      const user={name:'Synthetic Sharer',email:'share@example.test',projectId:'share-project',projectName:'Synthetic House',isPersonal:false,role:p.get('role')||'admin',readOnlyLink:p.has('readOnly'),anonymousLink:p.has('anonymous'),permissions:Object.fromEntries(keys.map(k=>[k,true])),folderAccess:{mode:'all',folderIds:[],allowUnfiled:true}};
      createRoot(document.getElementById('root')).render(<HousePlanner mode={p.has('demo')?'demo':'real'} user={user} initialLanguage={language} initialDestination={readWorkspaceDestination(location.href)} onSwitchMode={()=>{}} onSignOut={()=>{}}/>);`, loader: "tsx", resolveDir: process.cwd() },
    bundle: true, write: false, loader: { ".webp": "dataurl" }, outfile: "file-sharing.js", platform: "browser", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "sharing-browser-adapters", setup(builder) {
      builder.onResolve({ filter: /^(next\/(image|dynamic)|@\/lib\/usage-client)$/ }, args => ({ path: args.path, namespace: "sharing-adapters" }));
      builder.onResolve({ filter: /\/(AssistantPanel|ExpensesWorkspace|NotesWorkspace|QuotesWorkspace|MobileCapture|DistributionAdmin|GoogleSheetsEditing|ActivityWorkspace)$/ }, args => ({ path: args.path.split("/").pop()!, namespace: "sharing-adapters" }));
      builder.onLoad({ filter: /.*/, namespace: "sharing-adapters" }, args => ({ contents: `import React from 'react';${args.path === "next/image" ? "export default function Image({fill,priority,unoptimized,...p}){return <img {...p}/>;}"
        : args.path === "@/lib/usage-client" ? "export const useUsageTracking=()=>{},flushUsageBeforeTransition=async()=>{},trackDemoAction=()=>{},trackUsageInteraction=()=>{};"
        : args.path === "next/dynamic" ? "export default ()=>function OptionalDynamic(){return null;}"
        : args.path === "ExpensesWorkspace" ? "export default function Leaf(){return null;}export function ExpenseDialog({children}){return <>{children}</>;}export function MediaPreview(){return null;}"
        : args.path === "ActivityWorkspace" ? "export default function Leaf(){return null;}export function ActivitySummaryCard(){return null;}"
        : "export default function Leaf(){return null;}"}`, loader: "tsx", resolveDir: process.cwd() }));
    } }],
  });
  const script = bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  const css = await readFile("app/globals.css", "utf8") + (bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text || "");
  server = createServer((request, response) => {
    const path = new URL(request.url || "/", "http://sharing.local").pathname;
    if (path === "/file-sharing.js") { response.setHeader("content-type", "text/javascript"); response.end(script); return; }
    if (path === "/synthetic.png") { response.setHeader("content-type", "image/png"); response.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=", "base64")); return; }
    if (path.startsWith("/api/")) { response.writeHead(500); response.end("Unexpected unmocked request"); return; }
    response.setHeader("content-type", "text/html");
    response.end(`<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><div id="root"></div><script src="/file-sharing.js"></script></html>`);
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>(done => server.close(() => done())); });

async function fixture(page: Page) {
  const calls: Record<string, unknown>[] = [];
  const createdAt = "2026-10-18T12:00:00Z";
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/api/files/share") {
      expect(request.method()).toBe("POST");
      const body = request.postDataJSON(); calls.push(body);
      return route.fulfill({ json: { url: `/api/files/share?token=synthetic-${body.kind}-${body.expiresInDays}`, expiresAt: "2026-10-25T12:00:00Z", expiresInDays: body.expiresInDays } });
    }
    if (path === "/api/notifications" && request.method() === "PATCH") return route.fulfill({ json: { ok: true } });
    const responses: Record<string, unknown> = {
      "/api/projects": { projects: [{ id: "share-project", name: "Synthetic House", currency: "CRC", kind: "shared", role: "admin", active: true }] },
      "/api/budget": { currency: "CRC", objective: 100, excess: 0, spent: 0, remaining: 100, percentUsed: 0, status: "within_objective", editingAllowed: true, lines: [], summaries: { chapter: [], type: [], subcategory: [] } },
      "/api/files": { documents: [
        { id: "plan", name: "Shared plan.pdf", folderId: null, contentType: "application/pdf", size: 1024, uploadedBy: "Synthetic Sharer", createdAt, downloadUrl: "/synthetic-download" },
        { id: "secret", name: "Encrypted agreement.pdf", folderId: "vault-child", encrypted: true, contentType: "application/pdf", size: 1024, uploadedBy: "Synthetic Sharer", createdAt, downloadUrl: "/synthetic-download" },
      ] },
      "/api/folders": { folders: [{ id: "vault", name: "Protected", parentId: null, createdAt, encrypted: true, unlocked: true, unlockedUntil: Date.now() + 900000 }, { id: "vault-child", name: "Private", parentId: "vault", createdAt }] },
      "/api/aesthetics": { folders: [{ id: "interior", name: "Interior", kind: "images", carouselImageIds: [], createdAt }], images: [{ id: "kitchen", folderId: "interior", name: "Kitchen.jpg", caption: "", notes: "", width: 1, height: 1, mediaType: "image", contentType: "image/jpeg", createdAt, imageUrl: "/synthetic.png", thumbnailUrl: "/synthetic.png" }] },
      "/api/documents/featured": { documentIds: ["plan"] }, "/api/overview": { imageIds: [], noteIds: [] }, "/api/notes": { notes: [] },
      "/api/property-profile": { profile: null }, "/api/plan": { items: [] }, "/api/countdowns": { countdowns: [] },
      "/api/notifications": { configured: false, sender: "", emailEnabled: false, recipients: [] }, "/api/decisions": { decisions: [] }, "/api/site-issues": { issues: [] },
      "/api/approvals": { approvals: [] }, "/api/access": { users: [], canGrantProjectCreation: false }, "/api/invitations": { invitations: [] }, "/api/events/documents": { version: 1 }, "/api/house-distribution": { ready: false },
    };
    return route.fulfill({ status: path in responses ? 200 : 500, json: responses[path] || { error: "Unhandled synthetic API" } });
  });
  return calls;
}

for (const width of [1280, 390]) {
  test(`shares an ordinary document for seven or three days at ${width}px`, async ({ page }) => {
    const calls = await fixture(page);
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (url: string) => { (window as unknown as { copied: string }).copied = url; } } }));
    await page.goto(`${address}/projects/share-project/documents`);
    const trigger = page.getByRole("button", { name: "Share Shared plan.pdf", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Temporary link", exact: true });
    await expect(dialog.getByLabel("Link duration")).toHaveValue("7");
    await expect(dialog).toContainText("without signing in");
    await dialog.getByRole("button", { name: "Create link", exact: true }).click();
    await expect(dialog.getByLabel("Share link", { exact: true })).toHaveValue(`${address}/api/files/share?token=synthetic-document-7`);
    await expect(dialog.locator("time")).toHaveAttribute("datetime", "2026-10-25T12:00:00Z");
    await dialog.getByRole("button", { name: "Copy link", exact: true }).click();
    await expect(dialog.getByRole("status")).toHaveText("Link copied");
    expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toBe(`${address}/api/files/share?token=synthetic-document-7`);
    await dialog.getByLabel("Link duration").selectOption("3");
    await expect(dialog.getByLabel("Share link", { exact: true })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Create link", exact: true }).click();
    await expect(dialog.getByLabel("Share link", { exact: true })).toHaveValue(/synthetic-document-3$/);
    expect(calls).toEqual([{ kind: "document", id: "plan", expiresInDays: 7 }, { kind: "document", id: "plan", expiresInDays: 3 }]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`share-document-${width}.png`), fullPage: true });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test(`shares an aesthetics image in Spanish with clipboard fallback at ${width}px`, async ({ page }) => {
    const calls = await fixture(page);
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }));
    await page.goto(`${address}/projects/share-project/aesthetics/folder/interior?es`);
    await page.getByRole("button", { name: "Compartir Kitchen.jpg", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Enlace temporal", exact: true });
    await dialog.getByLabel("Vigencia del enlace").selectOption("1");
    await dialog.getByRole("button", { name: "Crear enlace", exact: true }).click();
    await expect(dialog.getByLabel("Enlace para compartir")).toHaveValue(/synthetic-aesthetic-1$/);
    await dialog.getByRole("button", { name: "Copiar enlace", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText("manualmente");
    await expect(dialog.getByLabel("Enlace para compartir")).toBeFocused();
    expect(calls).toEqual([{ kind: "aesthetic", id: "kitchen", expiresInDays: 1 }]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`share-aesthetic-${width}.png`), fullPage: true });
  });
}

test("hides sharing for viewers, read-link guests and encrypted descendants", async ({ page }) => {
  const calls = await fixture(page);
  for (const query of ["role=viewer", "readOnly", "anonymous"]) {
    await page.goto(`${address}/projects/share-project/documents?${query}`);
    await expect(page.locator(".doc-row").filter({ hasText: "Shared plan.pdf" })).toBeVisible();
    await expect(page.locator(".file-share-button")).toHaveCount(0);
    await page.goto(`${address}/projects/share-project/aesthetics/folder/interior?${query}`);
    await expect(page.locator(".aesthetic-grid")).toBeVisible();
    await expect(page.locator(".file-share-button")).toHaveCount(0);
  }
  await page.goto(`${address}/projects/share-project/documents/folder/vault-child`);
  await expect(page.locator(".doc-row").filter({ hasText: "Encrypted agreement.pdf" })).toBeVisible();
  await expect(page.locator(".file-share-button")).toHaveCount(0);
  expect(calls).toEqual([]);
});
