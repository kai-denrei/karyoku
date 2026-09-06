import { generatePlate, makePlateParams, PLATE_TUNE, KIND, CELL_M, blindCells } from '../src/plate.js';
import { DRIVE_TUNE, driveKnobProblems, makeHull, stepHull, blockedAt, makeGates, stepGates, spawnFor,
  makeSentries, stepSentries, losClear, stepTracers, buildingAt, bearingTo, lobHeight, LOB_FAMILIES, fireHull, rayStop, damageAt, autopilotInput, makeBodies, stepBodies, bodyAt, BODY_IDS, hitsPerState } from '../src/drive.js';
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
  // the S wall is row h-1, its outer face at z = h * CELL_M. Drive N at it from 16 m out.
  const wallFace = plate.h * CELL_M;
  const h = makeHull(20, wallFace + 16, 0);
  for (let i = 0; i < 300; i++) stepHull(h, { fwd: true }, DT, blocked);
  check('hull stops at the wall face plus its radius', h.z >= wallFace + DRIVE_TUNE.hullR - 1e-9 && h.z <= wallFace + DRIVE_TUNE.hullR + DRIVE_TUNE.speed * DT + 1e-9, `z=${h.z}`);
  const s = makeHull(30, wallFace + 16, 315);
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
  s2.family = 'needle'; s2.lob = false; // a gun, whatever the seed put in the socket
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
// --- lobbers ------------------------------------------------------------------
{
  const s = makeSentries(plate)[0];
  s.family = 'mortar'; s.lob = true;
  const b = 275;
  const hx = s.cx + Math.sin(b * Math.PI / 180) * 30, hz = s.cz - Math.cos(b * Math.PI / 180) * 30;
  const still = makeHull(hx, hz, 0);
  let shell = null;
  for (let i = 0; i < 40 && !shell; i++) { const f = stepSentries([s], still, 0.1, () => true); if (f.length) shell = f[0]; }
  check('a mortar fires a lob shell', shell && shell.kind === 'lob');
  check('the shell is aimed at a still hull', shell && near(shell.tx, hx, 1e-6) && near(shell.tz, hz, 1e-6));
  check('flight time is range over shell speed', shell && near(shell.flight, 30 / DRIVE_TUNE.lobSpeed, 1e-6));
  check('lob cooldown is the long one', near(s.cool, DRIVE_TUNE.lobCooldown));
  // the shell arcs and lands after its flight time; the still hull is inside the splash
  const shells = [shell];
  let hits = 0, peak = 0, steps = 0;
  while (shells.length && steps < 1000) { peak = Math.max(peak, lobHeight(shells[0])); hits += stepTracers(shells, still, 1 / 60, noBlock); steps++; }
  check('the shell lands on the hull after its flight', hits === 1 && Math.abs(steps / 60 - shell.flight) < 0.05, `steps ${steps} flight ${shell.flight}`);
  check('the shell climbed', peak > 3);
  // a moving hull is led: the target is ahead of it
  const s2 = makeSentries(plate)[0]; s2.family = 'howitzer'; s2.lob = true;
  const mover = makeHull(hx, hz, 0); mover.vx = 0; mover.vz = -10;
  let shell2 = null;
  for (let i = 0; i < 40 && !shell2; i++) { const f = stepSentries([s2], mover, 0.1, () => true); if (f.length) shell2 = f[0]; }
  check('a howitzer leads a moving hull', shell2 && shell2.tz < hz - 5, shell2 ? `tz ${shell2.tz} hz ${hz}` : 'no shell');
  // ...and a hull that leaves the splash before landing is missed
  const dodger = makeHull(hx, hz, 0);
  const shells2 = [{ ...shell, t: 0, x: shell.x0, z: shell.z0, hit: false, landed: false }];
  let hits2 = 0;
  for (let i = 0; i < 400 && shells2.length; i++) { dodger.x += 12 / 60; hits2 += stepTracers(shells2, dodger, 1 / 60, noBlock); }
  check('a hull that drives out of the splash is missed', hits2 === 0 && shells2.length === 0);
  check('LOB_FAMILIES names the two lobbers', LOB_FAMILIES.has('mortar') && LOB_FAMILIES.has('howitzer') && !LOB_FAMILIES.has('needle'));
}
// --- the hull's gun -------------------------------------------------------------
{
  const wallFace = plate.h * CELL_M;
  const h = makeHull(20, wallFace + 30, 0); // 30 m south of the S wall, facing it
  const shot = fireHull(h);
  check('the gun fires a shot ahead of the hull', shot && shot.kind === 'shot' && near(shot.z, h.z - 4) && near(shot.x, h.x));
  check('the gun then cools', fireHull(h) === null && near(h.cool, DRIVE_TUNE.shotCooldown));
  stepHull(h, {}, 1, noBlock);
  check('cooling counts down through stepHull', h.cool === 0 && fireHull(h) !== null);
  const shots = [shot];
  let hits = 0, steps = 0;
  const stop = rayStop(plate, gates);
  while (shots.length && steps < 600) { hits += stepTracers(shots, h, DT, stop); steps++; }
  check('a shot never counts as a hit on its own hull', hits === 0);
  check('a shot stops at the wall', shot.z >= wallFace - CELL_M && shot.z <= wallFace + 1, `z=${shot.z} wall ${wallFace}`);
  const open = [fireHull(makeHull(500, 500, 90))];
  steps = 0;
  while (open.length && steps < 600) { stepTracers(open, h, DT, stop); steps++; }
  check('a shot over open ground flies its range', Math.abs(steps * DT * DRIVE_TUNE.shotSpeed - DRIVE_TUNE.shotRange) < 2, `flew ${steps * DT * DRIVE_TUNE.shotSpeed}`);
}
// --- destructible walls -------------------------------------------------------
{
  const p2 = generatePlate(makePlateParams({ ...PLATE_TUNE, seed: 7 }));
  const g2 = makeGates(p2);
  const wx = 20 + 2, wz = (p2.h - 0.5) * CELL_M; // a standard wall cell on the S outer ring
  check('the cell is a standard wall', p2.pieces[p2.owner[(p2.h - 1) * p2.w + 5]].id === 'wall_standard');
  check('intact wall blocks', blockedAt(p2, g2, wx, wz));
  const pc = damageAt(p2, wx, wz);
  check('a shot damages it to D1', pc && pc.state === 1);
  damageAt(p2, wx, wz); damageAt(p2, wx, wz);
  check('three shots leave rubble at D3', pc.state === 3 && damageAt(p2, wx, wz) === null);
  check('rubble no longer blocks', !blockedAt(p2, g2, wx, wz));
  const cx = 0.5 * CELL_M, cz = (p2.h - 0.5) * CELL_M; // the SW corner piece
  check('a corner shrugs the round off', damageAt(p2, cx, cz) === null && blockedAt(p2, g2, cx, cz));
}
// --- autopilot ----------------------------------------------------------------
{
  const pts = [[0, 0], [40, 0], [40, -40], [80, -40]];
  const h = makeHull(0, 0, 0); // facing north, road goes east first
  let idx = 0, steps = 0;
  const last = pts[pts.length - 1];
  while (Math.hypot(h.x - last[0], h.z - last[1]) > 6 && steps < 3000) { const r = autopilotInput(h, pts, idx); idx = r.idx; stepHull(h, r.input, DT, noBlock); steps++; }
  check('the autopilot drives the polyline to its end', Math.hypot(h.x - last[0], h.z - last[1]) < 10, `ended ${h.x.toFixed(1)},${h.z.toFixed(1)}`);
  check('it turned rather than teleported', steps > 60);
}
// --- movable solids -------------------------------------------------------------
{
  const p3 = generatePlate(makePlateParams({ ...PLATE_TUNE, seed: 7 }));
  const g3 = makeGates(p3);
  const bodies = makeBodies(p3);
  check('the band holds containers as bodies', bodies.length >= 4, `got ${bodies.length}`);
  const b0 = bodies[0];
  check('a body\'s cells are freed for the hull', !blockedAt(p3, g3, b0.x, b0.z));
  check('bodyAt sees the body', bodyAt(bodies, b0.x, b0.z) && !bodyAt(bodies, -100, -100));
  // push a lone body on open ground: it gives way
  const lone = [{ pieceIndex: -1, plate: p3, x: 500, z: 500, hw: 5.8, hd: 1.8, rot: 0 }];
  const h = makeHull(500, 500 + 1.8 + 2 + 0.5, 0); // just south of the long side, facing it
  const z0 = lone[0].z;
  for (let i = 0; i < 60; i++) { stepHull(h, { fwd: true }, DT, noBlock); stepBodies(lone, h, noBlock); }
  check('the hull pushes a free container', lone[0].z < z0 - 5, `moved ${(z0 - lone[0].z).toFixed(2)} m`);
  check('the hull is never inside the body', !bodyAt(lone, h.x, h.z));
  // a body pinned against a wall: the hull stops
  const pinned = [{ pieceIndex: -1, plate: p3, x: 500, z: 500, hw: 5.8, hd: 1.8, rot: 0 }];
  const wallZ = 500 - 1.8 - 0.5; // a wall line just north of the body
  const wallBlocked = (x, z) => z < wallZ;
  const h2 = makeHull(500, 500 + 1.8 + 2.5, 0);
  for (let i = 0; i < 60; i++) { stepHull(h2, { fwd: true }, DT, wallBlocked); stepBodies(pinned, h2, wallBlocked); }
  check('a container against a wall stops the hull', Math.abs(pinned[0].z - 500) < 0.6 && h2.z > 500 + 1.8 + 1.5, `body z ${pinned[0].z.toFixed(2)} hull z ${h2.z.toFixed(2)}`);
  // shots stop on a body and do it no harm
  const shot = fireHull(makeHull(500, 530, 0));
  const shots = [shot];
  let steps = 0;
  while (shots.length && steps < 400) { stepTracers(shots, h, DT, rayStop(p3, g3, lone)); steps++; }
  check('a shot stops on a container', steps < 400 && shot.z > lone[0].z - 3, `z ${shot.z.toFixed(1)} body z ${lone[0].z.toFixed(1)}`);
  check('containers are the only bodies', BODY_IDS.has('logistics_container') && BODY_IDS.size === 1);
}
// --- destructible buildings ----------------------------------------------------
{
  const p4 = generatePlate(makePlateParams({ ...PLATE_TUNE, seed: 7 }));
  const g4 = makeGates(p4);
  const anyBuilding = (pc) => pc.kind === KIND.BUILDING || pc.id === 'wall_standard';
  const b = p4.pieces.find((pc) => pc.kind === KIND.BUILDING && pc.zone !== 'band' && pc.pw * pc.ph >= 12);
  check('a big building to shoot', !!b);
  const bx = (b.x + 0.5) * CELL_M, bz = (b.z + 0.5) * CELL_M;
  check('by default a building is not destructible', damageAt(p4, bx, bz) === null && b.state === 0);
  const per = hitsPerState(b);
  check('a big building takes more than one round per state', per >= 2, `per ${per}`);
  let changes = 0, rounds = 0;
  while (b.state < 3 && rounds < 100) { rounds++; if (damageAt(p4, bx, bz, anyBuilding)) changes++; }
  check('three state changes over per-state rounds', changes === 3 && rounds === per * 3, `changes ${changes} rounds ${rounds} per ${per}`);
  check('rubble is driveable', !blockedAt(p4, g4, bx, bz));
  check('rubble no longer stops a sentry round', !buildingAt(p4, bx, bz));
  check('a wall still takes one round per state', hitsPerState(p4.pieces.find((pc) => pc.id === 'wall_standard')) === 1);
}
done();
