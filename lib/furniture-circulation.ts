import type { HouseModel, Point, Room } from "./house-distribution";

const epsilon = .00001;
const routeWidth = .9;
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const subtract = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const along = (point: Point, direction: Point, distance: number): Point => [point[0] + direction[0] * distance, point[1] + direction[1] * distance];

function inPolygon(point: Point, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    if (Math.abs(cross(subtract(b, a), subtract(point, a))) < epsilon && point[0] >= Math.min(a[0], b[0]) - epsilon && point[0] <= Math.max(a[0], b[0]) + epsilon && point[1] >= Math.min(a[1], b[1]) - epsilon && point[1] <= Math.max(a[1], b[1]) + epsilon) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function exterior(room: Room) {
  const key = `${room.id} ${room.name}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return /exterior|outside|outdoor|carport|cochera|garden|jardin|terrace|terraza|porch|porche/.test(key);
}

function insideRoom(strip: Point[], room: Room) {
  if (!strip.every(point => inPolygon(point, room.polygon))) return false;
  return strip.every((a, i) => {
    const b = strip[(i + 1) % strip.length];
    return room.polygon.every((c, j) => {
      const d = room.polygon[(j + 1) % room.polygon.length];
      return !(cross(subtract(b, a), subtract(c, a)) * cross(subtract(b, a), subtract(d, a)) < -epsilon && cross(subtract(d, c), subtract(a, c)) * cross(subtract(d, c), subtract(b, c)) < -epsilon);
    });
  });
}

function overlaps(a: Point[], b: Point[]) {
  for (const polygon of [a, b]) for (let i = 0; i < polygon.length; i++) {
    const edge = subtract(polygon[(i + 1) % polygon.length], polygon[i]), axis: Point = [-edge[1], edge[0]];
    const project = (points: Point[]) => points.map(point => point[0] * axis[0] + point[1] * axis[1]);
    const first = project(a), second = project(b);
    if (Math.max(...first) <= Math.min(...second) + epsilon || Math.max(...second) <= Math.min(...first) + epsilon) return false;
  }
  return true;
}

function stripBetween(start: Point, end: Point, tangent: Point, width: number): Point[] {
  return [along(start, tangent, -width / 2), along(start, tangent, width / 2), along(end, tangent, width / 2), along(end, tangent, -width / 2)];
}

/** Extend an exterior entrance approach only through a clear, open connection to another interior room. */
export function furnitureEntranceClearances(model: HouseModel, roomId: string): Point[][] {
  const room = model.rooms.find(room => room.id === roomId);
  if (!room || exterior(room)) return [];
  const interior = model.rooms.filter(other => other.id !== roomId && !exterior(other));
  const strips: Point[][] = [];
  for (const door of model.openings) {
    if (door.kind !== "door" || !door.roomIds.includes(roomId) || door.roomIds.some(id => interior.some(other => other.id === id))) continue;
    const wall = model.walls.find(wall => wall.id === door.wallId);
    if (!wall) continue;
    const delta = subtract(wall.end, wall.start), length = Math.hypot(...delta);
    if (length < epsilon) continue;
    const tangent: Point = [delta[0] / length, delta[1] / length], center = along(wall.start, tangent, door.offset + door.width / 2);
    const probe = Math.max(.12, wall.thickness / 2 + .03);
    const normal = ([-1, 1] as const).map(sign => [-tangent[1] * sign, tangent[0] * sign] as Point).find(direction => inPolygon(along(center, direction, probe), room.polygon) && !inPolygon(along(center, direction, -probe), room.polygon));
    if (!normal || interior.some(other => inPolygon(along(center, normal, -probe), other.polygon))) continue;
    const distances = room.polygon.flatMap((start, index) => {
      const edge = subtract(room.polygon[(index + 1) % room.polygon.length], start), denominator = cross(normal, edge);
      if (Math.abs(denominator) < epsilon) return [];
      const offset = subtract(start, center), distance = cross(offset, edge) / denominator, fraction = cross(offset, normal) / denominator;
      return distance > probe && fraction >= -epsilon && fraction <= 1 + epsilon ? [distance] : [];
    });
    const distance = Math.min(...distances);
    if (!Number.isFinite(distance) || distance <= .9) continue;
    const end = along(center, normal, distance), nextRoom = interior.find(other => inPolygon(along(end, normal, probe), other.polygon));
    if (!nextRoom || ![-routeWidth / 2, 0, routeWidth / 2].every(offset => inPolygon(along(along(end, tangent, offset), normal, probe), nextRoom.polygon))) continue;
    const strip = stripBetween(center, end, tangent, routeWidth);
    if (!insideRoom(strip, room)) continue;
    if (model.walls.some(other => {
      if (other.id === wall.id) return false;
      const delta = subtract(other.end, other.start), length = Math.hypot(...delta);
      if (length < epsilon) return false;
      const normal: Point = [-delta[1] / length, delta[0] / length];
      return overlaps(strip, stripBetween(other.start, other.end, normal, other.thickness));
    })) continue;
    strips.push(strip);
  }
  return strips;
}
