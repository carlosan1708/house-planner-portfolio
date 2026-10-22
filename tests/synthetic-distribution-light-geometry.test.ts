import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ceilingHeightAt, lightMount } from "@/lib/distribution-light-geometry";
import { parseHouseModel, type HouseModel } from "@/lib/house-distribution";

let model: HouseModel;
let temp: string;
beforeAll(() => {
  temp = mkdtempSync(join(tmpdir(), "synthetic-mounts-"));
  const path = join(temp, "model.json");
  execFileSync(process.execPath, ["scripts/prepare-demo-house.mjs", path]);
  model = parseHouseModel(JSON.parse(readFileSync(path, "utf8")));
});
afterAll(() => rmSync(temp, { recursive: true, force: true }));

describe("mount behavior with invented geometry", () => {
  it("uses the explicit sloping underside without certifying a room ceiling height", () => {
    expect(ceilingHeightAt(model, [2, 2])).toBeCloseTo(2.72);
    expect(ceilingHeightAt(model, [6, 2])).toBeCloseTo(3.12);
    expect(model.rooms[0].height.value).toBeNull();
    const light = model.fixtures.find(fixture => fixture.id === "ceiling-light")!;
    const mounted = lightMount(model, light, false);
    expect(mounted.position.slice(0, 2)).toEqual(light.position);
    expect(mounted.position[2]).toBeCloseTo(2.695);
  });
  it("uses an alternate roof's surface independently of the default underside", () => {
    const faces = model.envelope!.variants![0].faces;
    expect(ceilingHeightAt(model, [2, 2], faces)).toBeCloseTo(3.07);
    const fixture = model.fixtures.find(value => value.id === "ceiling-light")!;
    expect(lightMount(model, fixture, false, faces).position[2]).toBeCloseTo(3.045);
  });
  it("suspends pendants from the ceiling and renders ceiling/pendant plan markers in cutaway", () => {
    const pendant = model.fixtures.find(fixture => fixture.id === "pendant-light")!;
    const mounted = lightMount(model, pendant, false);
    expect(mounted.support!.start[2]).toBeCloseTo(3.12);
    expect(mounted.support!.end).toEqual(mounted.position);
    expect(mounted.position[2]).toBeLessThan(mounted.support!.start[2]);
    for (const fixture of model.fixtures.filter(value => ["ceiling", "pendant"].includes(value.mount || ""))) {
      const plan = lightMount(model, fixture, true);
      expect(plan.position).toEqual([...fixture.position, .025]);
      expect(plan.support).toBeUndefined();
    }
  });
  it("anchors exterior wall lights on a physical face outside door/window apertures", () => {
    const fixture = model.fixtures.find(value => value.id === "wall-light")!;
    const original = [...fixture.position];
    for (const cutaway of [false, true]) {
      const mounted = lightMount(model, fixture, cutaway);
      expect(mounted.wallId).toBe("front");
      const [x, y, z] = mounted.support!.start;
      expect(Math.abs(y)).toBeCloseTo(.09);
      for (const opening of model.openings.filter(value => value.wallId === "front")) {
        const inside = x > opening.offset && x < opening.offset + opening.width
          && z > opening.sill && z < opening.sill + opening.height;
        expect(inside).toBe(false);
      }
      expect(mounted.support!.end).toEqual(mounted.position);
    }
    expect(fixture.position).toEqual(original);
  });
  it("connects ground-mounted lights to the floor and honors corrected mounting heights", () => {
    const fixture = structuredClone(model.fixtures.find(value => value.id === "ground-light")!);
    fixture.heightMeasurement!.value = .9;
    const mounted = lightMount(model, fixture, false);
    expect(mounted.position).toEqual([...fixture.position, .9]);
    expect(mounted.support!.start).toEqual([...fixture.position, 0]);
  });
  it("does not invent a wall anchor when walls are unavailable", () => {
    const copy = structuredClone(model);
    copy.walls = [];
    const fixture = copy.fixtures.find(value => value.id === "wall-light")!;
    const mounted = lightMount(copy, fixture, false);
    expect(mounted.wallId).toBeUndefined();
    expect(mounted.support).toBeUndefined();
  });
  it("uses a nominal rendering fallback and rejects invalid mounting metadata", () => {
    const copy = structuredClone(model);
    delete copy.envelope;
    expect(ceilingHeightAt(copy, [2, 2])).toBe(3);
    const fixture = structuredClone(model.fixtures.find(value => value.id === "ceiling-light")!);
    delete fixture.mount;
    expect(lightMount(model, fixture, false).kind).toBe("ceiling");
    expect(() => parseHouseModel({ ...model, fixtures: [{ ...fixture, mount: "floating" }] })).toThrow("Invalid light mounting");
  });
});
