import { describe, expect, it } from "vitest";
import { furnitureEntranceClearances } from "@/lib/furniture-circulation";
import { createFurnitureLayout, furnitureFootprint } from "@/lib/furniture-layout";
import type { HouseModel, Point, Room, Wall } from "@/lib/house-distribution";

const source = { documentId: "synthetic-plan", page: 1, sheet: "Test" };
function room(id: string, polygon: Point[]): Room {
  return { id, name: id, polygon, color: "#ffffff", source, height: { value: null, status: "unconfirmed", note: "", source }, finishes: "", notes: "", coverage: { outlet: "unconfirmed", light: "unconfirmed", switch: "unconfirmed", ac: "unconfirmed" } };
}
function wall(id: string, start: Point, end: Point): Wall { return { id, start, end, thickness: .15, height: 3, source }; }
function openEntranceModel(): HouseModel {
  return {
    schemaVersion: 1, name: "Synthetic open entrance", revision: 1, sourceDocumentIds: [source.documentId], notes: "", fixtures: [],
    rooms: [room("living", [[0, 0], [6, 0], [6, 4], [0, 4]]), room("dining", [[0, 4], [6, 4], [6, 7], [0, 7]]), room("exterior", [[0, -2], [6, -2], [6, 0], [0, 0]])],
    walls: [wall("front", [0, 0], [6, 0]), wall("left", [0, 0], [0, 7]), wall("right", [6, 0], [6, 7])],
    openings: [{ id: "entry", kind: "door", wallId: "front", roomIds: ["living", "exterior"], offset: 2.5, width: 1, height: 2.1, sill: 0, source, status: "approximate" }],
  };
}

describe("furniture entrance circulation", () => {
  it("keeps a continuous 0.9m route beyond the short door approach to an open interior room", () => {
    const model = openEntranceModel(), before = JSON.stringify(model);
    const strips = furnitureEntranceClearances(model, "living");
    expect(strips).toHaveLength(1);
    expect(strips[0]).toEqual([[2.55, 0], [3.45, 0], [3.45, 4], [2.55, 4]]);
    expect(JSON.stringify(model)).toBe(before);
    expect(furnitureEntranceClearances(model, "dining")).toEqual([]);
    expect(furnitureEntranceClearances(model, "exterior")).toEqual([]);
  });

  it("places the sofa clear of the full entrance corridor while keeping it facing the TV", () => {
    const model = openEntranceModel(), corridor = furnitureEntranceClearances(model, "living")[0];
    const items = createFurnitureLayout(model).items.filter(item => item.roomId === "living");
    const sofa = items.find(item => item.kind === "sofa")!, tv = items.find(item => item.kind === "console")!;
    expect(sofa).toBeDefined();
    expect(tv).toBeDefined();
    const footprint = furnitureFootprint(sofa, .08), left = Math.min(...corridor.map(([x]) => x)), right = Math.max(...corridor.map(([x]) => x));
    expect(Math.max(...footprint.map(([x]) => x)) <= left + .00001 || Math.min(...footprint.map(([x]) => x)) >= right - .00001).toBe(true);
    const dx = tv.position[0] - sofa.position[0], dy = tv.position[1] - sofa.position[1];
    expect(Math.sin(sofa.rotation) * dx - Math.cos(sofa.rotation) * dy).toBeGreaterThan(0);
  });

  it.each([
    { name: "translated and mirrored", transform: ([x, y]: Point): Point => [24 - x, y - 12] },
    { name: "rotated", transform: ([x, y]: Point): Point => [12 - y, 20 + x] },
  ])("derives the same route from $name runtime geometry", ({ transform }) => {
    const model = openEntranceModel(), expected = furnitureEntranceClearances(model, "living")[0].map(transform);
    const transformed = { ...model, rooms: model.rooms.map(room => ({ ...room, polygon: room.polygon.map(transform) })), walls: model.walls.map(wall => ({ ...wall, start: transform(wall.start), end: transform(wall.end) })) };
    const actual = furnitureEntranceClearances(transformed, "living");
    expect(actual).toHaveLength(1);
    for (let i = 0; i < expected.length; i++) {
      expect(actual[0][i][0]).toBeCloseTo(expected[i][0]);
      expect(actual[0][i][1]).toBeCloseTo(expected[i][1]);
    }
  });

  it("does not extend an internal door approach even when its second room reference is absent", () => {
    const model = openEntranceModel();
    model.rooms[2] = { ...model.rooms[2], id: "bathroom", name: "Bathroom" };
    model.openings[0].roomIds = ["living", "bathroom"];
    expect(furnitureEntranceClearances(model, "living")).toEqual([]);
    model.openings[0].roomIds = ["living"];
    expect(furnitureEntranceClearances(model, "living")).toEqual([]);
  });

  it("requires an interior continuation wide enough for the route", () => {
    const model = openEntranceModel();
    model.rooms = model.rooms.filter(room => room.id !== "dining");
    expect(furnitureEntranceClearances(model, "living")).toEqual([]);
    model.rooms.push(room("dining", [[2.8, 4], [3.2, 4], [3.2, 7], [2.8, 7]]));
    expect(furnitureEntranceClearances(model, "living")).toEqual([]);
  });

  it.each([2, 4])("does not project the route through a physical wall at y=%s", y => {
    const model = openEntranceModel();
    model.walls.push(wall("divider", [0, y], [6, y]));
    expect(furnitureEntranceClearances(model, "living")).toEqual([]);
  });

  it("allows a side divider that leaves the entrance route open", () => {
    const model = openEntranceModel();
    model.walls.push(wall("side-divider", [0, 4], [2, 4]));
    expect(furnitureEntranceClearances(model, "living")).toHaveLength(1);
  });

  it("does not bridge a concave room or a missing wall reference", () => {
    const model = openEntranceModel();
    model.rooms[0].polygon = [[0, 0], [6, 0], [6, 4], [3.2, 4], [3.2, 2], [0, 2]];
    expect(furnitureEntranceClearances(model, "living")).toEqual([]);
    model.openings[0].wallId = "missing";
    expect(furnitureEntranceClearances(model, "living")).toEqual([]);
  });
});
