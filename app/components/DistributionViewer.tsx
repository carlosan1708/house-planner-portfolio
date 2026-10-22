"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { polygonMetrics, type HouseModel, type FixtureKind, type Point } from "@/lib/house-distribution";
import { lightMount, roofUndersideFaces } from "@/lib/distribution-light-geometry";
import { wallHeightProfile, wallSectionPolygons } from "@/lib/distribution-height-geometry";
import type { DistributionExportScene } from "@/lib/distribution-export-images";
import { furnitureFootprint, type FurnitureItem, type FurnitureZone } from "@/lib/furniture-layout";
import { addFurnitureItems } from "./furniture-catalog";
import { applyDistributionPresentation } from "./distribution-presentation";
export type Selection = { kind: "room" | "fixture" | "wall" | "opening" | "surface" | "furniture"; id: string };
export type DistributionSceneCapture = () => DistributionExportScene | undefined;
export const fixtureColors: Record<FixtureKind, string> = { outlet: "#d97732", light: "#c59d19", switch: "#8b5fc4", ac: "#2486a8" };

const NO_FURNITURE: FurnitureItem[] = [];
const NO_FURNITURE_ZONES: FurnitureZone[] = [];

function floorTexture(wood: boolean) {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 512;
  const context = canvas.getContext("2d"); if (!context) return null;
  context.fillStyle = wood ? "#c9ae87" : "#ddd8c9"; context.fillRect(0, 0, 512, 512);
  if (wood) {
    for (let row = 0; row < 8; row++) {
      context.fillStyle = ["#d5bd99", "#cbb18b", "#d9c3a1", "#c6ab84"][row % 4]; context.fillRect(0, row * 64 + 1, 512, 62);
      for (let grain = 0; grain < 12; grain++) {
        context.strokeStyle = `rgba(105,76,43,${.03 + grain % 3 * .015})`; context.lineWidth = 1;
        context.beginPath(); context.moveTo(0, row * 64 + grain * 5 + 3); context.bezierCurveTo(150, row * 64 + grain * 5, 350, row * 64 + grain * 5 + 6, 512, row * 64 + grain * 5 + 2); context.stroke();
      }
      context.fillStyle = "#a58d6f"; context.fillRect(row % 2 ? 180 : 375, row * 64, 1, 64);
    }
  } else {
    for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) {
      context.fillStyle = ["#eeeae0", "#e8e4da", "#ece8de", "#e5e1d7"][(row + column) % 4]; context.fillRect(column * 128 + 1, row * 128 + 1, 126, 126);
    }
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(wood ? .3 : .4, wood ? .3 : .4);
  return texture;
}

export default function DistributionViewer({ model, recordRevision, selection, onSelect, onResetView, onCaptureReady, layers, language, furnitureItems = NO_FURNITURE, furnitureZones = NO_FURNITURE_ZONES }: { model: HouseModel; recordRevision: number; selection: Selection | null; onSelect: (selection: Selection) => void; onResetView?: () => void; onCaptureReady: (capture: DistributionSceneCapture | null) => void; layers: Record<FixtureKind | "dimensions", boolean>; language: "en" | "es"; furnitureItems?: FurnitureItem[]; furnitureZones?: FurnitureZone[] }) {
  const mount = useRef<HTMLDivElement>(null);
  const orbitControls = useRef<OrbitControls | null>(null);
  const touchInteractionRef = useRef(false);
  const selectRef = useRef(onSelect); const objects = useRef<THREE.Mesh[]>([]);
  const cameraAction = useRef<(top: boolean, animate?: boolean) => void>(() => {});
  const frontCameraAction = useRef<() => void>(() => {});
  const carportCameraAction = useRef<() => void>(() => {});
  const redraw = useRef<() => void>(() => {});
  const focusRoomAction = useRef<(id: string) => void>(() => {});
  const zoomAction = useRef<(factor: number) => void>(() => {});
  const updateSelection = useRef<(selected: Selection | null) => void>(() => {});
  const selectionRef = useRef(selection);
  const surfaceFocus = useRef<string | undefined>(undefined);
  const savedCamera = useRef<{ position: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const [failed, setFailed] = useState(false);
  const [volume, setVolume] = useState(!furnitureItems.length && !!model.envelope);
  const [viewReset, setViewReset] = useState(0);
  const [variantId, setVariantId] = useState("");
  const [touchInteraction, setTouchInteraction] = useState(false);
  const [materials, setMaterials] = useState(true);
  const [roomLabels, setRoomLabels] = useState(true);
  const [presentation, setPresentation] = useState(false);
  const displayRooms = useMemo(() => [...model.rooms, ...furnitureZones.map(zone => ({ id: zone.id, polygon: zone.polygon, name: zone.name[language] }))], [model.rooms, furnitureZones, language]);
  const surface = model.surfaces?.find(s => selection?.kind === "surface" && s.id === selection.id);
  const showEnvelope = !!model.envelope && (surface?.kind === "roof" || (volume && !surface));
  const variant = model.envelope?.variants?.find(v => v.id === variantId);
  const visibleFaces = variant?.faces || model.envelope?.faces;
  const undersideFaces = useMemo(() => roofUndersideFaces(model, visibleFaces), [model, visibleFaces]);
  const viewKey = `${surface?.id || (volume ? "volume" : "interior")}:${variant?.id || "default"}:${viewReset}`;
  const dimensionRoomId = selection?.kind === "room" ? selection.id : selection?.kind === "fixture" ? model.fixtures.find(f => f.id === selection.id)?.roomId : selection?.kind === "furniture" ? furnitureItems.find(item => item.id === selection.id)?.roomId : undefined;
  const dimensionRoom = displayRooms.find(r => r.id === dimensionRoomId);
  const dimensions = useMemo(() => {
    const points = surface?.polygon || dimensionRoom?.polygon || model.walls.flatMap(w => [w.start, w.end]);
    const fallback = points.length ? points : model.rooms.flatMap(r => r.polygon);
    const minX = Math.min(...fallback.map(p => p[0])), maxX = Math.max(...fallback.map(p => p[0]));
    const minY = Math.min(...fallback.map(p => p[1])), maxY = Math.max(...fallback.map(p => p[1]));
    const rectangular = dimensionRoom?.polygon.length === 4 && dimensionRoom.polygon.every(p => (p[0] === minX || p[0] === maxX) && (p[1] === minY || p[1] === maxY));
    const edges: [Point, Point][] = dimensionRoom && !rectangular ? dimensionRoom.polygon.map((a, i) => [a, dimensionRoom.polygon[(i + 1) % dimensionRoom.polygon.length]]) : [[[minX, minY - .65], [maxX, minY - .65]], [[maxX + .65, minY], [maxX + .65, maxY]]];
    return { edges, metrics: polygonMetrics(fallback) };
  }, [surface, dimensionRoom, model]);
  const dimensionOverlay = layers.dimensions ? dimensions : null;
  const dimensionLabelRoomId = layers.dimensions ? dimensionRoomId : undefined;
  useEffect(() => { selectRef.current = onSelect; }, [onSelect]);
  useEffect(() => {
    touchInteractionRef.current = touchInteraction;
    const query = window.matchMedia("(pointer: coarse)");
    const updateInteraction = () => {
      const enabled = !query.matches || touchInteraction;
      if (orbitControls.current) orbitControls.current.enabled = enabled;
      const canvas = mount.current?.querySelector("canvas");
      if (canvas) canvas.style.touchAction = enabled ? "none" : "pan-y pinch-zoom";
    };
    updateInteraction();
    query.addEventListener("change", updateInteraction);
    return () => query.removeEventListener("change", updateInteraction);
  }, [touchInteraction]);
  useEffect(() => {
    if (failed) { onCaptureReady(null); return; }
    const container = mount.current; if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { onCaptureReady(null); queueMicrotask(() => setFailed(true)); return; }
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#eeeee8");
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    const camera = new THREE.PerspectiveCamera(presentation && showEnvelope ? 36 : 42, 1, .1, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    orbitControls.current = controls;
    controls.enabled = !window.matchMedia("(pointer: coarse)").matches || touchInteractionRef.current;
    renderer.domElement.style.touchAction = controls.enabled ? "none" : "pan-y pinch-zoom";
    controls.maxPolarAngle = Math.PI / 2.03; controls.minDistance = 3; controls.maxDistance = 150;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.setAttribute("aria-label", language === "es" ? "Modelo 3D interactivo. Usa la lista para seleccionar un espacio con el teclado." : "Interactive 3D model. Use the room list for keyboard selection.");
    container.appendChild(renderer.domElement);
    const points = [...model.rooms.flatMap(room => room.polygon), ...model.walls.flatMap(wall => [wall.start, wall.end]), ...furnitureItems.flatMap(item => furnitureFootprint(item)), ...(furnitureItems.length ? furnitureZones.flatMap(zone => zone.polygon) : []), ...(surface?.polygon || []), ...(showEnvelope ? (visibleFaces || []).flatMap(face => face.vertices.map(([x,y]) => [x,y] as Point)) : [])];
    const minX = Math.min(...points.map(point => point[0])), maxX = Math.max(...points.map(point => point[0]));
    const minY = Math.min(...points.map(point => point[1])), maxY = Math.max(...points.map(point => point[1]));
    const width = Math.max(1, maxX - minX), depth = Math.max(1, maxY - minY), size = Math.max(width, depth, 8);
    const center = new THREE.Vector3((minX + maxX) / 2, showEnvelope ? 1.2 : .2, -(minY + maxY) / 2);
    scene.add(new THREE.HemisphereLight(0xfffaf0, 0x849080, 2));
    const sun = new THREE.DirectionalLight(0xfff2d7, 3.4); sun.position.set(center.x - size * .6, size * 1.5, center.z + size * .8);
    sun.target.position.copy(center); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -size * .8; sun.shadow.camera.right = sun.shadow.camera.top = size * .8;
    sun.shadow.camera.far = size * 5; sun.shadow.normalBias = .035; sun.shadow.bias = -.0001; sun.shadow.intensity = .32;
    scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight(0xe3ebff, .8); fill.position.set(center.x + size, size * .7, center.z - size); scene.add(fill);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size * 5, size * 5), new THREE.MeshStandardMaterial({ color: "#eeeee7", roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(center.x, -.23, center.z); ground.receiveShadow = true; scene.add(ground);
    if (presentation && showEnvelope) {
      scene.children.forEach(object => { if (object instanceof THREE.Light) object.intensity = 0; });
      ground.visible = false;
    }
    const woodMap = materials ? floorTexture(true) : null, stoneMap = materials ? floorTexture(false) : null;
    const meshes: THREE.Mesh[] = []; const labels: THREE.Sprite[] = [];
    const mesh = (geometry: THREE.BufferGeometry, color: string, target?: Selection, opacity = 1) => {
      const m = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: .85, emissiveIntensity: .35, side: THREE.DoubleSide, transparent: opacity < 1, opacity }));
      m.castShadow = opacity === 1; m.receiveShadow = true;
      m.userData = { ...target, color }; scene.add(m); if (target) meshes.push(m); return m;
    };
    const label = (text: string, x: number, y: number, z: number, dimension = false) => {
      const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 96;
      const ctx = canvas.getContext("2d"); if (!ctx) return;
      ctx.fillStyle = "rgba(255,255,251,.94)"; ctx.beginPath(); ctx.roundRect(0, 0, 512, 96, 24); ctx.fill();
      ctx.fillStyle = "#273d36"; ctx.font = dimension ? "600 60px sans-serif" : "600 46px sans-serif"; ctx.textAlign = "center"; ctx.fillText(text, 256, dimension ? 69 : 63, 490);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, toneMapped: false, sizeAttenuation: !dimension }));
      sprite.position.set(x, y, z); sprite.scale.set(dimension ? .16 : 2.6, dimension ? .03 : .49, 1); sprite.renderOrder = 5;
      scene.add(sprite); labels.push(sprite);
    };
    for (const room of model.rooms) {
      const shape = new THREE.Shape(room.polygon.map(([x, y]) => new THREE.Vector2(x, y)));
      const floor = mesh(new THREE.ExtrudeGeometry(shape, { depth: .18, bevelEnabled: false }), materials ? "#ffffff" : room.color, { kind: "room", id: room.id }); floor.rotation.x = -Math.PI / 2; floor.position.y = -.18;
      if (materials) {
        const material = floor.material as THREE.MeshStandardMaterial;
        material.map = /oak|wood|roble|madera|parquet/i.test(room.finishes) && /bed|dorm|room/i.test(room.name) ? woodMap : stoneMap;
        material.roughness = .78;
      }
      if(room.id==="carport") floor.position.y=-.19;
      let center = room.polygon.reduce((a, p) => [a[0] + p[0] / room.polygon.length, a[1] + p[1] / room.polygon.length], [0, 0]);
      let inside = false;
      for (let i = 0, j = room.polygon.length - 1; i < room.polygon.length; j = i++) {
        const a = room.polygon[i], b = room.polygon[j];
        if ((a[1] > center[1]) !== (b[1] > center[1]) && center[0] < (b[0] - a[0]) * (center[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
      }
      // The mean vertex position can lie outside a concave zone (especially the exterior passage).
      if (!inside) {
        let largest = 0;
        for (const triangle of THREE.ShapeUtils.triangulateShape(room.polygon.map(([x, y]) => new THREE.Vector2(x, y)), [])) {
          const [a, b, c] = triangle.map(i => room.polygon[i]);
          const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
          if (area > largest) { largest = area; center = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3]; }
        }
      }
      if (roomLabels && !surface && !showEnvelope && room.id !== dimensionLabelRoomId) label(room.name, center[0], 1.35, -center[1]);
    }
    if (visibleFaces) {
      for (const face of visibleFaces) {
        if(!showEnvelope && !face.id.startsWith("carport-column-") && !face.id.startsWith("front-column-") && !face.id.startsWith("demo-pergola-post-") && !face.id.startsWith("demo-terrace-")) continue;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(face.vertices.flatMap(([x, y, z]) => [x, showEnvelope?z:Math.min(z,1.25), -y]), 3));
        geometry.computeVertexNormals();
        const siteElement = face.id.startsWith("demo-pergola-") || face.id.startsWith("demo-terrace-");
        const target:Selection=face.id.startsWith("carport-") && model.rooms.some(r=>r.id==="carport")?{kind:"room",id:"carport"}:{kind:"surface",id:siteElement ? "demo-property" : "roof"};
        mesh(geometry, face.id.startsWith("demo-pergola-") ? "#b38b5a" : face.id.startsWith("demo-terrace-") ? "#d3c6ac" : face.kind === "roof" ? "#a65f43" : face.kind === "glazing" ? "#79b3bf" : face.id.startsWith("entry-cement-lintel") ? "#c7c5bc" : face.id.startsWith("carport-column-")?"#a8aca3":"#f8f6ed", target, face.kind === "glazing" ? .45 : 1);
        if (face.kind === "roof" && !undersideFaces?.length) {
          // Legacy/alternative profiles retain an illustrative underside only.
          const underside = new THREE.BufferGeometry();
          underside.setAttribute("position", new THREE.Float32BufferAttribute(face.vertices.flatMap(([x,y,z]) => [x,z-.03,-y]),3));
          underside.computeVertexNormals(); mesh(underside,"#f8f6ed");
        }
      }
    }
    if (showEnvelope && undersideFaces?.length) {
      for (const face of undersideFaces) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(face.vertices.flatMap(([x,y,z]) => [x,z,-y]),3));
        geometry.computeVertexNormals(); mesh(geometry,"#f8f6ed");
      }
    }
    if (surface && !(surface.kind === "roof" && showEnvelope)) {
      const shape = new THREE.Shape(surface.polygon.map(([x, y]) => new THREE.Vector2(x, y)));
      const plane = mesh(new THREE.ShapeGeometry(shape), surface.kind === "roof" ? "#6d8594" : "#b4cfa7", { kind: "surface", id: surface.id }, surface.kind === "roof" ? .65 : 1);
      plane.rotation.x = -Math.PI / 2; plane.position.y = surface.kind === "roof" ? 1.65 : -.03;
    }
    if (dimensionOverlay) {
      for (const [a, b] of dimensionOverlay.edges) {
        const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const height = surface?.kind === "roof" ? 5.15 : .35;
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a[0], height, -a[1]), new THREE.Vector3(b[0], height, -b[1])]), new THREE.LineBasicMaterial({ color: "#244e3b", depthTest: false }));
        line.renderOrder = 2; scene.add(line);
        label(`≈ ${distance.toFixed(2)} m`, (a[0] + b[0]) / 2, height + .15, -(a[1] + b[1]) / 2, true);
      }
    }
    for (const wall of model.walls) {
      const dx = wall.end[0] - wall.start[0], dy = wall.end[1] - wall.start[1], length = Math.hypot(dx, dy);
      if (!length) continue;
      const exteriorWall = ["front", "back", "left", "right"].includes(wall.id);
      const profile = wallHeightProfile({ ...wall, height: showEnvelope ? wall.height : Math.min(wall.height, 1.25) }, showEnvelope ? undersideFaces : undefined, exteriorWall ? wall.height : undefined);
      const height = Math.max(...profile.flatMap(segment => [segment.startHeight, segment.endHeight]));
      const frontGlass = showEnvelope && wall.id === "front" ? visibleFaces!.filter(f => f.kind === "glazing" && f.vertices.every(v => v[1] === 0)).flatMap(f => f.vertices) : [];
      const glassStart = Math.min(...frontGlass.map(v => v[0])), glassEnd = Math.max(...frontGlass.map(v => v[0])), glassBottom = Math.min(...frontGlass.map(v => v[2]));
      const section = (start: number, width: number, bottom: number, h: number, color = "#f8f6ed", target: Selection = { kind: "wall", id: wall.id }, opacity = 1) => {
        if (width <= 0 || h <= 0) return;
        const cuts = [start, start + width, ...(target.kind === "wall" && frontGlass.length ? [glassStart, glassEnd].filter(x => x > start && x < start + width) : [])].sort((a,b) => a-b);
        for (let i=0; i<cuts.length-1; i++) {
          const left=cuts[i], span=cuts[i+1]-left, middle=left+span/2;
          const visibleHeight = target.kind === "wall" && frontGlass.length && middle >= glassStart && middle <= glassEnd ? Math.min(h, Math.max(0,glassBottom-bottom)) : h;
          if (visibleHeight <= 0) continue;
          const blockColor=wall.id==="front" && target.kind==="wall" && frontGlass.length && middle>=glassStart && middle<=glassEnd && bottom>=2.1 ? "#c7c5bc" : color;
          for (const polygon of wallSectionPolygons(profile, left, left + span, bottom, bottom + visibleHeight)) {
            const shape = new THREE.Shape(polygon.map(([along,z]) => new THREE.Vector2(along,z)));
            const geometry = new THREE.ExtrudeGeometry(shape, { depth: wall.thickness, bevelEnabled: false });
            geometry.translate(0,0,-wall.thickness/2);
            const block = mesh(geometry, blockColor, target, opacity);
            block.position.set(wall.start[0],0,-wall.start[1]); block.rotation.y = Math.atan2(dy, dx);
          }
        }
      };
      const openings = model.openings.filter(o => o.wallId === wall.id).sort((a, b) => a.offset - b.offset);
      let cursor = 0;
      for (const o of openings) {
        section(cursor, o.offset - cursor, 0, height);
        section(o.offset, o.width, 0, Math.min(height, o.sill));
        section(o.offset, o.width, o.sill + o.height, height - o.sill - o.height);
        if (o.kind === "window" || o.glazed) {
          const visibleHeight = Math.min(o.height, Math.max(0, height - o.sill));
          const target: Selection = { kind: "opening", id: o.id };
          section(o.offset, o.width, o.sill, visibleHeight, "#91b8b6", target, .36);
          section(o.offset, .035, o.sill, visibleHeight, "#5a6963", target);
          section(o.offset + o.width - .035, .035, o.sill, visibleHeight, "#5a6963", target);
          section(o.offset, o.width, o.sill, Math.min(.035, visibleHeight), "#5a6963", target);
          if (o.sill + o.height <= height) section(o.offset, o.width, o.sill + o.height - .035, .035, "#5a6963", target);
          if (o.width > 1.3) section(o.offset + o.width / 2 - .015, .03, o.sill, visibleHeight, "#5a6963", target);
        } else {
          section(o.offset, o.width, .015, .04, "#a58261", { kind: "opening", id: o.id });
          if (showEnvelope) section(o.offset + .025, o.width - .05, .04, Math.min(o.height, height) - .04, "#a58b69", { kind: "opening", id: o.id });
        }
        cursor = o.offset + o.width;
      }
      section(cursor, length - cursor, 0, height);
    }
    if (furnitureItems.length) {
      // Catalog surfaces are shared for efficiency; selection needs a material per piece.
      const pieceMaterials = new Map<string, THREE.Material>(), catalogMaterials = new Set<THREE.Material>();
      addFurnitureItems(scene, furnitureItems).traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const pieceMaterial = (material: THREE.Material) => {
          const key = `${object.userData.id}:${material.uuid}`;
          let own = pieceMaterials.get(key);
          if (!own) { own = material.clone(); pieceMaterials.set(key, own); catalogMaterials.add(material); }
          return own;
        };
        object.material = Array.isArray(object.material) ? object.material.map(pieceMaterial) : pieceMaterial(object.material);
        meshes.push(object);
      });
      catalogMaterials.forEach(material => material.dispose());
    }
    for (const fixture of model.fixtures) {
      if (presentation && showEnvelope) continue;
      if (!layers[fixture.kind]) continue;
      if (fixture.kind === "light") {
        const mounting=lightMount(model,fixture,!showEnvelope,visibleFaces);
        const flat=(!showEnvelope && ["ceiling","pendant"].includes(mounting.kind)) || (mounting.kind==="wall" && !mounting.wallId);
        const geometry=flat ? new THREE.CylinderGeometry(.12,.12,.015,16) : mounting.kind==="wall" ? new THREE.BoxGeometry(.15,.18,.12) : mounting.kind==="pendant" ? new THREE.CylinderGeometry(.07,.16,.14,16) : new THREE.CylinderGeometry(.1,.1,mounting.kind==="ground"?.12:.05,16);
        const lamp=mesh(geometry,fixtureColors.light,{kind:"fixture",id:fixture.id});
        lamp.position.set(mounting.position[0],mounting.position[2],-mounting.position[1]);
        if (mounting.kind==="ceiling" && !flat && mounting.normal) lamp.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(mounting.normal[0],mounting.normal[2],-mounting.normal[1]));
        if (mounting.kind==="wall" && mounting.normal) lamp.rotation.y=Math.atan2(mounting.normal[0],-mounting.normal[1]);
        if (mounting.support) {
          const a=new THREE.Vector3(mounting.support.start[0],mounting.support.start[2],-mounting.support.start[1]);
          const b=new THREE.Vector3(mounting.support.end[0],mounting.support.end[2],-mounting.support.end[1]);
          const direction=b.clone().sub(a),length=direction.length();
          if (length>0) {
            const radius=mounting.kind==="ground"?.035:.012;
            const support=mesh(new THREE.CylinderGeometry(radius,radius,length,8),"#535b56",{kind:"fixture",id:fixture.id});
            support.position.copy(a).add(b).multiplyScalar(.5);
            support.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());
          }
        }
        continue;
      }
      const geometry = fixture.kind === "ac" ? new THREE.BoxGeometry(.55, .2, .2) : new THREE.BoxGeometry(.18, .18, .12);
      const m = mesh(geometry, fixtureColors[fixture.kind], { kind: "fixture", id: fixture.id });
      m.position.set(fixture.position[0], showEnvelope ? fixture.height : Math.min(fixture.height, 1.1) + .05, -fixture.position[1]);
      if (fixture.kind === "ac") {
        let nearest = .4;
        for (const wall of model.walls) {
          const dx = wall.end[0] - wall.start[0], dy = wall.end[1] - wall.start[1];
          const t = Math.max(0, Math.min(1, ((fixture.position[0] - wall.start[0]) * dx + (fixture.position[1] - wall.start[1]) * dy) / (dx * dx + dy * dy)));
          const distance = Math.hypot(fixture.position[0] - wall.start[0] - t * dx, fixture.position[1] - wall.start[1] - t * dy);
          if (distance < nearest) { nearest = distance; m.rotation.y = Math.atan2(dy, dx); }
        }
      }
    }
    // Architectural bounds exclude the shadow ground, lighting and labels.
    const box = new THREE.Box3();
    scene.updateMatrixWorld(true);
    for (const object of meshes) box.union(new THREE.Box3().setFromObject(object));
    const disposePresentation = presentation && showEnvelope ? applyDistributionPresentation(scene, renderer, model, materials) : undefined;
    const composer = presentation && showEnvelope ? new EffectComposer(renderer) : undefined;
    const ambientOcclusion = composer ? new SSAOPass(scene, camera, 1, 1, 16) : undefined;
    if (composer && ambientOcclusion) {
      composer.renderTarget1.samples = 4;
      composer.renderTarget2.samples = 4;
      composer.addPass(new RenderPass(scene, camera));
      ambientOcclusion.kernelRadius = .45;
      ambientOcclusion.minDistance = .001;
      ambientOcclusion.maxDistance = .18;
      composer.addPass(ambientOcclusion);
      composer.addPass(new OutputPass());
    }
    const render = () => composer ? composer.render() : renderer.render(scene, camera); redraw.current = render;
    let cameraFrame = 0;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const stopTransition = () => { cancelAnimationFrame(cameraFrame); cameraFrame = 0; };
    const moveCamera = (position: THREE.Vector3, target: THREE.Vector3, animate = true) => {
      stopTransition();
      if (!animate || reducedMotion) { camera.position.copy(position); controls.target.copy(target); if (!controls.update()) render(); return; }
      const from = camera.position.clone(), fromTarget = controls.target.clone(), started = performance.now();
      const tick = (now: number) => {
        const elapsed = Math.min(1, (now - started) / 360), eased = 1 - (1 - elapsed) ** 3;
        camera.position.lerpVectors(from, position, eased); controls.target.lerpVectors(fromTarget, target, eased); if (!controls.update()) render();
        if (elapsed < 1) cameraFrame = requestAnimationFrame(tick); else cameraFrame = 0;
      };
      cameraFrame = requestAnimationFrame(tick);
    };
    // Fit each preset into both fields of view, including narrow phone screens.
    let framing: (() => void) | null = null;
    camera.aspect = container.clientWidth > 0 && container.clientHeight > 0 ? container.clientWidth / container.clientHeight : 1;
    camera.updateProjectionMatrix();
    const fitView = (target: THREE.Vector3, direction: THREE.Vector3, bounds = box, animate = true) => {
      direction.normalize();
      const right = new THREE.Vector3(0, 1, 0).cross(direction).normalize();
      const up = direction.clone().cross(right);
      const verticalTangent = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / 1.08;
      const horizontalTangent = verticalTangent * camera.aspect;
      let distance = 3;
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        const offset = new THREE.Vector3(x, y, z).sub(target), depth = offset.dot(direction);
        distance = Math.max(distance, Math.abs(offset.dot(right)) / horizontalTangent + depth, Math.abs(offset.dot(up)) / verticalTangent + depth);
      }
      controls.maxDistance = Math.max(150, distance * 2);
      moveCamera(target.clone().addScaledVector(direction, distance), target, animate);
    };
    cameraAction.current = (top, animate = true) => {
      const photographic = presentation && showEnvelope && !top;
      const direction = photographic ? new THREE.Vector3(.48, .24, 1.1) : new THREE.Vector3(top ? 0 : (showEnvelope ? .8 : .6), top ? 1.7 : showEnvelope ? .6 : 1.15, top ? .001 : showEnvelope ? 1.2 : .88);
      const target = photographic ? new THREE.Vector3(center.x, box.max.y * .4, center.z + depth * .1) : center;
      framing = () => fitView(target, direction, box, false);
      fitView(target, direction, box, animate);
    };
    frontCameraAction.current = () => {
      const front = model.walls.find(w => w.id === "front"), x = front ? (front.start[0] + front.end[0]) / 2 : center.x;
      const target = new THREE.Vector3(x, 2.3, 0), direction = new THREE.Vector3(0, .035, 1);
      framing = () => fitView(target, direction, box, false);
      fitView(target, direction);
    };
    carportCameraAction.current = () => {
      const carport = model.rooms.find(room => room.id === "carport"); if (!carport) return;
      const bounds = new THREE.Box3();
      for (const object of meshes.filter(object => object.userData.kind === "room" && object.userData.id === carport.id)) bounds.union(new THREE.Box3().setFromObject(object));
      if (bounds.isEmpty()) return;
      const target = bounds.getCenter(new THREE.Vector3());
      const outward = new THREE.Vector3(target.x - center.x, 0, target.z - center.z);
      if (outward.lengthSq() < .001) outward.set(-1, 0, 0);
      outward.normalize().add(new THREE.Vector3(0, .1, .35));
      framing = () => fitView(target, outward, bounds, false);
      fitView(target, outward, bounds);
    };
    focusRoomAction.current = id => {
      const room = displayRooms.find(room => room.id === id); if (!room) return;
      const bounds = new THREE.Box3();
      for (const [x, y] of room.polygon) { bounds.expandByPoint(new THREE.Vector3(x, 0, -y)); bounds.expandByPoint(new THREE.Vector3(x, 1.4, -y)); }
      const target = bounds.getCenter(new THREE.Vector3()), direction = new THREE.Vector3(.65, 1.5, .85);
      framing = () => fitView(target, direction, bounds, false);
      fitView(target, direction, bounds);
    };
    zoomAction.current = factor => {
      const direction = camera.position.clone().sub(controls.target), distance = THREE.MathUtils.clamp(direction.length() * factor, controls.minDistance, controls.maxDistance);
      framing = null; moveCamera(controls.target.clone().addScaledVector(direction.normalize(), distance), controls.target.clone());
    };
    if (savedCamera.current && surfaceFocus.current === `${viewKey}:${presentation}`) { camera.position.copy(savedCamera.current.position); controls.target.copy(savedCamera.current.target); controls.update(); } else cameraAction.current(!!surface, false);
    surfaceFocus.current = `${viewKey}:${presentation}`;
    controls.addEventListener("change", render);
    controls.addEventListener("start", () => { stopTransition(); framing = null; });
    const resize = new ResizeObserver(() => { const width = container.clientWidth, height = container.clientHeight; if (!width || !height) return; renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); composer?.setSize(width, height); if (framing) framing(); else render(); }); resize.observe(container);
    const outline = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: "#52775b", depthTest: false, transparent: true, opacity: .9 })); outline.renderOrder = 4; outline.visible = false; scene.add(outline);
    const highlight = (selected: Selection | null) => {
      for (const item of meshes) (item.material as THREE.MeshStandardMaterial).emissive.set(item.userData.id === selected?.id && item.userData.kind === selected?.kind ? "#385b3e" : "#000000");
      const room = selected?.kind === "room" ? displayRooms.find(room => room.id === selected.id) : null;
      const item = selected?.kind === "furniture" ? furnitureItems.find(item => item.id === selected.id) : null;
      const polygon = room?.polygon || (item ? furnitureFootprint(item) : null);
      outline.visible = !!polygon && !showEnvelope;
      if (polygon) { outline.geometry.dispose(); outline.geometry = new THREE.BufferGeometry().setFromPoints(polygon.map(([x,y]) => new THREE.Vector3(x,.035,-y))); }
      render();
    };
    updateSelection.current = highlight; highlight(selectionRef.current);
    const ray = new THREE.Raycaster();
    const hitAt = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
      return ray.intersectObjects(meshes)[0];
    };
    const pointers = new Map<number, { x: number; y: number }>(); let gesture = false;
    const onDown = (event: PointerEvent) => {
      controls.enabled = event.pointerType === "mouse" || !window.matchMedia("(pointer: coarse)").matches || touchInteractionRef.current;
      if (!controls.enabled) { pointers.clear(); gesture = true; return; }
      if (!pointers.size) gesture = false;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); if (pointers.size > 1) gesture = true;
    };
    const onMove = (event: PointerEvent) => {
      const origin = pointers.get(event.pointerId);
      if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 6) gesture = true;
      if (!pointers.size && event.pointerType === "mouse") renderer.domElement.style.cursor = hitAt(event) ? "pointer" : "grab";
    };
    const onUp = (event: PointerEvent) => {
      const origin = pointers.get(event.pointerId); pointers.delete(event.pointerId);
      if (!origin || gesture || pointers.size || Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 6 || event.button > 0) return;
      const hit = hitAt(event); if (hit) selectRef.current({ kind: hit.object.userData.kind, id: hit.object.userData.id });
    };
    const onCancel = (event: PointerEvent) => { pointers.delete(event.pointerId); gesture = true; };
    const lost = (event: Event) => { event.preventDefault(); onCaptureReady(null); setFailed(true); };
    renderer.domElement.style.cursor = "grab";
    renderer.domElement.addEventListener("pointerdown", onDown, true); renderer.domElement.addEventListener("pointermove", onMove); renderer.domElement.addEventListener("pointerup", onUp); renderer.domElement.addEventListener("pointercancel", onCancel); renderer.domElement.addEventListener("webglcontextlost", lost);
    objects.current = meshes; render();
    onCaptureReady(() => {
      try {
        // Read immediately after rendering, before WebGL clears its drawing buffer.
        render();
        const source = renderer.domElement;
        if (!source.width || !source.height || renderer.getContext().isContextLost()) return;
        const scale = Math.min(1, 4096 / source.width, 4096 / source.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.floor(source.width * scale)); canvas.height = Math.max(1, Math.floor(source.height * scale));
        const context = canvas.getContext("2d"); if (!context) return;
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
        const visible = Object.entries(layers).filter(([kind, enabled]) => enabled && (kind === "dimensions" || !(presentation && showEnvelope))).map(([kind]) => kind).join(", ");
        return { dataUrl: canvas.toDataURL("image/png"), recordRevision, view: `${showEnvelope ? (presentation ? "presentación exterior" : "volumen") : "interior recortado"}; variante ${variant?.id || "default"}; capas ${visible}; mobiliario propuesto ${furnitureItems.length}` };
      } catch { return; }
    });
    return () => {
      onCaptureReady(null); orbitControls.current = null;
      savedCamera.current = { position: camera.position.clone(), target: controls.target.clone() }; stopTransition(); resize.disconnect(); controls.dispose();
      disposePresentation?.();
      composer?.passes.forEach(pass => pass.dispose()); composer?.dispose();
      renderer.domElement.removeEventListener("pointerdown", onDown, true); renderer.domElement.removeEventListener("pointermove", onMove); renderer.domElement.removeEventListener("pointerup", onUp); renderer.domElement.removeEventListener("pointercancel", onCancel); renderer.domElement.removeEventListener("webglcontextlost", lost);
      const geometries = new Set<THREE.BufferGeometry>(), materialSet = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
      scene.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Sprite) {
          if (!(object instanceof THREE.Sprite)) geometries.add(object.geometry);
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            materialSet.add(material); if ("map" in material && material.map instanceof THREE.Texture) textures.add(material.map);
          }
        }
      });
      geometries.forEach(geometry => geometry.dispose()); textures.forEach(texture => texture.dispose()); materialSet.forEach(material => material.dispose());
      sun.shadow.map?.dispose(); renderer.dispose(); renderer.domElement.remove(); objects.current = []; redraw.current = () => {}; updateSelection.current = () => {}; cameraAction.current = () => {}; focusRoomAction.current = () => {}; zoomAction.current = () => {};
    };
  }, [failed, model, recordRevision, onCaptureReady, layers, language, dimensionOverlay, dimensionLabelRoomId, surface, volume, showEnvelope, viewKey, visibleFaces, undersideFaces, variant?.id, materials, roomLabels, furnitureItems, furnitureZones, presentation, displayRooms]);
  useEffect(() => { selectionRef.current = selection; updateSelection.current(selection); }, [selection]);

  const es = language === "es";
  const fallbackPoints = [...model.rooms.flatMap(r => r.polygon), ...furnitureItems.flatMap(item => furnitureFootprint(item)), ...(furnitureItems.length ? furnitureZones.flatMap(zone => zone.polygon) : []), ...(surface?.polygon || []), ...(layers.dimensions ? dimensions.edges.flat() : [])];
  const minX = Math.min(...fallbackPoints.map(p => p[0])) - 1, maxY = Math.max(...fallbackPoints.map(p => p[1])) + 1;
  const fallbackWidth = Math.max(...fallbackPoints.map(p => p[0])) - minX + 1, fallbackHeight = maxY - Math.min(...fallbackPoints.map(p => p[1])) + 1;
  const surfacePolygon = surface && <polygon points={surface.polygon.map(p => `${p[0]},${-p[1]}`).join(" ")} fill={surface.kind === "roof" ? "#6d8594" : "#b4cfa7"} fillOpacity={surface.kind === "roof" ? .65 : 1} stroke="#244e3b" strokeWidth=".1"><title>{surface.kind === "roof" ? (es ? "Techo" : "Roof") : (es ? "Terreno completo" : "Entire property")}</title></polygon>;
  return <div className="distribution-scene-wrap" data-render-mode={failed ? "2d" : "3d"} data-view={surface ? "surface" : volume ? "volume" : "interior"} data-furniture-count={furnitureItems.length} data-presentation={presentation && showEnvelope}>
    {!failed && <button type="button" className="distribution-touch-toggle" aria-pressed={touchInteraction} onClick={() => setTouchInteraction((active) => !active)}>{touchInteraction ? (es ? "Volver a desplazar la página" : "Return to page scrolling") : (es ? "Interactuar con el modelo" : "Interact with the model")}</button>}
    <div className="distribution-camera"><button onClick={() => { setVolume(!furnitureItems.length && !!model.envelope); setVariantId(""); setTouchInteraction(false); setPresentation(false); onResetView?.(); setViewReset(previous => previous + 1); }}>{es ? "Restablecer vista" : "Reset view"}</button><button onClick={() => cameraAction.current(true)}>{es ? "Vista superior" : "Top view"}</button>{model.envelope && !surface && !failed && <button aria-pressed={volume} onClick={() => setVolume(previous => !previous)}>{volume ? (es ? "Ver interior" : "Show interior") : (es ? "Ver casa completa" : "Show complete house")}</button>}{showEnvelope && !failed && <button onClick={()=>frontCameraAction.current()}>{es?"Fachada":"Front view"}</button>}{showEnvelope && !failed && model.rooms.some(r=>r.id==="carport") && <button onClick={()=>carportCameraAction.current()}>{es?"Vista de cochera":"Carport view"}</button>}</div>
    {!failed && <><div className="distribution-display" role="group" aria-label={es ? "Apariencia del modelo" : "Model appearance"}>{showEnvelope && <button aria-pressed={presentation} onClick={() => setPresentation(value => !value)}>{es ? "Presentación" : "Presentation"}</button>}<button aria-pressed={materials} onClick={() => setMaterials(value => !value)}>{es ? "Materiales" : "Materials"}</button><button aria-pressed={roomLabels} onClick={() => setRoomLabels(value => !value)}>{es ? "Nombres de espacios" : "Room labels"}</button>{dimensionRoom && !surface && !showEnvelope && <button onClick={() => focusRoomAction.current(dimensionRoom.id)}>{es ? "Enfocar espacio" : "Focus room"}</button>}</div><div className="distribution-scene-status"><i /><span>{showEnvelope ? (es ? "VOLUMEN EXTERIOR" : "EXTERIOR VOLUME") : (es ? "VISTA INTERIOR" : "INTERIOR VIEW")}</span></div><div className="distribution-zoom" role="group" aria-label={es ? "Zoom del modelo" : "Model zoom"}><button aria-label={es ? "Acercar" : "Zoom in"} onClick={() => zoomAction.current(.8)}>＋</button><button aria-label={es ? "Alejar" : "Zoom out"} onClick={() => zoomAction.current(1.25)}>−</button></div></>}
    <div ref={mount} className="distribution-scene" hidden={failed} />
    {failed && <div className="distribution-fallback"><p>{es ? "3D no disponible. Selecciona un espacio en el plano o la lista." : "3D unavailable. Select a room in the plan or list."}</p><svg viewBox={`${minX} ${-maxY} ${fallbackWidth} ${fallbackHeight}`} role="img" aria-label={es ? "Plano de espacios" : "Room plan"}>
      {surface?.kind === "property" && surfacePolygon}
      {!!furnitureItems.length && furnitureZones.map(zone => <polygon key={zone.id} points={zone.polygon.map(([x,y]) => `${x},${-y}`).join(" ")} fill="#d3c6ac" stroke="white" strokeWidth=".08" onClick={() => onSelect({kind:"room",id:zone.id})}><title>{zone.name[language]}</title></polygon>)}
      {model.rooms.map(r => <polygon key={r.id} points={r.polygon.map(p => `${p[0]},${-p[1]}`).join(" ")} fill={r.color} stroke={selection?.id === r.id ? "#183f30" : "white"} strokeWidth=".08" onClick={() => onSelect({ kind: "room", id: r.id })}><title>{r.name}</title></polygon>)}
      {furnitureItems.map(item => <polygon key={item.id} data-furniture-id={item.id} points={furnitureFootprint(item).map(([x,y]) => `${x},${-y}`).join(" ")} fill={selection?.kind === "furniture" && selection.id === item.id ? "#46674e" : "#bda484"} fillOpacity={item.kind === "rug" ? .35 : .9} stroke="#ffffff" strokeWidth=".025" onClick={() => onSelect({kind:"furniture",id:item.id})}><title>{item.label[language]}</title></polygon>)}
      {surface?.kind === "roof" && surfacePolygon}
      {layers.dimensions && dimensions.edges.map(([a,b],i) => <g key={i} pointerEvents="none"><line x1={a[0]} y1={-a[1]} x2={b[0]} y2={-b[1]} stroke="#244e3b" strokeWidth=".06"/><text x={(a[0]+b[0])/2} y={-(a[1]+b[1])/2} textAnchor="middle" fontSize={surface?.kind === "property" ? 1.5 : .5} fill="#163b2b" paintOrder="stroke" stroke="white" strokeWidth=".12">≈ {Math.hypot(a[0]-b[0],a[1]-b[1]).toFixed(2)} m</text></g>)}
    </svg></div>}
    {showEnvelope && !failed && !!model.envelope?.variants?.length && <details className="distribution-roof-variant"><summary>{es ? "Fuente de la cubierta" : "Roof source"}</summary><label>{es ? "Cubierta visible" : "Visible roof"}<select value={variant?.id || ""} onChange={e => setVariantId(e.target.value)}><option value="">{es ? "Cubierta del modelo (aproximada)" : "Model roof (approximate)"}</option>{model.envelope.variants.map(v => <option key={v.id} value={v.id}>{v.label[language]}</option>)}</select></label>{variant ? <p>{variant.notes}</p>:model.rooms.some(r=>r.id==="carport")&&<p>{es?"Cubierta y cochera según cortes · Apoyos y aleros aproximados":"Roof and carport from sections · Approximate supports and eaves"}</p>}</details>}
    {layers.dimensions && <div className="distribution-dimension-summary" role="status"><strong>{dimensionRoom?.name || (surface?.kind === "roof" ? (es ? "Techo · proyección horizontal" : "Roof · horizontal projection") : surface?.kind === "property" ? (es ? "Terreno completo" : "Entire property") : (es ? "Casa · medidas generales" : "House · overall dimensions"))}</strong><span>≈ {dimensions.metrics.width.toFixed(2)} × {dimensions.metrics.depth.toFixed(2)} m</span><small>{es ? "Selecciona un espacio, techo o terreno para ver sus cotas." : "Select a room, roof or property to see its dimensions."}</small></div>}
    {!failed && <p className="distribution-touch-help">{touchInteraction ? (es ? "Arrastra con un dedo para girar; pellizca con dos para acercar. Usa Volver a desplazar la página para seguir navegando." : "Drag with one finger to rotate; pinch with two to zoom. Use Return to page scrolling to keep browsing.") : (es ? "Puedes desplazar la página sobre el modelo. Activa Interactuar con el modelo para girarlo y acercarte." : "Scroll the page over the model. Enable Interact with the model to rotate and zoom.")}</p>}
    <p className="distribution-hint">{es ? "Arrastra para girar · Pellizca o desplaza para acercar" : "Drag to rotate · Pinch or scroll to zoom"} · {showEnvelope ? (undersideFaces?.length ? (es ? "Alturas bajo cubierta trazadas de los cortes; cielo terminado pendiente" : "Roof underside heights traced from sections; finished ceiling pending") : (es ? "Volumen y apoyos aproximados; alturas pendientes" : "Approximate volume and mounts; heights pending")) : (layers.light ? (es ? "Paredes recortadas · Luces del cielo indicadas sobre el plano" : "Walls cut down · Ceiling lights marked on the plan") : (es ? "Paredes recortadas para mostrar la distribución interior" : "Walls cut down to show the interior layout"))}</p>
  </div>;
}
