import { generatePlate, makePlateParams, plateKnobProblems, KIND, rotSide, dirOfYaw, PLATE_TUNE, roadsConnected, roadBlockKey, ZONES, sentrySockets } from '../src/plate.js';
import { specById } from '../src/catalog-spec.js';
import { check, near, done } from './check.mjs';

check('knob table is sound', plateKnobProblems().length === 0, plateKnobProblems().join('; '));
check('rotSide: N rotated once is E', rotSide('N', 1) === 'E');
check('rotSide: W rotated once wraps to N', rotSide('W', 1) === 'N');
check('dirOfYaw(0) is +z', near(dirOfYaw(0)[0], 0) && near(dirOfYaw(0)[1], 1));
check('dirOfYaw(90) is +x', near(dirOfYaw(90)[0], 1) && near(dirOfYaw(90)[1], 0));

const SEEDS = Array.from({ length: 50 }, (_, i) => i + 1);
const SIZES = [[12, 12], [40, 12], [12, 40], [40, 40]];

const ringCells = (p) => {
  const out = [];
  for (let x = 0; x < p.w; x++) out.push([x, 0], [x, p.h - 1]);
  for (let z = 1; z < p.h - 1; z++) out.push([0, z], [p.w - 1, z]);
  return out;
};
const cellAt = (p, x, z) => p.cells[z * p.w + x];

function checkRing(p, label) {
  check(`${label}: sealed ring`, ringCells(p).every(([x, z]) => cellAt(p, x, z) === KIND.WALL || cellAt(p, x, z) === KIND.GATE));
  check(`${label}: gate count`, p.gates.length === p.params.gates, `got ${p.gates.length}`);
  check(`${label}: gates on distinct sides`, new Set(p.gates.map((g) => g.side)).size === p.gates.length);
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
  check(`${label}: every gate port is a road block`, p.gates.every((g) => p.roads.blocks.has(roadBlockKey(g.port.bx, g.port.bz))));
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
  check(`${label}: every building touches a road`, buildings.every((pc) => ROAD_TOUCH(p, pc)));
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
for (const seed of SEEDS) checkPacking(generatePlate(makePlateParams({ ...PLATE_TUNE, seed })), `seed ${seed}`);
for (const [w, h] of SIZES) checkPacking(generatePlate(makePlateParams({ ...PLATE_TUNE, seed: 3, w, h, gates: 3 })), `${w}x${h}`, 2);
done();
