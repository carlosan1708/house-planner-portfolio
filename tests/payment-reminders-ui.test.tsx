// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExpensesWorkspace from "@/app/components/ExpensesWorkspace";
import type { PaymentReminder } from "@/lib/payment-reminders";

vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/lib/usage-client", () => ({ trackDemoAction: vi.fn(), trackUsageInteraction: vi.fn() }));
const legacy: PaymentReminder = { id: "old-entry", description: "Suministro eléctrico de prueba", amount: 300, currency: "CRC", dueDate: "", vendor: "", notes: "Revisar antes de pagar", status: "pending", revision: 0 };
let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); window.history.replaceState({}, "", "/projects/house/expenses?expenseTab=pending&budgetLine=unrelated"); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ""; window.history.replaceState({}, "", "/"); });
const button = (text: string, scope: ParentNode = host) => { const value = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === text || item.getAttribute("aria-label") === text); expect(value, text).toBeTruthy(); return value!; };
const click = async (text: string, scope?: ParentNode) => { await act(async () => button(text, scope).click()); };
const dialog = () => host.querySelector<HTMLElement>('[role="dialog"]')!;
async function fill(label: string, value: string) {
  const input = [...dialog().querySelectorAll("label")].find((item) => item.textContent?.startsWith(label))!.querySelector<HTMLInputElement>("input")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
function api(options: { failSave?: boolean; failInitial?: boolean; failRefresh?: boolean; items?: PaymentReminder[] } = {}) {
  let reminders = structuredClone(options.items || [legacy]), failed = false, committed = false;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe("/api/expenses/reminders");
    if (init?.method) {
      if (options.failSave) return Response.json({ error: "No se pudo guardar" }, { status: 503 });
      const body = JSON.parse(String(init.body));
      if (init.method === "POST") reminders.push({ ...body, id: "new-entry", revision: 1 });
      else if (init.method === "DELETE") reminders = reminders.filter((item) => item.id !== body.id);
      else reminders = reminders.map((item) => item.id === body.id ? { ...item, ...body, revision: item.revision + 1 } : item);
      committed = true;
      return Response.json({ id: body.id || "new-entry" });
    }
    if ((options.failInitial && !failed) || options.failRefresh && committed) { failed = true; return Response.json({ error: "Lectura temporalmente no disponible" }, { status: 503 }); }
    return Response.json({ reminders, defaultCurrency: "USD" });
  });
  vi.stubGlobal("fetch", fetcher);
  return { fetcher, reminders: () => reminders, writes: () => fetcher.mock.calls.filter(([, init]) => init?.method) };
}
async function render(owner = true) {
  await act(async () => root.render(createElement(ExpensesWorkspace, { mode: "real", language: "es", isOwner: owner, projectId: "house" })));
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}

describe("independent payment reminder UI", () => {
  it("totals all pending reminders by currency and excludes resolved and unknown amounts regardless of filters", async () => {
    api({ items: [legacy, { ...legacy, id: "usd", amount: 10.25, currency: "USD" }, { ...legacy, id: "usd2", amount: 20.10, currency: "USD" }, { ...legacy, id: "unknown", amount: null }, { ...legacy, id: "resolved", amount: 999, status: "done" }] });
    await render(false);
    const summary = () => host.querySelector<HTMLElement>('[aria-label="Total pendiente"]')!;
    expect(summary().textContent).toContain("₡300"); expect(summary().textContent).toContain("30,35");
    expect(summary().textContent).toContain("1 pendiente"); expect(summary().textContent).not.toContain("999");
    const search = host.querySelector<HTMLInputElement>('.reminder-filters input')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "Sin coincidencias"); search.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(host.querySelectorAll(".reminder-card")).toHaveLength(0); expect(summary().textContent).toContain("30,35");
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, ""); search.dispatchEvent(new Event("input", { bubbles: true })); });
    const filter = host.querySelector<HTMLSelectElement>(".reminder-filters select")!;
    await act(async () => { filter.value = "done"; filter.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(summary().textContent).toContain("₡300"); expect(summary().textContent).toContain("30,35");
  });
  it("opens directly despite an unrelated budget-line parameter and only loads reminders", async () => {
    const mock = api(); await render();
    expect(host.querySelector(".expense-tabs .active")?.textContent).toBe("Pendientes1");
    expect(host.querySelector(".expense-budget-scope")).toBeNull();
    expect(host.querySelector(".expense-summary-bar")).toBeNull();
    expect(host.querySelector(".reminder-card")?.textContent).toContain(legacy.description);
    expect(host.querySelector(".reminder-card")?.textContent).toContain("CRC");
    expect(mock.fetcher).toHaveBeenCalledOnce(); expect(mock.writes()).toHaveLength(0);
  });
  it("creates without an amount or budget binding, then edits the original legacy record", async () => {
    const mock = api(); await render(); await click("Nuevo recordatorio");
    expect(dialog().querySelectorAll("select")).toHaveLength(1);
    expect(dialog().querySelector("select")?.value).toBe("USD");
    await fill("Descripción", "Revisar factura de prueba"); await click("Guardar recordatorio", dialog());
    expect(mock.writes()[0][1]?.method).toBe("POST");
    const created = JSON.parse(String(mock.writes()[0][1]?.body));
    expect(created).toMatchObject({ description: "Revisar factura de prueba", amount: null, currency: "USD" });
    expect(created).not.toHaveProperty("budgetLineId");
    const card = [...host.querySelectorAll<HTMLElement>(".reminder-card")].find((item) => item.textContent?.includes(legacy.description))!;
    await click("Editar", card); await fill("Importe opcional", "250.75"); await click("Guardar recordatorio", dialog());
    expect(JSON.parse(String(mock.writes()[1][1]?.body))).toMatchObject({ id: legacy.id, revision: 0, amount: 250.75, currency: "CRC" });
    expect(mock.reminders()).toHaveLength(2);
  });
  it("resolves and reopens reminders without creating any actual payment", async () => {
    const mock = api(); await render(); await click("Marcar resuelto");
    expect(host.querySelectorAll(".reminder-card")).toHaveLength(0);
    expect(host.querySelector('[aria-label="Total pendiente"]')?.textContent).toContain("0");
    const filter = host.querySelector<HTMLSelectElement>(".reminder-filters select")!;
    await act(async () => { filter.value = "done"; filter.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(host.querySelector(".reminder-card")?.textContent).toContain("Resuelto");
    await click("Reabrir");
    expect(host.querySelector('[aria-label="Total pendiente"]')?.textContent).toContain("₡300");
    expect(mock.reminders()[0]).toMatchObject({ id: legacy.id, status: "pending", amount: 300 });
    expect(mock.writes().map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { id: legacy.id, revision: 0, action: "status", status: "done" },
      { id: legacy.id, revision: 1, action: "status", status: "pending" },
    ]);
  });
  it("confirms deletion and preserves the reminder when cancelled", async () => {
    const mock = api(), confirm = vi.spyOn(window, "confirm").mockReturnValue(false); await render(); await click("Eliminar");
    expect(mock.writes()).toHaveLength(0); confirm.mockReturnValue(true); await click("Eliminar");
    expect(mock.writes()[0][1]?.method).toBe("DELETE"); expect(mock.reminders()).toEqual([]);
  });
  it("does not offer mutations to a reader, including through payment action flags", async () => {
    window.history.replaceState({}, "", "/projects/house/expenses?expenseTab=pending&newPayment=1");
    const mock = api(); await render(false);
    expect(host.querySelector(".reminder-card footer")).toBeNull(); expect(dialog()).toBeNull();
    expect([...host.querySelectorAll("button")].some((item) => item.textContent === "Nuevo recordatorio")).toBe(false);
    expect(mock.writes()).toHaveLength(0);
  });
  it("preserves form values after a rejected save", async () => {
    const mock = api({ failSave: true }); await render(); await click("Editar"); await fill("Descripción", "Conservar borrador"); await click("Guardar recordatorio", dialog());
    expect(dialog().textContent).toContain("No se pudo guardar"); expect(dialog().querySelector("input")?.value).toBe("Conservar borrador");
    expect(mock.reminders()[0].description).toBe(legacy.description);
  });
  it("does not display a false empty state on a failed load and supports refresh", async () => {
    api({ failInitial: true }); await render(); expect(host.textContent).toContain("Lectura temporalmente no disponible");
    expect(host.querySelector('[aria-label="Total pendiente"]')).toBeNull();
    expect(host.textContent).not.toContain("No hay recordatorios con estos filtros");
    await click("Actualizar"); expect(host.querySelector(".reminder-card")?.textContent).toContain(legacy.description);
  });
  it("closes a committed create even if refreshing fails, avoiding a second submission", async () => {
    const mock = api({ failRefresh: true }); await render(); await click("Nuevo recordatorio"); await fill("Descripción", "Recordatorio guardado"); await click("Guardar recordatorio", dialog());
    expect(dialog()).toBeNull(); expect(mock.reminders()).toHaveLength(2); expect(mock.writes()).toHaveLength(1);
    expect(host.textContent).toContain("Lectura temporalmente no disponible");
  });
});
