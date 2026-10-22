import type { BuildingFace, DistributionRecord, Fixture, FixtureKind, HouseModel, Point, Room, SourceReference } from "./house-distribution";

export const DEMO_DISTRIBUTION_DOCUMENT_ID = "demo-mirador-concept";
const source: SourceReference = { documentId: DEMO_DISTRIBUTION_DOCUMENT_ID, page: 1, sheet: "DEMO · M-01" };
const rectangle = (x: number, y: number, width: number, depth: number): Point[] => [[x, y], [x + width, y], [x + width, y + depth], [x, y + depth]];
type Vertex = [number, number, number];

/** Closed solids remain architectural geometry when the viewer orbits beneath the pergola. */
function boxFaces(id: string, min: Vertex, max: Vertex): BuildingFace[] {
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  const sides: Array<[string, [Vertex, Vertex, Vertex, Vertex]]> = [
    ["bottom", [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]]],
    ["top", [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
    ["front", [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
    ["back", [[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]]],
    ["left", [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]]],
    ["right", [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]],
  ];
  return sides.flatMap(([side, [a, b, c, d]]) => [
    { id: `${id}-${side}-1`, kind: "wall" as const, vertices: [a, b, c] },
    { id: `${id}-${side}-2`, kind: "wall" as const, vertices: [a, c, d] },
  ]);
}

/** An invented example, authored independently of every private project model. */
export function createDemoDistributionRecord(language: "en" | "es" = "en"): DistributionRecord {
  const tr = (en: string, es: string) => language === "es" ? es : en;
  const note = tr("Fictional concept dimensions for exploring the demo; not a construction plan.", "Medidas de un concepto ficticio para explorar la demo; no es un plano constructivo.");
  const definitions: Array<{ id: string; name: [string, string]; x: number; y: number; width: number; depth: number; color: string; finish: [string, string] }> = [
    { id: "demo-living", name: ["Living & dining", "Sala y comedor"], x: 0, y: 0, width: 6, depth: 5, color: "#d7e6cf", finish: ["Warm limestone porcelain · oak accents", "Porcelanato caliza cálida · detalles en roble"] },
    { id: "demo-kitchen", name: ["Kitchen", "Cocina"], x: 6, y: 0, width: 3, depth: 5, color: "#f0dfbc", finish: ["Sage cabinetry · quartz worktop", "Muebles verde salvia · sobre de cuarzo"] },
    { id: "demo-entry", name: ["Entry", "Entrada"], x: 9, y: 0, width: 3, depth: 5, color: "#c8d9b8", finish: ["Textured porcelain · timber entrance door", "Porcelanato texturizado · puerta de madera"] },
    { id: "demo-bedroom", name: ["Guest bedroom", "Dormitorio de visitas"], x: 0, y: 6, width: 4.5, depth: 4, color: "#d7dfea", finish: ["Oak effect flooring · linen curtains", "Piso tipo roble · cortinas de lino"] },
    { id: "demo-primary", name: ["Primary bedroom", "Dormitorio principal"], x: 4.5, y: 6, width: 4.5, depth: 4, color: "#e4d8e7", finish: ["Oak effect flooring · clay feature wall", "Piso tipo roble · pared de acento arcilla"] },
    { id: "demo-hall", name: ["Hall", "Pasillo"], x: 0, y: 5, width: 12, depth: 1, color: "#e8e7db", finish: ["Continuous porcelain floor · skylight", "Porcelanato continuo · tragaluz"] },
    { id: "demo-bathroom", name: ["Bathroom", "Baño"], x: 9, y: 6, width: 3, depth: 3, color: "#cce1e3", finish: ["Terrazzo floor · brushed brass fittings", "Piso terrazo · grifería latón cepillado"] },
    { id: "demo-laundry", name: ["Laundry", "Lavandería"], x: 9, y: 9, width: 3, depth: 1, color: "#e7decf", finish: ["Non-slip porcelain · laundry closet", "Porcelanato antideslizante · armario de lavandería"] },
  ];
  const rooms: Room[] = definitions.map(room => ({
    id: room.id, name: tr(...room.name), polygon: rectangle(room.x, room.y, room.width, room.depth), color: room.color, source: { ...source },
    height: { value: 2.8, status: "approximate", source: { ...source }, note }, finishes: tr(...room.finish), notes: note,
    coverage: { outlet: "reviewed", light: "reviewed", switch: "reviewed", ac: "reviewed" },
  }));
  const wallDefinitions: Array<[string, Point, Point]> = [
    ["front", [0, 0], [12, 0]], ["demo-right", [12, 0], [12, 10]], ["demo-back", [0, 10], [12, 10]], ["demo-left", [0, 0], [0, 10]],
    ["demo-public-hall", [0, 5], [12, 5]], ["demo-private-hall", [0, 6], [12, 6]],
    ["demo-bedrooms", [4.5, 6], [4.5, 10]], ["demo-bedroom-bath", [9, 6], [9, 10]], ["demo-bath-laundry", [9, 9], [12, 9]],
  ];
  const walls = wallDefinitions.map(([id, start, end]) => ({ id, start, end, thickness: .15, height: 2.8, source: { ...source } }));
  const openingDefinitions: Array<[string, string, string[], "door" | "window", number, number]> = [
    ["demo-front-door", "front", ["demo-entry"], "door", 10, 1.1],
    ["demo-living-garden-door", "front", ["demo-living"], "door", .7, 4.2],
    ["demo-kitchen-window", "front", ["demo-kitchen"], "window", 6.5, 1.8],
    ["demo-living-hall", "demo-public-hall", ["demo-living", "demo-hall"], "door", 4.2, 1.5],
    ["demo-entry-hall", "demo-public-hall", ["demo-entry", "demo-hall"], "door", 10, 1.1],
    ["demo-guest-entry", "demo-private-hall", ["demo-bedroom", "demo-hall"], "door", 3.3, .85],
    ["demo-primary-entry", "demo-private-hall", ["demo-primary", "demo-hall"], "door", 7.8, .85],
    ["demo-bath-entry", "demo-private-hall", ["demo-bathroom", "demo-hall"], "door", 9.3, .8],
    ["demo-laundry-entry", "demo-bath-laundry", ["demo-bathroom", "demo-laundry"], "door", .3, 1.4],
    ["demo-guest-window", "demo-back", ["demo-bedroom"], "window", 1, 2],
    ["demo-primary-window", "demo-back", ["demo-primary"], "window", 5.5, 2],
    ["demo-bath-window", "demo-right", ["demo-bathroom"], "window", 6.7, 1.2],
  ];
  const openings = openingDefinitions.map(([id, wallId, roomIds, kind, offset, width]) => ({
    id, wallId, roomIds, kind, offset, width, height: id === "demo-living-garden-door" ? 2.35 : kind === "door" ? 2.2 : 1.2, sill: kind === "door" ? 0 : 1,
    ...(id === "demo-living-garden-door" ? { glazed: true } : {}),
    source: { ...source }, status: "approximate" as const, notes: note,
  }));
  const fixtureNames: Record<FixtureKind, string> = {
    light: tr("LED ceiling light", "Luz LED de cielo"), outlet: tr("Double outlet", "Tomacorriente doble"),
    switch: tr("Light switch", "Apagador"), ac: tr("Inverter AC unit", "Aire acondicionado inverter"),
  };
  const fixtures: Fixture[] = [];
  for (const room of definitions) {
    const addFixture = (kind: FixtureKind, suffix: string, x: number, y: number, height: number) => fixtures.push({
      id: `${room.id}-${kind}-${suffix}`, roomId: room.id, kind, type: fixtureNames[kind], position: [x, y], height,
      ...(kind === "light" ? { mount: "ceiling" as const } : {}), circuit: `${kind === "light" || kind === "switch" ? "L" : kind === "ac" ? "AC" : "P"}-${definitions.indexOf(room) + 1}`,
      specifications: kind === "light" ? tr("Warm white · 3000 K · fictional specification", "Luz cálida · 3000 K · especificación ficticia") : note,
      status: "approximate", source: { ...source }, heightMeasurement: { value: height, status: "approximate", note, source: { ...source } },
    });
    addFixture("light", "1", room.x + room.width / 2, room.y + room.depth / 2, 2.8);
    addFixture("outlet", "1", room.x + .2, room.y + room.depth / 2, .4);
    addFixture("switch", "1", room.x + room.width - .2, room.y + .4, 1.1);
    if (["demo-living", "demo-kitchen", "demo-bedroom", "demo-primary"].includes(room.id)) addFixture("outlet", "2", room.x + room.width / 2, room.y + .2, .4);
    if (["demo-living", "demo-bedroom", "demo-primary"].includes(room.id)) addFixture("ac", "1", room.x + room.width / 2, room.y + room.depth - .2, 2.4);
  }
  const roofFaces: BuildingFace[] = [
    { id: "demo-roof-west-1", kind: "roof", vertices: [[-.4, -.4, 2.9], [6, -.4, 4.1], [6, 10.4, 4.1]] },
    { id: "demo-roof-west-2", kind: "roof", vertices: [[-.4, -.4, 2.9], [6, 10.4, 4.1], [-.4, 10.4, 2.9]] },
    { id: "demo-roof-east-1", kind: "roof", vertices: [[6, -.4, 4.1], [12.4, -.4, 2.9], [12.4, 10.4, 2.9]] },
    { id: "demo-roof-east-2", kind: "roof", vertices: [[6, -.4, 4.1], [12.4, 10.4, 2.9], [6, 10.4, 4.1]] },
    // Close the gable to the actual roof plane at the wall, inside the 0.4 m eave.
    { id: "demo-gable-front-band-1", kind: "wall", vertices: [[0, 0, 2.8], [12, 0, 2.8], [12, 0, 2.975]] },
    { id: "demo-gable-front-band-2", kind: "wall", vertices: [[0, 0, 2.8], [12, 0, 2.975], [0, 0, 2.975]] },
    { id: "demo-gable-front", kind: "wall", vertices: [[0, 0, 2.975], [12, 0, 2.975], [6, 0, 4.1]] },
    { id: "demo-gable-back-band-1", kind: "wall", vertices: [[0, 10, 2.8], [12, 10, 2.975], [12, 10, 2.8]] },
    { id: "demo-gable-back-band-2", kind: "wall", vertices: [[0, 10, 2.8], [0, 10, 2.975], [12, 10, 2.975]] },
    { id: "demo-gable-back", kind: "wall", vertices: [[0, 10, 2.975], [6, 10, 4.1], [12, 10, 2.975]] },
  ];
  const terraceNote = tr(
    "Open limestone terrace: 8.9 × 3.25 m (28.925 m²), separate from the enclosed 120 m². Timber pergola: 8.9 × 3 m bay, two 0.18 m square posts and six 0.16 m wide, 3.05 m long rafters; top at 2.85 m. The pergola is open and does not increase the weather roof area.",
    "Terraza abierta de caliza: 8,9 × 3,25 m (28,925 m²), independiente de los 120 m² cerrados. Pérgola de madera: módulo de 8,9 × 3 m, dos postes cuadrados de 0,18 m y seis vigas de 0,16 m de ancho y 3,05 m de largo; coronación a 2,85 m. La pérgola es abierta y no aumenta el área de cubierta impermeable.",
  );
  const terraceFaces = [
    ...boxFaces("demo-terrace", [0, -3.25, -.18], [8.9, 0, -.06]),
    ...[.15, 8.55].flatMap((x, index) => boxFaces(`demo-pergola-post-${index + 1}`, [x, -2.9, -.06], [x + .18, -2.72, 2.5])),
    ...boxFaces("demo-pergola-beam-front", [0, -3, 2.5], [8.9, -2.78, 2.72]),
    ...boxFaces("demo-pergola-beam-back", [0, -.25, 2.5], [8.9, -.03, 2.72]),
    ...Array.from({ length: 6 }, (_, index) => {
      const x = .15 + index * (8.55 - .15) / 5;
      return boxFaces(`demo-pergola-rafter-${index + 1}`, [x, -3.05, 2.72], [x + .16, 0, 2.85]);
    }).flat(),
  ];
  const model: HouseModel = {
    schemaVersion: 1, name: "Casa Mirador", revision: 2, sourceDocumentIds: [DEMO_DISTRIBUTION_DOCUMENT_ID], rooms, walls, openings, fixtures,
    surfaces: [
      { id: "roof", kind: "roof", polygon: rectangle(-.4, -.4, 12.8, 10.8), source: { ...source }, notes: note, measurements: [
        { label: { en: "Ridge height", es: "Altura de cumbrera" }, value: 4.1, status: "approximate", note, source: { ...source }, unit: "m" },
        { label: { en: "Eave projection", es: "Proyección del alero" }, value: .4, status: "approximate", note, source: { ...source }, unit: "m" },
      ] },
      { id: "demo-property", kind: "property", polygon: rectangle(-2, -4, 16, 21), source: { ...source }, notes: `${note} ${terraceNote}`, measurements: [
        { label: { en: "Concept lot area", es: "Área del lote conceptual" }, value: 336, status: "calculated", note, source: { ...source }, unit: "m²" },
        { label: { en: "Open terrace area", es: "Área de terraza abierta" }, value: 28.925, status: "calculated", note: terraceNote, source: { ...source }, unit: "m²" },
        { label: { en: "Terrace width", es: "Ancho de terraza" }, value: 8.9, status: "approximate", note: terraceNote, source: { ...source }, unit: "m" },
        { label: { en: "Terrace depth", es: "Fondo de terraza" }, value: 3.25, status: "approximate", note: terraceNote, source: { ...source }, unit: "m" },
        { label: { en: "Pergola bay depth", es: "Fondo del módulo de pérgola" }, value: 3, status: "approximate", note: terraceNote, source: { ...source }, unit: "m" },
        { label: { en: "Pergola rafter length", es: "Largo de vigas de pérgola" }, value: 3.05, status: "approximate", note: terraceNote, source: { ...source }, unit: "m" },
        { label: { en: "Pergola top height", es: "Altura de coronación de pérgola" }, value: 2.85, status: "approximate", note: terraceNote, source: { ...source }, unit: "m" },
      ] },
    ],
    envelope: { source: { ...source }, status: "approximate", notes: `${note} ${terraceNote}`, faces: [...roofFaces, ...terraceFaces], levels: [
      { label: { en: "Ceiling", es: "Cielo" }, value: 2.8, status: "approximate", note, source: { ...source } },
      { label: { en: "Roof ridge", es: "Cumbrera" }, value: 4.1, status: "approximate", note, source: { ...source } },
    ] },
    notes: `${tr("An invented 12 × 10 m, 120 m² concept on a 336 m² example lot. Explore eight spaces, fixtures, roof volume and local corrections. Every dimension and source in this model is fictional.", "Concepto inventado de 12 × 10 m y 120 m², en un lote de ejemplo de 336 m². Explora ocho espacios, equipos, volumen del techo y correcciones locales. Todas las medidas y fuentes de este modelo son ficticias.")} ${terraceNote}`,
  };
  return { model, roomCorrections: {}, fixtureCorrections: {}, revision: 2, updatedAt: "2026-10-19T12:00:00.000Z" };
}
