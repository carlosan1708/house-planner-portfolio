import { describe, expect, it } from "vitest";
import { createDemoDistributionRecord } from "@/lib/demo-distribution";
import { createFurnitureLayout, footprintInRoom, furnitureFootprint, furnitureOpeningClearances, pointInRoom } from "@/lib/furniture-layout";
import type { HouseModel } from "@/lib/house-distribution";

describe("proposed furniture layout", () => {
  it("fits suggested pieces inside the permitted room geometry without changing the house", () => {
    const model = createDemoDistributionRecord().model;
    const before = JSON.stringify(model), layout = createFurnitureLayout(model);
    expect(layout.items.length).toBeGreaterThan(20);
    expect(JSON.stringify(model)).toBe(before);
    expect(new Set(layout.items.map(item => item.id)).size).toBe(layout.items.length);
    for (const item of layout.items) {
      const room = model.rooms.find(room => room.id === item.roomId) || layout.zones?.find(zone => zone.id === item.roomId);
      expect(room, item.id).toBeDefined();
      expect(footprintInRoom(furnitureFootprint(item,.08),room!),item.id).toBe(true);
      for (const door of furnitureOpeningClearances(model,room!.id)) {
        // Neither object may enclose the other or cross an approach rectangle.
        expect(furnitureFootprint(item).some(point=>pointInRoom(point,door)),item.id).toBe(false);
      }
    }
    expect(layout.items.some(item=>item.kind==="sofa")).toBe(true);
    expect(layout.items.some(item=>item.kind==="bed")).toBe(true);
    expect(layout.items.some(item=>item.kind==="kitchen-counter")).toBe(true);
  });

  it("rejects a rectangle that bridges the missing corner of a concave room", () => {
    const room={...createDemoDistributionRecord().model.rooms[0],polygon:[[0,0],[3,0],[3,1],[1,1],[1,3],[0,3]] as [number,number][]};
    expect(footprintInRoom([[.2,.2],[2.8,.2],[2.8,2.8],[.2,2.8]],room)).toBe(false);
    expect(footprintInRoom([[.2,.2],[2.8,.2],[2.8,.8],[.2,.8]],room)).toBe(true);
  });

  it("does not invent furnishings in circulation, exterior or very small rooms", () => {
    const source=createDemoDistributionRecord().model;
    const model:HouseModel={...source,rooms:[{...source.rooms[0],id:"office",name:"Office",polygon:[[0,0],[.6,0],[.6,.6],[0,.6]]},{...source.rooms[0],id:"carport",name:"Carport"},{...source.rooms[0],id:"hall",name:"Hall"}],openings:[],fixtures:[]};
    const layout=createFurnitureLayout(model);
    expect(layout.items).toEqual([]);
    expect(layout.unfurnishedRoomIds).toEqual(["office"]);
  });

  it("recomputes positions from the runtime model instead of a bundled project plan", () => {
    const source=createDemoDistributionRecord().model;
    const room={...source.rooms[0],id:"office",name:"Office",polygon:[[100,100],[104,100],[104,104],[100,104]] as [number,number][]};
    const layout=createFurnitureLayout({...source,rooms:[room],openings:[],fixtures:[]});
    expect(layout.items.length).toBeGreaterThan(0);
    expect(layout.items.every(item=>item.position[0]>100&&item.position[1]>100)).toBe(true);
  });

  it("places dining chairs near their table and facing its centre", () => {
    const source=createDemoDistributionRecord().model;
    const room={...source.rooms[0],id:"dining",name:"Dining",polygon:[[0,0],[5,0],[5,5],[0,5]] as [number,number][]};
    const {items}=createFurnitureLayout({...source,rooms:[room],openings:[],fixtures:[]});
    const table=items.find(item=>item.kind==="dining-table")!;
    const chairs=items.filter(item=>item.kind==="chair");
    expect(chairs).toHaveLength(4);
    for(const chair of chairs) {
      const dx=table.position[0]-chair.position[0],dy=table.position[1]-chair.position[1];
      expect(Math.hypot(dx,dy)).toBeLessThan(1.3);
      expect(Math.sin(chair.rotation)*dx-Math.cos(chair.rotation)*dy).toBeGreaterThan(0);
    }
  });
});
