import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import type { PaymentReminder } from "../lib/payment-reminders";

let server: Server, address: string;
test.beforeAll(async () => {
  const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import ExpensesWorkspace from './app/components/ExpensesWorkspace';createRoot(document.getElementById('root')).render(<main style={{padding:16}}><ExpensesWorkspace mode="real" language="es" projectId="synthetic-house" isOwner={new URLSearchParams(location.search).get('role')!=='viewer'}/></main>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, outfile: "reminders.js", platform: "browser", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "reminder-leaves", setup(builder) {
    builder.onResolve({ filter: /^(next\/image|@\/lib\/usage-client)$/ }, (args) => ({ path: args.path, namespace: "mock" }));
    builder.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({ contents: args.path === "next/image" ? "export default function Image(){return null;}" : "export const trackDemoAction=()=>{},trackUsageInteraction=()=>{};", loader: "tsx", resolveDir: process.cwd() }));
  } }] });
  const css = await readFile("app/globals.css", "utf8") + (bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text || "");
  server = createServer((request, response) => {
    if (request.url === "/reminders.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles.find((file) => file.path.endsWith(".js"))!.text); }
    else { response.setHeader("content-type", "text/html"); response.end(`<html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--font-geist-sans:Arial;--font-geist-mono:monospace}${css}</style><div id="root"></div><script src="/reminders.js"></script></html>`); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>((resolve) => server.close(() => resolve())); });

async function fixtures(page: Page, options: { failSave?: boolean; failRefresh?: boolean } = {}) {
  let reminders: PaymentReminder[] = [
    { id: "legacy-reminder", description: "Suministro eléctrico de prueba", amount: 300, currency: "CRC", dueDate: "", vendor: "", notes: "Revisar antes de pagar", status: "pending", revision: 0 },
    { id: "unpriced", description: "Revisar transporte", amount: null, currency: "USD", dueDate: "", vendor: "", notes: "", status: "pending", revision: 1 },
  ];
  let committed = false, refreshFailed = false;
  const writes: Array<{ method: string; body: Record<string, unknown> }> = [], financialReads: string[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path !== "/api/expenses/reminders") { financialReads.push(path); return route.fulfill({ status: 503, json: { error: "Budget intentionally unavailable in this fixture" } }); }
    if (request.method() === "GET") {
      if (options.failRefresh && committed && !refreshFailed) { refreshFailed = true; return route.fulfill({ status: 503, json: { error: "No se pudo actualizar la lista" } }); }
      return route.fulfill({ json: { reminders, defaultCurrency: "USD" } });
    }
    const body = request.postDataJSON(); writes.push({ method: request.method(), body });
    if (options.failSave) return route.fulfill({ status: 503, json: { error: "Guardar temporalmente no disponible" } });
    if (request.method() === "POST") reminders.push({ ...body, id: "new-reminder", status: "pending", revision: 1 });
    else if (request.method() === "DELETE") reminders = reminders.filter((item) => item.id !== body.id);
    else reminders = reminders.map((item) => item.id === body.id ? { ...item, ...body, revision: item.revision + 1 } : item);
    committed = true;
    return route.fulfill({ json: { id: body.id || "new-reminder" } });
  });
  return { writes, financialReads };
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`manages independent reminders and preserves legacy entries at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport); const data = await fixtures(page);
    await page.goto(`${address}/projects/synthetic-house/expenses?expenseTab=pending&budgetLine=irrelevant`);
    await expect(page.getByRole("heading", { name: "Pagos pendientes", exact: true })).toBeVisible();
    await expect(page.locator(".reminder-card")).toHaveCount(2);
    const total = page.getByRole("region", { name: "Total pendiente", exact: true });
    await expect(total).toContainText("₡300"); await expect(total).toContainText("1 pendiente sin importe");
    await expect(page.locator(".expense-summary-bar, .expense-budget-scope")).toHaveCount(0);
    const old = page.locator(".reminder-card").filter({ hasText: "Suministro eléctrico de prueba" });
    await expect(old).toContainText("₡300"); await expect(old).toContainText("CRC");
    await page.getByRole("button", { name: "Nuevo recordatorio", exact: true }).click();
    const form = page.getByRole("dialog", { name: "Recordatorio de pago", exact: true });
    await expect(form.getByRole("combobox")).toHaveCount(1);
    await form.getByLabel("Descripción", { exact: false }).fill("Revisar una factura de prueba con un título largo");
    await form.getByLabel("Fecha prevista opcional", { exact: true }).fill("2026-12-01");
    await form.getByLabel("Notas", { exact: true }).fill("Confirmar el importe antes de pagar");
    await form.getByRole("button", { name: "Guardar recordatorio", exact: true }).scrollIntoViewIfNeeded();
    await expect(form.getByRole("button", { name: "Guardar recordatorio", exact: true })).toBeInViewport();
    await form.getByRole("button", { name: "Guardar recordatorio", exact: true }).click();
    await expect(form).toHaveCount(0); await expect(page.locator(".reminder-card")).toHaveCount(3);
    expect(data.writes[0]).toMatchObject({ method: "POST", body: { amount: null, currency: "USD", dueDate: "2026-12-01" } });
    expect(data.writes[0].body).not.toHaveProperty("budgetLineId");
    await old.getByRole("button", { name: "Editar", exact: true }).click();
    await form.getByLabel("Importe opcional", { exact: true }).fill("250.75");
    await form.getByRole("button", { name: "Guardar recordatorio", exact: true }).click();
    await expect(old).toContainText("250,75");
    await expect(total).toContainText("250,75");
    expect(data.writes[1]).toMatchObject({ method: "PATCH", body: { id: "legacy-reminder", revision: 0, amount: 250.75, currency: "CRC" } });
    await old.getByRole("button", { name: "Marcar resuelto", exact: true }).click(); await expect(old).toHaveCount(0);
    await expect(total).not.toContainText("250,75");
    await page.locator(".reminder-filters select").selectOption("done");
    await expect(old).toContainText("Resuelto");
    await old.getByRole("button", { name: "Reabrir", exact: true }).click(); await expect(old).toHaveCount(0);
    await page.locator(".reminder-filters select").selectOption("pending"); await expect(old).toBeVisible();
    await expect(total).toContainText("250,75");
    page.once("dialog", (dialog) => dialog.accept()); await old.getByRole("button", { name: "Eliminar", exact: true }).click();
    await expect(old).toHaveCount(0); await page.reload();
    await expect(total).not.toContainText("250,75");
    await expect(page.locator(".reminder-card")).toHaveCount(2);
    await expect(page.locator(".reminder-card").filter({ hasText: "Revisar una factura" })).toContainText("2026-12-01");
    expect(data.financialReads).toEqual([]);
    expect(data.writes.every((item) => !item.body.budgetLineId && !item.body.paymentKind)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`reminders-${viewport.width}.png`), fullPage: true });
  });
}

test("readers can search reminders without mutations or budget access", async ({ page }) => {
  const data = await fixtures(page); await page.goto(`${address}/?expenseTab=pending&role=viewer&newPayment=1`);
  await expect(page.locator(".reminder-card")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /Nuevo recordatorio|Marcar resuelto|Editar|Eliminar/ })).toHaveCount(0);
  await page.getByLabel("Buscar recordatorios", { exact: true }).fill("eléctrico");
  await expect(page.locator(".reminder-card")).toHaveCount(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(data.writes).toEqual([]); expect(data.financialReads).toEqual([]);
});

test("keeps a rejected reminder form and never changes the paid ledger", async ({ page }) => {
  const data = await fixtures(page, { failSave: true }); await page.goto(`${address}/?expenseTab=pending`);
  await page.getByRole("button", { name: "Editar", exact: true }).first().click();
  const form = page.getByRole("dialog", { name: "Recordatorio de pago", exact: true });
  await form.getByLabel("Descripción", { exact: false }).fill("Conservar el borrador");
  await form.getByRole("button", { name: "Guardar recordatorio", exact: true }).click();
  await expect(form).toContainText("Guardar temporalmente no disponible");
  await expect(form.getByLabel("Descripción", { exact: false })).toHaveValue("Conservar el borrador");
  expect(data.financialReads).toEqual([]);
});

test("does not resubmit a saved reminder after a refresh error", async ({ page }) => {
  const data = await fixtures(page, { failRefresh: true }); await page.goto(`${address}/?expenseTab=pending`);
  await page.getByRole("button", { name: "Nuevo recordatorio", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Recordatorio de pago", exact: true });
  await form.getByLabel("Descripción", { exact: false }).fill("Recordatorio persistido");
  await form.getByRole("button", { name: "Guardar recordatorio", exact: true }).click();
  await expect(form).toHaveCount(0); await expect(page.getByRole("alert")).toContainText("No se pudo actualizar la lista");
  await page.getByRole("button", { name: "Actualizar", exact: true }).click();
  await expect(page.locator(".reminder-card")).toHaveCount(3);
  expect(data.writes).toHaveLength(1); expect(data.financialReads).toEqual([]);
});
