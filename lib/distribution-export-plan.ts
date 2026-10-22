import { polygonMetrics, type Evidence, type FixtureKind, type HouseModel, type Point, type Wall } from "@/lib/house-distribution";

const SVG_NS = "http://www.w3.org/2000/svg";
const evidenceLabels: Record<Evidence, string> = { documented: "documentada", calculated: "calculada", approximate: "aproximada", unconfirmed: "sin confirmar" };
const fixtures: Record<FixtureKind, { prefix: string; label: string; color: string }> = {
  outlet: { prefix: "T", label: "Tomacorriente", color: "#8b4d1d" },
  light: { prefix: "L", label: "Luz", color: "#b07e00" },
  switch: { prefix: "I", label: "Interruptor", color: "#6d4bb0" },
  ac: { prefix: "A", label: "Aire acondicionado", color: "#16718e" },
};

/** XML text and attributes share this escape; model strings never become SVG markup. */
function xml(value: string | number) {
  return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "").replace(/\p{Surrogate}/gu, "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
}
const metres = (value: number) => value.toFixed(2);
const pointString = (point: Point) => `${point[0]},${point[1]}`;
const line = (start: Point, end: Point, attrs = "") => `<line x1="${start[0]}" y1="${start[1]}" x2="${end[0]}" y2="${end[1]}" ${attrs}/>`;
const text = (x: number, y: number, value: string, attrs = "") => `<text x="${x}" y="${y}" ${attrs}>${xml(value)}</text>`;

function wrap(value: string, width: number): string[] {
  const result: string[] = [];
  let current = "";
  for (const word of value.replace(/\s+/g, " ").trim().split(" ")) {
    const pieces = word.match(new RegExp(`.{1,${width}}`, "gu")) || [""];
    for (const piece of pieces) {
      if (current && current.length + piece.length + 1 > width) { result.push(current); current = ""; }
      current = current ? `${current} ${piece}` : piece;
    }
  }
  if (current || !result.length) result.push(current);
  return result;
}

function wallPoint(wall: Wall, offset: number): Point {
  const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
  return [wall.start[0] + (wall.end[0] - wall.start[0]) * offset / length, wall.start[1] + (wall.end[1] - wall.start[1]) * offset / length];
}

/** Support triangles share an ID prefix; project only the saved default envelope. */
function supportFootprints(model: HouseModel) {
  const groups = new Map<string, Point[]>();
  for (const face of model.envelope?.faces || []) {
    const id = face.id.match(/^(.+-(?:column|support|post)-\d+)(?:-|$)/)?.[1];
    if (!id || face.kind !== "wall") continue;
    const points = groups.get(id) || [];
    points.push(...face.vertices.map(([x, y]): Point => [x, y]));
    groups.set(id, points);
  }
  return [...groups].map(([id, points]) => {
    const left = Math.min(...points.map(point => point[0])), right = Math.max(...points.map(point => point[0]));
    const top = Math.min(...points.map(point => point[1])), bottom = Math.max(...points.map(point => point[1]));
    return { id, left, right, top, bottom };
  }).filter(support => support.right > support.left && support.bottom > support.top);
}

/** Find a label anchor within concave polygons; this affects annotation only. */
function roomLabelPosition(polygon: Point[]) {
  const left = Math.min(...polygon.map(point => point[0])), right = Math.max(...polygon.map(point => point[0]));
  const top = Math.min(...polygon.map(point => point[1])), bottom = Math.max(...polygon.map(point => point[1]));
  const center: Point = [(left + right) / 2, (top + bottom) / 2];
  const inside = (point: Point) => {
    let result = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i], b = polygon[j];
      if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
    }
    return result;
  };
  const clearance = (point: Point) => Math.min(...polygon.map((a, index) => {
    const b = polygon[(index + 1) % polygon.length], dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
  }));
  const candidates: Point[] = [center];
  for (let x = 0; x < 13; x++) for (let y = 0; y < 13; y++) candidates.push([left + (x + .5) / 13 * (right - left), top + (y + .5) / 13 * (bottom - top)]);
  let anchor = polygon[0], space = 0;
  for (const candidate of candidates) {
    if (!inside(candidate)) continue;
    const distance = clearance(candidate);
    if (distance > space + .000001) { anchor = candidate; space = distance; }
  }
  // Long narrow strips may overlap larger spaces (for example vehicle tracks).
  // Place their numeric markers away from the larger room's central label.
  const stripAnchor: Point = [center[0], top + (bottom - top) * .25];
  if (space < .9 && bottom - top > (right - left) * 3 && inside(stripAnchor) && clearance(stripAnchor) >= space * .9) anchor = stripAnchor;
  return { anchor, compact: space < .9 };
}

/**
 * Standalone, inert plan preview. Geometry remains in model X/Y metres inside the
 * transformed plan group; annotations are in viewBox pixels. This projection
 * intentionally excludes property/roof extents and does not infer clear sizes.
 */
export function buildDistributionPlanSvg(model: HouseModel): string {
  const supports = supportFootprints(model);
  const supportPoints: Point[] = supports.flatMap(support => [[support.left, support.top], [support.right, support.bottom]] as Point[]);
  const points = [...model.rooms.flatMap(room => room.polygon), ...model.walls.flatMap(wall => [wall.start, wall.end]), ...model.fixtures.map(fixture => fixture.position), ...supportPoints];
  const minX = Math.min(...points.map(point => point[0])), maxX = Math.max(...points.map(point => point[0]));
  const minY = Math.min(...points.map(point => point[1])), maxY = Math.max(...points.map(point => point[1]));
  const width = maxX - minX, depth = maxY - minY;
  const scale = Math.min(42, 600 / width, 620 / depth);
  const planX = 74 - minX * scale, planY = 148 - minY * scale;
  const roomRows = model.rooms.map((room, index) => {
    const metric = polygonMetrics(room.polygon);
    const names = wrap(`${index + 1}. ${room.name}`, 30);
    return { room, metric, names, height: Math.max(31, names.length * 14 + 10) };
  });
  const roomTableEnd = 155 + roomRows.reduce((sum, row) => sum + row.height, 0);
  const legendY = Math.max(238 + depth * scale, roomTableEnd + 20);
  const fixtureRows = Math.ceil(model.fixtures.length / 3);
  const fixtureY = legendY + 104;
  const height = Math.max(920, fixtureY + fixtureRows * 37 + 60);
  const pieces: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="${SVG_NS}" width="1200" height="${height}" viewBox="0 0 1200 ${height}" role="img" aria-labelledby="plan-title plan-description">`,
    `<title id="plan-title">${xml(model.name)} — planta geométrica, revisión ${model.revision}</title>`,
    `<desc id="plan-description">Coordenadas X/Y en metros; X transversal, Y desde el frente hacia el fondo. Áreas calculadas de polígonos; dimensiones envolventes, no medidas libres. Alturas y evidencia conservadas en modelo.json. ${xml(model.notes)}</desc>`,
    `<style>text{font-family:Arial,sans-serif;fill:#243343} .heading{font-size:20px;font-weight:700} .small{font-size:11px} .muted{fill:#526172} .cell{font-size:11px} .room-label{font-size:.21px;font-weight:700;text-anchor:middle;paint-order:stroke;stroke:#ffffff;stroke-width:.035px;stroke-linejoin:round} .fixture-label{font-size:.13px;font-weight:700;paint-order:stroke;stroke:#ffffff;stroke-width:.035px} .wall{stroke:#273545;stroke-linecap:butt} .opening{stroke-width:.035;fill:none} .dimension{stroke:#677687;stroke-width:1;fill:none}</style>`,
    `<rect width="1200" height="${height}" fill="#ffffff"/>`,
    text(32, 36, `${model.name} · revisión ${model.revision}`, 'class="heading"'),
    text(32, 59, "Planta para diseño de interiores · unidades: metros (m) · áreas: m²", 'class="small"'),
    text(32, 78, "Áreas de polígonos y dimensiones envolventes X/Y calculadas. No equivalen a áreas netas ni a medidas libres entre acabados.", 'class="small muted"'),
    text(32, 97, "Los espacios pueden solaparse. Terreno y cubierta no se dibujan aquí; su geometría y toda la evidencia permanecen en modelo.json.", 'class="small muted"'),
    text(74, 128, "FRENTE · Y menor", 'class="small"'),
    text(710, 128, "ESPACIOS · dimensiones geométricas", 'class="small" font-weight="700"'),
    text(710, 147, "Espacio", 'class="small"'), text(915, 147, "X (m)", 'class="small"'), text(976, 147, "Y (m)", 'class="small"'), text(1041, 147, "m²", 'class="small"'), text(1097, 147, "Altura", 'class="small"'),
    `<g id="model-plan" transform="translate(${planX} ${planY}) scale(${scale})" data-coordinate-units="metres">`,
  ];

  model.rooms.forEach((room, index) => {
    const metric = polygonMetrics(room.polygon);
    const color = /^#[a-f0-9]{6}$/i.test(room.color) ? room.color : "#dfe7ec";
    const { anchor: center, compact } = roomLabelPosition(room.polygon);
    pieces.push(`<g data-room-id="${xml(room.id)}"><title>${xml(`${room.name}; área de polígono ${metres(metric.area)} m²; ${room.source.sheet}, página ${room.source.page}; ${room.height.note}; ${room.notes}`)}</title><polygon points="${room.polygon.map(pointString).join(" ")}" fill="${color}" fill-opacity=".42" stroke="#91a2ae" stroke-width=".015"/>`);
    const names = compact ? [String(index + 1)] : wrap(`${index + 1}. ${room.name}`, 20);
    names.forEach((name, row) => pieces.push(text(center[0], center[1] + (row - (names.length - 1) / 2) * .25, name, 'class="room-label"')));
    if (!compact) pieces.push(text(center[0], center[1] + (names.length + 1) / 2 * .25, `${metres(metric.area)} m²`, 'class="room-label"'));
    pieces.push("</g>");
  });

  model.walls.forEach(wall => {
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
    const openings = model.openings.filter(opening => opening.wallId === wall.id).sort((a, b) => a.offset - b.offset);
    let cursor = 0;
    pieces.push(`<g data-wall-id="${xml(wall.id)}"><title>${xml(`${wall.id}; longitud ${metres(length)} m; espesor ${metres(wall.thickness)} m; altura ${metres(wall.height)} m según modelo`)}</title>`);
    for (const opening of openings) {
      if (opening.offset > cursor) pieces.push(line(wallPoint(wall, cursor), wallPoint(wall, opening.offset), `class="wall" stroke-width="${wall.thickness}" data-wall-segment="solid"`));
      cursor = Math.max(cursor, opening.offset + opening.width);
    }
    if (cursor < length) pieces.push(line(wallPoint(wall, cursor), wall.end, `class="wall" stroke-width="${wall.thickness}" data-wall-segment="solid"`));
    pieces.push("</g>");
    for (const opening of openings) {
      const start = wallPoint(wall, opening.offset), end = wallPoint(wall, opening.offset + opening.width);
      pieces.push(`<g data-opening-id="${xml(opening.id)}" data-opening-kind="${opening.kind}"><title>${xml(`${opening.kind === "door" ? "Puerta" : "Ventana"} ${opening.id}; ancho ${metres(opening.width)} m; altura ${metres(opening.height)} m; antepecho ${metres(opening.sill)} m; ${evidenceLabels[opening.status]}; ${opening.notes || ""}`)}</title>`);
      if (opening.kind === "door") pieces.push(line(start, end, 'class="opening" stroke="#23744b" stroke-dasharray=".09 .05"'));
      else {
        const dx = (wall.end[1] - wall.start[1]) / length * .04, dy = -(wall.end[0] - wall.start[0]) / length * .04;
        pieces.push(line([start[0] + dx, start[1] + dy], [end[0] + dx, end[1] + dy], 'class="opening" stroke="#18739f"'), line([start[0] - dx, start[1] - dy], [end[0] - dx, end[1] - dy], 'class="opening" stroke="#18739f"'));
      }
      pieces.push("</g>");
    }
  });

  for (const support of supports) {
    const note = `${support.id}; huella X ${metres(support.right - support.left)} m × Y ${metres(support.bottom - support.top)} m; ${evidenceLabels[model.envelope!.status]}; ${model.envelope!.notes}`;
    pieces.push(`<g data-support-id="${xml(support.id)}"><title>${xml(note)}</title><rect x="${support.left}" y="${support.top}" width="${support.right - support.left}" height="${support.bottom - support.top}" fill="#65717e" stroke="#273545" stroke-width=".025"/></g>`);
  }

  const counts: Record<FixtureKind, number> = { outlet: 0, light: 0, switch: 0, ac: 0 };
  const fixtureEntries = model.fixtures.map(fixture => {
    const style = fixtures[fixture.kind], label = `${style.prefix}${++counts[fixture.kind]}`;
    const [x, y] = fixture.position;
    const heightLabel = !fixture.heightMeasurement || fixture.heightMeasurement.value === null ? "altura sin confirmar" : `altura ${metres(fixture.heightMeasurement.value)} m (${evidenceLabels[fixture.heightMeasurement.status]})`;
    pieces.push(`<g data-fixture-id="${xml(fixture.id)}"><title>${xml(`${label}: ${fixture.id}; ${style.label}; ${fixture.type}; X ${x} m, Y ${y} m; ${heightLabel}; ${fixture.source.sheet}, página ${fixture.source.page}`)}</title>`);
    if (fixture.kind === "light") pieces.push(`<circle cx="${x}" cy="${y}" r=".085" fill="#ffffff" stroke="${style.color}" stroke-width=".025"/>`, line([x - .055, y - .055], [x + .055, y + .055], `stroke="${style.color}" stroke-width=".02"`), line([x - .055, y + .055], [x + .055, y - .055], `stroke="${style.color}" stroke-width=".02"`));
    else pieces.push(`<rect x="${x - .075}" y="${y - .075}" width=".15" height=".15" fill="#ffffff" stroke="${style.color}" stroke-width=".025"/>`);
    pieces.push(text(x + .11, y - .06, label, 'class="fixture-label"'), "</g>");
    return { fixture, label, style, heightLabel };
  });
  pieces.push("</g>");

  const bottom = planY + maxY * scale;
  pieces.push(line([74, bottom + 23], [74 + width * scale, bottom + 23], 'class="dimension"'), line([74, bottom + 17], [74, bottom + 29], 'class="dimension"'), line([74 + width * scale, bottom + 17], [74 + width * scale, bottom + 29], 'class="dimension"'), text(74 + width * scale / 2, bottom + 41, `${metres(width)} m · envolvente X`, 'class="small" text-anchor="middle"'));
  pieces.push(text(42, 169, "+Y ↓", 'class="small"'), text(42, 189, "+X →", 'class="small"'), text(74, bottom + 62, "FONDO · Y mayor · orientación del modelo, sin norte geográfico", 'class="small muted"'), text(74, bottom + 78, `Coordenadas: X ${metres(minX)} a ${metres(maxX)} m · Y ${metres(minY)} a ${metres(maxY)} m`, 'class="small muted"'));
  let rowY = 155;
  for (const { room, names, metric, height: rowHeight } of roomRows) {
    const heightLabel = room.height.value === null ? "Pendiente" : `${metres(room.height.value)} m*`;
    pieces.push(`<g data-room-row="${xml(room.id)}"><title>${xml(`Altura ${evidenceLabels[room.height.status]}: ${room.height.note}`)}</title><rect x="706" y="${rowY}" width="468" height="${rowHeight}" fill="${model.rooms.indexOf(room) % 2 ? "#ffffff" : "#f3f6f8"}"/>`);
    names.forEach((name, index) => pieces.push(text(710, rowY + 16 + index * 14, name, 'class="cell"')));
    pieces.push(text(915, rowY + 16, metres(metric.width), 'class="cell"'), text(976, rowY + 16, metres(metric.depth), 'class="cell"'), text(1041, rowY + 16, metres(metric.area), 'class="cell"'), text(1097, rowY + 16, heightLabel, 'class="cell"'), "</g>");
    rowY += rowHeight;
  }
  pieces.push(text(710, rowY + 16, "* Evidencia y notas de altura en el JSON; no se infieren alturas.", 'class="small muted"'));
  pieces.push(text(32, legendY + 15, "LEYENDA", 'class="small" font-weight="700"'), text(32, legendY + 35, "Muros: gris oscuro · soportes: gris · puerta: verde · ventana: doble trazo azul. Los huecos interrumpen el muro.", 'class="small"'), text(32, legendY + 55, "T: tomacorriente · L: luz · I: interruptor · A: aire acondicionado. Símbolos esquemáticos; no representan tamaños de equipos.", 'class="small"'), text(32, legendY + 75, "Identificadores y posiciones de elementos capturados; la ausencia de un símbolo no confirma la ausencia de instalaciones.", 'class="small muted"'));
  fixtureEntries.forEach(({ fixture, label, style, heightLabel }, index) => {
    const column = index % 3, row = Math.floor(index / 3), x = 32 + column * 390, y = fixtureY + row * 37;
    pieces.push(`<g data-fixture-row="${xml(fixture.id)}"><title>${xml(`${fixture.type}; ${heightLabel}; ${fixture.specifications}`)}</title>`);
    const names = wrap(`${label} · ${fixture.id}`, 51);
    pieces.push(text(x, y, names[0], `class="small" fill="${style.color}"`), text(x, y + 14, `X ${metres(fixture.position[0])} m · Y ${metres(fixture.position[1])} m`, 'class="small muted"'), "</g>");
  });
  pieces.push(text(32, height - 22, "Referencia de diseño: verificar las dimensiones y alturas pendientes en obra antes de fabricar o instalar.", 'class="small muted"'), "</svg>");
  return pieces.join("\n");
}
