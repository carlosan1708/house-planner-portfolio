import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";

// Real project controls and styles; persistence callbacks use isolated synthetic state.
// API authorization, currency locking and races are covered by project-currency.test.ts.
let server: Server, address: string;
test.beforeAll(async () => {
  const bundle = await build({
    stdin: { contents: `
      import React,{useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {ProjectHub} from './app/HousePlanner';
      import ProjectCurrencyDialog from './app/components/ProjectCurrencyDialog';
      function Fixture(){
        const [language,setLanguage]=useState(new URLSearchParams(location.search).get('lang')==='es'?'es':'en');
        const [projects,setProjects]=useState([
          {id:'editable',name:'Garden house',kind:'shared',role:'admin',active:false,currency:'CRC',currencyRevision:0,currencyLocked:false},
          {id:'locked',name:'Established house',kind:'shared',role:'admin',active:false,currency:'USD',currencyRevision:3,currencyLocked:true},
          {id:'viewer',name:'Viewer house',kind:'shared',role:'viewer',active:false,currency:'CRC',currencyRevision:0,currencyLocked:false}
        ]);
        const [editing,setEditing]=useState(null),[result,setResult]=useState(null);
        return <><nav aria-label="Fixture language" style={{position:'fixed',top:8,right:8,zIndex:1000}}>
          <button onClick={()=>setLanguage('en')}>EN</button><button onClick={()=>setLanguage('es')}>ES</button>
        </nav><main style={{padding:'56px 16px 16px'}}><ProjectHub language={language} projects={projects} busy={false}
          onOpen={async()=>{}} onToggleFavorite={async()=>{}} onSetOpenFavorite={async()=>{}} onEdit={setEditing}
          onCreate={async(name,currency)=>{setResult({action:'create',name,currency});setProjects(items=>[...items,{id:'created',name,kind:'shared',role:'admin',active:false,currency,currencyRevision:0,currencyLocked:false}]);return true;}}/>
          <output aria-label="Synthetic callback result">{JSON.stringify(result)}</output>
        </main>{editing&&<ProjectCurrencyDialog key={editing.id} project={editing} language={language} busy={false} onClose={()=>setEditing(null)}
          onSave={async(project,currency,confirmDenominationCorrection)=>{setResult({action:'currency',projectId:project.id,currency,expectedCurrencyRevision:project.currencyRevision,confirmDenominationCorrection});setProjects(items=>items.map(item=>item.id===project.id?{...item,currency,currencyRevision:item.currencyRevision+1}:item));return true;}}/>}</>;
      }
      createRoot(document.getElementById('root')).render(<Fixture/>);
    `, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, loader: { ".webp": "dataurl" }, outfile: "project-currency.js", platform: "browser", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "project-currency-browser-adapters", setup(builder) {
      builder.onResolve({ filter: /^(next\/(image|dynamic)|firebase\/auth|@\/lib\/firebase-client|@\/lib\/usage-client)$/ }, args => ({ path: args.path, namespace: "currency-adapters" }));
      builder.onLoad({ filter: /.*/, namespace: "currency-adapters" }, args => {
        const content = args.path === "next/image" ? "export default function Image({fill,priority,unoptimized,...props}){return <img {...props}/>;}"
          : args.path === "next/dynamic" ? "export default ()=>function OptionalDynamic(){return null;}"
          : args.path === "firebase/auth" ? "export const createUserWithEmailAndPassword=async()=>{},signInWithEmailAndPassword=async()=>{},signInWithPopup=async()=>{},signOut=async()=>{},updateProfile=async()=>{},sendEmailVerification=async()=>{};export class GoogleAuthProvider{}"
          : args.path === "@/lib/firebase-client" ? "export const firebaseAuth={};"
          : "export const useUsageTracking=()=>{},flushUsageBeforeTransition=async()=>{},trackDemoAction=()=>{},trackUsageInteraction=()=>{};";
        return { contents: `import React from 'react';${content}`, loader: "tsx", resolveDir: process.cwd() };
      });
    } }],
  });
  const script = bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  const css = await readFile("app/globals.css", "utf8") + (bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text || "");
  server = createServer((request, response) => {
    const path = new URL(request.url || "/", "http://currency.local").pathname;
    if (path === "/project-currency.js") { response.setHeader("content-type", "text/javascript"); response.end(script); return; }
    if (path.startsWith("/api/")) { response.writeHead(403); response.end("No API in this synthetic callback fixture"); return; }
    response.setHeader("content-type", "text/html");
    response.end(`<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><style>html{--font-geist-sans:Arial;--font-geist-mono:monospace}${css}</style><div id="root"></div><script src="/project-currency.js"></script></html>`);
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>(done => server.close(() => done())); });

test("creation passes the selected currency independently of English and Spanish", async ({ page }) => {
  await page.goto(address);
  await page.getByRole("button", { name: "New project", exact: false }).click();
  await page.getByLabel("Project name", { exact: true }).fill("Harbor house");
  await expect(page.getByRole("combobox", { name: "Project currency", exact: true })).toHaveValue("USD");
  await page.getByRole("combobox", { name: "Project currency", exact: true }).selectOption("CRC");
  await page.getByRole("button", { name: "ES", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Moneda del proyecto", exact: true })).toHaveValue("CRC");
  await expect(page.getByLabel("Nombre del proyecto", { exact: true })).toHaveValue("Harbor house");
  await page.getByRole("combobox", { name: "Moneda del proyecto", exact: true }).selectOption("USD");
  await page.getByRole("button", { name: "Crear y abrir", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("Synthetic callback result")).toHaveText(JSON.stringify({ action: "create", name: "Harbor house", currency: "USD" }));
  await expect(page.locator(".project-hub-card").filter({ hasText: "Harbor house" })).toContainText("USD");
});

test("settings preserve currency across language changes and pass the current revision", async ({ page }) => {
  await page.goto(address);
  await page.getByRole("button", { name: "Edit project Garden house", exact: true }).click();
  await page.getByRole("combobox", { name: "Project currency", exact: true }).selectOption("USD");
  await page.getByRole("button", { name: "ES", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Configuración del proyecto", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Moneda del proyecto", exact: true })).toHaveValue("USD");
  await page.getByRole("button", { name: "Guardar moneda", exact: true }).click();
  await expect(page.getByLabel("Synthetic callback result")).toHaveText(JSON.stringify({ action: "currency", projectId: "editable", currency: "USD", expectedCurrencyRevision: 0, confirmDenominationCorrection: false }));
  await page.getByRole("button", { name: "Editar proyecto Garden house", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Moneda del proyecto", exact: true })).toHaveValue("USD");
  await expect(page.getByRole("button", { name: "Guardar moneda", exact: true })).toBeDisabled();
});

test("mobile populated-project correction requires explicit confirmation and viewers cannot edit", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${address}/?lang=es`);
  await expect(page.getByRole("button", { name: "Editar proyecto Viewer house", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Editar proyecto Established house", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Configuración del proyecto", exact: true });
  await expect(dialog.getByRole("combobox", { name: "Moneda del proyecto", exact: true })).toHaveValue("USD");
  await expect(dialog.getByRole("combobox", { name: "Moneda del proyecto", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "Guardar moneda", exact: true })).toBeDisabled();
  await dialog.getByRole("combobox", { name: "Moneda del proyecto", exact: true }).selectOption("CRC");
  const confirmation = dialog.getByRole("checkbox", { name: "Confirmo corregir la denominación de USD a CRC, manteniendo todos los importes sin conversión.", exact: true });
  await expect(confirmation).not.toBeChecked();
  await expect(dialog.getByRole("button", { name: "Guardar moneda", exact: true })).toBeDisabled();
  await expect(dialog).toContainText("Las compras y los comprobantes conservan sus monedas");
  await expect(page.getByLabel("Synthetic callback result")).toHaveText("null");
  await confirmation.check();
  await dialog.getByRole("combobox", { name: "Moneda del proyecto", exact: true }).selectOption("USD");
  await dialog.getByRole("combobox", { name: "Moneda del proyecto", exact: true }).selectOption("CRC");
  await expect(confirmation).not.toBeChecked();
  await confirmation.check();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole("button", { name: "Guardar moneda", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("Synthetic callback result")).toHaveText(JSON.stringify({ action: "currency", projectId: "locked", currency: "CRC", expectedCurrencyRevision: 3, confirmDenominationCorrection: true }));
  await expect(page.locator(".project-hub-card").filter({ hasText: "Established house" })).toContainText("CRC");
});
