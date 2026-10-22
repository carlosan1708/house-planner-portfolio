import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { addFurnitureItems } from "@/app/components/furniture-catalog";
import { furnitureFootprint, type FurnitureItem, type FurnitureKind } from "@/lib/furniture-layout";

const kinds: FurnitureKind[] = ["sofa", "coffee-table", "rug", "dining-table", "chair", "kitchen-counter", "fridge", "bed", "nightstand", "wardrobe", "desk", "vanity", "shower", "toilet", "washer", "console", "plant", "bench"];
const piece = (kind: FurnitureKind, changes: Partial<FurnitureItem> = {}): FurnitureItem => ({
  id: `test-${kind}`, roomId: "test-room", kind, position: [0, 0], rotation: 0,
  width: 2.3, depth: 1.4, height: 1.9, label: { en: kind, es: kind }, ...changes,
});

describe("furniture catalog placement geometry", () => {
  it.each(kinds)("keeps every part of %s within the declared footprint and height", kind => {
    const item = piece(kind), scene = new THREE.Scene();
    const furniture = addFurnitureItems(scene, [item]);
    const bounds = new THREE.Box3().setFromObject(furniture);
    const epsilon = .00001;
    expect(bounds.min.x).toBeGreaterThanOrEqual(-item.width / 2 - epsilon);
    expect(bounds.max.x).toBeLessThanOrEqual(item.width / 2 + epsilon);
    expect(bounds.min.z).toBeGreaterThanOrEqual(-item.depth / 2 - epsilon);
    expect(bounds.max.z).toBeLessThanOrEqual(item.depth / 2 + epsilon);
    expect(bounds.min.y).toBeGreaterThanOrEqual(-epsilon);
    expect(bounds.max.y).toBeLessThanOrEqual(item.height + epsilon);
    expect(bounds.max.y).toBeGreaterThan(0);
    expect(scene.children).toContain(furniture);
    const meshes: THREE.Mesh[] = [];
    furniture.traverse(object => { if (object instanceof THREE.Mesh) meshes.push(object); });
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes.length).toBeLessThanOrEqual(15);
    for (const mesh of meshes) {
      expect(mesh.userData).toEqual({ kind: "furniture", id: item.id });
      expect(mesh.castShadow && mesh.receiveShadow).toBe(true);
    }
  });

  it("maps furniture rotation and plan coordinates consistently with the placement footprint", () => {
    const item = piece("wardrobe", { position: [8, 5], rotation: Math.PI / 3 });
    const group = addFurnitureItems(new THREE.Scene(), [item]).children[0];
    const corners = furnitureFootprint(item), bounds = new THREE.Box3().setFromObject(group);
    expect(group.position.toArray()).toEqual([8, 0, -5]);
    expect(group.rotation.y).toBe(item.rotation);
    expect(group.userData).toEqual({ kind: "furniture", id: item.id });
    expect(bounds.min.x).toBeGreaterThanOrEqual(Math.min(...corners.map(point => point[0])) - .00001);
    expect(bounds.max.x).toBeLessThanOrEqual(Math.max(...corners.map(point => point[0])) + .00001);
    expect(bounds.min.z).toBeGreaterThanOrEqual(Math.min(...corners.map(point => -point[1])) - .00001);
    expect(bounds.max.z).toBeLessThanOrEqual(Math.max(...corners.map(point => -point[1])) + .00001);
  });

  it("rests outdoor furniture at the modeled deck elevation", () => {
    const item = piece("sofa", { elevation: -.06 });
    const group = addFurnitureItems(new THREE.Scene(), [item]).children[0];
    const bounds = new THREE.Box3().setFromObject(group);
    expect(group.position.y).toBe(-.06);
    expect(bounds.min.y).toBeGreaterThanOrEqual(item.elevation! - .00001);
    expect(bounds.min.y).toBeLessThanOrEqual(item.elevation! + .01);
    expect(bounds.max.y).toBeLessThanOrEqual(item.elevation! + item.height + .00001);
  });

  it("keeps selection highlights independent between furniture pieces", () => {
    const furnishings = addFurnitureItems(new THREE.Scene(), [piece("chair", { id: "first-chair" }), piece("chair", { id: "second-chair" })]);
    const surfaces = furnishings.children.map(group => {
      const result = new Set<THREE.MeshStandardMaterial>();
      group.traverse(object => { if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshStandardMaterial) result.add(object.material); });
      return result;
    });
    for (const material of surfaces[0]) material.emissive.set("#385b3e");
    for (const material of surfaces[1]) expect(material.emissive.getHexString()).toBe("000000");
  });

  it("uses transparent glazing without writing depth over furnishings behind it", () => {
    const group = addFurnitureItems(new THREE.Scene(), [piece("shower"), piece("washer")]);
    const glazing: THREE.MeshStandardMaterial[] = [];
    group.traverse(object => {
      if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshStandardMaterial && object.material.transparent) glazing.push(object.material);
    });
    expect(glazing.length).toBeGreaterThan(0);
    for (const material of glazing) expect(material.depthWrite).toBe(false);
  });
});
