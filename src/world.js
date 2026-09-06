// world.js — THE WORLD: organic Stålberg terrain with two plates on it and
// a dirt road FOUND between them. Pure: no DOM, no three.js, Node-tested
// in test/world.mjs. world-tab.js draws it and runs the drive rules on it.
//
// Two coordinate frames, one boundary. The grid kernel works in [0,1]²
// and vec2 pairs; everything here is WORLD METRES on the XZ plane, north
// -z, and the plates keep their own local frames offset by (ox, oz).
//
// Height is a FUNCTION, not a table: the mesh samples it at its vertices
// and the hull samples it where it stands, so the two cannot disagree
// beyond the mesh's own faceting, and a plate sits on ground that is
// exactly zero because the mask says so, not because a vertex was edited.
import { mulberry32 } from './rng.js?v=979b8ccb';
import { makeParams, clampParams, formatKnobs, knobProblems } from './knobs.js?v=979b8ccb';
import { generateMesh, relax } from './organic-grid.js?v=979b8ccb';
import { valueNoise2D } from './noise.js?v=979b8ccb';
import { generatePlate, makePlateParams, CELL_M, DIRS, yawOfSide, KIND } from './plate.js?v=979b8ccb';
import { makeGates, makeSentries, blockedAt, losClear, buildingAt, gateCentre } from './drive.js?v=979b8ccb';

export const WORLD_TUNE = {
  size: 560,        // m, the world is a square
  r: 0.04,          // poisson radius in [0,1]; ~11 m quads after subdivision
  relaxIters: 40,
  amp: 14,          // m, main relief
  freq1: 90,        // m, main wavelength
  freq2: 32,        // m, detail wavelength
  plateMargin: 24,  // m of flat ground around a plate
  slopeK: 6,        // road cost multiplier per unit slope
  treeRate: 0.35,
  rockRate: 0.06,
  trunkR: 0.9,      // m
  rockR: 2.2,       // m
};
export const WORLD_KNOBS = [
  { key: 'size', label: 'world size (m)', group: 'world', min: 320, max: 1200, step: 40 },
  { key: 'r', label: 'poisson radius', group: 'world', min: 0.02, max: 0.08, step: 0.005 },
  { key: 'relaxIters', label: 'relax iterations', group: 'world', min: 0, max: 120, step: 5 },
  { key: 'amp', label: 'relief (m)', group: 'terrain', min: 0, max: 40, step: 1 },
  { key: 'freq1', label: 'wavelength (m)', group: 'terrain', min: 30, max: 300, step: 5 },
  { key: 'freq2', label: 'detail wavelength (m)', group: 'terrain', min: 8, max: 100, step: 2 },
  { key: 'plateMargin', label: 'flat margin (m)', group: 'terrain', min: 4, max: 80, step: 2 },
  { key: 'slopeK', label: 'road slope cost', group: 'road', min: 0, max: 30, step: 1 },
  { key: 'treeRate', label: 'tree rate', group: 'cover', min: 0, max: 1, step: 0.05 },
  { key: 'rockRate', label: 'rock rate', group: 'cover', min: 0, max: 0.5, step: 0.01 },
  { key: 'trunkR', label: 'trunk radius (m)', group: 'cover', min: 0.3, max: 3, step: 0.1 },
  { key: 'rockR', label: 'rock radius (m)', group: 'cover', min: 0.5, max: 6, step: 0.1 },
];
export const makeWorldParams = (src = WORLD_TUNE) => makeParams(WORLD_KNOBS, src);
export const clampWorldParams = (p, src) => clampParams(WORLD_KNOBS, p, src);
export const formatWorldTune = (p) => formatKnobs('WORLD_TUNE', WORLD_KNOBS, p);
export const worldKnobProblems = () => knobProblems(WORLD_KNOBS, WORLD_TUNE);

const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// distance from a point to an axis-aligned rectangle, 0 inside
const rectDist = (x, z, x0, z0, x1, z1) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));

// --- height ------------------------------------------------------------------
export function makeHeightFn(plates, tune, seed) {
  return (x, z) => {
    let mask = 1;
    for (const p of plates) mask = Math.min(mask, smoothstep(0, tune.plateMargin, rectDist(x, z, p.ox, p.oz, p.ox + p.wM, p.oz + p.hM)));
    if (mask <= 0) return 0;
    const n1 = valueNoise2D(x / tune.freq1, z / tune.freq1, seed) - 0.5;
    const n2 = valueNoise2D(x / tune.freq2, z / tune.freq2, seed + 7) - 0.5;
    return mask * (tune.amp * 2 * n1 + tune.amp * 0.7 * n2);
  };
}

// --- quads -------------------------------------------------------------------
const centroid = (mesh, q) => {
  let x = 0, z = 0;
  for (const i of q) { x += mesh.vertices[i][0]; z += mesh.vertices[i][1]; }
  return [x / 4, z / 4];
};

export function quadNearest(world, x, z) {
  let best = -1, bd = Infinity;
  world.centroids.forEach(([cx, cz], i) => { const d = (cx - x) ** 2 + (cz - z) ** 2; if (d < bd) { bd = d; best = i; } });
  return best;
}

function quadAdjacency(mesh) {
  const owners = new Map();
  const key = (a, b) => (a < b ? a * 1e6 + b : b * 1e6 + a);
  mesh.quads.forEach((q, qi) => {
    for (let i = 0; i < 4; i++) {
      const k = key(q[i], q[(i + 1) % 4]);
      if (!owners.has(k)) owners.set(k, []);
      owners.get(k).push(qi);
    }
  });
  const adj = mesh.quads.map(() => []);
  for (const list of owners.values()) if (list.length === 2) { adj[list[0]].push(list[1]); adj[list[1]].push(list[0]); }
  return adj;
}

// Dijkstra over the quad graph; the road is the quads it walks.
export function findRoad(world, fromQ, toQ, tune) {
  const n = world.centroids.length;
  const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
  dist[fromQ] = 0;
  for (;;) {
    let u = -1, du = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < du) { du = dist[i]; u = i; }
    if (u < 0 || u === toQ) break;
    done[u] = 1;
    const [ux, uz] = world.centroids[u];
    const uh = world.heightAt(ux, uz);
    for (const v of world.adj[u]) {
      if (done[v]) continue;
      const [vx, vz] = world.centroids[v];
      const d = Math.hypot(vx - ux, vz - uz);
      const cost = d * (1 + tune.slopeK * Math.abs(world.heightAt(vx, vz) - uh) / Math.max(d, 1e-6));
      if (dist[u] + cost < dist[v]) { dist[v] = dist[u] + cost; prev[v] = u; }
    }
  }
  if (dist[toQ] === Infinity) return [];
  const path = [];
  for (let q = toQ; q >= 0; q = prev[q]) path.push(q);
  return path.reverse();
}

// --- plates ------------------------------------------------------------------
function placePlate(plate, cx, cz) {
  const wM = plate.w * CELL_M, hM = plate.h * CELL_M;
  return { plate, wM, hM, ox: cx - wM / 2, oz: cz - hM / 2, gates: null, sentries: null, facing: -1 };
}

// the gate's outside point, three cells out along its side's normal, in world metres
export function gateOutside(p, gi) {
  const g = p.plate.gates[gi];
  const [cx, cz] = gateCentre(p.plate, g);
  const [dx, dz] = DIRS[g.side];
  return [p.ox + cx + dx * 3 * CELL_M, p.oz + cz + dz * 3 * CELL_M];
}

// --- the world ---------------------------------------------------------------
export function makeWorld(params, plateParams) {
  const tune = clampWorldParams(makeWorldParams(), params);
  const seed = Number(params.seed) || 0;
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const S = tune.size;
  const warnings = [];

  // plates
  const pA = generatePlate(makePlateParams({ ...plateParams, seed }));
  const pB = generatePlate(makePlateParams({ ...plateParams, seed: seed + 1 }));
  const plates = [placePlate(pA, S * 0.25, S * 0.5), placePlate(pB, S * 0.75, S * 0.5)];
  for (const p of plates) {
    p.gates = makeGates(p.plate).map((g) => ({ ...g, cx: g.cx + p.ox, cz: g.cz + p.oz }));
    p.sentries = makeSentries(p.plate).map((s) => ({ ...s, cx: s.cx + p.ox, cz: s.cz + p.oz, plate: p }));
  }
  // facing gates: nearest to the other plate's centre
  for (const [i, p] of plates.entries()) {
    const o = plates[1 - i];
    const ocx = o.ox + o.wM / 2, ocz = o.oz + o.hM / 2;
    let best = 0, bd = Infinity;
    p.plate.gates.forEach((g, gi) => {
      const [cx, cz] = gateCentre(p.plate, g);
      const d = Math.hypot(p.ox + cx - ocx, p.oz + cz - ocz);
      if (d < bd) { bd = d; best = gi; }
    });
    p.facing = best;
  }

  // terrain
  const heightAt = makeHeightFn(plates, tune, seed);
  const mesh = generateMesh({ seed, r: tune.r, k: 30 });
  relax(mesh, { n_iters: tune.relaxIters });
  mesh.vertices = mesh.vertices.map(([x, y]) => [x * S, y * S]);
  const world = {
    tune, seed, size: S, mesh, plates, heightAt, warnings,
    centroids: mesh.quads.map((q) => centroid(mesh, q)),
    adj: null, road: { quads: [], set: new Set(), points: [] }, trees: [], rocks: [], hash: new Map(),
    spawn: null, goal: null,
  };
  world.adj = quadAdjacency(mesh);
  world.heights = mesh.vertices.map(([x, z]) => heightAt(x, z));

  // road
  const [ax, az] = gateOutside(plates[0], plates[0].facing);
  const [bx, bz] = gateOutside(plates[1], plates[1].facing);
  const qa = quadNearest(world, ax, az), qb = quadNearest(world, bx, bz);
  const path = findRoad(world, qa, qb, tune);
  if (!path.length) warnings.push('no road between the plates');
  world.road = { quads: path, set: new Set(path), points: path.map((q) => world.centroids[q]) };

  // trees and rocks
  const bucket = (x, z) => `${Math.floor(x / 16)},${Math.floor(z / 16)}`;
  const put = (item) => { const k = bucket(item.x, item.z); if (!world.hash.has(k)) world.hash.set(k, []); world.hash.get(k).push(item); };
  mesh.quads.forEach((q, qi) => {
    if (world.road.set.has(qi)) return;
    const [cx, cz] = world.centroids[qi];
    let mask = 1;
    for (const p of plates) mask = Math.min(mask, smoothstep(0, tune.plateMargin, rectDist(cx, cz, p.ox, p.oz, p.ox + p.wM, p.oz + p.hM)));
    if (mask < 0.5) return;
    const h = heightAt(cx, cz);
    const hillFactor = Math.max(0.2, 1 - Math.max(0, h) / (tune.amp + 1e-6));
    const jitter = () => (rng() - 0.5) * 5;
    if (rng() < tune.treeRate * hillFactor) { const t = { kind: 'tree', x: cx + jitter(), z: cz + jitter(), r: tune.trunkR, h: 7 + rng() * 5, q: qi }; world.trees.push(t); put(t); }
    else if (rng() < tune.rockRate) { const rk = { kind: 'rock', x: cx + jitter(), z: cz + jitter(), r: tune.rockR, h: 1.5 + rng() * 2, q: qi }; world.rocks.push(rk); put(rk); }
  });

  // spawn and goal
  const gA = plates[0].plate.gates[plates[0].facing];
  world.spawn = { x: ax, z: az, heading: yawOfSide[gA.side] };
  world.goal = { x: bx, z: bz };
  return world;
}

// --- queries used by the drive rules -----------------------------------------
const plateOf = (world, x, z) => world.plates.find((p) => x >= p.ox && x < p.ox + p.wM && z >= p.oz && z < p.oz + p.hM) || null;

export function worldBlocked(world, x, z) {
  const p = plateOf(world, x, z);
  if (p) return blockedAt(p.plate, p.gates, x - p.ox, z - p.oz);
  const bx = Math.floor(x / 16), bz = Math.floor(z / 16);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const list = world.hash.get(`${bx + dx},${bz + dz}`);
      if (!list) continue;
      for (const it of list) if (Math.hypot(it.x - x, it.z - z) < it.r) return true;
    }
  }
  return false;
}

export const worldBuildingAt = (world, x, z) => { const p = plateOf(world, x, z); return p ? buildingAt(p.plate, x - p.ox, z - p.oz) : false; };

// sight for a sentry that belongs to plate p: buildings of that plate only
export const worldLosFor = (p) => (ax, az, bx, bz) => losClear(p.plate, ax - p.ox, az - p.oz, bx - p.ox, bz - p.oz);

export const worldSentries = (world) => world.plates.flatMap((p) => p.sentries);
export const worldGates = (world) => world.plates.flatMap((p) => p.gates);
export const KIND_WALL = KIND.WALL;
