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
import { mulberry32 } from './rng.js?v=979b8ccb';
import { makeParams, clampParams, formatKnobs, knobProblems } from './knobs.js?v=979b8ccb';
import { specById } from './catalog-spec.js?v=979b8ccb';

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
function chooseGates(s, rng) {
  const sides = [...SIDES];
  for (let i = sides.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [sides[i], sides[j]] = [sides[j], sides[i]];
  }
  const out = [];
  for (const side of sides.slice(0, s.params.gates)) {
    const len = (side === 'N' || side === 'S') ? s.w : s.h;
    // six cells from a corner keeps the flank sockets clear of the corner
    // sockets; a 12-cell side cannot afford that, and there the flank that
    // would overlap a corner socket is simply not placed (sentrySockets).
    let lo = 6, hi = len - 7;
    if (hi < lo) { lo = 5; hi = len - 6; }
    if (hi < lo) { s.warnings.push(`gate on ${side}: side too short`); continue; }
    const at = lo + Math.floor(rng() * (hi - lo + 1));
    out.push({ side, at });
  }
  return out;
}

function gateRect(s, g) {
  // origin, dims, rot, outward offset in cells
  switch (g.side) {
    case 'N': return { x: g.at - 1, z: 0, pw: 3, ph: 2, rot: 0, offset: [0, -0.5] };
    case 'S': return { x: g.at - 1, z: s.h - 2, pw: 3, ph: 2, rot: 2, offset: [0, 0.5] };
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
  // corners: the kit's authored pose has legs toward +x and +z, which here
  // is E and S — the NW corner. Clockwise from there: NE, SE, SW.
  place(s, 'wall_corner', 0, 0, 1, 1, 0, KIND.WALL);
  place(s, 'wall_corner', w - 1, 0, 1, 1, 1, KIND.WALL);
  place(s, 'wall_corner', w - 1, h - 1, 1, 1, 2, KIND.WALL);
  place(s, 'wall_corner', 0, h - 1, 1, 1, 3, KIND.WALL);
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
    const port = (g.side === 'N') ? { bx: even / 2, bz: 1 }
      : (g.side === 'S') ? { bx: even / 2, bz: (h - 4) / 2 }
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
  const { w, h } = s;
  const out = [
    { x: 1, z: 1, yawDeg: 315, where: 'corner' },          // NW
    { x: w - 3, z: 1, yawDeg: 45, where: 'corner' },       // NE
    { x: w - 3, z: h - 3, yawDeg: 135, where: 'corner' },  // SE
    { x: 1, z: h - 3, yawDeg: 225, where: 'corner' },      // SW
  ];
  for (const g of s.gates) {
    if (g.side === 'N') out.push({ x: g.at - 3, z: 1, yawDeg: 0, where: 'flank' }, { x: g.at + 2, z: 1, yawDeg: 0, where: 'flank' });
    else if (g.side === 'S') out.push({ x: g.at - 3, z: h - 3, yawDeg: 180, where: 'flank' }, { x: g.at + 2, z: h - 3, yawDeg: 180, where: 'flank' });
    else if (g.side === 'E') out.push({ x: w - 3, z: g.at - 3, yawDeg: 90, where: 'flank' }, { x: w - 3, z: g.at + 2, yawDeg: 90, where: 'flank' });
    else out.push({ x: 1, z: g.at - 3, yawDeg: 270, where: 'flank' }, { x: 1, z: g.at + 2, yawDeg: 270, where: 'flank' });
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

export const ZONES = {
  command:   { buildings: ['command_hq', 'command_operations', 'command_uplink', 'command_server', 'command_comms'],
               props: ['command_beacon', 'prop_terminal', 'prop_lamp'] },
  logistics: { buildings: ['logistics_warehouse', 'logistics_loading_dock', 'logistics_crane', 'ground_hardstand', 'logistics_container'],
               props: ['crate_general', 'crate_parts', 'logistics_pallet', 'crate_secure'] },
  defense:   { buildings: ['defense_bunker', 'defense_watchtower', 'defense_radar', 'defense_interceptor'],
               props: ['defense_searchlight', 'field_barrier', 'field_sensor'] },
  utility:   { buildings: ['utility_reactor', 'utility_solar', 'utility_water', 'utility_battery', 'utility_waste', 'utility_substation', 'utility_tank', 'utility_cooling'],
               props: ['utility_junction', 'utility_conduit', 'crate_energy'] },
  air:       { buildings: ['air_launchpad', 'air_hangar', 'air_control', 'air_fuel_service', 'air_drone_pad'],
               props: ['field_signal', 'prop_lamp', 'prop_sign'] },
  personnel: { buildings: ['personnel_mess', 'personnel_barracks', 'personnel_infirmary', 'personnel_recreation', 'personnel_shelter', 'personnel_hygiene', 'personnel_triage'],
               props: ['prop_seating', 'prop_planter', 'prop_lamp'] },
  industry:  { buildings: ['industry_garage', 'industry_fabricator', 'industry_workshop', 'industry_recycler', 'industry_test_cell', 'industry_drone_bench', 'industry_service_lift'],
               props: ['industry_tool_rack', 'crate_parts', 'logistics_pallet'] },
};
// Buildings a block may hold more than once. Everything else is one per block.
const REPEATABLE = new Set(['personnel_barracks', 'logistics_container', 'logistics_warehouse', 'ground_hardstand',
  'defense_bunker', 'utility_battery', 'industry_workshop', 'utility_solar']);
const PROP_RATE = 0.12;

function floodBlocks(s) {
  const seen = new Uint8Array(s.w * s.h);
  const blocks = [];
  for (let z0 = 1; z0 < s.h - 1; z0++) {
    for (let x0 = 1; x0 < s.w - 1; x0++) {
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
        touchesRing: xa === 1 || za === 1 || x1 === s.w - 2 || z1 === s.h - 2, gateSides: new Set() });
    }
  }
  return blocks;
}

// A block "touches a gate" when one of its cells neighbours a road cell of
// that gate's corridor — the run from the port up to the first junction.
function markGateAdjacency(s, blocks) {
  for (const g of s.gates) {
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
  for (const g of s.gates) { const b = take((x) => x.gateSides.has(g.side)); if (b) b.zone = 'logistics'; }
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
  const orients = shuffled(rng, [[px, pz, [0, 2]], [pz, px, [1, 3]]]);
  const spots = [];
  for (let z = block.z0; z <= block.z1; z++) for (let x = block.x0; x <= block.x1; x++) spots.push([x, z]);
  const order = shuffled(rng, spots);
  for (const [pw, ph, rots] of orients) {
    for (const [x, z] of order) {
      if (x + pw - 1 > block.x1 || z + ph - 1 > block.z1) continue;
      if (!rectFree(s, block, x, z, pw, ph)) continue;
      const sides = roadSides(s, x, z, pw, ph);
      if (sides.size === 0) continue;
      const rot = rots.find((r) => sides.has(rotSide('S', r)));
      return { x, z, pw, ph, rot: rot === undefined ? rots[0] : rot };
    }
  }
  return null;
}

function packBlock(s, rng, block) {
  const zone = ZONES[block.zone];
  const list = zone.buildings.map(specById).sort((a, b) => b.plot[0] * b.plot[1] - a.plot[0] * a.plot[1]);
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
    const id = zone.props[Math.floor(rng() * zone.props.length)];
    place(s, id, x, z, 1, 1, Math.floor(rng() * 4), KIND.PROP, { zone: block.zone });
  }
}

function stepPacking(s, rng) {
  for (const block of s.blocks) packBlock(s, rng, block);
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
export function generatePlate(params) {
  const p = clampPlateParams(makePlateParams(), params);
  const s = makeState(p);
  const rng = mulberry32(p.seed);
  stepRing(s, rng);
  reserveSentries(s);
  stepRoads(s);
  stepBlocks(s, rng);
  stepPacking(s, rng);
  stepSentries(s, rng);
  return s;
}
