import type { HouseModel, Point, Room } from "./house-distribution";

type WallPiece = { kind: string; width: number; depth: number };
export type WallPlacement = { position: Point; rotation: number };

/** Furniture fronts point along [sin(rotation), -cos(rotation)] in plan coordinates. */
export function wallFurniturePlacements(
  model: HouseModel, room: Room, piece: WallPiece, preferred: Point,
  inside: (point: Point, polygon: Point[]) => boolean, obstacles: Point[][],
): WallPlacement[] {
  const utility = piece.kind === "fridge" ? /refriger|fridge/i : piece.kind === "vanity" ? /gfci/i : null;
  const outlets = utility ? model.fixtures.filter(fixture => fixture.roomId === room.id && fixture.kind === "outlet" && utility.test(fixture.type)) : [];
  outlets.sort((a, b) => Math.hypot(a.position[0] - preferred[0], a.position[1] - preferred[1]) - Math.hypot(b.position[0] - preferred[0], b.position[1] - preferred[1]));
  const target = outlets[0]?.position ?? preferred;
  const placements: WallPlacement[] = [];
  for (const wall of model.walls) {
    const dx = wall.end[0] - wall.start[0], dy = wall.end[1] - wall.start[1], length = Math.hypot(dx, dy);
    if (length < piece.width + .16) continue;
    const tangent: Point = [dx / length, dy / length];
    const project = (point: Point) => (point[0] - wall.start[0]) * tangent[0] + (point[1] - wall.start[1]) * tangent[1];
    const halfWidth = piece.width / 2 + .08;
    const clamp = (offset: number) => Math.max(halfWidth, Math.min(length - halfWidth, offset));
    const offsets = [clamp(project(target)), halfWidth, length - halfWidth];
    for (let offset = halfWidth; offset < length - halfWidth; offset += .1) offsets.push(offset);
    // Include exact obstacle edges so compact bathrooms retain useful narrow gaps.
    for (const obstacle of obstacles) {
      const projected = obstacle.map(project);
      offsets.push(clamp(Math.min(...projected) - halfWidth), clamp(Math.max(...projected) + halfWidth));
    }
    for (const offset of offsets) {
      const back: Point = [wall.start[0] + tangent[0] * offset, wall.start[1] + tangent[1] * offset];
      for (const side of [-1, 1]) {
        const normal: Point = [-tangent[1] * side, tangent[0] * side];
        const inset = piece.depth / 2 + wall.thickness / 2 + .025;
        const position: Point = [back[0] + normal[0] * inset, back[1] + normal[1] * inset];
        // The backing segment must border this room, rather than an open zone boundary.
        if (!inside([back[0] + normal[0] * .1, back[1] + normal[1] * .1], room.polygon) || !inside(position, room.polygon)) continue;
        placements.push({ position, rotation: Math.atan2(normal[0], -normal[1]) });
      }
    }
  }
  return placements.sort((a, b) => Math.hypot(a.position[0] - target[0], a.position[1] - target[1]) - Math.hypot(b.position[0] - target[0], b.position[1] - target[1]));
}
