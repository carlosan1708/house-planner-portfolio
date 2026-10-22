import { describe, expect, it } from "vitest";
import { buildDistributionMeasurements, distributionMeasurementsCsv, type ExportMeasurement } from "@/lib/distribution-export-measurements";
import { type HouseModel, type SourceReference } from "@/lib/house-distribution";

const source: SourceReference = { documentId: "blueprint", page: 3, sheet: "Planta" };
const section: SourceReference = { documentId: "blueprint", page: 7, sheet: "Cortes A-A" };
function house(): HouseModel {
  return {
    schemaVersion: 1, name: "Casa", revision: 6, sourceDocumentIds: ["blueprint"], notes: "Modelo con evidencia pendiente",
    rooms: [{ id: "living", name: "Sala", polygon: [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]], color: "#abcdef", source,
      height: { value: null, status: "unconfirmed", source: section, note: "Cielo sin cota libre" }, finishes: "CER", notes: "Zona incluye circulación",
      coverage: { outlet: "reviewed", light: "reviewed", switch: "partial", ac: "unconfirmed" } }],
    walls: [{ id: "front", start: [0, 0], end: [4, 0], thickness: .15, height: 3, source }],
    openings: [{ id: "entry", wallId: "front", roomIds: ["living"], kind: "door", offset: 1, width: .9, height: 2.1, sill: 0, source, status: "approximate", notes: "Ancho pendiente", references: [section] }],
    fixtures: [
      { id: "light", roomId: "living", kind: "light", type: "Lámpara", position: [.3, 1.1], height: 2.7, status: "documented", source, circuit: "TP-1", specifications: "Altura pendiente", mount: "ceiling",
        heightMeasurement: { value: null, status: "unconfirmed", source: section, note: "Sin medida de montaje" } },
      { id: "outlet", roomId: "living", kind: "outlet", type: "Toma", position: [.4, .2], height: .3, status: "documented", source, circuit: "TP-2", specifications: "Toma general",
        heightMeasurement: { value: .3, status: "documented", source: { ...source, page: 21 }, note: "Cota en simbología" } },
      { id: "legacy", roomId: "living", kind: "switch", type: "Apagador", position: [1, .2], height: 1.2, status: "unconfirmed", source, circuit: "", specifications: "Sin heightMeasurement" },
    ],
    surfaces: [{ id: "roof", kind: "roof", polygon: [[0, 0], [4, 0], [4, 2], [0, 2]], source, notes: "Excluye cochera", measurements: [
      { label: { en: "Slope", es: "Pendiente" }, value: 16, status: "documented", source, unit: "%", note: "Dos aguas" },
      { label: { en: "Unknown", es: "Medida pendiente" }, value: null, status: "unconfirmed", source: section, unit: "m", note: "No capturada" },
    ] }],
    envelope: { source: section, status: "approximate", notes: "Apoyos ilustrativos", faces: [
      { id: "roof", kind: "roof", vertices: [[0, 0, 3], [4, 0, 4], [0, 2, 3]] },
      { id: "carport-column-1-face-0-1", kind: "wall", vertices: [[-3, 0, 0], [-2.5, 0, 0], [-2.5, 0, 2.5]] },
      { id: "carport-column-1-face-1-1", kind: "wall", vertices: [[-2.5, 0, 0], [-2.5, .5, 0], [-2.5, .5, 2.6]] },
    ], levels: [{ label: { en: "Terrain", es: "Terreno" }, value: -.25, status: "documented", source: section, note: "Referencia" }],
      variants: [{ id: "earlier-roof", label: { en: "Earlier", es: "Anterior" }, source, notes: "Perfil alternativo", faces: [
        { id: "roof", kind: "roof", vertices: [[0, 0, 3], [4, 0, 3], [0, 2, 3]] },
      ] }] },
    areaSchedule: { source, statedTotal: 10, entries: [{ label: "Sala", roomIds: ["living"], area: 8 }], notes: "Total y renglones difieren" },
  };
}

function find(rows: ExportMeasurement[], entityId: string, measurement: string) {
  return rows.find(row => row.entityId === entityId && row.measurement === measurement)!;
}

describe("distribution measurement catalogue", () => {
  it("computes a concave zone from its polygon and identifies bounding dimensions as extents", () => {
    const model = house();
    const original = JSON.stringify(model);
    const rows = buildDistributionMeasurements(model);
    expect(find(rows, "living", "polygonArea")).toMatchObject({ value: 7, unit: "m²", status: "calculated", page: 3 });
    expect(find(rows, "living", "polygonPerimeter").value).toBe(16);
    expect(find(rows, "living", "polygonWidth")).toMatchObject({ value: 4, label: "Extensión del polígono en X" });
    expect(find(rows, "living", "polygonDepth").value).toBe(4);
    expect(rows.filter(row => row.entityId === "living" && row.measurement.startsWith("polygonEdge."))).toHaveLength(6);
    expect(find(rows, "living", "polygonArea").notes).toContain("no acreditan medidas interiores libres");
    expect(JSON.stringify(model)).toBe(original);
  });

  it("retains unknown room heights while marking wall dimensions as visual", () => {
    const rows = buildDistributionMeasurements(house());
    expect(find(rows, "living", "clearHeight")).toMatchObject({ value: null, status: "unconfirmed", page: 7, sheet: "Cortes A-A" });
    expect(find(rows, "living", "clearHeight").notes).toContain("Cielo sin cota libre");
    expect(find(rows, "front", "axisLength")).toMatchObject({ value: 4, status: "calculated" });
    expect(find(rows, "front", "displayThickness")).toMatchObject({ value: .15, status: "unconfirmed" });
    expect(find(rows, "front", "displayHeight")).toMatchObject({ value: 3, status: "unconfirmed" });
  });

  it("separates fixture visual height from evidence even for documented fixture symbols", () => {
    const rows = buildDistributionMeasurements(house());
    expect(find(rows, "light", "displayHeight")).toMatchObject({ value: 2.7, status: "unconfirmed", page: 3 });
    expect(find(rows, "light", "heightMeasurement")).toMatchObject({ value: null, status: "unconfirmed", page: 7 });
    expect(find(rows, "outlet", "displayHeight")).toMatchObject({ value: .3, status: "unconfirmed" });
    expect(find(rows, "outlet", "heightMeasurement")).toMatchObject({ value: .3, status: "documented", page: 21 });
    expect(find(rows, "legacy", "heightMeasurement")).toMatchObject({ value: null, status: "unconfirmed" });
    expect(find(rows, "light", "positionX")).toMatchObject({ value: .3, status: "approximate" });
    expect(find(rows, "light", "positionY").notes).toContain("TP-1");
  });

  it("preserves opening dimensions, statuses, conflicts and additional page references", () => {
    const rows = buildDistributionMeasurements(house());
    for (const [measurement, value] of [["width", .9], ["height", 2.1], ["sill", 0], ["offset", 1]] as const) {
      expect(find(rows, "entry", measurement)).toMatchObject({ value, status: "approximate", documentId: "blueprint", page: 3 });
      expect(find(rows, "entry", measurement).notes).toContain("Ancho pendiente");
      expect(find(rows, "entry", measurement).notes).toContain("página 7, Cortes A-A");
    }
  });

  it("keeps roof quantities, reference levels, alternatives and illustrative supports distinct", () => {
    const rows = buildDistributionMeasurements(house());
    expect(find(rows, "roof", "polygonArea")).toMatchObject({ value: 8, status: "calculated" });
    expect(find(rows, "roof", "measurement.1")).toMatchObject({ value: 16, unit: "%", status: "documented", label: "Pendiente" });
    expect(find(rows, "roof", "measurement.2")).toMatchObject({ value: null, status: "unconfirmed", page: 7 });
    expect(find(rows, "roof", "polygonArea").notes).toContain("Excluye cochera");
    expect(find(rows, "default", "level.1")).toMatchObject({ value: -.25, status: "documented", page: 7 });
    expect(find(rows, "default:roof", "triangleArea").value).toBeCloseTo(Math.sqrt(17));
    expect(find(rows, "variant:earlier-roof:roof", "triangleArea").value).toBe(4);
    expect(find(rows, "default:carport-column-1", "displayWidth")).toMatchObject({ entityType: "support", value: .5, status: "approximate" });
    expect(find(rows, "default:carport-column-1", "displayDepth").value).toBe(.5);
    expect(find(rows, "default:carport-column-1", "displayHeight").value).toBe(2.6);
    expect(find(rows, "default:carport-column-1", "displayHeight").notes).toContain("no acredita sección estructural");
    expect(find(rows, "earlier-roof", "displayHeight").notes).toContain("no combinar ni sumar");
  });

  it("retains differing stated area totals rather than substituting zone areas or entry sums", () => {
    const rows = buildDistributionMeasurements(house());
    expect(find(rows, "entry.1", "statedArea")).toMatchObject({ value: 8, status: "documented", unit: "m²" });
    expect(find(rows, "total", "statedTotal")).toMatchObject({ value: 10, status: "documented" });
    expect(find(rows, "entry-sum", "entrySum")).toMatchObject({ value: 8, status: "calculated" });
    expect(find(rows, "total", "statedTotal").notes).toContain("Total y renglones difieren");
  });
});

describe("measurement CSV", () => {
  it("keeps numeric values, unknown blanks, evidence and Unicode while escaping CSV text", () => {
    const row: ExportMeasurement = { entityType: "room", entityId: "living", entityName: 'Sala, "principal"', measurement: "clearHeight", label: "Área / altura", value: null, unit: "m²", status: "unconfirmed", documentId: "blueprint", page: 7, sheet: "Cortes", notes: "Primera línea\nSegunda línea" };
    const csv = distributionMeasurementsCsv([row, { ...row, value: -.25, status: "documented" }]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"Sala, ""principal"""');
    expect(csv).toContain('"clearHeight","Área / altura",,"m²","unconfirmed"');
    expect(csv).toContain('"clearHeight","Área / altura",-0.25,"m²","documented"');
    expect(csv).toContain('"blueprint",7,"Cortes"');
    expect(csv).toContain('"Primera línea\nSegunda línea"');
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it.each(["=1+1", "+SUM(A1)", "-2+2", "@cmd", "  =HYPERLINK(\"x\")", "\t=1+1", "\r=1+1", "\n=1+1"])("neutralizes text formula %j without changing numeric measurements", (payload) => {
    const row = buildDistributionMeasurements(house())[0];
    const csv = distributionMeasurementsCsv([{ ...row, entityName: payload, notes: payload, value: -3.13 }]);
    expect(csv).toContain(`"'${payload.replaceAll('"', '""')}"`);
    expect(csv).toContain(",-3.13,");
  });
});
