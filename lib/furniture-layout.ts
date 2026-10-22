import type { HouseModel, Point, Room } from "./house-distribution";
import { wallFurniturePlacements, type WallPlacement } from "./furniture-wall-placement";
import { furnitureEntranceClearances } from "./furniture-circulation";

export type FurnitureKind = "sofa" | "coffee-table" | "rug" | "dining-table" | "chair" | "kitchen-counter" | "fridge" | "bed" | "nightstand" | "wardrobe" | "desk" | "vanity" | "shower" | "toilet" | "washer" | "console" | "plant" | "bench";
export type FurnitureItem = {
  id: string; roomId: string; kind: FurnitureKind; position: Point; rotation: number;
  width: number; depth: number; height: number; label: { en: string; es: string }; elevation?: number;
};
export type FurnitureZone = { id: string; name: { en: string; es: string }; polygon: Point[]; elevation: number };
export type FurnitureLayout = { items: FurnitureItem[]; unfurnishedRoomIds: string[]; zones?: FurnitureZone[] };

type Candidate = { kind: FurnitureKind; width: number; depth: number; height: number; label: [string, string]; preferred: [number, number]; rotation?: number; decorative?: boolean };
const tolerance = .00001;

export function furnitureFootprint(item: Pick<FurnitureItem, "position" | "rotation" | "width" | "depth">, padding = 0): Point[] {
  const cosine = Math.cos(item.rotation), sine = Math.sin(item.rotation);
  return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y]) => {
    const dx = x * (item.width / 2 + padding), dy = y * (item.depth / 2 + padding);
    return [item.position[0] + dx * cosine - dy * sine, item.position[1] + dx * sine + dy * cosine];
  });
}

function cross(a: Point, b: Point, c: Point) { return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]); }
function segmentsCross(a: Point, b: Point, c: Point, d: Point) {
  return cross(a,b,c)*cross(a,b,d) < -tolerance && cross(c,d,a)*cross(c,d,b) < -tolerance;
}
export function pointInRoom(point: Point, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (Math.abs(cross(a,b,point)) < tolerance && point[0] >= Math.min(a[0],b[0])-tolerance && point[0] <= Math.max(a[0],b[0])+tolerance && point[1] >= Math.min(a[1],b[1])-tolerance && point[1] <= Math.max(a[1],b[1])+tolerance) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0]) inside = !inside;
  }
  return inside;
}
export function footprintInRoom(footprint: Point[], room: Pick<Room, "polygon">) {
  return footprint.every(point => pointInRoom(point, room.polygon)) && footprint.every((a,i) => !room.polygon.some((c,j) => segmentsCross(a,footprint[(i+1)%footprint.length],c,room.polygon[(j+1)%room.polygon.length])));
}
function footprintsOverlap(a: Point[], b: Point[]) {
  for (const polygon of [a,b]) for (let i=0;i<polygon.length;i++) {
    const start=polygon[i],end=polygon[(i+1)%polygon.length],axis:Point=[-(end[1]-start[1]),end[0]-start[0]];
    const projection = (points: Point[]) => points.map(point => point[0]*axis[0]+point[1]*axis[1]);
    const pa=projection(a),pb=projection(b);
    if (Math.max(...pa) <= Math.min(...pb)+tolerance || Math.max(...pb) <= Math.min(...pa)+tolerance) return false;
  }
  return true;
}

/** Keep both sides of every known door clear; door swing direction is not inferred. */
export function furnitureOpeningClearances(model: HouseModel, roomId: string): Point[][] {
  return model.openings.filter(opening => opening.kind === "door" && opening.roomIds.includes(roomId)).flatMap(opening => {
    const wall = model.walls.find(wall => wall.id === opening.wallId); if (!wall) return [];
    const dx=wall.end[0]-wall.start[0],dy=wall.end[1]-wall.start[1],length=Math.hypot(dx,dy); if (!length) return [];
    const center: Point=[wall.start[0]+dx/length*(opening.offset+opening.width/2),wall.start[1]+dy/length*(opening.offset+opening.width/2)];
    return [furnitureFootprint({ position:center,rotation:Math.atan2(dy,dx),width:opening.width+.2,depth:1.8 })];
  });
}

const piece = (kind: FurnitureKind, width: number, depth: number, height: number, en: string, es: string, x: number, y: number, rotation = 0, decorative = false): Candidate => ({ kind,width,depth,height,label:[en,es],preferred:[x,y],rotation,decorative });

/** Furnish only the explicitly modeled demo deck, without treating its open area as an interior room. */
function demoTerraceFurniture(model: HouseModel): { zone: FurnitureZone; items: FurnitureItem[] } | undefined {
  if (model.envelope?.source.documentId !== "demo-mirador-concept" || !model.rooms.some(room => room.id === "demo-living" && room.source.documentId === "demo-mirador-concept")) return;
  const top = model.envelope.faces.filter(face => /^demo-terrace-top-\d+$/.test(face.id));
  if (top.length !== 2) return;
  const vertices = top.flatMap(face => face.vertices);
  const minX = Math.min(...vertices.map(([x]) => x)), maxX = Math.max(...vertices.map(([x]) => x));
  const minY = Math.min(...vertices.map(([, y]) => y)), maxY = Math.max(...vertices.map(([, y]) => y));
  const elevation = vertices[0][2], width = maxX - minX, depth = maxY - minY;
  // A bounding rectangle alone must never invent usable floor outside the modeled top faces.
  if (width <= 0 || depth <= 0 || vertices.some(([x, y, z]) => Math.abs(z - elevation) > tolerance || ![minX, maxX].includes(x) || ![minY, maxY].includes(y))) return;
  const topArea = top.reduce((area, { vertices: [a, b, c] }) => area + Math.abs(cross([a[0], a[1]], [b[0], b[1]], [c[0], c[1]])) / 2, 0);
  if (new Set(vertices.map(([x, y]) => `${x},${y}`)).size !== 4 || Math.abs(topArea - width * depth) > tolerance) return;
  const sharedEdge = top[0].vertices.filter(([x, y]) => top[1].vertices.some(vertex => vertex[0] === x && vertex[1] === y));
  if (sharedEdge.length !== 2 || sharedEdge[0][0] === sharedEdge[1][0] || sharedEdge[0][1] === sharedEdge[1][1]) return;
  const zone: FurnitureZone = { id: "demo-terrace", name: { en: "Garden terrace", es: "Terraza al jardín" }, polygon: [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]], elevation };
  const obstacles = model.rooms.flatMap(room => furnitureOpeningClearances(model, room.id));
  const posts = new Map<string, Point[]>();
  for (const face of model.envelope.faces) {
    const id = face.id.match(/^(demo-pergola-post-\d+)-/)?.[1];
    if (id) posts.set(id, [...(posts.get(id) || []), ...face.vertices.map(([x, y]) => [x, y] as Point)]);
  }
  for (const points of posts.values()) {
    const x0 = Math.min(...points.map(([x]) => x)), x1 = Math.max(...points.map(([x]) => x));
    const y0 = Math.min(...points.map(([, y]) => y)), y1 = Math.max(...points.map(([, y]) => y));
    obstacles.push([[x0 - .08, y0 - .08], [x1 + .08, y0 - .08], [x1 + .08, y1 + .08], [x0 - .08, y1 + .08]]);
  }
  const door = model.openings.find(opening => opening.id === "demo-living-garden-door" && opening.kind === "door" && opening.glazed);
  const wall = model.walls.find(wall => wall.id === door?.wallId);
  if (!door || !wall || door.width < .9) return;
  const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
  if (!length) return;
  const tangent: Point = [(wall.end[0] - wall.start[0]) / length, (wall.end[1] - wall.start[1]) / length];
  const entry: Point = [wall.start[0] + tangent[0] * (door.offset + door.width - .45), wall.start[1] + tangent[1] * (door.offset + door.width - .45)];
  const normal = ([-1, 1] as const).map(sign => [-tangent[1] * sign, tangent[0] * sign] as Point).find(direction => pointInRoom([entry[0] + direction[0] * .2, entry[1] + direction[1] * .2], zone.polygon));
  if (!normal) return;
  // Keep a 0.9 m route from the garden edge to the right-hand part of the sliding opening.
  const routeLength = Math.hypot(width, depth);
  obstacles.push(furnitureFootprint({ position: [entry[0] + normal[0] * routeLength / 2, entry[1] + normal[1] * routeLength / 2], rotation: Math.atan2(tangent[1], tangent[0]), width: .9, depth: routeLength }));
  const candidates = [
    piece("sofa", 2.25, .82, .78, "Outdoor linen sofa", "Sofá exterior de lino", .23, .209, Math.PI),
    piece("chair", .72, .72, .8, "Outdoor lounge chair", "Sillón exterior", .074, .554, -Math.PI / 2),
    piece("chair", .72, .72, .8, "Outdoor lounge chair", "Sillón exterior", .393, .554, Math.PI / 2),
    piece("coffee-table", 1.08, .56, .4, "Terrace coffee table", "Mesa de centro exterior", .23, .563),
    piece("rug", 3.3, 2.02, .018, "Outdoor woven rug", "Alfombra tejida exterior", .247, .354, 0, true),
    piece("dining-table", 1.55, .8, .76, "Outdoor dining table", "Mesa de comedor exterior", .76, .48, Math.PI / 2),
    piece("plant", .32, .32, 1.05, "Terrace planter", "Macetero de terraza", .03, .89),
    piece("plant", .44, .44, 1.15, "Terrace planter", "Macetero de terraza", .95, .86),
  ];
  const items: FurnitureItem[] = [];
  const add = (candidate: Candidate, position: Point, rotation: number) => {
    const item: FurnitureItem = { id: `furniture-${zone.id}-${items.length + 1}`, roomId: zone.id, kind: candidate.kind, position, rotation, width: candidate.width, depth: candidate.depth, height: candidate.height, label: { en: candidate.label[0], es: candidate.label[1] }, elevation };
    const footprint = furnitureFootprint(item, .08);
    if (!footprintInRoom(footprint, zone) || obstacles.some(obstacle => footprintsOverlap(footprint, obstacle))) return;
    if (!candidate.decorative && items.some(previous => previous.kind !== "rug" && footprintsOverlap(footprint, furnitureFootprint(previous, .08)))) return;
    items.push(item);
    return item;
  };
  for (const candidate of candidates) {
    const item = add(candidate, [minX + width * candidate.preferred[0], minY + depth * candidate.preferred[1]], candidate.rotation || 0);
    if (item?.kind !== "dining-table") continue;
    for (let seat = 0; seat < 4; seat++) {
      const side = seat < 2 ? -1 : 1, along = (seat % 2 ? 1 : -1) * item.width * .27, across = side * (item.depth / 2 + .26 + .19);
      add(piece("chair", .48, .52, .84, "Outdoor dining chair", "Silla de comedor exterior", 0, 0), [item.position[0] + along * Math.cos(item.rotation) - across * Math.sin(item.rotation), item.position[1] + along * Math.sin(item.rotation) + across * Math.cos(item.rotation)], item.rotation + (side < 0 ? Math.PI : 0));
    }
  }
  return { zone, items };
}

function roomCandidates(room: Room): Candidate[] {
  const key = `${room.id} ${room.name}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/exterior|carport|cochera|hall|pasillo|corridor|garden|jardin|circulation|circulacion/.test(key)) return [];
  if (/bath|bano/.test(key)) {
    const compact = Math.max(...room.polygon.map(([x]) => x)) - Math.min(...room.polygon.map(([x]) => x)) < 2.2;
    const showerWidth = compact ? .9 : .95;
    return [
      piece("shower",showerWidth,showerWidth,1.9,"Glass shower","Ducha con vidrio",compact ? .2 : .88,.2),
      piece("vanity",compact ? .7 : .8,compact ? .42 : .5,1.3,"Oak vanity","Mueble de lavamanos",compact ? .9 : .1,compact ? .72 : .38),
      piece("toilet",.42,.68,.75,"Toilet","Inodoro",compact ? .8 : .45,.18),
    ];
  }
  if (/laundry|pilas|lavanderia/.test(key)) return [piece("washer",.65,.65,.9,"Washing machine","Lavadora",.2,.8),piece("washer",.65,.65,.9,"Dryer","Secadora",.55,.8),piece("kitchen-counter",1.1,.55,1.15,"Laundry worktop","Sobre de lavandería",.75,.25)];
  if (/closet|vestidor/.test(key)) return [piece("wardrobe",1.45,.55,1.9,"Wardrobe","Armario",.5,.8),piece("bench",.75,.4,.45,"Dressing bench","Banco de vestidor",.5,.25)];
  if (/storage|bodega|alacena|pantry/.test(key)) return [piece("wardrobe",.9,.45,1.8,"Storage cabinet","Armario de almacenamiento",.5,.8)];
  if (/bedroom|dormitorio|cuarto [12]|habitacion/.test(key)) return [piece("bed",/primary|principal|rear/.test(key)?1.6:1.4,2,.9,"Bed with linen bedding","Cama con ropa de lino",.66,.55,-Math.PI/2),piece("nightstand",.4,.4,.9,"Bedside table","Mesa de noche",.8,.25),piece("wardrobe",1.1,.55,1.9,"Oak wardrobe","Armario de roble",.8,.8)];
  if (/office|oficina|estudio/.test(key)) return [piece("desk",1.3,.6,1.05,"Work desk","Escritorio",.22,.53,Math.PI/2),piece("chair",.5,.5,.86,"Desk chair","Silla de escritorio",.45,.55),piece("wardrobe",.65,.35,1.5,"Office shelving","Estantería de oficina",.8,.8)];
  // Reserve the appliance's utility location before fitting adjacent cabinets.
  if (/kitchen|cocina/.test(key)) return [piece("fridge",.7,.7,1.85,"Refrigerator","Refrigerador",.18,.8),piece("kitchen-counter",1.5,.62,1.15,"Kitchen worktop","Mueble de cocina",.5,.18),piece("kitchen-counter",1.4,.62,1.15,"Prep counter","Sobre de preparación",.18,.6,Math.PI/2)];
  if (/dining|comedor/.test(key) && !/living|sala/.test(key)) return [piece("dining-table",1.35,.85,.85,"Dining table","Mesa de comedor",.65,.5,Math.PI/2),piece("chair",.46,.46,.85,"Dining chair","Silla de comedor",.3,.3),piece("chair",.46,.46,.85,"Dining chair","Silla de comedor",.7,.3),piece("chair",.46,.46,.85,"Dining chair","Silla de comedor",.3,.7,Math.PI),piece("chair",.46,.46,.85,"Dining chair","Silla de comedor",.7,.7,Math.PI)];
  if (/rear-lounge|sala de estar/.test(key)) return [piece("sofa",1.8,.85,.85,"Lounge sofa","Sofá de estar",.82,.52,-Math.PI/2),piece("coffee-table",.7,.5,.43,"Lounge table","Mesa de estar",.45,.52),piece("plant",.35,.35,.9,"Indoor plant","Planta de interior",.18,.5)];
  if (/living|lounge|sala/.test(key)) return [piece("sofa",2.35,.92,.85,"Linen sofa","Sofá de lino",.58,.55,-Math.PI/2),piece("coffee-table",1.05,.6,.43,"Coffee table","Mesa de centro",.5,.55),piece("console",1.3,.35,1.2,"Media console","Mueble de TV",.04,.55,Math.PI/2),piece("rug",2.5,1.8,.025,"Woven rug","Alfombra tejida",.42,.55,Math.PI/2,true),piece("plant",.38,.38,1.05,"Indoor plant","Planta de interior",.18,.18), ...(/dining|comedor/.test(key) ? [piece("dining-table",1.15,1.15,.85,"Dining table","Mesa de comedor",.78,.25),piece("chair",.46,.46,.85,"Dining chair","Silla de comedor",.62,.25,Math.PI/2),piece("chair",.46,.46,.85,"Dining chair","Silla de comedor",.94,.25,-Math.PI/2),piece("chair",.46,.46,.85,"Dining chair","Silla de comedor",.78,.08),piece("chair",.46,.46,.85,"Dining chair","Silla de comedor",.78,.44,Math.PI)] : [])];
  if (/entry|entrance|entrada|vestibulo/.test(key)) return [piece("console",.9,.35,.8,"Entry console","Consola de entrada",.8,.5),piece("plant",.36,.36,.9,"Entry plant","Planta de entrada",.2,.2)];
  return [];
}

/** Suggested pieces are fitted against the authorized runtime model; no private layout is bundled. */
export function createFurnitureLayout(model: HouseModel): FurnitureLayout {
  const items: FurnitureItem[] = [], unfurnishedRoomIds: string[] = [];
  for (const room of model.rooms) {
    const candidates=roomCandidates(room); if (!candidates.length) continue;
    const xs=room.polygon.map(point=>point[0]),ys=room.polygon.map(point=>point[1]);
    const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),doors=[...furnitureOpeningClearances(model,room.id),...furnitureEntranceClearances(model,room.id)];
    const placed: FurnitureItem[]=[];
    for (const [index,candidate] of candidates.entries()) {
      let preferred:Point=[minX+(maxX-minX)*candidate.preferred[0],minY+(maxY-minY)*candidate.preferred[1]], preferredRotation=candidate.rotation || 0;
      let anchorLimit=Infinity;
      const table=placed.find(item=>item.kind==="dining-table"), desk=placed.find(item=>item.kind==="desk"), sofa=placed.find(item=>item.kind==="sofa");
      const relative = (parent: FurnitureItem, x: number, y: number): Point => [parent.position[0]+x*Math.cos(parent.rotation)-y*Math.sin(parent.rotation),parent.position[1]+x*Math.sin(parent.rotation)+y*Math.cos(parent.rotation)];
      if(candidate.kind==="chair" && table) {
        const seat=placed.filter(item=>item.kind==="chair").length, side=seat<2?-1:1;
        preferred=relative(table,(seat%2?1:-1)*table.width*.27,side*(table.depth/2+candidate.depth/2+.14));
        preferredRotation=table.rotation+(side<0?Math.PI:0);anchorLimit=.4;
      } else if(candidate.kind==="chair" && desk) {
        preferred=relative(desk,0,-(desk.depth/2+candidate.depth/2+.2));preferredRotation=desk.rotation+Math.PI;anchorLimit=.4;
      } else if(candidate.kind==="coffee-table" && sofa) {
        preferred=relative(sofa,0,-(sofa.depth/2+candidate.depth/2+.4));preferredRotation=sofa.rotation;anchorLimit=.65;
      }
      const locations: Point[]=[preferred];
      for(let x=minX+.25;x<maxX;x+=.25) for(let y=minY+.25;y<maxY;y+=.25) locations.push([x,y]);
      locations.sort((a,b)=>Math.hypot(a[0]-preferred[0],a[1]-preferred[1])-Math.hypot(b[0]-preferred[0],b[1]-preferred[1]));
      let result: FurnitureItem | null=null;
      const placements: WallPlacement[] = [];
      const wallBacked = ["fridge", "kitchen-counter", "vanity", "toilet", "shower"].includes(candidate.kind);
      if (wallBacked) placements.push(...wallFurniturePlacements(model,room,candidate,preferred,pointInRoom,[...doors,...placed.filter(item=>item.kind!=="rug").map(item=>furnitureFootprint(item,.08))]));
      else for(const rotation of candidate.kind==="chair" && (table || desk) ? [preferredRotation] : [preferredRotation,preferredRotation+Math.PI/2]) {
        const halfX=Math.abs(Math.cos(rotation))*candidate.width/2+Math.abs(Math.sin(rotation))*candidate.depth/2+.08;
        const halfY=Math.abs(Math.sin(rotation))*candidate.width/2+Math.abs(Math.cos(rotation))*candidate.depth/2+.08;
        // Include exact fit positions beside polygon/door edges, so narrow valid strips are not missed by the grid.
        const anchorX=[preferred[0],...room.polygon.flatMap(([x])=>[x+halfX,x-halfX]),...doors.flatMap(door=>[Math.min(...door.map(point=>point[0]))-halfX,Math.max(...door.map(point=>point[0]))+halfX])];
        const anchorY=[preferred[1],...room.polygon.flatMap(([,y])=>[y+halfY,y-halfY]),...doors.flatMap(door=>[Math.min(...door.map(point=>point[1]))-halfY,Math.max(...door.map(point=>point[1]))+halfY])];
        const aligned:Point[]=[...locations,...anchorX.flatMap(x=>anchorY.map(y=>[x,y] as Point))];
        aligned.sort((a,b)=>Math.hypot(a[0]-preferred[0],a[1]-preferred[1])-Math.hypot(b[0]-preferred[0],b[1]-preferred[1]));
        placements.push(...aligned.map(position=>({position,rotation})));
      }
      for(const {position,rotation} of placements) {
        if(Math.hypot(position[0]-preferred[0],position[1]-preferred[1])>anchorLimit)continue;
        const item: FurnitureItem={id:`furniture-${room.id}-${index+1}`,roomId:room.id,kind:candidate.kind,position,rotation,width:candidate.width,depth:candidate.depth,height:candidate.height,label:{en:candidate.label[0],es:candidate.label[1]}};
        const footprint=furnitureFootprint(item,.08);
        if(!footprintInRoom(footprint,room) || doors.some(door=>footprintsOverlap(footprint,door))) continue;
        if(room.height.value !== null && item.height > room.height.value - .1) continue;
        if(!candidate.decorative && placed.some(previous=>previous.kind!=="rug" && footprintsOverlap(footprint,furnitureFootprint(previous,.08)))) continue;
        // The transparent shower enclosure may sit beside a window; opaque tall pieces may not.
        if(item.height>1.2 && item.kind!=="shower" && model.openings.some(opening=> {
          if(opening.kind!=="window" || !opening.roomIds.includes(room.id) || opening.sill>=item.height) return false;
          const wall=model.walls.find(wall=>wall.id===opening.wallId); if(!wall)return false;
          const dx=wall.end[0]-wall.start[0],dy=wall.end[1]-wall.start[1],length=Math.hypot(dx,dy); if(!length)return false;
          return footprintsOverlap(footprint,furnitureFootprint({position:[wall.start[0]+dx/length*(opening.offset+opening.width/2),wall.start[1]+dy/length*(opening.offset+opening.width/2)],rotation:Math.atan2(dy,dx),width:opening.width+.1,depth:.8}));
        })) continue;
        result=item;break;
      }
      if(result) { placed.push(result);items.push(result); }
    }
    if(!placed.length)unfurnishedRoomIds.push(room.id);
  }
  const terrace = demoTerraceFurniture(model);
  if (terrace) return { items: [...items, ...terrace.items], unfurnishedRoomIds, zones: [terrace.zone] };
  return { items,unfurnishedRoomIds };
}
