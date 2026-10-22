import { describe, expect, it } from "vitest";
import { roofSurfaceAt, wallHeightAt, wallHeightProfile, wallSectionPolygons } from "@/lib/distribution-height-geometry";
import type { BuildingFace, Wall } from "@/lib/house-distribution";

const wall: Wall = { id: "partition", start: [0, 1], end: [10, 1], height: 3, thickness: .15, source: { documentId: "plan", page: 7, sheet: "Sections" } };
function plane(id: string, start: number, end: number, height: (x: number) => number): BuildingFace[] {
  const a: [number, number, number] = [start, 0, height(start)], b: [number, number, number] = [end, 0, height(end)];
  const c: [number, number, number] = [end, 2, height(end)], d: [number, number, number] = [start, 2, height(start)];
  return [{ id: `${id}-1`, kind: "roof", vertices: [a,b,c] }, { id: `${id}-2`, kind: "roof", vertices: [a,c,d] }];
}

describe("section-derived roof and partition geometry", () => {
  it("interpolates exact underside elevations and normalized slopes without a ceiling offset", () => {
    const faces = plane("slope", 0, 10, x => 2 + .2*x);
    expect(roofSurfaceAt([2,1], faces)?.height).toBeCloseTo(2.4);
    expect(roofSurfaceAt([8,1], faces)?.height).toBeCloseTo(3.6);
    const normal = roofSurfaceAt([2,1], faces)!.normal;
    expect(normal[0]).toBeLessThan(0);
    expect(normal[2]).toBeGreaterThan(0);
    expect(Math.hypot(...normal)).toBeCloseTo(1);
    expect(roofSurfaceAt([-1,1], faces)).toBeUndefined();
    for (const segment of wallHeightProfile(wall, faces)) {
      expect(segment.startHeight).toBeCloseTo(2 + .2*segment.start);
      expect(segment.endHeight).toBeCloseTo(2 + .2*segment.end);
    }
  });

  it("retains both elevations of a roof step instead of interpolating a ramp across it", () => {
    const faces = [...plane("lower", 0, 4, () => 3), ...plane("upper", 4, 10, () => 5)];
    const profile = wallHeightProfile(wall, faces);
    expect(profile.find(segment => Math.abs(segment.end-4) < .000001)?.endHeight).toBe(3);
    expect(profile.find(segment => Math.abs(segment.start-4) < .000001)?.startHeight).toBe(5);
    for (const segment of profile) {
      expect(segment.startHeight).toBe(segment.endHeight);
      expect(segment.end <= 4 || segment.start >= 4).toBe(true);
    }
    const polygons = wallSectionPolygons(profile, 0, 10, 2.1, 5);
    expect(polygons.some(points => points[0][0] < 4 && points[1][0] > 4)).toBe(false);
  });

  it("splits overlapping slopes where the lower roof plane changes", () => {
    const faces = [...plane("rising", 0, 10, x => 2+.4*x), ...plane("falling", 0, 10, x => 6-.4*x)];
    const profile = wallHeightProfile(wall, faces);
    expect(profile.some(segment => Math.abs(segment.start-5) < .000001 || Math.abs(segment.end-5) < .000001)).toBe(true);
    for (const x of [1,4,6,9]) {
      const segment = profile.find(segment => x > segment.start && x < segment.end)!;
      expect(wallHeightAt(segment,x)).toBeCloseTo(Math.min(2+.4*x,6-.4*x));
    }
  });

  it("uses the nominal wall only for uncovered spans and leaves cutaway walls at 1.25 m", () => {
    const profile = wallHeightProfile(wall, [...plane("left",0,3,()=>4), ...plane("right",5,10,()=>4)]);
    const gap = profile.find(segment => segment.start===3 && segment.end===5)!;
    expect(gap.startHeight).toBe(3);
    expect(gap.endHeight).toBe(3);
    expect(wallHeightProfile({ ...wall, height: 1.25 })).toEqual([{ start:0, end:10, startHeight:1.25, endHeight:1.25 }]);
  });

  it("caps exterior base walls at 3 m with a real breakpoint where the underside crosses the cap", () => {
    const profile = wallHeightProfile(wall, plane("slope",0,10,x=>2+.2*x), 3);
    expect(profile.some(segment => Math.abs(segment.start-5)<.000001 || Math.abs(segment.end-5)<.000001)).toBe(true);
    for (const segment of profile) {
      expect(segment.startHeight).toBeLessThanOrEqual(3);
      expect(segment.endHeight).toBeLessThanOrEqual(3);
      const middle = (segment.start+segment.end)/2;
      expect(wallHeightAt(segment,middle)).toBeCloseTo(Math.min(3,2+.2*middle));
    }
    expect(wallHeightProfile({ ...wall, height:1.25 }, undefined, 1.25)).toEqual([{ start:0, end:10, startHeight:1.25, endHeight:1.25 }]);
  });

  it("clips the band above an opening where the sloping roof crosses its top", () => {
    const profile = wallHeightProfile(wall, plane("slope",0,10,x=>1+.4*x));
    const polygons = wallSectionPolygons(profile, 0, 10, 2, 3);
    expect(Math.min(...polygons.flat().map(point=>point[0]))).toBeCloseTo(2.5);
    for (const polygon of polygons) for (const [along,height] of polygon) {
      expect(height).toBeGreaterThanOrEqual(2);
      expect(height).toBeLessThanOrEqual(3);
      expect(height).toBeLessThanOrEqual(1+.4*along+.000001);
    }
    expect(wallSectionPolygons(profile, 0, 2, 2, 3)).toEqual([]);
  });
});
