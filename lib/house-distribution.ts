/** Shared, JSON-only distribution contract. Coordinates are metres: x across, y front to back. */
export type Point = [number, number];
export type SourceReference = { documentId: string; page: number; sheet: string };
export type Evidence = "documented" | "calculated" | "approximate" | "unconfirmed";
export type Measurement = { value: number | null; status: Evidence; note: string; source: SourceReference };
export const FIXTURE_KINDS = ["outlet", "light", "switch", "ac"] as const;
export type FixtureKind = typeof FIXTURE_KINDS[number];
export type Room = {
  id: string; name: string; polygon: Point[]; color: string; source: SourceReference;
  height: Measurement; finishes: string; notes: string;
  /** Section-derived range above the reference floor; it does not establish clear ceiling height. */
  sectionHeight?: { min: Measurement; max: Measurement };
  coverage: Record<FixtureKind, "reviewed" | "partial" | "unconfirmed">;
};
export type Wall = { id: string; start: Point; end: Point; thickness: number; height: number; source: SourceReference };
export type Opening = { id: string; wallId: string; roomIds: string[]; kind: "door" | "window"; glazed?: boolean; offset: number; width: number; height: number; sill: number; source: SourceReference; status: Evidence; notes?: string; references?: SourceReference[] };
export type LightMountKind = "ceiling" | "pendant" | "wall" | "ground";
export type Fixture = { id: string; roomId: string; kind: FixtureKind; type: string; position: Point; height: number; heightMeasurement?: Measurement; mount?: LightMountKind; circuit: string; specifications: string; status: Evidence; source: SourceReference };
export type DistributionSurface = { id: string; kind: "roof" | "property"; polygon: Point[]; source: SourceReference; notes: string; measurements: (Measurement & { label: { en: string; es: string }; unit: "m" | "m²" | "%" })[] };
/** Coordinates [x, y, elevation] in metres; section-derived faces remain explicitly approximate. */
export type BuildingFace = { id: string; kind: "roof" | "wall" | "glazing"; vertices: [number, number, number][] };
export type EnvelopeVariant = { id: string; label: { en: string; es: string }; source: SourceReference; notes: string; faces: BuildingFace[] };
export type BuildingEnvelope = { source: SourceReference; status: Evidence; notes: string; faces: BuildingFace[]; roofUnderside?: BuildingFace[]; variants?: EnvelopeVariant[]; levels: (Measurement & { label: { en: string; es: string } })[] };
export type AreaSchedule = { source: SourceReference; entries: { label: string; roomIds: string[]; area: number }[]; statedTotal: number; notes: string };
export type HouseModel = { schemaVersion: 1; name: string; revision: number; sourceDocumentIds: string[]; rooms: Room[]; walls: Wall[]; openings: Opening[]; fixtures: Fixture[]; surfaces?: DistributionSurface[]; envelope?: BuildingEnvelope; areaSchedule?: AreaSchedule; notes: string };
export type RoomCorrection = Partial<Pick<Room, "name" | "height" | "finishes" | "notes" | "coverage">>;
export type FixtureCorrection = Partial<Pick<Fixture, "type" | "circuit" | "specifications" | "position" | "height" | "status" | "roomId">> & { removed?: boolean };
export type DistributionRecord = { model: HouseModel; roomCorrections: Record<string, RoomCorrection>; fixtureCorrections: Record<string, FixtureCorrection>; revision: number; updatedAt: string };
export type DistributionRequest = { status: "requested" | "in_preparation" | "ready"; sourceDocumentIds: string[]; notes: string; preparationNotes: string; revision: number; updatedAt: string };

export function polygonMetrics(points: Point[]) {
  let twiceArea = 0, perimeter = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    twiceArea += a[0] * b[1] - b[0] * a[1];
    perimeter += Math.hypot(a[0] - b[0], a[1] - b[1]);
  }
  return { area: Math.abs(twiceArea) / 2, perimeter, width: Math.max(...points.map(p => p[0])) - Math.min(...points.map(p => p[0])), depth: Math.max(...points.map(p => p[1])) - Math.min(...points.map(p => p[1])) };
}

export function effectiveModel(record: DistributionRecord): HouseModel {
  return { ...record.model, rooms: record.model.rooms.map(room => ({ ...room, ...record.roomCorrections[room.id] })), fixtures: record.model.fixtures.filter(f => !record.fixtureCorrections[f.id]?.removed).map(f => {
    const correction = record.fixtureCorrections[f.id];
    return { ...f, ...correction, ...(correction?.height !== undefined ? { heightMeasurement: { value: correction.height, status: "approximate" as const, source: f.heightMeasurement?.source || f.source, note: "User height correction; verify on site. / Altura corregida por usuario; verificar en obra." } } : {}) };
  }) };
}

export function roomTotals(model: HouseModel, room: Room) {
  return Object.fromEntries(FIXTURE_KINDS.map(kind => [kind, { count: model.fixtures.filter(f => f.roomId === room.id && f.kind === kind).length, complete: room.coverage[kind] === "reviewed" }])) as Record<FixtureKind, { count: number; complete: boolean }>;
}

export function uniqueOpenings(model: HouseModel, roomId?: string) {
  return [...new Map(model.openings.filter(o => !roomId || o.roomIds.includes(roomId)).map(o => [o.id, o])).values()];
}

const fail = (message: string): never => { throw new Error(message); };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : fail("Expected an object");
const string = (value: unknown, max = 2000): string => typeof value === "string" && value.length <= max ? value : fail("Invalid text");
const number = (value: unknown, min = 0, max = 500): number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : fail("Invalid measurement");
const id = (value: unknown): string => /^[a-zA-Z0-9_-]{1,160}$/.test(string(value, 160)) ? value as string : fail("Invalid identifier");
const point = (value: unknown): Point => Array.isArray(value) && value.length === 2 ? [number(value[0], -500), number(value[1], -500)] : fail("Invalid position");
const evidence = (value: unknown): Evidence => ["documented", "calculated", "approximate", "unconfirmed"].includes(String(value)) ? value as Evidence : fail("Invalid evidence status");
const source = (value: unknown): SourceReference => { const v = object(value); const page = number(v.page, 1, 2000); if (!Number.isInteger(page)) fail("Invalid page"); return { documentId: id(v.documentId), page, sheet: string(v.sheet, 100) }; };
const measurement = (value: unknown): Measurement => { const v = object(value); return { value: v.value === null ? null : number(v.value), status: evidence(v.status), note: string(v.note), source: source(v.source) }; };
const sectionHeight = (value: unknown): NonNullable<Room["sectionHeight"]> => {
  const v = object(value), min = measurement(v.min), max = measurement(v.max);
  if (min.value === null || max.value === null || min.value > max.value || max.value > 30) fail("Invalid section height range");
  return { min, max };
};
const coverage = (value: unknown): Room["coverage"] => { const v = object(value); return Object.fromEntries(FIXTURE_KINDS.map(k => [k, ["reviewed", "partial", "unconfirmed"].includes(String(v[k])) ? v[k] : fail("Invalid coverage")])) as Room["coverage"]; };
const array = <T>(value: unknown, max: number, parse: (v: unknown) => T): T[] => Array.isArray(value) && value.length <= max ? value.map(parse) : fail("Invalid or oversized list");

function validPolygon(points: Point[]) {
  const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < .001) return false;
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      const c = points[j], d = points[(j + 1) % points.length];
      const overlap = Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) <= Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) && Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) <= Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1]));
      if (overlap && cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0) return false;
    }
  }
  return true;
}

function lightMountKind(value: unknown, kind: unknown): LightMountKind {
  if (kind !== "light" || !["ceiling","pendant","wall","ground"].includes(String(value))) return fail("Invalid light mounting type");
  return value as LightMountKind;
}

function envelopeFaces(value: unknown): BuildingFace[] {
  const faces = array(value, 500, raw => {
        const f = object(raw);
        if (!["roof", "wall", "glazing"].includes(String(f.kind))) fail("Invalid envelope face kind");
        const vertices = array(f.vertices, 4, raw => {
          if (!Array.isArray(raw) || raw.length !== 3) return fail("Invalid envelope vertex");
          return [number(raw[0], -500), number(raw[1], -500), number(raw[2], -30, 30)] as [number, number, number];
        });
        if (vertices.length !== 3) fail("Envelope faces must be triangles");
        const [a, b, c] = vertices, u = b.map((v, i) => v - a[i]), w = c.map((v, i) => v - a[i]);
        if (Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) < .0001) fail("Degenerate envelope face");
        return { id: id(f.id), kind: f.kind as BuildingFace["kind"], vertices };
      })
  if (!faces.length || new Set(faces.map(f => f.id)).size !== faces.length) fail("Invalid envelope face identifiers");
  return faces;
}

export function parseHouseModel(value: unknown): HouseModel {
  const v = object(value);
  if (v.schemaVersion !== 1) fail("Unsupported model version");
  const model: HouseModel = {
    schemaVersion: 1, name: string(v.name, 160), revision: number(v.revision, 1), notes: string(v.notes, 8000),
    sourceDocumentIds: array(v.sourceDocumentIds, 12, id),
    rooms: array(v.rooms, 100, raw => { const r = object(raw); const polygon = array(r.polygon, 100, point); if (polygon.length < 3 || polygonMetrics(polygon).area < .01) fail("Invalid room polygon"); const color = string(r.color, 7); if (!/^#[a-f0-9]{6}$/i.test(color)) fail("Invalid room color"); return { id: id(r.id), name: string(r.name, 160), polygon, color, source: source(r.source), height: measurement(r.height), finishes: string(r.finishes), notes: string(r.notes), coverage: coverage(r.coverage), ...(r.sectionHeight === undefined ? {} : { sectionHeight: sectionHeight(r.sectionHeight) }) }; }),
    walls: array(v.walls, 500, raw => { const w = object(raw); return { id: id(w.id), start: point(w.start), end: point(w.end), thickness: number(w.thickness, .01, 2), height: number(w.height, .1, 30), source: source(w.source) }; }),
    openings: array(v.openings, 500, raw => { const o = object(raw); if (o.kind !== "door" && o.kind !== "window") fail("Invalid opening"); return { id: id(o.id), wallId: id(o.wallId), roomIds: array(o.roomIds, 2, id), kind: o.kind as Opening["kind"], ...(o.glazed === undefined ? {} : { glazed: typeof o.glazed === "boolean" ? o.glazed : fail("Invalid opening glazing") }), offset: number(o.offset), width: number(o.width, .01, 30), height: number(o.height, .01, 30), sill: number(o.sill, 0, 30), source: source(o.source), status: evidence(o.status), ...(o.notes === undefined ? {} : { notes: string(o.notes, 4000) }), ...(o.references === undefined ? {} : { references: array(o.references, 12, source) }) }; }),
    fixtures: array(v.fixtures, 2000, raw => { const f = object(raw); if (!FIXTURE_KINDS.includes(f.kind as FixtureKind)) fail("Invalid fixture kind"); return { id: id(f.id), roomId: id(f.roomId), kind: f.kind as FixtureKind, type: string(f.type, 160), position: point(f.position), height: number(f.height, 0, 30), circuit: string(f.circuit, 100), specifications: string(f.specifications), status: evidence(f.status), source: source(f.source), ...(f.heightMeasurement === undefined ? {} : { heightMeasurement: measurement(f.heightMeasurement) }), ...(f.mount === undefined ? {} : { mount: lightMountKind(f.mount, f.kind) }) }; }),
  };
  if (v.surfaces !== undefined) model.surfaces = array(v.surfaces, 6, raw => {
    const s = object(raw), polygon = array(s.polygon, 100, point);
    if (!["roof", "property"].includes(String(s.kind)) || polygon.length < 3 || polygonMetrics(polygon).area < .01 || !validPolygon(polygon)) fail("Invalid measurement surface");
    return { id: id(s.id), kind: s.kind as DistributionSurface["kind"], polygon, source: source(s.source), notes: string(s.notes, 4000), measurements: array(s.measurements, 30, raw => {
      const m = object(raw), label = object(m.label);
      if (!["m", "m²", "%"].includes(String(m.unit))) fail("Invalid measurement unit");
      return { value: m.value === null ? null : number(m.value, 0, 1_000_000), status: evidence(m.status), note: string(m.note), source: source(m.source), label: { en: string(label.en, 160), es: string(label.es, 160) }, unit: m.unit as "m" | "m²" | "%" };
    }) };
  });
  if (v.envelope !== undefined) {
    const e = object(v.envelope);
    model.envelope = { source: source(e.source), status: evidence(e.status), notes: string(e.notes, 4000),
      faces: envelopeFaces(e.faces),
      levels: array(e.levels, 20, raw => {
        const m = object(raw), label = object(m.label);
        return { value: m.value === null ? null : number(m.value, -30, 30), source: source(m.source), status: evidence(m.status), note: string(m.note), label: { en: string(label.en, 160), es: string(label.es, 160) } };
      }) };
    if (e.roofUnderside !== undefined) {
      model.envelope.roofUnderside = envelopeFaces(e.roofUnderside);
      if (model.envelope.roofUnderside.some(face => face.kind !== "roof")) fail("Invalid roof underside face kind");
    }
    if (e.variants !== undefined) {
      model.envelope.variants = array(e.variants, 4, raw => {
        const variant = object(raw), label = object(variant.label);
        return { id:id(variant.id), label:{en:string(label.en,160),es:string(label.es,160)}, source:source(variant.source), notes:string(variant.notes,4000), faces:envelopeFaces(variant.faces) };
      });
      if (new Set(model.envelope.variants.map(v => v.id)).size !== model.envelope.variants.length) fail("Duplicate envelope variants");
    }
  }
  if (v.areaSchedule !== undefined) {
    const a = object(v.areaSchedule);
    model.areaSchedule = { source:source(a.source), statedTotal:number(a.statedTotal,0,1_000_000), notes:string(a.notes,4000), entries:array(a.entries,100,raw => {
      const e = object(raw), roomIds = array(e.roomIds,20,id);
      if (!roomIds.length || roomIds.some(id => !model.rooms.some(r => r.id === id))) fail("Unknown area schedule room");
      return { label:string(e.label,160), roomIds, area:number(e.area,0,1_000_000) };
    }) };
  }
  if (!model.rooms.length || !model.sourceDocumentIds.length) fail("Rooms and source documents are required");
  if (!Number.isInteger(model.revision)) fail("Invalid model revision");
  if (model.rooms.some(r => !validPolygon(r.polygon))) fail("Room polygon intersects itself");
  if (model.walls.some(w => Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]) < .01)) fail("Wall has no length");
  for (const list of [model.rooms, model.walls, model.openings, model.fixtures, model.surfaces || []]) if (new Set(list.map(v => v.id)).size !== list.length) fail("Duplicate identifiers");
  const rooms = new Set(model.rooms.map(r => r.id)), walls = new Map(model.walls.map(w => [w.id, w]));
  for (const o of model.openings) {
    const w = walls.get(o.wallId);
    if (!w || o.roomIds.some(r => !rooms.has(r))) fail("Unknown opening reference");
    if (!o.roomIds.length || new Set(o.roomIds).size !== o.roomIds.length) fail("Invalid opening rooms");
    if (o.offset + o.width > Math.hypot(w!.end[0] - w!.start[0], w!.end[1] - w!.start[1]) + .01 || o.sill + o.height > w!.height + .01) fail("Opening extends beyond wall");
  }
  for (const w of model.walls) {
    const openings = model.openings.filter(o => o.wallId === w.id).sort((a, b) => a.offset - b.offset);
    if (openings.some((o, i) => i > 0 && o.offset < openings[i - 1].offset + openings[i - 1].width - .001)) fail("Overlapping openings");
  }
  if (model.fixtures.some(f => !rooms.has(f.roomId))) fail("Unknown fixture room");
  for (const s of modelSources(model)) if (!model.sourceDocumentIds.includes(s.documentId)) fail("Unknown source document");
  if (new TextEncoder().encode(JSON.stringify(model)).length > 700_000) fail("Model is too large");
  return model;
}

export function modelSources(model: HouseModel): SourceReference[] {
  return [...model.rooms.flatMap(r => [r.source, r.height.source, ...(r.sectionHeight ? [r.sectionHeight.min.source, r.sectionHeight.max.source] : [])]), ...model.walls.map(w => w.source), ...model.openings.flatMap(o => [o.source, ...(o.references || [])]), ...model.fixtures.flatMap(f => [f.source, ...(f.heightMeasurement ? [f.heightMeasurement.source] : [])]), ...(model.surfaces || []).flatMap(s => [s.source, ...s.measurements.map(m => m.source)]), ...(model.envelope ? [model.envelope.source, ...model.envelope.levels.map(l => l.source), ...(model.envelope.variants || []).map(v => v.source)] : []), ...(model.areaSchedule ? [model.areaSchedule.source] : [])];
}

export function parseCorrection(kind: "room" | "fixture", value: unknown, model: HouseModel): RoomCorrection | FixtureCorrection {
  const v = object(value), out: Record<string, unknown> = {};
  const allowed = kind === "room" ? ["name", "height", "finishes", "notes", "coverage"] : ["type", "circuit", "specifications", "position", "height", "status", "roomId", "removed"];
  for (const [key, item] of Object.entries(v)) {
    if (!allowed.includes(key)) fail("Unsupported correction field");
    if (key === "height") out[key] = kind === "room" ? measurement(item) : number(item, 0, 30);
    else if (key === "position") out[key] = point(item);
    else if (key === "coverage") out[key] = coverage(item);
    else if (key === "status") out[key] = evidence(item);
    else if (key === "removed") out[key] = typeof item === "boolean" ? item : fail("Invalid removed flag");
    else out[key] = string(item, ["name", "type"].includes(key) ? 160 : key === "circuit" ? 100 : 2000);
  }
  if (out.roomId && !model.rooms.some(r => r.id === out.roomId)) fail("Unknown room");
  if (kind === "room" && out.height && !model.sourceDocumentIds.includes((out.height as Measurement).source.documentId)) fail("Unknown source document");
  if ("name" in out && !String(out.name).trim()) fail("Room name is required");
  return out;
}
