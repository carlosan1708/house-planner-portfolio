import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHouseModel, type DistributionRecord } from "@/lib/house-distribution";
import { createDistributionExportImages } from "@/lib/distribution-export-images";

const base64Png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==";
const png = new Uint8Array(Buffer.from(base64Png, "base64"));
let record: DistributionRecord, temp: string;
beforeAll(() => {
  temp = mkdtempSync(join(tmpdir(), "distribution-export-images-"));
  const path = join(temp, "model.json");
  execFileSync(process.execPath, ["scripts/prepare-demo-house.mjs", path]);
  record = { model: parseHouseModel(JSON.parse(readFileSync(path, "utf8"))), revision: 3, updatedAt: "2026-10-04T01:35:48Z", roomCorrections: {}, fixtureCorrections: {} };
});
afterAll(() => rmSync(temp, { recursive: true, force: true }));
afterEach(() => vi.unstubAllGlobals());

function mockRasterizer(options: { loadError?: boolean; noContext?: boolean; noBlob?: boolean; width?: number; height?: number } = {}) {
  const blobs: Blob[] = [];
  const createObjectURL = vi.fn((blob: Blob) => { blobs.push(blob); return "blob:plan-export-test"; });
  const revokeObjectURL = vi.fn();
  const drawImage = vi.fn();
  const canvas = {
    width: 0, height: 0,
    getContext: vi.fn(() => options.noContext ? null : { drawImage }),
    toBlob: vi.fn((callback: (blob: Blob | null) => void, format: string) => {
      expect(format).toBe("image/png");
      callback(options.noBlob ? null : new Blob([png], { type: "image/png" }));
    }),
  };
  class MockImage {
    naturalWidth = options.width ?? 1200;
    naturalHeight = options.height ?? 2500;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(value: string) {
      expect(value).toBe("blob:plan-export-test");
      queueMicrotask(() => options.loadError ? this.onerror?.() : this.onload?.());
    }
  }
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  vi.stubGlobal("Image", MockImage);
  vi.stubGlobal("document", { createElement: vi.fn((name: string) => { expect(name).toBe("canvas"); return canvas; }) });
  return { blobs, createObjectURL, revokeObjectURL, canvas, drawImage };
}

describe("browser-only distribution image references", () => {
  it("imports without DOM access and reports browser generation when called in Node", async () => {
    await expect(createDistributionExportImages(record)).rejects.toThrow("navegador");
  });

  it("regenerates the plan from effective corrections, scales proportionally and releases its object URL", async () => {
    const mocks = mockRasterizer({ height: 10000 });
    const corrected = structuredClone(record);
    corrected.roomCorrections.office = { name: "Oficina actualizada" };
    const before = JSON.stringify(corrected);
    const images = await createDistributionExportImages(corrected);
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ path: "imagenes/planta.png", bytes: png });
    expect(images[0].note).toContain("registro 3");
    expect(await mocks.blobs[0].text()).toContain("Oficina actualizada");
    expect(mocks.blobs[0].type).toBe("image/svg+xml;charset=utf-8");
    expect(mocks.canvas.width).toBe(491);
    expect(mocks.canvas.height).toBe(4096);
    expect(mocks.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 491, 4096);
    expect(mocks.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:plan-export-test");
    expect(JSON.stringify(corrected)).toBe(before);
  });

  it("includes a valid scene for the current storage revision and describes camera limitations", async () => {
    mockRasterizer();
    const images = await createDistributionExportImages(record, { dataUrl: `data:image/png;base64,${base64Png}`, recordRevision: 3, view: "Vista aérea, cubierta oculta" });
    expect(images).toHaveLength(2);
    expect(images[1]).toMatchObject({ path: "imagenes/vista-3d.png", bytes: png });
    expect(images[1].note).toContain("Vista aérea, cubierta oculta");
    expect(images[1].note).toContain("alturas pendientes no quedan confirmadas");
  });

  it.each([
    { dataUrl: `data:image/png;base64,${base64Png}`, recordRevision: 2, view: "Anterior" },
    { dataUrl: `data:image/png;base64,${base64Png}`, recordRevision: 7, view: "Revisión del modelo, no del registro" },
    { dataUrl: "data:image/svg+xml;base64,PHN2Zy8+", recordRevision: 3, view: "SVG" },
    { dataUrl: "data:image/png;base64,not_png=", recordRevision: 3, view: "Inválida" },
    { dataUrl: "data:image/png;base64,AAAA", recordRevision: 3, view: "Firma inválida" },
  ])("keeps the fresh plan when a scene is stale or invalid: $view", async scene => {
    const mocks = mockRasterizer();
    const images = await createDistributionExportImages(record, scene);
    expect(images.map(image => image.path)).toEqual(["imagenes/planta.png"]);
    expect(mocks.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it.each([
    { loadError: true },
    { noContext: true },
    { noBlob: true },
    { width: 0 },
  ])("releases the SVG URL if rasterization fails: %j", async options => {
    const mocks = mockRasterizer(options);
    await expect(createDistributionExportImages(record)).rejects.toThrow();
    expect(mocks.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:plan-export-test");
  });
});
