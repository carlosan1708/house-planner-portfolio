// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AnalyticsWorkspace from "@/app/components/AnalyticsWorkspace";
import type { UsageAnalyticsResponse, UsageTotals } from "@/lib/usage-types";

const totals: UsageTotals = { visits: 4, visitors: 3, users: 2, views: 10, actions: 6, activeMs: 150_000 };
const emptyTotals: UsageTotals = { visits: 0, visitors: 0, users: 0, views: 0, actions: 0, activeMs: 0 };
type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
function payload(usage: UsageTotals = totals): UsageAnalyticsResponse {
  return {
    filters: { from: "2026-09-07", to: "2026-10-06", context: "all", projectId: null, includeOwner: false },
    metadata: { startedAt: "2026-10-06T18:00:00Z", timezone: "America/Costa_Rica", retentionDays: 90 },
    totals: usage,
    daily: [{ day: "2026-10-06", ...usage }],
    sections: usage.views ? [{ section: "budget", ...usage }] : [],
    projects: usage.views ? [{ projectId: "p1", name: "Casa Uno", ...usage }] : [],
    projectOptions: [{ projectId: "p1", name: "Casa Uno" }, { projectId: "p2", name: "Casa Dos" }],
    users: usage.users ? [{ uid: "u1", name: "Ana", email: "ana@example.test", lastAt: "2026-10-07T02:00:00Z", views: 10, actions: 6, activeMs: 150_000 }] : [],
  };
}

let root: Root | null = null;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T02:15:00Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root?.unmount()); root = null;
  vi.unstubAllGlobals(); vi.useRealTimers();
  document.body.innerHTML = "";
});

async function settle() { await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 5)); }); }
async function render(language: "es" | "en" = "es") { await act(async () => { root!.render(createElement(AnalyticsWorkspace, { language })); }); await settle(); }
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === text);
  expect(button).toBeDefined();
  await act(async () => { button!.click(); }); await settle();
}
function field<T extends HTMLElement>(text: string): T {
  const label = [...container.querySelectorAll("label")].find((item) => item.querySelector("span")?.textContent === text);
  expect(label, `Missing field ${text}`).toBeDefined();
  return label!.querySelector("input, select") as T;
}
async function select(text: string, value: string) {
  await act(async () => { const element = field<HTMLSelectElement>(text); element.value = value; element.dispatchEvent(new Event("change", { bubbles: true })); }); await settle();
}
async function input(text: string, value: string) {
  await act(async () => {
    const element = field<HTMLInputElement>(text);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }); await settle();
}

describe("platform analytics workspace", () => {
  it("defaults to 30 inclusive days in Costa Rica and distinguishes browsers, accounts and approximate time", async () => {
    const api = vi.fn<ApiFetch>(async () => new Response(JSON.stringify(payload())));
    vi.stubGlobal("fetch", api);
    await render();
    const query = new URL(String(api.mock.calls[0][0]), "https://houseplanner.test").searchParams;
    expect(Object.fromEntries(query)).toEqual({ from: "2026-09-07", to: "2026-10-06", context: "all", includeOwner: "false" });
    expect(container.textContent).toContain("Visitantes estimados");
    expect(container.textContent).toContain("Usuarios con sesión");
    expect(container.textContent).toContain("Tiempo activo · aproximado");
    expect(container.textContent).toContain("2 min");
    expect(container.textContent).toContain("ana@example.test");
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toBe("Gráfico diario de visitas, vistas y acciones");
    expect(container.querySelector("time")?.textContent).toContain("6 oct");
    expect(field<HTMLSelectElement>("Proyecto").disabled).toBe(true);
    expect(container.querySelectorAll(".analytics-breakdown")[0].textContent).toContain("visitas");
    expect(container.querySelectorAll(".analytics-breakdown")[1].textContent).not.toContain("visitas");
    expect(container.querySelectorAll(".analytics-breakdown")[1].textContent).toContain("activo · aproximado");
  });

  it("ignores an old response even when the transport does not reject an aborted request", async () => {
    let resolveFirst: (response: Response) => void = () => undefined;
    const api = vi.fn<ApiFetch>((_: RequestInfo | URL, init?: RequestInit) => {
      void init;
      if (api.mock.calls.length === 1) return new Promise<Response>((resolve) => { resolveFirst = resolve; });
      return Promise.resolve(new Response(JSON.stringify(payload({ ...totals, visits: 7 }))));
    });
    vi.stubGlobal("fetch", api);
    await render();
    await click("7 días");
    expect(container.querySelector(".analytics-metrics strong")?.textContent).toBe("7");
    expect((api.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
    await act(async () => { resolveFirst(new Response(JSON.stringify(payload({ ...totals, visits: 999 })))); });
    expect(container.querySelector(".analytics-metrics strong")?.textContent).toBe("7");
  });

  it("keeps all project choices after selecting one and resets context, dates and owner activity", async () => {
    const api = vi.fn<ApiFetch>(async () => new Response(JSON.stringify(payload())));
    vi.stubGlobal("fetch", api);
    await render();
    await select("Contexto", "project");
    await select("Proyecto", "p1");
    expect([...field<HTMLSelectElement>("Proyecto").options].map((item) => item.value)).toEqual(["", "p1", "p2"]);
    expect(new URL(String(api.mock.calls.at(-1)?.[0]), "https://houseplanner.test").searchParams.get("projectId")).toBe("p1");
    await act(async () => { field<HTMLInputElement>("Incluir mi actividad").click(); }); await settle();
    expect(new URL(String(api.mock.calls.at(-1)?.[0]), "https://houseplanner.test").searchParams.get("includeOwner")).toBe("true");
    await click("7 días");
    await click("Restablecer filtros");
    const query = new URL(String(api.mock.calls.at(-1)?.[0]), "https://houseplanner.test").searchParams;
    expect(Object.fromEntries(query)).toEqual({ from: "2026-09-07", to: "2026-10-06", context: "all", includeOwner: "false" });
    expect(field<HTMLSelectElement>("Proyecto").value).toBe("");
  });

  it("does not request invalid custom ranges or expose a previous result under those dates", async () => {
    const api = vi.fn<ApiFetch>(async () => new Response(JSON.stringify(payload())));
    vi.stubGlobal("fetch", api);
    await render();
    await input("Desde", "2026-01-01");
    expect(api).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("máximo 90 días");
    expect(container.querySelector(".analytics-metrics")).toBeNull();
    await input("Desde", "2026-09-07");
    expect(api).toHaveBeenCalledTimes(2);
    await input("Hasta", "2026-10-07");
    expect(api).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("hasta hoy en Costa Rica");
  });

  it("shows a zero-data state with an honest measurement start and retains the project selector", async () => {
    const empty = payload(emptyTotals); empty.metadata.startedAt = null;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(empty))));
    await render();
    expect(container.textContent).toContain("Sin uso en este período");
    expect(container.textContent).toContain("La medición comienza al registrarse");
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelectorAll(".analytics-metrics strong")).toHaveLength(6);
    expect(field<HTMLSelectElement>("Proyecto").options).toHaveLength(3);
  });

  it("rejects a short historical range outside the last 90 days before requesting it", async () => {
    const api = vi.fn<ApiFetch>(async () => new Response(JSON.stringify(payload())));
    vi.stubGlobal("fetch", api);
    await render();
    expect(field<HTMLInputElement>("Desde").min).toBe("2026-07-09");
    await input("Desde", "2020-01-01");
    await input("Hasta", "2020-01-01");
    expect(api).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Solo están disponibles los últimos 90 días");
    expect(container.querySelector(".analytics-metrics")).toBeNull();
  });

  it("offers a retry after a failed request and recovers with English labels", async () => {
    let failed = true;
    const api = vi.fn<ApiFetch>(async () => failed ? new Response("{}", { status: 503 }) : new Response(JSON.stringify(payload())));
    vi.stubGlobal("fetch", api);
    await render("en");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("could not be loaded");
    failed = false;
    await click("Try again");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("Signed-in users");
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("shows access denied without retaining counts from a previous request", async () => {
    let allowed = true;
    vi.stubGlobal("fetch", vi.fn<ApiFetch>(async () => allowed ? new Response(JSON.stringify(payload())) : new Response("{}", { status: 403 })));
    await render();
    expect(container.querySelector(".analytics-metrics")).not.toBeNull();
    allowed = false;
    await click("7 días");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("administrador de la plataforma");
    expect(container.querySelector(".analytics-metrics")).toBeNull();
    expect([...container.querySelectorAll("button")].some((item) => item.textContent === "Intentar de nuevo")).toBe(false);
  });
});
