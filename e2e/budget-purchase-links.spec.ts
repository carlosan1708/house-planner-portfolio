import { expect, test, type Page, type Route } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import type { UniverWorkbook } from "../lib/workbook";

let server: Server, address: string;
const stamp = "2026-10-14T12:00:00Z";
const line = { id: "floor / 1", row: 4, chapter: "Pisos", item: "Porcelanato para baño principal", supplier: "Proveedor de pisos", paid: 15000, objective: 50000, quote: 50000, excess: 0, type: "Material", subcategory: "Baño", status: "En progreso" };
const other = { ...line, id: "roof", row: 5, chapter: "Techo", item: "Cubierta" };
const unpaid = { ...line, id: "unpaid", row: 6, item: "Partida sin pagos", paid: 0 };
const summary = { label: "Pisos", objective: 50000, spent: 15000, excess: 0, count: 1 };
const budget = { currency: "CRC", objective: 150000, spent: 30000, remaining: 120000, excess: 0, percentUsed: 20, status: "within_objective", lines: [line, other, unpaid], summaries: { chapter: [summary], type: [summary], subcategory: [summary] }, unsupported: [], editingAllowed: true, planVersion: 1, actualsRevision: 1 };
const workbook: UniverWorkbook = { id: "book", name: "Budget", sheetOrder: ["budget"], sheets: { budget: { id: "budget", name: "Pisos", rowCount: 20, columnCount: 27, cellData: { 2: { 4: { v: "Objetivo" } }, 3: { 0: { v: line.chapter }, 1: { v: line.item }, 4: { v: line.objective }, 6: { v: line.quote }, 8: { v: line.status }, 9: { v: line.paid }, 25: { v: line.id } } }, mergeData: [], rowData: {}, columnData: {} } } };
const purchase = { id: "purchase-floor", title: "Compra de porcelanato", purchaseDate: "2026-10-14", vendor: "Proveedor", reference: "OC-1", notes: "", amount: 15000, currency: "CRC", budgetLineId: line.id, budgetLineLabel: line.item, coverPhotoId: null, photos: [], documentCount: 1, createdAt: stamp, updatedAt: stamp };
const invoice = { id: "invoice-floor", title: "Factura de porcelanato para baño y áreas de servicio con nombre extenso", documentType: "invoice", documentDate: "2026-10-14", vendor: "Proveedor", reference: "F-1", notes: "", amount: 15000, currency: "CRC", purchaseId: purchase.id, purchaseTitle: purchase.title, budgetLineIds: [], budgetLines: [], budgetLineId: null, budgetLineLabel: "", files: [], createdAt: stamp, updatedAt: stamp };

const floorReceiptMedia = { id: "floor-photo", name: "Factura de pisos.png", contentType: "image/png", size: 68, createdAt: stamp, isImage: true, thumbnailUrl: "/fixtures/receipts/floor.png", previewUrl: "/fixtures/receipts/floor.png" };
const transferReceipt = { ...invoice, id: "receipt-transfer", title: "Transferencia del abono de pisos", documentType: "receipt", purchaseId: null, purchaseTitle: "", reference: "TRF-2", files: [{ ...floorReceiptMedia, id: "transfer-photo", name: "Transferencia de pisos.png", thumbnailUrl: "/fixtures/receipts/transfer.png", previewUrl: "/fixtures/receipts/transfer.png" }] };
const floorPayment = { id: "installment-floor", budgetLineId: line.id, budgetLineLabel: line.item, purchaseId: purchase.id, purchaseTitle: purchase.title, amount: 2500, paymentDate: "2026-10-15", payee: "Abono de porcelanato", reference: "TRF-PISOS-2", notes: "Segundo abono del piso", documentId: invoice.id, documentIds: [invoice.id, transferReceipt.id], documentTitle: invoice.title, documentType: "invoice", documents: [{ id: invoice.id, title: invoice.title, documentType: "invoice" }, { id: transferReceipt.id, title: transferReceipt.title, documentType: "receipt" }], accountingMode: "ledger", paymentKind: "partial", createdAt: stamp, updatedAt: stamp };
const roofPayment = { ...floorPayment, id: "installment-roof", budgetLineId: other.id, budgetLineLabel: other.item, purchaseId: "purchase-roof", purchaseTitle: "Compra de techo", payee: "Pago exclusivo de cubierta", amount: 15000, reference: "TRF-TECHO-1", notes: "Pago de la cubierta", documentId: "invoice-roof", documentIds: ["invoice-roof"], documentTitle: "Factura de techo", documents: [{ id: "invoice-roof", title: "Factura de techo", documentType: "invoice" }] };

test.beforeAll(async () => {
  const bundle = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import BudgetWorkspace from './app/components/BudgetWorkspace';import ExpensesWorkspace from './app/components/ExpensesWorkspace';
    import {parseWorkspacePath,buildWorkspacePath} from './lib/workspace-navigation';
    const params=new URLSearchParams(location.search),role=params.get('role')||'admin';
    function FixtureApp(){
      const [route,setRoute]=React.useState(parseWorkspacePath(location.pathname));
      const changeScope=(budgetScope)=>{
        const next={projectId:'house',section:'budget',budgetScope};
        history.pushState({},'',buildWorkspacePath(next)+location.search);setRoute(next);
      };
      return route?.section==='budget'
        ? <BudgetWorkspace mode="real" language="es" projectId="house" canEdit={role==='admin'||role==='editor'||role==='budget-only'} canReplace={false} isOwner={role==='admin'} canViewPurchases={role!=='restricted'&&role!=='budget-only'} onReplace={()=>{}} routeScope={route.budgetScope} onRouteScopeChange={changeScope}/>
        : <ExpensesWorkspace mode="real" language="es" projectId="house" isOwner={role==='admin'||role==='editor'}/>;
    }
    createRoot(document.getElementById('root')).render(<FixtureApp/>);
  `, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, outfile: "budget-links.js", platform: "browser", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "budget-links-leaves", setup(builder) {
    builder.onResolve({ filter: /^(next\/image|@\/lib\/usage-client)$/ }, args => ({ path: args.path, namespace: "leaves" }));
    builder.onLoad({ filter: /.*/, namespace: "leaves" }, args => ({ contents: args.path === "next/image" ? "import React from 'react';export default function Image({unoptimized,...props}){return <img {...props}/>;}" : "export const trackDemoAction=()=>{},trackUsageInteraction=()=>{};", loader: "tsx", resolveDir: process.cwd() }));
  } }] });
  const css = await readFile("app/globals.css", "utf8") + (bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text || "");
  server = createServer((request, response) => {
    if (request.url === "/budget-links.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles.find((file) => file.path.endsWith(".js"))!.text); }
    else { response.setHeader("content-type", "text/html"); response.end(`<html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--font-geist-sans:Arial}${css}body{padding:20px}#root{max-width:1200px;margin:auto}</style><div id="root"></div><script src="/budget-links.js"></script></html>`); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>((resolve) => server.close(() => resolve())); });

async function fixtures(page: Page, options: { currency?: "USD" | "CRC"; paymentsModelVersion?: 2; excelImport?: boolean; freshEditFields?: boolean; concurrentAmount?: number; failPayment?: boolean; failBudgetRefresh?: boolean; paymentHistory?: boolean; failHistoryRead?: boolean; failDetailsRead?: boolean; historicalPaid?: number; googleSyncError?: string; googleSync?: { nextWorkbookPaid: number; ledgerPaid?: number; failCanonicalOnce?: boolean; removeLine?: boolean } } = {}) {
  const writes: Array<Record<string, unknown>> = [];
  const canonical = structuredClone(budget);
  canonical.currency = options.currency || "CRC";
  if (options.googleSyncError) Object.assign(canonical, { googleSyncError: options.googleSyncError, editingAllowed: false });
  if (options.paymentsModelVersion === 2) Object.assign(canonical, { paymentsModelVersion: 2 });
  canonical.lines.forEach((item) => Object.assign(item, { workbookPaid: item.paid, transactionPaid: 0 }));
  let draftWorkbook = structuredClone(workbook), draftRevision = 1;
  draftWorkbook.currency = options.currency || "CRC";
  let failBudgetRefresh = options.failBudgetRefresh || false, paymentReads = 0;
  let failHistoryRead = options.failHistoryRead || false, failDetailsRead = options.failDetailsRead || false;
  if (options.paymentHistory) {
    Object.assign(canonical.lines[0], { workbookPaid: 12500, transactionPaid: 2500 });
    Object.assign(canonical.lines[1], { workbookPaid: 0, transactionPaid: 15000 });
    draftWorkbook.sheets.budget.cellData[3][9].v = 12500;
  }
  const purchases = [purchase, { ...purchase, id: "purchase-roof", title: "Compra de techo", budgetLineId: other.id }];
  if (options.currency === "USD") purchases.forEach((item, index) => { purchases[index] = { ...item, currency: "USD" }; });
  const payments: Array<Record<string, unknown>> = [{ id: "historical-floor", budgetLineId: line.id, budgetLineLabel: line.item, amount: line.paid, paymentDate: "2026-10-14", payee: line.supplier, reference: "", notes: "", documentId: invoice.id, documentIds: [invoice.id], documentTitle: invoice.title, documentType: "invoice", accountingMode: "historical-detail", createdAt: stamp, updatedAt: stamp }];
  if (options.paymentHistory) {
    Object.assign(payments[0], { amount: 12500, payee: "Pago histórico de pisos", reference: "HIS-PISOS", documentId: null, documentIds: [], documentTitle: "", documentType: null });
    payments.push(structuredClone(floorPayment), structuredClone(roofPayment));
  }
  if (options.excelImport) Object.assign(payments[0], { source: "excel-import", payee: "", paymentDate: "", reference: "", notes: "" });
  payments.forEach((payment) => { payment.currency = canonical.currency; });
  if (options.historicalPaid !== undefined) {
    Object.assign(canonical.lines[0], { paid: options.historicalPaid, workbookPaid: options.historicalPaid, transactionPaid: 0 });
    draftWorkbook.sheets.budget.cellData[3][9].v = options.historicalPaid;
    payments.length = 0;
    canonical.spent = canonical.lines.reduce((total, item) => total + item.paid, 0);
    canonical.remaining = canonical.objective - canonical.spent;
    canonical.percentUsed = canonical.spent / canonical.objective * 100;
  }
  if (options.googleSync?.ledgerPaid) {
    Object.assign(canonical.lines[0], { paid: canonical.lines[0].paid + options.googleSync.ledgerPaid, transactionPaid: options.googleSync.ledgerPaid });
    payments.push({ ...floorPayment, amount: options.googleSync.ledgerPaid });
  }
  let failGoogleCanonical = Boolean(options.googleSync?.failCanonicalOnce), googleSynced = false;
  const documents = [options.paymentHistory ? { ...invoice, files: [floorReceiptMedia] } : invoice, { ...invoice, id: "invoice-roof", title: "Factura de techo", purchaseId: "purchase-roof", budgetLineIds: [other.id], budgetLines: [{ id: other.id, label: other.item }] }, ...(options.paymentHistory ? [transferReceipt] : [])];
  await page.context().route("**/fixtures/receipts/*.png", (route) => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Kq0AAAAASUVORK5CYII=", "base64") }));
  await page.context().route("**/api/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const body = ["POST", "PATCH", "DELETE"].includes(request.method()) && request.headers()["content-type"]?.includes("application/json") ? request.postDataJSON() : null;
    if (body) writes.push(body);
    if (path === "/api/google-sheets") {
      if (body && options.googleSync) {
        const current = canonical.lines[0];
        Object.assign(current, { workbookPaid: options.googleSync.nextWorkbookPaid, paid: options.googleSync.nextWorkbookPaid + (options.googleSync.ledgerPaid || 0) });
        if (options.googleSync.removeLine) canonical.lines.splice(0, 1);
        canonical.planVersion++;
        canonical.spent = canonical.lines.reduce((total, item) => total + item.paid, 0);
        canonical.remaining = canonical.objective - canonical.spent;
        canonical.percentUsed = canonical.spent / canonical.objective * 100;
        googleSynced = true;
      }
      return route.fulfill({ json: { configured: true, managed: true, connected: true, canCreate: true, url: "https://docs.google.com/spreadsheets/d/synthetic-budget", folderUrl: "" } });
    }
    if (path === "/api/budget") {
      if (googleSynced && failGoogleCanonical) {
        failGoogleCanonical = false;
        return route.fulfill({ status: 503, json: { error: "Google se sincronizó, pero falló la lectura del total actualizado" } });
      }
      if (failBudgetRefresh && writes.some((item) => "clientMutationId" in item)) {
        failBudgetRefresh = false;
        return route.fulfill({ status: 503, json: { error: "No se pudo actualizar el presupuesto de prueba" } });
      }
      return route.fulfill({ json: canonical });
    }
    if (path === "/api/workbook/drafts") {
      if (body?.action === "save") { draftWorkbook = structuredClone(body.workbook); draftRevision++; }
      return route.fulfill({ json: { id: "draft", revision: draftRevision, workbook: draftWorkbook, rowMaps: { Pisos: { 4: 4 } } } });
    }
    if (path === "/api/workbook/editor") return route.fulfill({ json: { workbook: draftWorkbook, rowMaps: { Pisos: { 4: 4 } } } });
    if (path === "/api/expenses") return route.fulfill({ json: { currency: canonical.currency, expenses: canonical.lines.filter((item) => item.paid > 0).map((item) => ({ id: item.id, budgetLineId: item.id, description: item.item, vendor: item.supplier, chapter: item.chapter, subcategory: item.subcategory, amount: item.paid, attachments: [] })), budgetLines: canonical.lines, summary: { total: canonical.spent } } });
    if (path === "/api/expenses/purchases") {
      if (body) { purchases.push({ ...purchase, ...body, id: "purchase-new", documentCount: 0 }); return route.fulfill({ json: { id: "purchase-new" } }); }
      return route.fulfill({ json: { purchases } });
    }
    if (path === "/api/expenses/documents") {
      if (failDetailsRead) { failDetailsRead = false; return route.fulfill({ status: 503, json: { error: "No se pudieron cargar los comprobantes de prueba" } }); }
      return route.fulfill({ json: { documents, purchases } });
    }
    if (path === "/api/expenses/payments") {
      if (body) {
        if (options.failPayment) return route.fulfill({ status: 503, json: { error: "No se pudo registrar el pago de prueba" } });
        const selected = canonical.lines.find((item) => item.id === body.budgetLineId);
        if (!selected) return route.fulfill({ status: 400, json: { error: "Partida inexistente" } });
        const index = request.method() === "PATCH" ? payments.findIndex((item) => item.id === body.id) : -1;
        if (request.method() === "PATCH" && index < 0) return route.fulfill({ status: 404, json: { error: "Pago inexistente" } });
        const id = index >= 0 ? String(payments[index].id) : `payment-${payments.length + 1}`;
        const next = { ...(index >= 0 ? payments[index] : {}), ...body, currency: canonical.currency, id, accountingMode: body.accountingMode || (index >= 0 ? payments[index].accountingMode : "historical-detail"), budgetLineLabel: selected.item, documentTitle: body.documentIds?.includes(invoice.id) ? invoice.title : "", documentType: "invoice", createdAt: stamp, updatedAt: stamp };
        if (index >= 0) payments[index] = next; else payments.push(next);
        // A simultaneous server-side payment proves that Budget uses canonical totals.
        if (options.paymentsModelVersion === 2) {
          selected.paid = payments.filter((item) => item.budgetLineId === selected.id).reduce((sum, item) => sum + Number(item.amount), 0) + (options.concurrentAmount || 0);
        } else if (body.accountingMode === "ledger") {
          const increment = Number(body.amount) + (options.concurrentAmount || 0);
          selected.paid += increment;
          Object.assign(selected, { transactionPaid: selected.paid - Number((selected as typeof selected & { workbookPaid?: number }).workbookPaid || 0) });
        }
        canonical.actualsRevision++;
        canonical.spent = canonical.lines.reduce((total, item) => total + item.paid, 0);
        canonical.remaining = canonical.objective - canonical.spent;
        canonical.percentUsed = canonical.spent / canonical.objective * 100;
        return route.fulfill({ json: { id } });
      }
      if (failHistoryRead) { failHistoryRead = false; return route.fulfill({ status: 503, json: { error: "No se pudo cargar el historial de prueba" } }); }
      paymentReads++;
      const visiblePayments = options.freshEditFields && paymentReads > 1 ? payments.map((item) => item.id === floorPayment.id ? { ...item, reference: "FRESH-REF", notes: "Detalle recién actualizado" } : item) : payments;
      return route.fulfill({ json: { payments: visiblePayments, completedLineIds: [], ...(options.paymentsModelVersion === 2 ? { paymentsModelVersion: 2 } : {}) } });
    }
    return route.fulfill({ status: 400, json: { error: `Unhandled local fixture ${path}` } });
  });
  return writes;
}
const scopedUrl = (extra = "") => `${address}/projects/house/expenses?budgetLine=${encodeURIComponent(line.id)}${extra}`;

test("shows the saved budget before a slow Google read and shares background refreshes", async ({ page }) => {
  const writes = await fixtures(page);
  let canonicalRead: Route | null = null, budgetReads = 0;
  await page.route("**/api/budget", async (route) => {
    budgetReads++;
    if (route.request().headers()["x-house-planner-budget-source"] === "stored") return route.fallback();
    canonicalRead = route;
  });
  await page.goto(`${address}/projects/house/budget`);
  await expect(paidValue(page, line.item)).toHaveText(crc(line.paid));
  await expect(page.getByRole("status").filter({ hasText: "Actualizando desde Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Editar presupuesto", exact: true })).toBeDisabled();
  await expect.poll(() => Boolean(canonicalRead)).toBe(true);
  for (let index = 0; index < 4; index++) {
    await page.evaluate(() => { window.dispatchEvent(new Event("focus")); });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  }
  expect(budgetReads).toBe(2);
  expect(writes).toHaveLength(0);
  await (canonicalRead as unknown as Route).fulfill({ json: budget });
  await expect(page.getByRole("status").filter({ hasText: "Actualizando desde Google" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Editar presupuesto", exact: true })).toBeEnabled();
  await expect(paidValue(page, line.item)).toHaveText(crc(line.paid));
});

for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
  test(`keeps the saved budget and payment history readable during a Google conflict at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const writes = await fixtures(page, { paymentHistory: true, googleSyncError: "El historial de pagos de Google cambió. Conservá sus hojas de consulta y reintentá." });
    await page.goto(`${address}/projects/house/budget`);
    await expect(page.getByRole("heading", { name: "Presupuesto no disponible" })).toHaveCount(0);
    await expect(page.getByRole("alert").filter({ hasText: "El historial de pagos de Google cambió" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Editar presupuesto", exact: true })).toBeDisabled();
    await expect(page.locator(".budget-line-card").filter({ hasText: line.item })).toBeVisible();
    await paymentHistoryToggle(page, line.item).click();
    await expect(paymentHistoryPanel(page, line.item)).toContainText(floorPayment.payee);
    await expect(paymentHistoryPanel(page, line.item)).not.toContainText(roofPayment.payee);
    expect(writes).toHaveLength(0);
    await page.screenshot({ path: testInfo.outputPath("saved-budget-google-conflict.png"), fullPage: true });
  });
}

test("keeps a single compact payment entry beside Paid and opens the scoped history in place", async ({ page }) => {
  const reads = watchPaymentReads(page);
  await fixtures(page, { paymentHistory: true }); await page.goto(`${address}/projects/house/budget`);
  const card = page.locator(".budget-line-card").filter({ hasText: line.item });
  await expect(card.locator(".budget-line-purchases")).toHaveCount(0);
  await expect(card.getByRole("button")).toHaveCount(2);
  expect(reads).toHaveLength(0);
  const action = paymentHistoryToggle(page, line.item);
  await action.click();
  const panel = paymentHistoryPanel(page, line.item);
  await expect(panel).toBeVisible();
  await expect(action).toHaveAttribute("aria-expanded", "true");
  await expect(panel.getByRole("columnheader")).toHaveCount(3);
  await expect(panel).toContainText(floorPayment.payee);
  await expect(panel).not.toContainText(roofPayment.payee);
  expect(reads).toHaveLength(1);
  expect(page.context().pages()).toHaveLength(1);
  await expect(page).toHaveURL(/\/budget$/);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0); await expect(action).toBeFocused();
  await expect(action).toHaveAttribute("aria-expanded", "false");
});

test("contains keyboard focus in the payment panel and closes on its backdrop", async ({ page }) => {
  await fixtures(page, { paymentHistory: true }); await page.goto(`${address}/projects/house/budget`);
  const action = paymentHistoryToggle(page, line.item);
  await action.click();
  const panel = paymentHistoryPanel(page, line.item);
  const close = panel.getByRole("button", { name: "Cerrar pagos", exact: true });
  const add = panel.getByRole("button", { name: "Agregar pago", exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab"); await expect(add).toBeFocused();
  await page.keyboard.press("Tab"); await expect(close).toBeFocused();
  await page.mouse.click(2, 2);
  await expect(panel).toHaveCount(0); await expect(action).toBeFocused();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("keeps the same scope across products, documents, paid lines, and reload", async ({ page }) => {
  await fixtures(page); await page.goto(scopedUrl());
  await expect(page.locator(".document-card")).toHaveCount(1);
  await page.locator(".expense-tabs").getByRole("button", { name: /Productos/ }).click();
  await expect(page.locator(".purchase-card")).toHaveCount(1); await page.reload();
  await expect(page.locator(".purchase-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Partidas pagadas", exact: true }).click();
  await expect(page.locator(".paid-line")).toHaveCount(1);
  await page.getByRole("link", { name: "Volver a presupuesto" }).click();
  await expect(page).toHaveURL(/\/budget\/chapter\/Pisos$/);
});

test("preselects an editor's purchase and offers its receipt after saving", async ({ page }) => {
  const writes = await fixtures(page); await page.goto(scopedUrl("&newExpense=1&role=editor"));
  const form = page.getByRole("dialog", { name: "Compra", exact: true });
  await expect(form.getByRole("textbox").first()).toHaveValue(line.item);
  await expect(form.locator("select").filter({ has: page.locator(`option[value="${line.id}"]`) })).toHaveValue(line.id);
  await form.getByRole("button", { name: /^Guardar/ }).click();
  await expect(page.getByRole("status")).toContainText("Compra guardada");
  expect(writes[0]).toMatchObject({ budgetLineId: line.id, title: line.item, vendor: line.supplier });
  await page.getByRole("button", { name: "Agregar comprobante" }).click();
  await expect(page.getByRole("dialog", { name: "Comprobante", exact: true })).toBeVisible();
});

test("opens an independent receipt and consumes the action so reload does not reopen it", async ({ page }) => {
  await fixtures(page); await page.goto(scopedUrl("&newDocument=1"));
  const form = page.getByRole("dialog", { name: "Comprobante", exact: true });
  await expect(form.getByRole("textbox").first()).toHaveValue("");
  await expect(form.getByRole("checkbox")).toHaveCount(0);
  await expect(form).toContainText("No hace falta indicar monto, abono ni partida");
  await page.keyboard.press("Escape"); await expect(form).toHaveCount(0); await page.reload(); await expect(form).toHaveCount(0);
});

test("viewers cannot create even through a creation URL, and restricted users have no payment controls", async ({ page }) => {
  await fixtures(page); await page.goto(scopedUrl("&newExpense=1&role=viewer"));
  await expect(page.locator(".document-card")).toHaveCount(1); await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Nuevo comprobante/ })).toHaveCount(0);
  await page.goto(`${address}/projects/house/budget?role=restricted`);
  await expect(page.locator(".budget-line-card")).toHaveCount(3); await expect(page.locator(".budget-line-purchases")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Ver pagos de / })).toHaveCount(0);
});

test("allows a first payment for an unpaid line and preserves a missing line scope", async ({ page }) => {
  await fixtures(page); await page.goto(`${address}/projects/house/expenses?budgetLine=unpaid&newPayment=1&expenseTab=payments`);
  const payment = page.getByRole("dialog", { name: "Pago", exact: true });
  await expect(payment).toBeVisible();
  await expect(payment.getByLabel("Partida (opcional)")).toHaveValue("unpaid");
  await expect(payment.locator('input[name="expense-payment-crc-amount"]')).toHaveValue("");
  await page.goto(`${address}/projects/house/expenses?budgetLine=missing&newDocument=1`);
  await expect(page.locator(".expense-budget-scope")).toContainText("Partida no disponible");
  await expect(page.getByRole("dialog")).toHaveCount(0); await expect(page.locator(".document-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Ver todas las compras" }).click(); await expect(page.locator(".document-card")).toHaveCount(2);
});

const paidValue = (page: Page, item: string) => page.locator("output").and(page.getByLabel(`${item} Pagado`, { exact: true }));
const paymentWrites = (writes: Array<Record<string, unknown>>) => writes.filter((body) => "clientMutationId" in body);
const crc = (value: number) => new Intl.NumberFormat("es-CR", { style: "currency", currency: "CRC", maximumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(value);
const detailCrc = (value: number) => new Intl.NumberFormat("es-CR", { style: "currency", currency: "CRC", maximumFractionDigits: 2 }).format(value);
const paymentHistoryToggle = (page: Page, item: string) => page.getByRole("button", { name: `Ver pagos de ${item}`, exact: true });
const paymentHistoryPanel = (page: Page, item: string) => page.getByRole("dialog", { name: `Pagos de ${item}`, exact: true });
const paymentHistoryTable = (page: Page, item: string) => paymentHistoryPanel(page, item).getByRole("table", { name: `Pagos de ${item}`, exact: true });
async function openPaymentForm(page: Page, item: string) {
  if (!await paymentHistoryPanel(page, item).isVisible()) await paymentHistoryToggle(page, item).click();
  await paymentHistoryPanel(page, item).getByRole("button", { name: "Agregar pago", exact: true }).click();
  await expect(paymentHistoryPanel(page, item)).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(1);
}

test("real USD budget, payment history and decimal form retain the project denomination", async ({ page }) => {
  const writes = await fixtures(page, { currency: "USD", paymentHistory: true });
  const usd = (amount: number) => new Intl.NumberFormat("es-CR", { style: "currency", currency: "USD", maximumFractionDigits: Number.isInteger(amount) ? 0 : 2 }).format(amount);
  await page.goto(`${address}/projects/house/budget`);
  await expect(page.locator(".page-intro .overline")).toContainText("USD");
  await expect(paidValue(page, line.item)).toHaveText(usd(15000));
  await paymentHistoryToggle(page, line.item).click();
  await expect(paymentHistoryTable(page, line.item)).toContainText(usd(2500));
  await paymentHistoryTable(page, line.item).getByRole("button", { name: "Ver pago Abono de porcelanato", exact: true }).click();
  await expect(page.locator(".payment-details-header strong")).toHaveText(new Intl.NumberFormat("es-CR", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(2500));
  await page.getByRole("button", { name: "Cerrar detalle del pago", exact: true }).click();
  await openPaymentForm(page, line.item);
  const amount = page.locator('input[name="expense-payment-usd-amount"]');
  await expect(amount).toHaveAttribute("inputmode", "decimal");
  await amount.fill("12.75");
  await page.getByRole("combobox", { name: "Aplicación al presupuesto", exact: true }).selectOption("ledger");
  await page.getByRole("button", { name: "Guardar pago", exact: true }).click();
  await expect.poll(() => paymentWrites(writes).length).toBe(1);
  expect(paymentWrites(writes)[0]).toMatchObject({ amount: 12.75, expectedCurrency: "USD" });
  await expect(paidValue(page, line.item)).toHaveText(usd(15012.75));
});

const googleSyncWrites = (writes: Array<Record<string, unknown>>) => writes.filter((body) => body.action === "sync");
async function refreshFromGoogle(page: Page) {
  await page.getByRole("button", { name: "Google Sheets", exact: true }).click();
  await page.getByRole("button", { name: "Actualizar desde Google", exact: true }).click();
}

test("refreshes deleted Excel history from Google inside the editor without resetting the draft", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const reads = watchPaymentReads(page);
  const writes = await fixtures(page, { historicalPaid: 685349, googleSync: { nextWorkbookPaid: 0 } });
  await page.goto(`${address}/projects/house/budget`);
  await page.getByRole("button", { name: "Editar presupuesto", exact: true }).click();
  const objective = page.getByRole("spinbutton", { name: `${line.item} Objetivo`, exact: true });
  const note = page.getByRole("textbox", { name: `${line.item} Proveedor / nota`, exact: true });
  await objective.fill("70000"); await note.fill("Cotización pendiente\nConservar esta nota del borrador");
  await paymentHistoryToggle(page, line.item).click();
  await expect(paymentHistoryPanel(page, line.item)).toContainText(`Histórico de Excel sin desglose de pagos: ${crc(685349)}`);
  await page.keyboard.press("Escape");
  await refreshFromGoogle(page);
  await expect(paidValue(page, line.item)).toHaveText(crc(0));
  await expect(objective).toHaveValue("70000"); await expect(note).toHaveValue("Cotización pendiente\nConservar esta nota del borrador");
  await paymentHistoryToggle(page, line.item).click();
  const panel = paymentHistoryPanel(page, line.item);
  await expect(panel).toContainText("Todavía no hay pagos registrados para esta partida.");
  await expect(panel).not.toContainText("Histórico de Excel sin desglose de pagos");
  await expect(panel).toContainText(crc(0));
  await expect.poll(() => reads.length).toBe(2);
  expect(googleSyncWrites(writes)).toHaveLength(1);
  expect(paymentWrites(writes)).toHaveLength(0);
  expect(writes.filter((body) => body.action === "create")).toHaveLength(1);
  await expect.poll(() => writes.filter((body) => body.action === "save").length).toBeGreaterThan(0);
  const saved = writes.filter((body) => body.action === "save").at(-1)!.workbook as UniverWorkbook;
  expect(saved.sheets.budget.cellData[3][4].v).toBe(70000);
  expect(saved.sheets.budget.cellData[3][10].v).toBe("Cotización pendiente\nConservar esta nota del borrador");
  expect(saved.sheets.budget.cellData[3][9].v).toBe(685349);
  await page.screenshot({ path: testInfo.outputPath("budget-google-sync-zero-payment.png") });
  await expect(page).toHaveURL(`${address}/projects/house/budget/chapter`);
});

test("retries the canonical budget read after Google sync without repeating the Google mutation", async ({ page }) => {
  const writes = await fixtures(page, { historicalPaid: 685349, googleSync: { nextWorkbookPaid: 0, failCanonicalOnce: true } });
  let budgetReads = 0;
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/budget") budgetReads++; });
  await page.goto(`${address}/projects/house/budget`);
  await page.getByRole("button", { name: "Editar presupuesto", exact: true }).click();
  const objective = page.getByRole("spinbutton", { name: `${line.item} Objetivo`, exact: true });
  await objective.fill("71000");
  await refreshFromGoogle(page);
  const retry = page.getByRole("button", { name: "Actualizar presupuesto", exact: true });
  await expect(retry).toBeVisible();
  await expect(paidValue(page, line.item)).toHaveText(crc(685349));
  expect(googleSyncWrites(writes)).toHaveLength(1);
  const readsBeforeRetry = budgetReads;
  await retry.click();
  await expect(paidValue(page, line.item)).toHaveText(crc(0));
  await expect(retry).toHaveCount(0); await expect(objective).toHaveValue("71000");
  expect(budgetReads).toBe(readsBeforeRetry + 1);
  expect(googleSyncWrites(writes)).toHaveLength(1);
  expect(paymentWrites(writes)).toHaveLength(0);
});

test("ignores an older dashboard budget read that arrives after the Google editor refresh", async ({ page }) => {
  const writes = await fixtures(page, { historicalPaid: 685349, googleSync: { nextWorkbookPaid: 0 } });
  let holdNext = false, staleRoute: Route | null = null, staleSettled = false;
  await page.route("**/api/budget", async (route) => {
    if (holdNext) { holdNext = false; staleRoute = route; return; }
    await route.fallback();
  });
  page.on("requestfinished", (request) => { if (request === staleRoute?.request()) staleSettled = true; });
  page.on("requestfailed", (request) => { if (request === staleRoute?.request()) staleSettled = true; });
  await page.goto(`${address}/projects/house/budget`);
  await expect(paidValue(page, line.item)).toHaveText(crc(685349));
  holdNext = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => Boolean(staleRoute)).toBe(true);
  await page.getByRole("button", { name: "Editar presupuesto", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: `${line.item} Objetivo`, exact: true })).toBeVisible();
  await refreshFromGoogle(page);
  await expect(paidValue(page, line.item)).toHaveText(crc(0));
  const stale = structuredClone(budget);
  Object.assign(stale.lines[0], { paid: 685349, workbookPaid: 685349, transactionPaid: 0 });
  await (staleRoute as unknown as Route).fulfill({ json: stale });
  await expect.poll(() => staleSettled).toBe(true);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(paidValue(page, line.item)).toHaveText(crc(0));
  expect(googleSyncWrites(writes)).toHaveLength(1);
});

test("retains independent ledger payments when Google removes the Excel historical amount", async ({ page }) => {
  const writes = await fixtures(page, { historicalPaid: 685349, googleSync: { nextWorkbookPaid: 0, ledgerPaid: 2500 } });
  await page.goto(`${address}/projects/house/budget`);
  await page.getByRole("button", { name: "Editar presupuesto", exact: true }).click();
  await expect(paidValue(page, line.item)).toHaveText(crc(687849));
  await refreshFromGoogle(page);
  await expect(paidValue(page, line.item)).toHaveText(crc(2500));
  await paymentHistoryToggle(page, line.item).click();
  const table = paymentHistoryTable(page, line.item);
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table).toContainText(floorPayment.payee);
  await expect(table).toContainText(crc(2500));
  await expect(paymentHistoryPanel(page, line.item)).not.toContainText("Histórico de Excel sin desglose de pagos");
  expect(paymentWrites(writes)).toHaveLength(0);
});

test("does not revive stale snapshot Paid when Google removes an official budget line", async ({ page }) => {
  const writes = await fixtures(page, { historicalPaid: 685349, googleSync: { nextWorkbookPaid: 0, removeLine: true } });
  await page.goto(`${address}/projects/house/budget`);
  await page.getByRole("button", { name: "Editar presupuesto", exact: true }).click();
  const objective = page.getByRole("spinbutton", { name: `${line.item} Objetivo`, exact: true });
  await objective.fill("72000");
  await refreshFromGoogle(page);
  await expect(paidValue(page, line.item)).toHaveText(crc(0));
  await expect(objective).toHaveValue("72000");
  await expect(paymentHistoryToggle(page, line.item)).toHaveCount(0);
  expect(writes.filter((body) => body.action === "create")).toHaveLength(1);
  expect(paymentWrites(writes)).toHaveLength(0);
});

test("shows the synchronized zero Paid and empty history in the mobile editor", async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  try {
    const writes = await fixtures(page, { historicalPaid: 685349, googleSync: { nextWorkbookPaid: 0 } });
    await page.goto(`${address}/projects/house/budget`);
    await page.getByRole("button", { name: "Editar presupuesto", exact: true }).tap();
    await expect(page.locator(".budget-table-editor")).toBeVisible();
    await refreshFromGoogle(page);
    await expect(paidValue(page, line.item)).toHaveText(crc(0));
    await paymentHistoryToggle(page, line.item).tap();
    const panel = paymentHistoryPanel(page, line.item);
    await expect(panel).toContainText("Todavía no hay pagos registrados para esta partida.");
    await expect(panel).not.toContainText("Histórico de Excel sin desglose de pagos");
    expect((await panel.boundingBox())!.width).toBe(360);
    expect(await page.evaluate(() => innerWidth === 360 && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("budget-google-sync-zero-payment-mobile.png") });
    expect(googleSyncWrites(writes)).toHaveLength(1);
    expect(paymentWrites(writes)).toHaveLength(0);
  } finally { await context.close(); }
});

test("keeps dashboard editing disabled through the Google mutation and canonical read", async ({ page }) => {
  const writes = await fixtures(page, { historicalPaid: 685349, googleSync: { nextWorkbookPaid: 0 } });
  let googlePost: Route | null = null, canonicalRead: Route | null = null, synchronizing = false;
  await page.route("**/api/google-sheets", async (route) => {
    if (route.request().method() === "POST") { googlePost = route; synchronizing = true; return; }
    await route.fallback();
  });
  await page.route("**/api/budget", async (route) => {
    if (synchronizing) { canonicalRead = route; return; }
    await route.fallback();
  });
  await page.goto(`${address}/projects/house/budget`);
  const edit = page.getByRole("button", { name: "Editar presupuesto", exact: true });
  await expect(edit).toBeEnabled();
  await page.getByRole("button", { name: "Actualizar desde Google", exact: true }).click();
  await expect.poll(() => Boolean(googlePost)).toBe(true);
  await expect(edit).toBeDisabled();
  expect(writes.filter((body) => body.action === "create")).toHaveLength(0);
  await (googlePost as unknown as Route).fallback();
  await expect.poll(() => Boolean(canonicalRead)).toBe(true);
  await expect(edit).toBeDisabled();
  expect(writes.filter((body) => body.action === "create")).toHaveLength(0);
  synchronizing = false;
  await (canonicalRead as unknown as Route).fallback();
  await expect(paidValue(page, line.item)).toHaveText(crc(0));
  await expect(edit).toBeEnabled();
  expect(googleSyncWrites(writes)).toHaveLength(1);
  expect(writes.filter((body) => body.action === "create")).toHaveLength(0);
});

test("shares a pending Google refresh with focus and retries a failed canonical read", async ({ page }) => {
  const writes = await fixtures(page, { historicalPaid: 685349, googleSync: { nextWorkbookPaid: 0 } });
  let synchronized = false, readsAfterSync = 0, googleRead: Route | null = null;
  await page.route("**/api/google-sheets", async (route) => {
    if (route.request().method() === "POST") synchronized = true;
    await route.fallback();
  });
  await page.route("**/api/budget", async (route) => {
    if (synchronized) {
      readsAfterSync++;
      if (readsAfterSync === 1) { googleRead = route; return; }
    }
    await route.fallback();
  });
  await page.goto(`${address}/projects/house/budget`);
  await page.getByRole("button", { name: "Actualizar desde Google", exact: true }).click();
  await expect.poll(() => Boolean(googleRead)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(readsAfterSync).toBe(1);
  await (googleRead as unknown as Route).fulfill({ status: 503, json: { error: "La lectura del presupuesto actualizado falló" } });
  const retry = page.getByRole("button", { name: "Actualizar presupuesto", exact: true });
  await expect(retry).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Actualizando" })).toHaveCount(0);
  expect(googleSyncWrites(writes)).toHaveLength(1);
  await retry.click();
  await expect(paidValue(page, line.item)).toHaveText(crc(0));
  await expect(retry).toHaveCount(0);
  expect(readsAfterSync).toBe(2);
  expect(googleSyncWrites(writes)).toHaveLength(1);
  expect(writes.filter((body) => body.action === "create")).toHaveLength(0);
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 360, height: 800 }]) {
  test(`records a manual full payment from Budget without requiring a purchase at ${viewport.width}x${viewport.height}`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ viewport, hasTouch: viewport.width < 1000, isMobile: viewport.width < 1000 });
    const page = await context.newPage();
    try {
      const writes = await fixtures(page); await page.goto(`${address}/projects/house/budget`);
      await expect(paidValue(page, unpaid.item)).toHaveText(crc(0));
      await openPaymentForm(page, unpaid.item);
      const dialog = page.getByRole("dialog", { name: "Pago", exact: true });
      const amount = dialog.locator('input[name="expense-payment-crc-amount"]'), kind = dialog.getByRole("combobox", { name: "Tipo de pago", exact: true });
      await expect(kind.locator('option[value="settlement"]')).toBeEnabled();
      await expect(kind.locator('option[value="settlement"]')).toHaveText("Pago total");
      await kind.selectOption("settlement");
      await expect(amount).toHaveValue("");
      await expect(dialog).toContainText("Sin compra vinculada se usa el monto ingresado.");
      await expect(dialog.getByLabel("Compra (opcional)")).toHaveValue("");
      await amount.fill("500");
      await dialog.getByLabel("Descripción (opcional)", { exact: true }).fill("Pago total independiente");
      await dialog.getByRole("button", { name: "Elegir comprobantes existentes", exact: true }).click();
      await dialog.getByRole("button", { name: invoice.title, exact: true }).click();
      await expect(dialog.getByRole("button", { name: "Guardar pago", exact: true })).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await kind.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`budget-full-payment-${viewport.width}.png`) });
      await dialog.getByRole("button", { name: "Guardar pago", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(paymentWrites(writes)).toHaveLength(1);
      expect(paymentWrites(writes)[0]).toMatchObject({ budgetLineId: unpaid.id, purchaseId: null, amount: 500, paymentKind: "settlement", accountingMode: "ledger", documentIds: [invoice.id] });
      await expect(paidValue(page, unpaid.item)).toHaveText(crc(500));
      await paymentHistoryToggle(page, unpaid.item).click();
      const panel = paymentHistoryPanel(page, unpaid.item);
      await expect(panel.getByText("Pago total", { exact: true })).toBeVisible();
      await expect(panel).not.toContainText("Pago de saldo");
      await panel.getByRole("button", { name: "Ver pago Pago total independiente", exact: true }).click();
      const details = page.getByRole("dialog", { name: "Detalle del pago", exact: true });
      await expect(details.getByText("Pago total", { exact: true })).toBeVisible();
      await expect(details).toContainText(invoice.title);
      await expect(page).toHaveURL(`${address}/projects/house/budget`);
    } finally { await context.close(); }
  });
}

test("registers the first payment beside Paid, reuses a receipt, and stays in Budget", async ({ page }) => {
  const writes = await fixtures(page, { concurrentAmount: 250 });
  await page.goto(`${address}/projects/house/budget`);
  await expect(paidValue(page, unpaid.item)).toHaveText(crc(0));
  await openPaymentForm(page, unpaid.item);
  const dialog = page.getByRole("dialog", { name: "Pago", exact: true });
  await expect(dialog).toContainText(unpaid.item);
  await expect(dialog).toContainText("Este pago se sumará a Pagado en esta partida");
  await expect(dialog.getByLabel("Partida (opcional)")).toHaveCount(0);
  await dialog.locator('input[name="expense-payment-crc-amount"]').fill("2500");
  await dialog.getByRole("button", { name: "Elegir comprobantes existentes", exact: true }).click();
  const receipt = dialog.getByRole("button", { name: invoice.title, exact: true });
  await expect(receipt).toContainText("reutilizable");
  await receipt.click(); await expect(receipt).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "Guardar pago", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(paymentWrites(writes)).toHaveLength(1);
  expect(paymentWrites(writes)[0]).toMatchObject({ budgetLineId: unpaid.id, amount: 2500, documentIds: [invoice.id], paymentKind: "partial" });
  await expect(paidValue(page, unpaid.item)).toHaveText(crc(2750));
  await expect(page).toHaveURL(`${address}/projects/house/budget`);
  expect(page.context().pages()).toHaveLength(1);
});

test("refreshes Paid inside the editor while retaining pending budget changes", async ({ page }) => {
  const writes = await fixtures(page, { concurrentAmount: 250 });
  await page.goto(`${address}/projects/house/budget`);
  await page.getByRole("button", { name: "Editar presupuesto", exact: true }).click();
  await expect(page).toHaveURL(`${address}/projects/house/budget/chapter`);
  const objective = page.getByRole("spinbutton", { name: `${line.item} Objetivo`, exact: true });
  await objective.fill("70000");
  await openPaymentForm(page, line.item);
  const dialog = page.getByRole("dialog", { name: "Pago", exact: true });
  await expect(dialog).toContainText(line.item);
  await dialog.getByLabel("Aplicación al presupuesto", { exact: true }).selectOption("ledger");
  await dialog.locator('input[name="expense-payment-crc-amount"]').fill("2500");
  await dialog.getByRole("button", { name: "Guardar pago", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(objective).toHaveValue("70000");
  await expect(paidValue(page, line.item)).toHaveText(crc(17750));
  await expect.poll(() => writes.filter((body) => body.action === "save").length).toBeGreaterThan(0);
  const saved = writes.filter((body) => body.action === "save").at(-1)!.workbook as UniverWorkbook;
  expect(Object.values(saved.sheets).flatMap((sheet) => Object.values(sheet.cellData)).find((cells) => cells[25]?.v === line.id)?.[4]?.v).toBe(70000);
  expect(writes.filter((body) => body.action === "create")).toHaveLength(1);
  expect(writes.some((body) => body.action === "publish" || body.action === "submit")).toBe(false);
  await expect(page).toHaveURL(`${address}/projects/house/budget/chapter`);
});

test("does not offer payment creation to viewers or restricted budget editors", async ({ page }) => {
  await fixtures(page);
  await page.goto(`${address}/projects/house/budget?role=viewer`);
  await expect(page.locator(".budget-line-card")).toHaveCount(3);
  await paymentHistoryToggle(page, line.item).click();
  await expect(paymentHistoryPanel(page, line.item).getByRole("button", { name: "Agregar pago", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Ver presupuesto", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: `${line.item} Objetivo`, exact: true })).toBeDisabled();
  await paymentHistoryToggle(page, line.item).click();
  await expect(paymentHistoryPanel(page, line.item).getByRole("button", { name: "Agregar pago", exact: true })).toHaveCount(0);
  await page.goto(`${address}/projects/house/budget?role=budget-only`);
  await expect(page.locator(".budget-line-card")).toHaveCount(3);
  await expect(page.getByRole("button", { name: /^Ver pagos de / })).toHaveCount(0);
  await page.getByRole("button", { name: "Editar presupuesto", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: `${line.item} Objetivo`, exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: /^Ver pagos de / })).toHaveCount(0);
});

test("requires applying a new budget line before recording its payment", async ({ page }) => {
  const writes = await fixtures(page);
  await page.goto(`${address}/projects/house/budget`);
  await page.getByRole("button", { name: "Editar presupuesto", exact: true }).click();
  await page.getByRole("button", { name: "Agregar partida", exact: true }).click();
  await page.locator(".budget-add-form").getByRole("textbox", { name: "Partida", exact: true }).fill("Nueva partida sin aplicar");
  await page.getByRole("button", { name: "Crear partida", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: "Nueva partida sin aplicar" });
  await expect(row).toContainText("Guarda y aplica la partida para registrar un pago");
  await expect(row.getByRole("button", { name: /^Ver pagos de / })).toHaveCount(0);
  expect(paymentWrites(writes)).toHaveLength(0);
});

test("cancels a budget payment without changing totals and restores its Paid trigger focus", async ({ page }) => {
  const writes = await fixtures(page);
  await page.goto(`${address}/projects/house/budget`);
  const action = paymentHistoryToggle(page, unpaid.item);
  await openPaymentForm(page, unpaid.item);
  const dialog = page.getByRole("dialog", { name: "Pago", exact: true });
  await dialog.locator('input[name="expense-payment-crc-amount"]').fill("2500");
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(action).toBeFocused();
  await expect(paidValue(page, unpaid.item)).toHaveText(crc(0));
  expect(paymentWrites(writes)).toHaveLength(0);
  await expect(page).toHaveURL(`${address}/projects/house/budget`);
});

test("retains an unsuccessful payment form and leaves Budget totals unchanged", async ({ page }) => {
  const writes = await fixtures(page, { failPayment: true });
  await page.goto(`${address}/projects/house/budget`);
  await openPaymentForm(page, unpaid.item);
  const dialog = page.getByRole("dialog", { name: "Pago", exact: true });
  const amount = dialog.locator('input[name="expense-payment-crc-amount"]');
  await amount.fill("2500");
  await dialog.getByRole("button", { name: "Guardar pago", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("No se pudo registrar el pago de prueba");
  await expect(amount).toHaveValue("2500"); await expect(dialog).toContainText(unpaid.item);
  await expect(paidValue(page, unpaid.item)).toHaveText(crc(0));
  expect(paymentWrites(writes)).toHaveLength(1);
  await expect(page).toHaveURL(`${address}/projects/house/budget`);
});

test("refreshes a committed payment after a budget read failure without recording it twice", async ({ page }) => {
  const writes = await fixtures(page, { failBudgetRefresh: true });
  await page.goto(`${address}/projects/house/budget`);
  await openPaymentForm(page, unpaid.item);
  const dialog = page.getByRole("dialog", { name: "Pago", exact: true });
  await dialog.locator('input[name="expense-payment-crc-amount"]').fill("2500");
  await dialog.getByRole("button", { name: "Guardar pago", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Pago guardado. No se pudo actualizar el total pagado." })).toBeVisible();
  await expect(paidValue(page, unpaid.item)).toHaveText(crc(0));
  expect(paymentWrites(writes)).toHaveLength(1);
  const mutationId = paymentWrites(writes)[0].clientMutationId;
  expect(mutationId).toEqual(expect.any(String));
  await page.getByRole("button", { name: "Actualizar total", exact: true }).click();
  await expect(paidValue(page, unpaid.item)).toHaveText(crc(2500));
  await expect(page.getByRole("status").filter({ hasText: "Pago guardado. El total pagado se actualizó." })).toBeVisible();
  expect(paymentWrites(writes)).toHaveLength(1);
  expect(paymentWrites(writes)[0].clientMutationId).toBe(mutationId);
  await expect(page).toHaveURL(`${address}/projects/house/budget`);
});

const watchPaymentReads = (page: Page) => {
  const reads: string[] = [];
  page.on("request", (request) => { if (request.method() === "GET" && new URL(request.url()).pathname === "/api/expenses/payments") reads.push(request.url()); });
  return reads;
};

test("edits a fresh v2 payment from Budget with its receipts while preserving the budget draft", async ({ page }) => {
  const writes = await fixtures(page, { paymentHistory: true, paymentsModelVersion: 2, freshEditFields: true });
  await page.goto(`${address}/projects/house/budget`);
  await page.getByRole("button", { name: "Editar presupuesto", exact: true }).click();
  const objective = page.getByRole("spinbutton", { name: `${line.item} Objetivo`, exact: true });
  const note = page.getByRole("textbox", { name: `${line.item} Proveedor / nota`, exact: true });
  await objective.fill("71000"); await note.fill("Conservar nota pendiente");
  await paymentHistoryToggle(page, line.item).click();
  const panel = paymentHistoryPanel(page, line.item);
  await expect(panel).not.toContainText("Histórico de Excel sin desglose");
  await panel.getByRole("button", { name: `Ver pago ${floorPayment.payee}`, exact: true }).click();
  const detail = page.getByRole("dialog", { name: "Detalle del pago", exact: true });
  await expect(detail).not.toContainText("incluido en el acumulado");
  await detail.getByRole("button", { name: "Editar pago", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Pago", exact: true });
  await expect(form.locator('input[name="expense-payment-crc-amount"]')).toHaveValue("2500");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(form.getByRole("combobox", { name: "Aplicación al presupuesto", exact: true })).toHaveCount(0);
  await expect(form.getByRole("button", { name: "Eliminar", exact: true })).toHaveCount(0);
  await expect(form.getByLabel("Comprobantes de este pago", { exact: true })).toContainText(invoice.title);
  await expect(form.getByLabel("Comprobantes de este pago", { exact: true })).toContainText(transferReceipt.title);
  await form.getByText("Más detalles opcionales", { exact: true }).click();
  await expect(form.getByLabel("Referencia de transferencia / factura", { exact: true })).toHaveValue("FRESH-REF");
  await expect(form.getByRole("textbox", { name: "Notas del pago", exact: true })).toHaveValue("Detalle recién actualizado");
  await form.locator('input[name="expense-payment-crc-amount"]').fill("4000");
  await expect(form.getByRole("status", { name: "Pagado después de guardar", exact: true })).toHaveText(crc(16500));
  await form.getByRole("button", { name: "Guardar pago", exact: true }).click();
  await expect(form).toHaveCount(0);
  const payment = paymentWrites(writes);
  expect(payment).toHaveLength(1);
  expect(payment[0]).toMatchObject({ id: floorPayment.id, paymentsModelVersion: 2, amount: 4000, purchaseId: purchase.id, documentIds: [invoice.id, transferReceipt.id], reference: "FRESH-REF", notes: "Detalle recién actualizado" });
  expect(payment[0]).not.toHaveProperty("accountingMode");
  await expect(paidValue(page, line.item)).toHaveText(crc(16500));
  await expect(objective).toHaveValue("71000"); await expect(note).toHaveValue("Conservar nota pendiente");
  await expect(paymentHistoryToggle(page, line.item)).toBeFocused();
  await paymentHistoryToggle(page, line.item).click();
  await expect(paymentHistoryTable(page, line.item).locator("tbody tr")).toHaveCount(2);
  await expect(paymentHistoryTable(page, line.item)).toContainText(crc(4000));
});

for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`edits an unnamed Excel v2 payment and receipts on mobile ${viewport.width}x${viewport.height}`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    try {
      const writes = await fixtures(page, { paymentHistory: true, paymentsModelVersion: 2, excelImport: true });
      await page.goto(`${address}/projects/house/budget`);
      await paymentHistoryToggle(page, line.item).tap();
      const panel = paymentHistoryPanel(page, line.item);
      await expect(panel).toContainText("Pago de Excel sin detalle");
      await expect(panel).not.toContainText("Histórico de Excel sin desglose");
      await panel.getByRole("button", { name: "Ver pago Pago de Excel sin detalle", exact: true }).tap();
      const detail = page.getByRole("dialog", { name: "Detalle del pago", exact: true });
      await expect(detail.getByRole("button", { name: "Editar pago", exact: true })).toBeInViewport();
      await detail.getByRole("button", { name: "Editar pago", exact: true }).tap();
      const form = page.getByRole("dialog", { name: "Pago", exact: true });
      await expect(form.getByRole("heading", { name: "Pago de Excel sin detalle", exact: true })).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await expect(form.getByLabel("Fecha", { exact: true })).toHaveValue("");
      await expect(form.getByRole("combobox", { name: "Aplicación al presupuesto", exact: true })).toHaveCount(0);
      await expect(form.getByRole("button", { name: "Eliminar", exact: true })).toHaveCount(0);
      await form.locator('input[name="expense-payment-crc-amount"]').fill("10000");
      await expect(form.getByRole("status", { name: "Pagado después de guardar", exact: true })).toHaveText(crc(12500));
      await form.getByLabel("Descripción (opcional)", { exact: true }).fill("Anticipo de pisos");
      await form.getByRole("button", { name: "Elegir comprobantes existentes", exact: true }).tap();
      await form.getByRole("button", { name: invoice.title, exact: true }).tap();
      const save = form.getByRole("button", { name: "Guardar pago", exact: true });
      await expect(save).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.evaluate(() => innerWidth)).toBe(viewport.width);
      expect(await form.locator(".expense-form").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`budget-v2-edit-import-${viewport.width}.png`) });
      await save.tap(); await expect(form).toHaveCount(0);
      expect(paymentWrites(writes)).toHaveLength(1);
      expect(paymentWrites(writes)[0]).toMatchObject({ id: "historical-floor", paymentsModelVersion: 2, amount: 10000, paymentDate: "", payee: "Anticipo de pisos", documentIds: [invoice.id] });
      expect(paymentWrites(writes)[0]).not.toHaveProperty("accountingMode");
      await expect(paidValue(page, line.item)).toHaveText(crc(12500));
      await expect(paymentHistoryToggle(page, line.item)).toBeFocused();
      await paymentHistoryToggle(page, line.item).tap();
      await expect(paymentHistoryTable(page, line.item).locator("tbody tr")).toHaveCount(2);
      await expect(paymentHistoryPanel(page, line.item)).toContainText("Anticipo de pisos");
    } finally { await context.close(); }
  });
}

for (const unavailable of ["missing", "moved"] as const) {
  test(`blocks a ${unavailable} fresh v2 payment instead of creating a replacement`, async ({ page }) => {
    const writes = await fixtures(page, { paymentHistory: true, paymentsModelVersion: 2 });
    await page.goto(`${address}/projects/house/budget`);
    await paymentHistoryToggle(page, line.item).click();
    await paymentHistoryPanel(page, line.item).getByRole("button", { name: `Ver pago ${floorPayment.payee}`, exact: true }).click();
    await page.route("**/api/expenses/payments", async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const fresh = unavailable === "moved" ? { ...floorPayment, budgetLineId: other.id } : undefined;
      await route.fulfill({ json: { payments: fresh ? [fresh] : [], completedLineIds: [], paymentsModelVersion: 2 } });
    });
    await page.getByRole("button", { name: "Editar pago", exact: true }).click();
    const form = page.getByRole("dialog", { name: "Pago", exact: true });
    await expect(form).toContainText("Este pago ya no está disponible en esta partida");
    await expect(form.getByRole("button", { name: "Guardar pago", exact: true })).toHaveCount(0);
    await expect(form.locator('input[name="expense-payment-crc-amount"]')).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await form.getByRole("button", { name: "Cerrar pago", exact: true }).click();
    await expect(form).toHaveCount(0);
    expect(paymentWrites(writes)).toHaveLength(0);
  });
}

test("adds a new v2 payment to all existing records without an Excel accounting choice", async ({ page }) => {
  const writes = await fixtures(page, { paymentHistory: true, paymentsModelVersion: 2, excelImport: true });
  await page.goto(`${address}/projects/house/budget`);
  await openPaymentForm(page, line.item);
  const form = page.getByRole("dialog", { name: "Pago", exact: true });
  await expect(form.getByRole("combobox", { name: "Aplicación al presupuesto", exact: true })).toHaveCount(0);
  await form.locator('input[name="expense-payment-crc-amount"]').fill("500");
  await expect(form.getByRole("status", { name: "Pagado después de guardar", exact: true })).toHaveText(crc(15500));
  await form.getByRole("button", { name: "Guardar pago", exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(paymentWrites(writes)).toHaveLength(1);
  expect(paymentWrites(writes)[0]).toMatchObject({ amount: 500, paymentsModelVersion: 2 });
  expect(paymentWrites(writes)[0]).not.toHaveProperty("id");
  expect(paymentWrites(writes)[0]).not.toHaveProperty("accountingMode");
  await expect(paidValue(page, line.item)).toHaveText(crc(15500));
  await paymentHistoryToggle(page, line.item).click();
  await expect(paymentHistoryTable(page, line.item).locator("tbody tr")).toHaveCount(3);
});

test("shows only a budget item's payments and opens their purchase and several receipts", async ({ page }, testInfo) => {
  const writes = await fixtures(page, { paymentHistory: true });
  await page.goto(`${address}/projects/house/budget`);
  await paymentHistoryToggle(page, line.item).click();
  const table = paymentHistoryTable(page, line.item);
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await expect(table).toContainText(floorPayment.payee);
  await expect(table).toContainText("Pago histórico de pisos");
  await expect(table).not.toContainText(roofPayment.payee);
  await expect(table.getByRole("button", { name: `Ver comprobantes de ${floorPayment.payee}`, exact: true })).toContainText("2 comprobantes");
  await expect(table.getByRole("button", { name: `Ver compra ${purchase.title}`, exact: true })).toBeVisible();
  await expect(paidValue(page, line.item)).toHaveText(crc(15000));
  await table.getByRole("button", { name: `Ver pago ${floorPayment.payee}`, exact: true }).click();
  const detail = page.getByRole("dialog", { name: "Detalle del pago", exact: true });
  await expect(detail).toContainText(floorPayment.payee);
  await expect(detail).toContainText(floorPayment.reference);
  await expect(detail).toContainText(floorPayment.notes);
  await expect(detail).toContainText(detailCrc(floorPayment.amount));
  await expect(detail.getByRole("region", { name: "Compra de este pago", exact: true })).toContainText(purchase.title);
  await expect(detail).toContainText(purchase.reference);
  await expect(detail).not.toContainText("Compra de techo");
  await expect(detail.getByRole("button", { name: "Editar pago", exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: /Eliminar|Guardar/ })).toHaveCount(0);
  await expect(detail.getByRole("textbox")).toHaveCount(0);
  await expect(detail.getByRole("button", { name: `Ver comprobante ${transferReceipt.title}`, exact: true })).toBeVisible();
  const receipt = detail.getByRole("button", { name: `Ver comprobante ${invoice.title}`, exact: true });
  await receipt.click();
  const preview = page.getByRole("dialog", { name: floorReceiptMedia.name, exact: true });
  await expect(preview).toBeVisible();
  await expect(preview.locator("img")).toHaveAttribute("src", /^blob:/);
  await expect.poll(() => preview.locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath("budget-payment-receipt-preview.png") });
  await preview.getByRole("button", { name: "Cerrar vista previa", exact: true }).click();
  await expect(detail).toBeVisible(); await expect(receipt).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("budget-payment-readonly-detail.png") });
  await detail.getByRole("button", { name: "Cerrar detalle del pago", exact: true }).click();
  await expect(detail).toHaveCount(0); await expect(paymentHistoryToggle(page, line.item)).toBeFocused();
  await expect(paymentHistoryPanel(page, line.item)).toHaveCount(0);
  await expect(page).toHaveURL(`${address}/projects/house/budget`);
  expect(writes).toHaveLength(0);
});

test("opens a compact payment table from the editor Paid cell without stretching the row", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixtures(page, { paymentHistory: true });
  await page.goto(`${address}/projects/house/budget`);
  await page.getByRole("button", { name: "Editar presupuesto", exact: true }).click();
  const objective = page.getByRole("spinbutton", { name: `${line.item} Objetivo`, exact: true });
  await objective.fill("70000");
  const row = page.locator(".budget-table-editor tbody > tr").filter({ has: objective });
  await expect(row.locator(":scope > th, :scope > td")).toHaveCount(6);
  await expect(page.locator(".budget-line-purchases, .budget-payment-history-row")).toHaveCount(0);
  const trigger = paymentHistoryToggle(page, line.item);
  const paidCell = row.locator("td").filter({ has: trigger });
  await expect(paidCell).toContainText(crc(15000));
  await expect(paidCell.getByRole("button")).toHaveCount(1);
  const before = (await row.boundingBox())!;
  expect(before.height).toBeLessThanOrEqual(220);
  const inputBounds = (await objective.boundingBox())!;
  const triggerBounds = (await trigger.boundingBox())!;
  expect(Math.abs(inputBounds.y - triggerBounds.y)).toBeLessThanOrEqual(20);
  await row.screenshot({ path: testInfo.outputPath("budget-editor-compact-row-desktop.png") });
  await page.screenshot({ path: testInfo.outputPath("budget-editor-desktop.png"), fullPage: true });
  await paymentHistoryToggle(page, line.item).click();
  const panel = paymentHistoryPanel(page, line.item);
  const table = paymentHistoryTable(page, line.item);
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await expect(table.getByRole("columnheader")).toHaveCount(3);
  await expect(table).not.toContainText(roofPayment.payee);
  await expect(table.locator("xpath=ancestor::tr")).toHaveCount(0);
  const after = (await row.boundingBox())!;
  expect(after.height).toBeCloseTo(before.height, 0);
  const panelBounds = (await panel.boundingBox())!;
  expect(panelBounds.width).toBeLessThanOrEqual(540);
  expect(panelBounds.x).toBeGreaterThanOrEqual(0);
  expect(panelBounds.x + panelBounds.width).toBeLessThanOrEqual(1440);
  await page.screenshot({ path: testInfo.outputPath("budget-editor-payment-panel-desktop.png") });
  await table.getByRole("button", { name: "Ver pago Pago histórico de pisos", exact: true }).click();
  const detail = page.getByRole("dialog", { name: "Detalle del pago", exact: true });
  await expect(detail).toContainText("Detalle del histórico de Excel · no se suma otra vez");
  await expect(detail).toContainText("No hay comprobantes asociados a este pago.");
  await detail.getByRole("button", { name: "Cerrar detalle del pago", exact: true }).click();
  await expect(trigger).toBeFocused();
  await expect(objective).toHaveValue("70000");
  await expect(paidValue(page, line.item)).toHaveText(crc(15000));
  await expect(page).toHaveURL(`${address}/projects/house/budget/chapter`);
});

test("allows viewers to read payment details without mutation controls", async ({ page }) => {
  const writes = await fixtures(page, { paymentHistory: true });
  await page.goto(`${address}/projects/house/budget?role=viewer`);
  await paymentHistoryToggle(page, line.item).click();
  await paymentHistoryTable(page, line.item).getByRole("button", { name: `Ver pago ${floorPayment.payee}`, exact: true }).click();
  const detail = page.getByRole("dialog", { name: "Detalle del pago", exact: true });
  await expect(detail).toContainText(purchase.title);
  await expect(detail.getByRole("button", { name: `Ver comprobante ${invoice.title}`, exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: /Editar|Eliminar|Guardar/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Agregar pago", exact: true })).toHaveCount(0);
  expect(writes).toHaveLength(0);
});

test("does not expose or fetch payment history without purchases access", async ({ page }) => {
  const reads = watchPaymentReads(page);
  await fixtures(page, { paymentHistory: true });
  await page.goto(`${address}/projects/house/budget?role=budget-only`);
  await expect(page.locator(".budget-line-card")).toHaveCount(3);
  await expect(page.getByLabel(/^Ver pagos de /)).toHaveCount(0);
  await page.getByRole("button", { name: "Editar presupuesto", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: `${line.item} Objetivo`, exact: true })).toBeEnabled();
  await expect(page.getByLabel(/^Ver pagos de /)).toHaveCount(0);
  expect(reads).toHaveLength(0);
});

test("shares a lazy history request across budget items and keeps only one panel open", async ({ page }) => {
  const reads = watchPaymentReads(page);
  await fixtures(page, { paymentHistory: true });
  await page.goto(`${address}/projects/house/budget`);
  await expect(page.locator(".budget-line-card")).toHaveCount(3);
  expect(reads).toHaveLength(0);
  await paymentHistoryToggle(page, line.item).click();
  await expect(paymentHistoryTable(page, line.item).locator("tbody tr")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await paymentHistoryToggle(page, other.item).click();
  const roof = paymentHistoryTable(page, other.item);
  await expect(roof.locator("tbody tr")).toHaveCount(1);
  await expect(roof).toContainText(roofPayment.payee); await expect(roof).not.toContainText(floorPayment.payee);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(paymentHistoryPanel(page, line.item)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await paymentHistoryToggle(page, unpaid.item).click();
  await expect(page.getByText("Todavía no hay pagos registrados para esta partida.", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await paymentHistoryToggle(page, line.item).click();
  await expect(paymentHistoryTable(page, line.item).locator("tbody tr")).toHaveCount(2);
  expect(reads).toHaveLength(1);
});

test("refreshes an expanded payment subtable and its total after recording an abono", async ({ page }) => {
  const writes = await fixtures(page, { paymentHistory: true });
  await page.goto(`${address}/projects/house/budget`);
  await paymentHistoryToggle(page, line.item).click();
  const table = paymentHistoryTable(page, line.item);
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await openPaymentForm(page, line.item);
  const dialog = page.getByRole("dialog", { name: "Pago", exact: true });
  await dialog.getByLabel("Aplicación al presupuesto", { exact: true }).selectOption("ledger");
  await dialog.locator('input[name="expense-payment-crc-amount"]').fill("2500");
  await dialog.getByLabel("Descripción (opcional)", { exact: true }).fill("Abono nuevo de pisos");
  await dialog.getByRole("button", { name: "Guardar pago", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await paymentHistoryToggle(page, line.item).click();
  await expect(table.locator("tbody tr")).toHaveCount(3);
  await expect(table).toContainText("Abono nuevo de pisos");
  await expect(table).not.toContainText(roofPayment.payee);
  await expect(paidValue(page, line.item)).toHaveText(crc(17500));
  expect(paymentWrites(writes)).toHaveLength(1);
  await expect(page).toHaveURL(`${address}/projects/house/budget`);
});

test("retries a payment history read in place without navigating away", async ({ page }) => {
  const reads = watchPaymentReads(page);
  await fixtures(page, { paymentHistory: true, failHistoryRead: true });
  await page.goto(`${address}/projects/house/budget`);
  await paymentHistoryToggle(page, line.item).click();
  const panel = paymentHistoryPanel(page, line.item);
  await expect(panel.getByRole("alert")).toContainText("No se pudieron cargar los pagos.");
  await panel.getByRole("button", { name: `Reintentar pagos de ${line.item}`, exact: true }).click();
  await expect(paymentHistoryTable(page, line.item).locator("tbody tr")).toHaveCount(2);
  expect(reads).toHaveLength(2);
  await expect(page).toHaveURL(`${address}/projects/house/budget`);
});

test("retries payment receipt details while retaining the selected payment", async ({ page }) => {
  const writes = await fixtures(page, { paymentHistory: true, failDetailsRead: true });
  await page.goto(`${address}/projects/house/budget`);
  await paymentHistoryToggle(page, line.item).click();
  await paymentHistoryTable(page, line.item).getByRole("button", { name: `Ver pago ${floorPayment.payee}`, exact: true }).click();
  const detail = page.getByRole("dialog", { name: "Detalle del pago", exact: true });
  await expect(detail.getByRole("alert")).toContainText("No se pudieron cargar los comprobantes de este pago.");
  await expect(detail).toContainText(floorPayment.reference);
  await detail.getByRole("button", { name: "Reintentar", exact: true }).click();
  await expect(detail.getByRole("button", { name: `Ver comprobante ${invoice.title}`, exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: `Ver comprobante ${transferReceipt.title}`, exact: true })).toBeVisible();
  await expect(detail.getByRole("alert")).toHaveCount(0);
  expect(writes).toHaveLength(0);
});

test("retains the complete collection in Compras y gastos", async ({ page }) => {
  await fixtures(page, { paymentHistory: true });
  await page.goto(`${address}/projects/house/budget`);
  await page.getByRole("link", { name: "Todas las compras y pagos", exact: true }).click();
  await expect(page).toHaveURL(`${address}/projects/house/expenses`);
  await page.locator(".expense-tabs").getByRole("button", { name: /^Pagos/ }).click();
  const ledger = page.getByRole("region", { name: "Historial de pagos", exact: true });
  await expect(ledger.locator(".payment-item")).toHaveCount(3);
  await expect(ledger).toContainText(floorPayment.payee);
  await expect(ledger).toContainText(roofPayment.payee);
  await expect(ledger).toContainText("Pago histórico de pisos");
  await expect(ledger.getByRole("button", { name: "Editar", exact: true })).toHaveCount(3);
  await expect(page.locator(".expense-budget-scope")).toHaveCount(0);
});

test("requires an accounting choice and records an Excel payment without doubling Paid", async ({ page }) => {
  const writes = await fixtures(page, { historicalPaid: 515300 });
  await page.goto(`${address}/projects/house/budget`);
  await expect(paidValue(page, line.item)).toHaveText(crc(515300));
  await openPaymentForm(page, line.item);
  const dialog = page.getByRole("dialog", { name: "Pago", exact: true });
  const accounting = dialog.getByLabel("Aplicación al presupuesto", { exact: true });
  await expect(accounting).toHaveValue("");
  await dialog.locator('input[name="expense-payment-crc-amount"]').fill("515300");
  await dialog.getByLabel("Descripción (opcional)", { exact: true }).fill("Pago incluido en Excel");
  await dialog.getByRole("button", { name: "Elegir comprobantes existentes", exact: true }).click();
  await dialog.getByRole("button", { name: invoice.title, exact: true }).click();
  await dialog.getByRole("button", { name: "Guardar pago", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Indica si es un pago nuevo o ya incluido en Excel");
  expect(paymentWrites(writes)).toHaveLength(0);
  await accounting.selectOption("historical-detail");
  await dialog.getByRole("button", { name: "Guardar pago", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(paymentWrites(writes)).toHaveLength(1);
  expect(paymentWrites(writes)[0]).toMatchObject({ budgetLineId: line.id, amount: 515300, accountingMode: "historical-detail", documentIds: [invoice.id] });
  await expect(paidValue(page, line.item)).toHaveText(crc(515300));
  await paymentHistoryToggle(page, line.item).click();
  const table = paymentHistoryTable(page, line.item);
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table).toContainText("Pago incluido en Excel");
  await expect(table).toContainText("Histórico de Excel · ya incluido");
  await expect(paidValue(page, line.item)).not.toHaveText(crc(1030600));
});

for (const viewport of [{ width: 320, height: 700 }, { width: 360, height: 800 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`Budget editor payment panel and receipt detail fit at ${viewport.width}x${viewport.height}`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true }); const page = await context.newPage();
    try {
      await fixtures(page, { paymentHistory: true }); await page.goto(`${address}/projects/house/budget`);
      await page.getByRole("button", { name: "Editar presupuesto", exact: true }).click();
      const row = page.locator(".budget-table-editor tbody > tr").filter({ hasText: line.item });
      await expect(row).toBeVisible();
      await expect(row.locator(".budget-line-purchases")).toHaveCount(0);
      const trigger = paymentHistoryToggle(page, line.item);
      await trigger.scrollIntoViewIfNeeded(); await expect(trigger).toBeInViewport();
      expect(await page.evaluate(() => innerWidth)).toBe(viewport.width);
      expect(await row.evaluate((element) => getComputedStyle(element).display)).toBe("grid");
      const triggerBounds = (await trigger.boundingBox())!;
      expect(triggerBounds.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      // Element screenshots can resize Chromium and clear touch emulation; keep the device viewport intact.
      await page.screenshot({ path: testInfo.outputPath(`budget-editor-card-${viewport.width}.png`) });
      await paymentHistoryToggle(page, line.item).tap();
      const panel = paymentHistoryPanel(page, line.item);
      const table = paymentHistoryTable(page, line.item);
      await expect(table.locator("tbody tr")).toHaveCount(2);
      await expect(table.locator("thead th")).toHaveCount(3);
      const panelBounds = (await panel.boundingBox())!;
      expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
      expect(panelBounds.width).toBe(viewport.width);
      expect(await panel.evaluate((element) => getComputedStyle(element).bottom)).toBe("0px");
      expect(panelBounds.x).toBeGreaterThanOrEqual(0);
      expect(panelBounds.y).toBeGreaterThanOrEqual(0);
      expect(panelBounds.x + panelBounds.width).toBeLessThanOrEqual(viewport.width);
      expect(panelBounds.y + panelBounds.height).toBeLessThanOrEqual(viewport.height + 1);
      expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await expect(panel.getByRole("button", { name: "Agregar pago", exact: true })).toBeInViewport();
      if (viewport.height === 390) {
        const history = panel.locator(".budget-payment-history");
        const bounds = (await history.boundingBox())!;
        const x = bounds.x + bounds.width - 10, startY = bounds.y + bounds.height - 20, endY = bounds.y + 20;
        const session = await context.newCDPSession(page);
        await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: startY }] });
        for (let step = 1; step <= 8; step++) await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: startY + (endY - startY) * step / 8 }] });
        await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await expect.poll(() => history.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
        await session.detach();
        await history.evaluate((element) => { element.scrollTop = 0; });
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`budget-editor-payment-panel-${viewport.width}.png`) });
      expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
      expect((await panel.boundingBox())!.width).toBe(viewport.width);
      await table.getByRole("button", { name: `Ver comprobantes de ${floorPayment.payee}`, exact: true }).click();
      await expect(panel).toHaveCount(0);
      const detail = page.getByRole("dialog", { name: "Detalle del pago", exact: true });
      await expect(detail.getByRole("button", { name: `Ver comprobante ${transferReceipt.title}`, exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`budget-payment-detail-${viewport.width}.png`) });
      const close = detail.getByRole("button", { name: "Cerrar", exact: true });
      await close.scrollIntoViewIfNeeded(); await expect(close).toBeInViewport(); await close.click();
      await expect(detail).toHaveCount(0); await expect(trigger).toBeFocused();
      await expect(page).toHaveURL(`${address}/projects/house/budget/chapter`);
    } finally { await context.close(); }
  });
}

for (const viewport of [{ width: 320, height: 700 }, { width: 360, height: 800 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`Budget editor opens an upload-ready payment form at ${viewport.width}x${viewport.height}`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true }); const page = await context.newPage();
    try {
      await fixtures(page); await page.goto(`${address}/projects/house/budget`);
      await page.getByRole("button", { name: "Editar presupuesto", exact: true }).click();
      await expect(page.locator(".budget-table-editor")).toBeVisible();
      await expect(page.getByRole("spinbutton", { name: `${line.item} Objetivo`, exact: true })).toBeVisible();
      const action = paymentHistoryToggle(page, line.item);
      await action.click({ trial: true }); await expect(action).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await openPaymentForm(page, line.item);
      const dialog = page.getByRole("dialog", { name: "Pago", exact: true });
      await expect(dialog).toContainText(line.item);
      await page.screenshot({ path: testInfo.outputPath(`budget-payment-start-${viewport.width}.png`) });
      await dialog.getByLabel("Aplicación al presupuesto", { exact: true }).selectOption("ledger");
      await dialog.locator('input[name="expense-payment-crc-amount"]').fill("2500");
      await dialog.locator('input[type="file"]').setInputFiles({ name: "Comprobante del nuevo abono.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Kq0AAAAASUVORK5CYII=", "base64") });
      await expect(dialog).toContainText("Comprobante del nuevo abono.png");
      await dialog.getByRole("button", { name: "Elegir comprobantes existentes", exact: true }).click();
      await dialog.getByRole("button", { name: invoice.title, exact: true }).click();
      const save = dialog.getByRole("button", { name: "Guardar pago", exact: true });
      await save.scrollIntoViewIfNeeded(); await expect(save).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`budget-payment-form-${viewport.width}.png`) });
      await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
      await expect(action).toBeFocused();
      await expect(page).toHaveURL(`${address}/projects/house/budget/chapter`);
    } finally { await context.close(); }
  });
}

for (const viewport of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`receipts and the creation dialog fit at ${viewport.width}x${viewport.height}`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true }); const page = await context.newPage();
    try {
      await fixtures(page); await page.goto(scopedUrl()); await expect(page.locator(".document-card")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`receipts-${viewport.width}.png`), fullPage: true });
      await page.getByRole("button", { name: /Nuevo comprobante/ }).click();
      const dialog = page.getByRole("dialog", { name: "Comprobante", exact: true }); await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: /^Guardar/ }).scrollIntoViewIfNeeded();
      await expect(dialog.getByRole("button", { name: /^Guardar/ })).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`receipt-form-${viewport.width}.png`) });
      await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
    } finally { await context.close(); }
  });
}
