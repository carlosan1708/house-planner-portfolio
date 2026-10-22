import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";

let server: Server;
let address: string;
const projectId = "access-removal-project";
const tabs = ["overview", "activity", "budget", "quotes", "expenses", "documents", "notes", "aesthetics", "distribution", "approvals", "plan", "decisions", "site"];
const permissions = Object.fromEntries(tabs.map((key) => [key, true]));
const folderAccess = { mode: "all", folderIds: [], allowUnfiled: true };
type MockMember = { uid: string; name: string; email: string; role: string; status: string; accessState?: string; accessSource?: string; permissions: Record<string, boolean>; folderAccess: { mode: string; folderIds: string[]; allowUnfiled: boolean }; requestedAt: string | null; reviewedAt: string | null };
const members: MockMember[] = [
  { uid: "owner", name: "Administradora", email: "owner@example.test", role: "admin", status: "approved" },
  { uid: "andres", name: "Andres Rodriguez", email: "andres@example.test", role: "editor", status: "rejected" },
  { uid: "ana", name: "Ana Morales", email: "ana@example.test", role: "viewer", status: "approved", accessSource: "read_link" },
  { uid: "pending", name: "Luis Pendiente", email: "luis@example.test", role: "viewer", status: "pending" },
  { uid: "revoked", name: "Marta Revocada", email: "marta@example.test", role: "viewer", status: "pending", accessState: "revoked" },
].map((member) => ({ ...member, permissions, folderAccess, requestedAt: null, reviewedAt: null }));

test.beforeAll(async () => {
  const bundle = await build({
    stdin: { contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import HousePlanner from './app/HousePlanner';
      const user=${JSON.stringify({ ...members[0], projectId, projectName: "Casa de prueba", isPersonal: false })};
      localStorage.setItem('house-planner-language',new URL(location.href).searchParams.get('language') || 'es');
      createRoot(document.getElementById('root')).render(<HousePlanner mode="real" user={user} initialDestination={{projectId:'${projectId}',section:'access',budgetScope:null}} onSwitchMode={()=>{}} onSignOut={()=>{}}/>);
    `, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, loader: { ".webp": "dataurl" }, outfile: "access.js", platform: "browser", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "access-workspace-leaves", setup(builder) {
      builder.onResolve({ filter: /^next\/(image|dynamic)$/ }, (args) => ({ path: args.path, namespace: "access-mocks" }));
      builder.onResolve({ filter: /\/(AssistantPanel|BudgetWorkspace|ExpensesWorkspace|AestheticsWorkspace|NotesWorkspace|QuotesWorkspace|MobileCapture|DistributionAdmin|DistributionWorkspace|ActivityWorkspace|AnalyticsWorkspace|SiteFooter)$/ }, (args) => ({ path: args.path.split("/").pop()!, namespace: "access-mocks" }));
      builder.onLoad({ filter: /.*/, namespace: "access-mocks" }, (args) => ({
        contents: "import React from 'react';" + (args.path === "next/image"
          ? "export default function Image({fill,priority,...props}){return <img {...props}/>;}"
          : args.path === "next/dynamic" ? "export default ()=>function Distribution(){return null;}"
            : args.path === "ActivityWorkspace" ? "export default function Activity(){return null;} export function ActivitySummaryCard(){return null;}"
              : "export default function Leaf(){return null;}"), loader: "tsx", resolveDir: process.cwd(),
      }));
    } }],
  });
  const css = await readFile("app/globals.css", "utf8") + "\n" + (bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text || "");
  server = createServer((request, response) => {
    if (request.url === "/access.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles.find((file) => file.path.endsWith(".js"))!.text); }
    else { response.setHeader("content-type", "text/html"); response.end(`<!doctype html><html style="--font-geist-sans:Arial;--font-geist-mono:monospace"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/access.js"></script></body></html>`); }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>((done) => server.close(() => done())); });

async function mockProject(page: Page, options: { failDelete?: boolean; failRefresh?: boolean; failUpdate?: boolean; failRefreshAfterUpdate?: boolean } = {}) {
  let users = [...members];
  let deleted = false;
  let updated = false;
  let projectInvitations = [
    { id: "invite-andres", email: "andres@example.test", role: "editor", status: "accepted", invitedBy: "owner@example.test", createdAt: null, expiresAt: null, acceptedAt: null, permissions, folderAccess },
    { id: "invite-ana", email: "ana@example.test", role: "viewer", status: "pending", invitedBy: "owner@example.test", createdAt: null, expiresAt: null, acceptedAt: null, permissions, folderAccess },
    { id: "invite-sofia", email: "sofia@example.test", role: "viewer", status: "pending", invitedBy: "owner@example.test", createdAt: null, expiresAt: null, acceptedAt: null, permissions, folderAccess },
  ];
  let failDelete = options.failDelete;
  const calls: Array<{ path: string; method: string; body?: unknown }> = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body = request.postData() && request.headers()["content-type"]?.includes("application/json") ? request.postDataJSON() : undefined;
    calls.push({ path, method: request.method(), body });
    let data: unknown = {};
    switch (path) {
      case "/api/projects": data = { projects: [{ id: projectId, name: "Casa de prueba", kind: "shared", role: "admin", active: true }] }; break;
      case "/api/property-profile": data = { profile: null }; break;
      case "/api/house-distribution": data = { ready: false }; break;
      case "/api/budget": data = { sheetCount: 0, rowCount: 0 }; break;
      case "/api/files": data = { documents: [{ id: "preserved", name: "Plano conservado.pdf", contentType: "application/pdf", size: 1024, uploadedBy: deleted ? "Usuario desactivado" : "andres@example.test", folderId: null, createdAt: "2026-10-08T12:00:00Z", downloadUrl: "/mock-download" }] }; break;
      case "/api/folders": data = { folders: [{ id: "plans", name: "Planos", parentId: null, createdAt: "2026-10-08T12:00:00Z" }] }; break;
      case "/api/plan": data = { items: [] }; break;
      case "/api/countdowns": data = { countdowns: [] }; break;
      case "/api/notifications": data = { recipients: [], configured: false, emailEnabled: false, sender: "" }; break;
      case "/api/decisions": data = { decisions: [] }; break;
      case "/api/site-issues": data = { issues: [] }; break;
      case "/api/approvals": data = { approvals: [] }; break;
      case "/api/access":
        if (request.method() === "DELETE") {
          if (failDelete) { await route.fulfill({ status: 500, json: { error: "delete-failed" } }); return; }
          const email = users.find((member) => member.uid === body.uid)?.email;
          users = users.filter((member) => member.uid !== body.uid);
          projectInvitations = projectInvitations.filter((invitation) => invitation.email !== email);
          deleted = true;
          data = { ok: true };
        } else if (request.method() === "PATCH") {
          updated = true;
          if (options.failUpdate) { await route.fulfill({ status: 500, json: { error: "update-failed" } }); return; }
          users = users.map((member) => member.uid !== body.uid ? member : {
            ...member,
            ...(body.action === "permissions" ? { permissions: body.permissions } : {}),
            ...(body.action === "folders" ? { folderAccess: body.folderAccess } : {}),
            ...(body.action === "approve" ? { status: "approved", accessState: "active", role: body.role } : {}),
            ...(["approve", "permissions", "folders"].includes(body.action) ? { accessSource: "direct" } : {}),
            ...(body.action === "revoke" ? { status: "pending", accessState: "revoked" } : {}),
            ...(body.action === "reject" ? { status: "rejected", accessState: "rejected" } : {}),
          });
          if (["revoke", "reject"].includes(body.action)) {
            const email = users.find((member) => member.uid === body.uid)?.email;
            projectInvitations = projectInvitations.map((invitation) => invitation.email === email && invitation.status === "pending" ? { ...invitation, status: "revoked" } : invitation);
          }
          data = { user: users.find((member) => member.uid === body.uid) };
        } else if ((deleted && options.failRefresh) || (updated && options.failRefreshAfterUpdate)) { await route.fulfill({ status: 500, json: { error: "read-failed" } }); return; }
        else data = { users };
        break;
      case "/api/invitations":
        if (request.method() === "POST") {
          projectInvitations.push({ id: "created", ...body, status: "pending", invitedBy: "owner@example.test", createdAt: null, expiresAt: null, acceptedAt: null });
          data = { inviteUrl: `${address}/invite/new`, invitation: projectInvitations.at(-1) };
        } else if (request.method() === "PATCH") {
          projectInvitations = projectInvitations.map((invitation) => invitation.id === body.id ? { ...invitation, status: "revoked" } : invitation);
          data = { ok: true };
        } else data = { invitations: projectInvitations };
        break;
      case "/api/access-links": data = { links: [] }; break;
      case "/api/qa/reset": data = { available: false }; break;
      case "/api/events/documents": data = { version: 1 }; break;
    }
    await route.fulfill({ json: data });
  });
  return { calls, allowDelete: () => { failDelete = false; } };
}

test("delete is available for approved, pending and rejected members, with a cancellable confirmation", async ({ page }) => {
  const { calls } = await mockProject(page);
  await page.goto(`${address}/projects/${projectId}/access`);
  await expect(page.getByRole("button", { name: "Eliminar usuario Administradora", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Gestionar acceso de Ana Morales", exact: true }).click();
  await expect(page.getByRole("button", { name: "Eliminar usuario Ana Morales", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Gestionar acceso de Luis Pendiente", exact: true }).click();
  await expect(page.getByRole("button", { name: "Eliminar usuario Luis Pendiente", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Gestionar acceso de Andres Rodriguez", exact: true }).click();
  const trigger = page.getByRole("button", { name: "Eliminar usuario Andres Rodriguez", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "¿Eliminar usuario del proyecto?" });
  await expect(dialog).toContainText("Andres Rodriguez");
  await expect(dialog).toContainText("andres@example.test");
  await expect(dialog).toContainText("Sus archivos y ediciones se conservarán a nombre de “Usuario desactivado”");
  await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Eliminar usuario", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(calls.filter((call) => call.method === "DELETE")).toEqual([]);
  await page.getByRole("button", { name: "Gestionar acceso de Ana Morales", exact: true }).click();
  await expect(page.getByLabel("Rol de Ana Morales")).toHaveValue("viewer");
});

for (const language of ["es", "en"]) {
  test(`removes a rejected member and refreshes preserved records in ${language} on ${language === "es" ? "mobile" : "desktop"}`, async ({ page }, testInfo) => {
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    const { calls } = await mockProject(page);
    await page.setViewportSize(language === "es" ? { width: 375, height: 812 } : { width: 1440, height: 1000 });
    await page.goto(`${address}/projects/${projectId}/access?language=${language}`);
    await page.getByRole("button", { name: `${language === "es" ? "Gestionar acceso de" : "Manage access for"} Andres Rodriguez`, exact: true }).click();
    await page.getByRole("button", { name: `${language === "es" ? "Eliminar usuario" : "Delete user"} Andres Rodriguez`, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(language === "es" ? "perderá el acceso al proyecto" : "lose project access");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`remove-member-${language}.png`), animations: "disabled" });
    await dialog.getByRole("button", { name: language === "es" ? "Eliminar usuario" : "Delete user", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".toast")).toHaveText(language === "es" ? "Usuario eliminado del proyecto" : "User removed from project");
    await expect(page.locator(".access-user-row").filter({ hasText: "Andres Rodriguez" })).toHaveCount(0);
    await expect(page.locator(".invite-row").filter({ hasText: "andres@example.test" })).toHaveCount(0);
    expect(calls.find((call) => call.method === "DELETE")).toEqual({ path: "/api/access", method: "DELETE", body: { uid: "andres" } });
    for (const path of ["/api/access", "/api/invitations", "/api/files", "/api/plan", "/api/approvals", "/api/notifications"]) {
      expect(calls.filter((call) => call.path === path && call.method === "GET").length, path).toBeGreaterThanOrEqual(2);
    }
    // The same workspace state now contains the preserved document under its
    // updated attribution, without a page reload.
    await page.locator("nav").getByRole("button", { name: language === "es" ? "Documentos" : "Documents", exact: false }).click();
    await page.getByRole("button", { name: language === "es" ? "Documentos sin carpeta" : "Unfiled documents", exact: true }).click();
    await expect(page.getByText("Plano conservado.pdf", { exact: true })).toBeVisible();
    // Mobile document rows omit the uploader column, but keep the same updated
    // record in the DOM used by the desktop layout.
    await expect(page.getByText("Usuario desactivado", { exact: false })).toHaveCount(1);
    if (language === "en") await expect(page.getByText("Usuario desactivado", { exact: false })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("keeps the member and confirmation after a failed deletion, then allows a retry", async ({ page }) => {
  const { calls, allowDelete } = await mockProject(page, { failDelete: true });
  await page.goto(`${address}/projects/${projectId}/access`);
  await page.getByRole("button", { name: "Gestionar acceso de Andres Rodriguez", exact: true }).click();
  await page.getByRole("button", { name: "Eliminar usuario Andres Rodriguez", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Eliminar usuario", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("No se pudo eliminar el usuario. Inténtalo de nuevo.");
  await expect(page.locator(".access-user-row").filter({ hasText: "Andres Rodriguez" })).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeEnabled();
  allowDelete();
  await dialog.getByRole("button", { name: "Eliminar usuario", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(2);
});

test("reports successful deletion even when the following access-list refresh fails", async ({ page }) => {
  await mockProject(page, { failRefresh: true });
  await page.goto(`${address}/projects/${projectId}/access`);
  await page.getByRole("button", { name: "Gestionar acceso de Andres Rodriguez", exact: true }).click();
  await page.getByRole("button", { name: "Eliminar usuario Andres Rodriguez", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Eliminar usuario", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".toast")).toHaveText("Usuario eliminado del proyecto");
  await expect(page.locator(".access-user-row").filter({ hasText: "Andres Rodriguez" })).toHaveCount(0);
});

for (const language of ["es", "en"]) {
  test(`compact directory, search and access filters in ${language}`, async ({ page }, testInfo) => {
    const { calls } = await mockProject(page);
    const spanish = language === "es";
    await page.setViewportSize(spanish ? { width: 375, height: 812 } : { width: 1440, height: 1000 });
    await page.goto(`${address}/projects/${projectId}/access?language=${language}`);
    await expect(page.getByRole("heading", { name: spanish ? "Usuarios y acceso" : "Users and access" })).toBeVisible();
    await expect(page.locator(".access-user-row")).toHaveCount(5);
    await expect(page.locator(".access-management").getByText("Administradora", { exact: true })).toHaveCount(1);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(page.locator(".access-view-nav").getByRole("button", { name: spanish ? "Usuarios 5" : "Users 5" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".access-view-nav").getByRole("button", { name: spanish ? "Invitaciones 1" : "Invitations 1" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`access-directory-${language}.png`), animations: "disabled", fullPage: true, style: spanish ? ".sidebar { visibility: hidden !important; }" : undefined });
    const filters = page.getByRole("group", { name: spanish ? "Filtrar usuarios por acceso" : "Filter users by access" });
    await filters.getByRole("button", { name: spanish ? "Activos 2" : "Active 2", exact: true }).click();
    await expect(page.locator(".access-user-row")).toHaveCount(2);
    await filters.getByRole("button", { name: spanish ? "Pendientes 1" : "Pending 1", exact: true }).click();
    await expect(page.locator(".access-user-row")).toHaveCount(1);
    await expect(page.locator(".access-user-row")).toContainText("Luis Pendiente");
    await filters.getByRole("button", { name: spanish ? "Sin acceso 2" : "No access 2", exact: true }).click();
    await expect(page.locator(".access-user-row")).toHaveCount(2);
    await expect(page.locator(".access-user-row").filter({ hasText: "Marta Revocada" })).toContainText(spanish ? "Acceso revocado" : "Access revoked");
    await filters.getByRole("button", { name: spanish ? "Todos 5" : "All 5", exact: true }).click();
    const search = page.getByRole("searchbox", { name: spanish ? "Buscar usuario" : "Find a user" });
    await search.fill("ANA@EXAMPLE");
    await expect(page.locator(".access-user-row")).toHaveCount(1);
    await expect(page.locator(".access-user-row")).toContainText("Ana Morales");
    await search.fill("no-match");
    await expect(page.getByRole("heading", { name: spanish ? "No hay usuarios que coincidan" : "No users match" })).toBeVisible();
    await page.locator(".access-view-nav").getByRole("button", { name: spanish ? "Invitaciones 1" : "Invitations 1", exact: true }).click();
    await expect(page.locator(".access-invitation-list").getByText("sofia@example.test", { exact: true })).toBeVisible();
    await expect(page.getByText("ana@example.test", { exact: true })).not.toBeVisible();
    await page.locator(".access-invitation-history > summary").click();
    const anaInvitation = page.locator(".access-invitation-history .invite-row").filter({ hasText: "ana@example.test" });
    await expect(anaInvitation).toContainText(spanish ? "Acceso concedido" : "Access granted");
    await anaInvitation.getByRole("button", { name: spanish ? "Gestionar usuario" : "Manage user" }).click();
    await expect(page.getByRole("button", { name: spanish ? "Gestionar acceso de Ana Morales" : "Manage access for Ana Morales", exact: true })).toHaveAttribute("aria-expanded", "true");
    await page.locator(".access-user-row").filter({ hasText: "Ana Morales" }).screenshot({ path: testInfo.outputPath(`access-manage-${language}.png`), animations: "disabled", style: ".topbar, .sidebar { visibility: hidden !important; }" });
    await page.locator(".access-view-nav").getByRole("button", { name: spanish ? "Enlaces de lectura" : "Read links", exact: true }).click();
    await expect(page.getByRole("button", { name: spanish ? "Nuevo enlace de lectura" : "New read link", exact: true })).toBeVisible();
    expect(calls.filter((call) => call.method !== "GET" && ["/api/access", "/api/invitations", "/api/access-links"].includes(call.path))).toEqual([]);
    await page.locator(".access-view-nav").getByRole("button", { name: spanish ? "Invitaciones 1" : "Invitations 1", exact: true }).click();
    await page.locator(".access-invite-permissions > summary").click();
    await page.screenshot({ path: testInfo.outputPath(`access-invitations-${language}.png`), animations: "disabled", fullPage: true, style: spanish ? ".sidebar { visibility: hidden !important; }" : undefined });
  });
}

test("opens one user's settings and saves permissions, folders and role", async ({ page }, testInfo) => {
  const { calls } = await mockProject(page);
  await page.goto(`${address}/projects/${projectId}/access`);
  const anaButton = page.getByRole("button", { name: "Gestionar acceso de Ana Morales", exact: true });
  await anaButton.click();
  await expect(anaButton).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".member-access-settings")).toHaveCount(1);
  await expect(page.getByText("Cambiar el rol o los permisos de esta persona le asigna acceso directo; después no dependerá del enlace de lectura.")).toBeVisible();
  await page.locator(".access-user-row").filter({ hasText: "Ana Morales" }).screenshot({ path: testInfo.outputPath("access-manage-desktop.png"), animations: "disabled", style: ".topbar, .sidebar { visibility: hidden !important; }" });
  await page.getByRole("checkbox", { name: "Mostrar Notas a Ana Morales", exact: true }).uncheck();
  await expect(page.locator(".toast")).toHaveText("Permisos de secciones guardados");
  expect(calls.find((call) => (call.body as { action?: string })?.action === "permissions")).toMatchObject({ path: "/api/access", method: "PATCH", body: { uid: "ana", action: "permissions", permissions: { notes: false } } });
  await page.getByRole("checkbox", { name: "Permitir todas las carpetas", exact: true }).uncheck();
  await expect(page.locator(".toast")).toHaveText("Acceso a carpetas guardado");
  await page.getByRole("checkbox", { name: "Planos", exact: true }).check();
  await expect(page.locator(".toast")).toHaveText("Acceso a carpetas guardado");
  await expect(page.getByRole("checkbox", { name: "Planos", exact: true })).toBeChecked();
  await page.getByLabel("Rol de Ana Morales").selectOption("editor");
  await expect(page.locator(".toast")).toHaveText("Acceso actualizado");
  await expect(page.getByLabel("Rol de Ana Morales")).toHaveValue("editor");
  await page.getByRole("button", { name: "Gestionar acceso de Luis Pendiente", exact: true }).click();
  await expect(anaButton).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".member-access-settings")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Aprobar acceso", exact: true })).toBeVisible();
});

test("restores revoked access with an explicitly selected role and keeps real requests pending", async ({ page }) => {
  const { calls } = await mockProject(page);
  await page.goto(`${address}/projects/${projectId}/access`);
  await page.getByRole("button", { name: "Gestionar acceso de Marta Revocada", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Mostrar Documentos a Marta Revocada", exact: true })).toBeDisabled();
  await page.getByLabel("Rol de Marta Revocada").selectOption("editor");
  expect(calls.filter((call) => call.method !== "GET" && ["/api/access", "/api/invitations", "/api/access-links"].includes(call.path))).toEqual([]);
  await page.getByRole("button", { name: "Restablecer acceso", exact: true }).click();
  await expect(page.locator(".toast")).toHaveText("Acceso actualizado");
  expect(calls.find((call) => call.method === "PATCH" && call.path === "/api/access")).toEqual({ path: "/api/access", method: "PATCH", body: { uid: "revoked", action: "approve", role: "editor" } });
  await expect(page.getByRole("checkbox", { name: "Mostrar Documentos a Marta Revocada", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Revocar acceso", exact: true }).click();
  await expect(page.locator(".toast")).toHaveText("Acceso actualizado");
  await expect(page.locator(".access-user-row").filter({ hasText: "Marta Revocada" })).toContainText("Acceso revocado");
  await expect(page.getByRole("button", { name: "Restablecer acceso", exact: true })).toBeVisible();
  await expect(page.locator(".access-filters").getByRole("button", { name: "Pendientes 1", exact: true })).toBeVisible();
});

test("invitation form validates email and hides permission customization until requested", async ({ page }) => {
  const { calls } = await mockProject(page);
  await page.goto(`${address}/projects/${projectId}/access`);
  await page.getByRole("button", { name: "Invitar persona", exact: true }).click();
  const create = page.getByRole("button", { name: "Crear invitación", exact: true });
  await expect(create).toBeDisabled();
  await page.getByLabel("Correo de la cuenta", { exact: true }).fill("correo-invalido");
  await page.getByLabel("Correo de la cuenta", { exact: true }).press("Enter");
  await expect(create).toBeDisabled();
  expect(calls.filter((call) => call.method !== "GET" && ["/api/access", "/api/invitations", "/api/access-links"].includes(call.path))).toEqual([]);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.locator(".access-invite-permissions > summary").click();
  await page.getByRole("checkbox", { name: "Documentos", exact: true }).uncheck();
  await expect(page.getByRole("checkbox", { name: "Permitir todas las carpetas", exact: true })).toBeDisabled();
  await page.getByLabel("Correo de la cuenta", { exact: true }).fill("new@example.test");
  await create.click();
  await expect(page.getByRole("textbox", { name: "Enlace de invitación", exact: true })).toHaveValue(`${address}/invite/new`);
  expect(calls.find((call) => call.method === "POST" && call.path === "/api/invitations")).toMatchObject({ path: "/api/invitations", body: { email: "new@example.test", role: "viewer", permissions: { documents: false }, folderAccess: { mode: "all" } } });
  await page.locator(".access-view-nav").getByRole("button", { name: "Usuarios 5", exact: true }).click();
  await page.locator(".access-view-nav").getByRole("button", { name: "Invitaciones 2", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Enlace de invitación", exact: true })).toHaveValue(`${address}/invite/new`);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("clipboard-unavailable"); } } });
    document.execCommand = () => false;
  });
  await page.locator(".invite-link").getByRole("button", { name: "Copiar enlace", exact: true }).click();
  await expect(page.locator(".invite-link").getByRole("status")).toHaveText("Selecciona y copia el enlace de arriba.");
  await expect(page.getByRole("textbox", { name: "Enlace de invitación", exact: true })).toBeFocused();
});

test("revoking a user cancels pending invitations and clears the ready invitation link", async ({ page }) => {
  const { calls } = await mockProject(page);
  await page.goto(`${address}/projects/${projectId}/access`);
  await page.getByRole("button", { name: "Invitar persona", exact: true }).click();
  await page.getByLabel("Correo de la cuenta", { exact: true }).fill("ana@example.test");
  await page.getByRole("button", { name: "Crear invitación", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Enlace de invitación", exact: true })).toBeVisible();
  await page.locator(".access-view-nav").getByRole("button", { name: "Usuarios 5", exact: true }).click();
  await page.getByRole("button", { name: "Gestionar acceso de Ana Morales", exact: true }).click();
  await page.getByRole("button", { name: "Revocar acceso", exact: true }).click();
  await expect(page.locator(".toast")).toHaveText("Acceso actualizado");
  await expect(page.locator(".access-user-row").filter({ hasText: "Ana Morales" })).toContainText("Acceso revocado");
  expect(calls.find((call) => (call.body as { action?: string })?.action === "revoke")).toMatchObject({ path: "/api/access", method: "PATCH", body: { uid: "ana", action: "revoke", role: "viewer" } });
  await page.locator(".access-view-nav").getByRole("button", { name: "Invitaciones 1", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Enlace de invitación", exact: true })).toHaveCount(0);
  await page.locator(".access-invitation-history > summary").click();
  const anaInvitations = page.locator(".access-invitation-history .invite-row").filter({ hasText: "ana@example.test" });
  await expect(anaInvitations).toHaveCount(2);
  await expect(anaInvitations.nth(0)).toContainText("Revocada");
  await expect(anaInvitations.nth(1)).toContainText("Revocada");
  expect(calls.filter((call) => call.method === "GET" && call.path === "/api/invitations").length).toBeGreaterThanOrEqual(3);
});

test("revoking an old invitation preserves the ready link and revoking the new invitation clears it", async ({ page }) => {
  await mockProject(page);
  await page.goto(`${address}/projects/${projectId}/access`);
  await page.getByRole("button", { name: "Invitar persona", exact: true }).click();
  await page.getByLabel("Correo de la cuenta", { exact: true }).fill("new@example.test");
  await page.getByRole("button", { name: "Crear invitación", exact: true }).click();
  const readyLink = page.getByRole("textbox", { name: "Enlace de invitación", exact: true });
  await expect(readyLink).toHaveValue(`${address}/invite/new`);
  await page.locator(".access-invitation-list .invite-row").filter({ hasText: "sofia@example.test" }).getByRole("button", { name: "Revocar invitación", exact: true }).click();
  await expect(page.locator(".toast")).toHaveText("Invitación revocada");
  await expect(readyLink).toHaveValue(`${address}/invite/new`);
  await page.locator(".access-invitation-list .invite-row").filter({ hasText: "new@example.test" }).getByRole("button", { name: "Revocar invitación", exact: true }).click();
  await expect(page.locator(".toast")).toHaveText("Invitación revocada");
  await expect(readyLink).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Invitaciones 0", exact: true })).toBeVisible();
});

test("read-link draft survives switching views without writes", async ({ page }) => {
  const { calls } = await mockProject(page);
  await page.goto(`${address}/projects/${projectId}/access`);
  await page.locator(".access-view-nav").getByRole("button", { name: "Enlaces de lectura", exact: true }).click();
  await page.getByRole("button", { name: "Nuevo enlace de lectura", exact: true }).click();
  await page.getByRole("textbox", { name: "Nombre del enlace", exact: true }).fill("Visita arquitecto");
  await page.locator(".access-view-nav").getByRole("button", { name: "Usuarios 5", exact: true }).click();
  await page.locator(".access-view-nav").getByRole("button", { name: "Enlaces de lectura", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Nombre del enlace", exact: true })).toHaveValue("Visita arquitecto");
  expect(calls.filter((call) => call.method !== "GET" && ["/api/access", "/api/invitations", "/api/access-links"].includes(call.path))).toEqual([]);
});

test("rolls back permissions and folders when both saving and refreshing fail", async ({ page }) => {
  await mockProject(page, { failUpdate: true, failRefreshAfterUpdate: true });
  await page.goto(`${address}/projects/${projectId}/access`);
  await page.getByRole("button", { name: "Gestionar acceso de Ana Morales", exact: true }).click();
  const notes = page.getByRole("checkbox", { name: "Mostrar Notas a Ana Morales", exact: true });
  await notes.click();
  await expect(page.locator(".toast")).toHaveText("No se pudieron guardar los permisos");
  await expect(notes).toBeChecked();
  const allFolders = page.getByRole("checkbox", { name: "Permitir todas las carpetas", exact: true });
  await allFolders.click();
  await expect(page.locator(".toast")).toHaveText("No se pudo guardar el acceso a carpetas");
  await expect(allFolders).toBeChecked();
});

test("keeps successful revocation visible when the following access refresh fails", async ({ page }) => {
  await mockProject(page, { failRefreshAfterUpdate: true });
  await page.goto(`${address}/projects/${projectId}/access`);
  await page.getByRole("button", { name: "Gestionar acceso de Ana Morales", exact: true }).click();
  await page.getByRole("button", { name: "Revocar acceso", exact: true }).click();
  await expect(page.locator(".toast")).toHaveText("Acceso actualizado");
  await expect(page.locator(".access-user-row").filter({ hasText: "Ana Morales" })).toContainText("Acceso revocado");
  await expect(page.getByRole("button", { name: "Restablecer acceso", exact: true })).toBeVisible();
  await expect(page.getByLabel("Rol de Ana Morales")).toHaveValue("viewer");
});
