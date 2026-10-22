import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { parseHouseModel, type BuildingFace, type DistributionRecord } from "@/lib/house-distribution";
import { buildDistributionExportFiles, buildDistributionExportZip, distributionExportFilename, DISTRIBUTION_EXPORT_IMAGE_MAX_BYTES, validateDistributionExportImage, type DistributionExportImage } from "@/lib/distribution-export";
import { buildDistributionPlanSvg } from "@/lib/distribution-export-plan";

// Actual 1 × 1 RGBA PNG, generated and decoded with sharp.
const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==", "base64"));

let record: DistributionRecord, temp: string;
beforeAll(() => {
  temp = mkdtempSync(join(tmpdir(), "distribution-export-"));
  const path = join(temp, "model.json");
  execFileSync(process.execPath, ["scripts/prepare-demo-house.mjs", path]);
  record = { model: parseHouseModel(JSON.parse(readFileSync(path, "utf8"))), revision: 3, updatedAt: "2026-10-04T01:35:48Z", roomCorrections: {}, fixtureCorrections: {} };
});

describe("support footprints in the exported plan", () => {
  function exposedFaces(id: string, x: number, y: number): BuildingFace[] {
    return [
      { id: `${id}-front-1`, kind: "wall", vertices: [[x, y, 0], [x + .5, y, 0], [x + .5, y, 3]] },
      { id: `${id}-left-1`, kind: "wall", vertices: [[x, y, 0], [x, y + .5, 0], [x, y + .5, 3]] },
      { id: `${id}-right-1`, kind: "wall", vertices: [[x + .5, y, 0], [x + .5, y + .5, 0], [x + .5, y + .5, 3]] },
    ];
  }

  it("includes invented support footprints without relying on a client model", () => {
    const model = structuredClone(record.model);
    model.envelope!.faces.push(...exposedFaces("demo-post-1", -.8, -.6));
    const svg = buildDistributionPlanSvg(model);
    expect(svg).toContain('data-support-id="demo-post-1"');
    expect(svg).toContain('<rect x="-0.8" y="-0.6" width="0.5" height="0.5"');
  });

  it("projects exposed synthetic faces once per support", () => {
    const model = structuredClone(record.model);
    model.envelope!.faces = [...exposedFaces("demo-post-1", 1, -1), ...exposedFaces("demo-post-2", 2, -1)];
    const svg = buildDistributionPlanSvg(model);
    expect(svg.match(/data-support-id=/g)).toHaveLength(2);
    expect(svg).toContain('data-support-id="demo-post-1"');
    expect(svg).toContain('data-support-id="demo-post-2"');
  });

  it("uses default wall faces, escapes inherited notes and IDs, and excludes roof and variant extents", () => {
    const model = structuredClone(record.model), unsafeId = 'entry&"-support-1';
    model.envelope!.faces = [...exposedFaces(unsafeId, 1, -2), ...exposedFaces("rear-post-2", 2, 1)];
    model.envelope!.faces.push({ id: "roof-column-9-face", kind: "roof", vertices: [[-100, -100, 3], [-99, -100, 3], [-99, -99, 3]] });
    model.envelope!.variants = [{ id: "alternative", label: { en: "Alternative", es: "Alternativa" }, source: model.envelope!.source, notes: "Alternativa", faces: exposedFaces("variant-column-1", -100, -100) }];
    model.envelope!.notes = '<script>alert("test")</script> & pendientes';
    const svg = buildDistributionPlanSvg(model);
    expect(svg.match(/data-support-id=/g)).toHaveLength(2);
    expect(svg).toContain('data-support-id="entry&amp;&quot;-support-1"');
    expect(svg).toContain('data-support-id="rear-post-2"');
    expect(svg).toContain("&lt;script&gt;alert(&quot;test&quot;)&lt;/script&gt; &amp; pendientes");
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain('data-support-id="roof-column-9"');
    expect(svg).not.toContain('data-support-id="variant-column-1"');
    expect(svg).toContain("Y -2.00 a");
    expect(svg).not.toContain("-100.00");
    delete model.envelope;
    expect(buildDistributionPlanSvg(model)).not.toContain("data-support-id=");
  });
});
afterAll(() => rmSync(temp, { recursive: true, force: true }));

describe("Codex interior design package", () => {
  it("keeps effective corrections, original geometry, excluded fixtures and separate revisions", () => {
    const corrected = structuredClone(record), [a, b] = corrected.model.fixtures;
    corrected.roomCorrections.office = { name: "Estudio ☀", height: { ...corrected.model.rooms.find(r => r.id === "office")!.height, value: 2.75, status: "approximate" } };
    corrected.fixtureCorrections[a.id] = { removed: true };
    corrected.fixtureCorrections[b.id] = { height: 1.1 };
    const before = JSON.stringify(corrected);
    const files = buildDistributionExportFiles(corrected, "2026-10-04T10:00:00Z");
    const model = parseHouseModel(JSON.parse(files["modelo.json"]));
    const original = JSON.parse(files["modelo-original.json"]);
    expect(model.rooms.find(r => r.id === "office")).toMatchObject({ name: "Estudio ☀", height: { value: 2.75, status: "approximate" } });
    expect(model.fixtures.some(f => f.id === a.id)).toBe(false);
    expect(model.fixtures.find(f => f.id === b.id)?.heightMeasurement).toMatchObject({ value: 1.1, status: "approximate" });
    expect(original.rooms.find((r: { id: string }) => r.id === "office").name).toBe("Office");
    expect(original.fixtures).toHaveLength(8);
    expect(JSON.parse(files["correcciones.json"]).fixtureCorrections[a.id].removed).toBe(true);
    expect(JSON.parse(files["manifest.json"])).toMatchObject({ modelRevision: 1, recordRevision: 3, exportedAt: "2026-10-04T10:00:00Z", counts: { rooms: 4, fixtures: 7 }, originalBlueprintsIncluded: false });
    expect(JSON.stringify(corrected)).toBe(before);
  });

  it("preserves synthetic variants, unknown measurements and source references", () => {
    const files = buildDistributionExportFiles(record);
    const model = JSON.parse(files["modelo.json"]);
    expect(model).toEqual(record.model);
    expect(model.envelope.variants).toEqual(record.model.envelope?.variants);
    expect(model.rooms.every((room: { height: { value: number | null } }) => room.height.value === null)).toBe(true);
    expect(JSON.parse(files["medidas.json"]).measurements.length).toBeGreaterThan(40);
    expect(JSON.parse(files["fuentes.json"]).sourceDocumentIds).toEqual(["synthetic-plan"]);
    expect(files["LEEME.md"]).toContain("null significa que no hay una altura confirmada");
    expect(files["LEEME.md"]).toContain("wall.height es una altura de representación");
    expect(files["planta.svg"]).toContain("Office");
  });

  it("creates a readable UTF-8 ZIP with every declared file and safe filename", async () => {
    const { bytes, filename } = await buildDistributionExportZip(record);
    const zip = await JSZip.loadAsync(bytes);
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(Object.keys(zip.files).sort()).toEqual(manifest.files.slice().sort());
    expect(parseHouseModel(JSON.parse(await zip.file("modelo.json")!.async("string")))).toEqual(record.model);
    expect(await zip.file("LEEME.md")!.async("string")).toContain("m²");
    expect(manifest.images).toEqual([]);
    expect(await zip.file("LEEME.md")!.async("string")).toContain("no incluye imágenes PNG");
    expect(filename).toBe("demo-pavilion-interiores-codex-r1.zip");
    expect(distributionExportFilename("../../ Cása : interiores ☀", 7)).toBe("casa-interiores-interiores-codex-r7.zip");
    expect(distributionExportFilename("☀", 1)).toBe("casa-interiores-codex-r1.zip");
  });

  it("includes PNG references byte for byte, captions and exact file declarations without replacing geometry", async () => {
    const images: DistributionExportImage[] = [
      { path: "imagenes/planta.png", bytes: png, note: "Planta de las correcciones guardadas; alturas pendientes." },
      { path: "imagenes/vista-3d.png", bytes: png, note: "Vista aérea aproximada, cubierta oculta." },
    ];
    const { bytes } = await buildDistributionExportZip(record, images);
    const zip = await JSZip.loadAsync(bytes);
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(Object.keys(zip.files).sort()).toEqual(manifest.files.slice().sort());
    expect(manifest.files).toHaveLength(11);
    expect(manifest.images).toEqual(images.map(image => ({ path: image.path, note: image.note, recordRevision: 3, evidence: "approximate", purpose: "Referencia visual; la geometría y la evidencia de medidas permanecen en modelo.json y medidas.json" })));
    for (const image of images) expect(await zip.file(image.path)!.async("uint8array")).toEqual(png);
    expect(JSON.parse(await zip.file("modelo.json")!.async("string"))).toEqual(record.model);
    const guide = await zip.file("LEEME.md")!.async("string");
    expect(guide).toContain("imagenes/planta.png");
    expect(guide).toContain("Vista aérea aproximada, cubierta oculta");
    expect(guide).toContain("modelo.json conserva toda la geometría guardada");
    expect(guide).not.toContain("no incluye imágenes PNG");
  });

  it("rejects extra or duplicate images, arbitrary paths, invalid PNG headers, oversized bytes and missing descriptions", async () => {
    const plan: DistributionExportImage = { path: "imagenes/planta.png", bytes: png, note: "Planta actual" };
    expect(() => validateDistributionExportImage(plan)).not.toThrow();
    expect(() => buildDistributionExportFiles(record, undefined, [plan, plan])).toThrow("distintas");
    expect(() => buildDistributionExportFiles(record, undefined, [plan, plan, plan])).toThrow("dos");
    await expect(buildDistributionExportZip(record, [{ ...plan, path: "../archivo.png" as DistributionExportImage["path"] }])).rejects.toThrow("Ruta");
    expect(() => validateDistributionExportImage({ ...plan, bytes: new Uint8Array([1, 2, 3]) })).toThrow("Tamaño");
    const corrupted = png.slice();
    corrupted[0] = 0;
    expect(() => validateDistributionExportImage({ ...plan, bytes: corrupted })).toThrow("PNG");
    const tooWide = png.slice();
    new DataView(tooWide.buffer).setUint32(16, 4097);
    expect(() => validateDistributionExportImage({ ...plan, bytes: tooWide })).toThrow("Dimensiones");
    const zeroHeight = png.slice();
    new DataView(zeroHeight.buffer).setUint32(20, 0);
    expect(() => validateDistributionExportImage({ ...plan, bytes: zeroHeight })).toThrow("Dimensiones");
    expect(() => validateDistributionExportImage({ ...plan, bytes: new Uint8Array(DISTRIBUTION_EXPORT_IMAGE_MAX_BYTES + 1) })).toThrow("Tamaño");
    expect(() => validateDistributionExportImage({ ...plan, note: "  " })).toThrow("descripción");
  });
});
