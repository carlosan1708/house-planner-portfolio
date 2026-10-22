// @vitest-environment jsdom

import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import BudgetWorkspace from "@/app/components/BudgetWorkspace";

vi.mock("@/app/components/GoogleSheetsEditing", () => ({ default: () => null }));

const line = { id: "line-pisos", row: 4, chapter: "Pisos", item: "Baldosas", type: "Construcción", subcategory: "Baño", objective: 100, excess: 0, quote: 100, paid: 20, supplier: "", status: "Pendiente" };
const summary = (label: string) => [{ label, objective: 100, excess: 0, spent: 20, count: 1 }];
const budget = {
  currency: "CRC", objective: 100, excess: 0, spent: 20, remaining: 80, percentUsed: 20, status: "within_objective",
  lines: [line], summaries: { chapter: summary(line.chapter), type: summary(line.type), subcategory: summary(line.subcategory) },
  unsupported: [], editingAllowed: true, planVersion: 1, actualsRevision: 0,
};
const workbook = () => ({
  id: "official-source", name: "Budget", sheetOrder: ["category-1"],
  sheets: { "category-1": { id: "category-1", name: "Pisos", rowCount: 30, columnCount: 26, cellData: {
    2: { 4: { v: "Objective" } },
    3: { 0: { v: line.chapter }, 1: { v: line.item }, 2: { v: line.type }, 3: { v: line.subcategory }, 4: { v: line.objective }, 6: { v: line.quote }, 8: { v: line.status }, 9: { v: line.paid }, 25: { v: line.id } },
  }, rowData: {}, columnData: {}, mergeData: [] } },
});
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const draftResponse = () => json({ id: "private-draft", revision: 1, workbook: workbook(), rowMaps: { Pisos: { 4: 4 } } }, 201);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

type Props = ComponentProps<typeof BudgetWorkspace>;
let root: Root | null = null;
let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); root = null; vi.unstubAllGlobals(); document.body.innerHTML = ""; });

async function renderWorkspace(props: Partial<Props> = {}, waitUntilReady = true) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(BudgetWorkspace, {
    mode: "real", language: "es", canEdit: true, canReplace: false, isOwner: false,
    onReplace: () => undefined, projectId: "sample-house", routeScope: null, ...props,
  })));
  if (waitUntilReady) await vi.waitFor(() => expect(button("Editar presupuesto").disabled).toBe(false));
}
function button(label: string) {
  const found = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label);
  expect(found, `button ${label}`).toBeDefined();
  return found!;
}
const categoryButton = () => container.querySelector<HTMLButtonElement>(".budget-line-card-heading > button")!;
const statusText = () => [...container.querySelectorAll('[role="status"]')].map((element) => element.textContent).join(" ");
async function click(target: HTMLElement) { await act(async () => target.click()); }
async function settle(pending: ReturnType<typeof deferred<Response>>, response: Response) { await act(async () => pending.resolve(response)); }

describe("budget action feedback", () => {
  it("shows synchronization progress and disables category actions until the current budget arrives", async () => {
    const canonical = deferred<Response>();
    let openingCount = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/budget") return new Headers(init?.headers).get("x-house-planner-budget-source") === "stored"
        ? json({ ...budget, googleSyncPending: true, editingAllowed: false })
        : canonical.promise;
      openingCount++;
      throw new Error(`Unexpected request: ${input}`);
    }));
    await renderWorkspace({}, false);
    await vi.waitFor(() => expect(container.querySelector(".budget-metrics")).not.toBeNull());
    expect(statusText()).toContain("Actualizando desde Google…");
    expect(button("Editar presupuesto").disabled).toBe(true);
    expect(categoryButton().disabled).toBe(true);
    expect([...container.querySelectorAll<HTMLButtonElement>(".chart-legend button")].every((control) => control.disabled)).toBe(true);
    const segment = container.querySelector('.donut-segment[role="button"]')!;
    expect(segment.getAttribute("aria-disabled")).toBe("true");
    act(() => {
      segment.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      segment.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(openingCount).toBe(0);
    await settle(canonical, json(budget));
    expect(button("Editar presupuesto").disabled).toBe(false);
    expect(categoryButton().disabled).toBe(false);
    expect(statusText()).not.toContain("Actualizando desde Google…");
  });

  it("acknowledges category clicks immediately, prevents duplicates, and lets an opening failure retry", async () => {
    const opening = deferred<Response>();
    let openingCount = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/budget") return json(budget);
      if (String(input) === "/api/workbook/drafts" && init?.method === "POST") {
        openingCount++;
        return openingCount === 1 ? opening.promise : draftResponse();
      }
      throw new Error(`Unexpected request: ${input}`);
    }));
    await renderWorkspace();
    await click(categoryButton());
    expect(statusText()).toContain("Abriendo Pisos…");
    expect(button("Abriendo…").disabled).toBe(true);
    expect(categoryButton().disabled).toBe(true);
    expect([...container.querySelectorAll<HTMLButtonElement>(".chart-legend button")].every((control) => control.disabled)).toBe(true);
    expect([...container.querySelectorAll('.donut-segment[role="button"]')].every((control) => control.getAttribute("aria-disabled") === "true")).toBe(true);
    await click(categoryButton());
    expect(openingCount).toBe(1);
    await settle(opening, json({ error: "No se pudo abrir la hoja" }, 503));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("No se pudo abrir la hoja");
    expect(categoryButton().disabled).toBe(false);
    expect(button("Editar presupuesto").disabled).toBe(false);
    await click(categoryButton());
    await vi.waitFor(() => expect(container.querySelector('input[aria-label="Baldosas Objetivo"]')).not.toBeNull());
    expect(openingCount).toBe(2);
    expect(statusText()).not.toContain("Abriendo Pisos…");
  });

  it("shows draft loading before results arrive, suppresses repeat clicks, and reports an empty result", async () => {
    const drafts = deferred<Response>();
    let requestCount = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/budget") return json(budget);
      if (String(input) === "/api/workbook/drafts") { requestCount++; return drafts.promise; }
      throw new Error(`Unexpected request: ${input}`);
    }));
    await renderWorkspace();
    await click(button("Borradores guardados"));
    expect(statusText()).toContain("Cargando borradores guardados…");
    expect(button("Cargando borradores…").disabled).toBe(true);
    expect(container.textContent).not.toContain("No hay borradores editables.");
    await click(button("Cargando borradores…"));
    expect(requestCount).toBe(1);
    await settle(drafts, json({ drafts: [] }));
    expect(container.textContent).toContain("No hay borradores editables.");
    expect(button("Borradores guardados").disabled).toBe(false);
    expect(statusText()).not.toContain("Cargando borradores guardados…");
  });

  it("clears draft loading after failure and allows the request to be retried", async () => {
    const drafts = deferred<Response>();
    let requestCount = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/budget") return json(budget);
      if (String(input) === "/api/workbook/drafts") {
        requestCount++;
        return requestCount === 1 ? drafts.promise : json({ drafts: [{ id: "saved-private-draft", status: "editing", scope: { key: "chapter", label: "Pisos" } }] });
      }
      throw new Error(`Unexpected request: ${input}`);
    }));
    await renderWorkspace();
    await click(button("Borradores guardados"));
    await settle(drafts, json({ error: "Borradores no disponibles" }, 503));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Borradores no disponibles");
    expect(button("Borradores guardados").disabled).toBe(false);
    await click(button("Borradores guardados"));
    await vi.waitFor(() => expect(container.textContent).toContain("Pisos · saved-pr"));
    expect(requestCount).toBe(2);
    expect(container.textContent).not.toContain("Borradores no disponibles");
  });

  it("keeps owner Save visibly busy through publication and preserves entered cells on failure", async () => {
    const publish = deferred<Response>();
    const actions: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/budget") return json(budget);
      if (String(input) === "/api/workbook/drafts") {
        const body = JSON.parse(String(init?.body));
        actions.push(body.action);
        if (body.action === "create") return draftResponse();
        if (body.action === "save") return json({ revision: 2 });
        if (body.action === "publish") return publish.promise;
      }
      throw new Error(`Unexpected request: ${input}`);
    }));
    await renderWorkspace({ isOwner: true });
    await click(categoryButton());
    await vi.waitFor(() => expect(container.querySelector('input[aria-label="Baldosas Objetivo"]')).not.toBeNull());
    act(() => {
      const input = container.querySelector('input[aria-label="Baldosas Objetivo"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "175");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(button("Guardar"));
    await vi.waitFor(() => expect(actions).toContain("publish"));
    expect(button("Guardando…").disabled).toBe(true);
    expect(statusText()).toContain("Publicando el libro oficial…");
    expect((container.querySelector('input[aria-label="Baldosas Objetivo"]') as HTMLInputElement).disabled).toBe(true);
    await click(button("Guardando…"));
    expect(actions.filter((action) => action === "publish")).toHaveLength(1);
    await settle(publish, json({ error: "Publicación no disponible" }, 503));
    expect(statusText()).toContain("Publicación no disponible");
    expect(button("Guardar").disabled).toBe(false);
    const input = container.querySelector('input[aria-label="Baldosas Objetivo"]') as HTMLInputElement;
    expect(input.disabled).toBe(false);
    expect(input.value).toBe("175");
  });
});
