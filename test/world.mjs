import { makeWorld, worldKnobProblems, worldBlocked, gateOutside, WORLD_TUNE } from '../src/world.js';
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
const inMargin = (t) => [A, B].some((p) => t.x > p.ox - 4 && t.x < p.ox + p.wM + 4 && t.z > p.oz - 4 && t.z < p.oz + p.hM + 4);
check('no tree or rock inside a plate', ![...w.trees, ...w.rocks].some(inMargin));
// blocking
const wallCell = [A.ox + 0.5 * CELL_M, A.oz + (A.plate.h - 0.5) * CELL_M]; // SW corner cell of A... its (0, h-1) cell
check('A\'s corner wall cell blocks in world coordinates', worldBlocked(w, wallCell[0], wallCell[1]));
check('a trunk blocks', worldBlocked(w, w.trees[0].x, w.trees[0].z));
check('open ground beside the road does not block', !worldBlocked(w, ax, az));
check('spawn is at A\'s gate outside point', near(w.spawn.x, ax) && near(w.spawn.z, az));
done();
