import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { FurnitureItem } from "@/lib/furniture-layout";

/** Furnishing proposals are independent of measured walls, rooms, and fixtures. */
export function addFurnitureItems(scene: THREE.Scene, items: readonly FurnitureItem[]): THREE.Group {
  const furnishings = new THREE.Group();
  furnishings.name = "Furniture proposals";
  const material = (color: string, roughness = .8, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const oak = material("#a77e54"), oakLight = material("#c2a17b"), linen = material("#ded5c5"), ivory = material("#f4efe4");
  const sage = material("#7d9080"), olive = material("#67775a"), clay = material("#ba826a"), charcoal = material("#343e3b");
  const brass = material("#ae9464", .35, .65), porcelain = material("#efeee8", .25), rug = material("#c8b9a0");
  const steel = material("#8b9e9c", .3, .45), screen = material("#536667", .5);
  const glass = new THREE.MeshStandardMaterial({ color: "#a8c6c5", roughness: .12, transparent: true, opacity: .24, depthWrite: false, side: THREE.DoubleSide });
  const sphere = new THREE.SphereGeometry(1, 16, 12);

  for (const item of items) {
    const group = new THREE.Group();
    group.name = item.label.en;
    group.userData = { kind: "furniture", id: item.id };
    group.position.set(item.position[0], item.elevation ?? 0, -item.position[1]);
    group.rotation.y = item.rotation;
    // Each design occupies a unit box, then scales to its declared footprint.
    // Accessories stay inside that box so placement clearance remains reliable.
    group.scale.set(item.width, item.height, item.depth);
    const accent = item.id.length % 2 ? sage : clay;
    const itemMaterials = new Map<THREE.Material, THREE.Material>();
    const add = (geometry: THREE.BufferGeometry, surface: THREE.Material, x: number, height: number, z: number) => {
      if (!itemMaterials.has(surface)) itemMaterials.set(surface, surface.clone());
      const mesh = new THREE.Mesh(geometry, itemMaterials.get(surface)!);
      mesh.position.set(x, height, z);
      mesh.userData = { kind: "furniture", id: item.id };
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };
    const box = (x: number, y: number, z: number, width: number, height: number, depth: number, surface: THREE.Material, radius = .025) =>
      add(new RoundedBoxGeometry(width, height, depth, 2, Math.min(radius, width / 3, height / 3, depth / 3)), surface, x, y, z);
    const cylinder = (x: number, y: number, z: number, radius: number, height: number, surface: THREE.Material, lowerRadius = radius) =>
      add(new THREE.CylinderGeometry(radius, lowerRadius, height, 24), surface, x, y, z);
    const oval = (x: number, y: number, z: number, width: number, height: number, depth: number, surface: THREE.Material) => {
      const mesh = add(sphere, surface, x, y, z);
      mesh.scale.set(width, height, depth);
      return mesh;
    };
    const legs = (top: number, surface = oak) => {
      for (const x of [-.35, .35]) box(x, top / 2, 0, .08, top, .68, surface, .01);
    };

    switch (item.kind) {
      case "sofa": {
        box(0, .25, 0, .92, .22, .87, oak);
        box(0, .65, -.39, .96, .66, .18, linen, .06);
        for (const x of [-.45, .45]) box(x, .52, 0, .10, .55, .96, linen, .04);
        for (const x of [-.29, 0, .29]) {
          box(x, .48, .055, .275, .25, .69, linen, .06);
          box(x, .77, -.24, .275, .34, .20, ivory, .045);
        }
        for (const x of [-.30, .30]) box(x, .72, .02, .20, .25, .18, x < 0 ? sage : clay, .045);
        for (const x of [-.36, .36]) box(x, .07, 0, .09, .14, .68, oak, .01);
        break;
      }
      case "coffee-table":
        box(0, .78, 0, .98, .18, .96, oakLight, .065);
        box(0, .35, 0, .55, .70, .56, oak, .05);
        box(-.13, .89, 0, .30, .04, .29, ivory, .005);
        box(-.10, .93, 0, .26, .04, .26, sage, .005).rotation.y = .10;
        cylinder(.25, .94, .02, .07, .12, clay);
        break;
      case "rug":
        box(0, .20, 0, 1, .40, 1, rug, .04);
        for (const z of [-.43, .43]) box(0, .43, z, .93, .06, .035, linen, .005);
        break;
      case "dining-table":
        cylinder(0, .84, 0, .49, .11, oakLight);
        cylinder(0, .40, 0, .13, .80, oak, .25);
        cylinder(0, .94, 0, .07, .12, porcelain, .05);
        break;
      case "chair":
        box(0, .405, .035, .90, .08, .85, oak, .025);
        box(0, .49, .065, .80, .13, .76, linen, .055);
        box(0, .76, -.405, .88, .48, .12, oak, .025);
        box(0, .77, -.325, .77, .35, .12, sage, .05);
        for (const x of [-.38, .38]) {
          for (const z of [-.33, .33]) box(x, .205, z, .065, .41, .065, oak, .012);
          box(x, .625, .015, .08, .07, .84, oakLight, .025);
          box(x, .515, .32, .055, .23, .055, oak, .012);
        }
        break;
      case "kitchen-counter": {
        box(0, .38, 0, .94, .72, .92, sage);
        box(0, .77, 0, 1, .08, 1, ivory, .015);
        for (const x of [-.24, .24]) {
          box(x, .40, .47, .45, .64, .025, sage, .01);
          box(x, .60, .49, .14, .025, .02, brass, .005);
        }
        box(-.23, .817, 0, .38, .016, .61, charcoal, .035);
        box(-.23, .828, 0, .30, .012, .49, steel, .035);
        cylinder(-.23, .90, -.36, .015, .18, brass);
        const spout = cylinder(-.23, .98, -.27, .014, .18, brass);
        spout.rotation.x = Math.PI / 2;
        box(.25, .824, 0, .34, .025, .63, charcoal, .02);
        for (const z of [-.17, .17]) cylinder(.25, .844, z, .10, .012, steel);
        break;
      }
      case "fridge":
        box(0, .50, 0, .97, 1, .96, porcelain, .035);
        box(0, .70, .485, .91, .53, .025, ivory, .02);
        box(0, .215, .485, .91, .39, .025, ivory, .02);
        box(-.33, .65, .495, .035, .26, .01, brass, .001);
        box(-.33, .24, .495, .035, .20, .01, brass, .001);
        break;
      case "bed":
        box(0, .21, 0, .96, .26, .93, oak);
        box(0, .55, -.455, 1, .90, .09, oakLight, .04);
        box(0, .43, .025, .91, .24, .87, ivory, .06);
        box(0, .59, .15, .93, .10, .56, accent, .035);
        box(0, .66, .35, .94, .04, .14, linen, .01);
        for (const x of [-.23, .23]) box(x, .61, -.27, .39, .16, .23, ivory, .055);
        for (const x of [-.34, .34]) box(x, .055, 0, .09, .11, .70, oak, .01);
        break;
      case "nightstand":
        box(0, .30, 0, .94, .53, .90, oakLight);
        box(0, .59, 0, 1, .06, .98, oakLight);
        box(0, .35, .46, .84, .29, .025, oak, .01);
        box(0, .39, .48, .20, .025, .025, brass, .005);
        cylinder(0, .65, 0, .17, .06, porcelain, .21);
        cylinder(0, .76, 0, .025, .20, brass);
        cylinder(0, .91, 0, .23, .18, ivory, .29);
        break;
      case "wardrobe":
        box(0, .50, 0, .98, 1, .94, oakLight);
        for (const x of [-.245, .245]) box(x, .51, .48, .475, .94, .03, oakLight, .01);
        for (const x of [-.045, .045]) box(x, .50, .495, .015, .20, .01, brass, .001);
        box(0, .035, .48, .94, .06, .03, oak, .005);
        break;
      case "desk":
        box(0, .73, 0, 1, .07, .96, oakLight);
        legs(.695);
        box(.28, .50, .04, .28, .42, .79, oakLight);
        box(0, .80, -.24, .17, .07, .15, charcoal);
        box(0, .90, -.30, .43, .20, .035, charcoal, .01);
        box(0, .90, -.278, .39, .16, .005, screen, .005);
        box(0, .78, .16, .35, .025, .22, ivory, .005);
        break;
      case "vanity":
        box(0, .31, 0, .92, .56, .88, oakLight);
        box(0, .62, 0, 1, .06, .96, ivory);
        oval(0, .68, .06, .30, .06, .29, porcelain);
        oval(0, .72, .06, .23, .015, .22, steel);
        cylinder(0, .75, -.32, .018, .22, brass);
        box(0, .88, -.475, .83, .24, .025, steel, .025);
        for (const x of [-.22, .22]) box(x, .42, .46, .18, .02, .025, brass, .005);
        break;
      case "shower": {
        box(0, .025, 0, 1, .05, 1, porcelain, .015);
        box(-.49, .49, 0, .02, .88, 1, glass, .003);
        box(0, .49, -.49, 1, .88, .02, glass, .003);
        box(-.49, .49, .48, .02, .88, .02, brass, .003);
        box(-.49, .93, 0, .02, .02, 1, brass, .003);
        box(0, .93, -.49, 1, .02, .02, brass, .003);
        cylinder(.34, .53, -.36, .014, .82, brass);
        const pipe = cylinder(.34, .94, -.22, .013, .28, brass);
        pipe.rotation.x = Math.PI / 2;
        cylinder(.34, .93, -.08, .11, .025, brass);
        cylinder(.34, .53, -.36, .04, .035, brass).rotation.x = Math.PI / 2;
        box(0, .054, 0, .14, .008, .14, steel, .005);
        break;
      }
      case "toilet": {
        box(0, .70, -.32, .72, .60, .28, porcelain, .06);
        oval(0, .32, .07, .35, .30, .39, porcelain);
        oval(0, .58, .08, .36, .065, .39, ivory);
        oval(0, .635, .10, .24, .008, .26, charcoal);
        box(0, .50, -.16, .64, .43, .07, ivory, .045);
        box(.18, .92, -.32, .14, .025, .06, brass, .005);
        break;
      }
      case "washer": {
        box(0, .50, 0, .97, 1, .94, porcelain, .04);
        box(0, .95, 0, 1, .08, .98, ivory, .015);
        cylinder(0, .45, .475, .32, .025, charcoal).rotation.x = Math.PI / 2;
        cylinder(0, .45, .49, .245, .014, glass).rotation.x = Math.PI / 2;
        box(.18, .84, .48, .35, .06, .02, charcoal, .005);
        cylinder(-.30, .84, .48, .065, .025, steel).rotation.x = Math.PI / 2;
        break;
      }
      case "console":
        if (/media|tv/i.test(item.label.en)) {
          box(0,.20,0,1,.32,.96,oakLight);
          box(0,.055,0,.85,.10,.8,charcoal);
          box(0,.40,-.04,.14,.12,.40,charcoal);
          box(0,.73,-.10,.87,.54,.13,charcoal,.015);
          box(0,.73,-.025,.80,.46,.015,screen,.005);
          break;
        }
        box(0, .50, 0, 1, .10, .96, oakLight);
        for (const x of [-.39, .39]) box(x, .24, 0, .07, .48, .82, oak);
        box(0, .15, 0, .82, .06, .76, oak);
        box(.25, .58, 0, .27, .06, .37, ivory, .005);
        box(.24, .64, 0, .24, .05, .34, sage, .005);
        cylinder(-.28, .76, 0, .16, .42, clay, .12);
        break;
      case "plant":
        cylinder(0, .22, 0, .24, .42, clay, .18);
        cylinder(0, .58, 0, .018, .42, oak);
        for (let i = 0; i < 6; i++) {
          const angle = i * Math.PI * .8;
          const leaf = oval(Math.cos(angle) * .18, .58 + i * .035, Math.sin(angle) * .18, .12, .18, .09, olive);
          leaf.rotation.z = Math.cos(angle) * .45;
          leaf.rotation.x = Math.sin(angle) * .35;
        }
        break;
      case "bench":
        box(0, .78, 0, 1, .28, .96, linen, .06);
        box(0, .60, 0, .94, .10, .89, oak);
        for (const x of [-.36, .36]) box(x, .28, 0, .10, .56, .72, oak);
        break;
    }
    furnishings.add(group);
  }

  for (const template of [oak, oakLight, linen, ivory, sage, olive, clay, charcoal, brass, porcelain, rug, steel, screen, glass]) template.dispose();
  scene.add(furnishings);
  return furnishings;
}
