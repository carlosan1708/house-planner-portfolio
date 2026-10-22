import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";

let server: Server, address: string;
test.beforeAll(async () => {
  const bundle = await build({ stdin: { contents: `
    import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
    import CountdownList from './app/components/CountdownList'; import {countdownNeedsAttention} from './lib/countdowns';
    const now=Date.parse('2026-10-14T12:00:00Z'),params=new URLSearchParams(location.search),role=params.get('role')||'editor',language=params.get('language')||'es';
    const seed=[{id:'future',title:'Confirmar materiales para el baño principal y las áreas de servicio',startedAt:'2026-10-10T12:00:00Z',dueAt:'2026-10-20T12:00:00Z',durationDays:10},{id:'overdue',title:'Revisar entrega',startedAt:'2026-10-01T12:00:00Z',dueAt:'2026-10-10T12:00:00Z',durationDays:9}].map(item=>({...item,recipientUids:['tester'],notifyCurrentUser:true,acknowledged:false,createdBy:'tester@example.test'}));
    function App(){
      const [items,setItems]=useState(()=>JSON.parse(sessionStorage.getItem('tasks')||'null')||seed),[busy,setBusy]=useState(params.has('busy')),[error,setError]=useState('');
      const save=items=>{sessionStorage.setItem('tasks',JSON.stringify(items));setItems(items)};
      const complete=async id=>{setBusy(true);try{const response=await fetch('/api/countdowns',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,action:'complete'})});if(!response.ok){setError('No se pudo completar la tarea');return false} save(items.map(item=>item.id===id?{...item,completed:true,completedAt:new Date(now).toISOString()}:item));return true}finally{setBusy(false)}};
      return <section className="countdown-panel"><h3>Cuentas regresivas</h3><p data-testid="alerts">Avisos: {items.filter(item=>countdownNeedsAttention(item,now)).length}</p><p role="status">{error}</p><CountdownList countdowns={items} recipients={[{uid:'tester',name:'Usuario de pruebas',email:'tester@example.test'}]} language={language} now={now} busy={busy} canEdit={role==='admin'||role==='editor'} canAcknowledge={role!=='link'} onComplete={complete} onAcknowledge={async id=>{save(items.map(item=>item.id===id?{...item,acknowledged:true}:item));return true}} onUpdateRecipients={async()=>true} onDelete={async id=>{await fetch('/api/countdowns?id='+id,{method:'DELETE'});return true}}/></section>
    }createRoot(document.getElementById('root')).render(<App/>);
  `, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", define: { "process.env.NODE_ENV": '"production"' } });
  const script = bundle.outputFiles[0].text, css = await readFile("app/globals.css", "utf8");
  server = createServer((request, response) => {
    if (request.url === "/fixture.js") { response.setHeader("content-type", "text/javascript"); response.end(script); }
    else { response.setHeader("content-type", "text/html"); response.end(`<html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{padding:16px}#root{max-width:1100px;margin:auto}</style><div id="root"></div><script src="/fixture.js"></script></html>`); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); address = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); });
async function api(page: Page, failure = false) {
  const requests: {method:string;body:unknown}[] = [];
  await page.route("**/api/countdowns**", route => {
    const request = route.request(); requests.push({ method: request.method(), body: request.postDataJSON() });
    return route.fulfill({ status: failure ? 500 : 200, json: failure ? {error:"failed"} : {ok:true} });
  }); return requests;
}
for (const role of ["admin", "editor"]) test(`${role} completes future and overdue tasks, preserves history after reload and stops alerts`, async ({page}) => {
  const writes = await api(page); await page.goto(`${address}/?role=${role}`);
  await expect(page.getByTestId("alerts")).toHaveText("Avisos: 1");
  await page.getByRole("button", {name:"Completar Revisar entrega",exact:true}).click();
  await expect(page.locator(".countdown-history")).toHaveAttribute("open", "");
  await expect(page.locator(".countdown-history")).toContainText("Revisar entrega");
  await expect(page.getByTestId("alerts")).toHaveText("Avisos: 0");
  await page.locator(".countdown-active").getByRole("button", {name:/^Completar/}).click();
  await expect(page.getByText("No hay cuentas regresivas pendientes.")).toBeVisible();
  await expect(page.locator(".countdown-history summary")).toHaveText("Completadas (2)");
  await expect(page.locator(".countdown-history article")).toHaveCount(2);
  await expect(page.locator(".countdown-history")).toContainText("Completada el");
  await expect(page.locator(".countdown-history")).toContainText("Plazo original");
  expect(writes).toEqual([{method:"PATCH",body:{id:"overdue",action:"complete"}},{method:"PATCH",body:{id:"future",action:"complete"}}]);
  await page.reload();
  const summary = page.locator(".countdown-history summary"); await summary.focus(); await page.keyboard.press("Enter");
  await expect(page.locator(".countdown-history article").first()).toBeVisible();
  await expect(page.locator(".countdown-history article")).toHaveCount(2); await expect(page.getByTestId("alerts")).toHaveText("Avisos: 0");
});
test("failed completion keeps the task active and does not show completed history", async ({page}) => {
  await api(page, true); await page.goto(address); await page.getByRole("button", {name:"Completar Revisar entrega",exact:true}).click();
  await expect(page.getByRole("status")).toHaveText("No se pudo completar la tarea");
  await expect(page.locator(".countdown-active article")).toHaveCount(2); await expect(page.locator(".countdown-history")).toHaveCount(0);
});
test("viewers and read links see completion history without mutation controls", async ({page}) => {
  for(const role of ["viewer","link"]){
    await page.goto(`${address}/?role=${role}`);
    await page.evaluate(()=>sessionStorage.setItem('tasks',JSON.stringify([{id:'done',title:'Terminada',startedAt:'2026-10-01',dueAt:'2026-10-10',completed:true,completedAt:'2026-10-14',recipientUids:[]}]))); await page.reload();
    await page.locator(".countdown-history summary").click(); await expect(page.getByRole("article",{name:"Terminada"})).toBeVisible();
    await expect(page.getByRole("button",{name:/Completar|Eliminar|Editar destinatarios/})).toHaveCount(0);
  }
});
test("busy controls are disabled and English labels distinguish completion from seen", async ({page}) => {
  await page.goto(`${address}/?busy=1&language=en`);
  await expect(page.getByRole("button",{name:"Complete Revisar entrega",exact:true})).toBeDisabled();
  await expect(page.getByRole("button",{name:"Notice seen",exact:true})).toBeDisabled();
});
for (const viewport of [{width:320,height:700},{width:390,height:844},{width:844,height:390}]) test(`completion controls and history fit ${viewport.width}x${viewport.height}`,async({browser},testInfo)=>{
  const context=await browser.newContext({viewport,isMobile:true,hasTouch:true});const page=await context.newPage();
  try{
    await api(page);await page.goto(address);
    const button=page.getByRole("button",{name:"Completar Revisar entrega",exact:true}); const bounds=await button.boundingBox(); expect(bounds!.height).toBeGreaterThanOrEqual(44);
    await button.click();await expect(page.locator(".countdown-history article")).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath('countdown-completed.png'),fullPage:true});
  }finally{await context.close()}
});
