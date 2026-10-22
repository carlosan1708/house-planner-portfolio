// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DistributionWorkspace from "@/app/components/DistributionWorkspace";
import type { HouseModel } from "@/lib/house-distribution";
import type { Selection } from "@/app/components/DistributionViewer";
import type { FurnitureItem, FurnitureZone } from "@/lib/furniture-layout";

vi.mock("next/dynamic", () => ({ default: () => ({ model, selection, furnitureItems = [], furnitureZones = [] }: { model: HouseModel; selection: Selection | null; furnitureItems?: FurnitureItem[]; furnitureZones?: FurnitureZone[] }) => createElement("div", {
  "data-testid": "distribution-viewer",
  "data-room-name": model.rooms[0].name,
  "data-selection": selection?.kind || "",
  "data-furniture-count": furnitureItems.length,
  "data-zone-count": furnitureZones.length,
}) }));

let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function ControlledViews({ language = "en" }: { language?: "en" | "es" }) {
  const [view, setView] = useState<"distribution" | "furniture">("distribution");
  return createElement(DistributionWorkspace, { language, canEdit: true, mode: "demo", furnitureView: view === "furniture", onViewChange: setView });
}

function tab(name: string) {
  const result = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button => button.textContent === name);
  expect(result).toBeDefined();
  return result!;
}

async function click(button: HTMLButtonElement) {
  await act(async () => button.click());
}

async function press(button: HTMLButtonElement, key: string) {
  await act(async () => button.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
}

describe("Distribution and Furniture views", () => {
  it("preserves edited model data across internal tabs and clears furniture-only details", async () => {
    await act(async () => root.render(createElement(ControlledViews)));
    expect(container.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBe("3D views");
    expect(tab("Distribution").getAttribute("aria-selected")).toBe("true");
    const viewer = () => container.querySelector<HTMLElement>('[data-testid="distribution-viewer"]')!;
    expect(viewer().dataset.furnitureCount).toBe("0");
    expect(viewer().dataset.zoneCount).toBe("0");

    await click(container.querySelector<HTMLButtonElement>(".distribution-rooms button")!);
    const form = container.querySelector<HTMLFormElement>(".distribution-form")!;
    form.querySelector<HTMLInputElement>('[name="name"]')!.value = "Evening lounge";
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await click(tab("Furniture"));
    expect(viewer().dataset.roomName).toBe("Evening lounge");
    expect(Number(viewer().dataset.furnitureCount)).toBeGreaterThan(0);
    expect(viewer().dataset.zoneCount).toBe("1");
    await click(container.querySelector<HTMLButtonElement>(".furniture-item-grid button")!);
    expect(container.querySelector(".furniture-selected")).not.toBeNull();
    await click(tab("Distribution"));
    expect(container.querySelector(".furniture-selected")).toBeNull();
    expect(container.querySelector(".furniture-inventory")).toBeNull();
    expect(viewer().dataset.selection).toBe("");
    expect(viewer().dataset.roomName).toBe("Evening lounge");
    expect(viewer().dataset.furnitureCount).toBe("0");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the released Spanish labels and keyboard navigation with one linked panel", async () => {
    await act(async () => root.render(createElement(ControlledViews, { language: "es" })));
    expect(container.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBe("Vistas 3D");
    const distribution = tab("Distribución"), furniture = tab("Mobiliario");
    distribution.focus();
    await press(distribution, "ArrowRight");
    expect(document.activeElement).toBe(furniture);
    expect(furniture.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector('.furniture-item-grid button[data-furniture-id*="demo-terrace"]')?.textContent).toContain("Terraza al jardín");
    expect(furniture.tabIndex).toBe(0);
    expect(distribution.tabIndex).toBe(-1);
    const panel = container.querySelector('[role="tabpanel"]')!;
    expect(panel.id).toBe(furniture.getAttribute("aria-controls"));
    expect(panel.getAttribute("aria-labelledby")).toBe(furniture.id);
    await press(furniture, "Home");
    expect(document.activeElement).toBe(distribution);
    expect(distribution.getAttribute("aria-selected")).toBe("true");
    await press(distribution, "End");
    expect(document.activeElement).toBe(furniture);
    await press(furniture, "ArrowLeft");
    expect(document.activeElement).toBe(distribution);
  });

  it("suppresses furniture and terrace details after an external route change", async () => {
    const render = async (furnitureView: boolean) => act(async () => root.render(createElement(DistributionWorkspace, { language: "en", canEdit: false, mode: "demo", furnitureView, onViewChange: vi.fn() })));
    await render(true);
    const outdoorPiece = () => container.querySelector<HTMLButtonElement>('.furniture-item-grid button[data-furniture-id*="demo-terrace"]')!;
    expect(outdoorPiece().textContent).toContain("Garden terrace");
    await click(outdoorPiece());
    await render(false);
    expect(container.querySelector(".furniture-selected")).toBeNull();
    expect(container.querySelector('[data-testid="distribution-viewer"]')?.getAttribute("data-selection")).toBe("");
    await render(true);
    await click(outdoorPiece());
    const inspect = [...container.querySelectorAll<HTMLButtonElement>(".furniture-selected button")].find(button => button.textContent?.startsWith("Inspect this space"))!;
    expect(inspect).toBeDefined();
    await click(inspect);
    expect(container.querySelector(".furniture-zone-details")?.textContent).toContain("Garden terrace");
    expect(container.querySelectorAll(".furniture-item-grid button")).toHaveLength(12);
    await render(false);
    expect(container.querySelector(".furniture-zone-details")).toBeNull();
    expect(container.querySelector('[data-testid="distribution-viewer"]')?.getAttribute("data-selection")).toBe("");
  });
});
