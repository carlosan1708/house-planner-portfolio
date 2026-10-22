import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createDemoDistributionRecord } from "@/lib/demo-distribution";
import { demoExteriorFurniture, demoExteriorGeometry } from "@/lib/demo-exterior";
import { parseHouseModel, polygonMetrics, type BuildingFace } from "@/lib/house-distribution";

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

function bounds(vertices: number[][]) {
  return [0, 1, 2].map(axis => [Math.min(...vertices.map(vertex => vertex[axis])), Math.max(...vertices.map(vertex => vertex[axis]))]);
}

function closedEdges(faces: BuildingFace[]) {
  const edges = new Map<string, number>();
  for (const { vertices: [a, b, c] } of faces) {
    for (const [start, end] of [[a, b], [b, c], [c, a]]) {
      const key = [start.join(","), end.join(",")].sort().join("|");
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  return [...edges.values()].every(count => count === 2);
}

describe("model-derived demo exterior", () => {
  it.each(["en", "es"] as const)("models the terrace, pergola and garden door without changing the enclosed house (%s)", language => {
    const model = parseHouseModel(createDemoDistributionRecord(language).model);
    expect(model.rooms).toHaveLength(8);
    expect(model.rooms.reduce((area, room) => area + polygonMetrics(room.polygon).area, 0)).toBe(120);
    expect(bounds(model.rooms.flatMap(room => room.polygon.map(([x, y]) => [x, y, 0]))).slice(0, 2)).toEqual([[0, 12], [0, 10]]);
    expect(model.surfaces?.find(surface => surface.kind === "property")?.polygon).toEqual([[-2, -4], [14, -4], [14, 17], [-2, 17]]);
    expect(model.openings.find(opening => opening.id === "demo-living-garden-door")).toMatchObject({
      kind: "door", wallId: "front", roomIds: ["demo-living"], offset: .7, width: 4.2, height: 2.35, sill: 0, glazed: true,
    });
    expect(demoExteriorGeometry(model).openings.find(opening => opening.id === "demo-living-garden-door")).toMatchObject({ glazed: true });

    const faces = model.envelope!.faces;
    expect(faces.length).toBeLessThanOrEqual(500);
    const roofs = faces.filter(face => face.id.startsWith("demo-roof-"));
    expect(roofs).toHaveLength(4);
    expect(bounds(roofs.flatMap(face => face.vertices))).toEqual([[-.4, 12.4], [-.4, 10.4], [2.9, 4.1]]);
    const pergola = faces.filter(face => face.id.startsWith("demo-pergola-"));
    expect(bounds(pergola.flatMap(face => face.vertices))).toEqual([[0, 8.9], [-3.05, 0], [-.06, 2.85]]);
    const terrace = faces.filter(face => face.id.startsWith("demo-terrace-"));
    expect(bounds(terrace.flatMap(face => face.vertices))).toEqual([[0, 8.9], [-3.25, 0], [-.18, -.06]]);

    const components = new Map<string, BuildingFace[]>();
    for (const face of [...pergola, ...terrace]) {
      const component = face.id.match(/^(demo-pergola-(?:post-\d+|beam-(?:front|back)|rafter-\d+)|demo-terrace)-/)?.[1];
      expect(component, `Unidentified architectural component: ${face.id}`).toBeDefined();
      components.set(component!, [...(components.get(component!) || []), face]);
    }
    expect([...components.keys()].filter(id => id.startsWith("demo-pergola-post-"))).toHaveLength(2);
    expect([...components.keys()].filter(id => id.startsWith("demo-pergola-beam-"))).toHaveLength(2);
    expect([...components.keys()].filter(id => id.startsWith("demo-pergola-rafter-"))).toHaveLength(6);
    expect(components.has("demo-terrace")).toBe(true);
    for (const [id, componentFaces] of components) expect(closedEdges(componentFaces), `${id} must remain closed when viewed from below`).toBe(true);
  });

  it("validates the optional glazing flag while accepting models without it", () => {
    const model = createDemoDistributionRecord().model;
    const openings = model.openings.map(opening => opening.id === "demo-living-garden-door" ? { ...opening, glazed: "true" } : opening);
    expect(() => parseHouseModel({ ...model, openings })).toThrow("Invalid opening glazing");
    const door = model.openings.find(opening => opening.id === "demo-living-garden-door")!;
    delete door.glazed;
    expect(parseHouseModel(model).openings.find(opening => opening.id === door.id)?.glazed).toBeUndefined();
  });

  it("keeps the exported hero in sync with the current Distribution geometry and furniture in both languages", () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "lib/demo-exterior-render.json"), "utf8"));
    const english = demoExteriorGeometry(createDemoDistributionRecord("en").model);
    const spanish = demoExteriorGeometry(createDemoDistributionRecord("es").model);
    expect(spanish).toEqual(english);
    expect(sha256(JSON.stringify(english)), "Regenerate the exterior after changing the demo architecture").toBe(manifest.geometrySha256);
    const englishFurniture = demoExteriorFurniture(createDemoDistributionRecord("en").model);
    const spanishFurniture = demoExteriorFurniture(createDemoDistributionRecord("es").model);
    expect(spanishFurniture).toEqual(englishFurniture);
    expect(englishFurniture.items.some(item => item.roomId === "demo-terrace" && item.kind === "sofa")).toBe(true);
    expect(sha256(JSON.stringify(englishFurniture)), "Regenerate the exterior after changing the demo furniture layout").toBe(manifest.furnitureSha256);
  });

  it("delivers the exact generated WebP at the documented resolution", async () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "lib/demo-exterior-render.json"), "utf8"));
    const image = readFileSync(join(process.cwd(), "public/demo/casa-mirador-exterior.webp"));
    expect(sha256(image), "The exterior image and its render manifest must be regenerated together").toBe(manifest.imageSha256);
    expect(sha256(readFileSync(join(process.cwd(), "public/demo/casa-mirador-plan.svg"))), "Regenerate the plan with the exterior after changing the architecture").toBe(manifest.planSha256);
    const metadata = await sharp(image).metadata();
    expect(metadata.format).toBe("webp");
    expect([metadata.width, metadata.height]).toEqual([1800, 1200]);
    expect([manifest.width, manifest.height]).toEqual([metadata.width, metadata.height]);
  });
});
