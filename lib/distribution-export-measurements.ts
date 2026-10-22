import { polygonMetrics, type BuildingFace, type Evidence, type HouseModel, type Point, type SourceReference } from "./house-distribution";

export type ExportMeasurement = {
  entityType: "room" | "wall" | "opening" | "fixture" | "surface" | "envelope" | "envelopeVariant" | "envelopeFace" | "support" | "areaSchedule";
  entityId: string;
  entityName: string;
  measurement: string;
  label: string;
  value: number | null;
  unit: "m" | "m²" | "%";
  status: Evidence;
  documentId: string;
  page: number;
  sheet: string;
  notes: string;
};

type Entity = Pick<ExportMeasurement, "entityType" | "entityId" | "entityName">;
type Vertex = BuildingFace["vertices"][number];
const joinNotes = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(" ");

/** Catalogues the effective model without treating display dimensions as verified measurements. */
export function buildDistributionMeasurements(model: HouseModel): ExportMeasurement[] {
  const rows: ExportMeasurement[] = [];
  const add = (entity: Entity, measurement: string, label: string, value: number | null, unit: ExportMeasurement["unit"], status: Evidence, source: SourceReference, notes: string) => {
    rows.push({ ...entity, measurement, label, value, unit, status, documentId: source.documentId, page: source.page, sheet: source.sheet, notes });
  };
  const polygon = (entity: Entity, points: Point[], source: SourceReference, notes: string) => {
    const metrics = polygonMetrics(points);
    const calculated = joinNotes("Calculado del polígono capturado; sus coordenadas completas se conservan en el JSON. Los límites pueden representar zonas o ejes y no acreditan medidas interiores libres.", notes);
    add(entity, "polygonArea", "Área del polígono / zona", metrics.area, "m²", "calculated", source, calculated);
    add(entity, "polygonPerimeter", "Perímetro del polígono", metrics.perimeter, "m", "calculated", source, calculated);
    add(entity, "polygonWidth", "Extensión del polígono en X", metrics.width, "m", "calculated", source, calculated);
    add(entity, "polygonDepth", "Extensión del polígono en Y", metrics.depth, "m", "calculated", source, calculated);
    points.forEach((point, index) => {
      const next = points[(index + 1) % points.length];
      add(entity, `polygonEdge.${index + 1}`, `Longitud del segmento ${index + 1}`, Math.hypot(next[0] - point[0], next[1] - point[1]), "m", "calculated", source, calculated);
    });
  };
  const bounds = (entity: Entity, vertices: Vertex[], status: Evidence, source: SourceReference, notes: string) => {
    if (!vertices.length) return;
    const min = [0, 1, 2].map(axis => Math.min(...vertices.map(vertex => vertex[axis])));
    const max = [0, 1, 2].map(axis => Math.max(...vertices.map(vertex => vertex[axis])));
    const basis = joinNotes("Dimensión derivada de geometría visual; no acredita sección estructural ni altura libre. Variantes son alternativas y no se suman.", notes);
    add(entity, "displayWidth", "Extensión visual en X", max[0] - min[0], "m", status, source, basis);
    add(entity, "displayDepth", "Extensión visual en Y", max[1] - min[1], "m", status, source, basis);
    add(entity, "displayHeight", "Extensión vertical visual", max[2] - min[2], "m", status, source, basis);
    add(entity, "displayMinElevation", "Cota mínima visual", min[2], "m", status, source, basis);
    add(entity, "displayMaxElevation", "Cota máxima visual", max[2], "m", status, source, basis);
  };
  const envelopeFaces = (scope: string, name: string, faces: BuildingFace[], source: SourceReference, notes: string) => {
    const supports = new Map<string, Vertex[]>();
    for (const face of faces) {
      const entity: Entity = { entityType: "envelopeFace", entityId: `${scope}:${face.id}`, entityName: `${name} · ${face.id}` };
      const basis = joinNotes(`Cara ${face.kind} del modelo visual, sin certificación de dimensiones. Triángulos de una misma superficie no son elementos constructivos independientes.`, notes);
      bounds(entity, face.vertices, "approximate", source, basis);
      const [a, b, c] = face.vertices;
      const u = b.map((coordinate, axis) => coordinate - a[axis]);
      const v = c.map((coordinate, axis) => coordinate - a[axis]);
      const area = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
      add(entity, "triangleArea", "Área geométrica del triángulo", area, "m²", "calculated", source, basis);
      face.vertices.forEach((point, index) => {
        const next = face.vertices[(index + 1) % face.vertices.length];
        add(entity, `triangleEdge.${index + 1}`, `Longitud visual de arista ${index + 1}`, Math.hypot(...point.map((coordinate, axis) => next[axis] - coordinate)), "m", "calculated", source, basis);
      });
      // Existing supports are encoded as named envelope triangles, rather than a separate structural contract.
      const supportId = face.id.match(/^(.+-(?:column|support|post)-\d+)(?:-|$)/)?.[1];
      if (supportId) supports.set(supportId, [...(supports.get(supportId) || []), ...face.vertices]);
    }
    for (const [id, vertices] of supports) {
      bounds({ entityType: "support", entityId: `${scope}:${id}`, entityName: `${name} · ${id}` }, vertices, "approximate", source,
        joinNotes("Apoyo identificado por las caras existentes del modelo. Sección y material ilustrativos; verificar en plano estructural y obra.", notes));
    }
  };

  for (const room of model.rooms) {
    const entity: Entity = { entityType: "room", entityId: room.id, entityName: room.name };
    polygon(entity, room.polygon, room.source, joinNotes(room.notes, `Acabados capturados: ${room.finishes}`));
    add(entity, "clearHeight", "Altura de habitación capturada", room.height.value, "m", room.height.status, room.height.source,
      joinNotes(room.height.value === null ? "Altura desconocida: no se sustituye por la altura visual de paredes o cubierta." : undefined, room.height.note, room.notes));
    if (room.sectionHeight) {
      const notes = "Rango aproximado bajo la cubierta dibujada en cortes respecto al piso de referencia. No acredita altura libre de cielo raso ni espesor constructivo de cubierta.";
      add(entity, "minSectionHeight", "Altura mínima bajo cubierta · cortes", room.sectionHeight.min.value, "m", room.sectionHeight.min.status, room.sectionHeight.min.source,
        joinNotes(notes, room.sectionHeight.min.note));
      add(entity, "maxSectionHeight", "Altura máxima bajo cubierta · cortes", room.sectionHeight.max.value, "m", room.sectionHeight.max.status, room.sectionHeight.max.source,
        joinNotes(notes, room.sectionHeight.max.note));
    }
  }
  for (const wall of model.walls) {
    const entity: Entity = { entityType: "wall", entityId: wall.id, entityName: wall.id };
    add(entity, "axisLength", "Longitud del eje de pared", Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]), "m", "calculated", wall.source,
      "Calculada de extremos del eje capturado. No equivale a longitud interior libre ni descuenta aberturas.");
    add(entity, "displayThickness", "Espesor visual de pared", wall.thickness, "m", "unconfirmed", wall.source,
      "Espesor usado por el modelo visual; el contrato no contiene evidencia que certifique este espesor.");
    add(entity, "displayHeight", "Altura visual de pared", wall.height, "m", "unconfirmed", wall.source,
      "Altura usada por el modelo visual; no acredita altura libre de cielo ni una altura de pared documentada.");
  }
  for (const opening of model.openings) {
    const entity: Entity = { entityType: "opening", entityId: opening.id, entityName: `${opening.kind} · ${opening.id}` };
    const references = opening.references?.map(ref => `${ref.documentId}: página ${ref.page}, ${ref.sheet}`).join("; ");
    const notes = joinNotes(`Pared: ${opening.wallId}. Espacios: ${opening.roomIds.join(", ")}. Estado heredado de la abertura capturada.`, opening.notes,
      references ? `Referencias adicionales: ${references}.` : undefined);
    add(entity, "width", "Ancho de abertura", opening.width, "m", opening.status, opening.source, notes);
    add(entity, "height", "Alto de abertura", opening.height, "m", opening.status, opening.source, notes);
    add(entity, "sill", "Antepecho / cota inferior", opening.sill, "m", opening.status, opening.source, notes);
    add(entity, "offset", "Distancia desde inicio del eje de pared", opening.offset, "m", opening.status, opening.source, notes);
  }
  for (const fixture of model.fixtures) {
    const entity: Entity = { entityType: "fixture", entityId: fixture.id, entityName: fixture.type };
    const notes = joinNotes(`Espacio: ${fixture.roomId}. Tipo: ${fixture.kind}. Estado del equipo: ${fixture.status}. Circuito: ${fixture.circuit || "sin confirmar"}. Montaje: ${fixture.mount || "sin especificar"}.`, fixture.specifications);
    add(entity, "positionX", "Coordenada X capturada del equipo", fixture.position[0], "m", "approximate", fixture.source,
      joinNotes("Posición capturada en planta; el montaje visual puede desplazar el símbolo para apoyarlo. No acredita replanteo exacto.", notes));
    add(entity, "positionY", "Coordenada Y capturada del equipo", fixture.position[1], "m", "approximate", fixture.source,
      joinNotes("Posición capturada en planta; el montaje visual puede desplazar el símbolo para apoyarlo. No acredita replanteo exacto.", notes));
    add(entity, "displayHeight", "Altura nominal del símbolo visual", fixture.height, "m", "unconfirmed", fixture.source,
      joinNotes("Valor usado para representar el equipo. No es altura documentada; el visor puede ajustarla al apoyo. Consultar heightMeasurement para la evidencia de altura.", notes));
    const height = fixture.heightMeasurement;
    add(entity, "heightMeasurement", "Altura de montaje con evidencia", height?.value ?? null, "m", height?.status ?? "unconfirmed", height?.source ?? fixture.source,
      joinNotes(height?.note || "No existe medida de altura con evidencia en el modelo; se conserva desconocida.", notes));
  }
  for (const surface of model.surfaces || []) {
    const entity: Entity = { entityType: "surface", entityId: surface.id, entityName: surface.kind };
    polygon(entity, surface.polygon, surface.source, surface.notes);
    surface.measurements.forEach((measurement, index) => {
      add(entity, `measurement.${index + 1}`, measurement.label.es, measurement.value, measurement.unit, measurement.status, measurement.source, joinNotes(measurement.note, surface.notes));
    });
  }
  if (model.envelope) {
    const envelope = model.envelope;
    const entity: Entity = { entityType: "envelope", entityId: "default", entityName: "Envolvente predeterminada" };
    envelope.levels.forEach((level, index) => {
      add(entity, `level.${index + 1}`, level.label.es, level.value, "m", level.status, level.source, joinNotes("Nivel de referencia; no acredita altura libre por habitación.", level.note, envelope.notes));
    });
    bounds(entity, envelope.faces.flatMap(face => face.vertices), "approximate", envelope.source, envelope.notes);
    envelopeFaces("default", entity.entityName, envelope.faces, envelope.source, envelope.notes);
    if (envelope.roofUnderside) {
      const notes = joinNotes("Cara inferior de cubierta trazada de cortes; aproximada, respecto al piso de referencia. No establece la posición ni altura libre del cielo raso.", envelope.notes);
      bounds({ entityType: "envelope", entityId: "roofUnderside", entityName: "Cara inferior bajo cubierta · cortes" }, envelope.roofUnderside.flatMap(face => face.vertices), "approximate", envelope.source, notes);
      envelopeFaces("roofUnderside", "Cara inferior bajo cubierta · cortes", envelope.roofUnderside, envelope.source, notes);
    }
    for (const variant of envelope.variants || []) {
      const variantEntity: Entity = { entityType: "envelopeVariant", entityId: variant.id, entityName: variant.label.es };
      const notes = joinNotes("Variante alternativa; no combinar ni sumar con la envolvente predeterminada.", variant.notes);
      bounds(variantEntity, variant.faces.flatMap(face => face.vertices), "approximate", variant.source, notes);
      envelopeFaces(`variant:${variant.id}`, variant.label.es, variant.faces, variant.source, notes);
    }
  }
  if (model.areaSchedule) {
    const schedule = model.areaSchedule;
    const notes = joinNotes("Área transcrita del cuadro del plano; se distingue del área calculada de zonas. Espacios y zonas pueden superponerse; no sumarlos automáticamente.", schedule.notes);
    schedule.entries.forEach((entry, index) => {
      add({ entityType: "areaSchedule", entityId: `entry.${index + 1}`, entityName: entry.label }, "statedArea", "Área indicada en cuadro del plano", entry.area, "m²", "documented", schedule.source,
        joinNotes(`Espacios asociados: ${entry.roomIds.join(", ")}.`, notes));
    });
    add({ entityType: "areaSchedule", entityId: "total", entityName: "Total indicado en plano" }, "statedTotal", "Área total indicada en plano", schedule.statedTotal, "m²", "documented", schedule.source, notes);
    add({ entityType: "areaSchedule", entityId: "entry-sum", entityName: "Suma de renglones del cuadro" }, "entrySum", "Suma aritmética de áreas de renglones", schedule.entries.reduce((total, entry) => total + entry.area, 0), "m²", "calculated", schedule.source,
      joinNotes("Esta suma no sustituye el total indicado; conservar cualquier diferencia entre ambos.", notes));
  }
  return rows;
}

const CSV_COLUMNS: (keyof ExportMeasurement)[] = ["entityType", "entityId", "entityName", "measurement", "label", "value", "unit", "status", "documentId", "page", "sheet", "notes"];

/** UTF-8 CSV with a BOM for spreadsheet readers; text cells cannot execute formulas. */
export function distributionMeasurementsCsv(rows: ExportMeasurement[]): string {
  const cell = (value: string | number | null) => {
    if (value === null) return "";
    if (typeof value === "number") return String(value);
    const safe = /^[\t\r\n]|^\s*[=+\-@]/u.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return `\uFEFF${[CSV_COLUMNS.map(cell).join(","), ...rows.map(row => CSV_COLUMNS.map(key => cell(row[key])).join(","))].join("\r\n")}\r\n`;
}
