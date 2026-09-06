import { makeWorld, worldKnobProblems, worldBlocked, gateOutside, groundAt, WORLD_TUNE, ROAD_CLEAR_M } from '../src/world.js';
import { PLATE_TUNE, KIND, CELL_M } from '../src/plate.js';
import { check, near, done } from './check.mjs';

check('knob table is sound', worldKnobProblems().length === 0, worldKnobProblems().join('; '));

const P = { ...PLATE_TUNE };
const w = makeWorld({ ...WORLD_TUNE, seed: 7 }, P);
const w2 = makeWorld({ ...WORLD_TUNE, seed: 7 }, P);
check('deterministic', JSON.stringify(w.road.quads) === JSON.stringify(w2.road.quads) && w.trees.length === w2.trees.length && near(w.heightAt(100, 100), w2.heightAt(100, 100)));
check('more than 500 quads', w.mesh.quads.length > 500, `got ${w.mesh.quads.length}`);
check('no warnings', w.warnings.length === 0, w.warnings.join('; '));
const [A, B] = w.plates;
check('plates inside the world', [A, B].every((p) => p.ox > 0 && p.oz > 0 && p.ox + p.wM < w.size && p.oz + p.hM < w.size));
check('plates do not overlap', A.ox + A.wM < B.ox);
// flat under the plates
let flat = true;
for (const p of [A, B]) for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) if (Math.abs(w.heightAt(p.ox + p.wM * i / 10, p.oz + p.hM * j / 10)) > 1e-9) flat = false;
check('height is zero across each plate footprint', flat);
check('relief exists elsewhere', Math.abs(w.heightAt(w.size * 0.5, w.size * 0.15)) > 0.5 || Math.abs(w.heightAt(w.size * 0.5, w.size * 0.85)) > 0.5);
// continuity
let maxStep = 0;
for (let i = 0; i < 200; i++) { const x = 20 + i * 2.5, z = 60; maxStep = Math.max(maxStep, Math.abs(w.heightAt(x + 1, z) - w.heightAt(x, z))); }
check('height changes less than 1 m per metre', maxStep < 1, `max ${maxStep}`);
// road
const road = w.road.quads;
check('road exists', road.length > 5, `got ${road.length}`);
check('consecutive road quads share an edge', road.every((q, i) => i === 0 || w.adj[road[i - 1]].includes(q)));
const [ax, az] = gateOutside(A, A.facing), [bx, bz] = gateOutside(B, B.facing);
const [r0x, r0z] = w.centroids[road[0]], [r1x, r1z] = w.centroids[road[road.length - 1]];
check('road starts within 30 m of A\'s gate', Math.hypot(r0x - ax, r0z - az) < 30, `${Math.hypot(r0x - ax, r0z - az)}`);
check('road ends within 30 m of B\'s gate', Math.hypot(r1x - bx, r1z - bz) < 30, `${Math.hypot(r1x - bx, r1z - bz)}`);
check('A faces east, B faces west (nearest gates)', A.plate.gates[A.facing].side !== 'W' && B.plate.gates[B.facing].side !== 'E');
// cover
check('trees exist', w.trees.length > 20, `got ${w.trees.length}`);
check('no tree or rock on a road quad', [...w.trees, ...w.rocks].every((t) => !w.road.set.has(t.q)));
{
  const pts = w.road.points;
  const dist = (x, z) => { let best = Infinity; for (let i = 1; i < pts.length; i++) { const [ax, az] = pts[i - 1], [bx, bz] = pts[i]; const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1; const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2)); best = Math.min(best, Math.hypot(x - (ax + vx * t), z - (az + vz * t))); } return best; };
  check('no cover within the road clearance of the road line', [...w.trees, ...w.rocks].every((t) => dist(t.x, t.z) >= ROAD_CLEAR_M), 'a trunk at the road edge');
}
const inMargin = (t) => [A, B].some((p) => t.x > p.ox - 4 && t.x < p.ox + p.wM + 4 && t.z > p.oz - 4 && t.z < p.oz + p.hM + 4);
check('no tree or rock inside a plate', ![...w.trees, ...w.rocks].some(inMargin));
// blocking
const wallCell = [A.ox + 0.5 * CELL_M, A.oz + (A.plate.h - 0.5) * CELL_M]; // SW corner cell of A... its (0, h-1) cell
check('A\'s corner wall cell blocks in world coordinates', worldBlocked(w, wallCell[0], wallCell[1]));
check('a trunk blocks', worldBlocked(w, w.trees[0].x, w.trees[0].z));
check('open ground beside the road does not block', !worldBlocked(w, ax, az));
check('spawn is at A\'s gate outside point', near(w.spawn.x, ax) && near(w.spawn.z, az));
// the rendered ground: exact at vertices, close to the function between them, flat on a plate
{
  let maxDev = 0, exact = true;
  for (let i = 0; i < w.mesh.vertices.length; i += 37) {
    const [x, z] = w.mesh.vertices[i];
    const g = groundAt(w, x, z);
    if (Math.abs(g.y - w.heights[i]) > 1e-6 && !w.plates.some((p) => x >= p.ox && x < p.ox + p.wM && z >= p.oz && z < p.oz + p.hM)) exact = false;
  }
  for (let i = 0; i < 300; i++) { const x = 80 + (i * 7) % (w.size - 160), z = 80 + (i * 13) % (w.size - 160); maxDev = Math.max(maxDev, Math.abs(groundAt(w, x, z).y - w.heightAt(x, z))); }
  check('groundAt equals the vertex height at a vertex', exact);
  check('groundAt stays within 4 m of the function in the interior', maxDev < 4, `max ${maxDev}`);
  const inA = groundAt(w, A.ox + A.wM / 2, A.oz + A.hM / 2);
  check('groundAt on a plate is flat at zero', inA.y === 0 && inA.normal[1] === 1);
  const n = groundAt(w, 120, 120).normal;
  check('groundAt normal is unit and up', near(Math.hypot(...n), 1, 1e-6) && n[1] > 0);
}
{
  const big = makeWorld({ ...WORLD_TUNE, seed: 7, size: 320 }, { ...PLATE_TUNE, w: 60, h: 60 });
  check('the world grows to fit big plates', big.size > 320 && big.plates[0].ox + big.plates[0].wM < big.plates[1].ox && big.warnings.some((x) => /grown/.test(x)));
}
{
  const V = w.mesh.vertices; let inv = 0, concave = 0;
  for (const q of w.mesh.quads) { const signs = []; for (let i = 0; i < 4; i++) { const a = V[q[i]], b = V[q[(i + 1) % 4]], c = V[q[(i + 2) % 4]]; signs.push(Math.sign((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]))); } if (new Set(signs).size > 1) concave++; else if (signs[0] < 0) inv++; }
  check('no inverted quads after relaxation', inv === 0, `got ${inv}`);
  check('no concave quads after relaxation', concave === 0, `got ${concave}`);
}
done();
