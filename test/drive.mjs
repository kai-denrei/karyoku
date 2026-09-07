import { generatePlate, makePlateParams, PLATE_TUNE, KIND, CELL_M, blindCells } from '../src/plate.js';
import { DRIVE_TUNE, driveKnobProblems, makeHull, stepHull, blockedAt, makeGates, stepGates, spawnFor,
  makeSentries, stepSentries, losClear, stepTracers, buildingAt, bearingTo, lobHeight, LOB_FAMILIES, fireHull, rayStop, damageAt, autopilotInput, makeBodies, stepBodies, bodyAt, BODY_IDS, hitsPerState, shotRangeFor, solidHeightAt, sentryAt, damageSentryAt, SOLID_HEIGHT, stepCrush, FLAT_IDS, CRUSH_IDS, ammoDotsLit, damageBody, bodyHit, powered, BODY_HITS } from '../src/drive.js';
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
// --- the hull's gun: ballistic ----------------------------------------------------
{
  const wallFace = plate.h * CELL_M;
  const h = makeHull(20, wallFace + 30, 0); // 30 m south of the S wall, facing it
  check('the muzzle starts at the default elevation', h.elev === DRIVE_TUNE.elevDefault);
  stepHull(h, { elevUp: true }, 0.4, noBlock);
  check('SHIFT+W raises the muzzle at elevRate', near(h.elev, DRIVE_TUNE.elevDefault + 0.4 * DRIVE_TUNE.elevRate));
  stepHull(h, { elevDown: true }, 10, noBlock);
  check('the muzzle stops at its low stop', h.elev === DRIVE_TUNE.elevMin);
  stepHull(h, { elevUp: true }, 10, noBlock);
  check('...and its high stop', h.elev === DRIVE_TUNE.elevMax);
  h.elev = DRIVE_TUNE.elevDefault;
  const shot = fireHull(h);
  check('the gun fires a shell ahead of and above the hull', shot && shot.kind === 'shot' && near(shot.z, h.z - 4) && near(shot.x, h.x) && near(shot.y, DRIVE_TUNE.muzzleY) && shot.vy > 0);
  check('the gun then cools', fireHull(h) === null && near(h.cool, DRIVE_TUNE.shotCooldown));
  stepHull(h, {}, 1, noBlock);
  check('cooling counts down through stepHull', h.cool === 0 && fireHull(h) !== null);
  // flat ground: the shell lands where shotRangeFor says
  const far = makeHull(500, 500, 0);
  const s1 = fireHull(far);
  const flight = [s1];
  const predicted = shotRangeFor(far);
  let steps = 0, landedAt = null;
  while (flight.length && steps < 2000) { stepTracers(flight, far, DT, (x, z, t) => { if (t.landed) landedAt = [x, z]; return false; }); steps++; }
  check('a shell arcs and lands', s1.landed && landedAt !== null);
  check('it lands where the aiming read predicts', landedAt && Math.abs(Math.hypot(landedAt[0] - (far.x), landedAt[1] - (far.z - 4)) - predicted) < 2.5, `landed ${landedAt && Math.hypot(landedAt[0] - far.x, landedAt[1] - far.z + 4).toFixed(1)} predicted ${predicted.toFixed(1)}`);
  // a higher muzzle throws farther (up to 45 degrees)
  const lo = makeHull(500, 500, 0); lo.elev = 5;
  const hi = makeHull(500, 500, 0); hi.elev = 30;
  check('a raised muzzle throws farther', shotRangeFor(hi) > shotRangeFor(lo) + 10, `${shotRangeFor(lo).toFixed(1)} -> ${shotRangeFor(hi).toFixed(1)}`);
  // a shell over a wall flies on; the same shell at wall height stops
  const stop = rayStop(plate, gates);
  check('a shell 5 m up clears a 3.2 m wall', !stop(20, wallFace - 1, { kind: 'shot', y: 5 }));
  check('a shell at 1 m does not', stop(20, wallFace - 1, { kind: 'shot', y: 1 }));
  check('solid heights: wall under building', solidHeightAt(plate, 20, wallFace - 1) === 3.2);
  // fired at the wall from 30 m at a low muzzle: it hits the wall face
  const lowH = makeHull(20, wallFace + 30, 0); lowH.elev = 0;
  const s2 = fireHull(lowH);
  const f2 = [s2];
  steps = 0;
  while (f2.length && steps < 600) { stepTracers(f2, lowH, DT, stop); steps++; }
  check('a flat shell stops at the wall', s2.z >= wallFace - CELL_M && s2.z <= wallFace + 1, `z=${s2.z.toFixed(1)} wall ${wallFace}`);
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
  const flatGun = makeHull(500, 530, 0); flatGun.elev = 0;
  const shot = fireHull(flatGun);
  const shots = [shot];
  let steps = 0;
  while (shots.length && steps < 400) { stepTracers(shots, h, DT, rayStop(p3, g3, lone)); steps++; }
  check('a shot stops on a container', steps < 400 && shot.z > lone[0].z - 3, `z ${shot.z.toFixed(1)} body z ${lone[0].z.toFixed(1)}`);
  check('the warehouse props are the bodies', BODY_IDS.has('logistics_container') && BODY_IDS.has('cargo_crate') && BODY_IDS.has('fuel_barrel') && BODY_IDS.size === 5);
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
// --- a stick's throttle ---------------------------------------------------------
{
  const h = makeHull(100, 100, 0);
  stepHull(h, { throttle: 0.5 }, 1, noBlock);
  check('half throttle is half speed', near(h.z, 100 - DRIVE_TUNE.speed * 0.5));
  const b = makeHull(100, 100, 0);
  stepHull(b, { throttle: -0.5 }, 1, noBlock);
  check('a negative throttle backs up at that fraction of reverse', near(b.z, 100 + DRIVE_TUNE.reverse * 0.5));
  const k = makeHull(100, 100, 0);
  stepHull(k, { fwd: true }, 1, noBlock);
  check('the keys still drive at full speed', near(k.z, 100 - DRIVE_TUNE.speed));
}
// SENTRIES ARE DAMAGEABLE: three rounds on the socket break one; a wreck
// sees nothing, fires nothing, and is low enough to shoot over
{
  const ss = makeSentries(plate);
  const s = ss[0];
  const st = plate.sentries[0];
  const other = (st.x + 1) * CELL_M + 1.5; // the socket's far cell, still this sentry
  const open = plate.cells.findIndex((k) => k === KIND.FOUNDATION);
  check('a round on open ground is nobody\'s', damageSentryAt(plate, ss, (open % plate.w + 0.5) * CELL_M, (Math.floor(open / plate.w) + 0.5) * CELL_M) === null && ss.every((x) => x.hp === 0));
  check('the socket resolves to its sentry on both cells', sentryAt(plate, ss, s.cx, s.cz) === s && sentryAt(plate, ss, other, s.cz + 1) === s);
  const r1 = damageSentryAt(plate, ss, s.cx, s.cz), r2 = damageSentryAt(plate, ss, other, s.cz + 1);
  check('two rounds wound it and it still stands', r1 && !r1.destroyed && r2 && !r2.destroyed && s.alive && s.hp === 2);
  const r3 = damageSentryAt(plate, ss, s.cx, s.cz);
  check('the third breaks it', r3 && r3.destroyed && r3.sentry === s && !s.alive);
  check('a wreck takes no more', damageSentryAt(plate, ss, s.cx, s.cz) === null);
  check('a wreck is low: shells clear it, a live one stops them', solidHeightAt(plate, s.cx, s.cz, ss) === SOLID_HEIGHT.wreck && solidHeightAt(plate, s.cx, s.cz) === SOLID_HEIGHT.sentry);
  // a hull right in front of the wreck, inside its arc: nothing happens
  const [dx, dz] = [Math.sin(s.home * Math.PI / 180), -Math.cos(s.home * Math.PI / 180)];
  const h = makeHull(s.cx + dx * 4 * CELL_M, s.cz + dz * 4 * CELL_M, (s.home + 180) % 360);
  let shots = 0;
  for (let i = 0; i < 300; i++) shots += stepSentries([s], h, 1 / 60, () => true).length;
  check('a wreck never tracks and never fires', shots === 0 && !s.tracking);
  const live = makeSentries(plate)[0];
  let liveShots = 0;
  for (let i = 0; i < 300; i++) liveShots += stepSentries([live], h, 1 / 60, () => true).length;
  check('...while the same sentry alive would have', liveShots > 0);
}
// RUN OVER: pads are floors, small things are crushed at speed
{
  let found = null;
  for (let seed = 1; seed <= 30 && !found; seed++) {
    const p = generatePlate(makePlateParams({ ...PLATE_TUNE, seed }));
    const pads = p.pieces.filter((pc) => FLAT_IDS.has(pc.id)), smalls = p.pieces.filter((pc) => CRUSH_IDS.has(pc.id));
    if (pads.length && smalls.length) found = { p, pad: pads[0], small: smalls[0], seed };
  }
  check('some default plate has a pad and something small to test on', Boolean(found), found ? `seed ${found.seed}` : 'none in 1..30');
  if (found) {
    const { p, pad, small } = found;
    const g = makeGates(p);
    const px = (pad.x + pad.pw / 2) * CELL_M, pz = (pad.z + pad.ph / 2) * CELL_M;
    check('a pad does not block the hull, a shell clears it, sight crosses it', !blockedAt(p, g, px, pz) && solidHeightAt(p, px, pz) < 1 && losClear(p, px, pz - 2, px, pz + 2));
    const sx = (small.x + small.pw / 2) * CELL_M, sz = (small.z + small.ph / 2) * CELL_M;
    check('a small thing blocks the hull while it stands', blockedAt(p, g, sx, sz));
    const slow = makeHull(sx, sz + 3.2, 0); slow.speed = 1;
    check('a slow hull against it crushes nothing', stepCrush(p, slow, DRIVE_TUNE).length === 0 && small.state === 0);
    const fast = makeHull(sx, sz + 3.2, 0); fast.speed = 8;
    const got = stepCrush(p, fast, DRIVE_TUNE);
    check('a fast hull flattens it and loses speed', got.length === 1 && got[0] === small && small.state === 3 && small.crushed && near(fast.speed, 8 * 0.7));
    check('flattened, it no longer blocks', !blockedAt(p, g, sx, sz));
    check('and it is not crushed twice', stepCrush(p, fast, DRIVE_TUNE).length === 0);
  }
}
// THE RACK: 27 shells, nine dots of three
{
  const h = makeHull(100, 100, 0);
  check('a fresh hull racks the full load', h.ammo === DRIVE_TUNE.ammoMax && ammoDotsLit(h.ammo) === 9);
  let fired = 0;
  for (let i = 0; i < 40; i++) { h.cool = 0; if (fireHull(h)) fired++; }
  check('it fires exactly the rack and then clicks', fired === 27 && h.ammo === 0 && h.empty === true);
  check('dots: 27 lights nine, 25 lights nine, 24 lights eight, 1 lights one, 0 lights none', ammoDotsLit(27) === 9 && ammoDotsLit(25) === 9 && ammoDotsLit(24) === 8 && ammoDotsLit(1) === 1 && ammoDotsLit(0) === 0);
  const k = makeHull(0, 0, 0); k.ammo = 2; k.cool = 0;
  check('a live shot clears the empty flag', fireHull(k) !== null && k.empty === false && k.ammo === 1);
}
// BODIES BREAK, and the plate's power holds its sentries up
{
  const p = generatePlate(makePlateParams({ ...PLATE_TUNE, seed: 7 }));
  const bs = makeBodies(p, 0, 0, { logistics_container: { w: 5.2, d: 2.5 }, cargo_crate: { w: 2.2, d: 2.2 } });
  const ids = new Set(bs.map((b) => b.id));
  check('the yards hold more than containers now', ids.size >= 3 && bs.some((b) => b.id === 'cargo_crate'), [...ids].join(' '));
  const c = bs.find((b) => b.id === 'logistics_container');
  check('a container box comes from its collider, not its plot', c && near(c.hw, 2.6) && near(c.hd, 1.25));
  check('a container takes two rounds a state', damageBody(c).stepped === false && damageBody(c).stepped === true && c.state === 1 && BODY_HITS.logistics_container === 2);
  const k = bs.find((b) => b.id === 'cargo_crate');
  check('a crate takes one', damageBody(k).stepped === true && k.state === 1);
  damageBody(k); const dead = damageBody(k);
  check('the third state is death: debris, not solid, and the piece knows', dead.destroyed && k.dead && !bodyHit([k], k.x, k.z) && p.pieces[k.pieceIndex].state === 3);
  check('a dead body takes no more', damageBody(k) === null);
  // a ram at speed marks the body once per touch
  const h = makeHull(c.x, c.z, 270); h.speed = 6; // on the body's centre: contact whatever its rot
  stepBodies([c], h, () => false, DRIVE_TUNE, 1 / 60);
  check('a ram at speed flags the body, once', c.rammed === true && (stepBodies([c], h, () => false, DRIVE_TUNE, 1 / 60), c.rammed === false));
  // power
  check('the plate is powered while its station stands', p.power && powered(p));
  const st = p.pieces[p.power.pieceIndex];
  const ss = makeSentries(p);
  const s0 = ss[0];
  const [dx, dz] = [Math.sin(s0.home * Math.PI / 180), -Math.cos(s0.home * Math.PI / 180)];
  const target = makeHull(s0.cx + dx * 4 * CELL_M, s0.cz + dz * 4 * CELL_M, (s0.home + 180) % 360);
  let live = 0; for (let i = 0; i < 300; i++) live += stepSentries([s0], target, 1 / 60, () => true, DRIVE_TUNE, powered(p)).length;
  st.state = 3;
  check('the station at D3 cuts the power', !powered(p));
  const s1 = makeSentries(p)[0];
  let dark = 0; for (let i = 0; i < 300; i++) dark += stepSentries([s1], target, 1 / 60, () => true, DRIVE_TUNE, powered(p)).length;
  check('a dark sentry never tracks or fires where a powered one did', live > 0 && dark === 0 && !s1.tracking);
}
// what the hull tells the sound layer: a bump when a solid stops it at speed, the muzzle moving
{
  const wallAt = (x, z) => z < 90;   // a wall line north of z = 90
  const h = makeHull(100, 100, 0);   // facing north
  stepHull(h, { fwd: true }, 1 / 60, wallAt);
  check('a clear step is no bump', h.bump === 0);
  h.z = 90 + DRIVE_TUNE.hullR + 0.05;
  stepHull(h, { fwd: true }, 1 / 60, wallAt);
  check('a solid that stops the hull at speed is a bump of that speed', h.bump === DRIVE_TUNE.speed);
  stepHull(h, { throttle: 0.05 }, 1 / 60, wallAt);
  check('a creep into it is not', h.bump === 0);
  const e = makeHull(0, 0, 0);
  stepHull(e, { elevUp: true }, 1 / 60, () => false);
  check('raising the muzzle reports elevating', e.elevating === true);
  e.elev = DRIVE_TUNE.elevMax;
  stepHull(e, { elevUp: true }, 1 / 60, () => false);
  check('held at the stop it does not', e.elevating === false);
  stepHull(e, {}, 1 / 60, () => false);
  check('idle it does not', e.elevating === false);
}
done();
