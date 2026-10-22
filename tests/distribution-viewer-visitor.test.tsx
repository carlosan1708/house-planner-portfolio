// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import DistributionViewer from "@/app/components/DistributionViewer";
import type { FurnitureItem } from "@/lib/furniture-layout";
import type { HouseModel, SourceReference } from "@/lib/house-distribution";

const state = vi.hoisted(() => ({ width: 320, height: 380, coarse: true, reducedMotion: true, scene: null as THREE.Scene | null, camera: null as THREE.PerspectiveCamera | null, resize: null as (() => void) | null }));
vi.mock("three", async importOriginal => {
  const three = await importOriginal<typeof THREE>();
  return { ...three, WebGLRenderer: class {
    domElement = document.createElement("canvas");
    shadowMap = { enabled: false, type: three.PCFShadowMap };
    setPixelRatio() {}
    setSize(width: number, height: number) { this.domElement.width = width; this.domElement.height = height; }
    render(scene: THREE.Scene, camera: THREE.PerspectiveCamera) { state.scene = scene; state.camera = camera; }
    dispose() {}
  } };
});
vi.mock("three/addons/controls/OrbitControls.js", async () => {
  const three = await import("three");
  return { OrbitControls: class {
    target = new three.Vector3(); enabled = true; maxDistance = 150;
    constructor(private camera: THREE.PerspectiveCamera) {}
    update() { this.camera.lookAt(this.target); this.camera.updateMatrixWorld(); }
    addEventListener() {}
    dispose() {}
  } };
});

const source: SourceReference = { documentId: "plan", page: 1, sheet: "Planta" };
const model: HouseModel = {
  schemaVersion: 1, name: "Casa", revision: 1, sourceDocumentIds: ["plan"], notes: "", fixtures: [], openings: [],
  rooms: [{ id: "living", name: "Sala", polygon: [[0, 0], [12, 0], [12, 9], [0, 9]], color: "#abcdef", source,
    height: { value: 3, status: "approximate", note: "Altura aproximada", source }, finishes: "CER", notes: "",
    coverage: { outlet: "unconfirmed", light: "unconfirmed", switch: "unconfirmed", ac: "unconfirmed" } }],
  walls: [{ id: "front", start: [0, 0], end: [12, 0], thickness: .15, height: 3, source }],
  envelope: { source, status: "approximate", notes: "Cubierta aproximada", levels: [], faces: [
    { id: "roof-a", kind: "roof", vertices: [[0, 0, 3], [12, 0, 3], [12, 9, 3]] },
    { id: "roof-b", kind: "roof", vertices: [[0, 0, 3], [12, 9, 3], [0, 9, 3]] },
  ], variants: [{ id: "reference", label: { en: "Reference roof", es: "Cubierta de referencia" }, source, notes: "Referencia aproximada", faces: [
    { id: "roof-reference", kind: "roof", vertices: [[0, 0, 3], [12, 0, 3], [12, 9, 3]] },
  ] }] },
};

let root: Root | null = null;
let container: HTMLDivElement;
beforeEach(() => {
  state.width = 320; state.height = 380; state.coarse = true; state.reducedMotion = true; state.scene = null; state.camera = null;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query.includes("prefers-reduced-motion") ? state.reducedMotion : state.coarse, addEventListener() {}, removeEventListener() {} })));
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: ResizeObserverCallback) {}
    observe() { state.resize = () => this.callback([], this as unknown as ResizeObserver); state.resize(); }
    disconnect() { state.resize = null; }
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => state.width);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => state.height);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root?.unmount()); root = null; vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

async function render(snapshot = model, onResetView = vi.fn()) {
  await act(async () => { root!.render(createElement(DistributionViewer, { model: snapshot, recordRevision: 1, selection: null, onSelect: vi.fn(), onResetView, onCaptureReady: vi.fn(), layers: { outlet: false, light: false, switch: false, ac: false, dimensions: false }, language: "es" })); });
  return onResetView;
}
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(button => button.textContent === label);
  expect(button, label).toBeDefined();
  await act(async () => { button!.click(); });
}
function architecturalBounds() {
  const box = new THREE.Box3();
  state.scene!.updateMatrixWorld(true);
  state.scene!.traverse(object => {
    if (object instanceof THREE.Mesh && ["room", "wall", "opening", "surface"].includes(object.userData.kind)) box.union(new THREE.Box3().setFromObject(object));
  });
  expect(box.isEmpty()).toBe(false);
  return box;
}
function expectFramed(box: THREE.Box3) {
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const projected = new THREE.Vector3(x, y, z).project(state.camera!);
    expect(Math.abs(projected.x)).toBeLessThan(1);
    expect(Math.abs(projected.y)).toBeLessThan(1);
  }
}

describe("visitor house exploration", () => {
  it.each([[320, 380], [1280, 560]])("frames the whole house at %i × %i without changing model geometry", async (width, height) => {
    state.width = width; state.height = height;
    const original = JSON.stringify(model);
    await render();
    expect(container.textContent).toContain("Ver interior");
    expect(container.textContent).toContain("Fachada");
    expectFramed(architecturalBounds());
    expect(JSON.stringify(model)).toBe(original);
    expect(container.querySelector<HTMLDetailsElement>(".distribution-roof-variant")!.open).toBe(false);
  });

  it("frames the complete house in the front preset and keeps it framed through phone rotation", async () => {
    await render();
    await click("Fachada");
    const box = architecturalBounds();
    expectFramed(box);
    expect(state.camera!.position.x).toBeCloseTo(6);
    expect(state.camera!.position.z).toBeGreaterThan(0);
    state.width = 844; state.height = 210;
    await act(async () => { state.resize!(); });
    expectFramed(box);
    state.width = 320; state.height = 380;
    await act(async () => { state.resize!(); });
    expectFramed(box);
  });

  it.each(["left", "right"] as const)("looks at the %s carport from its outer side, framed at 320px and through rotation", async side => {
    const snapshot = structuredClone(model);
    const minX = side === "left" ? -3 : 12, maxX = minX + 3;
    snapshot.rooms.push({ ...snapshot.rooms[0], id: "carport", name: "Cochera", polygon: [[minX, 0], [maxX, 0], [maxX, 9], [minX, 9]] });
    snapshot.envelope!.faces.push({ id: "carport-roof", kind: "roof", vertices: [[minX, 0, 3], [maxX, 0, 3], [maxX, 9, 3]] });
    snapshot.walls.push(
      { id: "left", start: [0, 0], end: [0, 9], thickness: .15, height: 3, source },
      { id: "right", start: [12, 0], end: [12, 9], thickness: .15, height: 3, source },
    );
    const original = JSON.stringify(snapshot);
    await render(snapshot);
    await click("Vista de cochera");
    const box = new THREE.Box3();
    state.scene!.traverse(object => { if (object instanceof THREE.Mesh && object.userData.kind === "room" && object.userData.id === "carport") box.union(new THREE.Box3().setFromObject(object)); });
    expectFramed(box);
    const houseBox = architecturalBounds();
    expect(box.max.x - box.min.x).toBeLessThan(houseBox.max.x - houseBox.min.x);
    expect(box.max.y).toBe(3);
    if (side === "left") expect(state.camera!.position.x).toBeLessThan(box.min.x);
    else expect(state.camera!.position.x).toBeGreaterThan(box.max.x);
    const target = box.getCenter(new THREE.Vector3()), ray = new THREE.Raycaster(state.camera!.position, target.clone().sub(state.camera!.position).normalize(), 0, target.distanceTo(state.camera!.position));
    const houseWalls: THREE.Mesh[] = [];
    state.scene!.traverse(object => { if (object instanceof THREE.Mesh && object.userData.kind === "wall") houseWalls.push(object); });
    state.scene!.updateMatrixWorld();
    expect(ray.intersectObjects(houseWalls)).toHaveLength(0);
    state.width = 844; state.height = 210;
    await act(async () => { state.resize!(); });
    expectFramed(box);
    state.width = 320; state.height = 380;
    await act(async () => { state.resize!(); });
    expectFramed(box);
    expect(JSON.stringify(snapshot)).toBe(original);
  });

  it("restores the complete house and page scrolling after exploring the interior", async () => {
    const onResetView = await render();
    expect(container.querySelector("canvas")!.style.touchAction).toBe("pan-y pinch-zoom");
    await click("Interactuar con el modelo");
    expect(container.querySelector("canvas")!.style.touchAction).toBe("none");
    expect(container.querySelector(".distribution-touch-help")!.textContent).toContain("dos para acercar");
    await click("Ver interior");
    expect(container.textContent).toContain("Ver casa completa");
    expect(container.querySelector(".distribution-roof-variant")).toBeNull();
    await click("Restablecer vista");
    expect(onResetView).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Ver interior");
    expect(container.querySelector("canvas")!.style.touchAction).toBe("pan-y pinch-zoom");
  });

  it("keeps legacy models available with a room layout when no building envelope exists", async () => {
    await render({ ...model, envelope: undefined });
    expect(container.textContent).not.toContain("Ver interior");
    expect(container.textContent).not.toContain("Fachada");
    expect(container.querySelector("canvas")).not.toBeNull();
    await click("Restablecer vista");
    expect(container.querySelector("canvas")).not.toBeNull();
  });

  it("keeps furniture selection isolated without rebuilding the scene and releases shared resources once", async () => {
    const items: FurnitureItem[] = [1, 2].map(index => ({ id: `bench-${index}`, roomId: "living", kind: "bench", position: [index * 3, 3], rotation: 0, width: 1.3, depth: .45, height: .5, label: { en: "Bench", es: "Banco" } }));
    const props = { model, recordRevision: 1, onSelect: vi.fn(), onCaptureReady: vi.fn(), layers: { outlet: false, light: false, switch: false, ac: false, dimensions: false }, language: "es" as const, furnitureItems: items };
    await act(async () => { root!.render(createElement(DistributionViewer, { ...props, selection: null })); });
    const scene = state.scene, canvas = container.querySelector("canvas"), camera = state.camera;
    expect(container.querySelector(".distribution-scene-wrap")!.getAttribute("data-view")).toBe("interior");
    await act(async () => { root!.render(createElement(DistributionViewer, { ...props, selection: { kind: "furniture", id: items[0].id } })); });
    expect(state.scene).toBe(scene); expect(state.camera).toBe(camera); expect(container.querySelector("canvas")).toBe(canvas);
    const meshes: THREE.Mesh[] = [];
    scene!.traverse(object => { if (object instanceof THREE.Mesh && object.userData.kind === "furniture") meshes.push(object); });
    expect(meshes.length).toBeGreaterThan(2);
    for (const mesh of meshes) expect((mesh.material as THREE.MeshStandardMaterial).emissive.getHex()).toBe(mesh.userData.id === items[0].id ? 0x385b3e : 0);
    const materials = new Set(meshes.flatMap(mesh => Array.isArray(mesh.material) ? mesh.material : [mesh.material]));
    const geometries = new Set(meshes.map(mesh => mesh.geometry));
    const materialDisposals = [...materials].map(material => vi.spyOn(material, "dispose"));
    const geometryDisposals = [...geometries].map(geometry => vi.spyOn(geometry, "dispose"));
    await act(async () => { root!.unmount(); }); root = null;
    for (const dispose of [...materialDisposals, ...geometryDisposals]) expect(dispose).toHaveBeenCalledOnce();
  });

  it("replaces camera animations and cancels the remaining frame when unmounted", async () => {
    state.reducedMotion = false;
    const frames = new Map<number, FrameRequestCallback>(); let nextFrame = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    await render();
    await click("Vista superior"); expect(frames.size).toBe(1);
    await click("Fachada"); expect(frames.size).toBe(1);
    const [id, callback] = [...frames][0]; frames.delete(id);
    await act(async () => { callback(performance.now() + 1000); });
    expect(frames.size).toBe(0); expect(state.camera!.position.x).toBeCloseTo(6); expectFramed(architecturalBounds());
    await click("Vista superior"); expect(frames.size).toBe(1);
    await act(async () => { root!.unmount(); }); root = null;
    expect(frames.size).toBe(0);
  });

});
