import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import type { UsageAnalyticsResponse, UsageTotals } from "../lib/usage-types";

let server: Server;
let address: string;
const DAY_MS = 86_400_000;
const zero: UsageTotals = { visits: 0, visitors: 0, users: 0, views: 0, actions: 0, activeMs: 0 };
const projectOptions = [
  { projectId: "sampletown", name: "Demo Pavilion" },
  { projectId: "sample", name: "Sample Community" },
  { projectId: "personal", name: "Mi espacio" },
];

function responseFor(url: URL, empty = false): UsageAnalyticsResponse {
  const filters: UsageAnalyticsResponse["filters"] = {
    from: url.searchParams.get("from")!, to: url.searchParams.get("to")!,
    context: url.searchParams.get("context") as UsageAnalyticsResponse["filters"]["context"],
    projectId: url.searchParams.get("projectId"), includeOwner: url.searchParams.get("includeOwner") === "true",
  };
  const length = Math.round((Date.parse(filters.to) - Date.parse(filters.from)) / DAY_MS) + 1;
  const daily = Array.from({ length }, (_, index) => {
    const day = new Date(Date.parse(filters.from) + index * DAY_MS).toISOString().slice(0, 10);
    const factor = filters.projectId ? 0.6 : filters.context === "demo" ? 0.3 : filters.context === "access" ? 0.2 : 1;
    const visits = empty || day < "2026-09-08" ? 0 : Math.round((9 + index % 5 * 2 + Math.floor(index / 6)) * factor);
    return { day, visits, visitors: Math.round(visits * 0.8), users: visits ? 3 : 0, views: visits * 4 + (visits ? index % 7 : 0), actions: visits ? Math.round(visits * 1.7) : 0, activeMs: visits * 72_000 };
  });
  const totals = daily.reduce<UsageTotals>((sum, day) => ({ visits: sum.visits + day.visits, visitors: sum.visitors + day.visitors, users: day.users ? 3 : sum.users, views: sum.views + day.views, actions: sum.actions + day.actions, activeMs: sum.activeMs + day.activeMs }), { ...zero });
  totals.visitors = Math.round(totals.visitors * 0.55);
  const scaled = (fraction: number): UsageTotals => Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Math.round(value * fraction)])) as UsageTotals;
  const projects = !empty && (filters.context === "all" || filters.context === "project")
    ? projectOptions.filter((project) => !filters.projectId || project.projectId === filters.projectId).map((project, index) => ({ ...project, ...scaled(filters.projectId ? 1 : [0.6, 0.3, 0.1][index]) })) : [];
  const sections = empty ? [] : filters.context === "access" ? [{ section: "access", ...totals }]
    : ["budget", "documents", "site", "aesthetics", "plan"].map((section, index) => ({ section, ...scaled([0.35, 0.25, 0.18, 0.13, 0.09][index]) }));
  const users = empty || filters.context === "demo" ? [] : [
    { uid: "maria", name: "María Fernanda Sampletown", email: "maria.sampletown@example.test", lastAt: "2026-10-07T02:05:00Z", views: 482, actions: 217, activeMs: 3_840_000 },
    { uid: "carlos", name: "Carlos Rodríguez", email: "carlos.rodriguez@example.test", lastAt: "2026-10-06T19:18:00Z", views: 358, actions: 163, activeMs: 2_220_000 },
    { uid: "ana", name: "Ana Morales", email: "ana.morales@example.test", lastAt: "2026-10-06T15:32:00Z", views: 204, actions: 87, activeMs: 1_470_000 },
  ];
  return { filters, metadata: { startedAt: empty ? null : "2026-09-08T15:00:00Z", timezone: "America/Costa_Rica", retentionDays: 90 }, totals, daily, sections, projects, projectOptions, users };
}

test.beforeAll(async () => {
  const bundle = await build({
    stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import AnalyticsWorkspace from './app/components/AnalyticsWorkspace';const language=new URLSearchParams(location.search).get('lang')==='en'?'en':'es';createRoot(document.getElementById('root')).render(<main className="content" style={{maxWidth:1320}}><AnalyticsWorkspace language={language}/></main>);`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, outfile: "analytics.js", platform: "browser", define: { "process.env.NODE_ENV": '"production"' },
  });
  const css = await readFile("app/globals.css", "utf8") + "\n" + await readFile("app/components/analytics.css", "utf8");
  server = createServer((request, response) => {
    if (request.url === "/analytics.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles.find((file) => file.path.endsWith(".js"))!.text); }
    else { response.setHeader("content-type", "text/html"); response.end(`<!doctype html><html lang="es" style="--font-geist-sans:Arial;--font-geist-mono:monospace"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/analytics.js"></script></body></html>`); }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>((done) => server.close(() => done())); });
test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date("2026-10-07T02:15:00Z")); });

async function mockAnalytics(page: Page, options: { empty?: boolean; forbidden?: boolean } = {}) {
  const requests: URL[] = [];
  await page.route("**/api/admin/analytics?**", async (route) => {
    const url = new URL(route.request().url()); requests.push(url);
    await route.fulfill(options.forbidden ? { status: 403, json: { error: "Administrator access required" } } : { json: responseFor(url, options.empty) });
  });
  return requests;
}

test("desktop dashboard shows charts, filters, identified users and stable project choices", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const requests = await mockAnalytics(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(address);
  await expect(page.getByRole("heading", { name: "Uso de la app", exact: true })).toBeVisible();
  await expect(page.locator(".analytics-metrics .metric-card")).toHaveCount(6);
  await expect(page.getByRole("img", { name: "Gráfico diario de visitas, vistas y acciones" })).toBeVisible();
  await expect(page.getByRole("row", { name: /María Fernanda Sampletown/ })).toContainText("maria.sampletown@example.test");
  expect(Object.fromEntries(requests[0].searchParams)).toEqual({ from: "2026-09-07", to: "2026-10-06", context: "all", includeOwner: "false" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("analytics-desktop.png"), fullPage: true });
  await page.getByLabel("Contexto", { exact: true }).selectOption("project");
  await page.getByLabel("Proyecto", { exact: true }).selectOption("sampletown");
  await expect.poll(() => requests.at(-1)?.searchParams.get("projectId")).toBe("sampletown");
  await expect(page.getByLabel("Proyecto", { exact: true }).locator("option")).toHaveCount(4);
  await page.getByLabel("Proyecto", { exact: true }).selectOption("sample");
  await expect.poll(() => requests.at(-1)?.searchParams.get("projectId")).toBe("sample");
  await page.getByRole("checkbox", { name: "Incluir mi actividad" }).check();
  await expect.poll(() => requests.at(-1)?.searchParams.get("includeOwner")).toBe("true");
  await page.getByRole("button", { name: "7 días", exact: true }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get("from")).toBe("2026-09-30");
  await page.getByRole("button", { name: "Restablecer filtros", exact: true }).click();
  await expect.poll(() => Object.fromEntries(requests.at(-1)!.searchParams)).toEqual({ from: "2026-09-07", to: "2026-10-06", context: "all", includeOwner: "false" });
  expect(errors).toEqual([]);
});

test.describe("touch analytics readability", () => {
  test.use({ isMobile: true, hasTouch: true });
  for (const viewport of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    test(`long identified names remain inside scrollable cards and dates avoid focus zoom at ${viewport.width}`, async ({ page, browserName }, testInfo) => {
      test.skip(browserName !== "chromium"); await page.setViewportSize(viewport);
      await page.route("**/api/admin/analytics?**", route => {
        const response = responseFor(new URL(route.request().url()));
        response.users[0].name = "NombreCompletoDeSupervision".repeat(5); response.users[0].email = "supervision".repeat(10) + "@example.test";
        return route.fulfill({ json: response });
      });
      await page.goto(address); await expect(page.locator(".analytics-metrics .metric-card")).toHaveCount(6);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
      await expect(page.getByLabel("Desde", { exact: true })).toHaveCSS("font-size", "16px"); await page.getByLabel("Desde", { exact: true }).fill("2026-10-01");
      await page.locator(".analytics-users").scrollIntoViewIfNeeded();
      expect(await page.locator(".analytics-users .analytics-table-scroll").evaluate(element => getComputedStyle(element).overflowX)).toBe("auto");
      await page.screenshot({ path: testInfo.outputPath(`analytics-touch-${viewport.width}.png`) });
    });
  }
});

test("375px dashboard contains table scrolling within cards and usable custom dates", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const requests = await mockAnalytics(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(address);
  await expect(page.locator(".analytics-metrics .metric-card")).toHaveCount(6);
  await expect(page.getByRole("img", { name: "Gráfico diario de visitas, vistas y acciones" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator(".analytics-users .analytics-table-scroll").evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("analytics-mobile-375.png"), fullPage: true });
  await page.getByLabel("Desde", { exact: true }).fill("2026-10-01");
  await expect.poll(() => requests.at(-1)?.searchParams.get("from")).toBe("2026-10-01");
  await page.getByText("Ver datos diarios", { exact: true }).click();
  await expect(page.locator(".analytics-chart-data tbody tr")).toHaveCount(6);
  await page.locator(".analytics-users .analytics-table-scroll").evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await expect(page.locator(".analytics-users thead th").last()).toContainText("aproximado");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("custom ranges reject more than 90 days and future Costa Rica dates before fetching", async ({ page }) => {
  const requests = await mockAnalytics(page);
  await page.goto(address);
  await expect(page.locator(".analytics-metrics .metric-card")).toHaveCount(6);
  const count = requests.length;
  await page.getByLabel("Desde", { exact: true }).fill("2026-01-01");
  await expect(page.getByRole("alert")).toContainText("máximo 90 días");
  expect(requests).toHaveLength(count);
  await expect(page.locator(".analytics-metrics")).toHaveCount(0);
  await page.getByLabel("Hasta", { exact: true }).fill("2026-01-01");
  await expect(page.getByRole("alert")).toContainText("Solo están disponibles los últimos 90 días");
  expect(requests).toHaveLength(count);
  await page.getByRole("button", { name: "90 días", exact: true }).click();
  await expect(page.locator(".analytics-metrics .metric-card")).toHaveCount(6);
  await expect.poll(() => requests.length).toBe(count + 1);
  await page.getByLabel("Hasta", { exact: true }).fill("2026-10-07");
  await expect(page.getByRole("alert")).toContainText("hasta hoy en Costa Rica");
  expect(requests).toHaveLength(count + 1);
});

test("empty period explains measurement start and preserves project choices", async ({ page }) => {
  await mockAnalytics(page, { empty: true });
  await page.goto(address);
  await expect(page.getByRole("heading", { name: "Sin uso en este período" })).toBeVisible();
  await expect(page.locator(".analytics-measurement-note")).toContainText("La medición comienza al registrarse");
  await expect(page.locator(".analytics-metrics strong")).toHaveText(["0", "0", "0", "0", "0", "0 min"]);
  await expect(page.getByRole("img")).toHaveCount(0);
  await page.getByLabel("Contexto", { exact: true }).selectOption("project");
  await expect(page.getByLabel("Proyecto", { exact: true }).locator("option")).toHaveCount(4);
});

test("403 shows administrator access required without charts or user identities", async ({ page }) => {
  await mockAnalytics(page, { forbidden: true });
  await page.goto(`${address}?lang=en`);
  await expect(page.getByRole("alert")).toContainText("Platform administrator access is required");
  await expect(page.locator(".analytics-metrics, .analytics-users, svg")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toHaveCount(0);
});
