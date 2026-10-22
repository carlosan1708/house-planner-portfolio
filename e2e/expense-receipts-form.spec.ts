import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";

// Browser coverage uses the real component with isolated in-memory API data.
let server: Server, address: string;
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2S8AAAAASUVORK5CYII=", "base64");
const media = { id: "file", name: "Factura.jpg", contentType: "image/jpeg", size: 100, createdAt: "2026-10-15", isImage: true, thumbnailUrl: "/api/files?id=file", previewUrl: "/api/files?id=file" };
const receipt = { id: "receipt-1", title: "Factura compartida", documentType: "invoice", documentDate: "", vendor: "Tienda", reference: "", notes: "", amount: null, currency: "CRC", purchaseId: null, purchaseTitle: "", budgetLineIds: [], budgetLines: [], budgetLineId: null, budgetLineLabel: "", files: [media], createdAt: "", updatedAt: "" };
const purchase = { id: "purchase", title: "Materiales para pisos", purchaseDate: "", vendor: "Tienda", reference: "", notes: "", amount: 1000, currency: "CRC", budgetLineId: null, budgetLineLabel: "", coverPhotoId: null, photos: [], documentCount: 0, createdAt: "", updatedAt: "" };
const payment = { id: "old-payment", budgetLineId: null, budgetLineLabel: "", purchaseId: "purchase", amount: 400, paymentDate: "2026-10-15", payee: "Primer abono", reference: "", notes: "", documentId: null, documentTitle: "", documentType: null, documentIds: [] as string[], accountingMode: "ledger", paymentKind: "partial", createdAt: "", updatedAt: "" };

test.beforeAll(async () => {
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import ExpensesWorkspace from './app/components/ExpensesWorkspace'; createRoot(document.getElementById('root')).render(<main style={{padding:16}}><ExpensesWorkspace mode="real" language="es" isOwner projectId="synthetic-project"/></main>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, outfile: "receipt-ui.js", platform: "browser", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "receipt-image", setup(builder) { builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: "next/image", namespace: "receipt-mock" })); builder.onLoad({ filter: /.*/, namespace: "receipt-mock" }, () => ({ contents: "import React from 'react'; export default function Image({unoptimized,fill,priority,...props}){return <img {...props}/>;}", loader: "tsx", resolveDir: process.cwd() })); } }] });
  const css = await readFile("app/globals.css", "utf8") + (bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text || "");
  const javascript = bundle.outputFiles.find((file) => file.path.endsWith(".js"))!.text;
  server = createServer((request, response) => { if (request.url === "/receipt-ui.js") { response.setHeader("content-type", "text/javascript"); response.end(javascript); } else { response.setHeader("content-type", "text/html"); response.end(`<html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--font-geist-sans:Arial;--font-geist-mono:monospace}${css}</style><div id="root"></div><script src="/receipt-ui.js"></script></html>`); } });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done)); address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>((done) => server.close(() => done())); });

async function mockApi(page: Page, agreedTotal = 1000, options: { paymentsModelVersion?: 2; excelImport?: boolean } = {}) {
  const calls: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
  let payments = [structuredClone(payment)], documents = Array.from({ length: 18 }, (_, index) => ({ ...receipt, id: `receipt-${index + 1}`, title: index ? `Comprobante de materiales con nombre largo ${index + 1}` : receipt.title }));
  if (options.excelImport) Object.assign(payments[0], { source: "excel-import", accountingMode: "historical-detail", budgetLineId: "import-line", purchaseId: null, payee: "", paymentDate: "", documentIds: [receipt.id] });
  await page.route("**/api/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/api/files") return route.fulfill({ contentType: "image/png", body: image });
    const json = request.headers()["content-type"]?.includes("application/json") ? request.postDataJSON() : undefined;
    if (request.method() !== "GET") calls.push({ path, method: request.method(), body: json });
    if (path === "/api/expenses/documents") {
      if (request.method() === "POST") { documents = [...documents, { ...receipt, id: "uploaded", title: "Comprobante nuevo.png" }]; return route.fulfill({ json: { id: "uploaded" } }); }
      return route.fulfill({ json: { documents, purchases: [purchase] } });
    }
    if (path === "/api/expenses/purchases") return route.fulfill({ json: { purchases: [{ ...purchase, amount: agreedTotal }] } });
    if (path === "/api/expenses/payments") {
      if (request.method() === "POST") { payments = [...payments, { ...payment, ...json, id: "new-payment" }]; return route.fulfill({ json: { id: "new-payment" } }); }
      if (request.method() === "PATCH") { payments = payments.map((item) => item.id === json.id ? { ...item, ...json } : item); return route.fulfill({ json: { ok: true } }); }
      if (request.method() === "DELETE") { payments = payments.filter((item) => item.id !== new URL(request.url()).searchParams.get("id")); return route.fulfill({ json: { ok: true } }); }
      return route.fulfill({ json: { payments, completedLineIds: options.excelImport ? ["import-line"] : [], ...(options.paymentsModelVersion === 2 ? { paymentsModelVersion: 2 } : {}) } });
    }
    const total = options.excelImport ? payments.reduce((sum, item) => sum + item.amount, 0) : 0;
    return route.fulfill({ json: { expenses: options.excelImport ? [{ id: "import-line", budgetLineId: "import-line", description: "Importación de pisos", chapter: "Acabados", subcategory: "Pisos", vendor: "", amount: total, attachments: [] }] : [], budgetLines: options.excelImport ? [{ id: "import-line", item: "Importación de pisos", chapter: "Acabados", paid: total, supplier: "" }] : [], summary: { total } } });
  });
  return calls;
}

test("keeps imported v2 payments visible and edits or deletes the same record from the combined view", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await mockApi(page, 1000, { paymentsModelVersion: 2, excelImport: true });
  await page.goto(address);
  await page.getByRole("button", { name: "Partidas pagadas", exact: true }).click();
  const card = page.locator(".paid-line");
  await card.locator(":scope > summary").click();
  await expect(card).toContainText("Pago de Excel sin detalle");
  await expect(card.getByRole("checkbox")).toHaveCount(0);
  await expect(card).not.toContainText("El importe histórico de Excel ya está incluido");
  await expect(card.locator(".payment-list .payment-item")).toHaveCount(1);
  await card.getByRole("button", { name: "Editar", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Pago", exact: true });
  await expect(form.getByRole("heading", { name: "Pago de Excel sin detalle", exact: true })).toBeVisible();
  await expect(form.getByLabel("Fecha", { exact: true })).toHaveValue("");
  await expect(form.getByRole("combobox", { name: "Aplicación al presupuesto", exact: true })).toHaveCount(0);
  await expect(form.getByLabel("Comprobantes de este pago", { exact: true })).toContainText(receipt.title);
  await form.locator('input[name="expense-payment-crc-amount"]').fill("350");
  await expect(form.getByRole("status", { name: "Pagado después de guardar", exact: true })).toHaveText("₡350");
  await form.getByRole("button", { name: "Guardar pago", exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ method: "PATCH", path: "/api/expenses/payments", body: { id: payment.id, amount: 350, paymentDate: "", documentIds: [receipt.id], paymentsModelVersion: 2 } });
  expect(calls[0].body).not.toHaveProperty("accountingMode");
  const saved = page.locator(".payment-item").filter({ hasText: "Pago de Excel sin detalle" });
  await expect(saved).toContainText("₡350");
  page.once("dialog", (dialog) => dialog.accept());
  await saved.getByRole("button", { name: "Eliminar", exact: true }).click();
  await expect(saved).toHaveCount(0);
  expect(calls).toHaveLength(2);
  expect(calls[1]).toMatchObject({ method: "DELETE", path: "/api/expenses/payments", body: { paymentsModelVersion: 2 } });
  await assertNoOverflow(page);
});

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`selects photos and stages new receipts with one unassigned payment at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport); const calls = await mockApi(page); await page.goto(address);
    await page.getByRole("button", { name: "Registrar pago", exact: true }).first().click(); const dialog = page.getByRole("dialog", { name: "Pago", exact: true });
    await dialog.locator('input[name="expense-payment-crc-amount"]').fill("250"); await dialog.getByRole("button", { name: "Elegir comprobantes existentes", exact: true }).click();
    const photo = dialog.getByRole("button", { name: receipt.title, exact: true }); await photo.click(); await expect(photo).toHaveAttribute("aria-pressed", "true"); await expect(photo.locator("img")).toHaveAttribute("src", media.thumbnailUrl);
    await dialog.locator('input[type="file"]').setInputFiles({ name: "Comprobante nuevo.png", mimeType: "image/png", buffer: image }); expect(calls).toEqual([]);
    const fields = dialog.locator(".expense-form-fields"); await fields.evaluate((element) => { element.scrollTop = element.scrollHeight; }); await dialog.locator(".expense-receipt-picker-grid").evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const save = dialog.getByRole("button", { name: "Guardar pago", exact: true }); await expect(save).toBeInViewport(); await expect(dialog.getByRole("button", { name: "Cancelar", exact: true })).toBeInViewport();
    expect(await dialog.locator(".expense-form").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true); await assertNoOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`payment-receipts-${viewport.width}.png`), fullPage: true }); await save.click(); await expect(dialog).toHaveCount(0);
    const paymentCalls = calls.filter((call) => call.path === "/api/expenses/payments"); expect(paymentCalls).toHaveLength(1); expect(paymentCalls[0].body).toMatchObject({ amount: 250, budgetLineId: null, purchaseId: null, documentIds: [receipt.id, "uploaded"] }); expect(calls.filter((call) => call.path === "/api/expenses/documents")).toHaveLength(1);
    await expect(page.locator(".payment-ledger")).toContainText("Comprobante nuevo.png"); await assertNoOverflow(page);
  });
}

test("uploads without a payment and links the pending receipt to an existing unassigned payment", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const calls = await mockApi(page); await page.goto(address); await page.getByRole("button", { name: "Subir comprobantes", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Comprobante", exact: true }); await expect(dialog).toContainText("No hace falta indicar monto, abono ni partida"); await expect(dialog.getByLabel("Partida", { exact: false })).toHaveCount(0);
  await dialog.locator('input[type="file"]').setInputFiles({ name: "Comprobante nuevo.png", mimeType: "image/png", buffer: image }); await dialog.getByRole("button", { name: "Guardar comprobante", exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(calls.map((call) => call.path)).toEqual(["/api/expenses/documents"]); const card = page.locator(".document-card").filter({ has: page.getByRole("heading", { name: "Comprobante nuevo.png", exact: true }) }); await expect(card).toContainText("Pendiente de vincular");
  await card.getByRole("button", { name: "Vincular a pago", exact: true }).click(); const chooser = page.getByRole("dialog", { name: "Vincular comprobante a un pago" }); await chooser.locator(".receipt-payment-options button").click(); await expect(chooser).toHaveCount(0);
  expect(calls[1].body).toMatchObject({ id: payment.id, amount: 400, budgetLineId: null, documentIds: ["uploaded"] }); await expect(card).toContainText("En 1 pago");
});

test("settles a purchase with its own remaining balance", async ({ page }) => {
  const calls = await mockApi(page); await page.goto(address); await page.locator(".purchase-card").getByRole("button", { name: "Pagar saldo", exact: true }).click(); const dialog = page.getByRole("dialog", { name: "Pago", exact: true });
  await expect(dialog.locator('input[name="expense-payment-crc-amount"]')).toHaveValue("600"); await expect(dialog.getByLabel("Partida (opcional)")).toHaveValue(""); await dialog.getByRole("button", { name: "Guardar pago", exact: true }).click();
  expect(calls[0].body).toMatchObject({ purchaseId: purchase.id, amount: 600, budgetLineId: null, paymentKind: "settlement" });
});

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`records a manual full payment without a purchase at ${viewport.width}x${viewport.height}`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ viewport, hasTouch: viewport.width < 1000, isMobile: viewport.width < 1000 });
    const page = await context.newPage();
    try {
      const calls = await mockApi(page); await page.goto(address);
      await page.getByRole("button", { name: "Registrar pago", exact: true }).first().click();
      const dialog = page.getByRole("dialog", { name: "Pago", exact: true });
      const kind = dialog.getByRole("combobox", { name: "Tipo de pago", exact: true });
      const amount = dialog.locator('input[name="expense-payment-crc-amount"]');
      await expect(kind.locator('option[value="settlement"]')).toBeEnabled();
      await expect(kind.locator('option[value="settlement"]')).toHaveText("Pago total");
      await kind.selectOption("settlement");
      await expect(amount).toHaveValue("");
      await expect(dialog).toContainText("Sin compra vinculada se usa el monto ingresado.");
      await amount.fill("250");
      await kind.selectOption("partial"); await expect(amount).toHaveValue("250");
      await kind.selectOption("settlement"); await expect(amount).toHaveValue("250");
      await dialog.getByLabel("Descripción (opcional)", { exact: true }).fill("Pago total manual");
      await dialog.getByRole("button", { name: "Elegir comprobantes existentes", exact: true }).click();
      await dialog.getByRole("button", { name: receipt.title, exact: true }).click();
      const save = dialog.getByRole("button", { name: "Guardar pago", exact: true });
      await expect(save).toBeInViewport(); await assertNoOverflow(page);
      await kind.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`manual-full-payment-${viewport.width}.png`) });
      await save.click(); await expect(dialog).toHaveCount(0);
      const paymentCalls = calls.filter((call) => call.path === "/api/expenses/payments");
      expect(paymentCalls).toHaveLength(1);
      expect(paymentCalls[0].body).toMatchObject({ amount: 250, paymentKind: "settlement", purchaseId: null, budgetLineId: null, documentIds: [receipt.id] });
      const row = page.locator(".payment-item").filter({ hasText: "Pago total manual" });
      await expect(row.getByText("Pago total", { exact: true })).toBeVisible();
      await expect(row).not.toContainText("Pago de saldo");
      await row.getByRole("button", { name: "Editar", exact: true }).click();
      await expect(kind).toHaveValue("settlement"); await expect(amount).toHaveValue("250");
      await expect(dialog.getByLabel("Comprobantes de este pago", { exact: true })).toContainText(receipt.title);
      await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    } finally { await context.close(); }
  });
}

test("uses a purchase balance only while that purchase is linked to the full payment", async ({ page }) => {
  const calls = await mockApi(page); await page.goto(address);
  await page.getByRole("button", { name: "Registrar pago", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Pago", exact: true });
  const kind = dialog.getByRole("combobox", { name: "Tipo de pago", exact: true }), amount = dialog.locator('input[name="expense-payment-crc-amount"]');
  await amount.fill("250"); await kind.selectOption("settlement"); await expect(amount).toHaveValue("250");
  const linkedPurchase = dialog.getByLabel("Compra (opcional)");
  await linkedPurchase.selectOption(purchase.id);
  await expect(kind.locator('option[value="settlement"]')).toHaveText("Pago de saldo");
  await expect(amount).toHaveValue("600");
  await linkedPurchase.selectOption("");
  await expect(kind.locator('option[value="settlement"]')).toHaveText("Pago total");
  await expect(amount).toHaveValue("600");
  await expect(dialog).toContainText("Sin compra vinculada se usa el monto ingresado.");
  await dialog.getByRole("button", { name: "Guardar pago", exact: true }).click();
  expect(calls[0].body).toMatchObject({ amount: 600, purchaseId: null, paymentKind: "settlement" });
});

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`native touch scrolls payment fields at ${viewport.width}x${viewport.height}`, async ({ page, context }) => {
    await page.setViewportSize(viewport); await mockApi(page); await page.goto(address);
    await page.getByRole("button", { name: "Registrar pago", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Pago", exact: true }), fields = dialog.locator(".expense-form-fields");
    const bounds = await fields.boundingBox(); expect(bounds).not.toBeNull();
    const x = bounds!.x + bounds!.width - 10, startY = bounds!.y + bounds!.height - 22, endY = bounds!.y + 22;
    const session = await context.newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: startY }] });
    for (let step = 1; step <= 8; step++) await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: startY + (endY - startY) * step / 8 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => fields.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(dialog.getByRole("button", { name: "Guardar pago", exact: true })).toBeInViewport();
    await assertNoOverflow(page); await session.detach();
  });
}

async function assertNoOverflow(page: Page) {
  const overflow = await page.locator("body *").evaluateAll((elements) => elements.filter((element) => element.getBoundingClientRect().right > innerWidth + 1).map((element) => ({ tag: element.tagName, cls: element.className, width: element.getBoundingClientRect().width, right: element.getBoundingClientRect().right, text: element.textContent?.slice(0, 90) })).slice(0, 14));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), JSON.stringify(overflow)).toBe(true);
}

test("preserves an exact decimal settlement and turns a smaller edited amount into an installment", async ({ page }) => {
  const calls = await mockApi(page, 1000.75); await page.goto(address);
  await page.locator(".purchase-card").getByRole("button", { name: "Pagar saldo", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Pago", exact: true });
  await expect(dialog.locator('input[name="expense-payment-crc-amount"]')).toHaveValue("600.75");
  await dialog.getByRole("button", { name: "Guardar pago", exact: true }).click();
  expect(calls[0].body).toMatchObject({ purchaseId: purchase.id, amount: 600.75, paymentKind: "settlement" });

  await page.reload(); await page.locator(".expense-tabs").getByRole("button", { name: /Productos/ }).click();
  // A new isolated API fixture gives the second scenario its original balance.
  await page.unroute("**/api/**"); const partialCalls = await mockApi(page, 1000.75); await page.reload();
  await page.locator(".purchase-card").getByRole("button", { name: "Pagar saldo", exact: true }).click();
  await dialog.locator('input[name="expense-payment-crc-amount"]').fill("300.25");
  await expect(dialog.getByLabel("Tipo de pago")).toHaveValue("partial");
  await dialog.getByRole("button", { name: "Guardar pago", exact: true }).click();
  expect(partialCalls[0].body).toMatchObject({ amount: 300.25, paymentKind: "partial" });
});
