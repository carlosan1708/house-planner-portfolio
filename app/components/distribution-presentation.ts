import * as THREE from "three";
import type { HouseModel, Point } from "@/lib/house-distribution";

function seededRandom(seed: number) {
  return () => {
    seed |= 0;
    seed = seed + 0x6d2b79f5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function canvasTexture(draw: (context: CanvasRenderingContext2D, random: () => number) => void, repeat = true) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const context = canvas.getContext("2d");
  if (context) draw(context, seededRandom(72439));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

function contains(polygon: Point[], x: number, y: number) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** A presentation of the supplied geometry. Only planting, ground and a door-aligned path are added. */
export function applyDistributionPresentation(scene: THREE.Scene, renderer: THREE.WebGLRenderer, model: HouseModel, materials = true): () => void {
  const random = seededRandom(38127);
  const points = model.walls.flatMap(wall => [wall.start, wall.end]);
  if (!points.length) return () => {};
  const minX = Math.min(...points.map(point => point[0])), maxX = Math.max(...points.map(point => point[0]));
  const minY = Math.min(...points.map(point => point[1])), maxY = Math.max(...points.map(point => point[1]));
  const size = Math.max(maxX - minX, maxY - minY, 8);
  const center = new THREE.Vector3((minX + maxX) / 2, 0, -(minY + maxY) / 2);
  const property = model.surfaces?.find(surface => surface.kind === "property")?.polygon || [[minX - 2, minY - 4], [maxX + 2, minY - 4], [maxX + 2, maxY + 5], [minX - 2, maxY + 5]] as Point[];
  const lotMinX = Math.min(...property.map(point => point[0])), lotMaxX = Math.max(...property.map(point => point[0]));
  const lotMinY = Math.min(...property.map(point => point[1])), lotMaxY = Math.max(...property.map(point => point[1]));
  const deckVertices = model.envelope?.faces.filter(face => face.id.startsWith("demo-terrace-")).flatMap(face => face.vertices) || [];
  const deck = deckVertices.length ? {
    minX: Math.min(...deckVertices.map(vertex => vertex[0])), maxX: Math.max(...deckVertices.map(vertex => vertex[0])),
    minY: Math.min(...deckVertices.map(vertex => vertex[1])), maxY: Math.max(...deckVertices.map(vertex => vertex[1])),
  } : null;
  const overlapsDeck = (x: number, y: number, margin: number) => !!deck && x >= deck.minX - margin && x <= deck.maxX + margin && y >= deck.minY - margin && y <= deck.maxY + margin;
  const previousBackground = scene.background, previousEnvironment = scene.environment, previousFog = scene.fog;
  const previousIntensity = scene.environmentIntensity;
  const added = new THREE.Group();
  added.name = "Model presentation landscaping";

  const sky = canvasTexture(context => {
    const gradient = context.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0, "#658fab"); gradient.addColorStop(.35, "#9fbfd3");
    gradient.addColorStop(.5, "#cadce4"); gradient.addColorStop(.56, "#a4b3a0"); gradient.addColorStop(1, "#455940");
    context.fillStyle = gradient; context.fillRect(0, 0, 512, 512);
  }, false);
  sky.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = sky;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromEquirectangular(sky);
  pmrem.dispose();
  scene.environment = environment.texture;
  scene.environmentIntensity = .36;
  scene.fog = new THREE.Fog("#b8c9ca", size * 4, size * 13);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .88;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const hemisphere = new THREE.HemisphereLight("#d5e5f4", "#39482f", .42);
  const sun = new THREE.DirectionalLight("#ffe7c4", 3.8);
  sun.position.set(center.x - size * .85, size * 1.05, center.z + size * 1.4);
  sun.target.position.set(center.x, 1, center.z);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -size * 1.35;
  sun.shadow.camera.right = sun.shadow.camera.top = size * 1.35;
  sun.shadow.camera.near = .5; sun.shadow.camera.far = size * 5;
  sun.shadow.normalBias = .003; sun.shadow.bias = -.00002;
  sun.shadow.radius = 3;
  const fill = new THREE.DirectionalLight("#c3d7f2", .2);
  fill.position.set(center.x + size, size * .8, center.z - size);
  added.add(hemisphere, sun, sun.target, fill);

  const plaster = canvasTexture((context, noise) => {
    context.fillStyle = "#f4f2eb"; context.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 34000; i++) {
      context.fillStyle = `rgba(106,98,79,${noise() * .055})`;
      context.fillRect(noise() * 512, noise() * 512, 1 + noise(), 1 + noise());
    }
  });
  const clay = canvasTexture((context, noise) => {
    context.fillStyle = "#a65e42"; context.fillRect(0, 0, 512, 512);
    for (let row = -1; row < 9; row++) for (let column = -1; column < 5; column++) {
      const x = column * 128 + (row % 2 ? 64 : 0), y = row * 64;
      const gradient = context.createLinearGradient(x, 0, x + 128, 0);
      gradient.addColorStop(0, "#884730"); gradient.addColorStop(.18, "#b56b4c");
      gradient.addColorStop(.48, "#c57c56"); gradient.addColorStop(.82, "#ae6042"); gradient.addColorStop(1, "#8f4931");
      context.fillStyle = gradient; context.fillRect(x, y, 128, 64);
      context.fillStyle = "rgba(65,31,19,.21)"; context.fillRect(x, y, 128, 3);
      context.fillStyle = "rgba(255,214,169,.13)"; context.fillRect(x, y + 4, 128, 2);
    }
    for (let i = 0; i < 26000; i++) {
      context.fillStyle = noise() > .5 ? "rgba(255,218,175,.065)" : "rgba(77,34,22,.065)";
      context.fillRect(noise() * 512, noise() * 512, 1, 1);
    }
  });
  const oak = canvasTexture((context, noise) => {
    context.fillStyle = "#b39266"; context.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 850; i++) {
      const x = noise() * 512;
      context.strokeStyle = `rgba(83,53,28,${.03 + noise() * .12})`;
      context.lineWidth = .3 + noise(); context.beginPath(); context.moveTo(x, 0);
      context.bezierCurveTo(x + noise() * 8, 150, x - noise() * 9, 350, x, 512); context.stroke();
    }
    context.fillStyle = "rgba(55,37,25,.35)";
    for (let x = 0; x < 512; x += 86) context.fillRect(x, 0, 2, 512);
  });
  const timber = canvasTexture((context, noise) => {
    context.fillStyle = "#b38b5a"; context.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 1100; i++) {
      const x = noise() * 512;
      context.strokeStyle = `rgba(74,43,18,${.025 + noise() * .11})`;
      context.lineWidth = .3 + noise() * .9; context.beginPath(); context.moveTo(x, 0);
      context.bezierCurveTo(x + noise() * 13, 180, x - noise() * 11, 340, x, 512); context.stroke();
    }
  });
  const glazed = (opening: HouseModel["openings"][number]) => "glazed" in opening && opening.glazed === true;
  const doorIds = new Set(model.openings.filter(opening => opening.kind === "door" && !glazed(opening)).map(opening => opening.id));
  const roofVertices = model.envelope?.faces.filter(face => face.kind === "roof").flatMap(face => face.vertices) || [];
  const roofHeight = Math.max(0, ...roofVertices.map(vertex => vertex[2]));
  const ridgeVertices = roofVertices.filter(vertex => Math.abs(vertex[2] - roofHeight) < .01);
  const ridgeX = ridgeVertices.length ? ridgeVertices.reduce((sum, vertex) => sum + vertex[0], 0) / ridgeVertices.length : center.x;
  scene.updateMatrixWorld(true);
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.MeshStandardMaterial)) return;
    const material = object.material;
    const color = material.color.getHexString();
    const { kind, id } = object.userData;
    if (color === "b38b5a") {
      material.color.set(materials ? "#ffffff" : "#b38b5a"); material.map = materials ? timber : null;
      material.bumpMap = materials ? timber : null; material.bumpScale = .008; material.roughness = .67;
      const positions = object.geometry.getAttribute("position"), worldPoints: THREE.Vector3[] = [];
      for (let i = 0; i < positions.count; i++) worldPoints.push(new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld));
      const bounds = new THREE.Box3().setFromPoints(worldPoints), dimensions = bounds.getSize(new THREE.Vector3());
      const extents = [dimensions.x, dimensions.y, dimensions.z];
      const grainAxis = extents.indexOf(Math.max(...extents));
      const crossAxis = extents.map((extent, axis) => axis === grainAxis ? -1 : extent).indexOf(Math.max(...extents.filter((_, axis) => axis !== grainAxis)));
      const uv = worldPoints.flatMap(point => {
        const coordinates = [point.x, point.y, point.z];
        return [coordinates[crossAxis] / .45, coordinates[grainAxis] / 3.2];
      });
      object.geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    } else if (kind === "surface" && id === "roof" && color === "a65f43") {
      material.color.set(materials ? "#ffffff" : "#a65f43"); material.map = materials ? clay : null; material.bumpMap = materials ? clay : null; material.bumpScale = .025; material.roughness = .9;
      const positions = object.geometry.getAttribute("position"), uv: number[] = [];
      for (let i = 0; i < positions.count; i++) {
        const point = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
        // Tile courses follow the ridge and descend identically on both roof slopes.
        uv.push(-point.z / 1.28, Math.abs(point.x - ridgeX) / 3.6);
      }
      object.geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    } else if (kind === "opening") {
      if (doorIds.has(id)) {
        material.color.set(materials ? "#ffffff" : "#a58b69"); material.map = materials ? oak : null; material.roughness = .6;
      } else if (material.transparent) {
        material.color.set("#9bbdc6"); material.opacity = model.openings.find(opening => opening.id === id)?.glazed ? .16 : .28; material.depthWrite = false; material.roughness = .16; material.metalness = .15; material.envMapIntensity = 1.25;
      } else {
        material.color.set("#303c37"); material.roughness = .4; material.metalness = .25;
      }
    } else if (kind === "wall" || color === "f8f6ed") {
      material.color.set(materials ? "#ffffff" : "#f8f6ed"); material.map = materials ? plaster : null; material.bumpMap = materials ? plaster : null; material.bumpScale = .002; material.roughness = .96;
      material.shadowSide = THREE.FrontSide;
    }
    material.needsUpdate = true;
  });

  const lawn = canvasTexture((context, noise) => {
    context.fillStyle = "#5d734b"; context.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 1800; i++) {
      const x = noise() * 512, y = noise() * 512, radius = 8 + noise() * 36;
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, noise() > .5 ? "rgba(30,61,26,.035)" : "rgba(168,163,90,.045)");
      gradient.addColorStop(1, "rgba(100,120,70,0)");
      context.fillStyle = gradient; context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    for (let i = 0; i < 38000; i++) {
      context.fillStyle = noise() > .5 ? "rgba(26,48,20,.17)" : "rgba(175,177,97,.17)";
      context.fillRect(noise() * 512, noise() * 512, .4 + noise() * .7, .8 + noise() * 2.8);
    }
  });
  lawn.repeat.set(size * 3.5, size * 3.5);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(size * 18, size * 18), new THREE.MeshStandardMaterial({ color: "#ffffff", map: lawn, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(center.x, -.205, center.z); ground.receiveShadow = true; added.add(ground);

  // The only hardscape follows the actual front opening and stops at the concept lot boundary.
  const front = model.walls.find(wall => wall.id === "front");
  const frontDoor = front && model.openings.find(opening => opening.wallId === front.id && opening.kind === "door" && !glazed(opening));
  let pathX: number | null = null;
  if (front && frontDoor) {
    const dx = front.end[0] - front.start[0], dy = front.end[1] - front.start[1], length = Math.hypot(dx, dy);
    const distance = frontDoor.offset + frontDoor.width / 2;
    pathX = front.start[0] + dx * distance / length;
    const doorY = front.start[1] + dy * distance / length;
    const material = new THREE.MeshStandardMaterial({ color: "#d6d0bb", roughness: .94 });
    for (let y = doorY - .35; y > lotMinY + .3; y -= .78) {
      if (!contains(property, pathX, y)) continue;
      const stone = new THREE.Mesh(new THREE.BoxGeometry(frontDoor.width + .22, .055, .61), material);
      stone.position.set(pathX, -.17, -y); stone.castShadow = true; stone.receiveShadow = true; added.add(stone);
    }
  }

  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 0); leafShape.quadraticCurveTo(.42, .38, 0, 1); leafShape.quadraticCurveTo(-.42, .38, 0, 0);
  const leafGeometry = new THREE.ShapeGeometry(leafShape, 2);
  const leafMaterial = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: .85, side: THREE.DoubleSide });
  const barkMaterial = new THREE.MeshStandardMaterial({ color: "#716650", roughness: 1 });
  const transform = new THREE.Object3D(), leafColor = new THREE.Color();
  const addBranch = (a: THREE.Vector3, b: THREE.Vector3, radius: number) => {
    const branch = new THREE.Mesh(new THREE.CylinderGeometry(radius * .58, radius, a.distanceTo(b), 7), barkMaterial);
    branch.position.copy(a).add(b).multiplyScalar(.5);
    branch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    branch.castShadow = true; added.add(branch);
  };
  const addTree = (x: number, y: number, height: number) => {
    if (!contains(property, x, y) || y < maxY + 1.2) return;
    const base = new THREE.Vector3(x, -.2, -y), trunk = base.clone().add(new THREE.Vector3(.12, height * .68, .08));
    addBranch(base, trunk, height * .026);
    const tips: THREE.Vector3[] = [];
    for (let branch = 0; branch < 14; branch++) {
      const angle = branch * 2.39996;
      const spread = height * (.2 + random() * .15);
      const start = base.clone().add(new THREE.Vector3(.06, height * (.38 + random() * .27), .04));
      const tip = base.clone().add(new THREE.Vector3(Math.cos(angle) * spread, height * (.68 + random() * .27), Math.sin(angle) * spread));
      addBranch(start, tip, height * .009); tips.push(tip);
      addBranch(tip.clone().lerp(start, .28), tip.clone().add(new THREE.Vector3(.25, .32, -.18)), height * .004);
    }
    const leaves = new THREE.InstancedMesh(leafGeometry, leafMaterial, 5600);
    for (let i = 0; i < leaves.count; i++) {
      const angle = random() * Math.PI * 2, vertical = random() * 2 - 1;
      const radial = Math.sqrt(1 - vertical * vertical) * Math.cbrt(random());
      // Overlapping crown lobes, including a dense central crown, avoid a ring of disconnected tips.
      const tip = i % 4 ? tips[i % tips.length] : base.clone().add(new THREE.Vector3(0, height * .78, 0));
      const spread = i % 4 ? 1.05 : height * .28;
      transform.position.set(tip.x + Math.cos(angle) * radial * spread, tip.y + vertical * .8, tip.z + Math.sin(angle) * radial * spread);
      transform.rotation.set(random() * Math.PI, random() * Math.PI * 2, random() * Math.PI);
      const scale = .22 + random() * .2; transform.scale.set(scale * 1.15, scale, scale);
      transform.updateMatrix(); leaves.setMatrixAt(i, transform.matrix);
      leafColor.setHSL(.235 + random() * .045, .24 + random() * .18, .16 + random() * .18); leaves.setColorAt(i, leafColor);
    }
    leaves.castShadow = true; leaves.receiveShadow = true; added.add(leaves);
  };
  const treeY = Math.min(lotMaxY - 1.5, maxY + 3.7);
  if (treeY > maxY + 1.2) {
    addTree(lotMinX + 1.5, treeY, 5.7);
    addTree(lotMaxX - 1.2, treeY + .5, 6.2);
    addTree(maxX - 3, Math.min(lotMaxY - .8, treeY + 1.5), 4.6);
  }

  const shrubMatrices: THREE.Matrix4[] = [], shrubColors: THREE.Color[] = [];
  const addShrub = (x: number, y: number, height: number, radius: number) => {
    if (!contains(property, x, y) || overlapsDeck(x, y, radius + .12) || (pathX !== null && Math.abs(x - pathX) < 1.05 && y < minY)) return;
    for (let i = 0; i < 210; i++) {
      const angle = random() * Math.PI * 2, vertical = random(), radial = Math.sqrt(1 - vertical * vertical) * Math.sqrt(random());
      transform.position.set(x + Math.cos(angle) * radial * radius, -.17 + vertical * height, -y + Math.sin(angle) * radial * radius);
      transform.rotation.set(-Math.PI * (.2 + random() * .6), random() * Math.PI * 2, random() * Math.PI);
      const scale = .13 + random() * .13; transform.scale.set(scale * 1.15, scale, scale);
      transform.updateMatrix(); shrubMatrices.push(transform.matrix.clone());
      shrubColors.push(new THREE.Color().setHSL(.23 + random() * .09, .25 + random() * .22, .16 + random() * .16));
    }
  };
  // Planting stays below the 1 m window sills, with irregular gaps and a clear entrance.
  for (let i = 0; i < 25; i++) {
    const x = minX + .2 + i * (maxX - minX - 1.1) / 25 + (random() - .5) * .25;
    const besideDeck = !!deck && x <= deck.maxX + .2 && x >= deck.minX - .2;
    const y = besideDeck ? deck.minY - .4 - random() * .04 : minY - .6 - random() * .35;
    addShrub(x, y, .28 + random() * .18, besideDeck ? .18 + random() * .06 : .26 + random() * .18);
  }
  for (let i = 0; i < 14; i++) {
    const x = lotMaxX - .65 - random() * .3, y = minY + .4 + i * .73;
    addShrub(x, y, .38 + random() * .27, .35 + random() * .18);
  }
  const shrubs = new THREE.InstancedMesh(leafGeometry, leafMaterial, shrubMatrices.length);
  shrubMatrices.forEach((matrix, index) => { shrubs.setMatrixAt(index, matrix); shrubs.setColorAt(index, shrubColors[index]); });
  shrubs.castShadow = true; shrubs.receiveShadow = true; added.add(shrubs);

  // Individual grass blades and small leaves retain a porous, natural silhouette.
  const grassGeometry = new THREE.BufferGeometry();
  grassGeometry.setAttribute("position", new THREE.Float32BufferAttribute([-.018, 0, 0, .018, 0, 0, .028, .5, -.06, .028, .5, -.06, .018, 0, 0, .06, .72, -.11], 3));
  grassGeometry.computeVertexNormals();
  const grassMaterial = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, side: THREE.DoubleSide });
  const blades: THREE.Matrix4[] = [], bladeColors: THREE.Color[] = [];
  for (let cluster = 0; cluster < 110; cluster++) {
    let x: number, y: number;
    if (cluster < 52) {
      x = lotMinX + .45 + random() * (lotMaxX - lotMinX - .9);
      y = lotMinY + .45 + random() * .75;
    } else {
      x = cluster % 2 ? lotMinX + .4 + random() * .7 : lotMaxX - .4 - random() * .7;
      y = minY + .6 + random() * (lotMaxY - minY - 1.2);
    }
    if (!contains(property, x, y) || overlapsDeck(x, y, .3) || (pathX !== null && Math.abs(x - pathX) < 1.1)) continue;
    for (let blade = 0; blade < 22; blade++) {
      const angle = random() * Math.PI * 2, radius = random() * .19;
      transform.position.set(x + Math.cos(angle) * radius, -.19, -y + Math.sin(angle) * radius);
      transform.rotation.set((random() - .5) * .25, random() * Math.PI * 2, (random() - .5) * .28);
      transform.scale.setScalar(.3 + random() * .45); transform.updateMatrix(); blades.push(transform.matrix.clone());
      bladeColors.push(new THREE.Color().setHSL(.19 + random() * .07, .17 + random() * .2, .27 + random() * .17));
    }
  }
  const grasses = new THREE.InstancedMesh(grassGeometry, grassMaterial, blades.length);
  blades.forEach((matrix, index) => { grasses.setMatrixAt(index, matrix); grasses.setColorAt(index, bladeColors[index]); });
  grasses.castShadow = true; grasses.receiveShadow = true; added.add(grasses);
  scene.add(added);

  return () => {
    scene.background = previousBackground; scene.environment = previousEnvironment; scene.fog = previousFog;
    scene.environmentIntensity = previousIntensity;
    environment.dispose(); sky.dispose(); sun.shadow.map?.dispose();
    // Maps on meshes are disposed by the viewer. These shared textures also cover empty models.
    plaster.dispose(); clay.dispose(); oak.dispose(); timber.dispose(); lawn.dispose();
    leafGeometry.dispose(); leafMaterial.dispose(); barkMaterial.dispose();
  };
}
