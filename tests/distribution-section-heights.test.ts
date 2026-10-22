import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { effectiveModel, modelSources, parseHouseModel, type DistributionRecord, type HouseModel, type Measurement, type SourceReference } from "@/lib/house-distribution";
import { buildDistributionExportFiles, buildDistributionExportZip } from "@/lib/distribution-export";
import { buildDistributionMeasurements } from "@/lib/distribution-export-measurements";

const plan: SourceReference = { documentId: "plan", page: 3, sheet: "Planta" };
const section: SourceReference = { documentId: "cuts", page: 7, sheet: "Cortes A-A" };
const measure = (value: number, source = section): Measurement => ({ value, status: "approximate", source, note: "Interpolado de cara inferior dibujada; verificar cielo en obra." });

function house(): HouseModel {
  const model: HouseModel = {
    schemaVersion: 1, name: "Casa", revision: 1, sourceDocumentIds: ["plan", "cuts"], notes: "Cubierta trazada",
    rooms: [{ id: "living", name: "Sala", polygon: [[0, 0], [4, 0], [4, 2], [0, 2]], color: "#abcdef", source: plan,
      height: { value: null, status: "unconfirmed", note: "Altura libre del cielo sin cota", source: section },
      sectionHeight: { min: measure(2.6), max: measure(3.2, { ...section, page: 8, sheet: "Cortes B-B" }) },
      finishes: "CER", notes: "Zona trazada", coverage: { outlet: "unconfirmed", light: "unconfirmed", switch: "unconfirmed", ac: "unconfirmed" } }],
    walls: [], openings: [], fixtures: [],
    envelope: { source: section, status: "approximate", notes: "No acredita cielo de gypsum", levels: [],
      faces: [{ id: "outer", kind: "roof", vertices: [[0, 0, 3], [4, 0, 3.6], [0, 2, 3]] }],
      roofUnderside: [{ id: "inner", kind: "roof", vertices: [[0, 0, 2.6], [4, 0, 3.2], [0, 2, 2.6]] }],
    },
  };
  return structuredClone(model);
}

const record = (model = house()): DistributionRecord => ({ model, revision: 2, updatedAt: "2026-10-05T12:00:00Z", roomCorrections: {}, fixtureCorrections: {} });

describe("section-derived room heights", () => {
  it("retains complete profiles and source geometry through JSON parsing while accepting legacy models", () => {
    const original = house();
    expect(parseHouseModel(JSON.parse(JSON.stringify(original)))).toEqual(original);
    const legacy = house();
    delete legacy.rooms[0].sectionHeight;
    delete legacy.envelope!.roofUnderside;
    expect(parseHouseModel(legacy)).toEqual(legacy);
  });

  it.each([
    { min: measure(3.2), max: measure(2.6) },
    { min: { ...measure(2.6), value: null }, max: measure(3.2) },
    { min: measure(2.6), max: { ...measure(3.2), value: null } },
    { min: measure(2.6), max: measure(30.1) },
    { min: measure(-.1), max: measure(3.2) },
    { min: measure(2.6), max: measure(Infinity) },
    { min: measure(2.6), max: measure(NaN) },
    { min: measure(2.6) },
  ])("rejects partial, reversed or invalid profiles %#", profile => {
    const model = house();
    expect(() => parseHouseModel({ ...model, rooms: [{ ...model.rooms[0], sectionHeight: profile }] })).toThrow();
  });

  it.each(["min", "max"] as const)("checks the %s profile source against authorized documents", bound => {
    const model = house();
    model.rooms[0].sectionHeight![bound].source = { ...section, documentId: "private-other" };
    expect(() => parseHouseModel(model)).toThrow("Unknown source document");
  });

  it("includes both profile sources when remapping a model to its authorized source documents", () => {
    const model = house();
    const sources = modelSources(model);
    expect(sources).toContain(model.rooms[0].sectionHeight!.min.source);
    expect(sources).toContain(model.rooms[0].sectionHeight!.max.source);
    model.sourceDocumentIds = ["current-plan"];
    sources.forEach(source => { source.documentId = "current-plan"; });
    expect(modelSources(parseHouseModel(model)).every(source => source.documentId === "current-plan")).toBe(true);
  });

  it("rejects invalid underside geometry and face kinds", () => {
    const model = house(), envelope = model.envelope!, face = envelope.roofUnderside![0];
    for (const roofUnderside of [[], [face, face], [{ ...face, kind: "wall" }], [{ ...face, vertices: [[0, 0, 0], [1, 1, 1], [2, 2, 2]] }]]) {
      expect(() => parseHouseModel({ ...model, envelope: { ...envelope, roofUnderside } })).toThrow();
    }
  });

  it("exports separate range measurements with evidence while leaving clear ceiling height unknown", () => {
    const rows = buildDistributionMeasurements(house());
    const min = rows.find(row => row.entityId === "living" && row.measurement === "minSectionHeight")!;
    const max = rows.find(row => row.entityId === "living" && row.measurement === "maxSectionHeight")!;
    expect(min).toMatchObject({ value: 2.6, status: "approximate", documentId: "cuts", page: 7, sheet: "Cortes A-A", label: "Altura mínima bajo cubierta · cortes" });
    expect(max).toMatchObject({ value: 3.2, status: "approximate", documentId: "cuts", page: 8, sheet: "Cortes B-B", label: "Altura máxima bajo cubierta · cortes" });
    expect(min.notes).toContain("No acredita altura libre de cielo raso");
    expect(min.notes).toContain("Interpolado de cara inferior");
    expect(rows.find(row => row.entityId === "living" && row.measurement === "clearHeight")).toMatchObject({ value: null, status: "unconfirmed" });
    expect(rows.find(row => row.entityId === "roofUnderside:inner" && row.measurement === "displayMinElevation")).toMatchObject({ value: 2.6, status: "approximate", documentId: "cuts", page: 7 });
    expect(rows.find(row => row.entityId === "default:outer" && row.measurement === "displayMinElevation")?.value).toBe(3);
  });

  it("preserves section profiles when editors correct clear height and when the ZIP is imported again", async () => {
    const snapshot = record();
    snapshot.roomCorrections.living = { height: { value: 2.5, status: "approximate", source: section, note: "Altura corregida; verificar en obra" }, name: "Sala corregida" };
    const effective = effectiveModel(snapshot);
    expect(effective.rooms[0].sectionHeight).toEqual(snapshot.model.rooms[0].sectionHeight);
    const files = buildDistributionExportFiles(snapshot);
    expect(files["LEEME.md"]).toContain("Este rango no acredita altura libre de cielo raso");
    expect(files["LEEME.md"]).toContain("modelo.envelope.roofUnderside");
    expect(files["medidas.csv"]).toContain("minSectionHeight");
    expect(JSON.parse(files["fuentes.json"]).references).toContainEqual({ documentId: "cuts", page: 8, sheet: "Cortes B-B" });
    const zip = await JSZip.loadAsync((await buildDistributionExportZip(snapshot)).bytes);
    expect(parseHouseModel(JSON.parse(await zip.file("modelo.json")!.async("string")))).toEqual(effective);
    expect(parseHouseModel(JSON.parse(await zip.file("modelo-original.json")!.async("string")))).toEqual(snapshot.model);
    expect(JSON.parse(await zip.file("modelo.json")!.async("string")).envelope.roofUnderside).toEqual(snapshot.model.envelope!.roofUnderside);
  });
});
