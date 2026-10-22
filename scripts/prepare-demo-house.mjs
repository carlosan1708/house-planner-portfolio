/** Invented regression fixture. It is not derived from a client plan and never uploads data. */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function createDemoHouse(documentId = "synthetic-plan") {
  const source = { documentId, page: 1, sheet: "Invented demo layout" };
  const measurement = (value, status = "approximate") => ({ value, status, source,
    note: "Synthetic test evidence; no real construction measurement." });
  const room = (id, name, polygon, color) => ({ id, name, polygon, color, source,
    height: measurement(null, "unconfirmed"), finishes: "Fictional finish", notes: "Invented room.",
    coverage: { outlet: "reviewed", light: "reviewed", switch: "partial", ac: "unconfirmed" } });
  const rooms = [
    room("living", "Living room", [[0, 0], [4, 0], [4, 6], [0, 6]], "#b4cfa7"),
    room("office", "Office", [[4, 0], [8, 0], [8, 6], [4, 6]], "#d8bfa7"),
    room("terrace", "Terrace", [[-3, 0], [0, 0], [0, 6], [-3, 6]], "#c9d5e3"),
    room("exterior", "Exterior reference zone", [[-4, -2], [10, -2], [10, 8], [-4, 8]], "#d3dfc4"),
  ];
  rooms[1].sectionHeight = { min: measurement(2.92), max: measurement(3.32) };
  const wall = (id, start, end) => ({ id, start, end, thickness: .18, height: 3.6, source });
  const walls = [wall("front", [0, 0], [8, 0]), wall("right", [8, 0], [8, 6]),
    wall("back", [8, 6], [0, 6]), wall("left", [0, 6], [0, 0]), wall("partition", [4, 0], [4, 6])];
  const openings = [
    { id: "entry", wallId: "front", roomIds: ["living"], kind: "door", offset: 1, width: 1,
      height: 2.1, sill: 0, source, status: "approximate", notes: "Invented entrance." },
    { id: "office-window", wallId: "front", roomIds: ["office"], kind: "window", offset: 5,
      width: 1.2, height: 1.2, sill: 1, source, status: "unconfirmed", references: [source] },
    { id: "shared-door", wallId: "partition", roomIds: ["living", "office"], kind: "door",
      offset: 2, width: .9, height: 2.1, sill: 0, source, status: "approximate" },
  ];
  const fixture = (id, roomId, kind, position, height, mount) => ({ id, roomId, kind, position,
    height, ...(mount ? { mount } : {}), heightMeasurement: measurement(null, "unconfirmed"),
    type: mount ? `${mount} light` : kind, circuit: "DEMO-1", specifications: "Invented installation.",
    status: "approximate", source });
  const fixtures = [
    fixture("living-outlet", "living", "outlet", [.2, 3], .35),
    fixture("office-outlet", "office", "outlet", [7.8, 3], .35),
    fixture("ceiling-light", "living", "light", [2, 2], 2.7, "ceiling"),
    fixture("pendant-light", "office", "light", [6, 2], 2.7, "pendant"),
    fixture("wall-light", "exterior", "light", [1.5, -.12], 1.4, "wall"),
    fixture("ground-light", "exterior", "light", [-2, -1], .7, "ground"),
    fixture("switch", "living", "switch", [2.1, .12], 1.2),
    fixture("ac", "office", "ac", [7.8, 4], 2.3),
  ];
  const roof = (prefix, start, end) => [
    { id: `${prefix}-1`, kind: "roof", vertices: [[0, 0, start], [8, 0, end], [8, 6, end]] },
    { id: `${prefix}-2`, kind: "roof", vertices: [[0, 0, start], [8, 6, end], [0, 6, start]] },
  ];
  return {
    schemaVersion: 1, name: "Demo Pavilion", revision: 1, sourceDocumentIds: [documentId],
    rooms, walls, openings, fixtures,
    surfaces: [{ id: "roof-projection", kind: "roof", polygon: [[0, 0], [8, 0], [8, 6], [0, 6]],
      source, notes: "Synthetic projection; not certified quantities.", measurements: [
        { ...measurement(48, "calculated"), label: { en: "Projection area", es: "Área proyectada" }, unit: "m²" },
      ] }],
    envelope: { source, status: "approximate", notes: "Entire envelope is invented for regression tests.",
      faces: roof("roof", 2.6, 3.4), roofUnderside: roof("underside", 2.52, 3.32),
      variants: [{ id: "flat", label: { en: "Flat demo roof", es: "Cubierta plana demo" }, source,
        notes: "Independent synthetic alternative.", faces: roof("flat", 3.1, 3.1) }],
      levels: [{ ...measurement(0), label: { en: "Reference floor", es: "Piso de referencia" } },
        { ...measurement(3.4), label: { en: "Illustrative roof", es: "Techo ilustrativo" } }],
    },
    areaSchedule: { source, entries: [{ label: "Interior example", roomIds: ["living", "office"], area: 48 }],
      statedTotal: 50, notes: "Deliberate synthetic mismatch for evidence handling; exterior zones overlap." },
    notes: "Invented regression fixture. No real building, owner, source plan or client geometry is represented.",
  };
}

const output = process.argv[2] || "outputs/house-distribution/demo-house.json";
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(createDemoHouse(process.argv[3]), null, 2)}\n`);
console.log(`Synthetic model written to ${output}; nothing was uploaded.`);
