import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';

const canvasHost = document.querySelector('#gear-3d-canvas');
const status = document.querySelector('#gear-3d-status');
const panel = document.querySelector('#gear-3d-panel');
const drawing = document.querySelector('#gear-simulator');
const viewer = new THREE.Scene();
viewer.background = new THREE.Color('#f7f8f0');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
canvasHost.append(renderer.domElement);

const camera = new THREE.OrthographicCamera(-4, 4, 4, -4, 0.1, 100);
const target = new THREE.Vector3();
let azimuth = -0.75;
let elevation = 0.82;
let cameraDistance = 13;
let activeModel = 'spur';
let driveAngle = 0;
let modelRoot = new THREE.Group();
let dragStart = null;
let resizeObserver;

viewer.add(new THREE.HemisphereLight(0xffffff, 0x7d8878, 2.2));
const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
keyLight.position.set(-5, -7, 10);
keyLight.castShadow = true;
viewer.add(keyLight);

function makeGearShape(teeth, module, bore = 0.22) {
  const shape = new THREE.Shape();
  const pitchRadius = teeth * module / 2;
  const rootRadius = Math.max(pitchRadius - 1.25 * module, pitchRadius * 0.55);
  const outerRadius = pitchRadius + module;
  const pitch = Math.PI * 2 / teeth;
  const points = [];
  for (let i = 0; i < teeth; i += 1) {
    const center = i * pitch;
    points.push(
      [center - pitch * 0.5, rootRadius],
      [center - pitch * 0.34, rootRadius],
      [center - pitch * 0.23, outerRadius],
      [center + pitch * 0.23, outerRadius],
      [center + pitch * 0.34, rootRadius],
      [center + pitch * 0.5, rootRadius]
    );
  }
  points.forEach(([angle, radius], index) => {
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, bore, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  return { shape, pitchRadius, rootRadius, outerRadius };
}

function gearMesh(teeth, color, module = 0.1, width = 0.42, taper = false, helix = 0) {
  const { shape, pitchRadius } = makeGearShape(teeth, module);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: true,
    bevelSegments: 1,
    steps: 1,
    bevelSize: 0.025,
    bevelThickness: 0.025,
    curveSegments: 2
  });
  geometry.translate(0, 0, -width / 2);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i += 1) {
    const z = positions.getZ(i);
    if (taper) {
      const scale = THREE.MathUtils.lerp(0.35, 1, (z + width / 2) / width);
      positions.setXY(i, positions.getX(i) * scale, positions.getY(i) * scale);
    }
    if (helix) {
      const angle = helix * (z / width);
      const x = positions.getX(i);
      const y = positions.getY(i);
      positions.setXY(i, x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle));
    }
  }
  if (taper || helix) {
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
  }
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color,
    metalness: 0.62,
    roughness: 0.3
  }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.pitchRadius = pitchRadius;
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.3, width * 0.9, 32),
    new THREE.MeshStandardMaterial({ color: '#b7c1b2', metalness: 0.75, roughness: 0.23 })
  );
  hub.rotation.x = Math.PI / 2;
  hub.castShadow = true;
  mesh.add(hub);
  return mesh;
}

function addRack(group, travel) {
  const width = 4.7;
  const rack = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.22, 0.48),
    new THREE.MeshStandardMaterial({ color: '#737f71', metalness: 0.48, roughness: 0.4 })
  );
  rack.position.set(travel, -1.32, 0);
  rack.castShadow = true;
  group.add(rack);
  for (let i = 0; i < 17; i += 1) {
    const tooth = new THREE.Mesh(
      new THREE.BoxGeometry(0.19, 0.2, 0.48),
      new THREE.MeshStandardMaterial({ color: '#aab4a5', metalness: 0.52, roughness: 0.32 })
    );
    tooth.position.set(travel - 2.2 + i * 0.275, -1.11, 0);
    tooth.castShadow = true;
    group.add(tooth);
  }
}

function addWorm(group, wheelRadius) {
  const centerY = wheelRadius + 0.05;
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.24, 3.3, 32),
    new THREE.MeshStandardMaterial({ color: '#d88a55', metalness: 0.7, roughness: 0.27 })
  );
  shaft.rotation.z = Math.PI / 2;
  shaft.position.set(0, centerY, 0);
  shaft.castShadow = true;
  group.add(shaft);
  const points = [];
  const turns = 5;
  for (let i = 0; i <= 240; i += 1) {
    const t = i / 240;
    const angle = t * turns * Math.PI * 2;
    points.push(new THREE.Vector3(
      -1.5 + 3 * t,
      centerY + 0.24 * Math.cos(angle),
      0.24 * Math.sin(angle)
    ));
  }
  const thread = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 240, 0.055, 8, false),
    new THREE.MeshStandardMaterial({ color: '#f0b37b', metalness: 0.72, roughness: 0.24 })
  );
  thread.castShadow = true;
  group.add(thread);
}

function addRing(group, teeth, module, radius) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.16, 16, 96),
    new THREE.MeshStandardMaterial({ color: '#748173', metalness: 0.65, roughness: 0.32 })
  );
  ring.castShadow = true;
  group.add(ring);
  for (let i = 0; i < teeth; i += 1) {
    const angle = i * Math.PI * 2 / teeth;
    const tooth = new THREE.Mesh(
      new THREE.BoxGeometry(module * 0.88, 0.2, 0.28),
      new THREE.MeshStandardMaterial({ color: '#9eaa99', metalness: 0.55, roughness: 0.34 })
    );
    tooth.position.set((radius - 0.12) * Math.cos(angle), (radius - 0.12) * Math.sin(angle), 0);
    tooth.rotation.z = angle;
    tooth.castShadow = true;
    group.add(tooth);
  }
}

function buildModel(type, z1, z2, module, turns) {
  const root = new THREE.Group();
  const count1 = Math.max(8, Math.min(40, z1));
  const count2 = Math.max(12, Math.min(60, z2));
  const m = Math.max(0.07, Math.min(0.14, module * 0.05));
  const firstRadius = count1 * m / 2;
  const secondRadius = count2 * m / 2;
  const first = gearMesh(count1, '#356a52', m, 0.42, type === 'bevel', type === 'helical' ? 0.7 : 0);
  const second = gearMesh(count2, '#d98752', m, 0.42, type === 'bevel', type === 'helical' ? -0.7 : 0);
  first.rotation.z = turns;
  second.rotation.z = -turns * count1 / count2;
  root.userData.moving = [first, second];

  if (type === 'planetary') {
    const ringTeeth = Math.max(count1 + 12, count1 + Math.round((count2 - count1) / 2) * 2);
    const ringRadius = ringTeeth * m / 2;
    addRing(root, ringTeeth, m, ringRadius);
    first.position.z = 0.18;
    root.add(first);
    const planetCount = 3;
    const planetRadius = Math.max(6, Math.floor((ringTeeth - count1) / 2));
    for (let i = 0; i < planetCount; i += 1) {
      const angle = i * Math.PI * 2 / planetCount;
      const planet = gearMesh(planetRadius, '#d98752', m, 0.36);
      const distance = firstRadius + planet.userData.pitchRadius;
      planet.position.set(distance * Math.cos(angle), distance * Math.sin(angle), 0.2);
      planet.rotation.z = -turns * count1 / planetRadius;
      root.add(planet);
    }
    const carrierMaterial = new THREE.MeshStandardMaterial({ color: '#526b5a', metalness: 0.55, roughness: 0.34 });
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.14, 32), carrierMaterial);
    hub.rotation.x = Math.PI / 2;
    hub.position.z = 0.56;
    root.add(hub);
    root.children.filter((child) => child.isMesh && child.geometry.type === 'ExtrudeGeometry' && child !== first).forEach((planet) => {
      const distance = Math.hypot(planet.position.x, planet.position.y);
      const angle = Math.atan2(planet.position.y, planet.position.x);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(distance, 0.12, 0.12), carrierMaterial);
      arm.position.set(planet.position.x / 2, planet.position.y / 2, 0.56);
      arm.rotation.z = angle;
      root.add(arm);
    });
  } else if (type === 'rack') {
    first.position.set(0, -1 + firstRadius + m * 0.5, 0.35);
    root.add(first);
    addRack(root, turns * firstRadius);
  } else if (type === 'worm') {
    first.position.set(0, 0, -0.1);
    root.add(first);
    addWorm(root, firstRadius);
  } else {
    first.position.x = -firstRadius;
    second.position.x = firstRadius + secondRadius;
    if (type === 'bevel') {
      second.rotation.x = Math.PI / 2;
      second.position.set(0, 0, 1.5);
    }
    root.add(first, second);
  }
  return root;
}

function disposeModel() {
  viewer.remove(modelRoot);
  modelRoot.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => material.dispose());
  });
}

function updateCamera() {
  const direction = new THREE.Vector3(
    Math.cos(elevation) * Math.cos(azimuth),
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation)
  );
  camera.position.copy(target).addScaledVector(direction, cameraDistance);
  camera.lookAt(target);
}

function fitCamera() {
  const bounds = new THREE.Box3().setFromObject(modelRoot);
  if (bounds.isEmpty()) return;
  bounds.getCenter(target);
  const size = bounds.getSize(new THREE.Vector3());
  const hostWidth = canvasHost.clientWidth || 1;
  const hostHeight = canvasHost.clientHeight || 1;
  const aspect = hostWidth / hostHeight;
  const span = Math.max(size.y, size.z, size.x / aspect, 2.5) * 1.3;
  camera.left = -span * aspect / 2;
  camera.right = span * aspect / 2;
  camera.top = span / 2;
  camera.bottom = -span / 2;
  camera.updateProjectionMatrix();
  cameraDistance = Math.max(10, span * 2);
  updateCamera();
}

function rebuild() {
  const z1 = Number(document.querySelector('#sim-drive-teeth').value) || 12;
  const z2 = Number(document.querySelector('#sim-driven-teeth').value) || 24;
  const module = Number(document.querySelector('#sim-module').value) || 2;
  disposeModel();
  modelRoot = buildModel(activeModel, z1, z2, module, driveAngle);
  viewer.add(modelRoot);
  fitCamera();
  status.textContent = 'Modèle 3D généré pour le Web — ce n’est pas le fichier SolidWorks.';
}

function resize() {
  const width = canvasHost.clientWidth;
  const height = canvasHost.clientHeight;
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  fitCamera();
}

function moveTurns(amount) {
  driveAngle += amount * Math.PI * 2;
  rebuild();
}

document.querySelector('#view-2d').addEventListener('click', () => {
  document.querySelector('#view-2d').classList.add('is-active');
  document.querySelector('#view-2d').setAttribute('aria-pressed', 'true');
  document.querySelector('#view-3d').classList.remove('is-active');
  document.querySelector('#view-3d').setAttribute('aria-pressed', 'false');
  panel.hidden = true;
  drawing.hidden = false;
});

document.querySelector('#view-3d').addEventListener('click', () => {
  document.querySelector('#view-3d').classList.add('is-active');
  document.querySelector('#view-3d').setAttribute('aria-pressed', 'true');
  document.querySelector('#view-2d').classList.remove('is-active');
  document.querySelector('#view-2d').setAttribute('aria-pressed', 'false');
  drawing.hidden = true;
  panel.hidden = false;
  resize();
});

document.querySelectorAll('.model-option').forEach((button) => {
  button.addEventListener('click', () => {
    activeModel = button.dataset.model;
    rebuild();
  });
});
['#sim-drive-teeth', '#sim-driven-teeth', '#sim-module'].forEach((selector) => {
  document.querySelector(selector).addEventListener('change', rebuild);
});
document.querySelector('#gear-3d-forward').addEventListener('click', () => moveTurns(1));
document.querySelector('#gear-3d-back').addEventListener('click', () => moveTurns(-1));
document.querySelector('#gear-3d-reset').addEventListener('click', () => {
  driveAngle = 0;
  azimuth = -0.75;
  elevation = 0.82;
  rebuild();
});
document.querySelector('#turn-forward').addEventListener('click', () => moveTurns(1));
document.querySelector('#turn-backward').addEventListener('click', () => moveTurns(-1));
document.querySelector('#reset-gears').addEventListener('click', () => {
  driveAngle = 0;
  rebuild();
});

canvasHost.addEventListener('pointerdown', (event) => {
  dragStart = { x: event.clientX, y: event.clientY };
  canvasHost.setPointerCapture(event.pointerId);
});
canvasHost.addEventListener('pointermove', (event) => {
  if (!dragStart) return;
  azimuth += (event.clientX - dragStart.x) * 0.008;
  elevation = THREE.MathUtils.clamp(elevation - (event.clientY - dragStart.y) * 0.008, 0.15, 1.48);
  dragStart = { x: event.clientX, y: event.clientY };
  updateCamera();
});
canvasHost.addEventListener('pointerup', () => { dragStart = null; });
canvasHost.addEventListener('pointercancel', () => { dragStart = null; });
canvasHost.addEventListener('wheel', (event) => {
  event.preventDefault();
  cameraDistance = THREE.MathUtils.clamp(cameraDistance * (event.deltaY > 0 ? 1.1 : 0.9), 5, 50);
  updateCamera();
}, { passive: false });

rebuild();
resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(canvasHost);
renderer.setAnimationLoop(() => renderer.render(viewer, camera));
status.textContent = 'Modèle 3D prêt. Glissez pour le faire pivoter.';
// 01110111 01100001 01101100 01101100 01100001 01101000 00100000 00110101 01100100 01101001 01101101 01101111 00100000 01100111 01101000 01100001 01110011 01110011 01100101 01101110
// 01110111 01100001 01101100 01101100 01100001 01101000 00100000 00110101 01100100 01101001 01101101 01101111 00100000 01100111 01101000 01100001 01110011 01110011 01100101 01101110
// 01110111 01100001 01101100 01101100 01100001 01101000 00100000 00110101 01100100 01101001 01101101 01101111 00100000 01100111 01101000 01100001 01110011 01110011 01100101 01101110
// 01110111 01100001 01101100 01101100 01100001 01101000 00100000 00110101 01100100 01101001 01101101 01101111 00100000 01100111 01101000 01100001 01110011 01110011 01100101 01101110
// 01110111 01100001 01101100 01101100 01100001 01101000 00100000 00110101 01100100 01101001 01101101 01101111 00100000 01100111 01101000 01100001 01110011 01110011 01100101 01101110
// 01110111 01100001 01101100 01101100 01100001 01101000 00100000 00110101 01100100 01101001 01101101 01101111 00100000 01100111 01101000 01100001 01110011 01110011 01100101 01101110
// 01110111 01100001 01101100 01101100 01100001 01101000 00100000 00110101 01100100 01101001 01101101 01101111 00100000 01100111 01101000 01100001 01110011 01110011 01100101 01101110
// 01110111 01100001 01101100 01101100 01100001 01101000 00100000 00110101 01100100 01101001 01101101 01101111 00100000 01100111 01101000 01100001 01110011 01110011 01100101 01101110
// 01110111 01100001 01101100 01101100 01100001 01101000 00100000 00110101 01100100 01101001 01101101 01101111 00100000 01100111 01101000 01100001 01110011 01110011 01100101 01101110
// 01110111 01100001 01101100 01101100 01100001 01101000 00100000 00110101 01100100 01101001 01101101 01101111 00100000 01100111 01101000 01100001 01110011 01110011 01100101 01101110
