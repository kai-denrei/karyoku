import { generatePlate, makePlateParams, PLATE_TUNE, KIND, CELL_M, blindCells } from '../src/plate.js';
import { DRIVE_TUNE, driveKnobProblems, makeHull, stepHull, blockedAt, makeGates, stepGates, spawnFor,
  makeSentries, stepSentries, losClear, stepTracers, buildingAt, bearingTo } from '../src/drive.js';
import { check, near, done } from './check.mjs';

check('knob table is sound', driveKnobProblems().length === 0, driveKnobProblems().join('; '));
check('bearingTo: north is 0', near(bearingTo(0, 0, 0, -5), 0));
check('bearingTo: east is 90', near(bearingTo(0, 0, 5, 0), 90));

const plate = generatePlate(makePlateParams({ ...PLATE_TUNE, seed: 7 }));
const gates = makeGates(plate);
const blocked = (x, z) => blockedAt(plate, gates, x, z);
const noBlock = () => false;
const DT = 1 / 60;

// --- hull motion ---------------------------------------------------------
{
  const h = makeHull(100, 100, 0);
  stepHull(h, { fwd: true }, 1, noBlock);
  check('heading 0 drives toward -z', near(h.x, 100) && near(h.z, 88));
  const e = makeHull(100, 100, 90);
  stepHull(e, { fwd: true }, 1, noBlock);
  check('heading 90 drives toward +x', near(e.x, 112) && near(e.z, 100));
  const t = makeHull(0, 0, 0);
  stepHull(t, { right: true }, 0.5, noBlock);
  check('turning right adds heading', near(t.heading, 60));
  const r = makeHull(0, 0, 0);
  stepHull(r, { rev: true }, 1, noBlock);
  check('reverse backs up at half speed', near(r.z, 6));
}
// --- walls ---------------------------------------------------------------
{
  // the S wall is row h-1: z in [60, 64) m for a 16-deep plate. Drive N at it.
  const h = makeHull(20, 80, 0);
  for (let i = 0; i < 300; i++) stepHull(h, { fwd: true }, DT, blocked);
  const wallFace = plate.h * CELL_M;
  check('hull stops at the wall face plus its radius', h.z >= wallFace + DRIVE_TUNE.hullR - 1e-9 && h.z <= wallFace + DRIVE_TUNE.hullR + DRIVE_TUNE.speed * DT + 1e-9, `z=${h.z}`);
  const s = makeHull(30, 80, 315);
  for (let i = 0; i < 120; i++) stepHull(s, { fwd: true }, DT, blocked);
  check('driving diagonally into the wall slides along it', s.x < 30 - 5 && s.z >= wallFace + DRIVE_TUNE.hullR - 1e-9, `x=${s.x} z=${s.z}`);
}
// --- gates ---------------------------------------------------------------
{
  const g = gates.find((x) => x.side === 'S');
  check('seed 7 has a S gate', !!g);
  const lane = [g.cx, g.cz];
  const far = makeHull(g.cx, g.cz + 5 * CELL_M, 0);
  stepGates(gates, far, 1, DRIVE_TUNE);
  check('gate stays shut with the hull five cells out', g.open === 0);
  check('a shut gate blocks its lane', blocked(lane[0], lane[1]));
  const nearHull = makeHull(g.cx, g.cz + 2.5 * CELL_M, 0);
  for (let i = 0; i < 12; i++) stepGates(gates, nearHull, 0.1, DRIVE_TUNE);
  check('gate opens fully in gateSecs', near(g.open, 1));
  check('an open gate does not block its lane', !blocked(lane[0], lane[1]));
  check('the tower cells beside the lane still block', blocked(lane[0] - CELL_M, lane[1]) && blocked(lane[0] + CELL_M, lane[1]));
  for (let i = 0; i < 12; i++) stepGates(gates, far, 0.1, DRIVE_TUNE);
  check('gate closes after the hull leaves', near(g.open, 0));
  const sp = spawnFor(plate, plate.gates.find((x) => x.side === 'S'));
  check('spawn is outside the S gate facing north', sp.z > plate.h * CELL_M && near(sp.heading, 0) && near(sp.x, g.cx));
}
// --- sentries ------------------------------------------------------------
{
  const sentries = makeSentries(plate);
  const nw = sentries[0];
  check('first sentry is the NW corner, home 315', near(nw.home, 315) && near(nw.cx, 8) && near(nw.cz, 8));
  // outside the arc: a hull to the SE of it
  const inside = makeHull(nw.cx + 20, nw.cz + 20, 0);
  let everTracked = false, everOut = false;
  for (let i = 0; i < 400; i++) {
    stepSentries([nw], inside, DT, () => true);
    if (nw.tracking) everTracked = true;
    const rel = ((nw.yaw - nw.home + 540) % 360) - 180;
    if (Math.abs(rel) > nw.arc / 2 + 1e-9) everOut = true;
  }
  check('a hull outside the arc is never tracked', !everTracked);
  check('the sweeping yaw never leaves the arc', !everOut);
  check('it did sweep', Math.abs(nw.yaw - nw.home) > 5);
  // inside the arc, 40 degrees off the home bearing, 20 m out, no buildings in the way
  const s2 = makeSentries(plate)[0];
  const b = 275;
  const hx = s2.cx + Math.sin(b * Math.PI / 180) * 20, hz = s2.cz - Math.cos(b * Math.PI / 180) * 20;
  const target = makeHull(hx, hz, 0);
  const yaws = [], firedAt = [];
  for (let i = 1; i <= 20; i++) {
    const fired = stepSentries([s2], target, 0.1, () => true);
    yaws.push(s2.yaw);
    if (fired.length) firedAt.push(i);
  }
  check('inside the arc it tracks', s2.tracking);
  check('slew is yawRate*dt per step, not a jump', near(yaws[0], 309) && near(yaws[1], 303));
  check('first round only once on target', firedAt[0] === 7, `fired at steps ${firedAt.join(',')}`);
  check('cooldown holds the second round', firedAt.length >= 2 && firedAt[1] - firedAt[0] >= 9, `fired at steps ${firedAt.join(',')}`);
}
// --- line of sight ---------------------------------------------------------
{
  let bcell = null;
  for (let z = 0; z < plate.h && !bcell; z++) for (let x = 0; x < plate.w && !bcell; x++) if (plate.cells[z * plate.w + x] === KIND.BUILDING) bcell = [x, z];
  const [bx, bz] = bcell;
  const cx = (bx + 0.5) * CELL_M, cz = (bz + 0.5) * CELL_M;
  check('sight through a building is blocked', !losClear(plate, cx - 2 * CELL_M, cz, cx + 2 * CELL_M, cz));
  check('sight over open ground is clear', losClear(plate, 200, 200, 240, 200));
  // a column whose cells just inside the S wall are foundation: cross the wall only
  let col = -1;
  for (let x = 1; x < plate.w - 1 && col < 0; x++) if (plate.cells[(plate.h - 2) * plate.w + x] === KIND.FOUNDATION) col = x;
  const wx = (col + 0.5) * CELL_M;
  check('sight across the ring wall is clear (turrets stand above it)', col >= 0 && losClear(plate, wx, plate.h * CELL_M + 8, wx, (plate.h - 1.5) * CELL_M));
}
// --- tracers ---------------------------------------------------------------
{
  // a building cell whose southern neighbour is not a building: fire north from that neighbour
  let bcell = null;
  for (let z = 0; z < plate.h - 1 && !bcell; z++) for (let x = 0; x < plate.w && !bcell; x++) {
    if (plate.cells[z * plate.w + x] === KIND.BUILDING && plate.cells[(z + 1) * plate.w + x] !== KIND.BUILDING) bcell = [x, z];
  }
  const [bx, bz] = bcell;
  const cx = (bx + 0.5) * CELL_M;
  const tr = [{ x: cx, z: (bz + 1.5) * CELL_M, heading: 0, left: 60, hit: false }];
  const t0 = tr[0];
  const hull = makeHull(500, 500, 0);
  let steps = 0;
  while (tr.length && steps < 200) { stepTracers(tr, hull, DT, (x, z) => buildingAt(plate, x, z)); steps++; }
  check('a tracer dies inside the first building cell it enters', tr.length === 0 && t0.z >= (bz) * CELL_M - 1 && t0.z <= (bz + 1) * CELL_M + 1, `z=${t0.z} building z=${bz * CELL_M}..${(bz + 1) * CELL_M}`);
  const tr2 = [{ x: 0, z: 0, heading: 90, left: 40, hit: false }];
  const hull2 = makeHull(20, 1, 0);
  let hits = 0;
  for (let i = 0; i < 120; i++) hits += stepTracers(tr2, hull2, DT, noBlock);
  check('a tracer passing inside hitR counts one hit and is spent', hits === 1 && tr2.length === 0);
  const tr3 = [{ x: 0, z: 0, heading: 90, left: 40, hit: false }];
  const hull3 = makeHull(20, 5, 0);
  hits = 0;
  for (let i = 0; i < 120; i++) hits += stepTracers(tr3, hull3, DT, noBlock);
  check('a tracer passing outside hitR is a miss', hits === 0 && tr3.length === 0);
}
// --- blind approaches on every default seed -------------------------------
for (let seed = 1; seed <= 50; seed++) {
  const p = generatePlate(makePlateParams({ ...PLATE_TUNE, seed }));
  const [bx, bz] = blindCells(p)[0];
  const hull = makeHull((bx + 0.5) * CELL_M, (bz + 0.5) * CELL_M, 0);
  const ss = makeSentries(p);
  stepSentries(ss, hull, DT, () => true);
  check(`seed ${seed}: parked on a blind ring cell, no sentry tracks`, ss.every((s) => !s.tracking));
}
done();
