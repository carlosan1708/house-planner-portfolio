// @vitest-environment jsdom

import { act, createElement, StrictMode, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import BudgetWorkspace from "@/app/components/BudgetWorkspace";
import type { BudgetRouteScope } from "@/lib/workspace-navigation";

vi.mock("@/app/components/GoogleSheetsEditing", () => ({ default: () => null }));

const line = { id: "line-pisos", row: 4, chapter: "Pisos", item: "Baldosas", type: "Construcción", subcategory: "Baño / interior", objective: 100, excess: 0, quote: 100, paid: 20, supplier: "", status: "Pendiente" };
const summary = (label: string) => [{ label, objective: 100, excess: 0, spent: 20, count: 1 }];
const budget = {
  currency: "CRC", objective: 100, excess: 0, spent: 20, remaining: 80, percentUsed: 20, status: "within",
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

type Props = ComponentProps<typeof BudgetWorkspace>;
let root: Root | null = null;
let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); root = null; vi.unstubAllGlobals(); document.body.innerHTML = ""; });

function mockApi(options: { openingResponse?: () => Promise<Response>; currency?: "USD" | "CRC" } = {}) {
  let saveError = "";
  let revision = 1;
  const actions: Array<{ action: string; id?: string; scope?: BudgetRouteScope; workbook?: ReturnType<typeof workbook> }> = [];
  const viewerUrls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/budget") return new Response(JSON.stringify({ ...budget, currency: options.currency || budget.currency }));
    if (url.startsWith("/api/workbook/editor?")) { viewerUrls.push(url); return new Response(JSON.stringify({ workbook: workbook(), rowMaps: { Pisos: { 4: 4 } } })); }
    if (url.startsWith("/api/workbook/drafts?id=")) return options.openingResponse!();
    if (url === "/api/workbook/drafts") {
      const body = JSON.parse(String(init?.body || "{}")); actions.push(body);
      if (body.action === "create") return options.openingResponse ? options.openingResponse() : new Response(JSON.stringify({ id: "new-private-draft", revision: 1, workbook: workbook(), rowMaps: { Pisos: { 4: 4 } } }), { status: 201 });
      if (body.action === "save") return new Response(JSON.stringify(saveError ? { error: saveError } : { revision: ++revision }), { status: saveError ? 503 : 200 });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { actions, viewerUrls, failSaves: (error: string) => { saveError = error; } };
}

async function renderWorkspace(props: Partial<Props> = {}, strict = false) {
  const fullProps: Props = { mode: "real", language: "es", canEdit: true, canReplace: false, isOwner: false, onReplace: () => undefined, projectId: "sample-house", routeScope: { key: "chapter", label: "Pisos" }, ...props };
  if (!root) { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); }
  await act(async () => { const element = createElement(BudgetWorkspace, fullProps); root!.render(strict ? createElement(StrictMode, null, element) : element); });
  return fullProps;
}
async function awaitSheet() { await vi.waitFor(() => expect(container.querySelector('input[aria-label="Baldosas Objetivo"]')).not.toBeNull()); }
async function clickDashboard() { await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("← Panel"))!.click(); }); }

describe("budget category URLs", () => {
  it("shows the saved budget while Google is slow and coalesces repeated background refreshes", async () => {
    let finishCanonical!: (response: Response) => void;
    const canonical = new Promise<Response>((resolve) => { finishCanonical = resolve; });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== "/api/budget") throw new Error(`Unexpected request: ${input}`);
      if (new Headers(init?.headers).get("x-house-planner-budget-source") === "stored")
        return new Response(JSON.stringify({ ...budget, editingAllowed: false, googleSyncPending: true }));
      return canonical;
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    try {
      await renderWorkspace({ routeScope: null });
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("x-house-planner-budget-source")).toBe("stored");
      expect(new Headers(fetchMock.mock.calls[1][1]?.headers).has("x-house-planner-budget-source")).toBe(false);
      expect(container.querySelector(".budget-metrics")).not.toBeNull();
      expect(container.textContent).toContain("Baldosas");
      expect(container.textContent).not.toContain("Cargando presupuesto");
      const editButton = () => [...container.querySelectorAll("button")].find((button) => button.textContent === "Editar presupuesto");
      expect(editButton()?.disabled).toBe(true);
      for (let repeat = 0; repeat < 4; repeat++) {
        await act(async () => {
          window.dispatchEvent(new Event("focus"));
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(3_000);
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(container.querySelector(".budget-metrics")).not.toBeNull();
      }
      await act(async () => {
        finishCanonical(new Response(JSON.stringify({ ...budget, lines: [{ ...line, item: "Baldosas actualizadas" }], planVersion: 2 })));
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(container.textContent).toContain("Baldosas actualizadas");
      expect(editButton()?.disabled).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it("lets a confirmed workbook update supersede an older in-flight Google read", async () => {
    let finishOlder!: (response: Response) => void;
    const older = new Promise<Response>((resolve) => { finishOlder = resolve; });
    let canonicalReads = 0;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (new Headers(init?.headers).get("x-house-planner-budget-source") === "stored")
        return new Response(JSON.stringify({ ...budget, editingAllowed: false, googleSyncPending: true }));
      if (++canonicalReads === 1) return older;
      return new Response(JSON.stringify({ ...budget, lines: [{ ...line, item: "Partida importada" }], planVersion: 2 }));
    }));
    await renderWorkspace({ routeScope: null });
    await vi.waitFor(() => expect(container.querySelector(".budget-metrics")).not.toBeNull());
    await act(async () => { window.dispatchEvent(new Event("houseplanner-budget-updated")); });
    await vi.waitFor(() => expect(container.textContent).toContain("Partida importada"));
    await act(async () => { finishOlder(new Response(JSON.stringify(budget))); });
    expect(canonicalReads).toBe(2);
    expect(container.textContent).toContain("Partida importada");
    expect(container.textContent).not.toContain("Actualizando desde Google");
  });

  it("lets a slow saved read finish despite focus events every three seconds", async () => {
    let finishSaved!: (response: Response) => void;
    let finishCanonical!: (response: Response) => void;
    const saved = new Promise<Response>((resolve) => { finishSaved = resolve; });
    const canonical = new Promise<Response>((resolve) => { finishCanonical = resolve; });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== "/api/budget") throw new Error(`Unexpected request: ${input}`);
      return new Headers(init?.headers).get("x-house-planner-budget-source") === "stored" ? saved : canonical;
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    try {
      await renderWorkspace({ routeScope: null });
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(fetchMock).toHaveBeenCalledOnce();
      for (let repeat = 0; repeat < 4; repeat++) {
        await act(async () => {
          window.dispatchEvent(new Event("focus"));
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(3_000);
        });
        expect(fetchMock).toHaveBeenCalledOnce();
      }
      await act(async () => {
        finishSaved(new Response(JSON.stringify({ ...budget, editingAllowed: false, googleSyncPending: true })));
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(container.querySelector(".budget-metrics")).not.toBeNull();
      expect(container.textContent).not.toContain("Cargando presupuesto");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await act(async () => {
        finishCanonical(new Response(JSON.stringify(budget)));
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(container.querySelector(".budget-metrics")).not.toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("waits for the canonical budget before opening a linked category from the saved snapshot", async () => {
    let finishCanonical!: (response: Response) => void;
    const canonical = new Promise<Response>((resolve) => { finishCanonical = resolve; });
    const actions: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/budget") {
        if (new Headers(init?.headers).get("x-house-planner-budget-source") === "stored")
          return new Response(JSON.stringify({ ...budget, editingAllowed: false, googleSyncPending: true }));
        return canonical;
      }
      if (url === "/api/workbook/drafts") {
        const body = JSON.parse(String(init?.body || "{}")); actions.push(body);
        return new Response(JSON.stringify({ id: "new-private-draft", revision: 1, workbook: workbook(), rowMaps: { Pisos: { 4: 4 } } }), { status: 201 });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));
    vi.useFakeTimers();
    try {
      await renderWorkspace();
      await act(async () => { await vi.advanceTimersByTimeAsync(5); });
      expect(container.querySelector(".budget-metrics")).not.toBeNull();
      expect(actions).toEqual([]);
      await act(async () => {
        finishCanonical(new Response(JSON.stringify(budget)));
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(5); });
      expect(actions).toEqual([{ action: "create", scope: { key: "chapter", label: "Pisos" }, expectedCurrency: "CRC" }]);
      expect(container.querySelector('input[aria-label="Baldosas Objetivo"]')).not.toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it.each([
    ["es", "presupuesto guardado en modo de solo lectura", "Los cambios de Google están pendientes"],
    ["en", "saved budget in read-only mode", "Google changes are pending"],
  ] as const)("keeps the saved budget visible and prevents opening editors during a Google sync failure in %s", async (language, savedNotice, pendingNotice) => {
    const syncError = "El historial de pagos de Google cambió.";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) !== "/api/budget") throw new Error(`Unexpected request: ${input}`);
      return new Response(JSON.stringify({ ...budget, editingAllowed: false, googleSyncError: syncError }));
    });
    vi.stubGlobal("fetch", fetchMock);
    await renderWorkspace({ language });
    await vi.waitFor(() => expect(container.querySelector(".budget-metrics")).not.toBeNull());
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(savedNotice);
    expect(alert?.textContent).toContain(pendingNotice);
    expect(alert?.textContent).toContain(syncError);
    expect(container.textContent).toContain("Baldosas");
    const editButton = [...container.querySelectorAll("button")].find((button) => button.textContent === (language === "es" ? "Editar presupuesto" : "Edit budget"));
    expect(editButton?.disabled).toBe(true);
    await act(async () => {
      (container.querySelector(".budget-line-card-heading button") as HTMLButtonElement).click();
      (container.querySelector(".chart-legend button") as HTMLButtonElement).click();
    });
    expect(fetchMock.mock.calls.every(([url]) => url === "/api/budget")).toBe(true);
    expect(container.querySelector('input[aria-label="Baldosas Objetivo"]')).toBeNull();
  });

  it("retains cents in CRC totals after a denomination correction", async () => {
    const fractionalLine = { ...line, objective: 100.75, quote: 100.75, paid: 20.25 };
    const value = { ...budget, objective: 100.75, spent: 20.25, remaining: 80.5, lines: [fractionalLine] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(value))));
    await renderWorkspace({ language: "en", routeScope: null });
    const crc = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "CRC", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);
    await vi.waitFor(() => expect(container.querySelector(".budget-metrics")?.textContent).toContain(crc(100.75)));
    expect(container.querySelector(".budget-metrics")?.textContent).toContain(crc(20.25));
    expect(container.querySelector(".budget-metrics")?.textContent).toContain(crc(80.5));
  });

  it("uses real USD project currency on the dashboard and budget rows in either language", async () => {
    mockApi({ currency: "USD" });
    await renderWorkspace({ language: "en", routeScope: null });
    await vi.waitFor(() => expect(container.querySelector(".budget-metrics")?.textContent).toContain("$100"));
    expect(container.querySelector(".page-intro .overline")?.textContent).toContain("USD");
    expect(container.querySelector(".budget-dashboard")?.textContent).not.toContain("₡");
    await renderWorkspace({ language: "es", routeScope: null });
    expect(container.querySelector(".page-intro .overline")?.textContent).toContain("USD");
    expect(container.querySelector(".budget-dashboard")?.textContent).not.toContain("₡");
  });

  it("fills a zero quote from the final objective when saving Sample through the workspace", async () => {
    const api = mockApi();
    await renderWorkspace();
    await awaitSheet();
    act(() => {
      for (const [label, value] of [["Baldosas Cotización", "0"], ["Baldosas Objetivo", "1000000"]]) {
        const input = container.querySelector(`input[aria-label="${label}"]`)!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await clickDashboard();
    const saved = api.actions.findLast((action) => action.action === "save")?.workbook;
    expect(saved?.sheets["category-1"].cellData[3][4].v).toBe(1000000);
    expect(saved?.sheets["category-1"].cellData[3][6].v).toBe(1000000);
    expect(saved?.sheets["category-1"].cellData[3][9].v).toBe(20);
  });

  it("does not save the published draft again after defaulting a quote and opening the next administrator draft", async () => {
    const actions: Array<{ action: string; id?: string; workbook?: ReturnType<typeof workbook> }> = [];
    let created = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/budget") return new Response(JSON.stringify(budget));
      if (url === "/api/workbook/drafts") {
        const body = JSON.parse(String(init?.body || "{}")); actions.push(body);
        if (body.action === "create") return new Response(JSON.stringify({ id: `private-draft-${++created}`, revision: 1, workbook: workbook(), rowMaps: { Pisos: { 4: 4 } } }), { status: 201 });
        if (body.action === "save") {
          if (body.id === "private-draft-1" && created > 1) return new Response(JSON.stringify({ error: "Published draft cannot be saved", code: "revision_conflict" }), { status: 409 });
          return new Response(JSON.stringify({ revision: 2 }));
        }
        if (body.action === "publish") return new Response(JSON.stringify({ status: "published", planVersion: 2 }));
      }
      throw new Error(`Unexpected request: ${url}`);
    }));
    await renderWorkspace({ isOwner: true });
    await awaitSheet();
    vi.useFakeTimers();
    try {
      await act(async () => {
        const input = container.querySelector('input[aria-label="Baldosas Cotización"]')!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "0");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent === "Guardar")!.click(); });
      await vi.waitFor(() => expect(actions.map(({ action }) => action)).toEqual(["create", "save", "publish", "create"]));
      expect(actions[1].id).toBe("private-draft-1");
      expect(actions[1].workbook?.sheets["category-1"].cellData[3][6].v).toBe(100);
      expect(container.textContent).toContain("Publicado · listo para continuar editando");
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
      expect(actions.filter(({ action }) => action === "save")).toHaveLength(1);
      expect(container.textContent).toContain("Publicado · listo para continuar editando");
      expect((container.querySelector('input[aria-label="Baldosas Objetivo"]') as HTMLInputElement).disabled).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it("shows the quote total between objective and excess, excluding items outside the objective", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ...budget,
      objective: 150,
      lines: [
        { ...line, quote: 125 },
        { ...line, id: "line-pintura", item: "Pintura", objective: 50, quote: 75 },
        { ...line, id: "line-extra", item: "Extra", objective: 0, quote: 600, outsideObjective: true },
      ],
    }))));
    await renderWorkspace({ routeScope: null });
    await vi.waitFor(() => expect(container.querySelector(".budget-metrics")).not.toBeNull());
    const cards = [...container.querySelectorAll(".budget-metrics > div")];
    expect(cards.map((card) => card.querySelector("span")?.textContent)).toEqual([
      "Objetivo", "Cotización", "Exceso sobre objetivo", "Gasto real", "Restante", "Usado",
    ]);
    const currency = (value: number) => new Intl.NumberFormat("es-CR", { style: "currency", currency: "CRC", maximumFractionDigits: 0 }).format(value);
    expect(cards[0].querySelector("strong")?.textContent).toBe(currency(150));
    expect(cards[1].querySelector("strong")?.textContent).toBe(currency(200));
  });

  it("recalculates the USD quote total when a demo sheet changes", async () => {
    await renderWorkspace({ mode: "demo", routeScope: null });
    await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent === "Editar presupuesto")!.click(); });
    await vi.waitFor(() => expect(container.querySelector('input[aria-label="Concreto y refuerzo Cotización"]')).not.toBeNull());
    act(() => {
      const input = container.querySelector('input[aria-label="Concreto y refuerzo Cotización"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "30011");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await clickDashboard();
    const quoteCard = [...container.querySelectorAll(".budget-metrics > div")].find((card) => card.querySelector("span")?.textContent === "Cotización");
    expect(quoteCard?.querySelector("strong")?.textContent).toBe(new Intl.NumberFormat("es-CR", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(45511));
  });


  it.each([true, false])("opens an official-source private draft for an editable user (owner=%s)", async (isOwner) => {
    const api = mockApi();
    await renderWorkspace({ isOwner }, true);
    await awaitSheet();
    expect(api.actions).toEqual([{ action: "create", scope: { key: "chapter", label: "Pisos" }, expectedCurrency: "CRC" }]);
    expect((container.querySelector('input[aria-label="Baldosas Objetivo"]') as HTMLInputElement).disabled).toBe(false);
    expect(api.viewerUrls).toEqual([]);
  });

  it("opens exact names read-only for a viewer without accessing private drafts", async () => {
    const api = mockApi();
    await renderWorkspace({ canEdit: false, routeScope: { key: "subcategory", label: line.subcategory } });
    await awaitSheet();
    expect(api.viewerUrls).toEqual([`/api/workbook/editor?group=subcategory&label=${encodeURIComponent(line.subcategory)}`]);
    expect(api.actions).toEqual([]);
    expect((container.querySelector('input[aria-label="Baldosas Objetivo"]') as HTMLInputElement).disabled).toBe(true);
  });

  it("shows a missing category and creates no new sheet or draft", async () => {
    const api = mockApi();
    await renderWorkspace({ routeScope: { key: "chapter", label: "Pisos desaparecidos" } });
    await vi.waitFor(() => expect(container.textContent).toContain("La categoría «Pisos desaparecidos» ya no existe en el presupuesto oficial."));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(container.textContent).toContain("La categoría «Pisos desaparecidos» ya no existe en el presupuesto oficial.");
    expect(api.actions).toEqual([]);
    expect(api.viewerUrls).toEqual([]);
  });

  it("keeps the sheet and shared destination when closing cannot save, then retries", async () => {
    const api = mockApi();
    const routeChanged = vi.fn();
    await renderWorkspace({ onRouteScopeChange: routeChanged });
    await awaitSheet();
    api.failSaves("Servicio de guardado no disponible");
    await clickDashboard();
    expect(container.textContent).toContain("Servicio de guardado no disponible");
    expect(routeChanged).not.toHaveBeenCalled();
    expect(container.querySelector('input[aria-label="Baldosas Objetivo"]')).not.toBeNull();
    api.failSaves("");
    await clickDashboard();
    await vi.waitFor(() => expect(container.querySelector('input[aria-label="Baldosas Objetivo"]')).toBeNull());
    expect(routeChanged).toHaveBeenCalledWith(null);
    // The requested prop is unchanged until the parent commits the URL callback.
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await vi.waitFor(() => expect(api.actions.filter((item) => item.action === "create")).toHaveLength(1));
  });

  it("registers a guard that preserves unsaved cell contents and blocks failed navigation", async () => {
    const api = mockApi();
    let guard: (() => Promise<boolean>) | null = null;
    const register = (next: typeof guard) => { guard = next; };
    await renderWorkspace({ onRegisterNavigationGuard: register });
    await awaitSheet();
    act(() => {
      const input = container.querySelector('input[aria-label="Baldosas Objetivo"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "999");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    api.failSaves("Guardado fallido");
    let allowed = true;
    await act(async () => { allowed = await guard!(); });
    expect(allowed).toBe(false);
    expect(container.textContent).toContain("Guardado fallido");
    expect((container.querySelector('input[aria-label="Baldosas Objetivo"]') as HTMLInputElement).value).toBe("999");
    expect(api.actions.at(-1)?.workbook?.sheets["category-1"].cellData[3][4].v).toBe(999);
    api.failSaves("");
    let competingNavigation = true;
    await act(async () => {
      const retry = guard!();
      competingNavigation = await guard!();
      allowed = await retry;
    });
    expect(allowed).toBe(true);
    expect(competingNavigation).toBe(false);
    expect(container.querySelector('input[aria-label="Baldosas Objetivo"]')).not.toBeNull();
  });

  it.each(["category", "assistant"])("waits for the %s sheet to open and saves its committed draft before navigation", async (source) => {
    let finishOpening!: (response: Response) => void;
    const openingResponse = new Promise<Response>((resolve) => { finishOpening = resolve; });
    const getOpeningResponse = vi.fn(() => openingResponse);
    const api = mockApi({ openingResponse: getOpeningResponse });
    let guard: (() => Promise<boolean>) | null = null;
    await renderWorkspace({ onRegisterNavigationGuard: (next) => { guard = next; }, ...(source === "assistant" ? { assistantDraftId: "assistant-draft", routeScope: null } : {}) });
    await vi.waitFor(() => expect(getOpeningResponse).toHaveBeenCalledOnce());
    let allowed: boolean | undefined;
    let navigation!: Promise<void>;
    act(() => { navigation = guard!().then((result) => { allowed = result; }); });
    expect(allowed).toBeUndefined();
    expect(api.actions.some((item) => item.action === "save")).toBe(false);
    await act(async () => {
      const data = source === "assistant"
        ? { draft: { id: "assistant-draft", revision: 1, status: "editing", scope: { key: "chapter", label: "Pisos" }, rowMaps: { Pisos: { 4: 4 } } }, workbook: workbook() }
        : { id: "new-private-draft", revision: 1, workbook: workbook(), rowMaps: { Pisos: { 4: 4 } } };
      finishOpening(new Response(JSON.stringify(data), { status: source === "assistant" ? 200 : 201 }));
    });
    await act(async () => { await navigation; });
    expect(allowed).toBe(true);
    const saved = api.actions.find((item) => item.action === "save");
    expect(saved?.id).toBe(source === "assistant" ? "assistant-draft" : "new-private-draft");
    expect(saved?.workbook?.sheets["category-1"].cellData[3][4].v).toBe(100);
  });

  it("cancels navigation waiting for an opening sheet when the workspace unmounts", async () => {
    const api = mockApi({ openingResponse: () => new Promise<Response>(() => undefined) });
    let guard: (() => Promise<boolean>) | null = null;
    await renderWorkspace({ onRegisterNavigationGuard: (next) => { guard = next; } });
    await vi.waitFor(() => expect(api.actions.some((item) => item.action === "create")).toBe(true));
    const navigation = guard!();
    act(() => { root!.unmount(); root = null; });
    expect(await navigation).toBe(false);
    expect(api.actions.some((item) => item.action === "save")).toBe(false);
  });

  it("bounds an opening wait and reports why the original destination is retained", async () => {
    const api = mockApi({ openingResponse: () => new Promise<Response>(() => undefined) });
    let guard: (() => Promise<boolean>) | null = null;
    await renderWorkspace({ onRegisterNavigationGuard: (next) => { guard = next; } });
    await vi.waitFor(() => expect(api.actions.some((item) => item.action === "create")).toBe(true));
    vi.useFakeTimers();
    try {
      const navigation = guard!();
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(await navigation).toBe(false);
      expect(container.textContent).toContain("La apertura de la hoja tardó demasiado. Intenta navegar de nuevo.");
      expect(api.actions.some((item) => item.action === "save")).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it("continues the requested navigation if opening fails without creating an editable sheet", async () => {
    let finishOpening!: (response: Response) => void;
    const api = mockApi({ openingResponse: () => new Promise<Response>((resolve) => { finishOpening = resolve; }) });
    let guard: (() => Promise<boolean>) | null = null;
    await renderWorkspace({ onRegisterNavigationGuard: (next) => { guard = next; } });
    await vi.waitFor(() => expect(api.actions.some((item) => item.action === "create")).toBe(true));
    const navigation = guard!();
    await act(async () => { finishOpening(new Response(JSON.stringify({ error: "Hoja no disponible" }), { status: 503 })); });
    expect(await navigation).toBe(true);
    expect(api.actions.some((item) => item.action === "save")).toBe(false);
    expect(container.textContent).toContain("Hoja no disponible");
  });

  it("handles route changes between categories and the dashboard without reopening", async () => {
    const api = mockApi();
    await renderWorkspace();
    await awaitSheet();
    await renderWorkspace({ routeScope: { key: "type", all: true } });
    await vi.waitFor(() => expect(api.actions.filter((item) => item.action === "create")).toHaveLength(2));
    expect(api.actions.filter((item) => item.action === "create")[1].scope).toEqual({ key: "type", all: true });
    await renderWorkspace({ routeScope: null });
    await vi.waitFor(() => expect(container.querySelector('input[aria-label="Baldosas Objetivo"]')).toBeNull());
    expect(api.actions.filter((item) => item.action === "save")).toHaveLength(2);
  });
});
