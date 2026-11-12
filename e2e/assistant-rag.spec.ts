import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";

let server: Server;
let url: string;
let progressStream: ServerResponse | undefined;

const sse = (name: string, data: object) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;


test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `
        import {useState} from "react";
        import {createRoot} from "react-dom/client";
        import AssistantPanel from "./app/components/AssistantPanel";
        import AssistantIndexStatus from "./app/components/AssistantIndexStatus";
        function Workspace() {
          const [projectId, setProjectId] = useState("alpha");
          const language = new URLSearchParams(location.search).get("lang") === "en" ? "en" : "es";
          return <>
            <button onClick={() => setProjectId("beta")}>Switch project</button>
            <AssistantIndexStatus key={projectId} id="invoice" projectId={projectId} language="es" />
            <AssistantPanel projectId={projectId} language={language} role="admin" canBudget canDocuments canNotes canExpenses onOpenBudget={() => {}} />
          </>;
        }
        createRoot(document.getElementById("root")).render(<Workspace />);
      `,
      resolveDir: process.cwd(), loader: "tsx",
    },
    bundle: true, write: false, platform: "browser", jsx: "automatic",
  });
  server = createServer((request, response) => {
    if (request.url === "/assistant.css") {
      response.setHeader("Content-Type", "text/css");
      response.end(readFileSync("app/globals.css", "utf8"));
    } else if (request.url === "/assistant.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(result.outputFiles[0].text);
    } else if (request.method === "POST" && request.url === "/api/assistant/chat") {
      request.resume();
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      progressStream = response;
      response.write(sse("status", { state: "documents" }));
    } else {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      const style = request.url?.includes("visual=1") ? '<link rel="stylesheet" href="/assistant.css">' : "";
      response.end('<html lang="es">' + style + '<div id="root"></div><script src="/assistant.js"></script></html>');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

test.afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("shows live assistant steps before the answer arrives", async ({ page }) => {
  await page.route("**/api/assistant/documents**", (route) => route.fulfill({ json: { status: "ready" } }));
  await page.route("**/api/assistant/conversations**", (route) => route.fulfill({ json: { conversations: [] } }));
  await page.goto(url);
  await page.getByRole("button", { name: "Abrir asistente del proyecto" }).click();
  await page.getByRole("textbox").fill("¿Hay un comprobante por ₡40.000?");
  try {
    await page.getByRole("button", { name: "Enviar mensaje" }).click();
    const documents = page.getByText("Buscando en documentos y comprobantes…");
    await expect(documents).toBeVisible();
    progressStream!.write(sse("status", { state: "budget" }));
    const budget = page.getByText("Consultando el presupuesto…");
    await expect(budget).toBeVisible();
    await expect(documents).toHaveCount(0);
    progressStream!.end(sse("text_delta", { delta: "Encontré el comprobante." }) + sse("done", { messageId: "answer" }));
    await expect(page.getByText("Encontré el comprobante.")).toBeVisible();
    await expect(budget).toHaveCount(0);
    await expect(page.getByRole("textbox")).toBeEnabled();
  } finally {
    progressStream?.end();
    progressStream = undefined;
  }
});

test("resumes the selected plan, retries explicitly and saves the private visualization", async ({ page }) => {
  const thread = "image-thread";
  const href = "/api/assistant/images?projectId=alpha&conversationId=image-thread&id=render";
  const goal = { id: "request", role: "user", text: "Generá una fachada a partir del plano.", createdAt: "2026-01-01" };
  const render = { id: "render", role: "assistant", text: "Visualización conceptual", createdAt: "2026-01-01",
    image: { name: "Plan.pdf", pages: [1, 3, 4, 5, 7], references: [1, 3, 4, 5, 7], model: "gemini-3-pro-image", href, canSave: true } };
  let run: { id: string; revision: number; active: boolean; completed: []; imageWorkflow?: boolean; pending: object } | null = {
    id: "run", revision: 1, active: true, completed: [], imageWorkflow: true,
    pending: { kind: "input", question: "¿Qué plano querés usar?", options: [{ id: "document:plan", label: "Plan.pdf · Documents", suggested: true }] },
  };
  let requests = 0;
  const conversation = () => ({ id: thread, messages: run ? [goal] : [goal, render], run });
  await page.route("**/api/assistant/documents**", route => route.fulfill({ json: { status: "ready" } }));
  await page.route("**/api/assistant/conversations**", route => {
    const id = new URL(route.request().url()).searchParams.get("id");
    return route.fulfill({ json: id ? { conversation: conversation() } : { conversations: [{ id: thread, title: "Fachada", lastMessage: "", updatedAt: "2026-01-01" }] } });
  });
  let completeSelection!: () => void;
  const inFlight = new Promise<void>(resolve => { completeSelection = resolve; });
  await page.route("**/api/assistant/runs", async route => {
    requests++;
    if (requests === 1) {
      expect(route.request().postDataJSON()).toMatchObject({ action: "answer", answer: "document:plan", revision: 1 });
      await inFlight;
      run = { id: "run", revision: 2, active: true, completed: [], imageWorkflow: true, pending: { kind: "retry", question: "No se pudo generar la visualización." } };
    } else {
      expect(route.request().postDataJSON()).toMatchObject({ action: "retry", revision: 2 });
      run = null;
    }
    return route.fulfill({ json: { conversation: conversation() } });
  });
  await page.route("**/api/assistant/images**", route => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toMatchObject({ projectId: "alpha", id: "render", conversationId: thread, folderId: "concepts" });
      return route.fulfill({ json: { id: "assistant-render" } });
    }
    return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGZ0AAAAASUVORK5CYII=", "base64") });
  });
  await page.route("**/api/aesthetics", route => route.fulfill({ json: { folders: [{ id: "concepts", name: "Ideas", kind: "images", parentId: null }] } }));
  async function openConversation() {
    await page.getByRole("button", { name: "Abrir asistente del proyecto" }).click();
    await page.getByRole("button", { name: "Historial", exact: true }).click();
    await page.getByRole("button", { name: "Fachada", exact: true }).click();
  }
  await page.goto(url);
  await openConversation();
  expect(requests).toBe(0);
  await page.reload();
  await openConversation();
  await page.getByRole("button", { name: "Plan.pdf · Documents · Último usado" }).click();
  try {
    await expect(page.getByText("Abriendo el plano elegido…")).toBeVisible();
  } finally {
    completeSelection();
  }
  await expect(page.getByText("No se pudo generar la visualización.")).toBeVisible();
  await page.getByRole("button", { name: "Reintentar acción" }).click();
  await expect(page.getByRole("img", { name: /Visualización conceptual/ })).toBeVisible();
  await expect(page.getByText(/1, 3, 4, 5, 7/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Descargar" })).toHaveAttribute("href", href + "&download=1");
  await page.getByRole("button", { name: "Guardar en Estética" }).click();
  await page.getByRole("combobox", { name: "Carpeta de imágenes" }).selectOption("concepts");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Guardada en Estética" })).toBeVisible();
  expect(requests).toBe(2);
});

test("shows the attachment status and retries only after an explicit action", async ({ page }) => {
  let queued = false;
  await page.route("**/api/assistant/documents**", async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toMatchObject({ id: "invoice", projectId: "alpha", action: "index" });
      queued = true;
      return route.fulfill({ status: 202, json: { status: "pending", canRetry: true } });
    }
    expect(new URL(route.request().url()).searchParams.get("projectId")).toBe("alpha");
    return route.fulfill({ json: { status: queued ? "ready" : "failed", canRetry: true } });
  });
  await page.goto(url);
  await expect(page.getByText("Falló la indexación para el asistente")).toBeVisible();
  expect(queued).toBe(false);
  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.getByText("Listo para el asistente")).toBeVisible();
});

test("discards a pending response on project change and opens only the new project's citation", async ({ page }) => {
  let releaseFirst!: () => void;
  const pending = new Promise<void>((resolve) => { releaseFirst = resolve; });
  await page.route("**/api/assistant/documents**", (route) => route.fulfill({ json: { status: "ready" } }));
  await page.route("**/api/assistant/conversations**", (route) => route.fulfill({ json: { conversations: [] } }));
  await page.route("**/api/assistant/chat", async (route) => {
    const { projectId, conversationId } = route.request().postDataJSON();
    expect(conversationId).toBeNull();
    if (projectId === "alpha") await pending;
    const text = projectId === "alpha" ? "Private Alpha amount" : "Private Beta amount";
    const citation = { id: "invoice", kind: "document", label: "Factura · p. 2", href: `/api/files?id=invoice&preview=pdf&project=${projectId}#page=2` };
    await route.fulfill({
      contentType: "text/event-stream",
      body: `event: text_delta\ndata: ${JSON.stringify({ delta: text })}\n\nevent: citation\ndata: ${JSON.stringify(citation)}\n\n`,
    }).catch((error) => { if (projectId !== "alpha") throw error; });
  });
  const open = page.getByRole("button", { name: "Abrir asistente del proyecto" });
  const ask = async () => {
    await page.getByRole("textbox").fill("¿Cuánto dice la factura?");
    const sent = page.waitForRequest("**/api/assistant/chat");
    await page.getByRole("button", { name: "Enviar mensaje" }).click();
    return (await sent).postDataJSON();
  };
  await page.goto(url);
  await open.click();
  expect(await ask()).toMatchObject({ projectId: "alpha" });
  await page.getByRole("button", { name: "Switch project" }).click();
  await open.click();
  releaseFirst();
  expect(await ask()).toMatchObject({ projectId: "beta" });
  await expect(page.getByText("Private Beta amount")).toBeVisible();
  await expect(page.getByText("Private Alpha amount")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Factura · p. 2/ })).toHaveAttribute("href", /project=beta#page=2$/);
});

test("restores a pending app action and submits a versioned choice after reload", async ({ page }) => {
  let saved = {
    id: "pending-thread", title: "Vincular comprobante",
    messages: [{ id: "question", role: "assistant", text: "Encontré dos pagos.", createdAt: "" }],
    run: { id: "pending-run", revision: 4, active: true, completed: [] as object[], pending: {
      kind: "input", question: "¿Cuál pago querés usar?",
      options: [{ id: "first-payment", label: "Primer pago" }, { id: "second-payment", label: "Segundo pago" }],
    } as object | null },
  };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/assistant/documents**", (route) => route.fulfill({ json: { status: "ready" } }));
  await page.route("**/api/assistant/conversations**", (route) => route.fulfill({ json: new URL(route.request().url()).searchParams.has("id")
    ? { conversation: saved } : { conversations: [{ id: saved.id, title: saved.title, lastMessage: "Encontré dos pagos.", updatedAt: "" }] } }));
  await page.route("**/api/assistant/runs", async (route) => {
    const input = route.request().postDataJSON();
    expect(input).toMatchObject({ id: "pending-run", revision: 4, action: "answer", answer: "second-payment" });
    saved = { ...saved, run: { ...saved.run, revision: 5, active: false, pending: null, completed: [{ tool: "attachReceipt", id: "second-payment", href: "/projects/alpha/expenses?expenseTab=payments&expenseRecord=second-payment" }] } };
    await route.fulfill({ json: { conversation: saved } });
  });
  const reopen = async () => {
    await page.getByRole("button", { name: "Abrir asistente del proyecto" }).click();
    await page.getByRole("button", { name: "Historial", exact: true }).click();
    await page.getByRole("button", { name: /^Vincular comprobante/ }).click();
  };
  await page.goto(url);
  await reopen();
  await expect(page.getByText("¿Cuál pago querés usar?")).toBeVisible();
  await page.reload();
  await reopen();
  await page.getByRole("button", { name: "Segundo pago" }).click();
  await expect(page.getByRole("link", { name: "Vínculo del comprobante" })).toHaveAttribute("href", /expenseRecord=second-payment&lang=es$/);
});

test("explains a saved reminder's email failure and keeps English on saved action links", async ({ page }) => {
  const conversation = {
    id: "history", title: "Payment and reminder", lastMessage: "",
    messages: [{ id: "old-failure", role: "assistant", text: "email_unavailable", createdAt: "" }],
    run: {
      id: "retry-run", revision: 3, active: true,
      pending: { kind: "retry", question: "email_unavailable" },
      completed: [{ tool: "recordPayment", id: "first-payment", href: "/projects/alpha/expenses?expenseTab=payments&expenseRecord=first-payment" }],
    },
  };
  await page.route("**/api/assistant/conversations**", (route) => route.fulfill({
    json: new URL(route.request().url()).searchParams.has("id") ? { conversation } : { conversations: [conversation] },
  }));
  await page.goto(`${url}/?lang=en`);
  await page.getByRole("button", { name: "Open project assistant" }).click();
  await page.getByRole("button", { name: "Conversation history", exact: true }).click();
  await page.getByRole("button", { name: "Payment and reminder", exact: true }).click();
  await expect(page.getByText("Your reminder was saved. Email is currently unavailable. You can retry sending the confirmation.", { exact: true })).toHaveCount(2);
  await expect(page.getByText("email_unavailable", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry failed action" })).toBeEnabled();
  await expect(page.getByRole("link", { name: "Payment", exact: true })).toHaveAttribute("href", "/projects/alpha/expenses?expenseTab=payments&expenseRecord=first-payment&lang=en");
});

test("renders readable document answers and groups preview pages with one download", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const file = "/api/files?id=plans&preview=pdf&project=alpha";
  const title = "Planos municipales de Casa Mirador.pdf";
  await page.route("**/api/assistant/conversations**", (route) => route.fulfill({ json: { conversations: [] } }));
  await page.route("**/api/assistant/chat", (route) => route.fulfill({
    contentType: "text/event-stream",
    body: sse("text_delta", { delta: `Encontré los planos.\n\n- **Versión municipal**\n- [Abrir página](${file}#page=2)\n- [Enlace no verificado](https://example.test/other)` }) +
      sse("citation", { id: "p2", kind: "document", label: title + " · p. 2", href: file + "#page=2" }) +
      sse("citation", { id: "p22", kind: "document", label: title + " · p. 22", href: file + "#page=22" }) +
      sse("done", { messageId: "plans-answer" }),
  }));
  await page.goto(`${url}/?visual=1`);
  await page.getByRole("button", { name: "Abrir asistente del proyecto" }).click();
  const panel = page.getByRole("dialog", { name: "Asistente del proyecto" });
  await panel.getByRole("textbox").fill("Pasame los planos para la Municipalidad");
  await panel.getByRole("button", { name: "Enviar mensaje" }).click();

  await expect(panel.getByText("Versión municipal", { exact: true })).toBeVisible();
  await expect(panel.getByRole("link", { name: "Abrir página" })).toHaveAttribute("href", file + "#page=2");
  await expect(panel.getByRole("link", { name: "Enlace no verificado" })).toHaveCount(0);
  const sources = panel.getByRole("region", { name: "Fuentes" });
  await expect(sources.getByText(title, { exact: true })).toHaveCount(1);
  await expect(sources.getByRole("link", { name: "Descargar " + title })).toHaveAttribute("href", "/api/files?id=plans&project=alpha");
  await expect(sources.getByRole("link", { name: title + " · p. 22" })).toHaveAttribute("href", file + "#page=22");
  await expect(panel.getByRole("button", { name: "Adjuntar factura o comprobante" })).toBeVisible();

  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 700 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await expect(panel).toBeVisible();
    expect(await panel.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0);
    await expect(panel.getByRole("textbox")).toBeInViewport();
    if (viewport.width === 390) await panel.screenshot({ path: testInfo.outputPath("assistant-mobile.png") });
  }
  await page.route("**/api/files?id=plans&project=alpha", (route) => route.fulfill({
    headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="municipal.pdf"' },
    body: "%PDF-1.4",
  }));
  const download = page.waitForEvent("download");
  await sources.getByRole("link", { name: "Descargar " + title }).click();
  expect((await download).suggestedFilename()).toBe("municipal.pdf");
});
