/* eslint-disable @typescript-eslint/no-require-imports -- This reusable fixture is a directly executable CommonJS Node entry point. */
const { build } = require("esbuild");
const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const { resolve } = require("node:path");
const JSZip = require("jszip");

const projectId = "visitor-house";
const createdAt = "2026-10-11T12:00:00Z";
const sections = ["overview", "activity", "budget", "quotes", "expenses", "documents", "notes", "aesthetics", "distribution", "approvals", "plan", "decisions", "site"];
const visitorSections = ["overview", "documents", "aesthetics", "distribution"];
const source = { documentId: "plan", page: 1, sheet: "Planta" };
const room = {
  id: "living", name: "Sala de la casa", polygon: [[0, 0], [5, 0], [5, 5], [0, 5]], color: "#b4cfa7", source,
  height: { value: 2.6, status: "documented", note: "", source }, finishes: "Piso claro", notes: "Espacio de referencia sintético.",
  coverage: { outlet: "reviewed", light: "reviewed", switch: "reviewed", ac: "reviewed" },
};
const carport = {
  ...room, id: "carport", name: "Cochera de muestra", polygon: [[5, 0], [8, 0], [8, 5], [5, 5]], color: "#d0c2a1",
  finishes: "Piso exterior de referencia", notes: "Cochera abierta sintética junto a la sala.",
};
const model = {
  schemaVersion: 1, name: "Casa de muestra para visitantes", revision: 1, sourceDocumentIds: ["plan"], rooms: [room, carport],
  walls: [
    { id: "front", start: [0, 0], end: [5, 0], thickness: 0.15, height: 2.6, source },
    { id: "right", start: [5, 0], end: [5, 5], thickness: 0.15, height: 2.6, source },
    { id: "back", start: [5, 5], end: [0, 5], thickness: 0.15, height: 2.6, source },
    { id: "left", start: [0, 5], end: [0, 0], thickness: 0.15, height: 2.6, source },
  ], openings: [{ id: "entry", wallId: "front", roomIds: ["living"], kind: "door", offset: 2, width: 1, height: 2.1, sill: 0, source, status: "approximate" }],
  fixtures: [
    { id: "outlet", roomId: "living", kind: "outlet", type: "Tomacorriente de muestra", position: [1, 0.08], height: 0.35, circuit: "QA-1", specifications: "Instalación sintética", status: "approximate", source },
    { id: "light", roomId: "living", kind: "light", type: "Luz de muestra", position: [2.5, 2.5], height: 2.6, mount: "ceiling", circuit: "QA-2", specifications: "Instalación sintética", status: "approximate", source },
    { id: "carport-light", roomId: "carport", kind: "light", type: "Luz de cochera", position: [6.5, 2.5], height: 2.6, mount: "ceiling", circuit: "QA-2", specifications: "Instalación sintética", status: "approximate", source },
  ],
  envelope: {
    source, status: "approximate", notes: "Volumen y cubierta sintéticos; no representan arquitectura real.",
    levels: [{ label: { en: "Reference ceiling", es: "Cielo de referencia" }, value: 2.6, status: "approximate", note: "Altura del fixture", source }],
    faces: [
      { id: "roof-left", kind: "roof", vertices: [[0, 0, 2.7], [2.5, 0, 3.6], [2.5, 5, 3.6], [0, 5, 2.7]] },
      { id: "roof-right", kind: "roof", vertices: [[2.5, 0, 3.6], [5, 0, 2.7], [5, 5, 2.7], [2.5, 5, 3.6]] },
      { id: "wall-front", kind: "wall", vertices: [[0, 0, 0], [5, 0, 0], [5, 0, 2.7], [2.5, 0, 3.6], [0, 0, 2.7]] },
      { id: "wall-back", kind: "wall", vertices: [[5, 5, 0], [0, 5, 0], [0, 5, 2.7], [2.5, 5, 3.6], [5, 5, 2.7]] },
      { id: "wall-left", kind: "wall", vertices: [[0, 5, 0], [0, 0, 0], [0, 0, 2.7], [0, 5, 2.7]] },
      { id: "wall-right", kind: "wall", vertices: [[5, 0, 0], [5, 5, 0], [5, 5, 2.7], [5, 0, 2.7]] },
      { id: "carport-roof", kind: "roof", vertices: [[5, 0, 2.7], [8, 0, 2.7], [8, 5, 2.7], [5, 5, 2.7]] },
      { id: "carport-column-front", kind: "wall", vertices: [[7.85, 0, 0], [8, 0, 0], [8, 0, 2.7], [7.85, 0, 2.7]] },
      { id: "carport-column-back", kind: "wall", vertices: [[7.85, 5, 0], [8, 5, 0], [8, 5, 2.7], [7.85, 5, 2.7]] },
    ],
    roofUnderside: [
      { id: "ceiling", kind: "roof", vertices: [[0, 0, 2.6], [5, 0, 2.6], [5, 5, 2.6], [0, 5, 2.6]] },
      { id: "carport-ceiling", kind: "roof", vertices: [[5, 0, 2.6], [8, 0, 2.6], [8, 5, 2.6], [5, 5, 2.6]] },
    ],
  },
  notes: "Modelo sintético; no representa una casa real.",
};
const photos = Array.from({ length: 18 }, (_, index) => ({
  id: `photo-${index + 1}`, folderId: "exterior", name: `Vista de la casa ${String(index + 1).padStart(2, "0")}`,
  caption: index === 0 ? "Fachada prevista" : "Luz y materiales de referencia", notes: "Imagen sintética para verificar la lectura.",
  classification: index === 0 ? "planned" : index === 1 ? "inspiration" : "unclassified",
  mediaType: "image", width: 1200, height: 800, contentType: "image/svg+xml", createdAt,
  imageUrl: `/visitor-photo.svg?id=${index + 1}`, thumbnailUrl: `/visitor-photo.svg?id=${index + 1}`,
}));
const documents = Array.from({ length: 16 }, (_, index) => ({
  id: index === 0 ? "plan" : `plan-${index + 1}`, name: index === 0 ? "Plano general.svg" : `Plano de muestra ${index + 1}.svg`, folderId: "plans", contentType: "image/svg+xml", size: 1024, uploadedBy: "QA sintético", createdAt,
  isImage: true, downloadUrl: "/visitor-photo.svg", thumbnailUrl: "/visitor-photo.svg", previewKind: "image", previewUrl: "/visitor-photo.svg",
  quoteReferenceSupported: true, quoteReferenceEnabled: false,
  description: "Plano ilustrativo para pruebas; no contiene información real.",
}));

// The isolated shell defaults to a read-only visitor. The optional editor mode
// persists only synthetic overview selection in this process, never Firebase.
// Used by automated regression and keep-open UI inspection; no AI/credentials.
async function createVisitorFixture({ port = 0, modelReady = true, editOverview = false } = {}) {
  const bundle = await build({
    stdin: {
      contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import HousePlanner from './app/HousePlanner';
        import {readWorkspaceDestination} from './lib/workspace-navigation';
        const denied=new Set((new URLSearchParams(location.search).get('deny')||'').split(','));
        const allowed=${JSON.stringify(visitorSections)};
        const user={name:'${editOverview ? "Editor QA" : "Visitante QA"}',email:'visitor@example.test',projectId:'${projectId}',projectName:'Casa de muestra',role:'${editOverview ? "editor" : "viewer"}',permissions:Object.fromEntries(${JSON.stringify(sections)}.map(key=>[key,allowed.includes(key)&&!denied.has(key)])),folderAccess:{mode:'selected',folderIds:['plans'],allowUnfiled:false},readOnlyLink:${!editOverview},anonymousLink:${!editOverview}};
        localStorage.setItem('house-planner-language','es');
        createRoot(document.getElementById('root')).render(<HousePlanner mode="real" user={user} initialDestination={readWorkspaceDestination(location.href)} onSwitchMode={()=>{}} onSignOut={()=>{}}/>);
      `,
      resolveDir: process.cwd(), loader: "tsx",
    },
    bundle: true, write: false, loader: { ".webp": "dataurl" }, outfile: "visitor.js", platform: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "visitor-fixture-leaves", setup(builder) {
      builder.onResolve({ filter: /^next\/(image|dynamic)$/ }, args => ({ path: args.path, namespace: "visitor-fixture" }));
      builder.onResolve({ filter: /\/(AssistantPanel|GoogleSheetsEditing|ExpensesWorkspace|NotesWorkspace|QuotesWorkspace|MobileCapture|DistributionAdmin|ActivityWorkspace)$/ }, args => ({ path: args.path.split("/").pop(), namespace: "visitor-fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "visitor-fixture" }, args => ({
        contents: "import React from 'react';" + (args.path === "next/image"
          ? "export default function Image({fill,priority,unoptimized,...props}){return <img {...props} style={fill?{position:'absolute',inset:0,width:'100%',height:'100%',...props.style}:props.style}/>;}"
          : args.path === "next/dynamic"
            ? "export default function dynamic(load){const Component=React.lazy(load);return function Lazy(props){return <React.Suspense fallback={<p>Cargando…</p>}><Component {...props}/></React.Suspense>}}"
            : args.path === "ExpensesWorkspace"
              ? "export default function Leaf(){return null;} export function ExpenseDialog({children}){return <>{children}</>;} export function MediaPreview(){return null;}"
            : args.path === "ActivityWorkspace"
              ? "export default function Activity(){return null;} export function ActivitySummaryCard(){return null;}"
              : "export default function Leaf(){return null;}"),
        loader: "tsx", resolveDir: process.cwd(),
      }));
    } }],
  });
  const css = await readFile("app/globals.css", "utf8") + (bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text || "");
  const fixtures = {
    "/api/projects": { projects: [{ id: projectId, name: "Casa de muestra", kind: "shared", role: "viewer", active: true }], canCreateProjects: false },
    "/api/property-profile": { profile: { revisionLabelEn: "Synthetic reference", revisionLabelEs: "Referencia sintética", measurements: [
      { id: "area", labelEn: "House area", labelEs: "Área de la casa", value: "199 m²", emphasis: true },
      { id: "front", labelEn: "Frontage", labelEs: "Frente", value: "13.30 m", emphasis: false },
    ] } },
    "/api/overview": { imageIds: ["photo-1", "photo-2"], noteIds: [] },
    "/api/aesthetics": { folders: [{ id: "exterior", name: "Exterior", kind: "images", parentId: null, sortOrder: 0, carouselImageIds: ["photo-1", "photo-2"], createdAt }], images: photos },
    "/api/files": { documents }, "/api/folders": { folders: [{ id: "plans", name: "Planos compartidos", parentId: null, createdAt }] },
    "/api/house-distribution": { ready: modelReady, record: modelReady ? { model, roomCorrections: {}, fixtureCorrections: {}, revision: 1, updatedAt: createdAt } : null },
    "/api/events/documents": { version: 1 }, "/api/countdowns": { countdowns: [] },
    "/api/approvals": { approvals: [] }, "/api/notes": { notes: [] },
  };
  const mutations = [];
  const zip = new JSZip();
  zip.file("Exterior/imagen-de-muestra.txt", "Archivo sintético para verificar la descarga. No contiene imágenes de un proyecto real.");
  const archive = await zip.generateAsync({ type: "nodebuffer" });
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://fixture.local");
    if (url.pathname === "/visitor.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles.find(file => file.path.endsWith(".js")).text); return; }
    if (url.pathname.startsWith("/api/")) {
      if (request.method === "GET" && url.pathname === "/api/aesthetics/archive") {
        response.setHeader("content-type", "application/zip");
        response.setHeader("content-disposition", "attachment; filename=\"Exterior-imagenes.zip\"");
        response.end(archive); return;
      }
      response.setHeader("content-type", "application/json");
      if (request.method !== "GET") {
        if (url.pathname === "/api/usage/events") { response.end('{"accepted":0}'); return; }
        if (editOverview && request.method === "PATCH" && url.pathname === "/api/overview") {
          let body = "";
          request.on("data", chunk => { body += chunk; });
          request.on("end", () => {
            try {
              const patch = JSON.parse(body);
              if (!Array.isArray(patch.imageIds) || patch.imageIds.some(id => !photos.some(photo => photo.id === id))) throw new Error("Invalid synthetic selection");
              fixtures["/api/overview"] = { ...fixtures["/api/overview"], imageIds: patch.imageIds };
              response.end(JSON.stringify(fixtures["/api/overview"]));
            } catch { response.writeHead(400); response.end('{"error":"Invalid synthetic selection"}'); }
          });
          return;
        }
        mutations.push({ method: request.method, path: url.pathname });
        response.writeHead(403); response.end('{"error":"Synthetic visitor fixture is read-only"}'); return;
      }
      response.end(JSON.stringify(fixtures[url.pathname] || {})); return;
    }
    if (url.pathname === "/visitor-photo.svg") {
      response.setHeader("content-type", "image/svg+xml");
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="#e9e1d2"/><path d="M220 600V310L600 90L980 310V600Z" fill="#abc5b4"/><rect x="520" y="400" width="160" height="200" fill="#b78461"/></svg>'); return;
    }
    response.setHeader("content-type", "text/html");
    response.end(`<html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html{--font-geist-sans:Arial;--font-geist-mono:monospace}${css}</style><div id="root"></div><script src="/visitor.js"></script></html>`);
  });
  await new Promise(done => server.listen(port, "127.0.0.1", done));
  return { server, address: `http://127.0.0.1:${server.address().port}`, projectId, mutations };
}

module.exports = { createVisitorFixture };
if (require.main === module) {
  const port = Number(process.argv.find(argument => argument.startsWith("--port="))?.split("=")[1] || 3111);
  createVisitorFixture({ port, modelReady: !process.argv.includes("--no-model"), editOverview: process.argv.includes("--edit-overview") }).then(({ server, address }) => {
    console.log(`Synthetic fixture ready: ${address}/projects/${projectId}/overview (overview editing: ${process.argv.includes("--edit-overview")})`);
    console.log(`Restricted reader: ${address}/projects/${projectId}/overview?deny=documents,aesthetics,distribution`);
    console.log(`Source: ${resolve(process.cwd())}. Stop with Ctrl+C.`);
    const stop = () => { server.closeAllConnections(); server.close(() => process.exit(0)); };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
