import { describe, expect, it } from "vitest";
import { createDemoDistributionRecord } from "@/lib/demo-distribution";
import { createFurnitureLayout, footprintInRoom, furnitureFootprint, furnitureOpeningClearances } from "@/lib/furniture-layout";
import { polygonMetrics, type Point } from "@/lib/house-distribution";

function bounds(polygon: Point[]) {
  return { left: Math.min(...polygon.map(([x]) => x)), right: Math.max(...polygon.map(([x]) => x)), front: Math.min(...polygon.map(([, y]) => y)), back: Math.max(...polygon.map(([, y]) => y)) };
}
function overlap(first: Point[], second: Point[]) {
  const a = bounds(first), b = bounds(second);
  return a.left < b.right - .00001 && b.left < a.right - .00001 && a.front < b.back - .00001 && b.front < a.back - .00001;
}

describe("modeled Casa Mirador terrace furniture", () => {
  it.each(["en", "es"] as const)("fits a complete lounge and four-seat dining set on the actual terrace (%s)", language => {
    const model = createDemoDistributionRecord(language).model, before = JSON.stringify(model);
    const layout = createFurnitureLayout(model), zone = layout.zones?.find(zone => zone.id === "demo-terrace");
    expect(zone).toEqual({ id: "demo-terrace", name: { en: "Garden terrace", es: "Terraza al jardín" }, polygon: [[0, -3.25], [8.9, -3.25], [8.9, 0], [0, 0]], elevation: -.06 });
    const terrace = layout.items.filter(item => item.roomId === zone!.id);
    expect(terrace).toHaveLength(12);
    expect(terrace.filter(item => item.kind === "sofa")).toHaveLength(1);
    expect(terrace.filter(item => item.kind === "chair")).toHaveLength(6);
    expect(terrace.filter(item => item.kind === "dining-table")).toHaveLength(1);
    expect(terrace.filter(item => item.kind === "coffee-table")).toHaveLength(1);
    const dining = terrace.find(item => item.kind === "dining-table")!;
    const diningChairs = terrace.filter(item => item.label.en === "Outdoor dining chair");
    expect(diningChairs).toHaveLength(4);
    for (const chair of diningChairs) {
      const dx = dining.position[0] - chair.position[0], dy = dining.position[1] - chair.position[1];
      expect(Math.hypot(dx, dy)).toBeLessThan(1.1);
      expect(Math.sin(chair.rotation) * dx - Math.cos(chair.rotation) * dy).toBeGreaterThan(0);
    }
    for (const item of terrace) {
      expect(item.elevation).toBe(zone!.elevation);
      expect(footprintInRoom(furnitureFootprint(item, .08), zone!)).toBe(true);
      for (const other of terrace.filter(other => other.id !== item.id && other.kind !== "rug" && item.kind !== "rug")) expect(overlap(furnitureFootprint(item, .08), furnitureFootprint(other, .08)), `${item.id} overlaps ${other.id}`).toBe(false);
    }
    expect(model.rooms).toHaveLength(8);
    expect(model.rooms.reduce((area, room) => area + polygonMetrics(room.polygon).area, 0)).toBe(120);
    expect(JSON.stringify(model)).toBe(before);
  });

  it("leaves the glazed opening, a continuous 0.9 m garden route and modeled pergola posts clear", () => {
    const model = createDemoDistributionRecord().model;
    const terrace = createFurnitureLayout(model).items.filter(item => item.roomId === "demo-terrace");
    const gardenRoute: Point[] = [[4, -3.25], [4.9, -3.25], [4.9, 0], [4, 0]];
    const doorApproach = furnitureOpeningClearances(model, "demo-living");
    const postIds = [...new Set(model.envelope!.faces.flatMap(face => face.id.match(/^(demo-pergola-post-\d+)-/)?.[1] || []))];
    const posts = postIds.map(id => model.envelope!.faces.filter(face => face.id.startsWith(`${id}-`)).flatMap(face => face.vertices.map(([x, y]) => [x, y] as Point)));
    for (const item of terrace) {
      const footprint = furnitureFootprint(item, .08);
      expect(overlap(footprint, gardenRoute), `${item.id} obstructs the garden route`).toBe(false);
      for (const clearance of doorApproach) expect(overlap(footprint, clearance), `${item.id} obstructs the sliding door`).toBe(false);
      for (const post of posts) expect(overlap(footprint, post), `${item.id} collides with a pergola post`).toBe(false);
    }
  });

  it("derives outdoor placement and its support elevation from the runtime deck", () => {
    const model = createDemoDistributionRecord().model;
    const original = createFurnitureLayout(model);
    const dx = 12, dy = 7, dz = .42;
    model.rooms.forEach(room => room.polygon.forEach(point => { point[0] += dx; point[1] += dy; }));
    model.walls.forEach(wall => { for (const point of [wall.start, wall.end]) { point[0] += dx; point[1] += dy; } });
    model.envelope!.faces = model.envelope!.faces.map(face => ({ ...face, vertices: face.vertices.map(([x, y, z]) => [x + dx, y + dy, z + dz]) }));
    const moved = createFurnitureLayout(model), outdoor = moved.items.filter(item => item.roomId === "demo-terrace");
    expect(outdoor).toHaveLength(12);
    for (const item of outdoor) {
      const before = original.items.find(previous => previous.id === item.id)!;
      expect(item.position[0]).toBeCloseTo(before.position[0] + dx);
      expect(item.position[1]).toBeCloseTo(before.position[1] + dy);
      expect(item.elevation).toBeCloseTo(-.06 + dz);
    }
  });

  it("does not invent an outdoor floor for a missing, incomplete or nonrectangular terrace", () => {
    for (const variant of ["missing", "incomplete", "irregular", "overlapping", "private"] as const) {
      const model = createDemoDistributionRecord().model;
      if (variant === "missing") model.envelope!.faces = model.envelope!.faces.filter(face => !face.id.startsWith("demo-terrace-"));
      if (variant === "incomplete") model.envelope!.faces = model.envelope!.faces.filter(face => face.id !== "demo-terrace-top-2");
      if (variant === "irregular") model.envelope!.faces.find(face => face.id === "demo-terrace-top-1")!.vertices[1][0] -= .8;
      if (variant === "overlapping") model.envelope!.faces.find(face => face.id === "demo-terrace-top-2")!.vertices = [[0, -3.25, -.06], [8.9, -3.25, -.06], [0, 0, -.06]];
      if (variant === "private") model.envelope!.source.documentId = "private-project";
      const layout = createFurnitureLayout(model);
      expect(layout.zones).toBeUndefined();
      expect(layout.items.some(item => item.roomId === "demo-terrace")).toBe(false);
    }
  });
});
