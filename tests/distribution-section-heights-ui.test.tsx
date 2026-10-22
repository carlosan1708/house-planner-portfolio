// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import DistributionWorkspace from "@/app/components/DistributionWorkspace";
import type { DistributionRecord, SourceReference } from "@/lib/house-distribution";

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/app/components/DistributionExport", () => ({ default: () => null }));

const source: SourceReference = { documentId: "plan", page: 3, sheet: "Planta" };
const cuts: SourceReference = { documentId: "cuts", page: 7, sheet: "Cortes A-A" };
let root: Root | null = null;
let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); root = null; vi.unstubAllGlobals(); document.body.innerHTML = ""; });

function record(): DistributionRecord {
  return {
    revision: 1, updatedAt: "2026-10-05T12:00:00Z", roomCorrections: {}, fixtureCorrections: {},
    model: { schemaVersion: 1, name: "Casa", revision: 1, sourceDocumentIds: ["plan", "cuts"], notes: "", walls: [], openings: [], fixtures: [],
      rooms: [{ id: "living", name: "Sala", polygon: [[0, 0], [4, 0], [4, 2], [0, 2]], color: "#abcdef", source,
        height: { value: null, status: "unconfirmed", source: cuts, note: "Cielo sin confirmar" },
        sectionHeight: {
          min: { value: 2.6, status: "approximate", source: cuts, note: "Mínimo interpolado" },
          max: { value: 3.2, status: "approximate", source: { ...cuts, page: 8, sheet: "Cortes B-B" }, note: "Máximo interpolado" },
        }, finishes: "CER", notes: "", coverage: { outlet: "unconfirmed", light: "unconfirmed", switch: "unconfirmed", ac: "unconfirmed" } }],
    },
  };
}

async function render(snapshot: DistributionRecord, canEdit = false) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      const body = JSON.parse(String(init.body));
      snapshot = { ...snapshot, revision: snapshot.revision + 1, roomCorrections: { [body.id]: body.correction } };
    }
    return new Response(JSON.stringify({ record: snapshot }));
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => { root!.render(createElement(DistributionWorkspace, { language: "es", canEdit })); });
  await act(async () => { container.querySelector<HTMLButtonElement>(".distribution-rooms button")!.click(); });
  return fetchMock;
}

describe("room height evidence in the workspace", () => {
  it("starts with installations and dimensions off, keeping technical controls in a closed disclosure", async () => {
    const fetchMock = await render(record());
    const technical = container.querySelector<HTMLDetailsElement>(".distribution-technical")!;
    expect(technical.open).toBe(false);
    expect(technical.querySelector("summary")!.textContent).toBe("Detalles técnicos");
    const layers = [...technical.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
    expect(layers).toHaveLength(5);
    expect(layers.every(input => !input.checked)).toBe(true);
    expect(container.querySelector<HTMLDetailsElement>(".distribution-room-installations")!.open).toBe(false);
    await act(async () => { technical.querySelector("summary")!.click(); });
    expect(technical.open).toBe(true);
    await act(async () => { layers[0].click(); });
    expect(layers[0].checked).toBe(true);
    expect(technical.querySelector("summary")!.textContent).toContain("1 capa visible");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector("input[name=height]")).toBeNull();
  });

  it("shows section range, evidence, source pages and notes separately from pending clear height", async () => {
    await render(record());
    const section = container.querySelector('section[aria-label="Altura bajo cubierta · cortes"]')!;
    expect(section.textContent).toContain("Mínima≈ 2.60 mAproximado");
    expect(section.textContent).toContain("Máxima≈ 3.20 mAproximado");
    expect(section.textContent).toContain("Mínimo interpolado");
    expect(section.textContent).toContain("Máximo interpolado");
    const notes = section.querySelector("details")!;
    expect(notes.open).toBe(false);
    expect(notes.querySelector("summary")!.textContent).toBe("Notas del corte");
    expect([...notes.querySelectorAll("p")].map(note => note.textContent)).toEqual(["Mínimo interpolado", "Máximo interpolado"]);
    expect(section.querySelector("dl")!.textContent).not.toContain("interpolado");
    expect([...section.querySelectorAll("a")].map(link => link.getAttribute("href"))).toEqual(["/api/files?id=cuts&preview=pdf#page=7", "/api/files?id=cuts&preview=pdf#page=8"]);
    expect(container.querySelector(".distribution-metrics")!.textContent).toContain("—Altura libre de cielo · Sin confirmar");
    expect(container.querySelector("input[name=height]")).toBeNull();
  });

  it("keeps a shared bilingual section note only once in the collapsed disclosure", async () => {
    const snapshot = record();
    const note = "Narrow traced strip X 2.529–2.70; finished carport pavement pending. / Franja trazada X 2,529–2,70; pavimento final de cochera pendiente.";
    snapshot.model.rooms[0].sectionHeight!.min.note = note;
    snapshot.model.rooms[0].sectionHeight!.max.note = note;
    await render(snapshot);
    const section = container.querySelector('section[aria-label="Altura bajo cubierta · cortes"]')!;
    const notes = section.querySelector("details")!;
    expect(notes.open).toBe(false);
    expect(notes.querySelectorAll("p")).toHaveLength(1);
    expect(notes.querySelector("p")!.textContent).toBe(note);
    await act(async () => { notes.querySelector("summary")!.click(); });
    expect(notes.open).toBe(true);
    expect(notes.querySelector("p")!.textContent).toBe(note);
  });

  it("keeps editor corrections to clear ceiling height separate from the section profile", async () => {
    const snapshot = record();
    const fetchMock = await render(snapshot, true);
    const heightInput = container.querySelector<HTMLInputElement>("input[name=height]")!;
    expect(heightInput.closest("label")!.textContent).toBe("Altura libre de cielo (m)");
    heightInput.value = "2.5";
    await act(async () => { heightInput.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    const body = JSON.parse(String(fetchMock.mock.calls.at(-1)![1]!.body));
    expect(body.correction.height).toMatchObject({ value: 2.5, status: "approximate" });
    expect(body.correction.sectionHeight).toBeUndefined();
    expect(container.querySelector('section[aria-label="Altura bajo cubierta · cortes"]')!.textContent).toContain("≈ 3.20 m");
  });

  it("accepts legacy rooms without rendering a section range", async () => {
    const snapshot = record();
    delete snapshot.model.rooms[0].sectionHeight;
    await render(snapshot);
    expect(container.querySelector('section[aria-label="Altura bajo cubierta · cortes"]')).toBeNull();
    expect(container.querySelector(".distribution-metrics")!.textContent).toContain("Altura libre de cielo · Sin confirmar");
  });
});
