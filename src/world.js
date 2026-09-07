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
import { mulberry32 } from './rng.js?v=e2c79438';
import { makeParams, clampParams, formatKnobs, knobProblems } from './knobs.js?v=e2c79438';
import { generateMesh, relax } from './organic-grid.js?v=e2c79438';
import { valueNoise2D } from './noise.js?v=e2c79438';
import { generatePlate, makePlateParams, CELL_M, DIRS, yawOfSide, KIND, shuffled } from './plate.js?v=e2c79438';
import { makeGates, makeSentries, blockedAt, losClear, buildingAt, gateCentre } from './drive.js?v=e2c79438';

export const ROAD_CLEAR_M = 7;
export const WORLD_TUNE = {
  size: 760,        // m, the world is a square
  r: 0.04,          // poisson radius in [0,1]; ~11 m quads after subdivision
  relaxIters: 40,
  amp: 14,          // m, main relief
  freq1: 90,        // m, main wavelength
  freq2: 32,        // m, detail wavelength
  plateMargin: 24,  // m of flat ground around a plate
  slopeK: 6,        // road cost multiplier per unit slope
  treeRate: 0.35,
  rockRate: 0.06,
  outposts: 4,      // mini outposts on the ground between the bases, ours and theirs by turns
  trunkR: 0.9,      // m
  rockR: 2.2,       // m
};
export const WORLD_KNOBS = [
  { key: 'size', label: 'world size (m)', group: 'world', min: 320, max: 1600, step: 40 },
  { key: 'r', label: 'poisson radius', group: 'world', min: 0.02, max: 0.08, step: 0.005 },
  { key: 'relaxIters', label: 'relax iterations', group: 'world', min: 0, max: 120, step: 5 },
  { key: 'amp', label: 'relief (m)', group: 'terrain', min: 0, max: 40, step: 1 },
  { key: 'freq1', label: 'wavelength (m)', group: 'terrain', min: 30, max: 300, step: 5 },
  { key: 'freq2', label: 'detail wavelength (m)', group: 'terrain', min: 8, max: 100, step: 2 },
  { key: 'plateMargin', label: 'flat margin (m)', group: 'terrain', min: 4, max: 80, step: 2 },
  { key: 'slopeK', label: 'road slope cost', group: 'road', min: 0, max: 30, step: 1 },
  { key: 'treeRate', label: 'tree rate', group: 'cover', min: 0, max: 1, step: 0.05 },
  { key: 'rockRate', label: 'rock rate', group: 'cover', min: 0, max: 0.5, step: 0.01 },
  { key: 'outposts', label: 'outposts', group: 'cover', min: 0, max: 8, step: 1 },
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
  return { plate, wM, hM, ox: cx - wM / 2, oz: cz - hM / 2, gates: null, sentries: null, facing: -1, hostile: false };
}

// the gate's outside point, three cells out along its side's normal, in world metres
export function gateOutside(p, gi) {
  const g = p.plate.gates[gi];
  const [cx, cz] = gateCentre(p.plate, g);
  const [dx, dz] = DIRS[g.side];
  return [p.ox + cx + dx * 3 * CELL_M, p.oz + cz + dz * 3 * CELL_M];
}

// --- the world ---------------------------------------------------------------
export function makeWorld(params, plateParams, allowed = undefined) {
  const tune = clampWorldParams(makeWorldParams(), params);
  const seed = Number(params.seed) || 0;
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const warnings = [];

  // plates first: the world must be big enough to hold them with ground
  // between, so a base that outgrows the world grows the world
  const pA = generatePlate(makePlateParams({ ...plateParams, seed }), allowed);
  const pB = generatePlate(makePlateParams({ ...plateParams, seed: seed + 1 }), allowed);
  const widest = Math.max(pA.w, pB.w) * CELL_M, deepest = Math.max(pA.h, pB.h) * CELL_M;
  const need = Math.max(widest * 2.6 + tune.plateMargin * 4, deepest * 1.8 + tune.plateMargin * 4);
  const S = Math.max(tune.size, Math.ceil(need / 40) * 40);
  if (S > tune.size) warnings.push(`world grown to ${S} m to fit the plates`);
  tune.size = S;
  const plates = [placePlate(pA, S * 0.25, S * 0.5), placePlate(pB, S * 0.75, S * 0.5)];
  // A is HOME: its gates open for the hull and its sentries hold fire. B is
  // the target: shut gates, live sentries — you breach it.
  plates[1].hostile = true;
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
      if (g.ring !== 'outer' && p.plate.inset > 0) return; // the road meets the perimeter
      const [cx, cz] = gateCentre(p.plate, g);
      const d = Math.hypot(p.ox + cx - ocx, p.oz + cz - ocz);
      if (d < bd) { bd = d; best = gi; }
    });
    p.facing = best;
  }

  // terrain
  const heightAt = makeHeightFn(plates, tune, seed);
  const mesh = generateMesh({ seed, r: tune.r, k: 30 });
  // RELAX TOWARD THE MESH'S OWN SCALE. The kernel's default target side
  // (0.06) is about three times these quads' edges; pulled toward squares
  // that big they fight and FOLD — 49 inverted and 200 concave quads at 40
  // iterations, every one a crease the hull sank into. Matched to the mean
  // edge and with the boundary pinned there are none.
  let sum = 0, n = 0;
  for (const q of mesh.quads) for (let i = 0; i < 4; i++) { const a = mesh.vertices[q[i]], b = mesh.vertices[q[(i + 1) % 4]]; sum += Math.hypot(a[0] - b[0], a[1] - b[1]); n++; }
  relax(mesh, { n_iters: tune.relaxIters, SIDE_LENGTH: sum / Math.max(1, n), pinned: mesh.boundary });
  mesh.vertices = mesh.vertices.map(([x, y]) => [x * S, y * S]);
  const world = {
    tune, seed, size: S, mesh, plates, heightAt, warnings,
    centroids: mesh.quads.map((q) => centroid(mesh, q)),
    adj: null, road: { quads: [], set: new Set(), points: [] }, trees: [], rocks: [], hash: new Map(),
    spawn: null, goal: null,
  };
  world.adj = quadAdjacency(mesh);
  world.heights = mesh.vertices.map(([x, z]) => heightAt(x, z));
  // quads by 16 m bucket of their bounding box, for exact point lookup
  world.qhash = new Map();
  mesh.quads.forEach((q, qi) => {
    const xs = q.map((i) => mesh.vertices[i][0]), zs = q.map((i) => mesh.vertices[i][1]);
    for (let bx = Math.floor(Math.min(...xs) / 16); bx <= Math.floor(Math.max(...xs) / 16); bx++) {
      for (let bz = Math.floor(Math.min(...zs) / 16); bz <= Math.floor(Math.max(...zs) / 16); bz++) {
        const k = `${bx},${bz}`;
        if (!world.qhash.has(k)) world.qhash.set(k, []);
        world.qhash.get(k).push(qi);
      }
    }
  });

  // road
  const [ax, az] = gateOutside(plates[0], plates[0].facing);
  const [bx, bz] = gateOutside(plates[1], plates[1].facing);
  const qa = quadNearest(world, ax, az), qb = quadNearest(world, bx, bz);
  const path = findRoad(world, qa, qb, tune);
  if (!path.length) warnings.push('no road between the plates');
  // the line includes both gate approaches, so the straight run out of a
  // gate is part of what cover keeps clear of
  world.road = { quads: path, set: new Set(path), points: [[ax, az], ...path.map((q) => world.centroids[q]), [bx, bz]] };

  // trees and rocks
  const bucket = (x, z) => `${Math.floor(x / 16)},${Math.floor(z / 16)}`;
  const put = (item) => { const k = bucket(item.x, item.z); if (!world.hash.has(k)) world.hash.set(k, []); world.hash.get(k).push(item); };
  world.outposts = [];
  // nothing stands within ROAD_CLEAR_M of the road's own line: a quad off
  // the road can still put a trunk at the road's edge, and the hull met one
  // 2.9 m ahead of its spawn
  const roadPts = world.road.points;
  const distToRoad = (x, z) => {
    let best = Infinity;
    for (let i = 1; i < roadPts.length; i++) {
      const [ax, az] = roadPts[i - 1], [bx, bz] = roadPts[i];
      const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
      best = Math.min(best, Math.hypot(x - (ax + vx * t), z - (az + vz * t)));
    }
    return best;
  };
  // THE OUTPOSTS: small working camps on the open ground, ours and theirs
  // by turns, well off the road and clear of the plates, far from each
  // other. A few crates, a barrel and a panel rack about a centre, the
  // props solid to the hull; a crew of their side works there. Ours are
  // STRANDED: the hull can pick them up (rescue.js).
  {
    const want = Math.round(tune.outposts || 0);
    const R = OUTPOST_R;
    const order = shuffled(rng, mesh.quads.map((_, qi) => qi));
    for (const qi of order) {
      if (world.outposts.length >= want) break;
      if (world.road.set.has(qi)) continue;
      const [cx, cz] = world.centroids[qi];
      if (cx < R + 20 || cz < R + 20 || cx > S - R - 20 || cz > S - R - 20) continue;
      let mask = 1;
      for (const p of plates) mask = Math.min(mask, smoothstep(0, tune.plateMargin, rectDist(cx, cz, p.ox, p.oz, p.ox + p.wM, p.oz + p.hM)));
      if (mask < 0.999) continue;
      if (distToRoad(cx, cz) < R + 16) continue;
      if (world.outposts.some((o) => Math.hypot(o.x - cx, o.z - cz) < 90)) continue;
      const side = world.outposts.length % 2 === 0 ? 'home' : 'hostile';
      // props on a wide ring so the crew's straight walks between them
      // cross the open middle rather than each other
      const props = [
        { id: 'cargo_crate', dx: 7.5, dz: -5.5, rot: Math.floor(rng() * 4), r: 1.3 },
        { id: 'cargo_crate', dx: 10.5, dz: -4.5, rot: Math.floor(rng() * 4), r: 1.3 },
        { id: 'fuel_barrel', dx: -8.0, dz: 6.0, rot: 0, r: 1.0 },
        { id: 'solar_panel_rack', dx: -3.5, dz: -9.5, rot: Math.floor(rng() * 4), r: 3.2 },
        { id: 'pallet_stack', dx: 8.5, dz: 7.5, rot: Math.floor(rng() * 4), r: 1.3 },
      ];
      const o = { x: cx, z: cz, r: R, side, props, areas: [] };
      for (const pr of props) put({ kind: 'prop', x: cx + pr.dx, z: cz + pr.dz, r: pr.r, outpost: o });
      // where the crew works: beside each prop, facing it, and the centre
      // the work spots sit on the INSIDE of each prop (toward the centre), so every walk crosses the clearing
      for (const pr of props) { const d = Math.hypot(pr.dx, pr.dz) || 1; const k = (d - pr.r - 1.6) / d; o.areas.push({ x: cx + pr.dx * k, z: cz + pr.dz * k, tag: pr.id, fx: cx + pr.dx, fz: cz + pr.dz }); }
      o.areas.push({ x: cx + 1.5, z: cz + 1.0, tag: 'camp', fx: cx - 3.5, fz: cz - 9.5 });
      world.outposts.push(o);
    }
    if (world.outposts.length < want) warnings.push(`only ${world.outposts.length} of ${want} outposts found room`);
  }
  mesh.quads.forEach((q, qi) => {
    if (world.road.set.has(qi)) return;
    const [cx, cz] = world.centroids[qi];
    if (world.outposts.some((o) => Math.hypot(o.x - cx, o.z - cz) < o.r + 8)) return; // a camp keeps its clearing
    let mask = 1;
    for (const p of plates) mask = Math.min(mask, smoothstep(0, tune.plateMargin, rectDist(cx, cz, p.ox, p.oz, p.ox + p.wM, p.oz + p.hM)));
    if (mask < 0.5) return;
    const h = heightAt(cx, cz);
    const hillFactor = Math.max(0.2, 1 - Math.max(0, h) / (tune.amp + 1e-6));
    const jitter = () => (rng() - 0.5) * 5;
    const x = cx + jitter(), z = cz + jitter();
    if (distToRoad(x, z) < ROAD_CLEAR_M) return; // the PLACED position, not the centroid
    if (rng() < tune.treeRate * hillFactor) { const t = { kind: 'tree', x, z, r: tune.trunkR, h: 7 + rng() * 5, q: qi }; world.trees.push(t); put(t); }
    else if (rng() < tune.rockRate) { const rk = { kind: 'rock', x, z, r: tune.rockR, h: 1.5 + rng() * 2, q: qi }; world.rocks.push(rk); put(rk); }
  });

  // spawn and goal
  const gA = plates[0].plate.gates[plates[0].facing];
  world.spawn = { x: ax, z: az, heading: yawOfSide[gA.side] };
  world.goal = { x: bx, z: bz };
  return world;
}

// A quad as two triangles that do not overlap. Twelve percent of the
// relaxed quads are concave, and splitting one along the wrong diagonal
// gives two triangles that cross — a fold in the ground the renderer draws
// and the lookup reads differently. The diagonal that touches the reflex
// corner is the one inside the quad; both triangles then have the same
// sign, and both are emitted counter-clockwise seen from above.
export function splitQuad(V, q) {
  const area2 = (a, b, c) => (V[b][0] - V[a][0]) * (V[c][1] - V[a][1]) - (V[b][1] - V[a][1]) * (V[c][0] - V[a][0]);
  const up = (t) => (area2(t[0], t[1], t[2]) < 0 ? t : [t[0], t[2], t[1]]);
  let t1 = [q[0], q[1], q[2]], t2 = [q[0], q[2], q[3]];
  if (Math.sign(area2(...t1)) !== Math.sign(area2(...t2))) { t1 = [q[1], q[2], q[3]]; t2 = [q[1], q[3], q[0]]; }
  return [up(t1), up(t2)];
}

// Height and normal OF THE RENDERED SURFACE at a point: the triangle of the
// quad under it, split the way world-tab.js splits it. The smooth function
// and the faceted mesh differ by up to a metre on concave ground, which is
// exactly a hull sinking into a slope, so anything that stands on the
// ground asks this rather than heightAt. Inside a plate the ground is the
// slab, flat at 0.
export function groundAt(world, x, z) {
  for (const p of world.plates) {
    if (x >= p.ox && x < p.ox + p.wM && z >= p.oz && z < p.oz + p.hM) return { y: 0, normal: [0, 1, 0] };
  }
  const candidates = world.qhash.get(`${Math.floor(x / 16)},${Math.floor(z / 16)}`) || [];
  const V = world.mesh.vertices, H = world.heights;
  for (const qi of candidates) {
    for (const [a, b, c] of splitQuad(V, world.mesh.quads[qi])) {
      const [ax, az] = V[a], [bx, bz] = V[b], [cx, cz] = V[c];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-9) continue;
      const l0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const l1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      const l2 = 1 - l0 - l1;
      if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
      const y = l0 * H[a] + l1 * H[b] + l2 * H[c];
      // plane normal, facing up
      const ux = bx - ax, uy = H[b] - H[a], uz = bz - az, vx = cx - ax, vy = H[c] - H[a], vz = cz - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const l = Math.hypot(nx, ny, nz) || 1;
      return { y, normal: [nx / l, ny / l, nz / l] };
    }
  }
  return { y: world.heightAt(x, z), normal: terrainNormal(world.heightAt, x, z) };
}

// The ground's unit normal from the height function, by central differences.
export function terrainNormal(heightAt, x, z, d = 1.5) {
  const dx = (heightAt(x + d, z) - heightAt(x - d, z)) / (2 * d);
  const dz = (heightAt(x, z + d) - heightAt(x, z - d)) / (2 * d);
  const l = Math.hypot(dx, 1, dz);
  return [-dx / l, 1 / l, -dz / l];
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

export const OUTPOST_R = 14;
// the ground an outpost's crew may walk: its clearing, off the props and off the plates
export const outpostGround = (world, o) => ({ walkableAt: (x, z) => Math.hypot(x - o.x, z - o.z) < o.r + 6 && !plateOf(world, x, z) && !worldBlocked(world, x, z) });

export const worldBuildingAt = (world, x, z) => { const p = plateOf(world, x, z); return p ? buildingAt(p.plate, x - p.ox, z - p.oz) : false; };

// sight for a sentry that belongs to plate p: buildings of that plate only
export const worldLosFor = (p) => (ax, az, bx, bz) => losClear(p.plate, ax - p.ox, az - p.oz, bx - p.ox, bz - p.oz);

export const worldSentries = (world) => world.plates.flatMap((p) => p.sentries);
export const worldGates = (world) => world.plates.flatMap((p) => p.gates);
export const KIND_WALL = KIND.WALL;
