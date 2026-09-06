// plate.js — THE PLATE GENERATOR. Seed and knobs in, a base out: a sealed
// wall ring with gates, a road spine, functional blocks packed with
// buildings, sentry sockets with limited arcs. Pure: no DOM, no three.js,
// Node-tested in test/plate.mjs. plate-tab.js draws what this returns and
// never decides where anything goes.
//
// CONVENTIONS, ONCE, HERE. One cell is 4 m. N is -z and E is +x — the
// three.js habit, and the one under which a camera looking straight down
// with north up puts east on the RIGHT, so the 3D view and the ASCII map
// agree. (The base kit names its +Z socket "N"; that is a socket label,
// and the corner and gate rotations below absorb it.) `rot` is quarter
// turns CLOCKWISE seen from above, N -> E -> S -> W, which in three.js is
// `rotation.y = -rot * PI/2`. Yaw is compass degrees, 0 = N, 90 = E.
// Plate width and depth are EVEN, because roads are 2 x 2 pieces laid on
// even coordinates and a gate's road port has to land on one.
import { mulberry32 } from './rng.js?v=e280e775';
import { makeParams, clampParams, formatKnobs, knobProblems } from './knobs.js?v=e280e775';
import { specById } from './catalog-spec.js?v=e280e775';

export const CELL_M = 4;

export const KIND = { FOUNDATION: 0, WALL: 1, GATE: 2, ROAD: 3, BUILDING: 4, PROP: 5, SENTRY: 6 };
export const ASCII_OF_KIND = ['.', '#', 'G', '=', 'B', 'o', 'S'];

export const PLATE_TUNE = {
  seed: 1,
  w: 40,          // cells, including the ring; even — a 7.8 m hull needs room
  h: 32,          // cells, including the ring; even
  gates: 2,
  moat: 4,        // cells of open ground between the outer perimeter and the base wall; 0 = one ring
  density: 0.4,   // fraction of a block the packer tries to fill; the rest is manoeuvring room
  gap: 2,         // cells kept clear around every building inside its block: a lane the hull fits
  arc: 110,       // sentry traverse, degrees
  tier: 1,        // sentry tier
};

export const PLATE_KNOBS = [
  { key: 'seed', label: 'seed', group: 'plate', min: 0, max: 999999, step: 1 },
  { key: 'w', label: 'width (cells)', group: 'plate', min: 12, max: 120, step: 2 },
  { key: 'h', label: 'depth (cells)', group: 'plate', min: 12, max: 120, step: 2 },
  { key: 'gates', label: 'gates', group: 'plate', min: 1, max: 3, step: 1 },
  { key: 'moat', label: 'perimeter band (cells)', group: 'plate', min: 0, max: 8, step: 1 },
  { key: 'density', label: 'build density', group: 'packing', min: 0.1, max: 1.0, step: 0.05 },
  { key: 'gap', label: 'lane around buildings (cells)', group: 'packing', min: 0, max: 4, step: 1 },
  { key: 'arc', label: 'sentry arc (deg)', group: 'sentries', min: 60, max: 180, step: 5 },
  { key: 'tier', label: 'sentry tier', group: 'sentries', min: 1, max: 3, step: 1 },
];
export const makePlateParams = (src = PLATE_TUNE) => makeParams(PLATE_KNOBS, src);
export const clampPlateParams = (p, src) => clampParams(PLATE_KNOBS, p, src);
export const formatPlateTune = (p) => formatKnobs('PLATE_TUNE', PLATE_KNOBS, p);
export const plateKnobProblems = () => knobProblems(PLATE_KNOBS, PLATE_TUNE);

// --- directions ------------------------------------------------------------
export const SIDES = ['N', 'E', 'S', 'W'];
export const DIRS = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
export const rotSide = (side, rot) => SIDES[(SIDES.indexOf(side) + rot) & 3];
export const yawOfSide = { N: 0, E: 90, S: 180, W: 270 };
export const dirOfYaw = (deg) => [Math.sin(deg * Math.PI / 180), -Math.cos(deg * Math.PI / 180)];
export const wrapDeg = (a) => ((a + 180) % 360 + 360) % 360 - 180;

// --- state -----------------------------------------------------------------
const idx = (s, x, z) => z * s.w + x;
const inside = (s, x, z) => x >= 0 && z >= 0 && x < s.w && z < s.h;

function makeState(p) {
  // even, always: the knob table's step is 2, but a URL can hand us 13
  const w = p.w & ~1, h = p.h & ~1;
  // THE TWO RINGS. Firepower's bases had a perimeter wall, empty ground,
  // and then the base proper. `inset` is where the inner ring stands; it
  // is even so the road blocks inside it stay on even coordinates, and at
  // least 4 so the outer corner sockets fit in the band. 0 means one ring.
  let inset = p.moat === 0 ? 0 : Math.max(4, 2 * Math.ceil((p.moat + 1) / 2));
  // ...and only if the base inside still has 12 cells to work with; a small
  // plate keeps its single ring rather than a ring around nothing
  const room = 2 * Math.floor((Math.min(w, h) - 12) / 4);
  if (inset > room) inset = room >= 4 ? room : 0;
  return {
    w, h, inset, seed: p.seed, params: { ...p, w, h },
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
  for (let z = 0; z < s.h; z++) {
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
// The inner ring's rectangle (or the outer one's, at inset 0).
export const innerRect = (s) => ({ x0: s.inset, z0: s.inset, x1: s.w - 1 - s.inset, z1: s.h - 1 - s.inset });
const outerRect = (s) => ({ x0: 0, z0: 0, x1: s.w - 1, z1: s.h - 1 });
// road-block bounds inside the inner ring: 2bx >= x0+1 and 2bx+1 <= x1-1
export const blockBounds = (s) => ({ bxMin: s.inset / 2 + 1, bxMax: (s.w - 4 - s.inset) / 2, bzMin: s.inset / 2 + 1, bzMax: (s.h - 4 - s.inset) / 2 });

function chooseGates(s, rng) {
  const sides = [...SIDES];
  for (let i = sides.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [sides[i], sides[j]] = [sides[j], sides[i]];
  }
  const out = [];
  for (const side of sides.slice(0, s.params.gates)) {
    const len = (side === 'N' || side === 'S') ? s.w : s.h;
    // six cells from the INNER ring's corner keeps the flank sockets clear
    // of the corner sockets; a 12-cell side cannot afford that, and there
    // the flank that would overlap a corner socket is simply not placed.
    let lo = s.inset + 6, hi = len - 7 - s.inset;
    if (hi < lo) { lo = s.inset + 5; hi = len - 6 - s.inset; }
    if (hi < lo) { s.warnings.push(`gate on ${side}: side too short`); continue; }
    const at = lo + Math.floor(rng() * (hi - lo + 1));
    out.push({ side, at });
  }
  return out;
}

// A gate's rectangle on a ring: origin, dims, rot, outward offset in cells.
function gateRect(s, g, r) {
  switch (g.side) {
    case 'N': return { x: g.at - 1, z: r.z0, pw: 3, ph: 2, rot: 0, offset: [0, -0.5] };
    case 'S': return { x: g.at - 1, z: r.z1 - 1, pw: 3, ph: 2, rot: 2, offset: [0, 0.5] };
    case 'E': return { x: r.x1 - 1, z: g.at - 1, pw: 2, ph: 3, rot: 1, offset: [0.5, 0] };
    default: return { x: r.x0, z: g.at - 1, pw: 2, ph: 3, rot: 3, offset: [-0.5, 0] };
  }
}

// One ring of wall on a rectangle, with holes for its gates, then the
// gates. Corners: the kit's authored pose has legs toward +x and +z, which
// here is E and S — the NW corner. Clockwise from there: NE, SE, SW.
function layRing(s, r, gates, ring) {
  const gateCells = new Set();
  for (const g of gates) {
    const gr = gateRect(s, g, r);
    for (let dz = 0; dz < gr.ph; dz++) for (let dx = 0; dx < gr.pw; dx++) gateCells.add(idx(s, gr.x + dx, gr.z + dz));
  }
  place(s, 'wall_corner', r.x0, r.z0, 1, 1, 0, KIND.WALL);
  place(s, 'wall_corner', r.x1, r.z0, 1, 1, 1, KIND.WALL);
  place(s, 'wall_corner', r.x1, r.z1, 1, 1, 2, KIND.WALL);
  place(s, 'wall_corner', r.x0, r.z1, 1, 1, 3, KIND.WALL);
  for (let x = r.x0 + 1; x < r.x1; x++) {
    if (!gateCells.has(idx(s, x, r.z0))) place(s, 'wall_standard', x, r.z0, 1, 1, 0, KIND.WALL);
    if (!gateCells.has(idx(s, x, r.z1))) place(s, 'wall_standard', x, r.z1, 1, 1, 0, KIND.WALL);
  }
  for (let z = r.z0 + 1; z < r.z1; z++) {
    if (!gateCells.has(idx(s, r.x0, z))) place(s, 'wall_standard', r.x0, z, 1, 1, 1, KIND.WALL);
    if (!gateCells.has(idx(s, r.x1, z))) place(s, 'wall_standard', r.x1, z, 1, 1, 1, KIND.WALL);
  }
  const B = blockBounds(s);
  for (const g of gates) {
    const gr = gateRect(s, g, r);
    const pieceIndex = place(s, 'gate_vehicle', gr.x, gr.z, gr.pw, gr.ph, gr.rot, KIND.GATE, { offset: gr.offset });
    // the road port: the 2 x 2 road block just inside an INNER gate, on
    // even coordinates; an outer gate has none, the band road serves it
    const even = g.at & ~1;
    const port = ring !== 'inner' ? null
      : (g.side === 'N') ? { bx: even / 2, bz: B.bzMin }
      : (g.side === 'S') ? { bx: even / 2, bz: B.bzMax }
      : (g.side === 'E') ? { bx: B.bxMax, bz: even / 2 }
      : { bx: B.bxMin, bz: even / 2 };
    s.gates.push({ side: g.side, at: g.at, ring, x: gr.x, z: gr.z, rot: gr.rot, pieceIndex, port });
  }
}

function stepRing(s, rng) {
  const gates = chooseGates(s, rng);
  if (s.inset > 0) {
    layRing(s, outerRect(s), gates, 'outer');
    layRing(s, innerRect(s), gates, 'inner');
  } else {
    layRing(s, outerRect(s), gates, 'inner');
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

function blockFree(s, bx, bz, bandOk = false) {
  const x = 2 * bx, z = 2 * bz;
  if (!inside(s, x, z) || !inside(s, x + 1, z + 1)) return false;
  if (x < 1 || z < 1 || x + 1 > s.w - 2 || z + 1 > s.h - 2) return false; // never on the outer ring
  if (!bandOk && (x < s.inset + 1 || z < s.inset + 1 || x + 1 > s.w - 2 - s.inset || z + 1 > s.h - 2 - s.inset)) return false; // nor on the inner one
  for (let dz = 0; dz < 2; dz++) {
    for (let dx = 0; dx < 2; dx++) {
      const i = idx(s, x + dx, z + dz);
      if (s.cells[i] !== KIND.FOUNDATION && s.cells[i] !== KIND.ROAD) return false;
      if (s.owner[i] !== -1) return false;
    }
  }
  return true;
}

function layBlock(s, laid, bx, bz, bandOk = false) {
  if (!blockFree(s, bx, bz, bandOk)) return false;
  for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) s.cells[idx(s, 2 * bx + dx, 2 * bz + dz)] = KIND.ROAD;
  laid.set(roadBlockKey(bx, bz), { bx, bz, pieceIndex: -1 });
  return true;
}

// Lay from (bx, bz) stepping (dx, dz) until the stop predicate holds or a
// block is not free.
function layRun(s, laid, bx, bz, dx, dz, stopAt, bandOk = false) {
  let x = bx, z = bz;
  for (;;) {
    if (!layBlock(s, laid, x, z, bandOk)) return false;
    if (stopAt(x, z)) return true;
    x += dx; z += dz;
  }
}

function stepRoads(s) {
  const { w, h } = s;
  const { bxMin, bxMax, bzMin, bzMax } = blockBounds(s);
  const bxS = Math.min(bxMax - 1, Math.max(bxMin + 1, Math.round((w - 2) / 4)));
  const bzS = Math.min(bzMax - 1, Math.max(bzMin + 1, Math.round((h - 2) / 4)));
  const laid = new Map();
  // spine: from the centre outward in all four directions
  layBlock(s, laid, bxS, bzS);
  layRun(s, laid, bxS, bzS + 1, 0, 1, (x, z) => z === bzMax);
  layRun(s, laid, bxS, bzS - 1, 0, -1, (x, z) => z === bzMin);
  layRun(s, laid, bxS + 1, bzS, 1, 0, (x, z) => x === bxMax);
  layRun(s, laid, bxS - 1, bzS, -1, 0, (x, z) => x === bxMin);
  // the band: a road from each outer gate across the open ground to its
  // inner gate, laid with the band's own bounds
  for (const g of s.gates) {
    if (g.ring !== 'outer') continue;
    const even = g.at & ~1;
    const last = s.inset / 2 - 1;
    if (last < 1) continue;
    let ok;
    if (g.side === 'N') ok = layRun(s, laid, even / 2, 1, 0, 1, (x, z) => z === last, true);
    else if (g.side === 'S') ok = layRun(s, laid, even / 2, (h - 4) / 2, 0, -1, (x, z) => z === (h - 2) / 2 - last, true);
    else if (g.side === 'E') ok = layRun(s, laid, (w - 4) / 2, even / 2, -1, 0, (x, z) => x === (w - 2) / 2 - last, true);
    else ok = layRun(s, laid, 1, even / 2, 1, 0, (x, z) => x === last, true);
    if (!ok) s.warnings.push(`gate ${g.side}@${g.at}: band road blocked`);
  }
  // gate corridors: from each inner gate's port straight to the spine line
  for (const g of s.gates) {
    if (!g.port) continue;
    const { bx, bz } = g.port;
    let ok;
    if (g.side === 'N') ok = layRun(s, laid, bx, bz, 0, 1, (x, z) => z === bzS);
    else if (g.side === 'S') ok = layRun(s, laid, bx, bz, 0, -1, (x, z) => z === bzS);
    else if (g.side === 'E') ok = layRun(s, laid, bx, bz, -1, 0, (x, z) => x === bxS);
    else ok = layRun(s, laid, bx, bz, 1, 0, (x, z) => x === bxS);
    if (!ok) s.warnings.push(`gate ${g.side}@${g.at}: corridor blocked before the spine`);
  }
  // read the pieces off the neighbour masks
  const edges = [], ends = [];
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
    if (want.size === 1) ends.push({ b, open: rotSide([...want][0], 2) });
  }
  // an inner gate JOINS its band road to its port: two gate rows apart, the
  // gate itself is the link, so the graph carries an edge across it
  for (const g of s.gates) {
    if (!g.port) continue;
    const { bx, bz } = g.port;
    const [ox, oz] = g.side === 'N' ? [0, -2] : g.side === 'S' ? [0, 2] : g.side === 'E' ? [2, 0] : [-2, 0];
    const a = roadBlockKey(bx, bz), b = roadBlockKey(bx + ox, bz + oz);
    if (laid.has(a) && laid.has(b)) edges.push([a, b]);
  }
  s.roads = { nodes: [...laid.keys()], edges, blocks: laid };
  extendEnds(s, ends);
}

// A road that ends one cell short of the wall leaves a gap the flood fill
// walks through, welding two blocks into one. Continue every road end
// along its axis with 1 x 1 pedestrian corridor cells until something
// solid — the ring, a socket, a gate — so a block is bounded by
// circulation on every side.
function extendEnds(s, ends) {
  for (const { b, open } of ends) {
    const [dx, dz] = DIRS[open];
    const rot = (open === 'N' || open === 'S') ? 0 : 1;
    // the two cells of the block's open edge
    const edge = open === 'N' ? [[2 * b.bx, 2 * b.bz], [2 * b.bx + 1, 2 * b.bz]]
      : open === 'S' ? [[2 * b.bx, 2 * b.bz + 1], [2 * b.bx + 1, 2 * b.bz + 1]]
      : open === 'E' ? [[2 * b.bx + 1, 2 * b.bz], [2 * b.bx + 1, 2 * b.bz + 1]]
      : [[2 * b.bx, 2 * b.bz], [2 * b.bx, 2 * b.bz + 1]];
    for (const [ex, ez] of edge) {
      for (let k = 1; ; k++) {
        const x = ex + dx * k, z = ez + dz * k;
        if (!inside(s, x, z)) break;
        const i = idx(s, x, z);
        if (s.cells[i] !== KIND.FOUNDATION || s.owner[i] !== -1) break;
        place(s, 'walk_straight', x, z, 1, 1, rot, KIND.ROAD);
      }
    }
  }
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

// --- step 3: blocks and zones ----------------------------------------------
// Sentry sockets are decided by the ring alone, so they are RESERVED here,
// before anything else can claim their cells, and only cast as pieces in
// step 5. Then every free cell floods into a region; the region's bounding
// box is the block, and the packer stays inside the region's own cell set
// so an L-shaped region cannot leak into a neighbour's box.
export function sentrySockets(s) {
  const { w, h, inset: n } = s;
  const out = [];
  // the outer perimeter's corners, in the band
  if (n > 0) out.push(
    { x: 1, z: 1, yawDeg: 315, where: 'outer' },
    { x: w - 3, z: 1, yawDeg: 45, where: 'outer' },
    { x: w - 3, z: h - 3, yawDeg: 135, where: 'outer' },
    { x: 1, z: h - 3, yawDeg: 225, where: 'outer' });
  // the base wall's corners and gate flanks, inside it
  out.push(
    { x: n + 1, z: n + 1, yawDeg: 315, where: 'corner' },          // NW
    { x: w - 3 - n, z: n + 1, yawDeg: 45, where: 'corner' },       // NE
    { x: w - 3 - n, z: h - 3 - n, yawDeg: 135, where: 'corner' },  // SE
    { x: n + 1, z: h - 3 - n, yawDeg: 225, where: 'corner' });     // SW
  for (const g of s.gates) {
    if (g.ring !== 'inner') continue;
    if (g.side === 'N') out.push({ x: g.at - 3, z: n + 1, yawDeg: 0, where: 'flank' }, { x: g.at + 2, z: n + 1, yawDeg: 0, where: 'flank' });
    else if (g.side === 'S') out.push({ x: g.at - 3, z: h - 3 - n, yawDeg: 180, where: 'flank' }, { x: g.at + 2, z: h - 3 - n, yawDeg: 180, where: 'flank' });
    else if (g.side === 'E') out.push({ x: w - 3 - n, z: g.at - 3, yawDeg: 90, where: 'flank' }, { x: w - 3 - n, z: g.at + 2, yawDeg: 90, where: 'flank' });
    else out.push({ x: n + 1, z: g.at - 3, yawDeg: 270, where: 'flank' }, { x: n + 1, z: g.at + 2, yawDeg: 270, where: 'flank' });
  }
  // a flank that would overlap an earlier socket (a corner's, on a short
  // side) is dropped rather than doubled up
  const kept = [];
  for (const sk of out) {
    const clash = kept.some((k) => Math.abs(k.x - sk.x) < 2 && Math.abs(k.z - sk.z) < 2);
    if (!clash) kept.push(sk);
  }
  return kept;
}

function reserveSentries(s) {
  for (const sk of sentrySockets(s)) {
    for (let dz = 0; dz < 2; dz++) {
      for (let dx = 0; dx < 2; dx++) {
        const i = idx(s, sk.x + dx, sk.z + dz);
        if (s.cells[i] === KIND.FOUNDATION && s.owner[i] === -1) s.cells[i] = KIND.SENTRY;
        else s.warnings.push(`sentry socket at ${sk.x},${sk.z} collides with ${ASCII_OF_KIND[s.cells[i]]}`);
      }
    }
  }
}

// WHAT HAS A MODEL. The generator places nothing it cannot draw (operator,
// 2026-09-07: "remove the placeholder black boxes"), so every zone list is
// modelled ids only. This set is the default; the tabs hand in the live
// catalog's own list, and test/catalog.mjs asserts this set is inside it.
export const MODELLED = new Set([
  // the research-outpost kit
  'command_operations', 'personnel_barracks', 'personnel_infirmary', 'research_xenobiology', 'utility_reactor',
  'command_comms', 'air_launchpad', 'industry_garage', 'logistics_container', 'research_specimen_crate', 'road_straight', 'utility_conduit',
  // house casts and NASA stand-ins
  'command_hq', 'command_uplink', 'personnel_recreation', 'personnel_shelter', 'logistics_crane', 'air_drone_pad', 'defense_radar', 'field_signal',
  // the base kit
  'wall_standard', 'wall_corner', 'gate_vehicle', 'foundation_flat',
]);
// the sentry socket has no model of its own — its plinth is the placeholder
// the scene keeps — and is placed regardless of what is modelled
export const SOCKET_ID = 'defense_sentry_socket';
export const ZONES = {
  command:   { buildings: ['command_hq', 'command_operations', 'command_uplink', 'command_comms'],
               props: ['field_signal', 'utility_conduit'] },
  logistics: { buildings: ['logistics_crane', 'logistics_container'],
               props: ['research_specimen_crate'] },
  defense:   { buildings: ['defense_radar', 'command_comms'],
               props: ['field_signal'] },
  utility:   { buildings: ['utility_reactor', 'logistics_container'],
               props: ['utility_conduit'] },
  air:       { buildings: ['air_launchpad', 'air_drone_pad', 'command_comms'],
               props: ['field_signal'] },
  personnel: { buildings: ['personnel_barracks', 'research_xenobiology', 'personnel_recreation', 'personnel_shelter'],
               props: ['research_specimen_crate', 'utility_conduit'] },
  industry:  { buildings: ['industry_garage', 'research_xenobiology', 'logistics_crane', 'logistics_container'],
               props: ['research_specimen_crate', 'utility_conduit'] },
};
// THE LANDMARK: the Isolation Infirmary takes a prime block of its own before
// any zone packs — the largest block that is not the command block — and
// stands once per plate, with a cross on its roof (plate-scene.js).
export const LANDMARK = 'personnel_infirmary';
// Buildings a block may hold more than once. Everything else is one per block.
const REPEATABLE = new Set(['personnel_barracks', 'logistics_container', 'command_comms', 'personnel_shelter']);
// Containers pack in ROWS, touching, and need no road of their own: the
// warehouse feeling is a yard of containers, not a hall.
const NO_LANE = new Set(['logistics_container']);
const NO_ROAD = new Set(['logistics_container']);
const PROP_RATE = 0.12;

function floodBlocks(s) {
  const seen = new Uint8Array(s.w * s.h);
  const blocks = [];
  const R = innerRect(s);
  for (let z0 = R.z0 + 1; z0 < R.z1; z0++) {
    for (let x0 = R.x0 + 1; x0 < R.x1; x0++) {
      const i0 = idx(s, x0, z0);
      if (seen[i0] || s.cells[i0] !== KIND.FOUNDATION || s.owner[i0] !== -1) continue;
      const cells = [], stack = [[x0, z0]];
      seen[i0] = 1;
      let x1 = x0, z1 = z0, xa = x0, za = z0;
      while (stack.length) {
        const [x, z] = stack.pop();
        cells.push([x, z]);
        xa = Math.min(xa, x); za = Math.min(za, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z);
        for (const side of SIDES) {
          const nx = x + DIRS[side][0], nz = z + DIRS[side][1];
          if (!inside(s, nx, nz)) continue;
          const ni = idx(s, nx, nz);
          if (seen[ni]) continue;
          if (s.cells[ni] !== KIND.FOUNDATION || s.owner[ni] !== -1) continue;
          seen[ni] = 1; stack.push([nx, nz]);
        }
      }
      blocks.push({ x0: xa, z0: za, x1, z1, cells, cellSet: new Set(cells.map(([x, z]) => idx(s, x, z))), zone: null,
        touchesRing: xa === R.x0 + 1 || za === R.z0 + 1 || x1 === R.x1 - 1 || z1 === R.z1 - 1, gateSides: new Set() });
    }
  }
  return blocks;
}

// A block "touches a gate" when one of its cells neighbours a road cell of
// that gate's corridor — the run from the port up to the first junction.
function markGateAdjacency(s, blocks) {
  for (const g of s.gates) {
    if (!g.port) continue;
    const corridor = new Set();
    const { bx, bz } = g.port;
    const [dx, dz] = g.side === 'N' ? [0, 1] : g.side === 'S' ? [0, -1] : g.side === 'E' ? [-1, 0] : [1, 0];
    for (let x = bx, z = bz; s.roads.blocks.has(roadBlockKey(x, z)); x += dx, z += dz) {
      for (let cz = 0; cz < 2; cz++) for (let cx = 0; cx < 2; cx++) corridor.add(idx(s, 2 * x + cx, 2 * z + cz));
      const b = s.roads.blocks.get(roadBlockKey(x, z));
      const id = s.pieces[b.pieceIndex].id;
      if (id === 'road_cross' || id === 'road_t') break;
    }
    for (const b of blocks) {
      if (b.cells.some(([x, z]) => SIDES.some((sd) => {
        const nx = x + DIRS[sd][0], nz = z + DIRS[sd][1];
        return inside(s, nx, nz) && corridor.has(idx(s, nx, nz));
      }))) b.gateSides.add(g.side);
    }
  }
}

function assignZones(s, rng, blocks) {
  const area = (b) => b.cells.length;
  const cx = s.w / 2, cz = s.h / 2;
  const dist = (b) => Math.hypot((b.x0 + b.x1) / 2 + 0.5 - cx, (b.z0 + b.z1) / 2 + 0.5 - cz);
  const left = [...blocks].sort((a, b) => area(b) - area(a));
  const take = (pred) => { const i = left.findIndex(pred); return i < 0 ? null : left.splice(i, 1)[0]; };
  // command: the block nearest the centre
  if (left.length) {
    const cmd = left.reduce((best, b) => (dist(b) < dist(best) ? b : best), left[0]);
    cmd.zone = 'command';
    left.splice(left.indexOf(cmd), 1);
  }
  // logistics: the largest block beside each gate corridor
  for (const g of s.gates) { if (!g.port) continue; const b = take((x) => x.gateSides.has(g.side)); if (b) b.zone = 'logistics'; }
  // air: the largest remaining block if a pad fits, else personnel
  const big = take(() => true);
  if (big) big.zone = (big.x1 - big.x0 + 1 >= 8 && big.z1 - big.z0 + 1 >= 8) ? 'air' : 'personnel';
  // ring-touching: defense or utility by seed; the rest: personnel or industry by seed
  for (const b of left) {
    if (b.touchesRing) b.zone = rng() < 0.5 ? 'defense' : 'utility';
    else b.zone = rng() < 0.5 ? 'personnel' : 'industry';
  }
}

function stepBlocks(s, rng) {
  const blocks = floodBlocks(s);
  markGateAdjacency(s, blocks);
  assignZones(s, rng, blocks);
  s.blocks = blocks;
}

// --- step 4: packing ----------------------------------------------------------
function rectFree(s, block, x, z, pw, ph) {
  for (let dz = 0; dz < ph; dz++) {
    for (let dx = 0; dx < pw; dx++) {
      if (!inside(s, x + dx, z + dz)) return false;
      const i = idx(s, x + dx, z + dz);
      if (!block.cellSet.has(i)) return false;
      if (s.cells[i] !== KIND.FOUNDATION || s.owner[i] !== -1) return false;
    }
  }
  return true;
}

// The lane: `gap` cells around a rect must hold no other building or prop
// of this block. Cells outside the block (roads, the ring) do not count —
// a building may stand against a road, that is the point of it.
function laneClear(s, block, x, z, pw, ph, gap) {
  if (!gap) return true;
  for (let dz = -gap; dz < ph + gap; dz++) {
    for (let dx = -gap; dx < pw + gap; dx++) {
      if (dx >= 0 && dx < pw && dz >= 0 && dz < ph) continue;
      const cx = x + dx, cz = z + dz;
      if (!inside(s, cx, cz)) continue;
      const i = idx(s, cx, cz);
      if (!block.cellSet.has(i)) continue;
      if (s.owner[i] !== -1) return false;
    }
  }
  return true;
}

// Which sides of a rect have a road cell directly beyond them.
function roadSides(s, x, z, pw, ph) {
  const out = new Set();
  for (let dx = 0; dx < pw; dx++) {
    if (inside(s, x + dx, z - 1) && s.cells[idx(s, x + dx, z - 1)] === KIND.ROAD) out.add('N');
    if (inside(s, x + dx, z + ph) && s.cells[idx(s, x + dx, z + ph)] === KIND.ROAD) out.add('S');
  }
  for (let dz = 0; dz < ph; dz++) {
    if (inside(s, x + pw, z + dz) && s.cells[idx(s, x + pw, z + dz)] === KIND.ROAD) out.add('E');
    if (inside(s, x - 1, z + dz) && s.cells[idx(s, x - 1, z + dz)] === KIND.ROAD) out.add('W');
  }
  return out;
}

function shuffled(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// The entrance is the authored S face (rot 0). Unswapped dims allow rot 0
// (entrance S) or 2 (entrance N); swapped dims allow rot 1 (W) or 3 (E).
function findSpot(s, rng, block, def) {
  const [px, pz] = def.plot;
  let orients = shuffled(rng, [[px, pz, [0, 2]], [pz, px, [1, 3]]]);
  // a row packer keeps the orientation its block already has, so the rows stay rows
  if (NO_LANE.has(def.id)) {
    const first = s.pieces.find((pc) => pc.id === def.id && pc.zone === block.zone && block.cellSet.has(idx(s, pc.x, pc.z)));
    if (first) orients = [...orients.filter((o) => o[0] === first.pw && o[1] === first.ph), ...orients.filter((o) => !(o[0] === first.pw && o[1] === first.ph))];
  }
  const spots = [];
  for (let z = block.z0; z <= block.z1; z++) for (let x = block.x0; x <= block.x1; x++) spots.push([x, z]);
  const order = shuffled(rng, spots);
  const gap = NO_LANE.has(def.id) ? 0 : s.params.gap;
  for (const [pw, ph, rots] of orients) {
    // a row-packer goes BESIDE its own kind first, same orientation, so
    // containers line up into a yard rather than scatter
    const beside = [];
    if (NO_LANE.has(def.id)) {
      for (const pc of s.pieces) {
        if (pc.id !== def.id || pc.zone !== block.zone || pc.pw !== pw || pc.ph !== ph || !block.cellSet.has(idx(s, pc.x, pc.z))) continue;
        beside.push([pc.x + pw, pc.z], [pc.x - pw, pc.z], [pc.x, pc.z + ph], [pc.x, pc.z - ph]);
      }
    }
    for (const [x, z] of [...beside, ...order]) {
      if (x < block.x0 || z < block.z0 || x + pw - 1 > block.x1 || z + ph - 1 > block.z1) continue;
      if (!rectFree(s, block, x, z, pw, ph)) continue;
      if (!laneClear(s, block, x, z, pw, ph, gap)) continue;
      const sides = roadSides(s, x, z, pw, ph);
      if (sides.size === 0 && !NO_ROAD.has(def.id)) continue;
      const rot = rots.find((r) => sides.has(rotSide('S', r)));
      return { x, z, pw, ph, rot: rot === undefined ? rots[0] : rot };
    }
  }
  return null;
}

function packBlock(s, rng, block) {
  const zone = ZONES[block.zone];
  // the zone's biggest building anchors the block; the rest come in a
  // seeded order, so a plate is not the same three of anything every time
  const sorted = zone.buildings.filter((id) => s.allowed.has(id)).map(specById).sort((a, b) => b.plot[0] * b.plot[1] - a.plot[0] * a.plot[1]);
  if (!sorted.length) return;
  const list = [sorted[0], ...shuffled(rng, sorted.slice(1))];
  const target = s.params.density * block.cells.length;
  const used = new Map();
  let filled = 0, placedAny = true;
  while (filled < target && placedAny) {
    placedAny = false;
    for (const def of list) {
      if (filled >= target) break;
      if (used.get(def.id) && !REPEATABLE.has(def.id)) continue;
      const spot = findSpot(s, rng, block, def);
      if (!spot) continue;
      place(s, def.id, spot.x, spot.z, spot.pw, spot.ph, spot.rot, KIND.BUILDING, { zone: block.zone });
      used.set(def.id, (used.get(def.id) || 0) + 1);
      filled += spot.pw * spot.ph;
      placedAny = true;
    }
  }
  for (const [x, z] of block.cells) {
    const i = idx(s, x, z);
    if (s.cells[i] !== KIND.FOUNDATION || s.owner[i] !== -1) continue;
    if (rng() >= PROP_RATE) continue;
    const props = zone.props.filter((id) => s.allowed.has(id));
    if (!props.length) break;
    const id = props[Math.floor(rng() * props.length)];
    place(s, id, x, z, 1, 1, Math.floor(rng() * 4), KIND.PROP, { zone: block.zone });
  }
}

// The landmark first: the infirmary into the largest non-command block.
function stepLandmark(s, rng) {
  if (!s.allowed.has(LANDMARK)) return;
  const def = specById(LANDMARK);
  const blocks = s.blocks.filter((b) => b.zone !== 'command').sort((a, b) => b.cells.length - a.cells.length);
  for (const block of blocks.length ? blocks : s.blocks) {
    const spot = findSpot(s, rng, block, def);
    if (!spot) continue;
    place(s, LANDMARK, spot.x, spot.z, spot.pw, spot.ph, spot.rot, KIND.BUILDING, { zone: block.zone, landmark: true });
    return;
  }
  // a small plate has no room for a landmark, and that is not a fault
  if ((s.w - 2 * s.inset) * (s.h - 2 * s.inset) >= 400) s.warnings.push('no room for the infirmary');
}

function stepPacking(s, rng) {
  stepLandmark(s, rng);
  for (const block of s.blocks) packBlock(s, rng, block);
  stepBand(s, rng);
}

// --- the band: containers as dressing ------------------------------------------
// Firepower's outer yard was not empty: crates and containers stood about
// in it, and you drove around them. Containers here are the movable solids
// of drive.js — they are placed as pieces so the scene draws them, and the
// drive frees their cells and pushes them about. One cell clear of roads,
// gates and sockets so nothing is boxed in at birth.
export const BAND_PROP = 'logistics_container';
function stepBand(s, rng) {
  if (s.inset === 0) return;
  const R = innerRect(s);
  const inBand = (x, z) => x > 0 && z > 0 && x < s.w - 1 && z < s.h - 1 && (x < R.x0 || z < R.z0 || x > R.x1 || z > R.z1);
  if (!s.allowed.has(BAND_PROP)) return;
  const spec = specById(BAND_PROP);
  const want = Math.round((s.w + s.h) / 8);
  const spots = [];
  for (let z = 1; z < s.h - 1; z++) for (let x = 1; x < s.w - 1; x++) if (inBand(x, z)) spots.push([x, z]);
  const order = shuffled(rng, spots);
  let placed = 0;
  for (const [x, z] of order) {
    if (placed >= want) break;
    const swap = rng() < 0.5;
    const pw = swap ? spec.plot[1] : spec.plot[0], ph = swap ? spec.plot[0] : spec.plot[1];
    let ok = true;
    for (let dz = -1; dz <= ph && ok; dz++) {
      for (let dx = -1; dx <= pw && ok; dx++) {
        const cx = x + dx, cz = z + dz;
        if (!inside(s, cx, cz)) { ok = false; break; }
        const body = dx >= 0 && dx < pw && dz >= 0 && dz < ph;
        const k = s.cells[idx(s, cx, cz)];
        if (body) { if (!inBand(cx, cz) || k !== KIND.FOUNDATION || s.owner[idx(s, cx, cz)] !== -1) ok = false; }
        else if (k === KIND.ROAD || k === KIND.GATE || k === KIND.SENTRY || k === KIND.BUILDING) ok = false;
      }
    }
    if (!ok) continue;
    place(s, BAND_PROP, x, z, pw, ph, swap ? 1 : 0, KIND.BUILDING, { zone: 'band' });
    placed++;
  }
}

// --- step 5: sentries ---------------------------------------------------------
// The workshop's gun families; the Relay is a mast and never sits in a
// socket. A sentry is NOT an aimbot: it bears on a cell only inside its
// arc, and the arc is narrower than the geometry on purpose, so a plate
// always has approaches nothing can see. `blindCells` is that promise as a
// function, and the suite asserts it on every default seed.
export const GUN_FAMILIES = ['needle', 'rotor', 'kiln', 'quiver', 'lancer', 'railgun', 'howitzer', 'mortar', 'plasma', 'heptapod_a6'];

function stepSentries(s, rng) {
  for (const sk of sentrySockets(s)) {
    const ok = [0, 1].every((dz) => [0, 1].every((dx) => {
      const i = idx(s, sk.x + dx, sk.z + dz);
      return s.cells[i] === KIND.SENTRY && s.owner[i] === -1;
    }));
    if (!ok) { s.warnings.push(`sentry socket at ${sk.x},${sk.z} lost its reservation`); continue; }
    const family = GUN_FAMILIES[Math.floor(rng() * GUN_FAMILIES.length)];
    const pieceIndex = place(s, 'defense_sentry_socket', sk.x, sk.z, 2, 2, 0, KIND.SENTRY, { zone: 'defense' });
    s.sentries.push({ x: sk.x, z: sk.z, family, tier: s.params.tier, yawDeg: sk.yawDeg, arcDeg: s.params.arc, pieceIndex, where: sk.where });
  }
}

// Can this sentry bear on the point (cx, cz), in cell units? The socket's
// centre is one cell in from its origin on both axes.
export function sentryBears(st, cx, cz) {
  const dx = cx - (st.x + 1), dz = cz - (st.z + 1);
  const bearing = Math.atan2(dx, -dz) * 180 / Math.PI;
  return Math.abs(wrapDeg(bearing - st.yawDeg)) <= st.arcDeg / 2;
}

export function ringCoverage(s) {
  const out = [];
  const push = (x, z) => out.push({ x, z, covered: s.sentries.some((st) => sentryBears(st, x + 0.5, z + 0.5)) });
  for (let x = 0; x < s.w; x++) { push(x, 0); push(x, s.h - 1); }
  for (let z = 1; z < s.h - 1; z++) { push(0, z); push(s.w - 1, z); }
  return out;
}

export const blindCells = (s) => ringCoverage(s).filter((c) => !c.covered).map((c) => [c.x, c.z]);

// --- entry -----------------------------------------------------------------
// `allowed` is the set of ids that have a model; nothing outside it is placed.
export function generatePlate(params, allowed = MODELLED) {
  const p = clampPlateParams(makePlateParams(), params);
  const s = makeState(p);
  s.allowed = allowed;
  const rng = mulberry32(p.seed);
  stepRing(s, rng);
  reserveSentries(s);
  stepRoads(s);
  stepBlocks(s, rng);
  stepPacking(s, rng);
  stepSentries(s, rng);
  return s;
}
