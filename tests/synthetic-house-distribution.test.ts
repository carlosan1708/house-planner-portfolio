import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { effectiveModel, modelSources, parseHouseModel, parseCorrection, polygonMetrics,
  roomTotals, uniqueOpenings, type HouseModel } from "@/lib/house-distribution";
import { normalizePermissions } from "@/lib/project";

let model: HouseModel;
let temp: string;
beforeAll(() => {
  temp = mkdtempSync(join(tmpdir(), "synthetic-house-"));
  const path = join(temp, "model.json");
  execFileSync(process.execPath, ["scripts/prepare-demo-house.mjs", path]);
  model = parseHouseModel(JSON.parse(readFileSync(path, "utf8")));
});
afterAll(() => rmSync(temp, { recursive: true, force: true }));

describe("synthetic model contract and geometry", () => {
  it("validates an invented model while preserving unknown heights and conflicting area evidence", () => {
    expect(model.rooms).toHaveLength(4);
    expect(model.fixtures).toHaveLength(8);
    expect(model.rooms.every(room => room.height.value === null)).toBe(true);
    expect(model.areaSchedule!.statedTotal).not.toBe(model.areaSchedule!.entries[0].area);
    expect(model.rooms.find(room => room.id === "office")!.sectionHeight!.max.value).toBe(3.32);
  });
  it("calculates concave areas independently of winding", () => {
    const polygon: [number, number][] = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]];
    expect(polygonMetrics(polygon)).toEqual({ area: 12, perimeter: 16, width: 4, depth: 4 });
    expect(polygonMetrics([...polygon].reverse()).area).toBe(12);
  });
  it("counts shared openings once and distinguishes reviewed from pending inventory", () => {
    expect(uniqueOpenings(model, "living").filter(opening => opening.id === "shared-door")).toHaveLength(1);
    expect(uniqueOpenings(model, "office").filter(opening => opening.id === "shared-door")).toHaveLength(1);
    expect(uniqueOpenings(model)).toHaveLength(3);
    const counts = roomTotals(model, model.rooms.find(room => room.id === "living")!);
    expect(counts.outlet).toEqual({ count: 1, complete: true });
    expect(counts.switch).toEqual({ count: 1, complete: false });
    expect(counts.ac).toEqual({ count: 0, complete: false });
  });
  it("binds every source including variants, measurements and area schedule to an explicit document", () => {
    expect(modelSources(model).every(source => source.documentId === "synthetic-plan")).toBe(true);
    const other = structuredClone(model);
    other.envelope!.variants![0].source.documentId = "unlisted";
    expect(() => parseHouseModel(other)).toThrow("Unknown source document");
    const output = join(temp, "alternate.json");
    execFileSync(process.execPath, ["scripts/prepare-demo-house.mjs", output, "another-synthetic-plan"]);
    const rebound = parseHouseModel(JSON.parse(readFileSync(output, "utf8")));
    expect(modelSources(rebound).every(source => source.documentId === "another-synthetic-plan")).toBe(true);
  });
  it("keeps original geometry and key evidence when applying recoverable corrections", () => {
    const before = JSON.stringify(model);
    const corrected = effectiveModel({ model, revision: 1, updatedAt: "2026-10-13T00:00:00Z",
      roomCorrections: { office: { name: "Revised office" } },
      fixtureCorrections: { "living-outlet": { removed: true }, "ceiling-light": { height: 2.4 } } });
    expect(corrected.rooms[1].name).toBe("Revised office");
    expect(corrected.rooms[1].polygon).toEqual(model.rooms[1].polygon);
    expect(corrected.fixtures.some(fixture => fixture.id === "living-outlet")).toBe(false);
    expect(corrected.fixtures.find(fixture => fixture.id === "ceiling-light")!.heightMeasurement)
      .toMatchObject({ value: 2.4, status: "approximate" });
    expect(JSON.stringify(model)).toBe(before);
  });
  it.each([
    ["duplicate identifiers", (copy: HouseModel) => copy.rooms.push(copy.rooms[0])],
    ["self intersecting polygon", (copy: HouseModel) => { copy.rooms[0].polygon = [[0, 0], [4, 4], [0, 4], [4, 0]]; }],
    ["nonfinite coordinate", (copy: HouseModel) => { copy.fixtures[0].position[0] = Infinity; }],
    ["unknown opening wall", (copy: HouseModel) => { copy.openings[0].wallId = "missing"; }],
    ["opening beyond wall", (copy: HouseModel) => { copy.openings[0].offset = 99; }],
    ["overlapping openings", (copy: HouseModel) => { copy.openings[1].offset = 1; }],
    ["unknown fixture room", (copy: HouseModel) => { copy.fixtures[0].roomId = "missing"; }],
    ["invalid envelope triangle", (copy: HouseModel) => { copy.envelope!.faces[0].vertices[1] = copy.envelope!.faces[0].vertices[0]; }],
    ["nonroof underside", (copy: HouseModel) => { copy.envelope!.roofUnderside![0].kind = "wall"; }],
    ["duplicate variants", (copy: HouseModel) => copy.envelope!.variants!.push(copy.envelope!.variants![0])],
  ])("rejects %s", (_name, mutate) => {
    const copy = structuredClone(model);
    mutate(copy);
    expect(() => parseHouseModel(copy)).toThrow();
  });
  it("rejects geometry corrections and keeps distribution permission opt-in", () => {
    expect(() => parseCorrection("room", { polygon: [[0, 0], [1, 0], [1, 1]] }, model)).toThrow();
    expect(() => parseCorrection("fixture", { roomId: "missing" }, model)).toThrow();
    expect(parseCorrection("fixture", { removed: true }, model)).toEqual({ removed: true });
    expect(normalizePermissions({}).distribution).toBe(false);
  });
  it("accepts older packages without optional envelopes or area schedules", () => {
    const copy = structuredClone(model);
    delete copy.envelope;
    delete copy.areaSchedule;
    delete copy.surfaces;
    expect(parseHouseModel(copy).rooms).toHaveLength(4);
  });
});
