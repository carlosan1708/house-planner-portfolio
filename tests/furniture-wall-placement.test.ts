import { describe, expect, it } from "vitest";
import { createFurnitureLayout, footprintInRoom, furnitureFootprint, furnitureOpeningClearances, pointInRoom, type FurnitureItem } from "@/lib/furniture-layout";
import type { HouseModel, Point, Room, Wall } from "@/lib/house-distribution";

const source = { documentId: "synthetic-furniture-plan", page: 1, sheet: "TEST" };
const rectangle = (x: number, y: number, width: number, depth: number): Point[] => [[x,y],[x+width,y],[x+width,y+depth],[x,y+depth]];
const room = (id: string, polygon: Point[]): Room => ({
  id, name: id, polygon, color: "#dddddd", source,
  height: { value: 2.7, status: "approximate", source, note: "Invented test ceiling" },
  finishes: "Invented", notes: "Invented geometry, unrelated to any private project",
  coverage: { outlet: "reviewed", light: "reviewed", switch: "reviewed", ac: "reviewed" },
});
const wall = (id: string, start: Point, end: Point): Wall => ({ id, start, end, thickness: .16, height: 2.7, source });
const model = (rooms: Room[], walls: Wall[]): HouseModel => ({ schemaVersion: 1, name: "Synthetic layout", revision: 1, sourceDocumentIds: [source.documentId], rooms, walls, openings: [], fixtures: [], notes: "Invented test model" });

/** Independent separating-axis check catches crossing and fully enclosed footprints. */
function overlaps(a: Point[], b: Point[]) {
  for (const polygon of [a,b]) for (let i=0;i<polygon.length;i++) {
    const start=polygon[i],end=polygon[(i+1)%polygon.length],axis:Point=[start[1]-end[1],end[0]-start[0]];
    const project = (points: Point[]) => points.map(point => point[0]*axis[0]+point[1]*axis[1]);
    const pa=project(a),pb=project(b);
    if (Math.max(...pa)<=Math.min(...pb)+.00001 || Math.max(...pb)<=Math.min(...pa)+.00001) return false;
  }
  return true;
}

function assertClearance(plan: HouseModel, items: FurnitureItem[]) {
  for (const [index,item] of items.entries()) {
    const footprint=furnitureFootprint(item,.08), containingRoom=plan.rooms.find(room=>room.id===item.roomId)!;
    expect(footprintInRoom(footprint,containingRoom),item.kind).toBe(true);
    for(const door of furnitureOpeningClearances(plan,item.roomId)) expect(overlaps(footprint,door),`${item.kind} blocks doorway`).toBe(false);
    for(const other of items.slice(index+1)) expect(overlaps(footprint,furnitureFootprint(other,.08)),`${item.kind} overlaps ${other.kind}`).toBe(false);
    for(const wall of plan.walls) {
      const wallFootprint=furnitureFootprint({ position:[(wall.start[0]+wall.end[0])/2,(wall.start[1]+wall.end[1])/2], rotation:Math.atan2(wall.end[1]-wall.start[1],wall.end[0]-wall.start[0]), width:Math.hypot(wall.end[0]-wall.start[0],wall.end[1]-wall.start[1]), depth:wall.thickness });
      expect(overlaps(furnitureFootprint(item),wallFootprint),`${item.kind} crosses wall`).toBe(false);
    }
  }
}

function assertWallBacked(plan: HouseModel, item: FurnitureItem) {
  const front:Point=[Math.sin(item.rotation),-Math.cos(item.rotation)];
  const back:Point=[item.position[0]-front[0]*item.depth/2,item.position[1]-front[1]*item.depth/2];
  const matchingWall=plan.walls.find(wall=> {
    const dx=wall.end[0]-wall.start[0],dy=wall.end[1]-wall.start[1],length=Math.hypot(dx,dy);
    const offset=((back[0]-wall.start[0])*dx+(back[1]-wall.start[1])*dy)/length;
    const distance=Math.abs(dx*(back[1]-wall.start[1])-dy*(back[0]-wall.start[0]))/length;
    return offset>=0 && offset<=length && Math.abs(distance-wall.thickness/2-.025)<.00001;
  });
  expect(matchingWall,`${item.kind} should have a real backing wall`).toBeDefined();
  const containingRoom=plan.rooms.find(room=>room.id===item.roomId)!;
  expect(pointInRoom([item.position[0]+front[0]*.1,item.position[1]+front[1]*.1],containingRoom.polygon)).toBe(true);
}

function kitchenModel() {
  const plan=model([room("kitchen",rectangle(-4,5,4.8,3.6))],[wall("west",[-4,5],[-4,8.6]),wall("front",[-4,5],[.8,5])]);
  // The right and rear boundaries are open connections, not backing walls.
  plan.fixtures=[{ id:"dedicated-appliance-supply", roomId:"kitchen", kind:"outlet", type:"Refrigerator dedicated supply", position:[-4,8], height:.3, circuit:"TEST-R", specifications:"Invented", status:"approximate", source }];
  return plan;
}

function bathroomModel() {
  const plan=model([room("bathroom",rectangle(8,11,1.95,2.65))],[
    wall("west",[8,11],[8,13.65]),wall("east",[9.95,11],[9.95,13.65]),
    wall("front",[8,11],[9.95,11]),wall("rear",[8,13.65],[9.95,13.65]),
  ]);
  plan.openings=[
    { id:"rear-entry", wallId:"rear", roomIds:["bathroom"], kind:"door", offset:.15, width:.9, height:2.1, sill:0, status:"approximate", source },
    { id:"front-window", wallId:"front", roomIds:["bathroom"], kind:"window", offset:.35, width:1.1, height:1, sill:1, status:"approximate", source },
  ];
  plan.fixtures=[{ id:"vanity-supply", roomId:"bathroom", kind:"outlet", type:"GFCI 120 V", position:[9.95,12.9], height:1.05, circuit:"TEST-B", specifications:"Invented", status:"approximate", source }];
  return plan;
}

describe("wall-backed furniture proposals",()=> {
  it("uses the dedicated refrigerator outlet and keeps counters against actual kitchen walls",()=> {
    const plan=kitchenModel(),{items}=createFurnitureLayout(plan);
    const fridge=items.find(item=>item.kind==="fridge")!;
    expect(fridge).toBeDefined();
    expect(fridge.position[0]).toBeCloseTo(-4+fridge.depth/2+.16/2+.025);
    expect(fridge.position[1]).toBeCloseTo(8);
    expect(Math.sin(fridge.rotation)).toBeCloseTo(1);
    expect(-Math.cos(fridge.rotation)).toBeCloseTo(0);
    expect(items.filter(item=>item.kind==="kitchen-counter")).toHaveLength(2);
    for(const item of items) assertWallBacked(plan,item);
    assertClearance(plan,items);
  });

  it("keeps a compact glass shower beside a window while backing the vanity and toilet to walls",()=> {
    const plan=bathroomModel(),{items}=createFurnitureLayout(plan);
    expect(items.map(item=>item.kind).sort()).toEqual(["shower","toilet","vanity"]);
    const shower=items.find(item=>item.kind==="shower")!,vanity=items.find(item=>item.kind==="vanity")!,toilet=items.find(item=>item.kind==="toilet")!;
    expect(shower.width).toBe(.9);
    expect(shower.position[1]).toBeLessThan(12);
    // Its glass occupies the window approach that must still reject opaque tall cabinets.
    expect(shower.height).toBeGreaterThan(plan.openings[1].sill);
    expect(overlaps(furnitureFootprint(shower,.08),rectangle(8.3,10.6,1.2,.8))).toBe(true);
    expect(vanity.depth).toBe(.42);
    expect(Math.sin(vanity.rotation)).toBeCloseTo(-1);
    expect(-Math.cos(toilet.rotation)).toBeCloseTo(1);
    for(const item of items) assertWallBacked(plan,item);
    assertClearance(plan,items);
  });

  it("recomputes from translated room, wall, opening and outlet geometry without mutating either model",()=> {
    const original=bathroomModel(),before=JSON.stringify(original),offset:Point=[37,-19];
    const shift=([x,y]:Point):Point=>[x+offset[0],y+offset[1]];
    const translated:HouseModel={...original,rooms:original.rooms.map(room=>({...room,polygon:room.polygon.map(shift)})),walls:original.walls.map(wall=>({...wall,start:shift(wall.start),end:shift(wall.end)})),fixtures:original.fixtures.map(fixture=>({...fixture,position:shift(fixture.position)}))};
    const translatedBefore=JSON.stringify(translated),first=createFurnitureLayout(original),second=createFurnitureLayout(translated);
    expect(second.items).toHaveLength(first.items.length);
    for(const item of first.items) {
      const moved=second.items.find(candidate=>candidate.id===item.id)!;
      expect(moved.position[0]).toBeCloseTo(item.position[0]+offset[0]);
      expect(moved.position[1]).toBeCloseTo(item.position[1]+offset[1]);
      expect(moved.rotation).toBeCloseTo(item.rotation);
    }
    expect(JSON.stringify(original)).toBe(before);
    expect(JSON.stringify(translated)).toBe(translatedBefore);
    assertClearance(translated,second.items);
  });
});
