import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";

let server: Server;
let address: string;
const fixedTime = new Date("2026-10-06T15:00:00Z");
const vaultPassword = "Clave privada de prueba";

test.beforeAll(async () => {
  const bundle = await build({
    stdin: { contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import HousePlanner from './app/HousePlanner';
      const keys=['overview','activity','budget','quotes','expenses','documents','notes','aesthetics','distribution','approvals','plan','decisions','site'];
      const user={name:'Administrador',email:'admin@example.test',projectId:'vault-project',projectName:'Casa de prueba',isPersonal:false,role:'admin',permissions:Object.fromEntries(keys.map(key=>[key,true])),folderAccess:{mode:'all',folderIds:[],allowUnfiled:true}};
      localStorage.setItem('house-planner-language','es');
      createRoot(document.getElementById('root')).render(<HousePlanner mode="real" user={user} initialDestination={{projectId:'vault-project',section:'documents',budgetScope:null}} onSwitchMode={()=>{}} onSignOut={()=>{}}/>);
    `, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, loader: { ".webp": "dataurl" }, outfile: "vault.js", platform: "browser", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "vault-workspace-leaves", setup(builder) {
      builder.onResolve({ filter: /^next\/(image|dynamic)$/ }, args => ({ path: args.path, namespace: "vault-mocks" }));
      builder.onResolve({ filter: /\/(AssistantPanel|BudgetWorkspace|ExpensesWorkspace|AestheticsWorkspace|NotesWorkspace|QuotesWorkspace|MobileCapture|DistributionAdmin|DistributionWorkspace|ActivityWorkspace|AnalyticsWorkspace|SiteFooter)$/ }, args => ({ path: args.path.split("/").pop()!, namespace: "vault-mocks" }));
      builder.onLoad({ filter: /.*/, namespace: "vault-mocks" }, args => ({
        contents: "import React from 'react';" + (args.path === "next/image"
          ? "export default function Image({fill,priority,...props}){return <img {...props}/>;}"
          : args.path === "next/dynamic" ? "export default ()=>function Distribution(){return null;}"
            : args.path === "ActivityWorkspace" ? "export default function Activity(){return null;} export function ActivitySummaryCard(){return null;}"
              : "export default function Leaf(){return null;}"), loader: "tsx", resolveDir: process.cwd(),
      }));
    } }],
  });
  const css = await readFile("app/globals.css", "utf8") + "\n" + (bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text || "");
  server = createServer((request, response) => {
    if (request.url === "/vault.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text); }
    else { response.setHeader("content-type", "text/html"); response.end(`<!doctype html><html lang="es" style="--font-geist-sans:Arial;--font-geist-mono:monospace"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/vault.js"></script></body></html>`); }
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>(done => server.close(() => done())); });

async function mockProject(page: Page, existing = false, rootDocument = false) {
  let created = existing;
  let unlocked = false;
  let unlockedUntil = fixedTime.getTime() + 15 * 60_000;
  let allowedUids: string[] = [];
  let currentPassword = vaultPassword;
  const calls: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.postData() && request.headers()["content-type"]?.includes("application/json") ? request.postDataJSON() as Record<string, unknown> : undefined;
    calls.push({ path: url.pathname, method: request.method(), body });
    let data: unknown = {};
    switch (url.pathname) {
      case "/api/projects": data = { projects: [{ id: "vault-project", name: "Casa de prueba", kind: "shared", role: "admin", active: true }] }; break;
      case "/api/property-profile": data = { profile: null }; break;
      case "/api/house-distribution": data = { ready: false }; break;
      case "/api/budget": data = { sheetCount: 0, rowCount: 0 }; break;
      case "/api/folders": {
        const vault = { id: "vault1", name: "Privado", parentId: null, createdAt: fixedTime.toISOString(), encrypted: true, unlocked, ...(unlocked ? { unlockedUntil } : {}) };
        if (request.method() === "POST") { created = true; data = { folder: vault }; }
        else data = { folders: created ? [vault, ...(unlocked ? [{ id: "nested", name: "Contratos", parentId: "vault1", createdAt: fixedTime.toISOString() }] : [])] : [] };
        break;
      }
      case "/api/files": data = { documents: unlocked ? [{ id: "secret", name: "Contrato privado.png", description: "Condiciones privadas", contentType: "image/png", size: 400, uploadedBy: "admin@example.test", folderId: rootDocument ? "vault1" : "nested", createdAt: fixedTime.toISOString(), encrypted: true, isImage: true, previewKind: "image", previewUrl: "/secret.svg", thumbnailUrl: "/secret.svg", downloadUrl: "/secret.svg", quoteReferenceSupported: true }] : [] }; break;
      case "/api/folder-vault":
        if (request.method() === "GET") data = { allowedUids, passwordResetAvailable: true, users: [{ uid: "ana", name: "Ana", email: "ana@example.test" }] };
        else if (request.method() === "POST") {
          if (body?.password !== currentPassword) { await route.fulfill({ status: 403, json: { error: "Invalid password" } }); return; }
          unlocked = true;
          unlockedUntil = await page.evaluate(() => Date.now() + 15 * 60_000);
        } else if (request.method() === "PATCH") {
          if (body?.action === "reset-password") { currentPassword = body.newPassword as string; data = { ok: true, passwordReset: true }; }
          else allowedUids = body?.allowedUids as string[];
          unlocked = false;
        }
        else if (request.method() === "DELETE") unlocked = false;
        break;
      case "/api/plan": data = { items: [] }; break;
      case "/api/countdowns": data = { countdowns: [] }; break;
      case "/api/notifications": data = { recipients: [], configured: false, emailEnabled: false, sender: "" }; break;
      case "/api/decisions": data = { decisions: [] }; break;
      case "/api/site-issues": data = { issues: [] }; break;
      case "/api/approvals": data = { approvals: [] }; break;
      case "/api/access": data = { users: [] }; break;
      case "/api/invitations": data = { invitations: [] }; break;
      case "/api/events/documents": data = { version: 1 }; break;
    }
    await route.fulfill({ json: data });
  });
  await page.route("**/secret.svg", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#d9e5f0"/><text x="60" y="200" font-size="30">Contrato privado</text></svg>' }));
  return calls;
}

test("administrator creates a vault, checks its password and grants a member without exposing files while locked", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.clock.install({ time: fixedTime });
  const calls = await mockProject(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${address}/projects/vault-project/documents`);
  await page.getByRole("button", { name: "Nueva carpeta", exact: false }).click();
  await page.getByLabel("Nombre de carpeta principal").fill("Privado");
  await page.getByRole("checkbox", { name: "Encriptar y proteger con contraseña" }).check();
  await page.getByLabel("Contraseña de la nueva carpeta", { exact: true }).fill(vaultPassword);
  await page.getByLabel("Confirmar contraseña", { exact: true }).fill("Otra contraseña privada");
  await expect(page.getByRole("button", { name: "Crear carpeta", exact: true })).toBeDisabled();
  await expect(page.getByText("El administrador puede restablecerla si la olvidas", { exact: false })).toBeVisible();
  await page.getByLabel("Confirmar contraseña", { exact: true }).fill(vaultPassword);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("vault-create-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Crear carpeta", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Carpeta bloqueada" })).toBeVisible();
  expect(calls.find(call => call.path === "/api/folders" && call.method === "POST")?.body).toEqual({ name: "Privado", parentId: null, password: vaultPassword });
  await expect(page.getByRole("button", { name: "Subir archivos", exact: false })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Nueva subcarpeta", exact: false })).toHaveCount(0);
  await page.getByLabel("Contraseña de la carpeta", { exact: true }).fill("Contraseña incorrecta");
  await page.getByRole("button", { name: "Desbloquear carpeta" }).click();
  await expect(page.getByRole("alert")).toContainText("confirma que el administrador");
  await expect(page.getByText("Contrato privado.png", { exact: true })).toHaveCount(0);
  await page.getByLabel("Contraseña de la carpeta", { exact: true }).fill(vaultPassword);
  await page.getByRole("button", { name: "Desbloquear carpeta" }).click();
  await expect(page.getByRole("button", { name: "Abrir Contratos" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Bloquear carpeta" })).toBeVisible();
  await page.getByRole("button", { name: "Administrar acceso a la carpeta" }).click();
  await page.getByRole("checkbox", { name: /Ana/ }).check();
  await page.getByRole("button", { name: "Guardar accesos" }).click();
  await expect(page.getByRole("heading", { name: "Carpeta bloqueada" })).toBeVisible();
  expect(calls.find(call => call.path === "/api/folder-vault" && call.method === "PATCH")?.body).toEqual({ folderId: "vault1", allowedUids: ["ana"] });
  await page.screenshot({ path: testInfo.outputPath("vault-locked-desktop.png"), fullPage: true });
  expect(errors).toEqual([]);
});

for (const action of ["Describir", "Eliminar"]) {
  test(`root vault expiry closes its ${action.toLowerCase()} dialog and clears private metadata`, async ({ page }) => {
    await page.clock.install({ time: fixedTime });
    await mockProject(page, true, true);
    await page.goto(`${address}/projects/vault-project/documents`);
    await page.getByRole("button", { name: "Abrir Privado" }).click();
    await page.getByLabel("Contraseña de la carpeta", { exact: true }).fill(vaultPassword);
    await page.getByRole("button", { name: "Desbloquear carpeta" }).click();
    await expect(page).toHaveURL(/\/documents\/folder\/vault1$/);
    await page.getByRole("button", { name: `${action} Contrato privado.png` }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.clock.fastForward(15 * 60_000);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Carpeta bloqueada" })).toBeVisible();
    await expect(page.getByText("Contrato privado.png", { exact: true })).toHaveCount(0);
    await expect(page).toHaveURL(/\/documents\/folder\/vault1$/);
    await page.getByLabel("Contraseña de la carpeta", { exact: true }).fill(vaultPassword);
    await page.getByRole("button", { name: "Desbloquear carpeta" }).click();
    await expect(page.getByRole("button", { name: "Bloquear carpeta" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}

for (const unlocked of [false, true]) {
  test(`administrator resets a ${unlocked ? "unlocked" : "locked"} vault without the old password and keeps member grants`, async ({ page }, testInfo) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.clock.install({ time: fixedTime });
    const calls = await mockProject(page, true);
    await page.setViewportSize(unlocked ? { width: 1440, height: 1000 } : { width: 375, height: 812 });
    await page.goto(`${address}/projects/vault-project/documents`);
    await page.getByRole("button", { name: "Abrir Privado" }).click();
    await page.getByRole("button", { name: "Administrar acceso a la carpeta" }).click();
    await page.getByRole("checkbox", { name: /Ana/ }).check();
    await page.getByRole("button", { name: "Guardar accesos" }).click();
    if (unlocked) {
      await page.getByLabel("Contraseña de la carpeta", { exact: true }).fill(vaultPassword);
      await page.getByRole("button", { name: "Desbloquear carpeta" }).click();
      await expect(page.getByRole("button", { name: "Abrir Contratos" })).toBeVisible();
    }
    await page.getByRole("button", { name: "Restablecer contraseña", exact: true }).click();
    await expect(page.getByText("sin conocer la anterior", { exact: false })).toBeVisible();
    const nextPassword = "Nueva clave privada de prueba";
    await page.getByLabel("Nueva contraseña de la carpeta", { exact: true }).fill(nextPassword);
    await page.getByLabel("Confirmar nueva contraseña", { exact: true }).fill("Otra clave privada");
    await expect(page.getByRole("button", { name: "Guardar nueva contraseña" })).toBeDisabled();
    await page.getByLabel("Confirmar nueva contraseña", { exact: true }).fill(nextPassword);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`vault-reset-${unlocked ? "desktop" : "mobile"}.png`), fullPage: true });
    await page.getByRole("button", { name: "Guardar nueva contraseña" }).click();
    await expect(page.getByRole("heading", { name: "Carpeta bloqueada" })).toBeVisible();
    await expect(page.getByText("Contraseña restablecida.", { exact: false })).toBeVisible();
    expect(calls.find(call => call.path === "/api/folder-vault" && call.method === "PATCH" && call.body?.action === "reset-password")?.body).toEqual({ folderId: "vault1", action: "reset-password", newPassword: nextPassword });
    await expect(page.getByLabel("Contraseña de la carpeta", { exact: true })).toHaveValue("");
    await page.getByRole("button", { name: "Administrar acceso a la carpeta" }).click();
    await expect(page.getByRole("checkbox", { name: /Ana/ })).toBeChecked();
    await page.getByLabel("Contraseña de la carpeta", { exact: true }).fill(vaultPassword);
    await page.getByRole("button", { name: "Desbloquear carpeta" }).click();
    await expect(page.getByRole("alert")).toContainText("confirma que el administrador");
    await page.getByLabel("Contraseña de la carpeta", { exact: true }).fill(nextPassword);
    await page.getByRole("button", { name: "Desbloquear carpeta" }).click();
    await page.getByRole("button", { name: "Abrir Contratos" }).click();
    await expect(page.getByText("Contrato privado.png", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("375px vault hides counts while locked and closes a nested preview when its unlock expires", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.clock.install({ time: fixedTime });
  await mockProject(page, true);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${address}/projects/vault-project/documents`);
  await expect(page.getByRole("button", { name: "Abrir Privado" })).toContainText("Protegida · bloqueada");
  await expect(page.getByRole("button", { name: "Abrir Privado" })).not.toContainText("0 archivos");
  await page.getByRole("button", { name: "Abrir Privado" }).click();
  await page.getByLabel("Contraseña de la carpeta", { exact: true }).fill(vaultPassword);
  await page.getByRole("button", { name: "Desbloquear carpeta" }).click();
  await page.getByRole("button", { name: "Abrir Contratos" }).click();
  await expect(page.getByText("Contrato privado.png", { exact: true })).toBeVisible();
  await expect(page.getByText("Usar en Cotizaciones", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Carpeta de Contrato privado.png").locator("option")).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("vault-unlocked-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Vista previa de Contrato privado.png" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.clock.fastForward(15 * 60_000);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Carpeta bloqueada" })).toBeVisible();
  await expect(page.getByText("Contrato privado.png", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Subir archivos", exact: false })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("vault-expired-mobile.png"), fullPage: true });
  expect(errors).toEqual([]);
});
