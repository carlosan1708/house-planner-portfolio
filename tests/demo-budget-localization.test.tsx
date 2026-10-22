// @vitest-environment jsdom

import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BudgetWorkspace from "@/app/components/BudgetWorkspace";
import type { UniverWorkbook } from "@/lib/workbook";
import type { UniverEditorHandle } from "@/app/components/UniverEditor";

vi.mock("@/lib/usage-client", () => ({ trackDemoAction: vi.fn(), trackUsageInteraction: vi.fn() }));
vi.mock("@/app/components/GoogleSheetsEditing", () => ({ default: () => null }));
const observed = vi.hoisted(() => ({ workbook: null as UniverWorkbook | null }));
vi.mock("@/app/components/BudgetTableEditor", async (importOriginal) => {
  const { default: Actual } = await importOriginal<typeof import("@/app/components/BudgetTableEditor")>();
  const { forwardRef, createElement: element } = await import("react");
  return { default: forwardRef<UniverEditorHandle, ComponentProps<typeof Actual>>((props, ref) => {
    observed.workbook = props.data;
    return element(Actual, { ...props, ref });
  }) };
});

type Props = ComponentProps<typeof BudgetWorkspace>;
let root: Root | null = null;
let container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(() => { act(() => root?.unmount()); root = null; vi.unstubAllGlobals(); document.body.innerHTML = ""; observed.workbook = null; });
async function render(language: "en" | "es", props: Partial<Props> = {}) {
  if (!root) { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); }
  await act(async () => { root!.render(createElement(BudgetWorkspace, { mode: "demo", language, canEdit: true, canReplace: false, isOwner: true, onReplace: () => undefined, ...props })); });
}
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === text);
  expect(button, `button ${text}`).toBeTruthy();
  await act(async () => { button!.click(); });
}
function field(label: string) {
  const input = [...container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input,textarea,select")].find((item) => item.getAttribute("aria-label") === label);
  expect(input, `field ${label}`).toBeTruthy();
  return input!;
}
async function input(label: string, value: string) {
  const node = field(label);
  await act(async () => {
    const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
async function formInput(index: number, value: string) {
  const node = container.querySelectorAll<HTMLInputElement>(".budget-add-form input")[index];
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); });
}

describe("demo budget language projection", () => {
  it("renders English sample rows, vendors, statuses and workbook metadata", async () => {
    await render("en");
    expect(container.textContent).toContain("Concrete and reinforcement");
    expect(container.textContent).toContain("Structure · Construction · Foundation");
    expect(container.textContent).not.toContain("Construcción");
    expect(container.textContent).toContain("CONSOLIDATED PLAN + ACTUALS · USD");
    expect([...container.querySelectorAll(".budget-metrics strong")].map((metric) => metric.textContent)).toEqual(["$55,000", "$44,500", "$500", "$6,200", "$48,800", "11.3%"]);
    expect(container.querySelector(".budget-chart-card header strong")!.textContent).toBe("$55,000");
    expect(container.querySelector('.donut-segment[aria-label="Structure: $30,000"]')).not.toBeNull();
    expect(container.querySelector(".budget-paid-amount")!.textContent).toBe("$6,200");
    expect(container.textContent).not.toMatch(/CRC|₡/);
    expect(container.querySelector<HTMLAnchorElement>('a[href$="House_Planner_Demo_en.xlsx"]')).not.toBeNull();
    await click("Edit budget");
    expect(container.textContent).toContain("Objective · USD");
    expect(container.textContent).toContain("Paid · USD");
    expect(field("Concrete and reinforcement Objective").value).toBe("30000");
    expect(field("Concrete and reinforcement Paid").value).toBe("6200");
    expect(field("Concrete and reinforcement Supplier / note").value).toBe("Demo Builder");
    expect(field("Floors and wall finishes Supplier / note").value).toBe("Demo Finishes");
    const status = field("Concrete and reinforcement Status") as HTMLSelectElement;
    expect(status.options[status.selectedIndex].textContent).toBe("Completed");
    const sheet = Object.values(observed.workbook!.sheets).find((candidate) => candidate.name === "Structure")!;
    expect(sheet.name).toBe("Structure");
    expect(sheet.cellData[2][4].v).toBe("Objective");
    expect(sheet.cellData[1][8].v).toBe("✓ 1 completed");
  });

  it("renders and searches Spanish sample categories, rows and vendors", async () => {
    await render("es");
    expect(container.textContent).toContain("Concreto y refuerzo");
    expect(container.textContent).toContain("Estructura · Construcción · Cimentación");
    expect(container.textContent).toContain("Muebles de cocina");
    expect(container.textContent).not.toContain("Concrete and reinforcement");
    await input("Buscar partidas", "cimentación");
    expect(container.querySelectorAll(".budget-line-list button")).toHaveLength(1);
    await input("Buscar partidas", "");
    await click("Editar presupuesto");
    expect(container.textContent).toContain("Objetivo · USD");
    expect(container.textContent).not.toMatch(/CRC|₡/);
    expect(field("Concreto y refuerzo Proveedor / nota").value).toBe("Constructora Demo");
    expect(field("Pisos y acabados de paredes Proveedor / nota").value).toBe("Acabados Demo");
    const sheet = Object.values(observed.workbook!.sheets).find((candidate) => candidate.name === "Estructura")!;
    expect(sheet.name).toBe("Estructura");
    expect(sheet.cellData[2][4].v).toBe("Objetivo");
    expect(sheet.cellData[1][8].v).toBe("✓ 1 completada");
  });

  it("preserves numeric, status and custom vendor edits across both language switches and dashboard navigation", async () => {
    await render("en");
    await click("Edit budget");
    const objectiveNode = field("Concrete and reinforcement Objective");
    await input("Concrete and reinforcement Objective", "12345");
    await input("Concrete and reinforcement Supplier / note", "Custom supplier\nKeep my note");
    await input("Concrete and reinforcement Status", "En progreso");
    await render("es");
    expect(field("Concreto y refuerzo Objetivo")).toBe(objectiveNode);
    expect(field("Concreto y refuerzo Objetivo").value).toBe("12345");
    expect(field("Concreto y refuerzo Proveedor / nota").value).toBe("Custom supplier\nKeep my note");
    expect(field("Concreto y refuerzo Estado").value).toBe("En progreso");
    expect(observed.workbook!.sheets[observed.workbook!.sheetOrder[0]].cellData[2][4].v).toBe("Objetivo");
    await render("en");
    expect(field("Concrete and reinforcement Objective").value).toBe("12345");
    expect(field("Concrete and reinforcement Supplier / note").value).toBe("Custom supplier\nKeep my note");
    await click("← Dashboard");
    await click("Edit budget");
    expect(field("Concrete and reinforcement Objective").value).toBe("12345");
    expect(field("Concrete and reinforcement Status").value).toBe("En progreso");
  });

  it("retains an unfinished form and invalid input without remounting the editor", async () => {
    await render("en");
    await click("Edit budget");
    await input("Concrete and reinforcement Objective", "-1");
    await click("Add item");
    await formInput(0, "Unfinished custom item");
    await render("es");
    expect(field("Concreto y refuerzo Objetivo").value).toBe("-1");
    expect(field("Concreto y refuerzo Objetivo").getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelector('[role="alert"]')!.textContent).toBe("Introduce un importe válido, igual o mayor que cero.");
    expect(container.querySelector<HTMLInputElement>(".budget-add-form input")!.value).toBe("Unfinished custom item");
    expect(container.querySelectorAll<HTMLInputElement>(".budget-add-form input")[1].value).toBe("Acabados");
  });

  it("keeps added custom rows and deletions when the language changes", async () => {
    await render("es");
    await click("Editar presupuesto");
    await click("Agregar partida");
    await formInput(0, "Custom solar roof");
    await act(async () => { container.querySelector(".budget-add-form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await input("Custom solar roof Objetivo", "99");
    await act(async () => { (container.querySelector('[aria-label="Quitar Muebles de cocina"]') as HTMLButtonElement).click(); });
    await render("en");
    expect(field("Custom solar roof Objective").value).toBe("99");
    expect(container.querySelector('[aria-label="Kitchen cabinetry Objective"]')).toBeNull();
    await click("← Dashboard");
    expect(container.textContent).toContain("Custom solar roof");
    expect(container.textContent).not.toContain("Kitchen cabinetry");
    await click("Edit budget");
    expect(field("Custom solar roof Objective").value).toBe("99");
  });

  it("keeps added outside-objective rows in USD without duplicating their paid amounts", async () => {
    await render("en");
    await click("Edit budget");
    await click("Add item");
    await formInput(0, "Demo gift");
    await act(async () => { container.querySelector(".budget-add-form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await input("Demo gift Objective", "100");
    await input("Demo gift Paid", "25.5");
    await act(async () => { (field("Demo gift Outside objective") as HTMLInputElement).click(); });
    await input("Demo gift Paid", "26.25");
    await click("← Dashboard");
    expect(container.querySelector(".budget-outside-objective b")!.textContent).toBe("$26.25");
    expect(container.querySelector(".budget-metrics strong")!.textContent).toBe("$55,000");
    expect(container.textContent).not.toMatch(/CRC|₡/);
    await render("es");
    expect(container.querySelector(".budget-outside-objective")!.textContent).toContain("26,25");
    await click("Editar presupuesto");
    expect(field("Demo gift Pagado").value).toBe("26.25");
    await act(async () => { (field("Demo gift Fuera de objetivo") as HTMLInputElement).click(); });
    await click("← Panel");
    expect(container.querySelector(".budget-outside-objective b")!.textContent!.replace(/\D/g, "")).toBe("0");
    expect(container.querySelector(".budget-metrics strong")!.textContent!.replace(/\D/g, "")).toBe("55100");
  });

  it("uses canonical category scopes while showing Spanish chart and row labels", async () => {
    const scopeChanged = vi.fn();
    await render("es", { onRouteScopeChange: scopeChanged });
    const row = container.querySelector<HTMLButtonElement>(".budget-line-list button")!;
    await act(async () => { row.click(); });
    expect(scopeChanged).toHaveBeenCalledWith({ key: "chapter", label: "Structure" });
    expect(field("Concreto y refuerzo Objetivo")).toBeTruthy();
    expect(container.textContent).toContain("Estructura · hoja única");
  });

  it("does not translate matching real-world data when private users switch language", async () => {
    const line = { id: "demo-structure", row: 4, chapter: "Structure", item: "Concrete and reinforcement", type: "Construction", subcategory: "Foundation", supplier: "Constructora Demo", status: "Completada", objective: 100, quote: 100, paid: 0, excess: 0 };
    const summary = [{ label: "Structure", objective: 100, excess: 0, spent: 0, count: 1 }];
    const realBudget = { currency: "CRC", objective: 100, excess: 0, spent: 0, remaining: 100, percentUsed: 0, status: "within_objective", lines: [line], summaries: { chapter: summary, type: summary, subcategory: summary }, unsupported: [], editingAllowed: true, planVersion: 1, actualsRevision: 0 };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(realBudget)));
    vi.stubGlobal("fetch", fetchMock);
    await render("es", { mode: "real", canEdit: false });
    await vi.waitFor(() => expect(container.textContent).toContain("Concrete and reinforcement"));
    expect(container.textContent).toContain("Structure · Construction · Foundation");
    expect(container.textContent).not.toContain("Concreto y refuerzo");
    expect(container.textContent).toContain("PRESUPUESTO CONSOLIDADO · CRC");
    expect(container.querySelector(".budget-metrics strong")!.textContent).toContain("100");
    expect(container.querySelector(".budget-paid-amount")!.textContent).toMatch(/CRC|₡/);
    expect(container.textContent).not.toContain("USD");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await render("en", { mode: "real", canEdit: false });
    expect(container.textContent).toContain("Concrete and reinforcement");
    expect(container.textContent).toContain("Structure · Construction · Foundation");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
