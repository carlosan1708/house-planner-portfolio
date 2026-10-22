import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type APIResponse, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { expectDistributionExportImages } from "./distribution-export-assertions";
import { createQaFixtures, type QaFixture } from "./qa/fixtures";
import { verifyEncryptedDocumentFolders } from "./qa/vault-flow";
import { qaShouldResetAfterRun } from "@/lib/qa-run-policy";
import { attachQaSignInDiagnostics, openQaCredentials, readQaIdentity } from "./qa/auth-flow";

const suite = process.env.QA_REGRESSION_SUITE === "documents" ? "documents" : process.env.QA_REGRESSION_SUITE === "aesthetics" ? "aesthetics" : process.env.QA_REGRESSION_SUITE === "cleanup" ? "cleanup" : process.env.QA_REGRESSION_SUITE === "expenses" ? "expenses" : process.env.QA_REGRESSION_SUITE === "distribution" ? "distribution" : process.env.QA_REGRESSION_SUITE === "notes" ? "notes" : process.env.QA_REGRESSION_SUITE === "smoke" ? "smoke" : "full";
// Basic QA makes one quote-analysis request and one quote-chat request.
// The QA adapter disables automatic retries and counts failed attempts.
const cappedAiSmoke = process.env.QA_AI_MODE !== "extended";
const aiEnabled = process.env.QA_AI_MODE !== "disabled";
const liveGoogleEnabled = process.env.QA_LIVE_GOOGLE_ENABLED === "1";
const projectId = process.env.QA_PROJECT_ID || "qa-primary";
const ownerEmail = (process.env.QA_OWNER_EMAIL || "").toLowerCase();
const ownerPassword = process.env.QA_OWNER_PASSWORD || "";
const companionEmail = (process.env.QA_COMPANION_EMAIL || "").toLowerCase();
const companionPassword = process.env.QA_COMPANION_PASSWORD || "";
const expectedOwnerEmail = "qa.houseplanner.20260830@example.com";
const expectedCompanionEmail = "qa.houseplanner.viewer.20260831@example.com";
const leaseRunId = process.env.QA_RUN_ID || `qa-${Date.now()}`;
const runId = `${leaseRunId}-${suite}`;
const artifactDirectory = join(process.cwd(), "test-results", runId);

type QaUser = { name: string; email: string; projectId: string; projectName: string; isPersonal: boolean; role: "admin" | "editor" | "viewer"; status: "pending" | "approved" | "rejected"; readOnlyLink?: boolean; anonymousLink?: boolean };
type Json = Record<string, unknown>;

async function json<T = Json>(response: APIResponse, expected = [200]) {
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  expect(expected, `${response.url()}: ${body.error || response.statusText()}`).toContain(response.status());
  return body;
}

function localInitialUrl(value: string) {
  const baseUrl = process.env.QA_BASE_URL?.trim();
  if (!baseUrl) throw new Error("QA_BASE_URL is required for authenticated regression sign-in");
  const parsed = new URL(value, baseUrl);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

async function dragAestheticCardToTray(page: Page, card: Locator, folderName: RegExp) {
  const handle = card.locator(".aesthetic-card-drag-handle");
  await handle.scrollIntoViewIfNeeded();
  await expect(handle).toHaveAttribute("draggable", "true");
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await handle.dispatchEvent("dragstart", { dataTransfer: transfer });
  const destination = page.locator(".aesthetic-drag-tray").getByRole("button", { name: folderName });
  await expect(destination).toBeVisible();
  await destination.dispatchEvent("dragover", { dataTransfer: transfer });
  await destination.dispatchEvent("drop", { dataTransfer: transfer });
  await handle.dispatchEvent("dragend", { dataTransfer: transfer });
}

async function expectPlanPdfFillsPreview(preview: Locator, compact: boolean) {
  await expect.poll(async () => preview.evaluate((element, isCompact) => {
    const frame = element.querySelector("iframe")!.getBoundingClientRect();
    const container = element.getBoundingClientRect();
    const toolbar = element.querySelector(".aesthetic-pdf-controls")!.getBoundingClientRect();
    const availableHeight = container.height - (isCompact ? 0 : toolbar.height);
    return { widthFits: Math.abs(container.width - frame.width) < 2, heightFits: Math.abs(availableHeight - frame.height) < 2, bottomFits: Math.abs(container.bottom - frame.bottom) < 2, tallEnough: frame.height > 200 };
  }, compact)).toEqual({ widthFits: true, heightFits: true, bottomFits: true, tallEnough: true });
}

async function signIn(browser: Browser, email: string, password: string, initialUrl = `/?project=${encodeURIComponent(projectId)}`) {
  const authenticationContext = await browser.newContext();
  const authenticationPage = await authenticationContext.newPage();
  let context: BrowserContext | null = null;
  let diagnosticPage = authenticationPage;
  let phase = "navigation";
  try {
    // Keep invitation token/path on the explicitly verified isolated QA origin.
    await authenticationPage.goto(localInitialUrl(initialUrl), { waitUntil: "domcontentloaded" });
    phase = "credentials";
    const emailInput = await openQaCredentials(authenticationPage);
    const signInButton = authenticationPage.getByRole("button", { name: /^(Sign in|Iniciar sesión)$/i });
    await expect(authenticationPage.locator("form.auth-form")).toHaveAttribute("method", "post");
    await expect(signInButton).toBeEnabled();
    await emailInput.fill(email);
    await authenticationPage.locator('input[name="password"]').fill(password);
    phase = "session";
    await signInButton.click();
    await expect.poll(async () => (await readQaIdentity(authenticationPage)).status(), { timeout: 60_000 }).toBe(200);
    const acceptingReadLink = new URL(initialUrl, process.env.QA_BASE_URL).searchParams.has("accessLink");
    if (acceptingReadLink) {
      phase = "account-link-redemption";
      await expect.poll(() => new URL(authenticationPage.url()).searchParams.has("accessLink"), { timeout: 30_000 }).toBe(false);
      expect((await guard(authenticationPage, email, "viewer")).anonymousLink).toBe(false);
      expect(new URL(authenticationPage.url()).pathname).toBe(new URL(initialUrl, process.env.QA_BASE_URL).pathname);
    }
    const initialWorkspaceUrl = acceptingReadLink ? localInitialUrl(authenticationPage.url()) : `/?project=${encodeURIComponent(projectId)}`;
    const storageState = await authenticationContext.storageState({ indexedDB: true });
    await authenticationContext.close();
    phase = "workspace-session";
    context = await browser.newContext({ storageState, recordVideo: { dir: artifactDirectory, size: { width: 1280, height: 900 } } });
    const page = await context.newPage();
    diagnosticPage = page;
    await page.goto(initialWorkspaceUrl, { waitUntil: "domcontentloaded" });
    await expect.poll(async () => (await readQaIdentity(page)).status(), { timeout: 30_000 }).toBe(200);
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    return { context, page };
  } catch (error) {
    await attachQaSignInDiagnostics(diagnosticPage, email, phase).catch(() => undefined);
    await context?.close().catch(() => undefined);
    throw error;
  } finally {
    await authenticationContext.close().catch(() => undefined);
  }
}

async function guard(page: Page, email: string, role?: QaUser["role"]) {
  const response = await readQaIdentity(page);
  const body = await json<{ user?: QaUser }>(response);
  expect(body.user?.email.toLowerCase()).toBe(email);
  expect(body.user?.projectId).toBe(projectId);
  expect(body.user?.isPersonal).toBe(false);
  expect(body.user?.status).toBe("approved");
  if (role) expect(body.user?.role).toBe(role);
  return body.user!;
}

async function guarded<T>(page: Page, email: string, mutation: () => Promise<T>) {
  await guard(page, email);
  return mutation();
}

async function resetQa(page: Page) {
  await guard(page, ownerEmail, "admin");
  const preview = await json<{ projectId: string; confirmation: string }>(await page.request.get("/api/qa/reset?preview=1"));
  expect(preview.projectId).toBe(projectId);
  return json(await guarded(page, ownerEmail, () => page.request.post("/api/qa/reset", {
    data: { confirmation: preview.confirmation, confirmPermanentDeletion: true },
  })));
}

async function mutateJson<T = Json>(page: Page, method: "post" | "patch" | "delete", path: string, data?: Json, expected = [200]) {
  const response = await guarded(page, ownerEmail, () => page.request[method](path, { data, failOnStatusCode: false }));
  return json<T>(response, expected);
}

async function upload(page: Page, fixture: QaFixture, folderId = "") {
  const response = await guarded(page, ownerEmail, () => page.request.post("/api/files", {
    multipart: { file: { name: fixture.name, mimeType: fixture.mimeType, buffer: fixture.buffer }, folderId },
    failOnStatusCode: false,
  }));
  return json<{ id: string; aiIndexStatus?: string }>(response, [201]);
}

async function uploadInvoice(page: Page, fixture: QaFixture) {
  const response = await guarded(page, ownerEmail, () => page.request.post("/api/expenses/files", {
    multipart: { file: { name: fixture.name, mimeType: fixture.mimeType, buffer: fixture.buffer } },
    failOnStatusCode: false,
  }));
  return json<{ document: { id: string; folderId: string | null } }>(response, [201]);
}

function sseEvents(text: string) {
  return text.split(/\n\n+/).flatMap((block) => {
    const event = block.match(/^event:\s*(.+)$/m)?.[1];
    const value = block.match(/^data:\s*(.+)$/m)?.[1];
    if (!event || !value) return [];
    try { return [{ event, data: JSON.parse(value) as Json }]; } catch { return []; }
  });
}

async function assistantTurn(page: Page, message: string, language: "es" | "en") {
  const response = await guarded(page, ownerEmail, () => page.request.post("/api/assistant/chat", { data: { message, language }, failOnStatusCode: false, timeout: 120_000 }));
  expect(response.status()).toBe(200);
  const events = sseEvents(await response.text());
  if (events.some((item) => item.event === "done") && !events.some((item) => item.event === "error")) return events;
  throw new Error(`Gemini did not complete: ${JSON.stringify(events.filter((item) => item.event === "error"))}`);
}

async function waitForDocumentIndex(page: Page, id: string) {
  await expect.poll(async () => {
    const response = await guarded(page, ownerEmail, () => page.request.post("/api/assistant/documents", { data: { id, action: "status" }, failOnStatusCode: false }));
    const body = await response.json().catch(() => ({})) as { status?: string };
    return body.status;
  }, { timeout: 90_000, intervals: [1_000, 2_000, 3_000] }).toBe("ready");
}

function changeWorkbookCell(workbook: Json, row: number, column: number, value: string | number) {
  const sheetOrder = workbook.sheetOrder as string[];
  const sheets = workbook.sheets as Record<string, Json>;
  const sheetId = sheetOrder.find((id) => sheets[id]?.name === "Presupuesto");
  if (!sheetId) throw new Error("QA workbook is missing Presupuesto");
  const sheet = sheets[sheetId];
  const cellData = sheet.cellData as Record<string, Record<string, Json>>;
  cellData[String(row)] ||= {};
  cellData[String(row)][String(column)] = { ...(cellData[String(row)][String(column)] || {}), v: value };
}

async function createAndSaveDraft(page: Page, email: string, row: number, column: number, value: number) {
  await guard(page, email);
  const created = await json<{ id: string; revision: number; workbook: Json }>(await page.request.post("/api/workbook/drafts", { data: { action: "create" }, failOnStatusCode: false }), [201]);
  changeWorkbookCell(created.workbook, row, column, value);
  await guard(page, email);
  const saved = await json<{ revision: number }>(await page.request.post("/api/workbook/drafts", { data: { action: "save", id: created.id, revision: created.revision, workbook: created.workbook }, failOnStatusCode: false }));
  return { id: created.id, revision: saved.revision, workbook: created.workbook };
}

async function openSection(page: Page, english: string, spanish: string) {
  const label = new RegExp(`^(${english}|${spanish})$`);
  const buttonName = new RegExp(`${english}|${spanish}`);
  if (label.test((await page.locator(".topbar h1").textContent())?.trim() || "")) return;
  const mobileNavigation = page.locator(".mobile-workspace-nav");
  if (await mobileNavigation.isVisible()) {
    const shortcut = mobileNavigation.getByRole("button", { name: buttonName });
    if (await shortcut.isVisible()) await shortcut.click();
    else {
      await mobileNavigation.getByRole("button", { name: /^(Sections|Secciones)$/ }).click();
      await page.locator(".mobile-sections-grid").getByRole("button", { name: buttonName }).click();
    }
  } else {
    await page.locator("aside nav button").filter({ hasText: buttonName }).click();
  }
  await expect(page.locator(".topbar h1")).toHaveText(label);
}

async function waitForProjectReady(page: Page) {
  const loading = page.getByRole("heading", { name: /Loading project|Cargando proyecto/ });
  const retry = page.getByRole("button", { name: /Try again|Intentar de nuevo/ });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await expect(loading).toBeHidden({ timeout: 130_000 });
    if (!(await retry.isVisible())) return;
    if (attempt === 1) break;
    await retry.click();
  }
  throw new Error("The project did not finish loading after one bounded retry");
}

async function verifyNavigation(page: Page) {
  const sections = [
    ["overview", "Overview", "Resumen"], ["activity", "Activity", "Actividad"], ["budget", "Budget", "Presupuesto"], ["quotes", "Quotes", "Cotizaciones"], ["expenses", "Purchases/Expenses", "Compras/Gastos"],
    ["documents", "Documents", "Documentos"], ["notes", "Notes", "Notas"], ["aesthetics", "Aesthetics", "Estética"], ["approvals", "Approvals", "Aprobaciones"], ["plan", "Plan & schedule", "Plan y cronograma"],
    ["decisions", "Decisions", "Decisiones"], ["site", "Site progress", "Progreso de obra"], ["access", "Access", "Acceso"],
  ];
  for (const [section, english, spanish] of sections) {
    await openSection(page, english, spanish);
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/projects/${encodeURIComponent(projectId)}/${section}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  await page.setViewportSize({ width: 1280, height: 900 });
}

async function openBudgetDashboard(page: Page) {
  await openSection(page, "Budget", "Presupuesto");
  if (new URL(page.url()).pathname.includes("/budget/")) await expect(page.locator(".budget-table-editor")).toBeVisible();
  if (await page.locator(".budget-table-editor").isVisible()) {
    await page.locator(".budget-editor-page").getByRole("button", { name: /^(← )?(Dashboard|Panel)$/ }).click();
  }
  await expect(page.locator(".budget-line-list")).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/projects/${encodeURIComponent(projectId)}/budget`);
}

async function verifyShareableBudgetRoutes(page: Page) {
  await guard(page, ownerEmail, "admin");
  const prefix = `/projects/${encodeURIComponent(projectId)}`;
  const amount = page.getByRole("spinbutton", { name: /QA Completed concrete (Objective|Objetivo)/ });
  for (const [key, label] of [["chapter", "QA Structure"], ["type", "Work"], ["subcategory", "Foundation"]]) {
    const path = `${prefix}/budget/${key}/${encodeURIComponent(label)}`;
    const created = page.waitForResponse(response => response.url().endsWith("/api/workbook/drafts") && response.request().method() === "POST" && response.request().postDataJSON()?.action === "create");
    await page.goto(path, { waitUntil: "domcontentloaded" });
    const first = await created;
    expect(first.status()).toBe(201);
    const firstDraft = await first.json() as { id: string };
    await waitForProjectReady(page);
    await expect(amount).toHaveValue("1000");
    await expect(amount).toBeEnabled();
    expect(new URL(page.url()).pathname).toBe(path);
    expect(page.url()).not.toContain(firstDraft.id);

    // Opening a shared URL always starts from the official workbook, rather than
    // reopening any user's existing private draft.
    const reopened = page.waitForResponse(response => response.url().endsWith("/api/workbook/drafts") && response.request().method() === "POST" && response.request().postDataJSON()?.action === "create");
    await page.reload();
    const next = await reopened;
    expect(next.status()).toBe(201);
    expect((await next.json() as { id: string }).id).not.toBe(firstDraft.id);
    await expect(amount).toHaveValue("1000");
    expect(new URL(page.url()).pathname).toBe(path);
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("QA manual copy fallback"); } } }));
    await page.locator(".budget-editor-page").getByRole("button", { name: /^(Copy link|Copiar enlace)$/ }).click();
    const fallback = page.locator(".budget-editor-page").getByRole("dialog", { name: /Copy link manually|Copiar enlace manualmente/ });
    await expect(fallback.getByRole("textbox", { name: /Share address|Dirección para compartir/ })).toHaveValue(new URL(path, page.url()).href);
    await fallback.getByRole("button", { name: /^(Close|Cerrar)$/ }).click();
  }

  await page.goto(`${prefix}/budget/chapter`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("spinbutton", { name: /QA Pending plants (Objective|Objetivo)/ })).toHaveValue("600");
  await openBudgetDashboard(page);
  await page.locator(".budget-line-list button").filter({ hasText: "QA Completed concrete" }).click();
  await expect(amount).toHaveValue("1000");
  await expect.poll(() => new URL(page.url()).pathname).toBe(`${prefix}/budget/chapter/QA%20Structure`);
  await openBudgetDashboard(page);
  await page.goBack();
  await expect(amount).toHaveValue("1000");
  await expect.poll(() => new URL(page.url()).pathname).toBe(`${prefix}/budget/chapter/QA%20Structure`);
  await openBudgetDashboard(page);
  await openSection(page, "Documents", "Documentos");
  await page.goBack();
  await expect(page.locator(".budget-line-list")).toBeVisible();
  await page.goForward();
  await expect(page.locator(".topbar h1")).toHaveText(/^(Documents|Documentos)$/);

  await page.goto(`/?project=${encodeURIComponent(projectId)}&section=documents&google=connected`, { waitUntil: "domcontentloaded" });
  await expect.poll(() => new URL(page.url()).pathname).toBe(`${prefix}/documents`);
  expect(new URL(page.url()).searchParams.get("google")).toBe("connected");
  expect(new URL(page.url()).searchParams.has("project")).toBe(false);
  expect(new URL(page.url()).searchParams.has("section")).toBe(false);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { Object.assign(window, { qaCopiedWorkspaceLink: value }); } } }));
  await page.locator(".topbar").getByRole("button", { name: /^(Copy link|Copiar enlace)$/ }).click();
  await expect(page.locator(".topbar").getByRole("button", { name: /^(Link copied|Enlace copiado)$/ })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { qaCopiedWorkspaceLink: string }).qaCopiedWorkspaceLink)).toBe(new URL(`${prefix}/documents`, page.url()).href);
  await page.goto(`${prefix}/budget/chapter/QA-missing-category`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/category.*QA-missing-category.*no longer exists|categoría.*QA-missing-category.*ya no existe/).first()).toBeVisible();
  await expect(page.locator(".budget-table-editor")).toHaveCount(0);
  expect((await page.request.get(`${prefix}/budget/unknown-category-key`)).status()).toBe(404);
  await page.goto(`${prefix}/budget`, { waitUntil: "domcontentloaded" });
  await waitForProjectReady(page);
  await openBudgetDashboard(page);
}

async function verifyReadAccessLink(browser: Browser, owner: Page) {
  await guard(owner, ownerEmail, "admin");
  const panel = owner.locator(".read-access-links");
  const showReadLinks = async () => {
    await openSection(owner, "Access", "Acceso");
    await owner.locator(".access-view-nav").getByRole("button", { name: /Read links|Enlaces de lectura/ }).click();
    await expect(panel).toBeVisible();
  };
  await showReadLinks();
  await panel.getByRole("button", { name: /^(New read link|Nuevo enlace de lectura)$/ }).click();
  await panel.getByLabel(/Who can access|Quién puede acceder/).selectOption("account");
  const name = `${runId} read link`;
  await panel.getByLabel(/Link name|Nombre del enlace/).fill(name);
  await panel.locator(".read-link-customize > summary").click();
  for (const checkbox of await panel.locator("fieldset.invite-permissions input").all()) await checkbox.setChecked(false);
  await panel.getByRole("checkbox", { name: /^(Overview|Resumen)$/ }).check();
  await panel.getByRole("checkbox", { name: /^(Budget|Presupuesto)$/ }).check();
  await panel.getByLabel(/Initial view|Vista inicial/).selectOption("budget");
  await panel.getByLabel(/Budget category \(optional\)|Categoría del presupuesto \(opcional\)/).fill("QA Structure");
  const created = owner.waitForResponse(response => response.url().endsWith("/api/access-links") && response.request().method() === "POST");
  await panel.getByRole("button", { name: /^(Create read link|Crear enlace de lectura)$/ }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const link = (await response.json() as { link: { id: string; role: string; authentication: string; permissions: Record<string, boolean> } }).link;
  expect(link.role).toBe("viewer");
  expect(link.authentication).toBe("account");
  const createdLinkIds = [link.id];
  let reader: { context: BrowserContext; page: Page } | null = null;
  let guestContext: BrowserContext | null = null;
  try {
    const url = await panel.getByRole("textbox", { name: /Read access link|Enlace de acceso de lectura/ }).inputValue();
    expect(new URL(url).pathname).toBe(`/projects/${encodeURIComponent(projectId)}/budget/chapter/QA%20Structure`);
    reader = await signIn(browser, companionEmail, companionPassword, url);
    const actor = await guard(reader.page, companionEmail, "viewer");
    expect(actor.projectId).toBe(projectId);
    expect(actor.readOnlyLink).toBe(true);
    expect(actor.anonymousLink).toBe(false);
    await reader.page.goto(`/projects/${encodeURIComponent(projectId)}/budget/chapter/QA%20Structure`, { waitUntil: "domcontentloaded" });
    const amount = reader.page.getByRole("spinbutton", { name: /QA Completed concrete (Objective|Objetivo)/ });
    await expect(amount).toHaveValue("1000");
    await expect(amount).toBeDisabled();
    expect(new URL(reader.page.url()).searchParams.has("accessLink")).toBe(false);
    expect((await reader.page.request.post("/api/workbook/drafts", { data: { action: "create" } })).status()).toBe(403);
    expect((await reader.page.request.post("/api/quotes/chat", { data: { id: "readonly-check", question: "Read-only check" } })).status()).toBe(403);
    expect((await reader.page.request.patch("/api/countdowns", { data: { id: "readonly-check", action: "acknowledge" } })).status()).toBe(403);
    expect((await reader.page.request.get("/api/files")).status()).toBe(403);
    expect((await reader.page.request.get("/api/access-links")).status()).toBe(403);

    await showReadLinks();
    await panel.locator(".read-link-record").filter({ hasText: name }).getByRole("button", { name: /^(Edit permissions|Editar permisos)$/ }).click();
    await panel.getByRole("checkbox", { name: /^(Budget|Presupuesto)$/ }).uncheck();
    await panel.getByRole("checkbox", { name: /^(Documents|Documentos)$/ }).check();
    await panel.getByRole("button", { name: /^(Save link permissions|Guardar permisos del enlace)$/ }).click();
    await expect(panel.getByText(/Read permissions updated|Permisos de lectura actualizados/)).toBeVisible();
    expect((await reader.page.request.get("/api/budget")).status()).toBe(403);
    expect((await reader.page.request.get("/api/files")).status()).toBe(200);
    const restrictedFolders = { mode: "selected", folderIds: [], allowUnfiled: false };
    await mutateJson(owner, "patch", "/api/access-links", { id: link.id, action: "update", folderAccess: restrictedFolders });
    const folderActor = await json<{ user: QaUser & { folderAccess: typeof restrictedFolders } }>(await reader.page.request.get("/api/me"));
    expect(folderActor.user.folderAccess).toEqual(restrictedFolders);
    expect((await json<{ documents: unknown[] }>(await reader.page.request.get("/api/files"))).documents).toEqual([]);

    await showReadLinks();
    await panel.locator(".read-link-record").filter({ hasText: name }).getByRole("button", { name: /^(Revoke link|Revocar enlace)$/ }).click();
    await expect(panel.getByText(/Link revoked\.|Enlace revocado\./)).toBeVisible();
    const withdrawn = await json<{ user: QaUser & { permissions: Record<string, boolean>; folderAccess: typeof restrictedFolders } }>(await reader.page.request.get("/api/me"));
    expect(withdrawn.user).toMatchObject({ projectId, role: "viewer", status: "rejected", readOnlyLink: true, folderAccess: restrictedFolders });
    expect(Object.values(withdrawn.user.permissions).every(value => value === false)).toBe(true);
    // The document API's existing contract returns 401 for unapproved members.
    expect((await reader.page.request.get("/api/files")).status()).toBe(401);
    const projects = await json<{ projects: Array<{ id: string }> }>(await reader.page.request.get("/api/projects"));
    expect(projects.projects.some(project => project.id === projectId)).toBe(false);
    expect((await reader.page.request.patch("/api/projects", { data: { projectId } })).status()).toBe(403);

    // The existing session remains valid even though its selected project's
    // grant was withdrawn. Accept a second capability without signing in again.
    const nextLink = await mutateJson<{ link: { id: string }; accessUrl: string }>(owner, "post", "/api/access-links", { label: `${runId} existing session`, authentication: "account", permissions: link.permissions }, [201]);
    createdLinkIds.push(nextLink.link.id);
    const secondUrl = new URL(nextLink.accessUrl);
    secondUrl.pathname = `/projects/${encodeURIComponent(projectId)}/budget/chapter/QA%20Structure`;
    const redeemed = reader.page.waitForResponse(result => result.url().endsWith("/api/access-links/redeem") && result.request().method() === "POST");
    await reader.page.goto(localInitialUrl(secondUrl.href), { waitUntil: "domcontentloaded" });
    expect((await redeemed).status()).toBe(200);
    await expect.poll(() => new URL(reader!.page.url()).searchParams.has("accessLink")).toBe(false);
    expect((await guard(reader.page, companionEmail, "viewer")).readOnlyLink).toBe(true);
    await expect(amount).toHaveValue("1000");
    await expect(amount).toBeDisabled();
    expect((await reader.page.request.post("/api/access-links/redeem", { data: { token: secondUrl.searchParams.get("accessLink"), requestedProjectId: "qa-wrong-project" } })).status()).toBe(403);
    await guard(reader.page, companionEmail, "viewer");

    const members = await json<{ users: Array<{ uid: string; email: string }> }>(await owner.request.get("/api/access"));
    const readerUid = members.users.find(member => member.email.toLowerCase() === companionEmail)?.uid;
    expect(readerUid).toBeTruthy();
    await mutateJson(owner, "patch", "/api/access", { uid: readerUid, action: "reject", role: "viewer" });
    expect((await json<{ user: QaUser }>(await reader.page.request.get("/api/me"))).user).toMatchObject({ projectId, status: "rejected" });
    const refused = reader.page.waitForResponse(result => result.url().endsWith("/api/access-links/redeem") && result.request().method() === "POST");
    await reader.page.goto(localInitialUrl(secondUrl.href), { waitUntil: "domcontentloaded" });
    expect((await refused).status()).toBe(403);
    await expect(reader.page.locator('.auth-error[role="alert"]')).toContainText(/administrador|administrator/i);
    await expect(reader.page.locator(".budget-table-editor")).toHaveCount(0);
    expect((await reader.page.request.get("/api/budget")).status()).toBe(403);

    // Public links have no account or membership. Exercise their automatic entry
    // separately from the account grant, whose identity and revocation stay above.
    const publicLink = await mutateJson<{ link: { id: string; authentication: string }; accessUrl: string }>(owner, "post", "/api/access-links", {
      label: `${runId} anonymous visitor`, authentication: "public", permissions: link.permissions,
    }, [201]);
    expect(publicLink.link.authentication).toBe("public");
    createdLinkIds.push(publicLink.link.id);
    const publicUrl = new URL(publicLink.accessUrl);
    publicUrl.pathname = `/projects/${encodeURIComponent(projectId)}/budget/chapter/QA%20Structure`;
    guestContext = await browser.newContext({ recordVideo: { dir: artifactDirectory, size: { width: 1280, height: 900 } } });
    const guestPage = await guestContext.newPage();
    let guestSessionRequests = 0;
    guestPage.on("request", request => { if (new URL(request.url()).pathname === "/api/session") guestSessionRequests += 1; });
    await guestContext.tracing.start({ screenshots: true, snapshots: true, sources: true });
    await guestPage.goto(localInitialUrl(publicUrl.href), { waitUntil: "domcontentloaded" });
    await expect.poll(() => new URL(guestPage.url()).searchParams.has("accessLink")).toBe(false);
    await expect.poll(async () => (await guestPage.request.get("/api/me")).status()).toBe(200);
    const guest = await json<{ user: QaUser }>(await guestPage.request.get("/api/me"));
    expect(guest.user).toMatchObject({ email: "", projectId, isPersonal: false, role: "viewer", status: "approved", readOnlyLink: true, anonymousLink: true });
    expect(new URL(guestPage.url()).pathname).toBe(publicUrl.pathname);
    await expect(guestPage.locator("form.auth-form")).toHaveCount(0);
    const guestAmount = guestPage.getByRole("spinbutton", { name: /QA Completed concrete (Objective|Objetivo)/ });
    await expect(guestAmount).toHaveValue("1000");
    await expect(guestAmount).toBeDisabled();
    expect((await guestPage.request.post("/api/workbook/drafts", { data: { action: "create" } })).status()).toBe(403);
    expect((await guestPage.request.post("/api/quotes/chat", { data: { id: "anonymous-check", question: "Read-only check" } })).status()).toBe(403);
    expect((await guestPage.request.get("/api/files")).status()).toBe(403);
    expect((await guestPage.request.get("/api/access-links")).status()).toBe(403);

    // The same public capability must preserve an independently approved role.
    const independentOwner = await guard(owner, ownerEmail, "admin");
    await owner.goto(localInitialUrl(publicUrl.href), { waitUntil: "domcontentloaded" });
    await expect.poll(() => new URL(owner.url()).searchParams.has("accessLink")).toBe(false);
    expect(await guard(owner, ownerEmail, "admin")).toEqual(independentOwner);

    await mutateJson(owner, "patch", "/api/access-links", {
      id: publicLink.link.id, action: "update", permissions: { ...link.permissions, budget: false, documents: true }, folderAccess: restrictedFolders,
    });
    expect((await guestPage.request.get("/api/budget")).status()).toBe(403);
    expect((await json<{ documents: unknown[] }>(await guestPage.request.get("/api/files"))).documents).toEqual([]);
    await mutateJson(owner, "patch", "/api/access-links", { id: publicLink.link.id, action: "revoke" });
    expect((await guestPage.request.get("/api/me")).status()).toBe(401);
    expect((await guestPage.request.get("/api/budget")).status()).toBe(403);
    const refusedGuest = guestPage.waitForResponse(result => result.url().endsWith("/api/access-links/redeem") && result.request().method() === "POST");
    await guestPage.goto(localInitialUrl(publicUrl.href), { waitUntil: "domcontentloaded" });
    expect((await refusedGuest).status()).toBe(410);
    await expect(guestPage.locator('.auth-error[role="alert"]')).toContainText(/caducado|revocado|expired|revoked/i);
    await expect(guestPage.locator(".budget-table-editor")).toHaveCount(0);
    expect(guestSessionRequests).toBe(0);
  } finally {
    for (const id of createdLinkIds) await owner.request.patch("/api/access-links", { data: { id, action: "revoke" }, failOnStatusCode: false }).catch(() => undefined);
    if (reader) {
      await reader.context.tracing.stop({ path: join(artifactDirectory, "read-link-trace.zip") }).catch(() => undefined);
      await reader.context.close();
    }
    if (guestContext) {
      await guestContext.tracing.stop({ path: join(artifactDirectory, "public-read-link-trace.zip") }).catch(() => undefined);
      await guestContext.close();
    }
  }
  await openSection(owner, "Budget", "Presupuesto");
}

test.describe.configure({ mode: "serial" });
test.setTimeout(30 * 60 * 1000);

test(`on-demand QA regression · ${suite}`, async ({ browser }) => {
  expect(ownerEmail && ownerPassword, "QA owner credentials are required").toBeTruthy();
  if (suite === "full" || suite === "expenses" || suite === "documents" || suite === "aesthetics") expect(companionEmail && companionPassword, "QA companion credentials are required").toBeTruthy();
  expect(ownerEmail, "The regression owner must be the fixed QA account").toBe(expectedOwnerEmail);
  if (suite === "full" || suite === "expenses" || suite === "documents" || suite === "aesthetics") expect(companionEmail, "The regression companion must be the fixed QA account").toBe(expectedCompanionEmail);
  await mkdir(artifactDirectory, { recursive: true });
  const generated = await createQaFixtures(runId, suite === "expenses");
  const owner = await signIn(browser, ownerEmail, ownerPassword);
  let companion: { context: BrowserContext; page: Page } | null = null;
  let leaseAcquired = false;
  let completed = false;
  let documentsCleanupFailed = false;
  let receiptDocumentId = "";
  let referenceFolderId = "";
  let pdfDocumentId = "";
  let planId = "";
  let countdownId = "";
  let decisionId = "";
  let issueId = "";
  let qaFolderId = "";
  let aestheticFolderId = "";
  const aestheticImageIds: string[] = [];
  let companionUid = "";
  let ownerUid = "";
  let originalFavoriteId: string | null = null;
  let originalOpenFavorite = false;
  let preferencesChanged = false;

  try {
    await test.step("guard project, acquire lease, and reset", async () => {
      await guard(owner.page, ownerEmail, "admin");
      await json(await guarded(owner.page, ownerEmail, () => owner.page.request.post("/api/qa/run", { data: { runId: leaseRunId, aiMode: aiEnabled ? "basic" : "disabled", suite: suite === "expenses" || suite === "distribution" || suite === "notes" || suite === "documents" || suite === "aesthetics" ? "smoke" : suite }, failOnStatusCode: false })), [201]);
      leaseAcquired = true;
      await resetQa(owner.page);
      if (suite === "full" || suite === "expenses" || suite === "documents" || suite === "aesthetics") {
        // Keep the companion provisioning secret outside recorded traces.
        await owner.context.tracing.stop();
        try {
          await json(await guarded(owner.page, ownerEmail, () => owner.page.request.post("/api/qa/companion", {
            data: { email: companionEmail, password: companionPassword },
            failOnStatusCode: false,
          })), [200, 201]);
        } finally {
          await owner.context.tracing.start({ screenshots: true, snapshots: true, sources: true });
        }
      }
      await owner.page.reload();
      await guard(owner.page, ownerEmail, "admin");
      const defaultAesthetics = await json<{ folders: Array<{ name: string; kind: string; sortOrder: number }> }>(await owner.page.request.get("/api/aesthetics"));
      expect(defaultAesthetics.folders.slice(0, 3)).toEqual([
        expect.objectContaining({ name: "Interior", kind: "images", sortOrder: 0 }),
        expect.objectContaining({ name: "Exterior", kind: "images", sortOrder: 1 }),
        expect.objectContaining({ name: "Planos", kind: "plans", sortOrder: 2 }),
      ]);
    });

    if (suite === "cleanup") {
      await test.step("restore only the small synthetic role and isolation baseline", async () => {
        const baseline = await mutateJson<{ fixtureVersion: number; users: Array<{ email: string }> }>(owner.page, "post", "/api/qa/fixtures", { action: "reset", confirmation: "RESET QA FIXTURES" });
        expect(baseline.fixtureVersion).toBe(1);
        expect(baseline.users).toHaveLength(6);
      });
      completed = true;
      return;
    }

    if (suite === "documents") {
      const invitation = await mutateJson<{ inviteUrl: string }>(owner.page, "post", "/api/invitations", {
        email: companionEmail, role: "viewer", permissions: { overview: true, documents: true },
        folderAccess: { mode: "all", folderIds: [], allowUnfiled: true },
      }, [201]);
      companion = await signIn(browser, companionEmail, companionPassword, invitation.inviteUrl);
      await verifyEncryptedDocumentFolders({
        owner: owner.page, companion: companion.page, companionEmail, projectId, runId, artifactDirectory,
        image: generated.fixtures.image,
        guardOwner: () => guard(owner.page, ownerEmail, "admin"),
        guardCompanion: () => guard(companion!.page, companionEmail, "viewer"),
        waitForProjectReady,
      });
      completed = true;
      return;
    }

    if (suite === "aesthetics") {
      await test.step("authenticated subfolders and mixed photo carousel survive reload, moves and deletion", async () => {
        const createFolder = async (name: string, parentId?: string) => (await mutateJson<{ folder: { id: string } }>(owner.page, "post", "/api/aesthetics", { action: "create_folder", name, parentId }, [201])).folder.id;
        const parent = await createFolder(`${runId} Interior`);
        const exterior = await createFolder(`${runId} Exterior`);
        const kitchen = await createFolder("Cocina", parent);
        const bathroom = await createFolder("Baño", parent);
        const bathroomPath = `/projects/${encodeURIComponent(projectId)}/aesthetics/folder/${encodeURIComponent(bathroom)}`;
        const photoIds: string[] = [];
        for (const [folderId, name] of [[kitchen, "cocina"], [exterior, "terraza"]]) {
          const response = await guarded(owner.page, ownerEmail, () => owner.page.request.post("/api/aesthetics", { multipart: { folderId, file: { name: `${runId}-${name}.png`, mimeType: generated.fixtures.image.mimeType, buffer: generated.fixtures.image.buffer } } }));
          photoIds.push((await json<{ image: { id: string } }>(response, [201])).image.id);
        }
        const archivePath = (folderId: string) => `/api/aesthetics/archive?folderId=${encodeURIComponent(folderId)}`;
        const expectedKitchenArchivePath = `${runId} Interior/Cocina/${runId}-cocina.jpg`;
        const expectedBathroomArchivePath = `${runId} Interior/Baño/${runId}-terraza.jpg`;
        const verifyFolderArchive = async (page: Page, email: string, expectedFiles: Array<{ id: string; path: string }>) => {
          const response = await guarded(page, email, () => page.request.get(archivePath(parent)));
          if (!response.ok()) await json(response);
          expect(response.status()).toBe(200);
          expect(response.headers()["content-type"]).toBe("application/zip");
          expect(response.headers()["cache-control"]).toBe("private, no-store");
          const archive = await JSZip.loadAsync(await response.body());
          const files = Object.values(archive.files).filter(file => !file.dir);
          expect(files.map(file => file.name).sort()).toEqual(expectedFiles.map(file => file.path).sort());
          for (const expected of expectedFiles) {
            const original = await page.request.get(`/api/aesthetics/image/${encodeURIComponent(expected.id)}`);
            expect(original.status()).toBe(200);
            expect(await archive.file(expected.path)!.async("nodebuffer")).toEqual(await original.body());
          }
        };
        await test.step("folder ZIP includes descendant folders and complete stored originals", async () => {
          // Reuse the two uploaded fixtures and restore their original folders.
          await mutateJson(owner.page, "patch", "/api/aesthetics", { action: "move_image", id: photoIds[1], folderId: bathroom });
          try {
            await verifyFolderArchive(owner.page, ownerEmail, [
              { id: photoIds[0], path: expectedKitchenArchivePath },
              { id: photoIds[1], path: expectedBathroomArchivePath },
            ]);
          } finally {
            await mutateJson(owner.page, "patch", "/api/aesthetics", { action: "move_image", id: photoIds[1], folderId: exterior });
          }
        });
        await openSection(owner.page, "Aesthetics", "Estética");
        await owner.page.locator(".aesthetic-folder-strip").getByRole("button", { name: /Baño/ }).click();
        await expect.poll(() => new URL(owner.page.url()).pathname).toBe(bathroomPath);
        await owner.page.getByRole("button", { name: /Choose carousel photos|Elegir fotos del carrusel/ }).click();
        await owner.page.getByLabel(/Source folder|Carpeta de origen/).selectOption(kitchen);
        const kitchenChoice = owner.page.getByRole("checkbox", { name: new RegExp(`${runId}-cocina`) });
        await kitchenChoice.click();
        await expect(kitchenChoice).toBeChecked();
        await owner.page.getByLabel(/Source folder|Carpeta de origen/).selectOption(exterior);
        const terraceChoice = owner.page.getByRole("checkbox", { name: new RegExp(`${runId}-terraza`) });
        await terraceChoice.click();
        await expect(terraceChoice).toBeChecked();
        await expect(owner.page.locator(".aesthetic-thumbnail-card")).toHaveCount(2);
        const read = async () => json<{ folders: Array<{ id: string; parentId: string | null; carouselImageIds: string[] }>; images: Array<{ id: string; folderId: string; caption: string; notes?: string }> }>(await owner.page.request.get("/api/aesthetics"));
        await expect.poll(async () => (await read()).folders.find((folder) => folder.id === bathroom)?.carouselImageIds).toEqual(photoIds);
        await test.step("ZIP follows physical folders and excludes outside images curated into their carousels", async () => {
          // The bathroom carousel includes both images, but neither is physically
          // stored there. Its ZIP must not pull files from unrelated folders.
          expect((await owner.page.request.get(archivePath(bathroom))).status()).toBe(409);
          await verifyFolderArchive(owner.page, ownerEmail, [{ id: photoIds[0], path: expectedKitchenArchivePath }]);
        });
        expect((await read()).folders.find((folder) => folder.id === kitchen)).toMatchObject({ parentId: parent, carouselImageIds: [] });
        await mutateJson(owner.page, "patch", "/api/aesthetics", { action: "carousel", id: kitchen, imageIds: [photoIds[0]] });
        await owner.page.reload();
        await waitForProjectReady(owner.page);
        await expect(owner.page.locator(".topbar h1")).toHaveText(/^(Aesthetics|Estética)$/);
        await expect.poll(() => new URL(owner.page.url()).pathname).toBe(bathroomPath);
        await expect(owner.page.locator(".aesthetic-folder-strip").getByRole("button", { name: /Baño/ })).toHaveClass(/selected/);
        await expect(owner.page.locator(".aesthetic-thumbnail-card")).toHaveCount(2);
        await test.step("image notes persist across gallery, carousel and viewer while viewers remain read-only", async () => {
          const imageName = `${runId}-cocina.png`;
          const imageNotes = "Confirmar madera clara con el proveedor.\nMantener iluminación cálida y textura mate.";
          const originalCaption = (await read()).images.find((image) => image.id === photoIds[0])?.caption;
          const notesButton = new RegExp(`^(Notes for|Notas de) ${imageName}$`);
          const notesDialog = owner.page.getByRole("dialog", { name: /^(Image notes|Notas de la imagen)$/ });
          await owner.page.locator(".aesthetic-play").click();
          await owner.page.getByRole("button", { name: new RegExp(`^(Show|Mostrar) ${imageName}$`) }).click();
          await owner.page.locator(".aesthetic-carousel").getByRole("button", { name: notesButton }).click();
          await notesDialog.getByLabel(/^(Notes|Notas)$/).fill(imageNotes);
          await notesDialog.getByRole("button", { name: /^(Save notes|Guardar notas)$/ }).click();
          await expect(notesDialog).toHaveCount(0);
          await expect.poll(async () => (await read()).images.find((image) => image.id === photoIds[0])?.notes).toBe(imageNotes);
          expect((await read()).images.find((image) => image.id === photoIds[1])?.notes || "").toBe("");
          expect((await read()).images.find((image) => image.id === photoIds[0])?.caption).toBe(originalCaption);

          await owner.page.reload();
          await waitForProjectReady(owner.page);
          await owner.page.getByRole("button", { name: new RegExp(`^(Show|Mostrar) ${imageName}$`) }).click();
          await owner.page.locator(".aesthetic-stage").click();
          const imageViewer = owner.page.getByRole("dialog", { name: imageName, exact: true });
          await imageViewer.getByRole("button", { name: notesButton }).click();
          await expect(notesDialog.getByLabel(/^(Notes|Notas)$/)).toHaveValue(imageNotes);
          await notesDialog.getByLabel(/^(Notes|Notas)$/).fill("Este borrador debe descartarse.");
          await notesDialog.getByRole("button", { name: /^(Cancel|Cancelar)$/ }).click();
          await imageViewer.locator(".close").click();

          const kitchenPath = `/projects/${encodeURIComponent(projectId)}/aesthetics/folder/${encodeURIComponent(kitchen)}`;
          await owner.page.goto(kitchenPath, { waitUntil: "domcontentloaded" });
          await waitForProjectReady(owner.page);
          await owner.page.locator(".aesthetic-gallery").getByRole("button", { name: notesButton }).click();
          await expect(notesDialog.getByLabel(/^(Notes|Notas)$/)).toHaveValue(imageNotes);
          await owner.page.screenshot({ path: join(artifactDirectory, "aesthetics-image-notes-desktop.png") });
          await owner.page.setViewportSize({ width: 390, height: 844 });
          const notesWidth = await owner.page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
          expect(notesWidth.content).toBeLessThanOrEqual(notesWidth.viewport);
          await expect(notesDialog.getByRole("button", { name: /^(Cancel|Cancelar)$/ })).toBeInViewport();
          await owner.page.screenshot({ path: join(artifactDirectory, "aesthetics-image-notes-mobile.png") });
          await notesDialog.getByRole("button", { name: /^(Cancel|Cancelar)$/ }).click();
          await owner.page.setViewportSize({ width: 1280, height: 900 });

          const invitation = await mutateJson<{ inviteUrl: string }>(owner.page, "post", "/api/invitations", {
            email: companionEmail, role: "viewer", permissions: { overview: true, aesthetics: true }, folderAccess: { mode: "all", folderIds: [], allowUnfiled: true },
          }, [201]);
          companion = await signIn(browser, companionEmail, companionPassword, invitation.inviteUrl);
          await guard(companion.page, companionEmail, "viewer");
          await test.step("authorized viewer downloads complete folder originals without edit access", async () => {
            await mutateJson(owner.page, "patch", "/api/aesthetics", { action: "move_image", id: photoIds[1], folderId: bathroom });
            try {
              await verifyFolderArchive(companion!.page, companionEmail, [
                { id: photoIds[0], path: expectedKitchenArchivePath },
                { id: photoIds[1], path: expectedBathroomArchivePath },
              ]);
            } finally {
              await mutateJson(owner.page, "patch", "/api/aesthetics", { action: "move_image", id: photoIds[1], folderId: exterior });
            }
          });
          await companion.page.goto(bathroomPath, { waitUntil: "domcontentloaded" });
          await waitForProjectReady(companion.page);
          await companion.page.getByRole("button", { name: new RegExp(`^(Show|Mostrar) ${imageName}$`) }).click();
          await companion.page.locator(".aesthetic-carousel").getByRole("button", { name: notesButton }).click();
          const viewerNotes = companion.page.getByRole("dialog", { name: /^(Image notes|Notas de la imagen)$/ });
          await expect(viewerNotes.locator(".aesthetic-notes-content")).toHaveText(imageNotes);
          await expect(viewerNotes.locator("textarea")).toHaveCount(0);
          await expect(viewerNotes.getByRole("button", { name: /^(Save notes|Guardar notas)$/ })).toHaveCount(0);
          await viewerNotes.getByRole("button", { name: /^(Close|Cerrar)$/ }).click();
          await guard(companion.page, companionEmail, "viewer");
          expect((await companion.page.request.patch("/api/aesthetics", { data: { action: "notes", id: photoIds[0], notes: "Forbidden viewer edit" } })).status()).toBe(403);
          expect((await read()).images.find((image) => image.id === photoIds[0])?.notes).toBe(imageNotes);
          await owner.page.goto(bathroomPath, { waitUntil: "domcontentloaded" });
          await waitForProjectReady(owner.page);
        });
        await owner.page.getByRole("button", { name: new RegExp(`Move ${runId}-terraza.* left|Mover ${runId}-terraza.* izquierda`) }).click();
        await expect.poll(async () => (await read()).folders.find((folder) => folder.id === bathroom)?.carouselImageIds).toEqual([...photoIds].reverse());
        await mutateJson(owner.page, "patch", "/api/aesthetics", { action: "move_image", id: photoIds[0], folderId: exterior });
        expect((await read()).folders.find((folder) => folder.id === kitchen)?.carouselImageIds).toContain(photoIds[0]);
        expect((await read()).folders.find((folder) => folder.id === bathroom)?.carouselImageIds).toEqual([...photoIds].reverse());
        await mutateJson(owner.page, "delete", `/api/aesthetics?type=image&id=${photoIds[0]}`);
        const afterDelete = await read();
        expect(afterDelete.images.some((image) => image.id === photoIds[0])).toBe(false);
        expect(afterDelete.folders.every((folder) => !folder.carouselImageIds.includes(photoIds[0]))).toBe(true);
        await owner.page.setViewportSize({ width: 390, height: 844 });
        await owner.page.reload();
        await waitForProjectReady(owner.page);
        await expect(owner.page.locator(".topbar h1")).toHaveText(/^(Aesthetics|Estética)$/);
        await expect.poll(() => new URL(owner.page.url()).pathname).toBe(bathroomPath);
        await expect(owner.page.locator(".aesthetic-mobile-folder-picker").getByRole("combobox", { name: /Folder|Carpeta/ })).toHaveValue(bathroom);
        await expect(owner.page.locator(".aesthetic-thumbnail-card")).toHaveCount(1);
        await owner.page.getByRole("button", { name: /Choose carousel photos|Elegir fotos del carrusel/ }).click();
        const width = await owner.page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
        expect(width.content).toBeLessThanOrEqual(width.viewport);
        await owner.page.screenshot({ path: join(artifactDirectory, "aesthetics-mobile.png"), fullPage: true });
      });
      await test.step("moved image cards remove their original carousel without changing the destination carousel", async () => {
        await owner.page.setViewportSize({ width: 1280, height: 900 });
        const sourceName = `${runId} Carousel Exterior`;
        const createFolder = async (name: string) => (await mutateJson<{ folder: { id: string } }>(owner.page, "post", "/api/aesthetics", { action: "create_folder", name }, [201])).folder.id;
        const sourceFolder = await createFolder(sourceName);
        const destinationFolder = await createFolder("Deprecado");
        const read = async () => json<{ folders: Array<{ id: string; carouselImageIds: string[] }>; images: Array<{ id: string; folderId: string; name: string }> }>(await owner.page.request.get("/api/aesthetics"));
        const uploadPhoto = async (folderId: string, name: string) => {
          const response = await guarded(owner.page, ownerEmail, () => owner.page.request.post("/api/aesthetics", { multipart: { folderId, file: { name, mimeType: generated.fixtures.image.mimeType, buffer: generated.fixtures.image.buffer } } }));
          return (await json<{ image: { id: string } }>(response, [201])).image.id;
        };
        const photoNames = [`${runId}-moved-exterior-1.png`, `${runId}-moved-exterior-2.png`];
        const photoIds: string[] = [];
        for (const name of photoNames) photoIds.push(await uploadPhoto(sourceFolder, name));
        const destinationPhoto = await uploadPhoto(destinationFolder, `${runId}-destination.png`);
        const destinationCarousel = [destinationPhoto, photoIds[0]];
        await mutateJson(owner.page, "patch", "/api/aesthetics", { action: "carousel", id: sourceFolder, imageIds: photoIds });
        await mutateJson(owner.page, "patch", "/api/aesthetics", { action: "carousel", id: destinationFolder, imageIds: destinationCarousel });
        const openFolder = async (folderId: string) => {
          await owner.page.goto(`/projects/${encodeURIComponent(projectId)}/aesthetics/folder/${encodeURIComponent(folderId)}`, { waitUntil: "domcontentloaded" });
          await waitForProjectReady(owner.page);
          await guard(owner.page, ownerEmail, "admin");
        };
        const cardFor = (name: string) => owner.page.locator(".aesthetic-grid article").filter({ has: owner.page.getByText(name, { exact: true }) });
        await openFolder(sourceFolder);
        for (const [index, name] of photoNames.entries()) {
          await cardFor(name).getByRole("combobox", { name: new RegExp(`Move ${name} to folder|Mover ${name} a carpeta`) }).selectOption(destinationFolder);
          await expect.poll(async () => (await read()).images.find((image) => image.id === photoIds[index])?.folderId).toBe(destinationFolder);
          await expect(cardFor(name)).toHaveCount(0);
        }
        const afterMove = await read();
        expect(afterMove.folders.find((folder) => folder.id === sourceFolder)?.carouselImageIds).toEqual(photoIds);
        expect(afterMove.folders.find((folder) => folder.id === destinationFolder)?.carouselImageIds).toEqual(destinationCarousel);
        await openFolder(destinationFolder);
        const removeSource = new RegExp(`(?:Remove from carousel|Quitar del carrusel) · ${sourceName}$`);
        for (const [index, name] of photoNames.entries()) {
          const card = cardFor(name);
          await card.getByRole("button", { name: removeSource }).click();
          await expect.poll(async () => (await read()).folders.find((folder) => folder.id === sourceFolder)?.carouselImageIds).toEqual(photoIds.slice(index + 1));
          await expect(card.getByRole("button", { name: removeSource })).toHaveCount(0);
          const current = await read();
          expect(current.folders.find((folder) => folder.id === destinationFolder)?.carouselImageIds).toEqual(destinationCarousel);
          expect(current.images.filter((image) => photoIds.includes(image.id))).toHaveLength(2);
          expect(current.images.filter((image) => photoIds.includes(image.id)).every((image) => image.folderId === destinationFolder)).toBe(true);
        }
        await owner.page.reload();
        await waitForProjectReady(owner.page);
        await expect(cardFor(photoNames[0]).getByRole("button", { name: /(?:Remove from carousel|Quitar del carrusel) · Deprecado$/ })).toBeVisible();
        await expect(cardFor(photoNames[1]).getByRole("button", { name: /(?:Show in carousel|Mostrar en carrusel) · Deprecado$/ })).toBeVisible();
        await expect(owner.page.locator(".aesthetic-thumbnail-card")).toHaveCount(destinationCarousel.length);
        await expect(owner.page.getByRole("button", { name: removeSource })).toHaveCount(0);
        await owner.page.screenshot({ path: join(artifactDirectory, "aesthetics-deprecated-carousel-removal.png"), fullPage: true });
        await openFolder(sourceFolder);
        await expect(owner.page.locator(".aesthetic-carousel.empty")).toBeVisible();
        await expect(owner.page.locator(".aesthetic-thumbnail-card")).toHaveCount(0);
        const final = await read();
        expect(final.folders.find((folder) => folder.id === sourceFolder)?.carouselImageIds).toEqual([]);
        expect(final.folders.find((folder) => folder.id === destinationFolder)?.carouselImageIds).toEqual(destinationCarousel);
        expect(final.images.filter((image) => photoIds.includes(image.id))).toEqual(expect.arrayContaining(photoIds.map((id) => expect.objectContaining({ id, folderId: destinationFolder }))));
      });
      await test.step("PDF descendants, cross-folder carousels and invalid selections preserve curated data", async () => {
        type Folder = { id: string; name: string; kind: string; parentId: string | null; carouselImageIds: string[] };
        type Image = { id: string; folderId: string; mediaType: string; name: string };
        const read = async () => json<{ folders: Folder[]; images: Image[] }>(await owner.page.request.get("/api/aesthetics"));
        const baseline = await read();
        const plansRoot = baseline.folders.find((folder) => folder.kind === "plans" && folder.name === "Planos" && folder.parentId === null);
        expect(plansRoot).toMatchObject({ name: "Planos", kind: "plans", parentId: null, carouselImageIds: [] });
        const rootId = plansRoot!.id;
        const createFolder = async (name: string, parentId?: string) => (await mutateJson<{ folder: Folder }>(owner.page, "post", "/api/aesthetics", { action: "create_folder", name, parentId }, [201])).folder;
        const child = await createFolder(`${runId} PDF revisions`, rootId);
        const grandchild = await createFolder("Nested PDF plans", child.id);
        const sibling = await createFolder(`${runId} Final PDF plans`, rootId);
        const photoFolder = await createFolder(`${runId} Photo selection`);
        const photo = baseline.images.find((image) => image.mediaType === "image");
        expect(photo, "The earlier aesthetics steps must leave a synthetic photo available").toBeTruthy();
        const photoSelection = [photo!.id];
        const plans: Image[] = [];

        await test.step("PDF child and grandchild inherit kind and uploaded files remain uncurated", async () => {
          expect(child).toMatchObject({ kind: "plans", parentId: rootId, carouselImageIds: [] });
          expect(grandchild).toMatchObject({ kind: "plans", parentId: child.id, carouselImageIds: [] });
          expect(sibling).toMatchObject({ kind: "plans", parentId: rootId, carouselImageIds: [] });
          for (const [folderId, suffix] of [[grandchild.id, "nested"], [sibling.id, "final"]]) {
            const response = await guarded(owner.page, ownerEmail, () => owner.page.request.post("/api/aesthetics", {
              multipart: { folderId, file: { name: `${runId}-${suffix}-plan.pdf`, mimeType: generated.fixtures.pdf.mimeType, buffer: generated.fixtures.pdf.buffer } },
              failOnStatusCode: false,
            }));
            const uploaded = await json<{ image: Image & { contentType: string } }>(response, [201]);
            expect(uploaded.image).toMatchObject({ folderId, mediaType: "pdf", contentType: "application/pdf" });
            plans.push(uploaded.image);
            const current = await read();
            for (const id of [rootId, child.id, grandchild.id, sibling.id]) expect(current.folders.find((folder) => folder.id === id)?.carouselImageIds).toEqual([]);
          }
        });

        const orderedPlans = [plans[1].id, plans[0].id];
        await test.step("PDF carousel keeps cross-folder order through reload and child rename", async () => {
          for (const id of [rootId, grandchild.id]) {
            await mutateJson(owner.page, "patch", "/api/aesthetics", { action: "carousel", id, imageIds: orderedPlans });
          }
          await mutateJson(owner.page, "patch", "/api/aesthetics", { action: "carousel", id: photoFolder.id, imageIds: photoSelection });
          const current = await read();
          for (const id of [rootId, grandchild.id]) expect(current.folders.find((folder) => folder.id === id)?.carouselImageIds).toEqual(orderedPlans);
          expect(current.images.filter((image) => orderedPlans.includes(image.id))).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: plans[0].id, folderId: grandchild.id }),
            expect.objectContaining({ id: plans[1].id, folderId: sibling.id }),
          ]));
          const path = `/projects/${encodeURIComponent(projectId)}/aesthetics/folder/${encodeURIComponent(grandchild.id)}`;
          await owner.page.goto(path, { waitUntil: "domcontentloaded" });
          await waitForProjectReady(owner.page);
          await expect(owner.page.getByRole("heading", { name: grandchild.name, exact: true })).toBeVisible();
          await expect(owner.page.getByRole("button", { name: /Add PDFs|Agregar PDF/ })).toBeVisible();
          await expect(owner.page.locator(".aesthetic-thumbnail-card")).toHaveCount(2);
          await expect(owner.page.locator(".aesthetic-pdf-stage iframe")).toBeVisible();
          const renamed = "Renamed nested PDF plans";
          const changed = await mutateJson<{ folder: Folder }>(owner.page, "patch", "/api/aesthetics", { action: "rename_folder", id: grandchild.id, name: renamed });
          expect(changed.folder).toMatchObject({ name: renamed, kind: "plans", parentId: child.id, carouselImageIds: orderedPlans });
          await owner.page.reload();
          await waitForProjectReady(owner.page);
          await expect(owner.page.getByRole("heading", { name: renamed, exact: true })).toBeVisible();
          await expect(owner.page.locator(".aesthetic-thumbnail-card")).toHaveCount(2);
        });

        await test.step("mixed, malformed and missing carousel selections reject every change atomically", async () => {
          const missingId = `${runId}-missing-aesthetic`;
          const rejected: Array<{ label: string; id: string; imageIds: unknown }> = [
            { label: "photo in PDF carousel", id: rootId, imageIds: [plans[0].id, photo!.id] },
            { label: "PDF in photo carousel", id: photoFolder.id, imageIds: [photo!.id, plans[0].id] },
            { label: "malformed PDF selection ID", id: rootId, imageIds: [plans[0].id, "invalid/id"] },
            { label: "malformed photo selection value", id: photoFolder.id, imageIds: [photo!.id, 7] },
            { label: "non-array PDF selection", id: rootId, imageIds: plans[0].id },
            { label: "missing PDF selection", id: rootId, imageIds: [plans[0].id, missingId] },
            { label: "missing photo selection", id: photoFolder.id, imageIds: [photo!.id, missingId] },
          ];
          for (const candidate of rejected) await test.step(candidate.label, async () => {
            await mutateJson(owner.page, "patch", "/api/aesthetics", { action: "carousel", id: candidate.id, imageIds: candidate.imageIds }, [400]);
            const current = await read();
            for (const id of [rootId, grandchild.id]) expect(current.folders.find((folder) => folder.id === id)?.carouselImageIds).toEqual(orderedPlans);
            expect(current.folders.find((folder) => folder.id === photoFolder.id)?.carouselImageIds).toEqual(photoSelection);
          });
        });

        await test.step("Planos root stays protected while empty descendants can be deleted", async () => {
          await mutateJson(owner.page, "patch", "/api/aesthetics", { action: "rename_folder", id: rootId, name: "Must remain Planos" }, [409]);
          await mutateJson(owner.page, "delete", `/api/aesthetics?type=folder&id=${encodeURIComponent(rootId)}`, undefined, [409]);
          await mutateJson(owner.page, "delete", `/api/aesthetics?type=folder&id=${encodeURIComponent(child.id)}`, undefined, [409]);
          await mutateJson(owner.page, "delete", `/api/aesthetics?type=folder&id=${encodeURIComponent(grandchild.id)}`, undefined, [409]);
          expect((await read()).folders.find((folder) => folder.id === rootId)).toMatchObject({ name: "Planos", kind: "plans", parentId: null, carouselImageIds: orderedPlans });
          for (const plan of plans) await mutateJson(owner.page, "delete", `/api/aesthetics?type=image&id=${encodeURIComponent(plan.id)}`);
          const afterFiles = await read();
          expect(afterFiles.images.some((image) => orderedPlans.includes(image.id))).toBe(false);
          for (const id of [rootId, grandchild.id]) expect(afterFiles.folders.find((folder) => folder.id === id)?.carouselImageIds).toEqual([]);
          for (const id of [grandchild.id, sibling.id, child.id, photoFolder.id]) await mutateJson(owner.page, "delete", `/api/aesthetics?type=folder&id=${encodeURIComponent(id)}`);
          const final = await read();
          expect(final.folders.some((folder) => [child.id, grandchild.id, sibling.id, photoFolder.id].includes(folder.id))).toBe(false);
          expect(final.folders.find((folder) => folder.id === rootId)).toMatchObject({ name: "Planos", kind: "plans", parentId: null, carouselImageIds: [] });
          expect(final.images.some((image) => image.id === photo!.id)).toBe(true);
        });
      });
      completed = true;
      return;
    }

    if (suite === "distribution") {
      await test.step("authenticated owner imports and opens a 3D distribution", async () => {
        const blueprint = await upload(owner.page, generated.fixtures.pdf);
        const source = { documentId: blueprint.id, page: 1, sheet: "QA" };
        const model = {
          schemaVersion: 1, name: "QA 3D House", revision: 1,
          sourceDocumentIds: [blueprint.id],
          rooms: [{
            id: "qa-room", name: "QA Room", polygon: [[0, 0], [4, 0], [4, 3], [0, 3]], color: "#4e675b", source,
            height: { value: 2.6, status: "documented", note: "QA ceiling", source },
            sectionHeight: {
              min: { value: 2.7, status: "approximate", note: "QA traced underside minimum", source },
              max: { value: 3.6, status: "approximate", note: "QA traced underside maximum", source },
            },
            finishes: "QA finishes", notes: "Authenticated 3D regression room",
            coverage: { outlet: "reviewed", light: "reviewed", switch: "reviewed", ac: "reviewed" },
          }],
          walls: [], openings: [], fixtures: [], notes: "QA distribution model",
          envelope: {
            source, status: "approximate", notes: "QA section roof",
            faces: [
              { id: "qa-roof-1", kind: "roof", vertices: [[0, 0, 3.05], [4, 0, 3.95], [4, 3, 3.95]] },
              { id: "qa-roof-2", kind: "roof", vertices: [[0, 0, 3.05], [4, 3, 3.95], [0, 3, 3.05]] },
            ],
            roofUnderside: [
              { id: "qa-underside-1", kind: "roof", vertices: [[0, 0, 2.7], [4, 0, 3.6], [4, 3, 3.6]] },
              { id: "qa-underside-2", kind: "roof", vertices: [[0, 0, 2.7], [4, 3, 3.6], [0, 3, 2.7]] },
            ],
            levels: [],
          },
        };
        const imported = await mutateJson<{ record: { revision: number } }>(owner.page, "post", "/api/house-distribution", { model, revision: 0 });
        expect(imported.record.revision).toBe(1);
        expect(await json(await owner.page.request.get("/api/house-distribution?status=1"))).toMatchObject({ ready: true, revision: 1 });
        await owner.page.goto(`/projects/${encodeURIComponent(projectId)}/distribution`, { waitUntil: "domcontentloaded" });
        await waitForProjectReady(owner.page);
        await expect.poll(() => new URL(owner.page.url()).pathname).toBe(`/projects/${encodeURIComponent(projectId)}/distribution`);
        await expect(owner.page.locator(".distribution-workspace")).toBeVisible();
        await expect(owner.page.getByText("QA 3D House", { exact: true })).toBeVisible();
        await expect(owner.page.getByText("QA Room", { exact: true }).first()).toBeVisible();
        await owner.page.getByRole("button", { name: /^QA Room/ }).click();
        await expect(owner.page.getByRole("region", { name: /Height under roof|Altura bajo cubierta/ })).toContainText("2.70 m");
        await expect(owner.page.getByRole("region", { name: /Height under roof|Altura bajo cubierta/ })).toContainText("3.60 m");
        await expect(owner.page.locator(".distribution-scene canvas, .distribution-fallback svg")).toBeVisible();
        if (await owner.page.locator(".distribution-scene canvas").isVisible()) {
          const showInterior = owner.page.getByRole("button", { name: /^(Show interior|Ver interior)$/ });
          await expect(showInterior).toHaveAttribute("aria-pressed", "true");
          await expect(owner.page.locator(".distribution-hint")).toContainText(/Roof underside heights traced|Alturas bajo cubierta trazadas/);
          await showInterior.click();
          const showCompleteHouse = owner.page.getByRole("button", { name: /^(Show complete house|Ver casa completa)$/ });
          await expect(showCompleteHouse).toHaveAttribute("aria-pressed", "false");
          await expect(owner.page.locator(".distribution-hint")).toContainText(/Walls cut down to show the interior layout|Paredes recortadas para mostrar la distribución interior/);
          await showCompleteHouse.click();
          await expect(showInterior).toHaveAttribute("aria-pressed", "true");
          await expect(owner.page.locator(".distribution-hint")).toContainText(/Roof underside heights traced|Alturas bajo cubierta trazadas/);
        }
        await owner.page.reload();
        await waitForProjectReady(owner.page);
        await expect(owner.page.getByText("QA 3D House", { exact: true })).toBeVisible();
        await expect(owner.page.locator(".distribution-scene canvas, .distribution-fallback svg")).toBeVisible();
        if (await owner.page.locator(".distribution-scene canvas").isVisible()) {
          await expect(owner.page.getByRole("button", { name: /^(Show interior|Ver interior)$/ })).toHaveAttribute("aria-pressed", "true");
          await expect(owner.page.locator(".distribution-hint")).toContainText(/Roof underside heights traced|Alturas bajo cubierta trazadas/);
        }
        await owner.page.screenshot({ path: join(artifactDirectory, "distribution-direct-reloaded.png"), fullPage: true });
        const sceneAvailable = await owner.page.locator(".distribution-scene canvas").isVisible();
        await owner.page.locator(".distribution-technical > summary").click();
        const exportButton = owner.page.getByRole("button", { name: /Export for Codex|Exportar para Codex/ });
        await expect(exportButton).toBeVisible();
        const downloadReady = owner.page.waitForEvent("download");
        await exportButton.click();
        const download = await downloadReady;
        expect(download.suggestedFilename()).toBe("qa-3d-house-interiores-codex-r1.zip");
        const zip = await JSZip.loadAsync(await readFile((await download.path())!));
        expect(JSON.parse(await zip.file("modelo.json")!.async("string"))).toMatchObject(model);
        expect(await expectDistributionExportImages(zip, 1, sceneAvailable)).toMatchObject({ modelRevision: 1, recordRevision: 1 });
        expect(JSON.parse(await zip.file("fuentes.json")!.async("string")).sourceDocumentIds).toEqual([blueprint.id]);
        const heightRows = JSON.parse(await zip.file("medidas.json")!.async("string")).measurements;
        expect(heightRows.find((row: { entityId: string; measurement: string }) => row.entityId === "qa-room" && row.measurement === "minSectionHeight")).toMatchObject({ value: 2.7, status: "approximate", documentId: blueprint.id });
        expect(heightRows.find((row: { entityId: string; measurement: string }) => row.entityId === "qa-room" && row.measurement === "maxSectionHeight")).toMatchObject({ value: 3.6, status: "approximate", documentId: blueprint.id });
        await expect(owner.page.getByRole("status").filter({ hasText: /Package prepared|Paquete preparado/ })).toBeVisible();
      });
      completed = true;
      return;
    }

    if (suite === "notes") {
      await test.step("authenticated owner creates and reads a private project note", async () => {
        await owner.page.reload();
        await waitForProjectReady(owner.page);
        await openSection(owner.page, "Notes", "Notas");
        await expect(owner.page.locator(".notes-workspace")).toBeVisible();
        await owner.page.getByRole("button", { name: /New note|Nueva nota/ }).click();
        await owner.page.getByLabel(/^(Title|Título)$/).fill("QA private note");
        await owner.page.getByLabel(/Information or note|Información o nota/).fill("Saved through the authenticated Notes browser workflow.");
        await owner.page.getByLabel(/Allow the AI to consult this note|Permitir que la IA consulte esta nota/).check();
        await owner.page.getByRole("button", { name: /Save note|Guardar nota/ }).click();
        await expect(owner.page.getByText("QA private note", { exact: true })).toBeVisible();
        const payload = await json<{ notes: Array<{ title: string; content: string; aiEnabled: boolean }> }>(await owner.page.request.get("/api/notes"));
        expect(payload.notes).toEqual([expect.objectContaining({ title: "QA private note", content: "Saved through the authenticated Notes browser workflow.", aiEnabled: true })]);
      });
      completed = true;
      return;
    }

    await test.step("workbook, expenses source, and responsive navigation", async () => {
      const workbookResponse = await guarded(owner.page, ownerEmail, () => owner.page.request.post("/api/workbook/file", {
        multipart: { file: { name: generated.fixtures.workbook.name, mimeType: generated.fixtures.workbook.mimeType, buffer: generated.fixtures.workbook.buffer } },
        failOnStatusCode: false,
      }));
      await json(workbookResponse, [200]);
      const officialWorkbookResponse = await owner.page.request.get("/api/workbook/file");
      expect(officialWorkbookResponse.status()).toBe(200);
      const officialBytes = await officialWorkbookResponse.body();
      expect(officialBytes.length).toBeGreaterThan(1_000);
      const officialWorkbook = new ExcelJS.Workbook();
      await officialWorkbook.xlsx.load(Buffer.from(officialBytes) as never);
      const officialSheet = officialWorkbook.getWorksheet("Presupuesto");
      expect(officialSheet?.rowCount).toBeGreaterThanOrEqual(6);
      expect(officialSheet?.getCell("F3").value).toBe("Exceso sobre objetivo");
      expect(String(officialSheet?.getCell("F4").formula || "")).toContain("MAX(0");
      // Google exports effective formats on cells rather than column defaults.
      for (const column of [5, 6, 7, 8, 10, 12]) {
        expect(officialSheet?.getCell(4, column).numFmt).toContain("₡");
        expect(officialSheet?.getCell(4, column).numFmt).toContain("#,##0");
      }
      expect(officialSheet?.getCell("I4").value).toBe("Pendiente");
      expect(officialSheet?.getCell("I4").dataValidation.type).toBe("list");
      expect(officialSheet?.getCell("I4").dataValidation.allowBlank).not.toBe(true);
      expect(officialSheet?.getCell("I2").value).toMatchObject({ result: "✓ 1 completada" });
      expect(officialSheet?.getCell("K2").value).toMatchObject({ result: "◐ 1 en progreso" });
      expect(officialSheet?.getCell("M2").value).toMatchObject({ result: "○ 1 pendiente" });
      const budget = await json<{ lines: Array<{ id: string; item: string; paid: number; status: string; excess: number }>; objective: number; excess: number; maximum?: number; spent: number }>(await owner.page.request.get("/api/budget"));
      expect(budget.lines).toHaveLength(3);
      expect(budget.objective).toBe(2400);
      expect(budget.excess).toBe(0);
      expect(budget.maximum).toBeUndefined();
      const expectedWorkbookSpent = suite === "expenses" ? 1700 : 1000;
      expect(budget.spent).toBe(expectedWorkbookSpent);
      expect(budget.lines.map((line) => [line.item, line.status])).toEqual([
        ["QA Completed concrete", "Pendiente"],
        ["QA In progress tile", "Completada"],
        ["QA Pending plants", "En progreso"],
      ]);
      const expenses = await json<{ budgetLines: Array<{ paid: number }> }>(await owner.page.request.get("/api/expenses"));
      expect(expenses.budgetLines.filter((line) => line.paid > 0)).toHaveLength(suite === "expenses" ? 2 : 1);
      await owner.page.reload();
      await waitForProjectReady(owner.page);
      await verifyNavigation(owner.page);
      if (suite === "expenses") await test.step("shared section and budget category URLs survive reload and browser history", async () => {
        await verifyShareableBudgetRoutes(owner.page);
      });
      if (suite === "expenses") await test.step("read links automatically grant viewer access and enforce live policies and revocation", async () => {
        await verifyReadAccessLink(browser, owner.page);
      });
      if (suite === "expenses") await test.step("budget-line outside-objective flag survives publication and keeps amounts and receipts", async () => {
        await openBudgetDashboard(owner.page);
        const original = await json<{ objective: number; spent: number; outsideObjective: { CRC: number }; lines: Array<{ id: string; item: string; paid: number; objective: number; outsideObjective?: boolean }> }>(await owner.page.request.get("/api/budget"));
        const line = original.lines.find((item) => item.item === "QA Completed concrete")!;
        for (const outside of [true, false]) {
          await openBudgetDashboard(owner.page);
          await owner.page.locator(".budget-line-list button").filter({ hasText: line.item }).click();
          const toggle = owner.page.getByRole("checkbox", { name: new RegExp(`${line.item} (Outside objective|Fuera de objetivo)`) });
          await toggle.setChecked(outside);
          await owner.page.getByRole("button", { name: /^(Save|Guardar)$/ }).click();
          await expect.poll(async () => {
            const current = await json<typeof original>(await owner.page.request.get("/api/budget"));
            return current.lines.find((item) => item.id === line.id)?.outsideObjective;
          }).toBe(outside);
          const current = await json<typeof original>(await owner.page.request.get("/api/budget"));
          expect(current.objective).toBe(original.objective - (outside ? line.objective : 0));
          expect(current.spent).toBe(original.spent - (outside ? line.paid : 0));
          expect(current.outsideObjective.CRC).toBe(original.outsideObjective.CRC + (outside ? line.paid : 0));
          expect(current.lines.find((item) => item.id === line.id)?.paid).toBe(line.paid);
          await owner.page.reload(); await waitForProjectReady(owner.page);
          await openSection(owner.page, "Budget", "Presupuesto");
        }
      });
      await test.step("receipts are uploaded independently and reused by unassigned, partial, and settlement payments", async () => {
        type Payment = { id: string; budgetLineId: string | null; purchaseId: string | null; amount: number; payee: string; documentIds: string[]; accountingMode: string; paymentKind: string };
        type Document = { id: string; title: string; amount: number | null; purchaseId: string | null; budgetLineId: string | null; budgetLineIds: string[]; paymentIds: string[]; paymentCount: number; files: Array<{ id: string }> };
        type BudgetState = { spent: number; lines: Array<{ id: string; item: string; paid: number; status: string }> };
        const baseline = await json<BudgetState>(await owner.page.request.get("/api/budget"));
        const unpaidLine = baseline.lines.find((item) => item.item === "QA Pending plants")!;
        expect(unpaidLine.paid).toBe(0);
        const receiptTitle = runId + " independent receipt bundle";
        const payrollTitle = runId + " payroll receipt";
        const purchaseTitle = runId + " agreed purchase";
        const unassignedTitle = runId + " unassigned payment";
        const partialTitle = runId + " purchase deposit";
        const settlementTitle = runId + " purchase settlement";
        const documents = async () => (await json<{ documents: Document[] }>(await owner.page.request.get("/api/expenses/documents"))).documents;
        const payments = async () => (await json<{ payments: Payment[] }>(await owner.page.request.get("/api/expenses/payments"))).payments;
        const selectReceipt = async (form: Locator, title: string) => {
          const picker = form.getByRole("region", { name: /Existing documents|Existing receipts|Comprobantes existentes/ });
          if (!(await picker.isVisible())) await form.getByRole("button", { name: /Choose existing receipts|Elegir comprobantes existentes/ }).click();
          const option = picker.getByRole("button", { name: title, exact: true });
          await option.click();
          await expect(option).toHaveAttribute("aria-pressed", "true");
        };

        await openSection(owner.page, "Purchases/Expenses", "Compras/Gastos");
        await owner.page.getByRole("button", { name: /^(Upload receipts|Subir comprobantes)$/ }).click();
        const documentForm = owner.page.locator(".expense-form");
        await documentForm.getByLabel(/Description.*optional|Descripción.*opcional/).fill(receiptTitle);
        await expect(documentForm.getByLabel(/Amount.*optional|Monto.*opcional/)).toHaveCount(0);
        await expect(documentForm.getByRole("combobox", { name: /Budget line|Partida|Related purchase|Compra relacionada/ })).toHaveCount(0);
        await documentForm.locator('input[type="file"]').setInputFiles([
          { name: runId + "-invoice.png", mimeType: generated.fixtures.image.mimeType, buffer: generated.fixtures.image.buffer },
          { name: runId + "-invoice.pdf", mimeType: generated.fixtures.pdf.mimeType, buffer: generated.fixtures.pdf.buffer },
        ]);
        await documentForm.getByRole("button", { name: /Save document|Guardar comprobante/ }).click();
        await expect(owner.page.getByRole("heading", { name: receiptTitle })).toBeVisible({ timeout: 30_000 });
        const receipt = (await documents()).find((item) => item.title === receiptTitle)!;
        expect(receipt).toMatchObject({ amount: null, purchaseId: null, budgetLineId: null, budgetLineIds: [], paymentIds: [], paymentCount: 0 });
        expect(receipt.files).toHaveLength(2);
        await expect(owner.page.locator(".document-card").filter({ hasText: receiptTitle })).toContainText(/Pending link|Pending to link|Pendiente de vincular/);

        const payrollResponse = await guarded(owner.page, ownerEmail, () => owner.page.request.post("/api/expenses/documents", { multipart: {
          title: payrollTitle, documentType: "payroll",
          file: { name: runId + "-payroll.pdf", mimeType: generated.fixtures.pdf.mimeType, buffer: generated.fixtures.pdf.buffer },
        }, failOnStatusCode: false }));
        const payrollCreated = await json<{ id: string }>(payrollResponse, [201]);
        const payroll = (await documents()).find((item) => item.id === payrollCreated.id)!;
        expect(payroll).toMatchObject({ amount: null, budgetLineId: null, paymentCount: 0 });
        const regularFiles = await json<{ documents: Array<{ id: string }> }>(await owner.page.request.get("/api/files"));
        expect(regularFiles.documents.some((file) => [...receipt.files, ...payroll.files].some((item) => item.id === file.id))).toBe(false);
        expect((await owner.page.request.get("/api/files?id=" + encodeURIComponent(payroll.files[0].id) + "&preview=pdf")).status()).toBe(200);
        expect((await json<BudgetState>(await owner.page.request.get("/api/budget"))).spent).toBe(baseline.spent);

        // A total agreed for a purchase is separate from the actual payments.
        await owner.page.locator(".expense-tabs").getByRole("button", { name: /Products|Productos/ }).click();
        await owner.page.getByRole("button", { name: /New purchase|Nueva compra/ }).click();
        const purchaseForm = owner.page.locator(".expense-form");
        await purchaseForm.getByLabel(/Description.*optional|Descripción.*opcional/).fill(purchaseTitle);
        await purchaseForm.getByLabel(/Amount.*optional|Monto.*opcional/).fill("900");
        await purchaseForm.getByRole("button", { name: /Save purchase|Guardar compra/ }).click();
        const purchaseCard = owner.page.locator(".purchase-card").filter({ hasText: purchaseTitle });
        await expect(purchaseCard).toBeVisible();
        const purchasePayload = await json<{ purchases: Array<{ id: string; title: string; amount: number; budgetLineId: string | null }> }>(await owner.page.request.get("/api/expenses/purchases"));
        const purchase = purchasePayload.purchases.find((item) => item.title === purchaseTitle)!;
        expect(purchase).toMatchObject({ amount: 900, budgetLineId: null });
        expect((await json<BudgetState>(await owner.page.request.get("/api/budget"))).spent).toBe(baseline.spent);

        await owner.page.getByRole("button", { name: /^(Record payment|Register payment|Registrar pago)$/ }).first().click();
        const unassignedForm = owner.page.locator(".payment-form");
        await unassignedForm.getByLabel(/Amount paid|Monto pagado/).fill("100");
        await unassignedForm.getByLabel(/Description|Descripción/).fill(unassignedTitle);
        await expect(unassignedForm.getByRole("combobox", { name: /Budget line.*optional|Partida.*opcional/ })).toHaveValue("");
        await selectReceipt(unassignedForm, receiptTitle);
        await selectReceipt(unassignedForm, payrollTitle);
        await unassignedForm.getByRole("button", { name: /Save payment|Guardar pago/ }).click();
        await expect(unassignedForm).toHaveCount(0);
        const unassigned = (await payments()).find((item) => item.payee === unassignedTitle)!;
        expect(unassigned).toMatchObject({ amount: 100, budgetLineId: null, purchaseId: null, accountingMode: "ledger" });
        expect(unassigned.documentIds.sort()).toEqual([receipt.id, payroll.id].sort());
        expect((await json<BudgetState>(await owner.page.request.get("/api/budget"))).spent).toBe(baseline.spent);

        await owner.page.locator(".expense-tabs").getByRole("button", { name: /Products|Productos/ }).click();
        await purchaseCard.getByRole("button", { name: /Record installment|Register installment|Register partial payment|Registrar abono/ }).click();
        const partialForm = owner.page.locator(".payment-form");
        await partialForm.getByLabel(/Amount paid|Monto pagado/).fill("300");
        await partialForm.getByLabel(/Description|Descripción/).fill(partialTitle);
        await partialForm.getByRole("combobox", { name: /Budget line.*optional|Partida.*opcional/ }).selectOption(unpaidLine.id);
        await selectReceipt(partialForm, receiptTitle);
        await partialForm.getByRole("button", { name: /Save payment|Guardar pago/ }).click();
        await expect(partialForm).toHaveCount(0);
        const partial = (await payments()).find((item) => item.payee === partialTitle)!;
        expect(partial).toMatchObject({ purchaseId: purchase.id, budgetLineId: unpaidLine.id, amount: 300, paymentKind: "partial", accountingMode: "ledger", documentIds: [receipt.id] });
        const afterPartial = await json<BudgetState>(await owner.page.request.get("/api/budget"));
        expect(afterPartial.spent).toBe(baseline.spent + 300);
        expect(afterPartial.lines.find((item) => item.id === unpaidLine.id)).toMatchObject({ paid: 300, status: unpaidLine.status });

        const invalidSettlement = await guarded(owner.page, ownerEmail, () => owner.page.request.post("/api/expenses/payments", {
          data: { purchaseId: purchase.id, budgetLineId: unpaidLine.id, amount: 1, paymentKind: "settlement", documentIds: [receipt.id] }, failOnStatusCode: false,
        }));
        expect(invalidSettlement.status()).toBe(409);
        expect((await payments()).filter((item) => item.purchaseId === purchase.id)).toHaveLength(1);
        await owner.page.locator(".expense-tabs").getByRole("button", { name: /Products|Productos/ }).click();
        await purchaseCard.getByRole("button", { name: /Pay balance|Pagar saldo/ }).click();
        const settlementForm = owner.page.locator(".payment-form");
        await expect(settlementForm.getByLabel(/Amount paid|Monto pagado/)).toHaveValue("600");
        await settlementForm.getByLabel(/Description|Descripción/).fill(settlementTitle);
        await settlementForm.getByRole("combobox", { name: /Budget line.*optional|Partida.*opcional/ }).selectOption(unpaidLine.id);
        await selectReceipt(settlementForm, receiptTitle);
        await selectReceipt(settlementForm, payrollTitle);
        await settlementForm.getByRole("button", { name: /Save payment|Guardar pago/ }).click();
        await expect(settlementForm).toHaveCount(0);
        const settlement = (await payments()).find((item) => item.payee === settlementTitle)!;
        expect(settlement).toMatchObject({ purchaseId: purchase.id, budgetLineId: unpaidLine.id, amount: 600, paymentKind: "settlement", accountingMode: "ledger" });
        expect(settlement.documentIds.sort()).toEqual([receipt.id, payroll.id].sort());
        const afterSettlement = await json<BudgetState>(await owner.page.request.get("/api/budget"));
        expect(afterSettlement.spent).toBe(baseline.spent + 900);
        expect(afterSettlement.lines.find((item) => item.id === unpaidLine.id)).toMatchObject({ paid: 900, status: unpaidLine.status });
        expect((await documents()).find((item) => item.id === receipt.id)).toMatchObject({ paymentCount: 3, paymentIds: expect.arrayContaining([unassigned.id, partial.id, settlement.id]), budgetLineIds: [] });
        expect((await documents()).find((item) => item.id === payroll.id)).toMatchObject({ paymentCount: 2 });
        const overpayment = await guarded(owner.page, ownerEmail, () => owner.page.request.post("/api/expenses/payments", {
          data: { purchaseId: purchase.id, amount: 1, paymentKind: "partial" }, failOnStatusCode: false,
        }));
        expect(overpayment.status()).toBe(409);
        expect((await payments()).filter((item) => item.purchaseId === purchase.id)).toHaveLength(2);
        expect((await guarded(owner.page, ownerEmail, () => owner.page.request.delete("/api/expenses/documents?id=" + encodeURIComponent(receipt.id), { failOnStatusCode: false }))).status()).toBe(409);

        await test.step("Excel exports payment identities and repeated round trips neither duplicate nor add them twice", async () => {
          const expectedPayments = [unassigned, partial, settlement].map((item) => ({ id: item.id, amount: item.amount, budgetLineId: item.budgetLineId, purchaseId: item.purchaseId, documentIds: [...item.documentIds].sort() })).sort((a, b) => a.id.localeCompare(b.id));
          for (let pass = 0; pass < 2; pass++) {
            // Each copy carries the current workbook generation; re-download after importing.
            const downloaded = await owner.page.request.get("/api/workbook/file");
            expect(downloaded.status()).toBe(200);
            const bytes = await downloaded.body();
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(Buffer.from(bytes) as never);
            const ledger = workbook.getWorksheet("Pagos");
            expect(ledger, "The offline workbook includes the actual payment history").toBeDefined();
            const ledgerValues: string[] = [];
            ledger!.eachRow((row) => row.eachCell((cell) => ledgerValues.push(cell.text)));
            for (const item of expectedPayments) expect(ledgerValues).toContain(item.id);
            const uploaded = await guarded(owner.page, ownerEmail, () => owner.page.request.post("/api/workbook/file", {
              multipart: { file: { name: "QA-payments-roundtrip-" + pass + ".xlsx", mimeType: generated.fixtures.workbook.mimeType, buffer: bytes } }, failOnStatusCode: false,
            }));
            await json(uploaded);
            const currentPayments = (await payments()).filter((item) => expectedPayments.some((expected) => expected.id === item.id));
            expect(currentPayments.map((item) => ({ id: item.id, amount: item.amount, budgetLineId: item.budgetLineId, purchaseId: item.purchaseId, documentIds: [...item.documentIds].sort() })).sort((a, b) => a.id.localeCompare(b.id))).toEqual(expectedPayments);
            expect((await payments()).filter((item) => [unassignedTitle, partialTitle, settlementTitle].includes(item.payee))).toHaveLength(3);
            const currentBudget = await json<BudgetState>(await owner.page.request.get("/api/budget"));
            expect(currentBudget.spent).toBe(afterSettlement.spent);
            expect(currentBudget.lines.find((item) => item.id === unpaidLine.id)).toMatchObject({ paid: 900, status: unpaidLine.status });
          }
        });

        await owner.page.setViewportSize({ width: 390, height: 844 });
        await owner.page.reload(); await waitForProjectReady(owner.page);
        await openSection(owner.page, "Purchases/Expenses", "Compras/Gastos");
        await expect(owner.page.getByRole("button", { name: /^(Record payment|Register payment|Registrar pago)$/ }).first()).toBeVisible();
        await expect.poll(() => owner.page.locator(".expenses-page").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        await owner.page.locator(".expense-tabs").getByRole("button", { name: /Payments|Pagos/ }).click();
        await expect(owner.page.locator(".payment-ledger").filter({ hasText: unassignedTitle })).toContainText(/Unassigned|Sin asignar/);
        await owner.page.setViewportSize({ width: 1280, height: 900 });

        // Remove payments while retaining their independent source receipts.
        for (const payment of [unassigned, partial, settlement]) await mutateJson(owner.page, "delete", "/api/expenses/payments?id=" + encodeURIComponent(payment.id));
        expect((await json<BudgetState>(await owner.page.request.get("/api/budget"))).spent).toBe(baseline.spent);
        for (const id of [receipt.id, payroll.id]) expect((await documents()).find((item) => item.id === id)).toMatchObject({ paymentCount: 0, paymentIds: [] });
        await mutateJson(owner.page, "delete", "/api/expenses/purchases?id=" + encodeURIComponent(purchase.id));
        for (const id of [receipt.id, payroll.id]) await mutateJson(owner.page, "delete", "/api/expenses/documents?id=" + encodeURIComponent(id));
        expect((await documents()).some((item) => [receipt.id, payroll.id].includes(item.id))).toBe(false);
        await owner.page.reload(); await waitForProjectReady(owner.page);
        await openSection(owner.page, "Budget", "Presupuesto");
        test.info().annotations.push({ type: "AI calls", description: "0" });
      });
      await openSection(owner.page, "Budget", "Presupuesto");
      await expect(owner.page.getByText(/Excess over objective|Exceso sobre objetivo/, { exact: true }).first()).toBeVisible();
      await expect(owner.page.getByText(/Maximum|Máximo/, { exact: true })).toHaveCount(0);
      await owner.page.getByRole("button", { name: /Edit budget|Editar presupuesto/ }).click();
      await expect(owner.page.locator(".budget-table-editor")).toBeVisible({ timeout: 30_000 });
      const noteField = owner.page.getByRole("textbox", { name: /QA Completed concrete (Supplier \/ note|Proveedor \/ nota)/ });
      await expect(noteField).toHaveAttribute("rows", "3");
      await expect(noteField).toHaveValue("QA Supplier");
      const editorBox = await owner.page.locator(".budget-table-editor").boundingBox();
      expect(editorBox?.width).toBeGreaterThan(100);
    });

    if (suite === "expenses") {
      await test.step("plan PDFs are optional carousel items", async () => {
        const before = await json<{ folders: Array<{ id: string; name: string; kind: string; parentId: string | null; carouselImageIds: string[] }> }>(await owner.page.request.get("/api/aesthetics"));
        const plansFolder = before.folders.find((folder) => folder.kind === "plans" && folder.name === "Planos" && folder.parentId === null);
        expect(plansFolder).toMatchObject({ name: "Planos", carouselImageIds: [] });
        const planName = `${runId}-kitchen-plan.pdf`;
        const uploaded = await guarded(owner.page, ownerEmail, () => owner.page.request.post("/api/aesthetics", {
          multipart: { folderId: plansFolder!.id, file: { name: planName, mimeType: generated.fixtures.pdf.mimeType, buffer: generated.fixtures.pdf.buffer } },
          failOnStatusCode: false,
        }));
        const plan = await json<{ image: { id: string; mediaType: string; contentType: string; imageUrl: string } }>(uploaded, [201]);
        expect(plan.image).toMatchObject({ mediaType: "pdf", contentType: "application/pdf" });
        expect((await owner.page.request.get(plan.image.imageUrl)).status()).toBe(200);
        const afterUpload = await json<{ folders: Array<{ id: string; carouselImageIds: string[] }> }>(await owner.page.request.get("/api/aesthetics"));
        expect(afterUpload.folders.find((folder) => folder.id === plansFolder!.id)?.carouselImageIds).toEqual([]);

        await owner.page.reload();
        await waitForProjectReady(owner.page);
        await openSection(owner.page, "Aesthetics", "Estética");
        await owner.page.locator(".aesthetic-folder-strip").getByRole("button", { name: /Planos/ }).click();
        const planCard = owner.page.locator(".aesthetic-grid article").filter({ hasText: planName });
        await expect(planCard).toBeVisible();
        await planCard.getByRole("button", { name: /Show in carousel|Mostrar en carrusel/ }).click();
        const carouselPdf = owner.page.locator(".aesthetic-pdf-stage");
        await expect(carouselPdf.locator("iframe")).toBeVisible({ timeout: 30_000 });
        await expectPlanPdfFillsPreview(carouselPdf.locator(".aesthetic-pdf-preview"), true);
        await expect(carouselPdf.getByRole("toolbar", { name: /PDF zoom controls|Controles de zoom del PDF/ })).toBeVisible();
        await expect(carouselPdf.locator("iframe")).toHaveAttribute("src", /#zoom=100$/);
        await carouselPdf.getByRole("button", { name: /Zoom in|Acercar/ }).click();
        await expect(carouselPdf.locator("iframe")).toHaveAttribute("src", /#zoom=125$/);
        await expectPlanPdfFillsPreview(carouselPdf.locator(".aesthetic-pdf-preview"), true);
        await carouselPdf.getByRole("button", { name: /Open plan|Abrir plano/ }).click();
        const planViewer = owner.page.getByRole("dialog", { name: planName });
        await expect(planViewer).toBeVisible();
        await expectPlanPdfFillsPreview(planViewer.locator(".aesthetic-pdf-preview"), false);
        await planViewer.getByRole("button", { name: /Zoom in|Acercar/ }).click();
        await expect(planViewer.locator("iframe")).toHaveAttribute("src", /#zoom=125$/);
        await planViewer.locator(".close").click();
        await expect(planViewer).toHaveCount(0);
        await expectPlanPdfFillsPreview(carouselPdf.locator(".aesthetic-pdf-preview"), true);
        await expect(owner.page.locator(".aesthetic-thumbnail-card")).toHaveCount(1);
        await expect.poll(async () => {
          const current = await json<{ folders: Array<{ id: string; carouselImageIds: string[] }> }>(await owner.page.request.get("/api/aesthetics"));
          return current.folders.find((folder) => folder.id === plansFolder!.id)?.carouselImageIds;
        }).toEqual([plan.image.id]);

        await owner.page.setViewportSize({ width: 390, height: 844 });
        await expectPlanPdfFillsPreview(carouselPdf.locator(".aesthetic-pdf-preview"), true);
        const dimensions = await owner.page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
        expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
        await owner.page.setViewportSize({ width: 1280, height: 900 });

        await planCard.getByRole("button", { name: new RegExp(`(?:Delete|Eliminar) ${planName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).click();
        const deleteDialog = owner.page.getByRole("alertdialog", { name: /Delete PDF|Eliminar PDF/ });
        await expect(deleteDialog).toBeVisible();
        await deleteDialog.getByRole("button", { name: /Delete|Eliminar/, exact: true }).click();
        await expect(planCard).toHaveCount(0);
        const afterDelete = await json<{ images: Array<{ id: string }> }>(await owner.page.request.get("/api/aesthetics"));
        expect(afterDelete.images.some((image) => image.id === plan.image.id)).toBe(false);
      });
      completed = true;
      return;
    }

    await test.step("authenticated basic editing saves, survives reload, and recovers from an empty response", async () => {
      const amount = () => owner.page.getByRole("spinbutton", { name: /QA Completed concrete (Objective|Objetivo)/ });
      const save = async () => {
        await guard(owner.page, ownerEmail, "admin");
        const published = owner.page.waitForResponse((response) => response.url().endsWith("/api/workbook/drafts") && response.request().method() === "POST" && response.request().postDataJSON()?.action === "publish");
        await owner.page.getByRole("button", { name: /^(Save|Guardar)$/ }).click();
        const response = await published;
        expect(response.headers()["content-type"]).toContain("application/json");
        expect(response.status(), await response.text()).toBe(200);
        expect((await response.json()).googleSynced).toBe(liveGoogleEnabled);
        await expect(owner.page.getByText(/Published · ready to continue editing|Publicado · listo para continuar editando/)).toBeVisible();
      };
      const storedAmount = async () => (await json<{lines:Array<{item:string;objective:number}>}>(await owner.page.request.get("/api/budget"))).lines.find((line) => line.item === "QA Completed concrete")?.objective;
      await guarded(owner.page, ownerEmail, () => amount().fill("1123"));
      await save();
      await expect.poll(storedAmount).toBe(1123);
      if (liveGoogleEnabled) {
        const googleRead = await guarded(owner.page, ownerEmail, () => owner.page.request.post("/api/google-sheets", { data: { action: "use-google" } }));
        expect(googleRead.status(), await googleRead.text()).toBe(200);
      }
      await expect.poll(storedAmount).toBe(1123);
      await owner.page.reload();
      await waitForProjectReady(owner.page);
      await openSection(owner.page, "Budget", "Presupuesto");
      if (!new URL(owner.page.url()).pathname.includes("/budget/")) {
        await owner.page.getByRole("button", { name: /Edit budget|Editar presupuesto/ }).click();
      }
      await expect(amount()).toHaveValue("1123");

      await guarded(owner.page, ownerEmail, () => amount().fill("1000"));
      let interrupted = false;
      await owner.page.route("**/api/workbook/drafts", async (route) => {
        if (!interrupted && route.request().method() === "POST" && route.request().postDataJSON()?.action === "publish") {
          interrupted = true;
          await route.fulfill({status:500,body:""});
        } else await route.continue();
      });
      await owner.page.getByRole("button", { name: /^(Save|Guardar)$/ }).click();
      await expect(owner.page.getByText(/Tus cambios siguen en la pantalla/)).toBeVisible();
      await expect(amount()).toHaveValue("1000");
      await expect(amount()).toBeEnabled();
      await owner.page.unroute("**/api/workbook/drafts");
      await save();
      await expect.poll(storedAmount).toBe(1000);

      const rowName = `${runId} UI added item`;
      await owner.page.getByRole("button", {name:/^(Add item|Agregar partida)$/}).click();
      await owner.page.locator("form.budget-add-form").getByLabel(/^(Item|Partida)$/).fill(rowName);
      await owner.page.getByRole("button", {name:/^(Create item|Crear partida)$/}).click();
      await save();
      const rowExists = async () => (await json<{lines:Array<{item:string}>}>(await owner.page.request.get("/api/budget"))).lines.some((line)=>line.item===rowName);
      await expect.poll(rowExists).toBe(true);
      await owner.page.getByRole("button", {name:new RegExp(`^(Remove|Quitar) ${rowName}$`)}).click();
      await save();
      await expect.poll(rowExists).toBe(false);
      const connection = await json<{configured:boolean;connected:boolean;managed:boolean;url:string}>(await owner.page.request.get("/api/google-sheets"));
      if (liveGoogleEnabled) {
        expect(connection).toMatchObject({configured:true,connected:true,managed:true});
        expect(connection.url).toMatch(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9_-]+\/edit$/);
      } else {
        expect(connection).toMatchObject({configured:false,connected:false,managed:false,url:""});
        test.info().annotations.push({type:"Live integration omitted",description:"Google Sheets/Drive OAuth is not configured in isolated QA. Local unit and mocked browser tests cover synchronization logic."});
      }
      await owner.page.getByRole("button", {name:/Dashboard|Panel/}).click();
    });

    await test.step("offline copied rows receive unique identities without moving existing links", async () => {
      const budget = await json<{lines:Array<{id:string;item:string;chapter:string}>}>(await owner.page.request.get("/api/budget"));
      const original = budget.lines.find(line => line.item === "QA Completed concrete")!;
      const originalId = original.id;
      const copyName = `${runId} Copied item`;
      const renamedCategory = `${runId} Renamed category`, addedCategory = `${runId} New category`;
      const editFile = async (remove: boolean) => {
        const download = await owner.page.request.get("/api/workbook/file");
        expect(download.status()).toBe(200);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(Buffer.from(await download.body()) as never);
        // Excel/Sheets translates shared formulas when deleting their master
        // row. ExcelJS spliceRows requires those formulas expanded first.
        for (const tab of workbook.worksheets) {
          const formulas: Array<{cell: ExcelJS.Cell; formula: string; result: ExcelJS.CellFormulaValue["result"]}> = [];
          tab.eachRow(row => row.eachCell(cell => { if (cell.formula) formulas.push({cell, formula: cell.formula, result: cell.result}); }));
          for (const {cell, formula, result} of formulas) cell.value = {formula, result};
        }
        const sheet = workbook.getWorksheet("Presupuesto")!;
        if (remove) {
          let copiedRow = 0;
          sheet.eachRow((row, index) => { if (row.getCell(2).text === copyName) copiedRow = index; });
          expect(copiedRow).toBeGreaterThan(0);
          sheet.spliceRows(copiedRow, 1);
          sheet.eachRow(row => { if (row.getCell(1).text === renamedCategory) row.getCell(1).value = original.chapter; });
        } else {
          sheet.insertRow(4, sheet.getRow(4).values);
          sheet.getCell("B4").value = copyName;
          sheet.eachRow(row => { if (row.getCell(1).text === original.chapter) row.getCell(1).value = renamedCategory; });
          sheet.getCell("A4").value = addedCategory;
        }
        const workbookBytes = await workbook.xlsx.writeBuffer();
        const uploaded = await guarded(owner.page, ownerEmail, () => owner.page.request.post("/api/workbook/file", {
          multipart: { file: { name: "QA-offline-copy.xlsx", mimeType: generated.fixtures.workbook.mimeType, buffer: Buffer.from(workbookBytes) } }, failOnStatusCode: false,
        }));
        expect((await json<{googleSynced:boolean}>(uploaded)).googleSynced).toBe(liveGoogleEnabled);
      };
      await editFile(false);
      const copied = await json<{lines:Array<{id:string;item:string;chapter:string}>;summaries:{chapter:Array<{label:string}>}}>(await owner.page.request.get("/api/budget"));
      expect(copied.lines.find(line => line.item === "QA Completed concrete")?.id).toBe(originalId);
      expect(copied.lines.find(line => line.item === "QA Completed concrete")?.chapter).toBe(renamedCategory);
      expect(copied.summaries.chapter.map(group => group.label)).toEqual(expect.arrayContaining([renamedCategory, addedCategory]));
      expect(copied.lines.find(line => line.item === copyName)?.id).toBeTruthy();
      expect(copied.lines.find(line => line.item === copyName)?.id).not.toBe(originalId);
      await editFile(true);
      const restored = await json<{lines:Array<{id:string;item:string}>}>(await owner.page.request.get("/api/budget"));
      expect(restored.lines).toHaveLength(budget.lines.length);
      expect(restored.lines.find(line => line.item === "QA Completed concrete")?.id).toBe(originalId);
    });

    await test.step("documents, invoice receipt, and local text indexing", async () => {
      const folders = await json<{ folders: Array<{ id: string; name: string }> }>(await owner.page.request.get("/api/folders"));
      const invoice = folders.folders.find((folder) => folder.name.toLocaleLowerCase() === "factura");
      expect(invoice).toBeUndefined();
      referenceFolderId = (await mutateJson<{ folder: { id: string } }>(owner.page, "post", "/api/folders", { name: `${runId} References`, parentId: null }, [201])).folder.id;
      pdfDocumentId = (await upload(owner.page, generated.fixtures.pdf, referenceFolderId)).id;
      receiptDocumentId = (await uploadInvoice(owner.page, generated.fixtures.image)).document.id;
      const documents = await json<{ documents: Array<{ id: string; quoteReferenceEnabled: boolean }> }>(await owner.page.request.get("/api/files"));
      expect(documents.documents.some((document) => document.id === receiptDocumentId)).toBe(false);
      expect(documents.documents.find((document) => document.id === pdfDocumentId)?.quoteReferenceEnabled).toBe(false);
      const invoices = await json<{ documents: Array<{ id: string }> }>(await owner.page.request.get("/api/expenses/files"));
      expect(invoices.documents.some((document) => document.id === receiptDocumentId)).toBe(true);
      expect((await owner.page.request.get(`/api/files?id=${encodeURIComponent(pdfDocumentId)}&preview=pdf`)).status()).toBe(200);
      expect((await owner.page.request.get(`/api/files?id=${encodeURIComponent(receiptDocumentId)}&preview=image`)).status()).toBe(200);
      await owner.page.reload();
      await waitForProjectReady(owner.page);
      await openSection(owner.page, "Documents", "Documentos");
      await owner.page.getByText(`${runId} References`, { exact: true }).click();
      const referenceFolderPath = `/projects/${encodeURIComponent(projectId)}/documents/folder/${encodeURIComponent(referenceFolderId)}`;
      await expect.poll(() => new URL(owner.page.url()).pathname).toBe(referenceFolderPath);
      const referenceRow = owner.page.locator(".doc-row").filter({ hasText: generated.fixtures.pdf.name });
      await expect(referenceRow).toBeVisible();
      await owner.page.reload();
      await waitForProjectReady(owner.page);
      await expect(owner.page.locator(".topbar h1")).toHaveText(/^(Documents|Documentos)$/);
      await expect.poll(() => new URL(owner.page.url()).pathname).toBe(referenceFolderPath);
      await expect(owner.page.locator(".folder-breadcrumb button.current")).toHaveText(`${runId} References`);
      await expect(referenceRow).toBeVisible();
      const quoteReferenceToggle = referenceRow.getByRole("checkbox", { name: /Use .* in quote reviews|Usar .* en cotizaciones/ });
      await expect(quoteReferenceToggle).not.toBeChecked();
      await quoteReferenceToggle.check();
      await expect.poll(async () => {
        const current = await json<{ documents: Array<{ id: string; quoteReferenceEnabled: boolean }> }>(await owner.page.request.get("/api/files"));
        return current.documents.find((document) => document.id === pdfDocumentId)?.quoteReferenceEnabled;
      }).toBe(true);
      await waitForDocumentIndex(owner.page, pdfDocumentId);
      if (!cappedAiSmoke) {
        const answer = await assistantTurn(owner.page, `Responde en español usando el documento ${generated.fixtures.pdf.name}: ¿cuál es la fecha de inspección asociada con ${generated.token}?`, "es");
        const text = answer.filter((item) => item.event === "text_delta").map((item) => String(item.data.delta || "")).join("");
        expect(text.toLocaleLowerCase()).toMatch(/15|septiembre/);
        expect(answer.some((item) => item.event === "citation" && String(item.data.label || "").includes(generated.fixtures.pdf.name))).toBe(true);
        expect(answer.find((item) => item.event === "done")?.data.language).toBe("es");
      }
    });

    if (aiEnabled) await test.step("basic multimodal quote analysis and follow-up conversation", async () => {
      await owner.page.reload();
      await waitForProjectReady(owner.page);
      await openSection(owner.page, "Quotes", "Cotizaciones");
      for (let index = 0; index < 3; index++) {
        if (index) await owner.page.getByRole("button", { name: /Add supplier|Agregar proveedor/ }).click();
        const card = owner.page.locator(".quote-offer-input").nth(index);
        await card.getByRole("textbox").fill(`QA Supplier ${index + 1}`);
        const fixture = index === 0 ? generated.fixtures.pdf : index === 1 ? generated.fixtures.image : generated.fixtures.docx;
        await card.locator('input[type="file"]').setInputFiles({ name: fixture.name, mimeType: fixture.mimeType, buffer: fixture.buffer });
      }
      await owner.page.locator(".quote-references").first().getByRole("checkbox").check();
      if (cappedAiSmoke) await owner.page.getByRole("checkbox", { name: /Compare prices automatically|Comparar precios automáticamente/ }).uncheck();
      const responsePromise = owner.page.waitForResponse(response => response.url().endsWith("/api/quotes") && response.request().method() === "POST", { timeout: 240_000 });
      await owner.page.getByRole("button", { name: /Compare offers|Comparar ofertas/ }).click();
      const response = await responsePromise;
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("application/x-ndjson");
      type ComparedQuote = { id: string; status: string; files: Array<{ name: string; fileUrl: string }>; analysis: { offerComparison: { suppliers: Array<{ supplier: string; total: string }>; rows: unknown[] }; summary: string; recommendation: string; essentialQuestions: unknown[]; webComparison: { status: string; summary: string; sources: unknown[] } } };
      let completedQuote: ComparedQuote | undefined;
      await expect.poll(async () => {
        const payload = await json<{ quotes: ComparedQuote[] }>(await owner.page.request.get("/api/quotes"));
        completedQuote = payload.quotes.find(quote => quote.files.some(file => file.name === generated.fixtures.pdf.name));
        return completedQuote?.status === "ready" || completedQuote?.status === "failed";
      }, { timeout: 240_000, intervals: [2000] }).toBe(true);
      if (!completedQuote) throw new Error("Quote analysis did not return a saved review");
      const created = { quote: completedQuote as ComparedQuote };
      await expect(owner.page.locator(".quote-progress")).toContainText(/Review ready|Revisión lista/, { timeout: 15_000 });
      expect(created.quote.status).toBe("ready");
      expect(created.quote.files).toHaveLength(3);
      expect(created.quote.analysis.offerComparison.suppliers.map(offer => offer.supplier)).toEqual(expect.arrayContaining(["QA Supplier 1", "QA Supplier 2", "QA Supplier 3"]));
      // Each format must contribute its own quoted amount, not just a supplier label.
      const offerTotals = new Map(created.quote.analysis.offerComparison.suppliers.map(offer => [offer.supplier, offer.total]));
      expect(offerTotals.get("QA Supplier 1")).toMatch(/(?<!\d)65[,. \u00a0]?000(?:[,.]00)?(?!\d|[,.]\d)/);
      expect(offerTotals.get("QA Supplier 2")).toMatch(/(?<!\d)(?:60[,. \u00a0]?000|61[,. \u00a0]?500)(?:[,.]00)?(?!\d|[,.]\d)/);
      expect(offerTotals.get("QA Supplier 3")).toMatch(/(?<!\d)(?:68[,. \u00a0]?200|70[,. \u00a0]?200)(?:[,.]00)?(?!\d|[,.]\d)/);
      expect(created.quote.analysis.offerComparison.rows.length).toBeGreaterThan(0);
      expect(created.quote.files.map((file) => file.name)).toEqual(expect.arrayContaining([generated.fixtures.pdf.name, generated.fixtures.image.name]));
      for (const file of created.quote.files) expect((await owner.page.request.get(file.fileUrl)).status()).toBe(200);
      expect(created.quote.analysis.summary.length).toBeGreaterThan(10);
      expect(created.quote.analysis.essentialQuestions.length).toBeGreaterThan(0);
      if (cappedAiSmoke) expect(created.quote.analysis.webComparison.status).toBe("not_requested");
      else {
        expect(created.quote.analysis.webComparison.status).toBe("ready");
        expect(created.quote.analysis.webComparison.summary.length).toBeGreaterThan(20);
        expect(created.quote.analysis.webComparison.sources.length).toBeGreaterThan(0);
      }
      expect(created.quote.analysis.recommendation).not.toMatch(/(?:recomendamos|recomienda|conviene|debería|sugerimos).{0,180}(?:comparar|comparación)/i);
      const asked = await guarded(owner.page, ownerEmail, () => owner.page.request.post("/api/quotes/chat", {
        data: { id: created.quote.id, question: "Compara QA Supplier 1, QA Supplier 2 y QA Supplier 3: ¿son equivalentes sus alcances? Explica los faltantes sin inventar precios.", language: "es", useWeb: false },
        failOnStatusCode: false,
        timeout: 180_000,
      }));
      const answer = await json<{ assistant: { text: string } }>(asked);
      expect(answer.assistant.text.length).toBeGreaterThan(10);
      const stored = await json<{ quotes: Array<{ id: string }>; messages: Array<{ role: string }> }>(await owner.page.request.get(`/api/quotes?id=${encodeURIComponent(created.quote.id)}`));
      expect(stored.quotes.some((quote) => quote.id === created.quote.id)).toBe(true);
      expect(stored.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
      await owner.page.reload();
      await waitForProjectReady(owner.page);
      await openSection(owner.page, "Quotes", "Cotizaciones");
      await expect(owner.page.locator(".quote-offer-comparison")).toBeVisible();
      await expect(owner.page.locator(".quote-offer-comparison").getByRole("columnheader", { name: "QA Supplier 3", exact: true })).toBeVisible();
      await owner.page.getByText(/Open documents|Abrir documentos/).click();
      const quoteFileMenu = owner.page.locator(".quote-file-menu");
      await expect(quoteFileMenu.getByText(generated.fixtures.pdf.name, { exact: true })).toBeVisible();
      await expect(quoteFileMenu.getByText(generated.fixtures.image.name, { exact: true })).toBeVisible();
      await owner.page.getByText(/Open documents|Abrir documentos/).click();
      await owner.page.getByText(/Past quotes to compare|Cotizaciones pasadas para comparar/).click();
      await expect(owner.page.locator(".quote-references").filter({ hasText: /Past quotes to compare|Cotizaciones pasadas para comparar/ }).getByText("QA Supplier 1 vs QA Supplier 2 vs QA Supplier 3")).toBeVisible();
      await owner.page.getByRole("button", { name: /Delete quote|Eliminar cotización/ }).click();
      const deleteDialog = owner.page.getByRole("alertdialog");
      await expect(deleteDialog).toContainText("QA Supplier 1");
      await deleteDialog.getByRole("button", { name: /^(Delete|Eliminar)$/ }).click();
      await expect(owner.page.locator(".quote-history").getByText("QA Supplier 1 vs QA Supplier 2 vs QA Supplier 3", { exact: true })).toHaveCount(0);
      const afterDelete = await json<{ quotes: Array<{ id: string }> }>(await owner.page.request.get("/api/quotes"));
      expect(afterDelete.quotes.some((quote) => quote.id === created.quote.id)).toBe(false);
    });

    await test.step("aesthetic folders and curated carousel", async () => {
      aestheticFolderId = (await mutateJson<{ folder: { id: string } }>(owner.page, "post", "/api/aesthetics", { action: "create_folder", name: `${runId} Moodboard` }, [201])).folder.id;
      for (const suffix of ["hero", "detail"]) {
        const response = await guarded(owner.page, ownerEmail, () => owner.page.request.post("/api/aesthetics", {
          multipart: { folderId: aestheticFolderId, file: { name: `${runId}-${suffix}.png`, mimeType: generated.fixtures.image.mimeType, buffer: generated.fixtures.image.buffer } },
          failOnStatusCode: false,
        }));
        const body = await json<{ image: { id: string } }>(response, [201]);
        aestheticImageIds.push(body.image.id);
      }
      const aesthetics = await json<{ folders: Array<{ id: string; carouselImageIds: string[] }>; images: Array<{ id: string }> }>(await owner.page.request.get("/api/aesthetics"));
      expect(aesthetics.images.filter((image) => aestheticImageIds.includes(image.id))).toHaveLength(2);
      expect(aesthetics.folders.find((folder) => folder.id === aestheticFolderId)?.carouselImageIds).toEqual([]);
      await mutateJson(owner.page, "patch", "/api/aesthetics", { action: "carousel", id: aestheticFolderId, imageIds: aestheticImageIds });
      const curated = await json<typeof aesthetics>(await owner.page.request.get("/api/aesthetics"));
      expect(curated.folders.find((folder) => folder.id === aestheticFolderId)?.carouselImageIds).toEqual(aestheticImageIds);
      await owner.page.reload();
      await openSection(owner.page, "Aesthetics", "Estética");
      await owner.page.locator(".aesthetic-folder-strip").getByRole("button", { name: new RegExp(`${runId} Moodboard`) }).click();
      await expect(owner.page.locator(".aesthetic-carousel")).toBeVisible();
      await expect(owner.page.locator(".aesthetic-thumbnail-card")).toHaveCount(2);
      let nativeDialog = false;
      owner.page.once("dialog", async (dialog) => { nativeDialog = true; await dialog.dismiss(); });
      const uiFolderName = `${runId} UI drop target`;
      await owner.page.getByRole("button", { name: /New folder|Nueva carpeta/ }).click();
      const createDialog = owner.page.getByRole("dialog", { name: /Create folder|Crear carpeta/ });
      await expect(createDialog).toBeVisible();
      await createDialog.getByLabel(/Folder name|Nombre de la carpeta/).fill(uiFolderName);
      await createDialog.getByRole("button", { name: /Save folder|Guardar carpeta/ }).click();
      await expect(owner.page.getByRole("heading", { name: uiFolderName })).toBeVisible();
      expect(nativeDialog).toBe(false);
      const foldersAfterCreate = await json<{ folders: Array<{ id: string; name: string }> }>(await owner.page.request.get("/api/aesthetics"));
      const uiFolderId = foldersAfterCreate.folders.find((folder) => folder.name === uiFolderName)?.id;
      expect(uiFolderId).toBeTruthy();

      const folderUploadName = `${runId}-folder-drop.png`;
      const uiFolderButton = owner.page.locator(".aesthetic-folder-strip").getByRole("button", { name: new RegExp(uiFolderName) });
      const folderUploadTransfer = await owner.page.evaluateHandle(({ bytes, name, type }) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([new Uint8Array(bytes)], name, { type }));
        return transfer;
      }, { bytes: Array.from(generated.fixtures.image.buffer), name: folderUploadName, type: generated.fixtures.image.mimeType });
      await uiFolderButton.dispatchEvent("dragenter", { dataTransfer: folderUploadTransfer });
      await expect(uiFolderButton).toHaveClass(/drop-hover/);
      await uiFolderButton.dispatchEvent("drop", { dataTransfer: folderUploadTransfer });
      await expect(owner.page.getByRole("heading", { name: uiFolderName })).toBeVisible();
      const folderUploadedCard = owner.page.locator(".aesthetic-grid article").filter({ hasText: folderUploadName });
      await expect(folderUploadedCard).toBeVisible({ timeout: 30_000 });
      await expect.poll(async () => {
        const current = await json<{ images: Array<{ id: string; folderId: string; name: string }> }>(await owner.page.request.get("/api/aesthetics"));
        return current.images.find((image) => image.name === folderUploadName)?.folderId;
      }).toBe(uiFolderId);
      await owner.page.getByLabel(new RegExp(`Move ${runId}-folder-drop\\.png to folder|Mover ${runId}-folder-drop\\.png a carpeta`)).selectOption({ label: `${runId} Moodboard` });

      await owner.page.locator(".aesthetic-folder-strip").getByRole("button", { name: new RegExp(`${runId} Moodboard`) }).click();
      const uploadDropzone = owner.page.getByRole("button", { name: /Drop images here or choose files|Soltá imágenes aquí o elegí archivos/ });
      await expect(uploadDropzone).toBeEnabled();
      const uploadTransfer = await owner.page.evaluateHandle(({ bytes, name, type }) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([new Uint8Array(bytes)], name, { type }));
        return transfer;
      }, { bytes: Array.from(generated.fixtures.image.buffer), name: `${runId}-drag-upload.png`, type: generated.fixtures.image.mimeType });
      await uploadDropzone.dispatchEvent("dragenter", { dataTransfer: uploadTransfer });
      await expect(uploadDropzone).toHaveClass(/dragging/);
      await uploadDropzone.dispatchEvent("drop", { dataTransfer: uploadTransfer });
      await expect(owner.page.locator(".aesthetic-grid article").filter({ hasText: `${runId}-drag-upload.png` })).toBeVisible({ timeout: 30_000 });
      const firstCarouselImage = owner.page.locator(".aesthetic-thumbnail-card").nth(0);
      const secondCarouselImage = owner.page.locator(".aesthetic-thumbnail-card").nth(1);
      await firstCarouselImage.dragTo(secondCarouselImage);
      await expect.poll(async () => {
        const current = await json<{ folders: Array<{ id: string; carouselImageIds: string[] }> }>(await owner.page.request.get("/api/aesthetics"));
        return current.folders.find((folder) => folder.id === aestheticFolderId)?.carouselImageIds.slice(0, 2);
      }).toEqual([aestheticImageIds[1], aestheticImageIds[0]]);

      const heroCard = owner.page.locator(".aesthetic-grid article").filter({ hasText: `${runId}-hero.png` });
      await dragAestheticCardToTray(owner.page, heroCard, new RegExp(uiFolderName));
      await expect.poll(async () => {
        const current = await json<{ images: Array<{ id: string; folderId: string }> }>(await owner.page.request.get("/api/aesthetics"));
        return current.images.find((image) => image.id === aestheticImageIds[0])?.folderId;
      }).toBe(uiFolderId);
      await uiFolderButton.click();
      await owner.page.getByLabel(new RegExp(`Move ${runId}-hero\\.png to folder|Mover ${runId}-hero\\.png a carpeta`)).selectOption({ label: `${runId} Moodboard` });
      await expect.poll(async () => {
        const current = await json<{ images: Array<{ id: string; folderId: string }> }>(await owner.page.request.get("/api/aesthetics"));
        return current.images.find((image) => image.id === aestheticImageIds[0])?.folderId;
      }).toBe(aestheticFolderId);
      await uiFolderButton.click();
      await owner.page.locator(".aesthetic-folder-toolbar").getByRole("button", { name: /Delete|Eliminar/, exact: true }).click();
      const deleteFolderDialog = owner.page.getByRole("alertdialog", { name: /Delete folder|Eliminar carpeta/ });
      await expect(deleteFolderDialog).toBeVisible();
      await deleteFolderDialog.getByRole("button", { name: /Delete|Eliminar/, exact: true }).click();
      await expect(uiFolderButton).toHaveCount(0);
    });

    await test.step("plan, countdown scheduling, decisions, and site progress", async () => {
      planId = (await mutateJson<{ item: { id: string } }>(owner.page, "post", "/api/plan", { title: `${runId} Foundation`, phase: "QA", owner: "QA", startDate: "2026-09-01", endDate: "2026-09-10", status: "not_started", dependsOn: [], notes: "QA" }, [201])).item.id;
      const notifications = await json<{ recipients: Array<{ uid: string; email: string }> }>(await owner.page.request.get("/api/notifications"));
      const ownerRecipient = notifications.recipients.find((recipient) => recipient.email.toLowerCase() === ownerEmail);
      expect(ownerRecipient).toBeTruthy();
      ownerUid = ownerRecipient!.uid;
      countdownId = (await mutateJson<{ countdown: { id: string } }>(owner.page, "post", "/api/countdowns", { title: `${runId} Ten day check`, durationDays: 10, recipientUids: [ownerRecipient!.uid] }, [201])).countdown.id;
      decisionId = (await mutateJson<{ decision: { id: string } }>(owner.page, "post", "/api/decisions", { title: `${runId} Material choice`, area: "QA", options: "A / B", selected: "", dueDate: "2026-09-05", status: "open", owner: "QA" }, [201])).decision.id;
      issueId = (await mutateJson<{ issue: { id: string } }>(owner.page, "post", "/api/site-issues", { title: `${runId} Inspection`, category: "inspection", priority: "medium", status: "open", assignee: "QA", dueDate: "2026-09-06", notes: "QA", photos: [] }, [201])).issue.id;
      const diagnostics = await json<{ notifications: Array<{ stage: string; status: string }> }>(await owner.page.request.get("/api/qa/diagnostics"));
      expect(diagnostics.notifications.filter((job) => job.status === "pending").map((job) => job.stage).sort()).toEqual(["due", "pre_due"]);
    });

    await test.step("mobile photo crop, voice note, and immediate expense link", async () => {
      await owner.page.setViewportSize({ width: 390, height: 844 });
      await owner.page.reload();
      await guard(owner.page, ownerEmail, "admin");
      await expect(owner.page.getByRole("button", { name: /New field capture|Nueva captura de obra/ })).toHaveCount(0);
      await openSection(owner.page, "Site progress", "Progreso de obra");
      await owner.page.getByRole("button", { name: /New field capture|Nueva captura de obra/ }).click();
      const capture = owner.page.getByRole("dialog", { name: /Add from your phone|Agregar desde el teléfono/ });
      await expect(capture).toBeVisible();
      await expect(capture.locator("select").first()).toHaveValue(projectId);
      await capture.locator('input[type="file"][accept="image/*"]').setInputFiles({ name: generated.fixtures.image.name, mimeType: generated.fixtures.image.mimeType, buffer: generated.fixtures.image.buffer });
      await expect(capture.locator(".capture-crop-viewport img")).toBeVisible();
      await capture.locator('input[type="range"]').fill("1.25");
      await capture.locator("textarea").fill(`${runId} mobile receipt and voice note`);
      await capture.locator('input[type="file"][accept="audio/*"]').setInputFiles({ name: `${runId}-voice.webm`, mimeType: "audio/webm", buffer: Buffer.from("synthetic QA voice note") });
      const destination = capture.locator("fieldset select");
      await expect.poll(() => destination.inputValue()).not.toBe("");
      await capture.getByRole("button", { name: /Save and link|Guardar y vincular/ }).click();
      await expect(capture).toBeHidden({ timeout: 60_000 });
      const expenseCapture = await expect.poll(async () => {
        const payload = await json<{ expenses: Array<{ attachments: Array<{ contentType: string; note?: string }> }> }>(await owner.page.request.get("/api/expenses"));
        return payload.expenses.flatMap((expense) => expense.attachments).filter((attachment) => attachment.note === `${runId} mobile receipt and voice note`);
      }, { timeout: 30_000 }).toHaveLength(2);
      void expenseCapture;
      const files = await json<{ documents: Array<{ contentType: string; description: string }> }>(await owner.page.request.get("/api/expenses/files"));
      const capturedFiles = files.documents.filter((document) => document.description === `${runId} mobile receipt and voice note`);
      expect(capturedFiles).toHaveLength(1);
      expect(capturedFiles[0].contentType).toBe("image/jpeg");
      await owner.page.setViewportSize({ width: 1280, height: 900 });
      await expect(owner.page.locator(".topbar h1")).toHaveText(/Purchases\/Expenses|Compras\/Gastos/);
      await expect(owner.page.getByRole("button", { name: /New field capture|Nueva captura de obra/ })).toHaveCount(0);
      await owner.page.locator(".site-footer").scrollIntoViewIfNeeded();
      const footerLink = await owner.page.locator(".site-footer a").boundingBox();
      const assistantButton = await owner.page.locator(".assistant-launcher").boundingBox();
      expect(footerLink).not.toBeNull();
      expect(assistantButton).not.toBeNull();
      const overlaps = Boolean(footerLink && assistantButton && footerLink.x < assistantButton.x + assistantButton.width && footerLink.x + footerLink.width > assistantButton.x && footerLink.y < assistantButton.y + assistantButton.height && footerLink.y + footerLink.height > assistantButton.y);
      expect(overlaps).toBe(false);
    });

    await test.step("activity integrity and no personal workspace exposure", async () => {
      const activity = await json<{ events: Array<{ category: string; integrity: string }> }>(await owner.page.request.get("/api/activity?limit=50"));
      expect(activity.events.length).toBeGreaterThanOrEqual(8);
      expect(activity.events.every((event) => event.integrity === "verified")).toBe(true);
      expect(activity.events.map((event) => event.category)).toEqual(expect.arrayContaining(["budget", "document", "aesthetic", "plan", "decision", "site"]));
      const projects = await json<{ projects: Array<{ id: string; active: boolean }> }>(await owner.page.request.get("/api/projects"));
      expect(projects.projects.find((project) => project.active)?.id).toBe(projectId);
    });

    if (suite === "full") {
      await test.step("project favorite and open-on-sign-in preferences", async () => {
        const before = await json<{ projects: Array<{ id: string; favorite: boolean; openOnSignIn: boolean }> }>(await owner.page.request.get("/api/projects"));
        originalFavoriteId = before.projects.find((project) => project.favorite)?.id || null;
        originalOpenFavorite = before.projects.some((project) => project.openOnSignIn);
        if (originalFavoriteId !== projectId) await mutateJson(owner.page, "patch", "/api/projects", { action: "favorite", projectId });
        await mutateJson(owner.page, "patch", "/api/projects", { action: "open_favorite", enabled: true });
        preferencesChanged = true;
        const changed = await json<{ projects: Array<{ id: string; favorite: boolean; openOnSignIn: boolean }> }>(await owner.page.request.get("/api/projects"));
        expect(changed.projects.find((project) => project.id === projectId)).toMatchObject({ favorite: true, openOnSignIn: true });
      });

      await test.step("folder and document CRUD with PDF, Word, and image previews", async () => {
        const qaParentFolderId = (await mutateJson<{ folder: { id: string } }>(owner.page, "post", "/api/folders", { name: `${runId} Parent`, parentId: null }, [201])).folder.id;
        qaFolderId = (await mutateJson<{ folder: { id: string } }>(owner.page, "post", "/api/folders", { name: `${runId} Documents`, parentId: null }, [201])).folder.id;
        await mutateJson(owner.page, "patch", "/api/folders", { id: qaFolderId, name: `${runId} Archive` });
        await mutateJson(owner.page, "patch", "/api/folders", { id: qaFolderId, parentId: qaParentFolderId });
        const docxId = (await upload(owner.page, generated.fixtures.docx, qaFolderId)).id;
        await mutateJson(owner.page, "patch", "/api/files", { id: docxId, description: "QA Word reference" });
        expect((await owner.page.request.get(`/api/files?id=${encodeURIComponent(docxId)}&preview=docx`)).status()).toBe(200);
        expect((await owner.page.request.get(`/api/files?id=${encodeURIComponent(receiptDocumentId)}&preview=image`)).status()).toBe(200);
        await mutateJson(owner.page, "patch", "/api/files", { id: docxId, folderId: null });
        await mutateJson(owner.page, "delete", `/api/files?id=${encodeURIComponent(docxId)}`);
        await mutateJson(owner.page, "delete", `/api/folders?id=${encodeURIComponent(qaFolderId)}`);
        await mutateJson(owner.page, "delete", `/api/folders?id=${encodeURIComponent(qaParentFolderId)}`);
      });

      await test.step("aesthetic carousel selection, rename, and deletion", async () => {
        await mutateJson(owner.page, "patch", "/api/aesthetics", { action: "rename_folder", id: aestheticFolderId, name: `${runId} Selected finishes` });
        await mutateJson(owner.page, "patch", "/api/aesthetics", { action: "carousel", id: aestheticFolderId, imageIds: [aestheticImageIds[1]] });
        let aesthetics = await json<{ folders: Array<{ id: string; name: string; carouselImageIds: string[] }> }>(await owner.page.request.get("/api/aesthetics"));
        expect(aesthetics.folders.find((folder) => folder.id === aestheticFolderId)).toMatchObject({ name: `${runId} Selected finishes`, carouselImageIds: [aestheticImageIds[1]] });
        await mutateJson(owner.page, "delete", `/api/aesthetics?id=${encodeURIComponent(aestheticImageIds[0])}&type=image`);
        aesthetics = await json(await owner.page.request.get("/api/aesthetics"));
        expect((aesthetics as { images?: Array<{ id: string }> }).images?.some((image) => image.id === aestheticImageIds[0])).toBe(false);
      });

      await test.step("expense linking and unlinking remains Factura-only", async () => {
        const budget = await json<{ lines: Array<{ id: string; paid: number }> }>(await owner.page.request.get("/api/budget"));
        const paid = budget.lines.find((line) => line.paid > 0)!;
        const rejectedLink = await guarded(owner.page, ownerEmail, () => owner.page.request.post("/api/expenses", { data: { budgetLineId: paid.id, receiptDocumentId: pdfDocumentId }, failOnStatusCode: false }));
        expect(rejectedLink.status()).toBe(400);
        const linked = await mutateJson<{ id: string }>(owner.page, "post", "/api/expenses", { budgetLineId: paid.id, receiptDocumentId }, [201]);
        const expenses = await json<{ expenses: Array<{ attachments: Array<{ documentId: string }> }> }>(await owner.page.request.get("/api/expenses"));
        expect(expenses.expenses.some((expense) => expense.attachments.some((attachment) => attachment.documentId === receiptDocumentId))).toBe(true);
        await mutateJson(owner.page, "delete", `/api/expenses?id=${encodeURIComponent(linked.id)}`);
      });

      await test.step("direct budget publication, versions, and rollback", async () => {
        const draft = await createAndSaveDraft(owner.page, ownerEmail, 3, 4, 1100);
        await json(await guarded(owner.page, ownerEmail, () => owner.page.request.post("/api/workbook/drafts", { data: { action: "publish", id: draft.id }, failOnStatusCode: false })), [200]);
        const versions = await json<{ versions: Array<{ id: string; kind: string }> }>(await owner.page.request.get("/api/workbook/versions"));
        expect(versions.versions.length).toBeGreaterThanOrEqual(2);
        const uploadedFixture = versions.versions.find((version) => version.kind === "owner_replacement");
        expect(uploadedFixture).toBeDefined();
        await mutateJson(owner.page, "post", "/api/workbook/versions", { versionId: uploadedFixture!.id });
        const restoredBudget = await json<{ lines: Array<{ item: string; objective: number }> }>(await owner.page.request.get("/api/budget"));
        expect(restoredBudget.lines.find((line) => line.item === "QA Completed concrete")?.objective).toBe(1000);
        const download = await owner.page.request.get("/api/workbook/file");
        expect(download.status()).toBe(200);
        expect((await download.body()).length).toBeGreaterThan(1_000);
      });

      await test.step("plan templates, no-op deduplication, countdown cancellation, and issue photos", async () => {
        await mutateJson(owner.page, "post", "/api/plan/batch", { items: [
          { title: `${runId} Template A`, phase: "QA", owner: "QA", startDate: "2026-09-11", endDate: "2026-09-13", status: "not_started", dependsOn: [planId] },
          { title: `${runId} Template B`, phase: "QA", owner: "QA", startDate: "2026-09-14", endDate: "2026-09-16", status: "not_started", dependsOn: [`${runId} Template A`] },
        ] }, [201]);
        const currentPlan = (await json<{ items: Array<Json & { id: string }> }>(await owner.page.request.get("/api/plan"))).items.find((item) => item.id === planId)!;
        await mutateJson(owner.page, "patch", "/api/plan", { ...currentPlan, status: "in_progress" });
        await mutateJson(owner.page, "patch", "/api/plan", { ...currentPlan, status: "in_progress" });
        await mutateJson(owner.page, "patch", "/api/countdowns", { id: countdownId, action: "acknowledge" });
        await mutateJson(owner.page, "delete", `/api/countdowns?id=${encodeURIComponent(countdownId)}`);
        const cancelled = await json<{ notifications: Array<{ status: string }> }>(await owner.page.request.get("/api/qa/diagnostics"));
        expect(cancelled.notifications.filter((job) => job.status === "cancelled")).toHaveLength(2);
        const photo = await guarded(owner.page, ownerEmail, () => owner.page.request.post("/api/site-issues/photo", { multipart: { file: { name: generated.fixtures.image.name, mimeType: generated.fixtures.image.mimeType, buffer: generated.fixtures.image.buffer } }, failOnStatusCode: false }));
        const photoBody = await json<{ key: string }>(photo, [201]);
        const issue = (await json<{ issues: Array<Json & { id: string }> }>(await owner.page.request.get("/api/site-issues"))).issues.find((item) => item.id === issueId)!;
        await mutateJson(owner.page, "patch", "/api/site-issues", { ...issue, priority: "high", status: "resolved", photos: [photoBody.key] });
        const decision = (await json<{ decisions: Array<Json & { id: string }> }>(await owner.page.request.get("/api/decisions"))).decisions.find((item) => item.id === decisionId)!;
        await mutateJson(owner.page, "patch", "/api/decisions", { ...decision, selected: "A", status: "decided" });
        await owner.page.reload();
        await openSection(owner.page, "Plan & schedule", "Plan y cronograma");
        await owner.page.getByRole("button", { name: /Gantt|Cronograma/, exact: true }).click();
        await expect(owner.page.locator(".gantt-card")).toBeVisible();
      });

      await test.step("companion invitation, approval workflow, permissions, and revocation", async () => {
        const permissions = { overview: true, activity: true, budget: true, expenses: false, documents: true, aesthetics: true, approvals: true, plan: true, decisions: true, site: true };
        const invited = await mutateJson<{ inviteUrl: string }>(owner.page, "post", "/api/invitations", { email: companionEmail, role: "editor", permissions, folderAccess: { mode: "all", folderIds: [], allowUnfiled: true } }, [201]);
        companion = await signIn(browser, companionEmail, companionPassword, invited.inviteUrl);
        await guard(companion.page, companionEmail, "editor");
        const approvedDraft = await createAndSaveDraft(companion.page, companionEmail, 4, 5, 950);
        await guard(companion.page, companionEmail);
        const submitted = await json<{ approvalId: string }>(await companion.page.request.post("/api/workbook/drafts", { data: { action: "submit", id: approvedDraft.id }, failOnStatusCode: false }), [202]);
        await mutateJson(owner.page, "patch", "/api/approvals", { id: submitted.approvalId, action: "approved" });
        const rejectedDraft = await createAndSaveDraft(companion.page, companionEmail, 5, 5, 750);
        await guard(companion.page, companionEmail);
        const rejected = await json<{ approvalId: string }>(await companion.page.request.post("/api/workbook/drafts", { data: { action: "submit", id: rejectedDraft.id }, failOnStatusCode: false }), [202]);
        await mutateJson(owner.page, "patch", "/api/approvals", { id: rejected.approvalId, action: "rejected" });
        await json(await guarded(owner.page, ownerEmail, () => owner.page.request.post("/api/qa/companion", {
          data: { action: "drop_project_membership", email: companionEmail }, failOnStatusCode: false,
        })));
        const access = await json<{ users: Array<{ uid: string; email: string }>; reconciledMemberships: number }>(await owner.page.request.get("/api/access"));
        expect(access.reconciledMemberships).toBe(1);
        companionUid = access.users.find((user) => user.email.toLowerCase() === companionEmail)!.uid;
        const viewerRole = await mutateJson<{ user: { role: string; status: string } }>(owner.page, "patch", "/api/access", { uid: companionUid, action: "approve", role: "viewer", permissions });
        expect(viewerRole.user).toMatchObject({ role: "viewer", status: "approved" });
        const editorRole = await mutateJson<{ user: { role: string; status: string } }>(owner.page, "patch", "/api/access", { uid: companionUid, action: "approve", role: "editor", permissions });
        expect(editorRole.user).toMatchObject({ role: "editor", status: "approved" });
        const recipientCountdownId = (await mutateJson<{ countdown: { id: string } }>(owner.page, "post", "/api/countdowns", { title: `${runId} Recipient update`, durationDays: 10, recipientUids: [ownerUid, companionUid] }, [201])).countdown.id;
        await mutateJson(owner.page, "patch", "/api/countdowns", { id: recipientCountdownId, action: "recipients", recipientUids: [companionUid] });
        await mutateJson(owner.page, "delete", `/api/countdowns?id=${encodeURIComponent(recipientCountdownId)}`);
        const restricted = { overview: true, activity: true, budget: false, expenses: false, documents: true, aesthetics: false, approvals: false, plan: true, decisions: false, site: false };
        await mutateJson(owner.page, "patch", "/api/access", { uid: companionUid, action: "permissions", permissions: restricted });
        await mutateJson(owner.page, "patch", "/api/access", { uid: companionUid, action: "folders", folderAccess: { mode: "selected", folderIds: [referenceFolderId], allowUnfiled: false } });
        expect((await companion.page.request.get("/api/plan")).status()).toBe(200);
        expect((await companion.page.request.get("/api/decisions")).status()).toBe(403);
        const companionDocuments = await json<{ documents: Array<{ id: string }> }>(await companion.page.request.get("/api/files"));
        expect(companionDocuments.documents.some((document) => document.id === pdfDocumentId)).toBe(true);
        expect(companionDocuments.documents.some((document) => document.id === receiptDocumentId)).toBe(false);
        expect((await companion.page.request.get("/api/expenses/files")).status()).toBe(403);
        const ownerActivity = await json<{ events: Array<{ id: string; category: string }> }>(await owner.page.request.get("/api/activity?category=decision&limit=20"));
        expect(ownerActivity.events.length).toBeGreaterThan(0);
        expect((await companion.page.request.get(`/api/activity/${ownerActivity.events[0].id}`)).status()).toBe(404);
        await owner.page.reload();
        await openSection(owner.page, "Access", "Acceso");
        const companionAccess = owner.page.locator(".access-user-row").filter({ hasText: companionEmail });
        await companionAccess.getByRole("button", { name: /Manage access for|Gestionar acceso de/ }).click();
        const activityVisibility = companionAccess.getByLabel(/Show Activity to|Mostrar Actividad a/);
        await expect(activityVisibility).toBeChecked();
        await activityVisibility.click();
        await expect(activityVisibility).not.toBeChecked();
        await expect.poll(async () => (await companion!.page.request.get("/api/activity?limit=1")).status()).toBe(403);
        expect((await companion.page.request.get(`/api/activity/${ownerActivity.events[0].id}`)).status()).toBe(404);
        await companion.page.reload();
        await expect(companion.page.getByRole("button", { name: /Activity|Actividad/ })).toHaveCount(0);
        await activityVisibility.click();
        await expect(activityVisibility).toBeChecked();
        await expect.poll(async () => (await companion!.page.request.get("/api/activity?limit=1")).status()).toBe(200);
        const planVisibility = companionAccess.getByLabel(/Show Plan & schedule to|Mostrar Plan y cronograma a/);
        await expect(planVisibility).toBeChecked();
        await planVisibility.click();
        await expect(planVisibility).not.toBeChecked();
        await expect(planVisibility.locator("..").getByText(/Hidden|Oculta/, { exact: true })).toBeVisible();
        await expect.poll(async () => (await companion!.page.request.get("/api/plan")).status()).toBe(403);
        await companion.page.reload();
        await expect(companion.page.getByRole("button", { name: /Plan & schedule|Plan y cronograma/ })).toHaveCount(0);
        await planVisibility.click();
        await expect(planVisibility).toBeChecked();
        await expect.poll(async () => (await companion!.page.request.get("/api/plan")).status()).toBe(200);
        await mutateJson(owner.page, "patch", "/api/access", { uid: companionUid, action: "revoke", role: "viewer", permissions: restricted });
        expect((await companion.page.request.get("/api/plan")).status()).toBe(403);
      });

      if (!cappedAiSmoke) await test.step("English Gemini answer and assistant-origin budget proposal", async () => {
        const english = await assistantTurn(owner.page, `Answer in English using ${generated.fixtures.pdf.name}: what inspection date is associated with ${generated.token}?`, "en");
        expect(english.find((item) => item.event === "done")?.data.language).toBe("en");
        const proposalEvents = await assistantTurn(owner.page, "Create a review-only proposal to change the objective for the exact existing budget line QA Completed concrete to 1300 CRC. Do not change any other line.", "en");
        const proposal = proposalEvents.find((item) => item.event === "proposal")?.data as { id?: string } | undefined;
        expect(proposal?.id).toBeTruthy();
        const confirmed = await mutateJson<{ draftId: string }>(owner.page, "post", "/api/assistant/proposals", { id: proposal!.id });
        const published = await json<{googleSynced:boolean;googleSyncError?:string}>(await guarded(owner.page, ownerEmail, () => owner.page.request.post("/api/workbook/drafts", { data: { action: "publish", id: confirmed.draftId }, failOnStatusCode: false })), [200]);
        expect(published.googleSynced, published.googleSyncError).toBe(true);
        const activity = await json<{ events: Array<{ action: string; source: string; integrity: string }> }>(await owner.page.request.get("/api/activity?category=budget&limit=50"));
        expect(activity.events.some((event) => event.action === "budget.published" && event.source === "assistant")).toBe(true);
        expect(activity.events.every((event) => event.integrity === "verified")).toBe(true);
      });

      await test.step("mobile capture idempotency and offline retry queue", async () => {
        const idempotentCaptureId = `${runId}-idempotent-mobile`;
        const multipart = {
          captureId: idempotentCaptureId,
          projectId,
          targetType: "decision",
          targetId: decisionId,
          note: `${runId} idempotent capture`,
          photo: { name: generated.fixtures.image.name, mimeType: generated.fixtures.image.mimeType, buffer: generated.fixtures.image.buffer },
          voice: { name: `${runId}-voice.webm`, mimeType: "audio/webm", buffer: Buffer.from("synthetic QA voice note") },
        };
        const first = await guarded(owner.page, ownerEmail, () => owner.page.request.post("/api/mobile-captures", { multipart, failOnStatusCode: false }));
        expect(first.status()).toBe(201);
        const retry = await guarded(owner.page, ownerEmail, () => owner.page.request.post("/api/mobile-captures", { multipart, failOnStatusCode: false }));
        expect(retry.status()).toBe(200);
        expect((await retry.json()).duplicate).toBe(true);
        const decisionsAfterRetry = await json<{ decisions: Array<{ id: string; captureAttachments: Array<{ captureId: string }> }> }>(await owner.page.request.get("/api/decisions"));
        expect(decisionsAfterRetry.decisions.find((decision) => decision.id === decisionId)?.captureAttachments.filter((attachment) => attachment.captureId === idempotentCaptureId)).toHaveLength(2);
        const activityAfterRetry = await json<{ events: Array<{ action: string; target: { id: string } }> }>(await owner.page.request.get("/api/activity?category=decision&limit=50"));
        expect(activityAfterRetry.events.filter((event) => event.action === "decision.mobile_capture_added" && event.target.id === decisionId)).toHaveLength(1);

        await owner.page.setViewportSize({ width: 390, height: 844 });
        await owner.page.reload();
        await openSection(owner.page, "Site progress", "Progreso de obra");
        await owner.page.getByRole("button", { name: /New field capture|Nueva captura de obra/ }).click();
        const capture = owner.page.getByRole("dialog", { name: /Add from your phone|Agregar desde el teléfono/ });
        await capture.getByRole("button", { name: /Decision|Decisión/ }).click();
        await expect(capture.locator("fieldset select")).toHaveValue(decisionId);
        await capture.locator('input[type="file"][accept="image/*"]').setInputFiles({ name: generated.fixtures.image.name, mimeType: generated.fixtures.image.mimeType, buffer: generated.fixtures.image.buffer });
        await expect(capture.locator(".capture-crop-viewport img")).toBeVisible();
        const offlineNote = `${runId} offline queued capture`;
        await capture.locator("textarea").fill(offlineNote);
        await owner.context.setOffline(true);
        await capture.locator("footer .primary-button").click();
        await expect(capture).toBeHidden();
        await owner.context.setOffline(false);
        await expect.poll(async () => {
          const payload = await json<{ decisions: Array<{ id: string; captureAttachments: Array<{ note: string }> }> }>(await owner.page.request.get("/api/decisions"));
          return payload.decisions.find((decision) => decision.id === decisionId)?.captureAttachments.some((attachment) => attachment.note === offlineNote) || false;
        }, { timeout: 45_000 }).toBe(true);
        await owner.page.setViewportSize({ width: 1280, height: 900 });
      });

      await test.step("activity filters, pagination, deleted snapshots, and exact-once no-op", async () => {
        await mutateJson(owner.page, "delete", `/api/decisions?id=${encodeURIComponent(decisionId)}`);
        await mutateJson(owner.page, "delete", `/api/site-issues?id=${encodeURIComponent(issueId)}`);
        const first = await json<{ events: Array<{ id: string; integrity: string; target: { exists: boolean } }>; nextCursor: string | null }>(await owner.page.request.get("/api/activity?limit=2"));
        expect(first.events).toHaveLength(2);
        expect(first.nextCursor).toBeTruthy();
        const second = await json<{ events: Array<{ id: string }> }>(await owner.page.request.get(`/api/activity?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`));
        expect(second.events.some((event) => first.events.some((firstEvent) => firstEvent.id === event.id))).toBe(false);
        const planEvents = await json<{ events: Array<{ action: string; target: { id: string } }> }>(await owner.page.request.get("/api/activity?category=plan&limit=50"));
        expect(planEvents.events.filter((event) => event.action === "plan.updated" && event.target.id === planId)).toHaveLength(1);
        const today = new Date().toISOString().slice(0, 10);
        const byMemberAndDate = await json<{ events: Array<{ actor: { uid: string } }> }>(await owner.page.request.get(`/api/activity?actor=${encodeURIComponent(ownerUid)}&from=${today}&to=${today}&limit=50`));
        expect(byMemberAndDate.events.length).toBeGreaterThan(0);
        expect(byMemberAndDate.events.every((event) => event.actor.uid === ownerUid)).toBe(true);
        const all = await json<{ events: Array<{ target: { exists: boolean }; integrity: string; changes: Array<{ before: unknown; after: unknown }> }> }>(await owner.page.request.get("/api/activity?limit=50"));
        expect(all.events.some((event) => event.target.exists === false)).toBe(true);
        expect(all.events.some((event) => event.changes.some((change) => change.before !== change.after))).toBe(true);
        expect(all.events.every((event) => event.integrity === "verified")).toBe(true);
        await openSection(owner.page, "Activity", "Actividad");
        await guard(owner.page, ownerEmail);
        await owner.page.getByRole("button", { name: "ES", exact: true }).click();
        await expect(owner.page.locator(".topbar h1")).toHaveText("Actividad");
        await guard(owner.page, ownerEmail);
        await owner.page.getByRole("button", { name: "EN", exact: true }).click();
        await expect(owner.page.locator(".topbar h1")).toHaveText("Activity");
      });
    }

    completed = true;
  } finally {
    if (preferencesChanged) {
      try {
        const current = await json<{ projects: Array<{ id: string; favorite: boolean }> }>(await owner.page.request.get("/api/projects"));
        const currentFavoriteId = current.projects.find((project) => project.favorite)?.id || null;
        if (originalFavoriteId && currentFavoriteId !== originalFavoriteId) await mutateJson(owner.page, "patch", "/api/projects", { action: "favorite", projectId: originalFavoriteId });
        if (!originalFavoriteId && currentFavoriteId) await mutateJson(owner.page, "patch", "/api/projects", { action: "favorite", projectId: currentFavoriteId });
        await mutateJson(owner.page, "patch", "/api/projects", { action: "open_favorite", enabled: originalOpenFavorite });
      } catch { completed = false; }
    }
    // Documents QA always removes disposable encrypted files, memberships,
    // unlock sessions and attempts, including when an assertion fails.
    if ((suite === "documents" && leaseAcquired) || qaShouldResetAfterRun(suite, completed)) {
      try {
        await resetQa(owner.page);
        if (suite === "documents") {
          const cleaned = await json<{ projectId: string; preview: { counts: Record<string, number> } }>(await owner.page.request.get("/api/qa/reset?preview=1"));
          expect(cleaned.projectId).toBe(projectId);
          for (const collection of ["housePlannerDocuments", "housePlannerFolderVaultSessions", "housePlannerFolderVaultAttempts"]) {
            expect(cleaned.preview.counts[collection], `${collection} must be empty after Documents QA`).toBe(0);
          }
        }
      } catch {
        completed = false;
        documentsCleanupFailed = suite === "documents";
      }
    }
    if (leaseAcquired) await owner.page.request.delete("/api/qa/run", { data: { runId: leaseRunId }, failOnStatusCode: false }).catch(() => undefined);
    if (!completed) await owner.page.screenshot({ path: join(artifactDirectory, "failure.png"), fullPage: true }).catch(() => undefined);
    const ownerVideo = owner.page.video();
    if (completed) await owner.context.tracing.stop().catch(() => undefined);
    else await owner.context.tracing.stop({ path: join(artifactDirectory, "owner-trace.zip") }).catch(() => undefined);
    const companionSession = companion as { context: BrowserContext; page: Page } | null;
    if (companionSession) {
      const companionVideo = companionSession.page.video();
      if (completed) await companionSession.context.tracing.stop().catch(() => undefined);
      else await companionSession.context.tracing.stop({ path: join(artifactDirectory, "companion-trace.zip") }).catch(() => undefined);
      await companionSession.context.close().catch(() => undefined);
      if (completed) await companionVideo?.delete().catch(() => undefined);
    }
    await owner.context.close().catch(() => undefined);
    if (completed) await ownerVideo?.delete().catch(() => undefined);
    await rm(generated.directory, { recursive: true, force: true }).catch(() => undefined);
    if (documentsCleanupFailed) throw new Error("Encrypted Documents QA did not finish its guarded workspace cleanup");
  }
  expect(completed, "Successful QA runs must finish with a clean reset").toBe(true);
});
