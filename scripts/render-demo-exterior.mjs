/** Export the public hero from the actual DistributionViewer, never from a second house model.
 * Start the local app, then: node scripts/render-demo-exterior.mjs http://127.0.0.1:3100
 */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import ts from "typescript";
import sharp from "sharp";
import { renderDemoPlanSvg } from "./demo-plan-svg.mjs";

const baseUrl = process.argv[2] || "http://127.0.0.1:3000";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(baseUrl).hostname)) throw new Error("Use a local demo server.");
const modules = new Map();
function moduleDataUrl(url) {
  if (!modules.has(url.href)) modules.set(url.href, (async () => {
    let { outputText } = ts.transpileModule(await readFile(url, "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
    const imports = [...new Set([...outputText.matchAll(/\bfrom\s+["'](\.[^"']+)["']/g)].map(match => match[1]))];
    for (const specifier of imports) {
      const dependency = await moduleDataUrl(new URL(specifier.endsWith(".ts") ? specifier : `${specifier}.ts`, url));
      outputText = outputText.replaceAll(`"${specifier}"`, JSON.stringify(dependency)).replaceAll(`'${specifier}'`, JSON.stringify(dependency));
    }
    return `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
  })());
  return modules.get(url.href);
}
async function loadTs(path) { return import(await moduleDataUrl(new URL(path, import.meta.url))); }
const { createDemoDistributionRecord } = await loadTs("../lib/demo-distribution.ts");
const { demoExteriorGeometry, demoExteriorFurniture } = await loadTs("../lib/demo-exterior.ts");
const model = createDemoDistributionRecord().model;
const hash = value => createHash("sha256").update(value).digest("hex");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 2000, height: 1550 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => {
    if (new URL(route.request().url()).pathname.startsWith("/api/usage")) return route.fulfill({ json: { ok: true } });
    errors.push(`Unexpected private request: ${route.request().url()}`);
    return route.abort();
  });
  await page.addInitScript(() => localStorage.setItem("house-planner-language", "en"));
  await page.goto(`${baseUrl}/?mode=demo`);
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("button", { name: /House Distribution 3D/ }).click();
  await page.getByRole("tab", { name: "Furniture", exact: true }).click();
  await expect(page.locator('[data-render-mode="3d"]')).toBeVisible();
  await page.getByRole("button", { name: "Show complete house", exact: true }).click();
  await page.getByRole("button", { name: "Presentation", exact: true }).click();
  await expect(page.locator('[data-presentation="true"]')).toBeVisible();
  await expect.poll(async () => Number(await page.locator(".distribution-scene-wrap").getAttribute("data-furniture-count"))).toBeGreaterThan(0);
  await page.addStyleTag({ content: "body *{visibility:hidden!important}.distribution-scene canvas{visibility:visible!important}.distribution-scene{width:1800px!important;height:1200px!important}.distribution-scene-wrap{width:1800px!important;border:0!important;border-radius:0!important}.distribution-layout{display:block!important}" });
  const canvas = page.locator(".distribution-scene canvas");
  await expect(canvas).toHaveJSProperty("width", 1800);
  await expect(canvas).toHaveJSProperty("height", 1200);
  // Wait for the resize observer and synchronous WebGL render to settle.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const image = await sharp(await canvas.screenshot()).resize(1800, 1200, { fit: "fill" }).webp({ quality: 94 }).toBuffer();
  if (errors.length) throw new Error(errors.join("\n"));
  await writeFile(new URL("../public/demo/casa-mirador-exterior.webp", import.meta.url), image);
  const plan = renderDemoPlanSvg(model);
  await writeFile(new URL("../public/demo/casa-mirador-plan.svg", import.meta.url), plan);
  await writeFile(new URL("../lib/demo-exterior-render.json", import.meta.url), `${JSON.stringify({
    source: "DistributionViewer / Furniture / Presentation",
    geometrySha256: hash(JSON.stringify(demoExteriorGeometry(model))),
    furnitureSha256: hash(JSON.stringify(demoExteriorFurniture(model))),
    imageSha256: hash(image), planSha256: hash(plan), width: 1800, height: 1200,
  }, null, 2)}\n`);
  console.log(`Exported Casa Mirador from its 3D geometry (${image.length} bytes).`);
} finally {
  await browser.close();
}
