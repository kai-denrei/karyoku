import { generatePlate, makePlateParams, plateKnobProblems, KIND, rotSide, dirOfYaw, PLATE_TUNE, roadsConnected, roadBlockKey, ZONES, sentrySockets, blindCells, sentryBears, GUN_FAMILIES, MODELLED, LANDMARK, YARD_IDS, POWER } from '../src/plate.js';
import { specById } from '../src/catalog-spec.js';
import { check, near, done } from './check.mjs';

check('knob table is sound', plateKnobProblems().length === 0, plateKnobProblems().join('; '));
{
  const t0 = Date.now();
  const big = generatePlate(makePlateParams({ ...PLATE_TUNE, seed: 3, w: 120, h: 120, gates: 3 }));
  const ms = Date.now() - t0;
  check('a 120 x 120 plate generates in under 4 s', ms < 4000, `${ms} ms`);
  check('...and holds many buildings', big.pieces.filter((pc) => pc.kind === KIND.BUILDING).length > 30);
}
check('rotSide: N rotated once is E', rotSide('N', 1) === 'E');
check('rotSide: W rotated once wraps to N', rotSide('W', 1) === 'N');
check('dirOfYaw(0) is -z (north)', near(dirOfYaw(0)[0], 0) && near(dirOfYaw(0)[1], -1));
check('dirOfYaw(90) is +x', near(dirOfYaw(90)[0], 1) && near(dirOfYaw(90)[1], 0));

const SEEDS = Array.from({ length: 50 }, (_, i) => i + 1);
const SIZES = [[12, 12], [60, 12], [12, 60], [60, 60], [120, 120]];

const ringCells = (p) => {
  const out = [];
  for (let x = 0; x < p.w; x++) out.push([x, 0], [x, p.h - 1]);
  for (let z = 1; z < p.h - 1; z++) out.push([0, z], [p.w - 1, z]);
  return out;
};
const cellAt = (p, x, z) => p.cells[z * p.w + x];

function checkRing(p, label) {
  check(`${label}: sealed ring`, ringCells(p).every(([x, z]) => cellAt(p, x, z) === KIND.WALL || cellAt(p, x, z) === KIND.GATE));
  const outer = p.gates.filter((g) => g.ring === 'outer'), inner = p.gates.filter((g) => g.ring === 'inner');
  check(`${label}: gate count`, inner.length === p.params.gates, `got ${inner.length}`);
  check(`${label}: gates on distinct sides`, new Set(inner.map((g) => g.side)).size === inner.length);
  check(`${label}: two rings when there is a band`, p.inset === 0 ? outer.length === 0 : outer.length === inner.length);
  check(`${label}: outer and inner gates line up`, outer.every((o) => inner.some((i) => i.side === o.side && i.at === o.at)));
  check(`${label}: inner ring sealed`, (() => {
    const n = p.inset; if (n === 0) return true;
    for (let x = n; x <= p.w - 1 - n; x++) for (const z of [n, p.h - 1 - n]) { const k = cellAt(p, x, z); if (k !== KIND.WALL && k !== KIND.GATE) return false; }
    for (let z = n; z <= p.h - 1 - n; z++) for (const x of [n, p.w - 1 - n]) { const k = cellAt(p, x, z); if (k !== KIND.WALL && k !== KIND.GATE) return false; }
    return true;
  })());
  check(`${label}: the band holds only yard stock`, (() => {
    const n = p.inset; if (n === 0) return true;
    for (let z = 1; z < p.h - 1; z++) for (let x = 1; x < p.w - 1; x++) {
      const inBand = x < n || z < n || x > p.w - 1 - n || z > p.h - 1 - n;
      if (!inBand) continue;
      const k = cellAt(p, x, z);
      if (k === KIND.PROP) return false;
      if (k === KIND.BUILDING && !YARD_IDS.includes(p.pieces[p.owner[z * p.w + x]].id)) return false;
    }
    return true;
  })());
  check(`${label}: no gate within two cells of a corner`, p.gates.every((g) => g.at >= 3 && g.at <= ((g.side === 'N' || g.side === 'S') ? p.w : p.h) - 4));
  check(`${label}: four corners are wall pieces`, [[0, 0], [p.w - 1, 0], [0, p.h - 1], [p.w - 1, p.h - 1]]
    .every(([x, z]) => p.pieces[p.owner[z * p.w + x]].id === 'wall_corner'));
  const a = p.ascii().split('\n');
  check(`${label}: ascii is h rows of w chars`, a.length === p.h && a.every((r) => r.length === p.w));
  check(`${label}: ascii top row is the N side`, a[0].includes('#'));
}

for (const seed of SEEDS) {
  const p = generatePlate(makePlateParams({ ...PLATE_TUNE, seed }));
  const q = generatePlate(makePlateParams({ ...PLATE_TUNE, seed }));
  check(`seed ${seed}: deterministic`, p.ascii() === q.ascii());
  checkRing(p, `seed ${seed}`);
}
for (const [w, h] of SIZES) {
  for (const gates of [1, 3]) {
    const p = generatePlate(makePlateParams({ ...PLATE_TUNE, seed: 3, w, h, gates }));
    checkRing(p, `${w}x${h} g${gates}`);
  }
}
function checkRoads(p, label) {
  check(`${label}: road graph connected`, roadsConnected(p));
  check(`${label}: every inner gate port is a road block`, p.gates.filter((g) => g.port).every((g) => p.roads.blocks.has(roadBlockKey(g.port.bx, g.port.bz))));
  check(`${label}: every outer gate has road at its inner row`, p.gates.filter((g) => g.ring === 'outer').every((g) => {
    const [x, z] = g.side === 'N' ? [g.at, 2] : g.side === 'S' ? [g.at, p.h - 3] : g.side === 'E' ? [p.w - 3, g.at] : [2, g.at];
    return cellAt(p, x, z) === KIND.ROAD;
  }));
  check(`${label}: road cells are all owned by road pieces`, (() => {
    for (let i = 0; i < p.cells.length; i++) {
      if (p.cells[i] !== KIND.ROAD) continue;
      const pc = p.pieces[p.owner[i]];
      if (!pc || !(pc.id.startsWith('road_') || pc.id.startsWith('walk_'))) return false;
    }
    return true;
  })());
  check(`${label}: road pieces are 2x2 on even cells`, p.pieces.filter((pc) => pc.kind === KIND.ROAD && pc.id.startsWith('road_'))
    .every((pc) => pc.pw === 2 && pc.ph === 2 && pc.x % 2 === 0 && pc.z % 2 === 0));
  check(`${label}: has a junction`, p.pieces.some((pc) => pc.id === 'road_cross' || pc.id === 'road_t'));
}
for (const seed of SEEDS) checkRoads(generatePlate(makePlateParams({ ...PLATE_TUNE, seed })), `seed ${seed}`);
for (const [w, h] of SIZES) checkRoads(generatePlate(makePlateParams({ ...PLATE_TUNE, seed: 3, w, h, gates: 3 })), `${w}x${h}`);
const ROAD_TOUCH = (p, pc) => {
  for (let dz = -1; dz <= pc.ph; dz++) {
    for (let dx = -1; dx <= pc.pw; dx++) {
      const x = pc.x + dx, z = pc.z + dz;
      const edge = dz === -1 || dz === pc.ph || dx === -1 || dx === pc.pw;
      if (!edge) continue;
      if (x < 0 || z < 0 || x >= p.w || z >= p.h) continue;
      if (p.cells[z * p.w + x] === KIND.ROAD) return true;
    }
  }
  return false;
};
function checkPacking(p, label, minBuildings = 3) {
  const buildings = p.pieces.filter((pc) => pc.kind === KIND.BUILDING);
  check(`${label}: has buildings`, buildings.length >= minBuildings, `got ${buildings.length}`);
  // yard stock needs no road; the power compound's pieces stand behind their own wall, its gate meets the road
  check(`${label}: every building touches a road`, buildings.filter((pc) => pc.zone !== 'band' && !YARD_IDS.includes(pc.id) && pc.id !== POWER.id && pc.id !== POWER.rack).every((pc) => ROAD_TOUCH(p, pc)));
  check(`${label}: the power compound stands, walled, gated, at the centre (or the plate is too narrow)`, (() => {
    if (!p.power) return Math.min(p.w, p.h) - 2 * p.inset < 14 || p.warnings.some((w) => /power compound/.test(w));
    const st = p.pieces[p.power.pieceIndex];
    if (!st || st.id !== POWER.id || !st.power) return false;
    const r = p.power.rect;
    if (p.pieces.filter((pc) => pc.id === POWER.rack).length !== 3) return false;
    // the station and racks inside the ring, the ring all wall or gate
    const inside = (pc) => pc.x > r.x0 && pc.z > r.z0 && pc.x + pc.pw - 1 < r.x1 && pc.z + pc.ph - 1 < r.z1;
    if (!inside(st) || !p.pieces.filter((pc) => pc.id === POWER.rack).every(inside)) return false;
    for (let x = r.x0; x <= r.x1; x++) for (const z of [r.z0, r.z1]) { const k = cellAt(p, x, z); if (k !== KIND.WALL && k !== KIND.GATE) return false; }
    for (let z = r.z0; z <= r.z1; z++) for (const x of [r.x0, r.x1]) { const k = cellAt(p, x, z); if (k !== KIND.WALL && k !== KIND.GATE) return false; }
    const g = p.gates.find((gg) => gg.ring === 'power');
    if (!g) return false;
    // the gate faces a road: the cell just outside it is road
    const [ox, oz] = dirOfYaw({ N: 0, E: 90, S: 180, W: 270 }[g.side]);
    const gp = p.pieces[g.pieceIndex];
    const cx = Math.floor(gp.x + gp.pw / 2 + ox * 2), cz = Math.floor(gp.z + gp.ph / 2 + oz * 2);
    if (cellAt(p, cx, cz) !== KIND.ROAD && cellAt(p, cx, cz) !== KIND.FOUNDATION) return false;
    // and near the centre: the rect's centre inside the middle half of the plate
    const mx = (r.x0 + r.x1) / 2, mz = (r.z0 + r.z1) / 2;
    return mx > p.w * 0.15 && mx < p.w * 0.85 && mz > p.h * 0.15 && mz < p.h * 0.85;
  })());
  check(`${label}: only modelled ids are placed`, p.pieces.every((pc) => pc.kind === KIND.ROAD || pc.id === 'defense_sentry_socket' || MODELLED.has(pc.id)), [...new Set(p.pieces.filter((pc) => pc.kind !== KIND.ROAD && pc.id !== 'defense_sentry_socket' && !MODELLED.has(pc.id)).map((pc) => pc.id))].join(' '));
  check(`${label}: band containers stay in the band`, buildings.filter((pc) => pc.zone === 'band').every((pc) => p.inset > 0 && (pc.x < p.inset || pc.z < p.inset || pc.x + pc.pw > p.w - p.inset || pc.z + pc.ph > p.h - p.inset)));
  check(`${label}: every piece is inside the plate`, p.pieces.every((pc) => pc.x >= 0 && pc.z >= 0 && pc.x + pc.pw <= p.w && pc.z + pc.ph <= p.h));
  const claimed = new Map();
  for (let i = 0; i < p.cells.length; i++) if (p.owner[i] >= 0) claimed.set(p.owner[i], (claimed.get(p.owner[i]) || 0) + 1);
  check(`${label}: no overlaps`, p.pieces.every((pc, i) => claimed.get(i) === pc.pw * pc.ph), 'a piece owns fewer cells than its plot');
  check(`${label}: a command zone exists`, p.blocks.some((b) => b.zone === 'command'));
  check(`${label}: every zone is known`, p.blocks.every((b) => ZONES[b.zone]));
  check(`${label}: building plots match the spec`, buildings.every((pc) => {
    const sp = specById(pc.id).plot;
    return (pc.rot % 2 === 0) ? (pc.pw === sp[0] && pc.ph === sp[1]) : (pc.pw === sp[1] && pc.ph === sp[0]);
  }));
  check(`${label}: sentry cells reserved`, sentrySockets(p).every((sk) => [0, 1].every((dz) => [0, 1].every((dx) =>
    p.cells[(sk.z + dz) * p.w + sk.x + dx] === KIND.SENTRY))));
}
const LINES = { total: 0, stood: 0 };
const YARDS = { total: 0, rowed: 0 };
for (const seed of SEEDS) {
  const p = generatePlate(makePlateParams({ ...PLATE_TUNE, seed }));
  checkPacking(p, `seed ${seed}`);
  const inf = p.pieces.filter((pc) => pc.id === LANDMARK);
  check(`seed ${seed}: exactly one infirmary, a landmark`, inf.length === 1 && inf[0].landmark === true, `got ${inf.length}`);
  // the power compound takes the centre block first; on a few seeds the line finds no block left
  LINES.total++; if (p.pieces.filter((pc) => pc.id === 'robotic_assembly_line').length === 1) LINES.stood++;
  // per block: where a yard holds two or more containers, at least two touch in a row
  let yards = 0, rowed = 0;
  for (const b of p.blocks) {
    if (b.zone !== 'logistics') continue;
    const cs = p.pieces.filter((pc) => YARD_IDS.includes(pc.id) && b.cellSet.has(pc.z * p.w + pc.x));
    if (cs.length < 2) continue;
    yards++;
    const touching = cs.filter((a) => cs.some((c) => c !== a && ((Math.abs(a.x - c.x) === Math.max(a.pw, c.pw) || Math.abs(a.x - c.x) === Math.min(a.pw, c.pw)) && a.z === c.z || (Math.abs(a.z - c.z) === Math.max(a.ph, c.ph) || Math.abs(a.z - c.z) === Math.min(a.ph, c.ph)) && a.x === c.x)));
    if (touching.length >= 2) rowed++;
  }
  YARDS.total += yards; YARDS.rowed += rowed;
}
// a cramped yard may only fit one container per orientation; most yards are rows
check('the assembly line stands on nearly every default seed', LINES.stood >= LINES.total - 3, `${LINES.stood} of ${LINES.total}`);
check('yard stock lines up in rows in most logistics yards', YARDS.total > 10 && YARDS.rowed / YARDS.total >= 0.8, `${YARDS.rowed} of ${YARDS.total}`);
for (const [w, h] of SIZES) checkPacking(generatePlate(makePlateParams({ ...PLATE_TUNE, seed: 3, w, h, gates: 3 })), `${w}x${h}`, 2);
check('sentryBears: dead ahead is covered', sentryBears({ x: 0, z: 0, yawDeg: 0, arcDeg: 90 }, 1, -4));
check('sentryBears: behind is not', !sentryBears({ x: 0, z: 0, yawDeg: 0, arcDeg: 90 }, 1, 6));
check('sentryBears: wrap across 360', sentryBears({ x: 0, z: 0, yawDeg: 350, arcDeg: 40 }, 1.5, -4));
function checkSentries(p, label) {
  const sockets = sentrySockets(p);
  check(`${label}: one sentry per socket`, p.sentries.length === sockets.length, `${p.sentries.length} vs ${sockets.length}`);
  check(`${label}: sentries are gun families`, p.sentries.every((st) => GUN_FAMILIES.includes(st.family)));
  check(`${label}: sentries carry the knobs`, p.sentries.every((st) => st.arcDeg === p.params.arc && st.tier === p.params.tier));
  check(`${label}: sentry yaw points outward`, p.sentries.every((st) => {
    const [dx, dz] = dirOfYaw(st.yawDeg);
    const ox = (st.x + 1) - p.w / 2, oz = (st.z + 1) - p.h / 2;
    return dx * ox + dz * oz > 0;
  }));
  check(`${label}: every sentry within one cell of a ring`, p.sentries.every((st) => [0, p.inset].some((n) => st.x === n + 1 || st.z === n + 1 || st.x + 2 === p.w - 1 - n || st.z + 2 === p.h - 1 - n)));
  check(`${label}: sentry piece owns its cells`, p.sentries.every((st) => p.pieces[st.pieceIndex].id === 'defense_sentry_socket'));
  check(`${label}: no warnings`, p.warnings.length === 0, p.warnings.join('; '));
}
for (const seed of SEEDS) {
  const p = generatePlate(makePlateParams({ ...PLATE_TUNE, seed }));
  checkSentries(p, `seed ${seed}`);
  check(`seed ${seed}: a blind approach exists at the default arc`, blindCells(p).length > 0);
}
for (const [w, h] of SIZES) checkSentries(generatePlate(makePlateParams({ ...PLATE_TUNE, seed: 3, w, h, gates: 3 })), `${w}x${h}`);
done();
