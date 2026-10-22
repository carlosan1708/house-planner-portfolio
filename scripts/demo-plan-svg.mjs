/** A presentation plan drawn from the same JSON HouseModel as DistributionViewer. */
const escape = value => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);
const number = value => Number(value.toFixed(3));
const areaOf = polygon => Math.abs(polygon.reduce((sum, point, index) => {
  const next = polygon[(index + 1) % polygon.length];
  return sum + point[0] * next[1] - next[0] * point[1];
}, 0)) / 2;
const boundsOf = points => ({
  minX: Math.min(...points.map(point => point[0])), maxX: Math.max(...points.map(point => point[0])),
  minY: Math.min(...points.map(point => point[1])), maxY: Math.max(...points.map(point => point[1])),
});
const centerOf = polygon => {
  let weight = 0, x = 0, y = 0;
  polygon.forEach((point, index) => {
    const next = polygon[(index + 1) % polygon.length], cross = point[0] * next[1] - next[0] * point[1];
    weight += cross; x += (point[0] + next[0]) * cross; y += (point[1] + next[1]) * cross;
  });
  if (Math.abs(weight) > 1e-8) return [x / (3 * weight), y / (3 * weight)];
  const bounds = boundsOf(polygon);
  return [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
};

/** The convex top-view footprint of a modeled box, without its hidden triangle edges. */
function footprint(vertices) {
  const points = [...new Map(vertices.map(([x, y]) => [`${x},${y}`, [x, y]])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (points.length < 3) return points;
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const half = list => {
    const result = [];
    for (const point of list) {
      while (result.length > 1 && cross(result.at(-2), result.at(-1), point) <= 0) result.pop();
      result.push(point);
    }
    return result;
  };
  return [...half(points).slice(0, -1), ...half([...points].reverse()).slice(0, -1)];
}

/**
 * Render an English, 1400 × 1050 conceptual plan. All architectural positions and
 * quantities come from the supplied model; door hinges and north are unspecified.
 * @param {import("../lib/house-distribution").HouseModel} model
 * @returns {string}
 */
export function renderDemoPlanSvg(model) {
  const wallPoints = model.walls.flatMap(wall => [wall.start, wall.end]);
  if (!wallPoints.length || !model.rooms.length) throw new Error("A plan requires modeled walls and rooms.");
  const house = boundsOf(wallPoints), width = house.maxX - house.minX, depth = house.maxY - house.minY;
  const groups = new Map();
  for (const face of model.envelope?.faces || []) {
    if (!/^demo-(?:terrace|pergola-)/.test(face.id)) continue;
    const id = face.id.replace(/-(?:bottom|top|front|back|left|right)-[12]$/, "");
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(...face.vertices);
  }
  const solids = [...groups].map(([id, vertices]) => ({ id, polygon: footprint(vertices) }));
  const terrace = solids.find(solid => solid.id === "demo-terrace");
  const pergola = solids.filter(solid => solid.id.startsWith("demo-pergola-"));
  const drawing = boundsOf([...wallPoints, ...solids.flatMap(solid => solid.polygon)]);
  const scale = Math.min(720 / (drawing.maxX - drawing.minX), 665 / (drawing.maxY - drawing.minY));
  const left = 550 - (drawing.maxX - drawing.minX) * scale / 2;
  const top = 235;
  const x = value => number(left + (value - drawing.minX) * scale);
  const y = value => number(top + (drawing.maxY - value) * scale);
  const polygon = points => points.map(point => `${x(point[0])},${y(point[1])}`).join(" ");
  const line = (a, b, attributes = "") => `<line x1="${x(a[0])}" y1="${y(a[1])}" x2="${x(b[0])}" y2="${y(b[1])}" ${attributes}/>`;
  const text = (label, tx, ty, attributes = "") => `<text x="${number(tx)}" y="${number(ty)}" ${attributes}>${escape(label)}</text>`;
  const totalArea = model.rooms.reduce((sum, room) => sum + areaOf(room.polygon), 0);
  const formatArea = value => `${Number(value.toFixed(2))} m²`;
  const roomFill = ["#e4eadd", "#ebe7d8", "#eef0e6", "#e4e8e4", "#e9e4de", "#f0eee4", "#e0e9e7", "#ebe8dd"];

  const outdoor = terrace ? `<polygon data-model-id="${escape(terrace.id)}" points="${polygon(terrace.polygon)}" fill="#eee7d7" stroke="#b5aa91" stroke-width="1.5"/>
    <polygon points="${polygon(terrace.polygon)}" fill="url(#terrace-tile)"/>` : "";
  const pergolaDrawing = pergola.sort((a, b) => Number(a.id.includes("post")) - Number(b.id.includes("post"))).map(solid => `<polygon data-model-id="${escape(solid.id)}" points="${polygon(solid.polygon)}" fill="${solid.id.includes("post") ? "#546456" : "#b49a71"}" fill-opacity="${solid.id.includes("post") ? 1 : .56}" stroke="#8a7656" stroke-width=".7"/>`).join("\n");
  const roomDrawing = model.rooms.map((room, index) => `<polygon data-model-id="${escape(room.id)}" points="${polygon(room.polygon)}" fill="${roomFill[index % roomFill.length]}" stroke="#faf9f3" stroke-width="1.4"/>`).join("\n");
  const wallDrawing = model.walls.map(wall => {
    const dx = wall.end[0] - wall.start[0], dy = wall.end[1] - wall.start[1], length = Math.hypot(dx, dy);
    if (!length) return "";
    const point = distance => [wall.start[0] + distance * dx / length, wall.start[1] + distance * dy / length];
    const openings = model.openings.filter(opening => opening.wallId === wall.id).sort((a, b) => a.offset - b.offset);
    const parts = []; let cursor = 0;
    for (const opening of openings) {
      if (opening.offset > cursor) parts.push(line(point(cursor), point(opening.offset), `stroke-width="${number(wall.thickness * scale)}"`));
      cursor = Math.max(cursor, opening.offset + opening.width);
    }
    if (cursor < length) parts.push(line(point(cursor), point(length), `stroke-width="${number(wall.thickness * scale)}"`));
    return `<g data-model-id="${escape(wall.id)}" stroke="#344e40" stroke-linecap="butt">${parts.join("")}</g>`;
  }).join("\n");
  const openingDrawing = model.openings.map(opening => {
    const wall = model.walls.find(candidate => candidate.id === opening.wallId);
    if (!wall) return "";
    const dx = wall.end[0] - wall.start[0], dy = wall.end[1] - wall.start[1], length = Math.hypot(dx, dy);
    if (!length) return "";
    const u = [dx / length, dy / length], normal = [-u[1], u[0]];
    const at = (distance, offset = 0) => [wall.start[0] + u[0] * distance + normal[0] * offset, wall.start[1] + u[1] * distance + normal[1] * offset];
    const start = opening.offset, end = start + opening.width, glazed = opening.kind === "window" || opening.glazed;
    const marks = [];
    if (glazed) {
      for (const offset of [-.027, .027]) marks.push(line(at(start, offset), at(end, offset), 'stroke="#67988f" stroke-width="1.6"'));
      const panels = Math.max(1, Math.round(opening.width / 1.2));
      for (let panel = 1; panel < panels; panel++) marks.push(line(at(start + opening.width * panel / panels, -.065), at(start + opening.width * panel / panels, .065), 'stroke="#67988f" stroke-width="1.4"'));
    } else {
      marks.push(line(at(start), at(end), 'stroke="#aa8960" stroke-width="2.8"'));
    }
    for (const position of [start, end]) marks.push(line(at(position, -wall.thickness / 2), at(position, wall.thickness / 2), 'stroke="#344e40" stroke-width="1.5"'));
    return `<g data-model-id="${escape(opening.id)}"><title>${escape(opening.glazed ? "Glazed door" : opening.kind === "window" ? "Window" : "Door")} · ${opening.width.toFixed(2)} m</title>${marks.join("")}</g>`;
  }).join("\n");
  const roomLabels = model.rooms.map(room => {
    const [cx, cy] = centerOf(room.polygon), bounds = boundsOf(room.polygon), compact = (bounds.maxY - bounds.minY) * scale < 70;
    return compact
      ? text(`${room.name} · ${formatArea(areaOf(room.polygon))}`, x(cx), y(cy) + 5, 'class="room-label compact" text-anchor="middle"')
      : `${text(room.name, x(cx), y(cy) - 4, 'class="room-label" text-anchor="middle"')}${text(formatArea(areaOf(room.polygon)), x(cx), y(cy) + 21, 'class="room-area" text-anchor="middle"')}`;
  }).join("\n");
  const terraceLabel = terrace ? (() => {
    const [cx, cy] = centerOf(terrace.polygon), bounds = boundsOf(terrace.polygon);
    return `<rect x="${number(x(cx) - 116)}" y="${number(y(cy) - 37)}" width="232" height="73" rx="6" fill="#f8f4e9" fill-opacity=".94"/>
      ${text("OPEN TERRACE · PERGOLA", x(cx), y(cy) - 13, 'class="outdoor-label" text-anchor="middle"')}
      ${text(`${formatArea(areaOf(terrace.polygon))} · ${(bounds.maxX - bounds.minX).toFixed(2)} × ${(bounds.maxY - bounds.minY).toFixed(2)} m`, x(cx), y(cy) + 10, 'class="room-area" text-anchor="middle"')}
      ${text("Separate from enclosed floor area", x(cx), y(cy) + 29, 'font-size="10" fill="#7b7969" text-anchor="middle"')}`;
  })() : "";
  const dimensionX = x(house.minX) - 48, dimensionY = y(house.maxY) - 34;
  const dimensions = `<g fill="none" stroke="#a0aa9d" stroke-width="1">
      <path d="M${x(house.minX)} ${y(house.maxY) - 13}V${dimensionY - 9}M${x(house.maxX)} ${y(house.maxY) - 13}V${dimensionY - 9}M${x(house.minX)} ${dimensionY}H${x(house.maxX)}"/>
      <path d="M${x(house.minX) - 13} ${y(house.minY)}H${dimensionX - 9}M${x(house.minX) - 13} ${y(house.maxY)}H${dimensionX - 9}M${dimensionX} ${y(house.minY)}V${y(house.maxY)}"/>
      <path d="M${x(house.minX) - 4} ${dimensionY + 5}l8-10M${x(house.maxX) - 4} ${dimensionY + 5}l8-10M${dimensionX - 5} ${y(house.minY) + 4}l10-8M${dimensionX - 5} ${y(house.maxY) + 4}l10-8"/>
    </g>
    <rect x="${number((x(house.minX) + x(house.maxX)) / 2 - 48)}" y="${dimensionY - 12}" width="96" height="24" fill="#fffefa"/>
    ${text(`${width.toFixed(2)} m`, (x(house.minX) + x(house.maxX)) / 2, dimensionY + 4, 'class="dimension" text-anchor="middle"')}
    <g transform="translate(${dimensionX} ${(y(house.minY) + y(house.maxY)) / 2}) rotate(-90)"><rect x="-48" y="-12" width="96" height="24" fill="#fffefa"/><text y="4" class="dimension" text-anchor="middle">${depth.toFixed(2)} m</text></g>`;
  const schedule = model.rooms.map((room, index) => {
    const rowY = 453 + index * 34;
    return `<rect x="1050" y="${rowY - 10}" width="9" height="9" rx="2" fill="${roomFill[index % roomFill.length]}" stroke="#c7cfc1"/>
      ${text(room.name, 1069, rowY, 'font-size="12" fill="#506451"')}
      ${text(Number(areaOf(room.polygon).toFixed(2)), 1280, rowY, 'font-size="12" fill="#344e40" text-anchor="end"')}`;
  }).join("\n");
  const terraceBounds = terrace && boundsOf(terrace.polygon), rafter = pergola.find(solid => solid.id.includes("rafter"));
  const rafterBounds = rafter && boundsOf(rafter.polygon);
  const porchDetails = terraceBounds ? `${text(`Terrace ${(terraceBounds.maxX - terraceBounds.minX).toFixed(2)} × ${(terraceBounds.maxY - terraceBounds.minY).toFixed(2)} m`, 1050, 791, 'font-size="12" fill="#697565"')}
    ${rafterBounds ? text(`Pergola rafter depth ${(rafterBounds.maxY - rafterBounds.minY).toFixed(2)} m`, 1050, 813, 'font-size="12" fill="#697565"') : ""}` : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1050" viewBox="0 0 1400 1050" role="img" aria-labelledby="plan-title plan-desc">
  <title id="plan-title">${escape(model.name)} · model-derived concept plan</title>
  <desc id="plan-desc">${escape(`${formatArea(totalArea)} enclosed floor area, ${width.toFixed(2)} by ${depth.toFixed(2)} metres, ${model.rooms.length} spaces. Room polygons, wall cuts, windows, doors, terrace and pergola are drawn from the Distribution 3D model. Fictional concept; not a construction document. North and door swings are unspecified.`)}</desc>
  <defs>
    <pattern id="terrace-tile" width="${number(scale * .8)}" height="${number(scale * .8)}" patternUnits="userSpaceOnUse"><path d="M0 0H${number(scale * .8)}V${number(scale * .8)}" fill="none" stroke="#bfb59b" stroke-opacity=".32" stroke-width=".6"/></pattern>
    <style>text{font-family:Arial,Helvetica,sans-serif}.room-label{font-size:17px;font-weight:500;fill:#344e40}.room-label.compact{font-size:14px}.room-area{font-size:13px;fill:#71816f}.outdoor-label{font-size:11px;font-weight:600;letter-spacing:1.2px;fill:#6d725c}.dimension{font-size:12px;letter-spacing:1.5px;fill:#778371}</style>
  </defs>
  <rect width="1400" height="1050" fill="#f1f2ea"/>
  <rect x="32" y="32" width="1336" height="986" rx="14" fill="#fffefa" stroke="#dde3d6"/>
  ${text("HOUSE PLANNER / FICTIONAL SAMPLE PROJECT", 83, 82, 'font-size="10" letter-spacing="2.8" fill="#6c826f"')}
  ${text(model.name, 80, 130, 'font-size="34" fill="#2f4b3b"')}
  ${text(`Ground floor · ${formatArea(totalArea)} enclosed · ${model.rooms.length} spaces`, 82, 159, 'font-size="13" fill="#798674"')}
  ${text("MODEL-DERIVED PLAN", 1317, 94, 'font-size="11" letter-spacing="2" fill="#6c826f" text-anchor="end"')}
  ${text(`Distribution 3D · revision ${model.revision}`, 1317, 119, 'font-size="12" fill="#8a9382" text-anchor="end"')}
  <path d="M82 184H1318M1014 222V924" stroke="#e2e6da" stroke-width="1"/>
  ${outdoor}
  ${pergolaDrawing}
  ${roomDrawing}
  ${wallDrawing}
  ${openingDrawing}
  ${roomLabels}
  ${terraceLabel}
  ${dimensions}
  <g transform="translate(1102 267)" fill="none" stroke="#5c745d" stroke-width="1.5"><path d="M0 25V-27l-5 8m5-8 5 8M-9 25H45l-8-5m8 5-8 5"/></g>
  ${text("+Y", 1102, 225, 'font-size="12" fill="#5c745d" text-anchor="middle"')}
  ${text("+X", 1158, 296, 'font-size="12" fill="#5c745d"')}
  ${text("MODEL ORIENTATION", 1050, 332, 'font-size="10" letter-spacing="1.8" fill="#6c826f"')}
  ${text("North is not specified", 1050, 353, 'font-size="12" fill="#899180"')}
  ${text("AREA SCHEDULE", 1050, 405, 'font-size="10" letter-spacing="1.8" fill="#6c826f"')}
  ${text("m²", 1280, 405, 'font-size="12" fill="#7a8674" text-anchor="end"')}
  <path d="M1050 424H1280" stroke="#dce3d5"/>
  ${schedule}
  <path d="M1050 723H1280" stroke="#dce3d5"/>
  ${text("Enclosed total", 1050, 747, 'font-size="13" font-weight="600" fill="#344e40"')}
  ${text(formatArea(totalArea), 1280, 747, 'font-size="13" font-weight="600" fill="#344e40" text-anchor="end"')}
  ${porchDetails}
  <g transform="translate(1050 856)"><rect width="${number(scale)}" height="6" fill="#405e48"/><rect x="${number(scale)}" width="${number(scale)}" height="6" fill="#dce3d5" stroke="#405e48" stroke-width=".6"/>
    <text y="23" font-size="10" fill="#7a8674">0</text><text x="${number(scale)}" y="23" font-size="10" fill="#7a8674" text-anchor="middle">1</text><text x="${number(scale * 2)}" y="23" font-size="10" fill="#7a8674" text-anchor="middle">2 m</text></g>
  ${text("Concept scale · illustrated dimensions", 1050, 905, 'font-size="10" fill="#8a9382"')}
  <path d="M82 946H1318" stroke="#e2e6da"/>
  <g transform="translate(84 971)"><path d="M0-3H23M0 1H23" stroke="#67988f" stroke-width="1.6"/><text x="33" y="3" font-size="11" fill="#6a7b68">Glazing</text><path d="M126-1H149" stroke="#aa8960" stroke-width="2.8"/><text x="159" y="3" font-size="11" fill="#6a7b68">Door opening</text><rect x="296" y="-6" width="22" height="9" fill="#b49a71" fill-opacity=".6"/><text x="328" y="3" font-size="11" fill="#6a7b68">Pergola above</text></g>
  ${text("FICTIONAL CONCEPT · NOT FOR CONSTRUCTION", 1316, 972, 'font-size="10" letter-spacing="1.3" fill="#71816d" text-anchor="end"')}
  ${text("Architecture follows the 3D model. Roof omitted for clarity; door swings and geographical north are unspecified.", 84, 996, 'font-size="10" fill="#8b9383"')}
</svg>\n`;
}
