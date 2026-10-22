import type { HouseModel } from "./house-distribution";
import { createFurnitureLayout } from "./furniture-layout";

/** Language-independent architectural inputs used by the exported demo exterior. */
export function demoExteriorGeometry(model: HouseModel) {
  return {
    rooms: model.rooms.map(({ id, polygon, height }) => ({ id, polygon, height: height.value })),
    walls: model.walls.map(({ id, start, end, thickness, height }) => ({ id, start, end, thickness, height })),
    openings: model.openings.map(({ id, wallId, kind, glazed, offset, width, height, sill }) => ({ id, wallId, kind, glazed, offset, width, height, sill })),
    faces: model.envelope?.faces,
    property: model.surfaces?.find(surface => surface.kind === "property")?.polygon,
  };
}

/** The same furnishing proposal used by the viewer, without translated display labels. */
export function demoExteriorFurniture(model: HouseModel) {
  const layout = createFurnitureLayout(model);
  return {
    items: layout.items.map(({ id, roomId, kind, position, rotation, width, depth, height, elevation }) => ({ id, roomId, kind, position, rotation, width, depth, height, elevation: elevation ?? 0 })),
    zones: (layout.zones || []).map(({ id, polygon, elevation }) => ({ id, polygon, elevation })),
  };
}
