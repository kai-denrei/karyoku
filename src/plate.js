// plate.js — THE PLATE GENERATOR. Seed and knobs in, a base out: a sealed
// wall ring with gates, a road spine, functional blocks packed with
// buildings, sentry sockets with limited arcs. Pure: no DOM, no three.js,
// Node-tested in test/plate.mjs. plate-tab.js draws what this returns and
// never decides where anything goes.
//
// CONVENTIONS, ONCE, HERE. One cell is 4 m. N is +z and E is +x, because
// that is what the base kit's own sockets say (WALL_N sits at +Z). `rot` is
// quarter turns CLOCKWISE seen from above, N -> E -> S -> W, which in
// three.js is `rotation.y = rot * PI/2`. Yaw is compass degrees, 0 = N.
// Plate width and depth are EVEN, because roads are 2 x 2 pieces laid on
// even coordinates and a gate's road port has to land on one.
import { mulberry32 } from './rng.js?v=cbb65c38';
import { makeParams, clampParams, formatKnobs, knobProblems } from './knobs.js?v=cbb65c38';
import { specById } from './catalog-spec.js?v=cbb65c38';

export const CELL_M = 4;

export const KIND = { FOUNDATION: 0, WALL: 1, GATE: 2, ROAD: 3, BUILDING: 4, PROP: 5, SENTRY: 6 };
export const ASCII_OF_KIND = ['.', '#', 'G', '=', 'B', 'o', 'S'];

export const PLATE_TUNE = {
  seed: 1,
  w: 20,          // cells, including the ring; even
  h: 16,          // cells, including the ring; even
  gates: 2,
  density: 0.7,   // fraction of a block the packer tries to fill
  arc: 110,       // sentry traverse, degrees
  tier: 1,        // sentry tier
};

export const PLATE_KNOBS = [
  { key: 'seed', label: 'seed', group: 'plate', min: 0, max: 999999, step: 1 },
  { key: 'w', label: 'width (cells)', group: 'plate', min: 12, max: 40, step: 2 },
  { key: 'h', label: 'depth (cells)', group: 'plate', min: 12, max: 40, step: 2 },
  { key: 'gates', label: 'gates', group: 'plate', min: 1, max: 3, step: 1 },
  { key: 'density', label: 'build density', group: 'packing', min: 0.3, max: 1.0, step: 0.05 },
  { key: 'arc', label: 'sentry arc (deg)', group: 'sentries', min: 60, max: 180, step: 5 },
  { key: 'tier', label: 'sentry tier', group: 'sentries', min: 1, max: 3, step: 1 },
];
export const makePlateParams = (src = PLATE_TUNE) => makeParams(PLATE_KNOBS, src);
export const clampPlateParams = (p, src) => clampParams(PLATE_KNOBS, p, src);
export const formatPlateTune = (p) => formatKnobs('PLATE_TUNE', PLATE_KNOBS, p);
export const plateKnobProblems = () => knobProblems(PLATE_KNOBS, PLATE_TUNE);

// --- directions ------------------------------------------------------------
export const SIDES = ['N', 'E', 'S', 'W'];
export const DIRS = { N: [0, 1], E: [1, 0], S: [0, -1], W: [-1, 0] };
export const rotSide = (side, rot) => SIDES[(SIDES.indexOf(side) + rot) & 3];
export const yawOfSide = { N: 0, E: 90, S: 180, W: 270 };
export const dirOfYaw = (deg) => [Math.sin(deg * Math.PI / 180), Math.cos(deg * Math.PI / 180)];
export const wrapDeg = (a) => ((a + 180) % 360 + 360) % 360 - 180;

// --- state -----------------------------------------------------------------
const idx = (s, x, z) => z * s.w + x;
const inside = (s, x, z) => x >= 0 && z >= 0 && x < s.w && z < s.h;

function makeState(p) {
  // even, always: the knob table's step is 2, but a URL can hand us 13
  const w = p.w & ~1, h = p.h & ~1;
  return {
    w, h, seed: p.seed, params: { ...p, w, h },
    cells: new Uint8Array(w * h),
    owner: new Int16Array(w * h).fill(-1),
    pieces: [], roads: { nodes: [], edges: [], blocks: new Map() }, gates: [], sentries: [], blocks: [],
    warnings: [],
    ascii() { return asciiOf(this); },
  };
}

// Claim a rectangle for a piece. No fit check here — callers decide what
// may be overwritten (the ring is laid around gates, roads are laid on
// foundation, buildings only on free cells via `rectFree`).
function place(s, id, x, z, pw, ph, rot, kind, extra = {}) {
  const pi = s.pieces.length;
  s.pieces.push({ id, x, z, pw, ph, rot, state: 0, kind, zone: null, offset: [0, 0], ...extra });
  for (let dz = 0; dz < ph; dz++) {
    for (let dx = 0; dx < pw; dx++) {
      const i = idx(s, x + dx, z + dz);
      s.cells[i] = kind;
      s.owner[i] = pi;
    }
  }
  return pi;
}

function asciiOf(s) {
  const rows = [];
  for (let z = s.h - 1; z >= 0; z--) {
    let r = '';
    for (let x = 0; x < s.w; x++) r += ASCII_OF_KIND[s.cells[idx(s, x, z)]];
    rows.push(r);
  }
  return rows.join('\n');
}

// --- step 1: ring and gates -------------------------------------------------
// A gate is 3 cells along its side and 2 deep: the ring row and the row
// inside it. The kit's gate model puts its WALL line through its own
// centre, so the model is drawn half a cell OUTWARD of those two rows —
// that is `offset`, and the viewer applies it. Gate centres stay at least
// five cells from a corner so the flank sentry sockets (step 5) clear the
// corner sockets.
function chooseGates(s, rng) {
  const sides = [...SIDES];
  for (let i = sides.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [sides[i], sides[j]] = [sides[j], sides[i]];
  }
  const out = [];
  for (const side of sides.slice(0, s.params.gates)) {
    const len = (side === 'N' || side === 'S') ? s.w : s.h;
    const lo = 5, hi = len - 6;
    if (hi < lo) { s.warnings.push(`gate on ${side}: side too short`); continue; }
    const at = lo + Math.floor(rng() * (hi - lo + 1));
    out.push({ side, at });
  }
  return out;
}

function gateRect(s, g) {
  // origin, dims, rot, outward offset in cells
  switch (g.side) {
    case 'N': return { x: g.at - 1, z: s.h - 2, pw: 3, ph: 2, rot: 0, offset: [0, 0.5] };
    case 'S': return { x: g.at - 1, z: 0, pw: 3, ph: 2, rot: 2, offset: [0, -0.5] };
    case 'E': return { x: s.w - 2, z: g.at - 1, pw: 2, ph: 3, rot: 1, offset: [0.5, 0] };
    default: return { x: 0, z: g.at - 1, pw: 2, ph: 3, rot: 3, offset: [-0.5, 0] };
  }
}

function stepRing(s, rng) {
  const { w, h } = s;
  const gates = chooseGates(s, rng);
  const gateCells = new Set();
  for (const g of gates) {
    const r = gateRect(s, g);
    for (let dz = 0; dz < r.ph; dz++) for (let dx = 0; dx < r.pw; dx++) gateCells.add(idx(s, r.x + dx, r.z + dz));
  }
  // corners: SW is the kit's authored pose (ports E and N); clockwise from there
  place(s, 'wall_corner', 0, 0, 1, 1, 0, KIND.WALL);
  place(s, 'wall_corner', 0, h - 1, 1, 1, 1, KIND.WALL);
  place(s, 'wall_corner', w - 1, h - 1, 1, 1, 2, KIND.WALL);
  place(s, 'wall_corner', w - 1, 0, 1, 1, 3, KIND.WALL);
  for (let x = 1; x < w - 1; x++) {
    if (!gateCells.has(idx(s, x, 0))) place(s, 'wall_standard', x, 0, 1, 1, 0, KIND.WALL);
    if (!gateCells.has(idx(s, x, h - 1))) place(s, 'wall_standard', x, h - 1, 1, 1, 0, KIND.WALL);
  }
  for (let z = 1; z < h - 1; z++) {
    if (!gateCells.has(idx(s, 0, z))) place(s, 'wall_standard', 0, z, 1, 1, 1, KIND.WALL);
    if (!gateCells.has(idx(s, w - 1, z))) place(s, 'wall_standard', w - 1, z, 1, 1, 1, KIND.WALL);
  }
  for (const g of gates) {
    const r = gateRect(s, g);
    const pieceIndex = place(s, 'gate_vehicle', r.x, r.z, r.pw, r.ph, r.rot, KIND.GATE, { offset: r.offset });
    // the road port: the 2 x 2 road block just inside the gate, on even coordinates
    const even = g.at & ~1;
    const port = (g.side === 'N') ? { bx: even / 2, bz: (h - 4) / 2 }
      : (g.side === 'S') ? { bx: even / 2, bz: 1 }
      : (g.side === 'E') ? { bx: (w - 4) / 2, bz: even / 2 }
      : { bx: 1, bz: even / 2 };
    s.gates.push({ side: g.side, at: g.at, x: r.x, z: r.z, rot: r.rot, pieceIndex, port });
  }
}

// --- step 2: roads -----------------------------------------------------------
// Roads are 2 x 2 pieces on even coordinates: block (bx, bz) covers cells
// 2bx..2bx+1, 2bz..2bz+1. A SPINE crosses the plate centre, then each gate's
// corridor runs straight from its port to the spine. Laying stops at the
// first block that is not free — a sentry socket, a gate — and that is what
// road_end is for. We do not draw roads; we lay blocks and then READ the
// piece off each block's neighbour mask.
export const roadBlockKey = (bx, bz) => bz * 1000 + bx;

const ROAD_PORTS = {
  road_end: ['N'],
  road_straight: ['N', 'S'],
  road_corner: ['N', 'E'],
  road_t: ['N', 'E', 'S'],
  road_cross: ['N', 'E', 'S', 'W'],
};

// The rotation that turns a piece's authored ports into the wanted set.
function fitPorts(canon, want) {
  for (let rot = 0; rot < 4; rot++) {
    const got = canon.map((sd) => rotSide(sd, rot));
    if (got.length === want.size && got.every((sd) => want.has(sd))) return rot;
  }
  return -1;
}

function blockFree(s, bx, bz) {
  const x = 2 * bx, z = 2 * bz;
  if (!inside(s, x, z) || !inside(s, x + 1, z + 1)) return false;
  if (x < 1 || z < 1 || x + 1 > s.w - 2 || z + 1 > s.h - 2) return false; // never on the ring
  for (let dz = 0; dz < 2; dz++) {
    for (let dx = 0; dx < 2; dx++) {
      const i = idx(s, x + dx, z + dz);
      if (s.cells[i] !== KIND.FOUNDATION && s.cells[i] !== KIND.ROAD) return false;
      if (s.owner[i] !== -1) return false;
    }
  }
  return true;
}

function layBlock(s, laid, bx, bz) {
  if (!blockFree(s, bx, bz)) return false;
  for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) s.cells[idx(s, 2 * bx + dx, 2 * bz + dz)] = KIND.ROAD;
  laid.set(roadBlockKey(bx, bz), { bx, bz, pieceIndex: -1 });
  return true;
}

// Lay from (bx, bz) stepping (dx, dz) until the stop predicate holds or a
// block is not free.
function layRun(s, laid, bx, bz, dx, dz, stopAt) {
  let x = bx, z = bz;
  for (;;) {
    if (!layBlock(s, laid, x, z)) return false;
    if (stopAt(x, z)) return true;
    x += dx; z += dz;
  }
}

function stepRoads(s) {
  const { w, h } = s;
  const bxMax = (w - 4) / 2, bzMax = (h - 4) / 2;
  const bxS = Math.min(bxMax - 1, Math.max(2, Math.round((w - 2) / 4)));
  const bzS = Math.min(bzMax - 1, Math.max(2, Math.round((h - 2) / 4)));
  const laid = new Map();
  // spine: from the centre outward in all four directions
  layBlock(s, laid, bxS, bzS);
  layRun(s, laid, bxS, bzS + 1, 0, 1, (x, z) => z === bzMax);
  layRun(s, laid, bxS, bzS - 1, 0, -1, (x, z) => z === 1);
  layRun(s, laid, bxS + 1, bzS, 1, 0, (x, z) => x === bxMax);
  layRun(s, laid, bxS - 1, bzS, -1, 0, (x, z) => x === 1);
  // gate corridors: from the port straight to the spine line
  for (const g of s.gates) {
    const { bx, bz } = g.port;
    let ok;
    if (g.side === 'N') ok = layRun(s, laid, bx, bz, 0, -1, (x, z) => z === bzS);
    else if (g.side === 'S') ok = layRun(s, laid, bx, bz, 0, 1, (x, z) => z === bzS);
    else if (g.side === 'E') ok = layRun(s, laid, bx, bz, -1, 0, (x, z) => x === bxS);
    else ok = layRun(s, laid, bx, bz, 1, 0, (x, z) => x === bxS);
    if (!ok) s.warnings.push(`gate ${g.side}@${g.at}: corridor blocked before the spine`);
  }
  // read the pieces off the neighbour masks
  const edges = [];
  for (const b of laid.values()) {
    const want = new Set();
    for (const side of SIDES) {
      const [dx, dz] = DIRS[side];
      const nk = roadBlockKey(b.bx + dx, b.bz + dz);
      if (laid.has(nk)) {
        want.add(side);
        if (nk > roadBlockKey(b.bx, b.bz)) edges.push([roadBlockKey(b.bx, b.bz), nk]);
      }
    }
    let id;
    if (want.size === 0) { id = 'road_end'; want.add('N'); s.warnings.push(`isolated road block at ${b.bx},${b.bz}`); }
    else if (want.size === 1) id = 'road_end';
    else if (want.size === 2) id = (want.has('N') && want.has('S')) || (want.has('E') && want.has('W')) ? 'road_straight' : 'road_corner';
    else if (want.size === 3) id = 'road_t';
    else id = 'road_cross';
    const rot = fitPorts(ROAD_PORTS[id], want);
    b.pieceIndex = place(s, id, 2 * b.bx, 2 * b.bz, 2, 2, rot < 0 ? 0 : rot, KIND.ROAD);
  }
  s.roads = { nodes: [...laid.keys()], edges, blocks: laid };
}

export function roadsConnected(s) {
  const { nodes, edges } = s.roads;
  if (nodes.length === 0) return false;
  const adj = new Map(nodes.map((n) => [n, []]));
  for (const [a, b] of edges) { adj.get(a).push(b); adj.get(b).push(a); }
  const seen = new Set([nodes[0]]);
  const stack = [nodes[0]];
  while (stack.length) {
    const n = stack.pop();
    for (const m of adj.get(n)) if (!seen.has(m)) { seen.add(m); stack.push(m); }
  }
  return seen.size === nodes.length;
}

// --- entry -----------------------------------------------------------------
export function generatePlate(params) {
  const p = clampPlateParams(makePlateParams(), params);
  const s = makeState(p);
  const rng = mulberry32(p.seed);
  stepRing(s, rng);
  stepRoads(s);
  return s;
}
