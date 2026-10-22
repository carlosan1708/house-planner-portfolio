// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DistributionWorkspace from "@/app/components/DistributionWorkspace";
import { createDemoDistributionRecord, DEMO_DISTRIBUTION_DOCUMENT_ID } from "@/lib/demo-distribution";
import { modelSources, parseHouseModel, polygonMetrics } from "@/lib/house-distribution";

vi.mock("next/dynamic", () => ({ default: () => () => createElement("div", { "data-testid": "distribution-viewer" }) }));

let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ record: createDemoDistributionRecord() })));
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

async function render(mode: "demo" | "real" = "demo", canEdit = true) {
  await act(async () => { root.render(createElement(DistributionWorkspace, { language: "en", canEdit, mode })); });
}

async function click(label: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.startsWith(label));
  expect(button, `Missing button: ${label}`).toBeDefined();
  await act(async () => button!.click());
}

describe("fictional distribution preview", () => {
  it("uses a valid independent 120 m² model that matches the public technical profile", () => {
    const record = createDemoDistributionRecord();
    const model = parseHouseModel(record.model);
    expect(model.rooms).toHaveLength(8);
    expect(model.rooms.reduce((sum, room) => sum + polygonMetrics(room.polygon).area, 0)).toBe(120);
    expect(model.rooms.find(room => room.id === "demo-living")?.polygon).toEqual([[0, 0], [6, 0], [6, 5], [0, 5]]);
    expect(model.rooms.filter(room => ["demo-bedroom", "demo-primary"].includes(room.id)).map(room => polygonMetrics(room.polygon).area)).toEqual([18, 18]);
    expect(modelSources(model).every(source => source.documentId === DEMO_DISTRIBUTION_DOCUMENT_ID)).toBe(true);
    expect(model.fixtures.some(fixture => fixture.kind === "ac")).toBe(true);
    expect(model.surfaces?.map(surface => surface.kind)).toEqual(["roof", "property"]);
    expect(model.envelope?.faces.some(face => face.kind === "roof")).toBe(true);
    record.model.rooms[0].name = "Changed";
    expect(createDemoDistributionRecord().model.rooms[0].name).toBe("Living & dining");
    expect(createDemoDistributionRecord("es").model.rooms[0].name).toBe("Sala y comedor");
  });

  it("allows local corrections and restoring the sample without authenticated API requests or source links", async () => {
    await render();
    expect(container.textContent).toContain("FICTIONAL HOUSE MODEL");
    expect(container.querySelectorAll(".distribution-rooms button")).toHaveLength(8);
    await click("Living & dining");
    expect(container.textContent).toContain("30.00 m²");
    const form = container.querySelector<HTMLFormElement>(".distribution-form")!;
    const name = form.querySelector<HTMLInputElement>('[name="name"]')!;
    name.value = "Evening lounge";
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(container.querySelector(".distribution-details h3")?.textContent).toBe("Evening lounge");
    expect(container.textContent).toContain("Original plan data");
    await click("Restore plan data");
    expect(container.querySelector(".distribution-details h3")?.textContent).toBe("Living & dining");
    await click("Roof");
    expect(container.textContent).toContain("Roof measurements");
    await click("Entire property");
    expect(container.textContent).toContain("336.00 m²");
    expect(container.querySelector('a[href*="/api/"]')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps viewers read only and retains real-mode loading by default", async () => {
    await render("demo", false);
    await click("Living & dining");
    expect(container.querySelector("form")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(createElement(DistributionWorkspace, { language: "en", canEdit: false })));
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/house-distribution", { cache: "no-store" });
  });
});
