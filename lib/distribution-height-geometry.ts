import type { BuildingFace, Point, Wall } from "./house-distribution";

type Position = [number, number, number];
type RoofTriangle = { vertices: Position[]; height: (point: Point) => number; contains: (point: Point) => boolean; normal: Position };
export type WallHeightSegment = { start: number; end: number; startHeight: number; endHeight: number };
export type WallSectionPolygon = Point[];
const epsilon = .000001;

function roofTriangles(faces: BuildingFace[] = []): RoofTriangle[] {
  return faces.filter(face => face.kind === "roof").flatMap(face => {
    // Faces are triangles in generated models; support triangulated polygons in imports too.
    return face.vertices.slice(1, -1).flatMap((b, i) => {
      const a = face.vertices[0], c = face.vertices[i + 2];
      const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(denominator) < epsilon) return [];
      const weights = ([x, y]: Point) => {
        const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / denominator;
        const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / denominator;
        return [u, v, 1 - u - v];
      };
      const ab = b.map((value, j) => value - a[j]), ac = c.map((value, j) => value - a[j]);
      const n: Position = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      const sign = n[2] < 0 ? -1 : 1, length = Math.hypot(...n);
      return [{ vertices: [a, b, c], contains: (point: Point) => Math.min(...weights(point)) >= -epsilon,
        height: (point: Point) => weights(point).reduce((sum, w, j) => sum + w * [a, b, c][j][2], 0),
        normal: n.map(value => sign * value / length) as Position }];
    });
  });
}

/** The lowest roof face over a point, with no invented thickness or ceiling offset. */
export function roofSurfaceAt(point: Point, faces?: BuildingFace[]): { height: number; normal: Position } | undefined {
  let surface: { height: number; normal: Position } | undefined;
  for (const triangle of roofTriangles(faces)) {
    if (!triangle.contains(point)) continue;
    const height = triangle.height(point);
    if (!surface || height < surface.height) surface = { height, normal: triangle.normal };
  }
  return surface;
}

export function wallHeightAt(segment: WallHeightSegment, along: number): number {
  return segment.startHeight + (segment.endHeight - segment.startHeight) * (along - segment.start) / (segment.end - segment.start);
}

/** Piecewise roof profile along a partition. Segment endpoints retain both sides of a step. */
export function wallHeightProfile(wall: Wall, faces?: BuildingFace[], maximum?: number): WallHeightSegment[] {
  const dx = wall.end[0] - wall.start[0], dy = wall.end[1] - wall.start[1], length = Math.hypot(dx, dy);
  if (!length) return [];
  const pointAt = (along: number): Point => [wall.start[0] + along * dx / length, wall.start[1] + along * dy / length];
  const triangles = roofTriangles(faces);
  const cuts = [0, length];
  for (const triangle of triangles) {
    for (let i = 0; i < 3; i++) {
      const a = triangle.vertices[i], b = triangle.vertices[(i + 1) % 3];
      const ex = b[0] - a[0], ey = b[1] - a[1], denominator = dx * ey - dy * ex;
      if (Math.abs(denominator) < epsilon) {
        // A wall on a triangle edge still needs a cut at each edge endpoint.
        for (const p of [a, b]) {
          if (Math.abs((p[0] - wall.start[0]) * dy - (p[1] - wall.start[1]) * dx) > epsilon * length) continue;
          const along = ((p[0] - wall.start[0]) * dx + (p[1] - wall.start[1]) * dy) / length;
          if (along > epsilon && along < length - epsilon) cuts.push(along);
        }
        continue;
      }
      const ax = a[0] - wall.start[0], ay = a[1] - wall.start[1];
      const t = (ax * ey - ay * ex) / denominator, u = (ax * dy - ay * dx) / denominator;
      if (t > epsilon && t < 1 - epsilon && u >= -epsilon && u <= 1 + epsilon) cuts.push(t * length);
    }
  }
  const sorted = [...new Set(cuts)].sort((a, b) => a - b);
  const profile: WallHeightSegment[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i], end = sorted[i + 1];
    if (end - start < epsilon) continue;
    const covering = triangles.filter(triangle => triangle.contains(pointAt((start + end) / 2)));
    const crossovers = [start, end];
    // Overlapping planes can exchange which is lower between their edges.
    for (let a = 0; a < covering.length; a++) for (let b = a + 1; b < covering.length; b++) {
      const left = covering[a].height(pointAt(start)) - covering[b].height(pointAt(start));
      const right = covering[a].height(pointAt(end)) - covering[b].height(pointAt(end));
      if (left * right < 0) crossovers.push(start + (end - start) * left / (left - right));
    }
    if (maximum !== undefined) for (const triangle of covering) {
      const left = triangle.height(pointAt(start)) - maximum, right = triangle.height(pointAt(end)) - maximum;
      if (left * right < 0) crossovers.push(start + (end - start) * left / (left - right));
    }
    crossovers.sort((a, b) => a - b);
    for (let j = 0; j < crossovers.length - 1; j++) {
      const left = crossovers[j], right = crossovers[j + 1], midpoint = pointAt((left + right) / 2);
      if (right - left < epsilon) continue;
      const triangle = covering.reduce<RoofTriangle | undefined>((lowest, current) => !lowest || current.height(midpoint) < lowest.height(midpoint) ? current : lowest, undefined);
      profile.push({ start: left, end: right,
        startHeight: Math.min(triangle?.height(pointAt(left)) ?? wall.height, maximum ?? Infinity),
        endHeight: Math.min(triangle?.height(pointAt(right)) ?? wall.height, maximum ?? Infinity) });
    }
  }
  return profile;
}

/** Clip a wall band to each sloping/stepped top, preserving rectangular openings. */
export function wallSectionPolygons(profile: WallHeightSegment[], start: number, end: number, bottom: number, top: number): WallSectionPolygon[] {
  if (end <= start || top <= bottom) return [];
  const polygons: WallSectionPolygon[] = [];
  for (const segment of profile) {
    const left = Math.max(start, segment.start), right = Math.min(end, segment.end);
    if (right - left < epsilon) continue;
    const cuts = [left, right];
    const a = wallHeightAt(segment, left), b = wallHeightAt(segment, right);
    for (const height of [bottom, top]) {
      if ((a - height) * (b - height) < 0) cuts.push(left + (right - left) * (height - a) / (b - a));
    }
    cuts.sort((x, y) => x - y);
    for (let i = 0; i < cuts.length - 1; i++) {
      const x = cuts[i], y = cuts[i + 1];
      if (wallHeightAt(segment, (x + y) / 2) <= bottom + epsilon) continue;
      const leftTop = Math.min(top, wallHeightAt(segment, x)), rightTop = Math.min(top, wallHeightAt(segment, y));
      polygons.push([[x, bottom], [y, bottom], [y, Math.max(bottom, rightTop)], [x, Math.max(bottom, leftTop)]]);
    }
  }
  return polygons;
}
