// Palm Flag 3D — Three.js version
// The map, rules and controls match the Phaser version.
// Game logic still runs on the same flat 1600x900 map; the 3D scene just draws it.
//   map x  -> 3D x
//   map y  -> 3D z
//   height -> 3D y

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

// ---------- map layout (same numbers as before) ----------

const W = 1600;
const H = 900;
const playerNames = { blue: "BLUE", red: "RED" };
let groundTexture = null;
let groundMaterial = null;
const FIELD = { x: 60, y: 60, w: 1480, h: 780 };

const COLORS = {
  grassA: 0x2f8f46,
  grassB: 0x2a8340,
  hedgeA: 0x1f5c34,
  hedgeB: 0x23663a,
  wall: 0x46515e,
  wallTop: 0x5d6b7a,
  blue: 0x3388ff,
  red: 0xff4444,
  hazard: 0xffcc00,
  sand: 0xdcc795,
  water: 0x2aa7c9,
  sky: 0xbfe2ea,
};

// Walls on the left half, mirrored to the right half.
const WALLS_LEFT = [
  [400, 250, 36, 130],
  [400, 520, 36, 130],
  [560, 170, 110, 32],
  [560, 698, 110, 32],
];

// Walls on the center line.
const WALLS_CENTER = [
  [770, 120, 60, 130],
  [770, 650, 60, 130],
];

// Top-left corner wall, mirrored into all four corners.
const CORNER_L = [
  [110, 110, 130, 28],
  [110, 110, 28, 130],
];

// Moving hazard walls (x, y is the center).
const MOVERS = [
  { x: 800, y: 450, axis: "x", range: 40, speed: 50 },
  { x: 600, y: 450, axis: "y", range: 45, speed: 45 },
  { x: 1000, y: 450, axis: "y", range: 45, speed: 45 },
];

const HAZARD = { w: 28, h: 140, height: 60 };
const BASE = { w: 220, h: 300 };
const WALL_HEIGHT = 56;
const PLAYER_RADIUS = 24;
const PLAYER_SPEED = 220;
const PICKUP_DISTANCE = 38;
const PAINTBALL_RADIUS = 9;
const MAX_HEALTH = 100;
const SHOT_DAMAGE = 20; // 5 hits knock a player out
const SHOT_COOLDOWN = 0.3; // seconds between shots, so holding Space can't spam

// ---------- small helpers ----------

const mirrorX = ([x, y, w, h]) => [W - x - w, y, w, h];
const mirrorY = ([x, y, w, h]) => [x, H - y - h, w, h];
const toX = (x) => x - W / 2;
const toZ = (y) => y - H / 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const otherTeam = (team) => (team === "blue" ? "red" : "blue");

const css = (hex, a = 1) =>
  `rgba(${(hex >> 16) & 255}, ${(hex >> 8) & 255}, ${hex & 255}, ${a})`;

// Small seeded random generator so the scenery looks the same every time.
function seeded(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function allWalls() {
  const corners = [];

  for (const rect of CORNER_L) {
    corners.push(rect, mirrorX(rect), mirrorY(rect), mirrorX(mirrorY(rect)));
  }

  return [
    ...WALLS_LEFT,
    ...WALLS_LEFT.map(mirrorX),
    ...WALLS_CENTER,
    ...corners,
  ];
}

const WALL_RECTS = allWalls();

const BASES = {
  blue: { x: FIELD.x + BASE.w / 2, y: H / 2 },
  red: { x: FIELD.x + FIELD.w - BASE.w / 2, y: H / 2 },
};

const baseRect = (team) => [
  BASES[team].x - BASE.w / 2,
  BASES[team].y - BASE.h / 2,
  BASE.w,
  BASE.h,
];

// ---------- renderer, camera, lights ----------

const container = document.getElementById("game");

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
container.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.sky);
scene.fog = new THREE.Fog(COLORS.sky, 1700, 3400);

// Tilted top-down camera, like looking at a tabletop.
const camera = new THREE.PerspectiveCamera(42, W / H, 10, 6000);
const CAMERA_HOME = new THREE.Vector3(0, 1150, 900);
camera.position.copy(CAMERA_HOME);
camera.lookAt(0, 0, 30);

scene.add(new THREE.HemisphereLight(0xdff1ff, 0x3a5a32, 1.6));
const paintballs = [];
const PAINTBALL_SPEED = 650;

const sun = new THREE.DirectionalLight(0xfff0d8, 3.2);
sun.position.set(-500, 1100, 600);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, {
  left: -1100,
  right: 1100,
  top: 1000,
  bottom: -1000,
  near: 100,
  far: 3500,
});
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
scene.add(sun);

// Bloom makes the bright, glowing parts (rings, posts, sparks) glow.
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.55, 0.5, 0.9);
composer.addPass(bloom);
composer.addPass(new OutputPass());


const paintballGeometry = new THREE.SphereGeometry(9, 12, 8);

const paintballMaterials = {
  blue: new THREE.MeshStandardMaterial({ color: 0x3388ff }),
  red: new THREE.MeshStandardMaterial({ color: 0xff4444 }),
};

function resize() {
  const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
  const w = Math.floor(W * scale);
  const h = Math.floor(H * scale);

  container.style.width = `${w}px`;
  container.style.height = `${h}px`;
  container.style.fontSize = `${16 * scale}px`;

  renderer.setSize(w, h);
  composer.setSize(w, h);
}

window.addEventListener("resize", resize);
resize();

// ---------- ground ----------

function makeGroundTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = W * 2;
  canvas.height = H * 2;

  const g = canvas.getContext("2d");
  g.scale(2, 2);

  // Dark border under the hedges.
  g.fillStyle = "#1b4d2a";
  g.fillRect(0, 0, W, H);

  // Mowing stripes.
  const stripeWidth = 80;
  for (let x = FIELD.x, i = 0; x < FIELD.x + FIELD.w; x += stripeWidth, i++) {
    g.fillStyle = css(i % 2 ? COLORS.grassA : COLORS.grassB);
    g.fillRect(x, FIELD.y, Math.min(stripeWidth, FIELD.x + FIELD.w - x), FIELD.h);
  }

  // Grass flecks.
  const rnd = seeded(7);
  for (let n = 0; n < 1600; n++) {
    const light = rnd() < 0.5;
    g.fillStyle = light ? "rgba(111, 207, 127, 0.18)" : "rgba(29, 107, 51, 0.25)";
    g.fillRect(
      FIELD.x + 4 + rnd() * (FIELD.w - 8),
      FIELD.y + 4 + rnd() * (FIELD.h - 8),
      2,
      3 + rnd() * 3
    );
  }

  // Soft darkening toward the field edges.
  g.lineWidth = 10;
  g.strokeStyle = "rgba(0, 0, 0, 0.05)";
  for (let k = 0; k < 6; k++) {
    g.strokeRect(
      FIELD.x + 5 + k * 10,
      FIELD.y + 5 + k * 10,
      FIELD.w - 10 - k * 20,
      FIELD.h - 10 - k * 20
    );
  }

  // Field lines.
  g.strokeStyle = "rgba(255, 255, 255, 0.35)";
  g.lineWidth = 4;
  g.strokeRect(FIELD.x, FIELD.y, FIELD.w, FIELD.h);
  g.beginPath();
  g.arc(W / 2, H / 2, 110, 0, Math.PI * 2);
  g.stroke();

  for (let y = FIELD.y + 10; y < FIELD.y + FIELD.h; y += 36) {
    g.beginPath();
    g.moveTo(W / 2, y);
    g.lineTo(W / 2, Math.min(y + 20, FIELD.y + FIELD.h));
    g.stroke();
  }

  g.fillStyle = "rgba(255, 255, 255, 0.5)";
  g.beginPath();
  g.arc(W / 2, H / 2, 6, 0, Math.PI * 2);
  g.fill();

  // Bases.
  for (const team of ["blue", "red"]) {
    const color = COLORS[team];
    const [x, y, w, h] = baseRect(team);
    const { x: cx, y: cy } = BASES[team];

    g.fillStyle = css(color, 0.28);
    g.fillRect(x, y, w, h);

    g.strokeStyle = css(color, 0.9);
    g.lineWidth = 4;
    g.strokeRect(x, y, w, h);

    g.fillStyle = "rgba(255, 255, 255, 0.2)";
    g.beginPath();
    g.arc(cx, cy, 46, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = "rgba(255, 255, 255, 0.6)";
    g.font = "bold 26px Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(playerNames[team].toUpperCase(), cx, y + 24, BASE.w - 16);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function buildGround() {
  // Water all around the island.
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(9000, 9000),
    new THREE.MeshStandardMaterial({
      color: COLORS.water,
      roughness: 0.25,
      metalness: 0.1,
    })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = -4;
  scene.add(water);

  // Sandy island.
  const sand = new THREE.Mesh(
    new THREE.CircleGeometry(1300, 72),
    new THREE.MeshStandardMaterial({ color: COLORS.sand, roughness: 1 })
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.y = -1;
  sand.receiveShadow = true;
  scene.add(sand);

  // The playing field.
  groundTexture = makeGroundTexture();
  groundMaterial = new THREE.MeshStandardMaterial({
    map: groundTexture,
    roughness: 0.95,
  });
  const field = new THREE.Mesh(new THREE.PlaneGeometry(W, H), groundMaterial);
  field.rotation.x = -Math.PI / 2;
  field.receiveShadow = true;
  scene.add(field);
}

// ---------- hedges ----------

function buildHedges() {
  const spots = [];

  for (let x = 20; x <= W; x += 40) spots.push([x, 26], [x, H - 26]);
  for (let y = 20; y <= H; y += 40) spots.push([26, y], [W - 26, y]);

  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    flatShading: true,
  });

  // Two puffs per bush so they look fuller.
  const mesh = new THREE.InstancedMesh(geometry, material, spots.length * 2);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const rnd = seeded(21);
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const color = new THREE.Color();
  let i = 0;

  spots.forEach(([x, y], n) => {
    const base = n % 2 ? COLORS.hedgeA : COLORS.hedgeB;

    for (let puff = 0; puff < 2; puff++) {
      const r = puff === 0 ? 24 + rnd() * 4 : 13 + rnd() * 4;
      const pos = new THREE.Vector3(
        toX(x) + (rnd() - 0.5) * 10,
        puff === 0 ? 16 : 34,
        toZ(y) + (rnd() - 0.5) * 10
      );

      quat.setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3));
      matrix.compose(pos, quat, new THREE.Vector3(r, r * 0.85, r));
      mesh.setMatrixAt(i, matrix);

      color.set(base).offsetHSL(0, 0, (rnd() - 0.3) * 0.08 + puff * 0.05);
      mesh.setColorAt(i, color);
      i++;
    }
  });

  scene.add(mesh);
}

// ---------- palm trees ----------

function makePalm(scale, seed) {
  const rnd = seeded(seed);
  const palm = new THREE.Group();

  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x8b6b45,
    roughness: 0.9,
    flatShading: true,
  });

  // Curved trunk made of stacked, slightly tilted segments.
  const segments = 7;
  const segHeight = 24;
  const curve = 0.9 + rnd() * 0.8;
  let top = new THREE.Vector3();

  for (let i = 0; i < segments; i++) {
    const r = 9 - i * 0.6;
    const seg = new THREE.Mesh(
      new THREE.CylinderGeometry(r - 0.8, r, segHeight + 2, 7),
      trunkMat
    );
    const x = curve * i * i;
    const slope = (curve * (2 * i + 1)) / segHeight;

    seg.position.set(x, i * segHeight + segHeight / 2, 0);
    seg.rotation.z = -Math.atan(slope);
    seg.castShadow = true;
    palm.add(seg);

    top.set(curve * segments * segments, segments * segHeight, 0);
  }

  // Fronds: flattened cones pointing out and drooping down.
  const frondGeo = new THREE.ConeGeometry(11, 85, 4, 1);
  frondGeo.translate(0, 42.5, 0);

  const leafMats = [0x2f9e44, 0x3fae4f, 0x278a3a].map(
    (c) =>
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, flatShading: true })
  );

  const crown = new THREE.Group();
  crown.position.copy(top);

  for (let k = 0; k < 8; k++) {
    const holder = new THREE.Group();
    holder.rotation.y = (k / 8) * Math.PI * 2 + rnd() * 0.3;

    const frond = new THREE.Mesh(frondGeo, leafMats[k % 3]);
    frond.scale.set(0.3, 1, 1);
    frond.rotation.z = -(Math.PI / 2 + 0.35 + rnd() * 0.25);
    frond.castShadow = true;

    holder.add(frond);
    crown.add(holder);
  }

  const nutMat = new THREE.MeshStandardMaterial({ color: 0x5a3d22, roughness: 0.7 });
  for (let k = 0; k < 3; k++) {
    const nut = new THREE.Mesh(new THREE.SphereGeometry(6, 10, 8), nutMat);
    const a = (k / 3) * Math.PI * 2;
    nut.position.set(Math.cos(a) * 8, -6, Math.sin(a) * 8);
    nut.castShadow = true;
    crown.add(nut);
  }

  palm.add(crown);
  palm.scale.setScalar(scale);
  palm.rotation.y = rnd() * Math.PI * 2;
  return palm;
}

function buildPalms() {
  // [x, z, size] in 3D coordinates, all outside the hedges.
  const spots = [
    [-960, -420, 1.15],
    [-890, -70, 0.9],
    [-930, 260, 1.0],
    [-620, -600, 1.0],
    [-210, -640, 1.25],
    [260, -610, 0.95],
    [690, -590, 1.1],
    [960, -380, 1.05],
    [900, -40, 0.92],
    [940, 290, 1.0],
  ];

  spots.forEach(([x, z, s], i) => {
    const palm = makePalm(s, 100 + i * 13);
    palm.position.set(x, 0, z);
    scene.add(palm);
  });
}

// ---------- walls ----------

function buildWalls() {
  const wallMat = new THREE.MeshStandardMaterial({
    color: COLORS.wall,
    roughness: 0.6,
    metalness: 0.1,
  });
  const topMat = new THREE.MeshStandardMaterial({
    color: COLORS.wallTop,
    roughness: 0.5,
  });

  for (const [x, y, w, h] of WALL_RECTS) {
    const block = new THREE.Mesh(
      new RoundedBoxGeometry(w, WALL_HEIGHT, h, 3, 5),
      wallMat
    );
    block.position.set(toX(x + w / 2), WALL_HEIGHT / 2, toZ(y + h / 2));
    block.castShadow = true;
    block.receiveShadow = true;
    scene.add(block);

    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(w - 8, 3, h - 8),
      topMat
    );
    cap.position.set(block.position.x, WALL_HEIGHT + 0.5, block.position.z);
    cap.receiveShadow = true;
    scene.add(cap);
  }
}

// ---------- moving hazards ----------

function makeHazardTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 256;

  const g = canvas.getContext("2d");
  g.fillStyle = css(COLORS.hazard);
  g.fillRect(0, 0, 64, 256);

  g.fillStyle = "#222";
  for (let y = -64; y < 256; y += 64) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(64, y + 32);
    g.lineTo(64, y + 64);
    g.lineTo(0, y + 32);
    g.closePath();
    g.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildMovers() {
  const texture = makeHazardTexture();
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    emissive: 0xffaa00,
    emissiveMap: texture,
    emissiveIntensity: 0.25,
    roughness: 0.5,
  });

  return MOVERS.map((cfg, i) => {
    const group = new THREE.Group();

    const box = new THREE.Mesh(
      new RoundedBoxGeometry(HAZARD.w, HAZARD.height, HAZARD.h, 2, 3),
      material
    );
    box.position.y = HAZARD.height / 2;
    box.castShadow = true;
    box.receiveShadow = true;
    group.add(box);

    // Blinking warning lights on top.
    const lights = [];
    for (const end of [-1, 1]) {
      const light = new THREE.Mesh(
        new THREE.SphereGeometry(5, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0xff3b1f })
      );
      light.position.set(0, HAZARD.height + 4, end * (HAZARD.h / 2 - 10));
      group.add(light);
      lights.push(light);
    }

    scene.add(group);

    const start = cfg.axis === "x" ? cfg.x : cfg.y;

    return {
      ...cfg,
      group,
      lights,
      phase: i * 0.7,
      dir: 1,
      min: start - cfg.range,
      max: start + cfg.range,
    };
  });
}

const moverRect = (m) => [m.x - HAZARD.w / 2, m.y - HAZARD.h / 2, HAZARD.w, HAZARD.h];

// ---------- bases ----------

function buildBaseDecor(team) {
  const color = new THREE.Color(COLORS[team]);
  const { x, y } = BASES[team];
  const cx = toX(x);
  const cz = toZ(y);

  // Glowing ring around the flag spot.
  const ringMat = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(3) });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(46, 2.2, 8, 64), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(cx, 1.5, cz);
  scene.add(ring);

  // Ring that pulses outward.
  const pulse = new THREE.Mesh(
    new THREE.RingGeometry(44, 48, 64),
    new THREE.MeshBasicMaterial({
      color: color.clone().multiplyScalar(2),
      transparent: true,
      depthWrite: false,
    })
  );
  pulse.rotation.x = -Math.PI / 2;
  pulse.position.set(cx, 1.2, cz);
  scene.add(pulse);

  // Glowing posts on the corners of the base zone.
  const postMat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 1.6,
  });
  for (const dx of [-1, 1]) {
    for (const dy of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(5, 6, 36, 10), postMat);
      post.position.set(cx + (dx * BASE.w) / 2, 18, cz + (dy * BASE.h) / 2);
      post.castShadow = true;
      scene.add(post);
    }
  }

  // Team-colored light spilling onto the grass.
  const light = new THREE.PointLight(color, 1.4, 420, 0);
  light.position.set(cx, 90, cz);
  scene.add(light);

  return { ringMat, pulse, color };
}

// ---------- flags ----------

function makeFlag(team) {
  const color = new THREE.Color(COLORS[team]);
  const group = new THREE.Group();

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(2.5, 2.5, 90, 10),
    new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.6, roughness: 0.4 })
  );
  pole.position.y = 45;
  pole.castShadow = true;
  group.add(pole);

  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(4.5, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xffd34d, metalness: 0.8, roughness: 0.3 })
  );
  tip.position.y = 93;
  group.add(tip);

  // Cloth with enough segments to wave.
  const clothGeo = new THREE.PlaneGeometry(52, 30, 14, 4);
  clothGeo.translate(26, 0, 0);

  const cloth = new THREE.Mesh(
    clothGeo,
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.35,
      side: THREE.DoubleSide,
      roughness: 0.7,
    })
  );
  cloth.position.set(2, 73, 0);
  cloth.castShadow = true;
  group.add(cloth);

  scene.add(group);

  return {
    team,
    group,
    cloth,
    rest: clothGeo.attributes.position.array.slice(),
    homeRotation: team === "blue" ? 0 : Math.PI,
    phase: team === "blue" ? 0 : 1.7,
    x: BASES[team].x,
    y: BASES[team].y,
    atHome: true,
    carrier: null,
    pop: 1,
  };
}

function waveFlag(flag, t, strength) {
  const pos = flag.cloth.geometry.attributes.position;

  for (let i = 0; i < pos.count; i++) {
    const x = flag.rest[i * 3];
    const along = x / 52;
    const wave = Math.sin(x * 0.14 - t * 7 + flag.phase);
    pos.setZ(i, wave * along * 7 * strength);
    pos.setY(i, flag.rest[i * 3 + 1] - along * along * 4 + wave * along * 1.5);
  }

  pos.needsUpdate = true;
  flag.cloth.geometry.computeVertexNormals();
}

// ---------- players ----------

function makePlayerModel(team) {
  const color = new THREE.Color(COLORS[team]);
  const outer = new THREE.Group();
  const rig = new THREE.Group();
  outer.add(rig);

  const suit = new THREE.MeshStandardMaterial({ color, roughness: 0.45 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d2024, roughness: 0.5 });
  const helmet = new THREE.MeshStandardMaterial({
    color: color.clone().multiplyScalar(0.75),
    roughness: 0.3,
    metalness: 0.2,
  });

  const add = (mesh, x, y, z) => {
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    rig.add(mesh);
    return mesh;
  };

  // Facing direction is local +x.
  add(new THREE.Mesh(new THREE.BoxGeometry(12, 7, 9), dark), 2, 3.5, -7);
  add(new THREE.Mesh(new THREE.BoxGeometry(12, 7, 9), dark), 2, 3.5, 7);
  add(new THREE.Mesh(new THREE.CapsuleGeometry(15, 20, 6, 14), suit), 0, 29, 0);
  add(new THREE.Mesh(new THREE.SphereGeometry(13, 18, 14), helmet), 0, 64, 0);

  add(
    new THREE.Mesh(
      new THREE.BoxGeometry(8, 8, 18),
      new THREE.MeshStandardMaterial({
        color: 0x111820,
        emissive: 0x2bd9ff,
        emissiveIntensity: 0.6,
        roughness: 0.1,
      })
    ),
    10,
    65,
    0
  );

  // Paintball marker in the right hand.
  add(new THREE.Mesh(new THREE.BoxGeometry(34, 7, 7), dark), 22, 36, 11);
  add(
    new THREE.Mesh(
      new THREE.SphereGeometry(5.5, 12, 10),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.85,
      })
    ),
    14,
    44,
    11
  );

  // Air tank on the back.
  const tank = add(
    new THREE.Mesh(
      new THREE.CylinderGeometry(6, 6, 26, 12),
      new THREE.MeshStandardMaterial({ color: 0xc9d1d9, metalness: 0.8, roughness: 0.25 })
    ),
    -16,
    36,
    0
  );
  tank.rotation.z = 0.15;

  // Glowing team ring on the ground.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(25, 30, 40),
    new THREE.MeshBasicMaterial({
      color: color.clone().multiplyScalar(2.2),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 1.4;
  outer.add(ring);

  // Draw the character a bit larger than its collision circle so it reads well.
  rig.scale.setScalar(1.3);

  scene.add(outer);
  return { outer, rig };
}

// Same-keyboard mode: Blue uses the arrow keys, Red uses WASD.
const CONTROLS = {
  blue: { up: ["ArrowUp"], down: ["ArrowDown"], left: ["ArrowLeft"], right: ["ArrowRight"] },
  red: { up: ["KeyW"], down: ["KeyS"], left: ["KeyA"], right: ["KeyD"] },
};

// Online mode: each browser controls only its own player with the arrow keys.
const ONLINE_CONTROLS = {
  up: ["ArrowUp"],
  down: ["ArrowDown"],
  left: ["ArrowLeft"],
  right: ["ArrowRight"],
};

const spawnPoint = (team) => ({
  x: BASES[team].x + (team === "blue" ? 65 : -65),
  y: BASES[team].y,
  facing: team === "blue" ? 0 : Math.PI,
});

function makePlayer(team) {
  const model = makePlayerModel(team);
  const spawn = spawnPoint(team);

  return {
    team,
    ...model,
    x: spawn.x,
    y: spawn.y,
    facing: spawn.facing,
    moving: false,
    bobTime: 0,
    lastDust: 0,
    carryingFlag: null,
    pickupBlockedFlag: null,
    health: MAX_HEALTH,
    lastShot: -Infinity,
  };
}

function shootPaintball(player) {
  const paintball = new THREE.Mesh(
    paintballGeometry,
    paintballMaterials[player.team]
  );

  scene.add(paintball);

  const angle = player.targetFacing ?? player.facing;
  const directionX = Math.cos(angle);
  const directionY = -Math.sin(angle);

  const x = player.x + directionX * (PLAYER_RADIUS + 10);
  const y = player.y + directionY * (PLAYER_RADIUS + 10);

  paintball.position.set(toX(x), 18, toZ(y));

  // Store the mesh and position so the game can move it later.
  paintballs.push({
    mesh: paintball,
    team: player.team,
    x,
    y,
    velocityX: directionX * PAINTBALL_SPEED,
    velocityY: directionY * PAINTBALL_SPEED,
    life: 1.5,
  });
}

function paintballTouchesRect(x, y, rect) {
  const [rx, ry, width, height] = rect;

  const closestX = clamp(x, rx, rx + width);
  const closestY = clamp(y, ry, ry + height);

  return Math.hypot(x - closestX, y - closestY) <= PAINTBALL_RADIUS;
}

function updatePaintballs(dt) {
  for (let i = paintballs.length - 1; i >= 0; i--) {
    const ball = paintballs[i];
    const startX = ball.x;
    const startY = ball.y;
    const endX = startX + ball.velocityX * dt;
    const endY = startY + ball.velocityY * dt;

    // Check points along the path so a fast shot can't skip over a target.
    const distance = Math.hypot(endX - startX, endY - startY);
    const steps = Math.max(1, Math.ceil(distance / (PAINTBALL_RADIUS / 2)));
    const enemy = players[otherTeam(ball.team)];

    let hitSomething = false;

    for (let step = 1; step <= steps; step++) {
      const progress = step / steps;
      const x = startX + (endX - startX) * progress;
      const y = startY + (endY - startY) * progress;

      const hitsWall = WALL_RECTS.some((rect) =>
        paintballTouchesRect(x, y, rect)
      );

      const hitsMovingHazard = movers.some((mover) =>
        paintballTouchesRect(x, y, moverRect(mover))
      );

      if (hitsWall || hitsMovingHazard) {
        ball.x = x;
        ball.y = y;
        hitSomething = true;
        break;
      }

      const hitEnemy =
        Math.hypot(x - enemy.x, y - enemy.y) <=
        PAINTBALL_RADIUS + PLAYER_RADIUS;

      if (hitEnemy) {
        ball.x = x;
        ball.y = y;
        hitSomething = true;

        // Only the referee decides hits, so both screens show the same health.
        // The other browser gets a "hit" event and plays the effect then.
        if (isReferee() && !gameOver) {
          const health = Math.max(0, enemy.health - SHOT_DAMAGE);
          applyHit(enemy.team, health);
          shareEvent({ type: "hit", team: enemy.team, health });
        }

        break;
      }
    }

    if (!hitSomething) {
      ball.x = endX;
      ball.y = endY;
    }

    ball.life -= dt;
    ball.mesh.position.set(toX(ball.x), 18, toZ(ball.y));

    const outsideField =
      ball.x < FIELD.x ||
      ball.x > FIELD.x + FIELD.w ||
      ball.y < FIELD.y ||
      ball.y > FIELD.y + FIELD.h;

    if (hitSomething || ball.life <= 0 || outsideField) {
      scene.remove(ball.mesh);
      paintballs.splice(i, 1);
    }
  }
}

// ---------- particles ----------

const ZERO = new THREE.Vector3();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

class ParticlePool {
  constructor(geometry, material, max, { receiveShadow = false } = {}) {
    this.max = max;
    this.next = 0;
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = receiveShadow;

    const white = new THREE.Color(1, 1, 1);
    this.items = [];

    for (let i = 0; i < max; i++) {
      this.items.push({
        life: 0,
        maxLife: 1,
        tail: 1,
        size: 1,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        rot: new THREE.Euler(),
        spin: new THREE.Vector3(),
        gravity: 0,
        drag: 0,
        floor: -Infinity,
        bounce: 0,
      });
      this.mesh.setMatrixAt(i, HIDDEN);
      this.mesh.setColorAt(i, white);
    }

    scene.add(this.mesh);
  }

  spawn(o) {
    const i = this.next;
    this.next = (i + 1) % this.max;

    const p = this.items[i];
    p.life = p.maxLife = o.life;
    p.tail = o.tail ?? o.life;
    p.size = o.size;
    p.pos.copy(o.pos);
    p.vel.copy(o.vel ?? ZERO);
    p.rot.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0);
    p.spin.copy(o.spin ?? ZERO);
    p.gravity = o.gravity ?? 0;
    p.drag = o.drag ?? 0;
    p.floor = o.floor ?? -Infinity;
    p.bounce = o.bounce ?? 0;

    this.mesh.setColorAt(i, o.color);
    this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      const p = this.items[i];
      if (p.life <= 0) continue;

      p.life -= dt;
      if (p.life <= 0) {
        this.mesh.setMatrixAt(i, HIDDEN);
        continue;
      }

      p.vel.y -= p.gravity * dt;
      if (p.drag) p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);

      if (p.pos.y < p.floor) {
        p.pos.y = p.floor;
        p.vel.set(p.vel.x * 0.4, -p.vel.y * p.bounce, p.vel.z * 0.4);
        p.spin.multiplyScalar(0.3);
      }

      p.rot.x += p.spin.x * dt;
      p.rot.y += p.spin.y * dt;
      p.rot.z += p.spin.z * dt;

      _q.setFromEuler(p.rot);
      _s.setScalar(p.size * Math.min(1, p.life / p.tail));
      _m.compose(p.pos, _q, _s);
      this.mesh.setMatrixAt(i, _m);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

function buildEffects() {
  const sparks = new ParticlePool(
    new THREE.SphereGeometry(1, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
    500
  );

  const confetti = new ParticlePool(
    new THREE.PlaneGeometry(10, 5),
    new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.6 }),
    700
  );

  const dust = new ParticlePool(
    new THREE.SphereGeometry(1, 6, 4),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    }),
    200
  );

  const decalGeo = new THREE.CircleGeometry(1, 20);
  decalGeo.rotateX(-Math.PI / 2);

  const decals = new ParticlePool(
    decalGeo,
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.35,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    }),
    300,
    { receiveShadow: true }
  );

  return { sparks, confetti, dust, decals, decalCount: 0 };
}

const rand = (lo, hi) => lo + Math.random() * (hi - lo);

function sparkBurst(team, x, y, count, height = 30) {
  const color = new THREE.Color(COLORS[team]).multiplyScalar(2.4);

  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const speed = rand(90, 300);

    fx.sparks.spawn({
      pos: new THREE.Vector3(toX(x), height, toZ(y)),
      vel: new THREE.Vector3(Math.cos(a) * speed, rand(120, 340), Math.sin(a) * speed),
      gravity: 750,
      floor: 2,
      bounce: 0.3,
      life: rand(0.45, 0.8),
      size: rand(2.5, 4.5),
      color,
    });
  }
}

function paintSplat(team, x, y) {
  sparkBurst(team, x, y, 28, 40);

  const color = new THREE.Color(COLORS[team]);
  const blobs = [[0, 0, rand(20, 26)]];

  for (let k = 0; k < 7; k++) {
    const a = Math.random() * Math.PI * 2;
    const d = rand(18, 46);
    blobs.push([Math.cos(a) * d, Math.sin(a) * d, rand(4, 10)]);
  }

  for (const [dx, dy, size] of blobs) {
    fx.decalCount = (fx.decalCount + 1) % 60;

    fx.decals.spawn({
      pos: new THREE.Vector3(toX(x + dx), 0.4 + fx.decalCount * 0.015, toZ(y + dy)),
      life: 9,
      tail: 1.5,
      size,
      color,
    });
  }
}

const CONFETTI_COLORS = [COLORS.blue, COLORS.red, COLORS.hazard, 0xffffff].map(
  (c) => new THREE.Color(c)
);

function confettiBurst(x, y, count) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const speed = rand(60, 260);

    fx.confetti.spawn({
      pos: new THREE.Vector3(toX(x), 30, toZ(y)),
      vel: new THREE.Vector3(Math.cos(a) * speed, rand(300, 620), Math.sin(a) * speed),
      gravity: 520,
      drag: 1.2,
      floor: 1,
      life: rand(1.8, 2.6),
      tail: 0.6,
      size: rand(0.9, 1.4),
      rx: rand(0, 6),
      ry: rand(0, 6),
      spin: new THREE.Vector3(rand(-12, 12), rand(-12, 12), rand(-12, 12)),
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    });
  }
}

const DUST_COLOR = new THREE.Color(0xe3efd0);

function emitDust(player, t) {
  if (!player.moving || t - player.lastDust < 0.07) return;
  player.lastDust = t;

  const back = player.facing + Math.PI;

  fx.dust.spawn({
    pos: new THREE.Vector3(
      toX(player.x) + Math.cos(back) * 10,
      4,
      toZ(player.y) - Math.sin(back) * 10
    ),
    vel: new THREE.Vector3(rand(-15, 15), rand(20, 45), rand(-15, 15)),
    life: 0.5,
    size: rand(4, 6.5),
    color: DUST_COLOR,
  });
}

// ---------- camera shake, flash, HUD ----------

const shakeState = { time: 0, duration: 1, strength: 0 };

function shake(duration, strength) {
  const current = shakeState.strength * (shakeState.time / shakeState.duration);
  if (strength < current) return;
  Object.assign(shakeState, { time: duration, duration, strength });
}

const flashEl = document.getElementById("flash");
const bannerEl = document.getElementById("banner");
const bannerTitle = bannerEl.querySelector(".title");

function flash(team, ms) {
  flashEl.style.background = css(COLORS[team]);
  flashEl.animate([{ opacity: 0.45 }, { opacity: 0 }], { duration: ms, easing: "ease-out" });
}

// ---------- health bars ----------

const healthHud = {
  blue: {
    name: document.getElementById("hpNameBlue"),
    fill: document.getElementById("hpFillBlue"),
    value: document.getElementById("hpValueBlue"),
  },
  red: {
    name: document.getElementById("hpNameRed"),
    fill: document.getElementById("hpFillRed"),
    value: document.getElementById("hpValueRed"),
  },
};

// Small bars that float above each player's head.
const headBars = {};
for (const team of ["blue", "red"]) {
  const bar = document.createElement("div");
  bar.className = `head-hp head-hp-${team}`;
  const fill = document.createElement("div");
  bar.append(fill);
  container.append(bar);
  headBars[team] = { bar, fill };
}

function renderHealth() {
  for (const team of ["blue", "red"]) {
    const health = players[team].health;
    const percent = `${(health / MAX_HEALTH) * 100}%`;
    const hud = healthHud[team];

    if (hud.name) hud.name.textContent = playerNames[team];
    if (hud.fill) hud.fill.style.width = percent;
    if (hud.value) hud.value.textContent = health;
    hud.fill?.parentElement?.parentElement?.classList.toggle("low", health <= MAX_HEALTH * 0.4);

    headBars[team].fill.style.width = percent;
  }
}

const _barPos = new THREE.Vector3();

function positionHeadBars() {
  const width = container.clientWidth;
  const height = container.clientHeight;

  for (const team of ["blue", "red"]) {
    const p = players[team];
    _barPos.set(toX(p.x), 112, toZ(p.y)).project(camera);
    headBars[team].bar.style.left = `${((_barPos.x + 1) / 2) * width}px`;
    headBars[team].bar.style.top = `${((1 - _barPos.y) / 2) * height}px`;
  }
}

// Runs on both browsers: the referee calls it directly, the other browser
// calls it when the "hit" event arrives.
function applyHit(team, health) {
  const victim = players[team];
  victim.health = Math.max(0, Math.min(MAX_HEALTH, health));

  if (victim.carryingFlag !== null) {
    // Being hit while carrying a flag also sends the flag home.
    returnCarriedFlagToBase(victim);
  } else {
    paintSplat(otherTeam(team), victim.x, victim.y);
    shake(0.08, 4);
  }

  renderHealth();
  healthHud[team].fill?.parentElement?.parentElement?.animate(
    [{ transform: "scale(1.08)" }, { transform: "scale(1)" }],
    { duration: 250, easing: "ease-out" }
  );

  if (victim.health <= 0 && !gameOver) {
    paintSplat(otherTeam(team), victim.x, victim.y);
    shake(0.3, 16);
    endGame(otherTeam(team), "knockout");
  }
}

function setPlayerNames(names = {}) {
  let changed = false;

  for (const team of ["blue", "red"]) {
    const suppliedName = names[team];
    const nextName = typeof suppliedName === "string" && suppliedName.trim()
      ? suppliedName.trim().slice(0, 20)
      : team.toUpperCase();

    if (playerNames[team] !== nextName) {
      playerNames[team] = nextName;
      changed = true;
    }
  }

  if (!changed) return;

  if (groundMaterial) {
    const oldTexture = groundTexture;
    groundTexture = makeGroundTexture();
    groundMaterial.map = groundTexture;
    groundMaterial.needsUpdate = true;
    oldTexture?.dispose();
  }

  renderHealth();
}

const bannerReason = bannerEl.querySelector(".reason");

function showWinner(team, reason = "flag") {
  bannerTitle.textContent = `${playerNames[team]} WINS!`;
  if (bannerReason) {
    bannerReason.textContent = reason === "knockout"
      ? `Knocked out ${playerNames[otherTeam(team)]}`
      : `Captured ${playerNames[otherTeam(team)]}'s flag`;
  }
  bannerTitle.style.color = css(COLORS[team]);
  bannerTitle.style.textShadow = `0 0 0.3em ${css(COLORS[team], 0.9)}`;
  bannerEl.style.display = "flex";
  bannerTitle.animate(
    [{ transform: "scale(0)" }, { transform: "scale(1)" }],
    { duration: 700, easing: "cubic-bezier(.34, 1.56, .64, 1)" }
  );

  flash(team, 600);

  for (let k = 0; k < 4; k++) {
    setTimeout(() => confettiBurst(W / 2 - 420 + k * 280, H - 160, 80), k * 250);
  }
}

// ---------- build the world ----------

buildGround();
buildHedges();
buildPalms();
buildWalls();

const movers = buildMovers();
const baseDecor = { blue: buildBaseDecor("blue"), red: buildBaseDecor("red") };
const flags = { blue: makeFlag("blue"), red: makeFlag("red") };
const players = { blue: makePlayer("blue"), red: makePlayer("red") };
const fx = buildEffects();
let gameOver = false;

renderHealth();

// ---------- online play ----------

// null = both players on one keyboard. "blue" or "red" = online, this browser's player.
let localTeam = null;
const SEND_INTERVAL = 0.05; // send our position 20 times per second
let sendTimer = 0;

function setLocalTeam(team) {
  localTeam = team === "blue" || team === "red" ? team : null;
}

function isRemote(player) {
  return localTeam !== null && player.team !== localTeam;
}

function sendToRoom(message) {
  window.palmFlag?.network?.send(message);
}

// One browser acts as the referee for flags, hits and the end of the game, so both
// screens always agree. Blue (the room creator) is the referee. Offline, this browser
// runs everything itself.
function isReferee() {
  return localTeam !== "red";
}

// The referee tells the other browser what happened.
function shareEvent(event) {
  if (localTeam !== null) sendToRoom(event);
}

// Called by lobby.js for flag, score and restart events from the other browser.
function applyRoomEvent(event = {}) {
  const player = players[event.team];

  if (event.type === "pickup" && player && flags[event.flag]) {
    if (flags[event.flag].carrier !== player) pickUpFlag(player, flags[event.flag]);
  } else if (event.type === "hit" && player) {
    applyHit(event.team, event.health);
  } else if (event.type === "score" && player) {
    scorePoint(event.team);
  } else if (event.type === "restart") {
    restartGame();
  }
}

// Called by lobby.js when the other browser sends its position.
function setRemotePlayerState(team, state) {
  const p = players[team];
  if (!p || team === localTeam) return;

  p.netX = state.x;
  p.netY = state.y;
  p.moving = Boolean(state.moving);
  if (typeof state.facing === "number") p.targetFacing = state.facing;
}

// Called by lobby.js when the other player fires.
function remoteShoot(team, state = {}) {
  const p = players[team];
  if (!p || team === localTeam || gameOver) return;

  if (typeof state.x === "number") {
    p.x = p.netX = state.x;
    p.y = p.netY = state.y;
  }
  if (typeof state.facing === "number") p.facing = p.targetFacing = state.facing;

  shootPaintball(p);
}

// Fire only if this player's cooldown has passed. Returns true if a shot was fired.
function tryShoot(player) {
  const now = clock.elapsedTime;
  if (now - player.lastShot < SHOT_COOLDOWN) return false;
  player.lastShot = now;
  shootPaintball(player);
  return true;
}

function shootAndShare(player) {
  if (!tryShoot(player)) return;

  if (localTeam !== null) {
    sendToRoom({
      type: "shoot",
      x: player.x,
      y: player.y,
      facing: player.targetFacing ?? player.facing,
    });
  }
}

function sendLocalPosition(dt) {
  if (localTeam === null) return;

  sendTimer += dt;
  if (sendTimer < SEND_INTERVAL) return;
  sendTimer = 0;

  const me = players[localTeam];
  sendToRoom({
    type: "move",
    x: me.x,
    y: me.y,
    facing: me.targetFacing ?? me.facing,
    moving: me.moving,
  });
}

// ---------- input ----------

const keys = new Set();

window.addEventListener("keydown", (e) => {
  // Don't move players while someone is typing a name or room ID in the lobby.
  if (e.target instanceof HTMLInputElement) return;

  if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
  keys.add(e.code);

  if (e.repeat || gameOver) {
    if (e.code === "KeyR" && gameOver && !e.repeat) {
      restartGame();
      shareEvent({ type: "restart" });
    }
    return;
  }

  if (localTeam !== null) {
    // Online: Space fires your own player's paintball.
    if (e.code === "Space") shootAndShare(players[localTeam]);
  } else {
    // Same keyboard: Q fires Blue's paintball, E fires Red's.
    if (e.code === "KeyQ") tryShoot(players.blue);
    if (e.code === "KeyE") tryShoot(players.red);
  }
});

window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => keys.clear());

// ---------- collisions ----------

// Push a player (circle) out of a rectangle.
function pushOutOfRect(p, [rx, ry, rw, rh]) {
  const R = PLAYER_RADIUS;
  const cx = clamp(p.x, rx, rx + rw);
  const cy = clamp(p.y, ry, ry + rh);
  const dx = p.x - cx;
  const dy = p.y - cy;
  const d2 = dx * dx + dy * dy;

  if (d2 >= R * R) return;

  if (d2 > 1e-6) {
    const d = Math.sqrt(d2);
    p.x += (dx / d) * (R - d);
    p.y += (dy / d) * (R - d);
    return;
  }

  // Center ended up inside the box: push out along the shortest side.
  const left = p.x - rx;
  const right = rx + rw - p.x;
  const top = p.y - ry;
  const bottom = ry + rh - p.y;
  const m = Math.min(left, right, top, bottom);

  if (m === left) p.x = rx - R;
  else if (m === right) p.x = rx + rw + R;
  else if (m === top) p.y = ry - R;
  else p.y = ry + rh + R;
}

function circleTouchesRect(p, [rx, ry, rw, rh]) {
  const dx = p.x - clamp(p.x, rx, rx + rw);
  const dy = p.y - clamp(p.y, ry, ry + rh);
  return dx * dx + dy * dy < PLAYER_RADIUS * PLAYER_RADIUS;
}

function separatePlayers(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const min = PLAYER_RADIUS * 2;

  if (d >= min) return;

  const nx = d > 1e-6 ? dx / d : 1;
  const ny = d > 1e-6 ? dy / d : 0;
  const push = (min - d) / 2;

  a.x -= nx * push;
  a.y -= ny * push;
  b.x += nx * push;
  b.y += ny * push;
}

function keepInField(p) {
  p.x = clamp(p.x, FIELD.x + PLAYER_RADIUS, FIELD.x + FIELD.w - PLAYER_RADIUS);
  p.y = clamp(p.y, FIELD.y + PLAYER_RADIUS, FIELD.y + FIELD.h - PLAYER_RADIUS);
}

// ---------- game rules (same as the Phaser version) ----------

const pressed = (codes) => codes.some((code) => keys.has(code));

function movePlayer(p, dt) {
  // The other browser controls this player: glide toward its last sent position.
  if (isRemote(p)) {
    if (p.netX !== undefined) {
      const follow = Math.min(1, dt * 15);
      p.x += (p.netX - p.x) * follow;
      p.y += (p.netY - p.y) * follow;
    }
    return;
  }

  const c = localTeam !== null ? ONLINE_CONTROLS : CONTROLS[p.team];
  let vx = 0;
  let vy = 0;

  if (pressed(c.left)) vx = -PLAYER_SPEED;
  if (pressed(c.right)) vx = PLAYER_SPEED;
  if (pressed(c.up)) vy = -PLAYER_SPEED;
  if (pressed(c.down)) vy = PLAYER_SPEED;

  // Normalize diagonal movement so it isn't faster.
  if (vx !== 0 && vy !== 0) {
    vx *= Math.SQRT1_2;
    vy *= Math.SQRT1_2;
  }

  p.moving = vx !== 0 || vy !== 0;
  p.x += vx * dt;
  p.y += vy * dt;

  if (p.moving) p.targetFacing = Math.atan2(-vy, vx);
}

function pickUpFlag(player, flag) {
  player.carryingFlag = flag.team;
  flag.atHome = false;
  flag.carrier = player;

  sparkBurst(flag.team, flag.x, flag.y, 18, 60);
  shake(0.09, 5);
}

function returnCarriedFlagToBase(player) {
  if (player.carryingFlag === null) return;

  const flag = flags[player.carryingFlag];

  // Paint splat where the player got tagged, in the attacker's color.
  paintSplat(otherTeam(player.team), player.x, player.y);
  shake(0.16, 10);

  sendFlagHome(flag);
  sparkBurst(flag.team, flag.x, flag.y, 14, 50);

  player.carryingFlag = null;

  // Prevent immediate pickup if the player is still at this flag's base.
  player.pickupBlockedFlag = flag;
}

function sendFlagHome(flag) {
  flag.atHome = true;
  flag.carrier = null;
  flag.x = BASES[flag.team].x;
  flag.y = BASES[flag.team].y;
  flag.pop = 0;
}

function tryScore(player) {
  const enemyFlag = otherTeam(player.team);

  // They must carry the opponent's flag.
  if (player.carryingFlag !== enemyFlag) return;

  // Their own flag must be home.
  if (!flags[player.team].atHome) return;

  scorePoint(player.team);
  shareEvent({ type: "score", team: player.team });
}

// Bringing the enemy flag home once wins the game.
// Runs on both browsers: the referee calls it directly, the other browser
// calls it when the "score" event arrives.
function scorePoint(team) {
  if (gameOver) return;
  const player = players[team];

  confettiBurst(player.x, player.y, 70);
  flash(team, 300);
  shake(0.2, 14);

  endGame(team, "flag");
}

// reason: "flag" (captured the enemy flag) or "knockout" (opponent's health hit 0).
function endGame(winner, reason) {
  gameOver = true;
  for (const p of Object.values(players)) p.moving = false;
  showWinner(winner, reason);
}

function resetRound() {
  for (const flag of Object.values(flags)) sendFlagHome(flag);

  for (const p of Object.values(players)) {
    const spawn = spawnPoint(p.team);
    p.x = spawn.x;
    p.y = spawn.y;
    p.facing = p.targetFacing = spawn.facing;
    p.netX = p.netY = undefined;
    p.carryingFlag = null;
    p.pickupBlockedFlag = null;
  }
}

function restartGame() {
  gameOver = false;
  bannerEl.style.display = "none";
  for (const p of Object.values(players)) p.health = MAX_HEALTH;
  resetRound();
  renderHealth();
}

function step(dt) {
  // Move hazards back and forth.
  for (const m of movers) {
    const key = m.axis === "x" ? "x" : "y";
    m[key] += m.speed * m.dir * dt;

    if (m[key] >= m.max) {
      m[key] = m.max;
      m.dir = -1;
    } else if (m[key] <= m.min) {
      m[key] = m.min;
      m.dir = 1;
    }
  }

  // Advance paintballs once per game frame, after moving hazards.
  updatePaintballs(dt);

  const list = [players.blue, players.red];
  for (const p of list) movePlayer(p, dt);

  // Resolve collisions twice so corners settle cleanly.
  for (let pass = 0; pass < 2; pass++) {
    for (const p of list) {
      for (const m of movers) pushOutOfRect(p, moverRect(m));
      for (const rect of WALL_RECTS) pushOutOfRect(p, rect);
    }
    separatePlayers(players.blue, players.red);
    for (const p of list) keepInField(p);
  }

  // Tell the other browser where our player is now.
  sendLocalPosition(dt);

  // Flags and scoring are decided by the referee only (see isReferee).
  if (!isReferee()) return;

  for (const p of list) {
    const enemy = flags[otherTeam(p.team)];

    // Pick up the enemy flag.
    if (
      p.carryingFlag === null &&
      enemy.carrier === null &&
      p.pickupBlockedFlag !== enemy &&
      Math.hypot(p.x - enemy.x, p.y - enemy.y) < PICKUP_DISTANCE
    ) {
      pickUpFlag(p, enemy);
      shareEvent({ type: "pickup", team: p.team, flag: enemy.team });
    }

    // Score by bringing it back to your own base.
    if (circleTouchesRect(p, baseRect(p.team))) tryScore(p);
    if (gameOver) return;

    // Once the tagged player moves away, allow them to pick up that flag again.
    const blocked = p.pickupBlockedFlag;
    if (blocked && Math.hypot(p.x - blocked.x, p.y - blocked.y) > 70) {
      p.pickupBlockedFlag = null;
    }
  }
}

// ---------- drawing each frame ----------

function shortestAngle(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function updateVisuals(dt, t) {
  // Players.
  for (const p of Object.values(players)) {
    if (p.targetFacing !== undefined) {
      p.facing += shortestAngle(p.facing, p.targetFacing) * Math.min(1, dt * 14);
    }

    p.outer.position.set(toX(p.x), 0, toZ(p.y));
    p.outer.rotation.y = p.facing;

    if (p.moving) p.bobTime += dt;
    const bob = p.moving ? Math.abs(Math.sin(p.bobTime * 14)) * 4 : 0;
    p.rig.position.y += (bob - p.rig.position.y) * Math.min(1, dt * 20);
    p.rig.rotation.z += ((p.moving ? -0.12 : 0) - p.rig.rotation.z) * Math.min(1, dt * 10);

    emitDust(p, t);
  }

  // Flags: at home, or riding on the carrier's back.
  for (const flag of Object.values(flags)) {
    if (flag.carrier) {
      const c = flag.carrier;
      flag.x = c.x - Math.cos(c.facing) * 14;
      flag.y = c.y + Math.sin(c.facing) * 14;
      flag.group.position.set(toX(flag.x), 10 + c.rig.position.y, toZ(flag.y));
      flag.group.rotation.y = c.facing + Math.PI;
      flag.group.scale.setScalar(0.75);
      waveFlag(flag, t * 1.6, 1.6);
    } else {
      flag.pop = Math.min(1, flag.pop + dt * 2.5);
      const s = 1 - Math.pow(1 - flag.pop, 3);
      flag.group.position.set(toX(flag.x), 0, toZ(flag.y));
      flag.group.rotation.y = flag.homeRotation;
      flag.group.scale.setScalar(Math.max(0.001, s));
      waveFlag(flag, t, 1);
    }
  }

  // Hazards.
  for (const m of movers) {
    m.group.position.set(toX(m.x), 0, toZ(m.y));
    const on = Math.sin(t * 6 + m.phase) > 0;
    for (const light of m.lights) {
      light.material.color.setHex(on ? 0xff3b1f : 0x4a1a12).multiplyScalar(on ? 3 : 1);
    }
  }

  // Base rings.
  for (const decor of Object.values(baseDecor)) {
    const phase = (t % 1.6) / 1.6;
    const eased = 1 - Math.pow(1 - phase, 2);
    decor.pulse.scale.setScalar(1 + eased * 0.9);
    decor.pulse.material.opacity = 0.8 * (1 - phase);
    decor.ringMat.color.copy(decor.color).multiplyScalar(2.4 + Math.sin(t * 4) * 0.8);
  }

  // Health bars above heads.
  positionHeadBars();

  // Particles.
  fx.sparks.update(dt);
  fx.confetti.update(dt);
  fx.dust.update(dt);
  fx.decals.update(dt);

  // Camera shake.
  if (shakeState.time > 0) {
    shakeState.time = Math.max(0, shakeState.time - dt);
    const k = shakeState.strength * (shakeState.time / shakeState.duration);
    camera.position.set(
      CAMERA_HOME.x + (Math.random() - 0.5) * 2 * k,
      CAMERA_HOME.y + (Math.random() - 0.5) * 2 * k,
      CAMERA_HOME.z + (Math.random() - 0.5) * 2 * k
    );
  } else {
    camera.position.copy(CAMERA_HOME);
  }
}

// ---------- main loop ----------

const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  if (!gameOver) step(dt);
  updateVisuals(dt, t);
  composer.render();
});

// Handy for debugging in the browser console.
window.palmFlag = {
  players,
  flags,
  movers,
  setPlayerNames,
  setLocalTeam,
  setRemotePlayerState,
  remoteShoot,
  applyRoomEvent,
};