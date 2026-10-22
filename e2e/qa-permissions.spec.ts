import { expect, test, type APIResponse, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { QA_IDENTITIES } from "../scripts/qa-target-policy.mjs";
import { createQaFixtures, type QaFixture } from "./qa/fixtures";
import { attachQaSignInDiagnostics, openQaCredentials, readQaIdentity } from "./qa/auth-flow";

const baseURL = process.env.QA_BASE_URL!;
const projectId = "qa-primary";
const isolationId = "qa-isolation";
const runId = process.env.QA_RUN_ID || `qa-permissions-${Date.now()}`;
type Role = keyof typeof QA_IDENTITIES;
type Session = { context: BrowserContext; page: Page };
type AestheticsRole = "OWNER" | "OUTSIDER" | "VIEWER";
type AestheticsFixture = { role: "OWNER" | "OUTSIDER"; folderId: string; name: string; imageId?: string; caption: string };
type AestheticsState = { folders: Array<{ id: string; name: string; carouselImageIds: string[] }>; images: Array<{ id: string; folderId: string; caption: string; notes: string }> };
type Seed = { fixtures: { visibleFolder: string; hiddenFolder: string; visibleDocument: string; hiddenDocument: string; primaryNote: string; isolationNote: string; isolationDocument: string }; users: Array<{ key: string; email: string; uid: string; role: string; projectId: string }> };
const sessions: Partial<Record<Role, Session>> = {};
const aestheticsFixtures: AestheticsFixture[] = [];
let seed: Seed;
let photoFixture: QaFixture;
let leaseAcquired = false;

test.describe.configure({ mode: "serial" });
test.setTimeout(5 * 60_000);

async function signIn(browser: Browser, role: Role, initialPath?: string) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  const selectedProject = role === "OUTSIDER" ? isolationId : projectId;
  let phase = "navigation";
  try {
    await page.goto(initialPath || `/projects/${selectedProject}/overview`, { waitUntil: "domcontentloaded" });
    phase = "credentials";
    const emailInput = await openQaCredentials(page);
    await emailInput.fill(QA_IDENTITIES[role]);
    const password = process.env[`QA_${role}_PASSWORD`];
    expect(password, `Missing QA_${role}_PASSWORD`).toBeTruthy();
    await page.locator('input[name="password"]').fill(password!);
    phase = "session";
    await page.getByRole("button", { name: /^(Sign in|Iniciar sesión)$/i }).click();
    await expect.poll(async () => (await readQaIdentity(page)).status(), { timeout: 60_000 }).toBe(200);
    // The session cookie is usable before AuthGateway completes its reload.
    // Wait for the authenticated document before another test can navigate it.
    phase = "workspace";
    await expect(page.locator("form.auth-form")).toHaveCount(0);
    await expect(page.locator(".sidebar .profile.static")).toBeVisible();
    await expect(page.locator(".topbar h1")).toBeVisible();
    const expectedPath = new URL(initialPath || `/projects/${selectedProject}/overview`, baseURL).pathname;
    await expect(page).toHaveURL((url) => url.pathname === expectedPath);
    const identity = await readQaIdentity(page);
    expect(identity.status()).toBe(200);
    const { user } = await identity.json();
    expect(user).toMatchObject({
      email: QA_IDENTITIES[role], projectId: selectedProject,
      role: role === "OWNER" || role === "OUTSIDER" ? "admin" : role === "EDITOR" ? "editor" : "viewer",
      status: "approved", isPersonal: false,
    });
    await expect(page.locator(".sidebar .profile.static b")).toHaveText(user.name);
    return { context, page };
  } catch (error) {
    await attachQaSignInDiagnostics(page, role, phase).catch(() => undefined);
    await context.close().catch(() => undefined);
    throw error;
  }
}

async function ownerRequest(path: string, data: Record<string, unknown>) {
  const response = await sessions.OWNER!.page.request.post(path, { data });
  expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
  return response.json();
}

async function aestheticsWrite(role: AestheticsRole, write: (page: Page) => Promise<APIResponse>) {
  const page = sessions[role]!.page;
  const response = await page.request.get("/api/me");
  expect(response.status()).toBe(200);
  expect((await response.json()).user).toMatchObject({
    email: QA_IDENTITIES[role], projectId: role === "OUTSIDER" ? isolationId : projectId,
    role: role === "VIEWER" ? "viewer" : "admin", status: "approved", isPersonal: false,
  });
  return write(page);
}

async function aestheticsState(role: AestheticsRole): Promise<AestheticsState> {
  const response = await sessions[role]!.page.request.get("/api/aesthetics");
  expect(response.status()).toBe(200);
  return response.json();
}

test.beforeAll(async ({ browser }) => {
  sessions.OWNER = await signIn(browser, "OWNER");
  const me = await (await sessions.OWNER.page.request.get("/api/me")).json();
  expect(me.user).toMatchObject({ email: QA_IDENTITIES.OWNER, projectId, role: "admin", status: "approved", isPersonal: false });
  await ownerRequest("/api/qa/run", { runId, suite: "smoke", aiMode: "disabled" });
  leaseAcquired = true;
  seed = await ownerRequest("/api/qa/fixtures", { action: "reset", confirmation: "RESET QA FIXTURES" });
  const { fixtures } = await createQaFixtures(`${runId}-permissions`);
  photoFixture = fixtures.image;
  const uploaded = await sessions.OWNER.page.request.post("/api/workbook/file", { multipart: { file: { name: fixtures.workbook.name, mimeType: fixtures.workbook.mimeType, buffer: fixtures.workbook.buffer } } });
  expect(uploaded.status()).toBe(200);
  for (const role of ["EDITOR", "VIEWER", "RESTRICTED", "COMPANION", "OUTSIDER"] as const) sessions[role] = await signIn(browser, role);
});

test.afterAll(async () => {
  try {
    if (leaseAcquired && sessions.OWNER) {
      try {
        // Baseline fixture reset does not remove generated isolation-project media.
        for (const fixture of aestheticsFixtures) {
          if (fixture.imageId) {
            const removed = await aestheticsWrite(fixture.role, (page) => page.request.delete(`/api/aesthetics?type=image&id=${fixture.imageId}`));
            expect.soft(removed.status(), `Remove ${fixture.role} synthetic photo`).toBe(200);
          }
          const removed = await aestheticsWrite(fixture.role, (page) => page.request.delete(`/api/aesthetics?type=folder&id=${fixture.folderId}`));
          expect.soft(removed.status(), `Remove ${fixture.role} synthetic folder`).toBe(200);
        }
      } finally {
        // Restore all stable roles even if a revocation or media assertion failed.
        try {
          await ownerRequest("/api/qa/fixtures", { action: "reset", confirmation: "RESET QA FIXTURES" });
        } finally {
          const released = await sessions.OWNER.page.request.delete("/api/qa/run", { data: { runId } });
          expect(released.status()).toBe(200);
        }
      }
    }
  } finally {
    for (const session of Object.values(sessions)) await session?.context.close();
  }
});

test("six identities keep their stable roles across concurrent sessions", async () => {
  for (const [role, session] of Object.entries(sessions)) {
    const me = await (await session!.page.request.get("/api/me")).json();
    const expected = seed.users.find((user) => user.email === QA_IDENTITIES[role as Role])!;
    expect(me.user).toMatchObject({ email: expected.email, role: expected.role, status: "approved", projectId: expected.projectId, isPersonal: false });
  }
  const users = await sessions.OWNER!.page.request.get("/api/access");
  expect(users.status()).toBe(200);
  expect((await users.json()).users.map((user: { email: string }) => user.email)).not.toContain(QA_IDENTITIES.OUTSIDER);
});

test("editor saves a draft and a note while administrator operations remain denied", async () => {
  const page = sessions.EDITOR!.page;
  const created = await page.request.post("/api/workbook/drafts", { data: { action: "create" } });
  expect(created.status()).toBe(201);
  const draft = await created.json();
  const saved = await page.request.post("/api/workbook/drafts", { data: { action: "save", id: draft.id, revision: draft.revision, workbook: draft.workbook } });
  expect(saved.status()).toBe(200);
  expect((await saved.json()).revision).toBe(draft.revision + 1);
  expect((await page.request.post("/api/workbook/drafts", { data: { action: "publish", id: draft.id } })).status()).toBe(403);
  expect((await page.request.get("/api/access")).status()).toBe(403);
  expect((await page.request.post("/api/invitations", { data: { email: QA_IDENTITIES.VIEWER, role: "editor" } })).status()).toBe(403);
  expect((await page.request.patch("/api/access", { data: { uid: seed.users.find((user) => user.key === "viewer")!.uid, action: "approve", role: "editor" } })).status()).toBe(403);
  const note = await page.request.post("/api/notes", { data: { title: "QA stable editor", content: "Synthetic role test", aiEnabled: false } });
  expect(note.status()).toBe(201);
  await page.goto(`/projects/${projectId}/notes`);
  await expect(page.getByText("QA stable editor", { exact: true })).toBeVisible();
  await expect(page.locator(".sidebar nav").getByRole("button", { name: /Access|Acceso/ })).toHaveCount(0);
});

test("viewer reads permitted data and every checked write is rejected", async () => {
  const page = sessions.VIEWER!.page;
  for (const path of ["/api/notes", "/api/folders", "/api/files", "/api/budget"]) expect((await page.request.get(path)).status(), path).toBe(200);
  expect((await page.request.post("/api/notes", { data: { title: "Unauthorized", content: "Must not be saved", aiEnabled: false } })).status()).toBe(403);
  expect((await page.request.post("/api/folders", { data: { name: "Unauthorized", parentId: null } })).status()).toBe(403);
  expect((await page.request.post("/api/workbook/drafts", { data: { action: "create" } })).status()).toBe(403);
  expect((await page.request.delete(`/api/notes?id=${seed.fixtures.primaryNote}`)).status()).toBe(403);
  await page.goto(`/projects/${projectId}/notes`);
  await expect(page.getByText("QA synthetic permission fixture", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /New note|Nueva nota/ })).toHaveCount(0);
  await expect(page.locator(".notes-actions button")).toHaveCount(0);
  await expect(page.locator(".notes-card input[type=checkbox]").first()).toBeDisabled();
});

test("receipt and payment access remains isolated while editors record payments without a budget assignment", async () => {
  const owner = sessions.OWNER!.page;
  const editor = sessions.EDITOR!.page;
  const viewer = sessions.VIEWER!.page;
  const restricted = sessions.RESTRICTED!.page;
  const outsider = sessions.OUTSIDER!.page;
  const receipts: Array<{ page: Page; id: string; fileId: string }> = [];
  let paymentId = "";
  const listPayments = async (page: Page) => {
    const response = await page.request.get("/api/expenses/payments");
    expect(response.status()).toBe(200);
    return (await response.json()).payments as Array<{ id: string; budgetLineId: string | null; amount: number; documentIds: string[] }>;
  };
  try {
    for (const [page, selectedProject, label] of [[owner, projectId, "primary"], [outsider, isolationId, "isolation"]] as const) {
      const identity = await page.request.get("/api/me");
      expect(identity.status()).toBe(200);
      expect((await identity.json()).user.projectId).toBe(selectedProject);
      const uploaded = await page.request.post("/api/expenses/documents", { multipart: {
        title: runId + " " + label + " payment receipt",
        file: { name: photoFixture.name, mimeType: photoFixture.mimeType, buffer: photoFixture.buffer },
      } });
      expect(uploaded.status()).toBe(201);
      const created = await uploaded.json();
      const listed = await page.request.get("/api/expenses/documents");
      expect(listed.status()).toBe(200);
      const receipt = (await listed.json()).documents.find((item: { id: string }) => item.id === created.id);
      expect(receipt).toMatchObject({ amount: null, budgetLineId: null, paymentCount: 0 });
      receipts.push({ page, id: receipt.id, fileId: receipt.files[0].id });
    }
    const [primaryReceipt, isolationReceipt] = receipts;
    for (const path of ["/api/expenses/documents", "/api/expenses/payments"]) expect((await restricted.request.get(path)).status(), path).toBe(403);
    expect((await viewer.request.post("/api/expenses/payments", { data: { amount: 125, documentIds: [primaryReceipt.id] } })).status()).toBe(403);
    expect((await viewer.request.patch("/api/expenses/documents", { data: { id: primaryReceipt.id, title: "Forbidden receipt edit" } })).status()).toBe(403);
    const visibleReceipts = await viewer.request.get("/api/expenses/documents");
    expect(visibleReceipts.status()).toBe(200);
    const visibleIds = (await visibleReceipts.json()).documents.map((item: { id: string }) => item.id);
    expect(visibleIds).toContain(primaryReceipt.id);
    expect(visibleIds).not.toContain(isolationReceipt.id);
    expect((await outsider.request.get("/api/files?id=" + encodeURIComponent(primaryReceipt.fileId))).status()).toBe(404);
    expect((await owner.request.get("/api/files?id=" + encodeURIComponent(isolationReceipt.fileId))).status()).toBe(404);

    const beforePayments = await listPayments(owner);
    const beforeBudget = await (await owner.request.get("/api/budget")).json();
    expect((await owner.request.post("/api/expenses/payments", { data: { amount: 125, documentIds: [primaryReceipt.id, isolationReceipt.id] } })).status()).toBe(400);
    expect(await listPayments(owner)).toEqual(beforePayments);
    expect((await outsider.request.post("/api/expenses/payments", { data: { amount: 125, documentIds: [primaryReceipt.id] } })).status()).toBe(400);
    expect((await outsider.request.patch("/api/expenses/documents", { data: { id: primaryReceipt.id, title: "Cross-project receipt edit" } })).status()).toBe(404);

    const paymentData = { amount: 125, payee: runId + " editor unassigned payment", documentIds: [primaryReceipt.id], clientMutationId: runId + "-editor-payment" };
    const createdPayment = await editor.request.post("/api/expenses/payments", { data: paymentData });
    expect(createdPayment.status()).toBe(201);
    paymentId = (await createdPayment.json()).id;
    const retriedPayment = await editor.request.post("/api/expenses/payments", { data: paymentData });
    expect(retriedPayment.status()).toBe(200);
    expect(await retriedPayment.json()).toMatchObject({ id: paymentId, duplicate: true });
    expect((await listPayments(owner)).filter((item) => item.id === paymentId)).toHaveLength(1);
    expect((await listPayments(owner)).find((item) => item.id === paymentId)).toMatchObject({ budgetLineId: null, amount: 125, documentIds: [primaryReceipt.id] });
    expect((await (await owner.request.get("/api/budget")).json()).spent).toBe(beforeBudget.spent);
    expect((await viewer.request.delete("/api/expenses/payments?id=" + encodeURIComponent(paymentId))).status()).toBe(403);
    expect((await outsider.request.delete("/api/expenses/payments?id=" + encodeURIComponent(paymentId))).status()).toBe(404);
    expect((await owner.request.patch("/api/expenses/payments", { data: { id: paymentId, amount: 125, documentIds: [primaryReceipt.id, isolationReceipt.id] } })).status()).toBe(400);
    expect((await listPayments(owner)).find((item) => item.id === paymentId)?.documentIds).toEqual([primaryReceipt.id]);
    expect((await listPayments(outsider)).some((item) => item.id === paymentId)).toBe(false);
  } finally {
    if (paymentId) expect((await owner.request.delete("/api/expenses/payments?id=" + encodeURIComponent(paymentId))).status()).toBe(200);
    for (const receipt of receipts) expect((await receipt.page.request.delete("/api/expenses/documents?id=" + encodeURIComponent(receipt.id))).status()).toBe(200);
  }
});

test("restricted viewer sees its selected folder and cannot use hidden sections or direct file URLs", async () => {
  const page = sessions.RESTRICTED!.page;
  const documents = await (await page.request.get("/api/files")).json();
  expect(documents.documents.map((document: { id: string }) => document.id)).toContain(seed.fixtures.visibleDocument);
  expect(documents.documents.map((document: { id: string }) => document.id)).not.toContain(seed.fixtures.hiddenDocument);
  expect((await page.request.get(`/api/files?id=${seed.fixtures.visibleDocument}`)).status()).toBe(200);
  expect((await page.request.get(`/api/files?id=${seed.fixtures.hiddenDocument}`)).status()).toBe(404);
  for (const path of ["/api/budget", "/api/quotes", "/api/expenses", "/api/aesthetics"]) expect((await page.request.get(path)).status(), path).toBe(403);
  expect((await page.request.get(`/api/aesthetics/archive?folderId=${seed.fixtures.visibleFolder}`)).status()).toBe(403);
  await page.goto(`/projects/${projectId}/documents`);
  await expect(page.getByText("QA visible fixture", { exact: true })).toBeVisible();
  await expect(page.getByText("QA restricted fixture", { exact: true })).toHaveCount(0);
  await page.goto(`/projects/${projectId}/quotes`);
  await expect(page.getByText(/Section access required|No tienes acceso a esta sección/, { exact: true })).toBeVisible();
});

test("other-project administrator cannot read records, download files, mutate notes, or switch projects", async () => {
  const outsider = sessions.OUTSIDER!.page;
  expect((await outsider.request.get(`/api/files?id=${seed.fixtures.visibleDocument}`)).status()).toBe(404);
  expect((await outsider.request.patch("/api/notes", { data: { id: seed.fixtures.primaryNote, title: "Cross-project write", content: "Must not change", aiEnabled: false } })).status()).toBe(404);
  expect((await outsider.request.patch("/api/projects", { data: { action: "switch", projectId } })).status()).toBe(403);
  const projects = await (await outsider.request.get("/api/projects")).json();
  expect(projects.projects.map((project: { id: string }) => project.id)).not.toContain(projectId);
  const notes = await (await outsider.request.get("/api/notes")).json();
  expect(notes.notes.map((note: { id: string }) => note.id)).toContain(seed.fixtures.isolationNote);
  expect(notes.notes.map((note: { id: string }) => note.id)).not.toContain(seed.fixtures.primaryNote);
  expect((await sessions.OWNER!.page.request.get(`/api/files?id=${seed.fixtures.isolationDocument}`)).status()).toBe(404);
  expect((await sessions.OWNER!.page.request.patch("/api/projects", { data: { action: "switch", projectId: isolationId } })).status()).toBe(403);
  await outsider.goto(`/projects/${projectId}/documents`);
  await expect(outsider.getByText(/Project access required|No tienes acceso a este proyecto/, { exact: true })).toBeVisible();
  await expect(outsider.getByText("QA visible fixture", { exact: true })).toHaveCount(0);
});

test("Aesthetics rejects foreign carousel IDs, media mutations, and downloads in both projects", async () => {
  // The preceding denied route selected qa-primary for the outsider. Restore
  // each actor's permitted route and verify its membership before every write.
  for (const role of ["OWNER", "OUTSIDER"] as const) {
    const selectedProject = role === "OUTSIDER" ? isolationId : projectId;
    const page = sessions[role]!.page;
    await page.goto(`/projects/${selectedProject}/overview`, { waitUntil: "domcontentloaded" });
    await expect.poll(async () => {
      const response = await page.request.get("/api/me");
      return response.status() === 200 ? (await response.json()).user : null;
    }).toMatchObject({ email: QA_IDENTITIES[role], projectId: selectedProject, role: "admin", status: "approved", isPersonal: false });
    const name = `QA ${role} carousel ${runId}`.slice(0, 80);
    const created = await aestheticsWrite(role, (actor) => actor.request.post("/api/aesthetics", { data: { action: "create_folder", name, parentId: null } }));
    expect(created.status()).toBe(201);
    const folder = (await created.json()).folder;
    expect(folder.id).toEqual(expect.any(String));
    const fixture: AestheticsFixture = { role, folderId: folder.id, name, caption: `QA synthetic ${role} photo` };
    aestheticsFixtures.push(fixture);
    const uploaded = await aestheticsWrite(role, (actor) => actor.request.post("/api/aesthetics", { multipart: {
      folderId: fixture.folderId, caption: fixture.caption,
      file: { name: photoFixture.name, mimeType: photoFixture.mimeType, buffer: photoFixture.buffer },
    } }));
    expect(uploaded.status()).toBe(201);
    fixture.imageId = (await uploaded.json()).image.id;
    expect(fixture.imageId).toEqual(expect.any(String));
    const selected = await aestheticsWrite(role, (actor) => actor.request.patch("/api/aesthetics", { data: { action: "carousel", id: fixture.folderId, imageIds: [fixture.imageId] } }));
    expect(selected.status()).toBe(200);
  }

  const owner = aestheticsFixtures.find((fixture) => fixture.role === "OWNER")!;
  const outsider = aestheticsFixtures.find((fixture) => fixture.role === "OUTSIDER")!;
  for (const [local, foreign] of [[owner, outsider], [outsider, owner]] as const) {
    const rejected = await aestheticsWrite(local.role, (page) => page.request.patch("/api/aesthetics", { data: { action: "carousel", id: local.folderId, imageIds: [local.imageId, foreign.imageId] } }));
    expect(rejected.status(), `${local.role} rejects a foreign carousel image`).toBe(400);
    expect((await aestheticsState(local.role)).folders.find((folder) => folder.id === local.folderId)?.carouselImageIds).toEqual([local.imageId]);

    for (const data of [
      { action: "carousel", id: foreign.folderId, imageIds: [local.imageId] },
      { action: "rename_folder", id: foreign.folderId, name: "Unauthorized cross-project rename" },
      { action: "caption", id: foreign.imageId, caption: "Unauthorized cross-project caption" },
      { action: "notes", id: foreign.imageId, notes: "Unauthorized cross-project notes" },
      { action: "move_image", id: foreign.imageId, folderId: local.folderId },
      { action: "move_image", id: local.imageId, folderId: foreign.folderId },
    ]) {
      const denied = await aestheticsWrite(local.role, (page) => page.request.patch("/api/aesthetics", { data }));
      expect(denied.status(), `${local.role}: ${data.action}`).toBe(404);
    }
    for (const [type, id] of [["image", foreign.imageId], ["folder", foreign.folderId]]) {
      const denied = await aestheticsWrite(local.role, (page) => page.request.delete(`/api/aesthetics?type=${type}&id=${id}`));
      expect(denied.status(), `${local.role} cannot delete a foreign ${type}`).toBe(404);
    }
    for (const suffix of ["", "?thumb=1"]) {
      expect((await sessions[local.role]!.page.request.get(`/api/aesthetics/image/${foreign.imageId}${suffix}`)).status(), `${local.role} cannot download foreign media ${suffix}`).toBe(404);
    }
    expect((await sessions[local.role]!.page.request.get(`/api/aesthetics/archive?folderId=${foreign.folderId}`)).status(), `${local.role} cannot archive a foreign folder`).toBe(404);
  }

  const deniedCreate = await aestheticsWrite("VIEWER", (page) => page.request.post("/api/aesthetics", { data: { action: "create_folder", name: "Unauthorized viewer photo folder", parentId: null } }));
  expect(deniedCreate.status()).toBe(403);
  const deniedUpload = await aestheticsWrite("VIEWER", (page) => page.request.post("/api/aesthetics", { multipart: {
    folderId: owner.folderId,
    file: { name: photoFixture.name, mimeType: photoFixture.mimeType, buffer: photoFixture.buffer },
  } }));
  expect(deniedUpload.status()).toBe(403);
  for (const data of [
    { action: "carousel", id: owner.folderId, imageIds: [] },
    { action: "rename_folder", id: owner.folderId, name: "Unauthorized viewer rename" },
    { action: "caption", id: owner.imageId, caption: "Unauthorized viewer caption" },
    { action: "notes", id: owner.imageId, notes: "Unauthorized viewer notes" },
    { action: "move_image", id: owner.imageId, folderId: owner.folderId },
  ]) {
    const denied = await aestheticsWrite("VIEWER", (page) => page.request.patch("/api/aesthetics", { data }));
    expect(denied.status(), `VIEWER: ${data.action}`).toBe(403);
  }
  for (const [type, id] of [["image", owner.imageId], ["folder", owner.folderId]]) {
    const denied = await aestheticsWrite("VIEWER", (page) => page.request.delete(`/api/aesthetics?type=${type}&id=${id}`));
    expect(denied.status(), `VIEWER cannot delete a ${type}`).toBe(403);
  }

  for (const [local, foreign] of [[owner, outsider], [outsider, owner]] as const) {
    const state = await aestheticsState(local.role);
    expect(state.folders.find((folder) => folder.id === local.folderId)).toMatchObject({ name: local.name, carouselImageIds: [local.imageId] });
    expect(state.images.find((image) => image.id === local.imageId)).toMatchObject({ folderId: local.folderId, caption: local.caption, notes: "" });
    expect(state.folders.map((folder) => folder.id)).not.toContain(foreign.folderId);
    expect(state.images.map((image) => image.id)).not.toContain(foreign.imageId);
  }
});

test("revocation blocks the active lifecycle session and approval restores access", async () => {
  const owner = sessions.OWNER!.page;
  const companion = sessions.COMPANION!.page;
  const uid = seed.users.find((user) => user.key === "companion")!.uid;
  expect((await companion.request.get("/api/files")).status()).toBe(200);
  expect((await owner.request.patch("/api/access", { data: { uid, action: "revoke", role: "viewer" } })).status()).toBe(200);
  expect((await companion.request.get("/api/files")).status()).toBe(401);
  expect((await companion.request.get("/api/notes")).status()).toBe(403);
  const pending = await (await companion.request.get("/api/me")).json();
  expect(pending.user).toMatchObject({ email: QA_IDENTITIES.COMPANION, projectId, status: "pending" });
  expect((await owner.request.patch("/api/access", { data: { uid, action: "approve", role: "viewer" } })).status()).toBe(200);
  await expect.poll(async () => (await companion.request.get("/api/files")).status()).toBe(200);
  expect((await sessions.VIEWER!.page.request.get("/api/files")).status()).toBe(200);
});

test("featured documents use current Documents grants and preserve other selections across the six-user fixture lifecycle", async () => {
  const endpoint = "/api/documents/featured";
  const owner = sessions.OWNER!.page, editor = sessions.EDITOR!.page, restricted = sessions.RESTRICTED!.page, outsider = sessions.OUTSIDER!.page;
  const visible = seed.fixtures.visibleDocument, hidden = seed.fixtures.hiddenDocument;
  const read = async (page: Page): Promise<string[]> => {
    const response = await page.request.get(endpoint);
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    const body = await response.json();
    expect(Array.isArray(body.documentIds)).toBe(true);
    return body.documentIds;
  };
  const change = (page: Page, addIds: string[], removeIds: string[] = []) => page.request.patch(endpoint, { data: { addIds, removeIds } });
  await outsider.goto(`/projects/${isolationId}/overview`, { waitUntil: "domcontentloaded" });
  expect((await (await outsider.request.get("/api/me")).json()).user).toMatchObject({ projectId: isolationId, role: "admin", status: "approved" });
  const beforePrimary = await read(owner), beforeIsolation = await read(outsider);
  const beforeRestricted = (await (await restricted.request.get("/api/me")).json()).user as {
    uid?: string; role: "admin" | "editor" | "viewer"; permissions: Record<string, boolean>;
    folderAccess: { mode: "all" | "selected"; folderIds: string[]; allowUnfiled: boolean };
  };
  const restrictedUid = seed.users.find(user => user.key === "restricted")!.uid;
  const fileBefore = await (await owner.request.get(`/api/files?id=${encodeURIComponent(visible)}`)).body();
  const documentsBefore = (await (await owner.request.get("/api/files")).json()).documents as Array<{ id: string; name: string; folderId: string | null }>;
  const visibleName = documentsBefore.find(document => document.id === visible)!.name;
  const hiddenName = documentsBefore.find(document => document.id === hidden)!.name;
  try {
    expect((await change(owner, [], beforePrimary)).status()).toBe(200);
    expect((await change(owner, [hidden])).status()).toBe(200);
    expect((await change(editor, [visible])).status()).toBe(200);
    expect(await read(owner)).toEqual([hidden, visible]);
    expect(await read(restricted)).toEqual([visible]);
    for (const role of ["VIEWER", "COMPANION"] as const) {
      expect(await read(sessions[role]!.page)).toEqual([hidden, visible]);
      expect((await change(sessions[role]!.page, [], [visible])).status()).toBe(403);
    }
    await owner.goto(`/projects/${projectId}/documents`);
    await expect(owner.locator(".featured-documents-panel .doc-row")).toHaveCount(2);
    await owner.reload({ waitUntil: "domcontentloaded" });
    await expect(owner.locator(".featured-documents-panel").getByText(visibleName, { exact: true })).toBeVisible();
    await expect(owner.locator(".featured-documents-panel").getByText(hiddenName, { exact: true })).toBeVisible();
    expect(await read(owner)).toEqual([hidden, visible]);

    for (const [page, additions, removals] of [
      [owner, [seed.fixtures.isolationDocument], [visible]],
      [owner, [`qa-featured-unavailable-${Date.now()}`], [hidden]],
      [outsider, [seed.fixtures.isolationDocument, visible], []],
    ] as Array<[Page, string[], string[]]>) {
      const response = await change(page, additions, removals);
      expect(response.status()).toBe(403);
      expect(await response.json()).toEqual({ error: "One or more requested documents are unavailable" });
      expect(await read(owner)).toEqual([hidden, visible]);
      expect(await read(outsider)).toEqual(beforeIsolation);
    }

    expect((await owner.request.patch("/api/access", { data: { uid: restrictedUid, action: "approve", role: "editor" } })).status()).toBe(200);
    expect((await owner.request.patch("/api/access", { data: { uid: restrictedUid, action: "permissions", permissions: { ...beforeRestricted.permissions, overview: false, documents: true } } })).status()).toBe(200);
    expect((await restricted.request.get("/api/overview")).status()).toBe(403);
    expect(await read(restricted)).toEqual([visible]);
    for (const [additions, removals] of [[[hidden], []], [[], [hidden]]] as Array<[string[], string[]]>) {
      expect((await change(restricted, additions, removals)).status()).toBe(403);
      expect(await read(owner)).toEqual([hidden, visible]);
    }
    expect((await change(restricted, [], [visible])).status()).toBe(200);
    expect(await read(restricted)).toEqual([]);
    expect(await read(owner)).toEqual([hidden]);
    expect((await change(restricted, [visible])).status()).toBe(200);
    expect(await read(owner)).toEqual([hidden, visible]);
    const documentsAfter = (await (await owner.request.get("/api/files")).json()).documents as Array<{ id: string; name: string; folderId: string | null }>;
    for (const id of [visible, hidden]) expect(documentsAfter.find(document => document.id === id)?.folderId).toBe(documentsBefore.find(document => document.id === id)?.folderId);
    expect(await (await owner.request.get(`/api/files?id=${encodeURIComponent(visible)}`)).body()).toEqual(fileBefore);
    expect((await owner.request.patch("/api/access", { data: { uid: restrictedUid, action: "revoke", role: "editor" } })).status()).toBe(200);
    expect((await change(restricted, [], [visible])).status()).toBe(403);
    expect(await read(owner)).toEqual([hidden, visible]);
  } finally {
    try {
      expect.soft((await owner.request.patch("/api/access", { data: { uid: restrictedUid, action: "approve", role: beforeRestricted.role } })).status(), "Restore restricted fixture role").toBe(200);
      expect.soft((await owner.request.patch("/api/access", { data: { uid: restrictedUid, action: "permissions", permissions: beforeRestricted.permissions } })).status(), "Restore restricted fixture permissions").toBe(200);
      expect.soft((await owner.request.patch("/api/access", { data: { uid: restrictedUid, action: "folders", folderAccess: beforeRestricted.folderAccess } })).status(), "Restore restricted fixture folder grants").toBe(200);
    } finally {
      for (const [page, saved] of [[owner, beforePrimary], [outsider, beforeIsolation]] as Array<[Page, string[]]>) {
        expect((await change(page, [], await read(page))).status()).toBe(200);
        expect((await change(page, saved)).status()).toBe(200);
        expect(await read(page)).toEqual(saved);
      }
    }
  }
});
