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

// --- entry -----------------------------------------------------------------
export function generatePlate(params) {
  const p = clampPlateParams(makePlateParams(), params);
  const s = makeState(p);
  const rng = mulberry32(p.seed);
  stepRing(s, rng);
  return s;
}
