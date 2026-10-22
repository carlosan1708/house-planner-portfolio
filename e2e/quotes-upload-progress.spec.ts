import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdir, readFile } from "node:fs/promises";

let server: Server;
let address: string;
let streamingResponse: ServerResponse | null = null;
let failUpload = false;
let completed = false;
const quote = { id: "quote-1", fileName: "Offer.pdf", size: 1024, files: [{ name: "Offer.pdf", contentType: "application/pdf", size: 1024, fileUrl: "/original.pdf" }], uploadedBy: "owner@example.test", status: "ready", error: "", referenceIds: [], referenceNames: [], pastQuoteIds: [], pastQuoteNames: [], webRequested: false, analysis: null, createdAt: "2026-10-05T12:00:00Z", fileUrl: "/original.pdf" };

test.beforeAll(async () => {
  await mkdir("outputs/upload-folder-links", { recursive: true });
  const bundle = await build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Quotes from './app/components/QuotesWorkspace';createRoot(document.getElementById('root')).render(<Quotes language="en" mode="real" canEdit={true}/>);`, loader: "tsx", resolveDir: process.cwd() },
    bundle: true, write: false, outfile: "quotes.js", platform: "browser", define: { "process.env.NODE_ENV": '"production"' },
  });
  const css = await readFile("app/globals.css", "utf8") + (bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text || "");
  server = createServer((request, response) => {
    if (request.url?.startsWith("/api/quotes") && request.method === "GET") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ quotes: completed ? [quote] : [], references: [], messages: [] }));
    } else if (request.url === "/api/quotes" && request.method === "POST") {
      request.resume();
      request.on("end", () => {
        if (failUpload) { response.writeHead(413, { "content-type": "application/json" }); response.end('{"error":"Offer is too large"}'); return; }
        streamingResponse = response;
        response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8" });
        response.write('{"type":"progress","stage":"references"}\n');
      });
    } else if (request.url === "/quotes.js") {
      response.setHeader("content-type", "text/javascript");
      response.end(bundle.outputFiles.find((file) => file.path.endsWith(".js"))!.text);
    } else {
      response.setHeader("content-type", "text/html");
      response.end(`<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><style>html{--font-geist-sans:Arial;--font-geist-mono:monospace}${css}body{padding:20px}</style><div id="root"></div><script src="/quotes.js"></script></html>`);
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

test.beforeEach(() => { streamingResponse = null; failUpload = false; completed = false; });
test.afterEach(() => { streamingResponse?.end(); });
test.afterAll(async () => { if (server) await new Promise<void>((done) => server.close(() => done())); });

test("keeps streamed quote analysis stages visible before the response finishes", async ({ page }) => {
  await page.goto(address);
  await page.locator('input[type="file"]').setInputFiles({ name: "Offer.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(1024) });
  await page.getByRole("button", { name: "Compare offers", exact: true }).click();
  await expect(page.locator(".quote-progress li.current")).toContainText("Opening plans and past quotes");
  await expect(page.getByRole("button", { name: "Analysis in progress…", exact: true })).toBeDisabled();
  expect(completed).toBe(false);
  expect(streamingResponse).not.toBeNull();
  streamingResponse!.write('{"type":"progress","stage":"struc');
  await expect(page.locator(".quote-progress li.current")).toContainText("Opening plans and past quotes");
  streamingResponse!.write('turing"}\n');
  await expect(page.locator(".quote-progress li.current")).toContainText("Preparing questions, risks and differences");
  await page.screenshot({ path: "outputs/upload-folder-links/quotes-streaming-stages.png", fullPage: true });
  completed = true;
  streamingResponse!.end(JSON.stringify({ type: "complete", quote }));
  await expect(page.locator(".quote-progress li.current")).toContainText("Review ready");
  await expect(page.locator(".quote-history")).toContainText("Offer.pdf");
  await expect(page.locator(".quote-error")).toHaveCount(0);
});

test("retains upload failure feedback from the server and allows another attempt", async ({ page }) => {
  failUpload = true;
  await page.goto(address);
  await page.locator('input[type="file"]').setInputFiles({ name: "Offer.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(1024) });
  await page.getByRole("button", { name: "Compare offers", exact: true }).click();
  await expect(page.locator(".quote-error")).toHaveText("Offer is too large");
  await expect(page.locator(".upload-progress")).toContainText("Upload stopped");
  await expect(page.locator(".upload-progress")).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("button", { name: "Compare offers", exact: true })).toBeEnabled();
});

const mobileName = `Oferta de materiales ${"ProveedorSinEspacios".repeat(7)}.pdf`;
const mobileAnalysis = { summary: "Comparar el alcance antes de contratar.", recommendation: "Confirmar medidas y condiciones de instalación.", essentialQuestions: [{ question: "¿Incluye instalación?", reason: "Evitar partidas sin presupuesto." }], mainRisks: [{ risk: "Alcance incompleto", impact: "Costo adicional", evidence: "La oferta no define transporte." }], scopeFindings: [{ item: mobileName, finding: "Falta confirmar entrega y transporte.", importance: "Alta" }], budgetComparison: [{ item: mobileName, quoted: "₡1.250.000", budget: "₡1.000.000", difference: "₡250.000" }], planFindings: [], missingInformation: ["Fechas de entrega"], webComparison: { status: "not_requested", summary: "", sources: [], queries: [] } };
const mobileQuotes = Array.from({ length: 8 }, (_, index) => ({ ...quote, id: `quote-${index + 1}`, fileName: `${index + 1}-${mobileName}`, files: [{ ...quote.files[0], name: mobileName }], analysis: mobileAnalysis }));

test.describe("mobile quote review navigation", () => {
  test.use({ isMobile: true, hasTouch: true });
  for (const viewport of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    test(`history selection and completed analysis reveal the review with focus at ${viewport.width}`, async ({ page, browserName }) => {
      test.skip(browserName !== "chromium"); await page.setViewportSize(viewport);
      await page.route("**/api/quotes*", route => {
        if (route.request().method() !== "GET") return route.continue();
        return route.fulfill({ json: { quotes: mobileQuotes, references: Array.from({ length: 30 }, (_, index) => ({ id: `plan-${index}`, name: `${mobileName} ${index + 1}`, contentType: "application/pdf", createdAt: quote.createdAt })), messages: [] } });
      });
      await page.goto(address);
      await expect(page.locator(".quote-history > button")).toHaveCount(8);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
      await page.getByRole("button", { name: "View selected review", exact: true }).click();
      const results = page.getByRole("main", { name: "Quote review", exact: true });
      await expect(results).toBeFocused(); await expect(results).toBeInViewport();
      await page.locator(".quote-history > button").last().click();
      await expect(results).toBeFocused(); await expect(results).toBeInViewport();
      await expect(page.locator(".quote-history > button.selected")).toContainText(`8-${mobileName}`);
      await page.getByRole("button", { name: "New review", exact: true }).click();
      await expect(page.getByLabel("Supplier 1", { exact: true })).toBeFocused();
      await page.locator('input[type="file"]').setInputFiles({ name: mobileName, mimeType: "application/pdf", buffer: Buffer.alloc(1024) });
      await page.getByRole("button", { name: "Compare offers", exact: true }).click();
      await expect(page.locator(".quote-progress li.current")).toContainText("Opening plans and past quotes");
      streamingResponse!.end(JSON.stringify({ type: "complete", quote: mobileQuotes[0] }));
      await expect(results).toBeFocused(); await expect(results).toBeInViewport();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
      await results.getByRole("button", { name: /Delete/ }).click();
      for (const button of await page.getByRole("alertdialog").getByRole("button").all()) {
        await expect(button).toHaveCSS("font-size", "12px");
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await page.getByRole("alertdialog").getByRole("button", { name: "Keep", exact: true }).click();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await mkdir("test-results/mobile-audit", { recursive: true });
      await page.screenshot({ path: `test-results/mobile-audit/populated-${viewport.width}-quotes.png` });
    });
  }
});
