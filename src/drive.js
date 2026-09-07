// drive.js — THE DRIVE's rules: a hull that turns and moves and slides along
// what it cannot cross, gates that open when it comes near, sentries that
// sweep a limited arc and slew at a finite rate toward what they can see
// inside it, tracers that fly until they hit something. Pure: no DOM, no
// three.js, Node-tested in test/drive.mjs. drive-tab.js owns the models,
// the keys, the camera and the HUD.
//
// Metres, on the plate's XZ plane. North is -z; headings are compass
// degrees, 0 = N, 90 = E, direction [sin, -cos] (plate.js's dirOfYaw).
//
// THE ANTI-AIMBOT NUMBERS are yawRate and the arc: a sentry cannot point
// outside its arc, and inside it turns at yawRate, so a hull that crosses
// the arc fast, or stays in the blind sector, is never fired on.
import { makeParams, clampParams, formatKnobs, knobProblems } from './knobs.js?v=de91215a';
import { KIND, CELL_M, wrapDeg, dirOfYaw, DIRS, yawOfSide, rotSide } from './plate.js?v=de91215a';

export const DRIVE_TUNE = {
  speed: 12,        // m/s forward
  reverse: 6,       // m/s backward
  turnRate: 120,    // deg/s
  hullR: 2.0,       // m, collision radius
  gateCells: 3.5,   // cells from a gate centre that opens it
  gateSecs: 1.2,    // seconds to open or close fully
  yawRate: 60,      // deg/s sentry slew
  sweepRate: 25,    // deg/s idle sweep
  tolerance: 3,     // deg on-target
  cooldown: 0.9,    // s between rounds
  sentryHits: 3,    // hull rounds that break a sentry
  crushSpeed: 3,    // m/s: at this speed the hull flattens a CRUSH_IDS piece it drives into
  fireCells: 9,     // engagement range, cells
  tracerSpeed: 40,  // m/s
  hitR: 2.4,        // m, a tracer this close to the hull centre is a hit
  // THE LOBBERS. A mortar does not point at what it shoots: the shell flies
  // a visible arc and lands where the hull WAS GOING TO BE, so the skill is
  // reading the arc and not being there. A slow shell and a long cooldown
  // are what make that a decision rather than a lottery.
  lobSpeed: 26,     // m/s along the ground
  lobApex: 16,      // m, the arc's height over a full-range shot
  splashR: 5,       // m, the shell hurts inside this on landing
  lobCooldown: 2.6, // s
  // THE HULL'S GUN. Space fires a shell straight along the heading from the
  // muzzle; it stops on anything solid. No damage yet — the shot exists so
  // the driver can aim, and so the impact work has something to land on.
  shotSpeed: 70,    // m/s at the muzzle
  shotRange: 260,   // m — a safety cap along the ground; gravity is the real limit
  shotCooldown: 0.6,
  // BALLISTICS. The shell leaves the muzzle at `elev` degrees and falls
  // under GRAVITY; SHIFT+W / SHIFT+S raise and lower the muzzle at elevRate.
  gravity: 9.8,
  elevMin: -5, elevMax: 45, elevRate: 25, elevDefault: 6,
  muzzleY: 2.2,     // m above the hull's ground
  ammoMax: 27,      // shells racked: nine sockets on the deck, three shells each
  shellsPerDot: 3,
};
export const LOB_FAMILIES = new Set(['mortar', 'howitzer']);
export const LOB_ELEV_DEG = 55;

export const DRIVE_KNOBS = [
  { key: 'speed', label: 'speed (m/s)', group: 'hull', min: 2, max: 30, step: 1 },
  { key: 'reverse', label: 'reverse (m/s)', group: 'hull', min: 1, max: 15, step: 1 },
  { key: 'turnRate', label: 'turn rate (deg/s)', group: 'hull', min: 30, max: 360, step: 10 },
  { key: 'hullR', label: 'hull radius (m)', group: 'hull', min: 0.5, max: 4, step: 0.1 },
  { key: 'gateCells', label: 'gate trigger (cells)', group: 'gates', min: 1, max: 8, step: 0.5 },
  { key: 'gateSecs', label: 'gate open time (s)', group: 'gates', min: 0.2, max: 4, step: 0.1 },
  { key: 'yawRate', label: 'yaw rate (deg/s)', group: 'sentries', min: 5, max: 360, step: 5 },
  { key: 'sweepRate', label: 'sweep rate (deg/s)', group: 'sentries', min: 0, max: 120, step: 5 },
  { key: 'tolerance', label: 'tolerance (deg)', group: 'sentries', min: 0.5, max: 15, step: 0.5 },
  { key: 'cooldown', label: 'cooldown (s)', group: 'sentries', min: 0.1, max: 5, step: 0.1 },
  { key: 'sentryHits', label: 'rounds to break one', group: 'sentries', min: 1, max: 9, step: 1 },
  { key: 'crushSpeed', label: 'crush speed (m/s)', group: 'hull', min: 0.5, max: 12, step: 0.5 },
  { key: 'fireCells', label: 'range (cells)', group: 'sentries', min: 2, max: 20, step: 1 },
  { key: 'tracerSpeed', label: 'tracer speed (m/s)', group: 'sentries', min: 5, max: 120, step: 5 },
  { key: 'hitR', label: 'hit radius (m)', group: 'sentries', min: 0.5, max: 6, step: 0.1 },
  { key: 'lobSpeed', label: 'shell speed (m/s)', group: 'lobbers', min: 5, max: 80, step: 1 },
  { key: 'lobApex', label: 'shell apex (m)', group: 'lobbers', min: 2, max: 60, step: 1 },
  { key: 'splashR', label: 'splash radius (m)', group: 'lobbers', min: 1, max: 15, step: 0.5 },
  { key: 'lobCooldown', label: 'lob cooldown (s)', group: 'lobbers', min: 0.5, max: 10, step: 0.1 },
  { key: 'shotSpeed', label: 'shot speed (m/s)', group: 'gun', min: 10, max: 200, step: 5 },
  { key: 'shotRange', label: 'shot range cap (m)', group: 'gun', min: 10, max: 400, step: 5 },
  { key: 'shotCooldown', label: 'shot cooldown (s)', group: 'gun', min: 0.1, max: 3, step: 0.1 },
  { key: 'gravity', label: 'gravity (m/s2)', group: 'gun', min: 1, max: 30, step: 0.5 },
  { key: 'elevMin', label: 'muzzle min (deg)', group: 'gun', min: -20, max: 0, step: 1 },
  { key: 'elevMax', label: 'muzzle max (deg)', group: 'gun', min: 10, max: 80, step: 1 },
  { key: 'elevRate', label: 'muzzle rate (deg/s)', group: 'gun', min: 5, max: 90, step: 5 },
  { key: 'elevDefault', label: 'muzzle default (deg)', group: 'gun', min: -5, max: 45, step: 1 },
  { key: 'muzzleY', label: 'muzzle height (m)', group: 'gun', min: 0.5, max: 5, step: 0.1 },
  { key: 'ammoMax', label: 'shells racked', group: 'gun', min: 3, max: 27, step: 3 },
  { key: 'shellsPerDot', label: 'shells per rack dot', group: 'gun', min: 1, max: 9, step: 1 },
];
export const makeDriveParams = (src = DRIVE_TUNE) => makeParams(DRIVE_KNOBS, src);
export const clampDriveParams = (p, src) => clampParams(DRIVE_KNOBS, p, src);
export const formatDriveTune = (p) => formatKnobs('DRIVE_TUNE', DRIVE_KNOBS, p);
export const driveKnobProblems = () => knobProblems(DRIVE_KNOBS, DRIVE_TUNE);

// compass bearing from a to b
export const bearingTo = (ax, az, bx, bz) => Math.atan2(bx - ax, -(bz - az)) * 180 / Math.PI;

const cellKind = (plate, cx, cz) => (cx < 0 || cz < 0 || cx >= plate.w || cz >= plate.h) ? -1 : plate.cells[cz * plate.w + cx];
const toCell = (m) => Math.floor(m / CELL_M);

// --- hull ------------------------------------------------------------------
export function makeHull(x, z, heading = 0, tune = DRIVE_TUNE) {
  return { x, z, heading, speed: 0, vx: 0, vz: 0, cool: 0, shots: 0, elev: tune.elevDefault, y: 0, ammo: tune.ammoMax };
}

// Turn, then move along the heading. The move is accepted when the four
// points at hullR around the new centre are free; else the x part alone,
// else the z part alone, else it stops. Sliding is what lets a hull hug a
// wall, which is what cover means.
// the hull tells the tab two things a sound hangs on: `bump` (the speed it
// was doing when a solid stopped it dead this step, 0 otherwise) and
// `elevating` (the muzzle actually moved this step, not just held at a stop)
const BUMP_SPEED = 1.5;
export function stepHull(hull, input, dt, blocked, tune = DRIVE_TUNE) {
  if (hull.cool > 0) hull.cool = Math.max(0, hull.cool - dt);
  hull.bump = 0;
  // the muzzle: SHIFT+W raises, SHIFT+S lowers, inside the mount's stops
  const dElev = ((input.elevUp ? 1 : 0) - (input.elevDown ? 1 : 0)) * tune.elevRate * dt;
  const elev0 = hull.elev;
  if (dElev) hull.elev = Math.max(tune.elevMin, Math.min(tune.elevMax, hull.elev + dElev));
  hull.elevating = hull.elev !== elev0;
  const turn = ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * tune.turnRate * dt;
  hull.heading = wrapDeg(hull.heading + turn);
  // a stick hands in a throttle (-rev..1) instead of the two keys: forward
  // scales the speed, backward scales the reverse speed
  const v = typeof input.throttle === 'number'
    ? (input.throttle > 0 ? input.throttle * tune.speed : input.throttle * tune.reverse)
    : input.fwd ? tune.speed : input.rev ? -tune.reverse : 0;
  hull.speed = v;
  hull.vx = 0; hull.vz = 0;
  if (v === 0) return false;
  const [dx, dz] = dirOfYaw(hull.heading);
  // a heading of exactly 90 leaves a 1e-17 in the other axis; that is not a move
  const mx = Math.abs(dx) < 1e-9 ? 0 : dx * v * dt, mz = Math.abs(dz) < 1e-9 ? 0 : dz * v * dt;
  const r = tune.hullR;
  const freeAt = (x, z) => !blocked(x + r, z) && !blocked(x - r, z) && !blocked(x, z + r) && !blocked(x, z - r);
  if (freeAt(hull.x + mx, hull.z + mz)) { hull.x += mx; hull.z += mz; hull.vx = mx / dt; hull.vz = mz / dt; return true; }
  if (mx !== 0 && freeAt(hull.x + mx, hull.z)) { hull.x += mx; hull.vx = mx / dt; return true; }
  if (mz !== 0 && freeAt(hull.x, hull.z + mz)) { hull.z += mz; hull.vz = mz / dt; return true; }
  if (Math.abs(v) >= BUMP_SPEED) hull.bump = Math.abs(v);
  return false;
}

// Fire the main gun: a shell from the muzzle, 4 m ahead and muzzleY up,
// leaving at shotSpeed along the heading and `elev` degrees above the
// ground — a ballistic round from here on. Null while the gun is cooling.
// null when cooling or EMPTY; `hull.empty` is true for the frame a dry
// trigger was pulled, so a tab can click at the player
export function fireHull(hull, tune = DRIVE_TUNE) {
  hull.empty = false;
  if (hull.cool > 0) return null;
  if ((hull.ammo ?? tune.ammoMax) <= 0) { hull.empty = true; hull.cool = 0.25; return null; }
  hull.cool = tune.shotCooldown;
  hull.shots++;
  hull.ammo = (hull.ammo ?? tune.ammoMax) - 1;
  const [dx, dz] = dirOfYaw(hull.heading);
  const e = (hull.elev ?? tune.elevDefault) * Math.PI / 180;
  const vh = tune.shotSpeed * Math.cos(e);
  return { kind: 'shot', x: hull.x + dx * 4, z: hull.z + dz * 4, y: (hull.y || 0) + tune.muzzleY,
    vx: dx * vh, vz: dz * vh, vy: tune.shotSpeed * Math.sin(e),
    heading: hull.heading, left: tune.shotRange, from: -1, hit: false, landed: false };
}

// Where a shell fired now would land on flat ground at the hull's height —
// the aiming read for the HUD.
// the rack's read: dots lit for the shells left, one per shellsPerDot,
// a part-used group still lit (the last dot goes dark with the last shell)
export const ammoDotsLit = (ammo, tune = DRIVE_TUNE) => Math.max(0, Math.ceil(ammo / tune.shellsPerDot));

export function shotRangeFor(hull, tune = DRIVE_TUNE) {
  const e = (hull.elev ?? tune.elevDefault) * Math.PI / 180;
  const v = tune.shotSpeed, g = tune.gravity, h = tune.muzzleY;
  const vy = v * Math.sin(e), vh = v * Math.cos(e);
  const t = (vy + Math.sqrt(vy * vy + 2 * g * h)) / g;
  return Math.min(tune.shotRange, vh * t);
}

// Steer along a polyline: the input that turns toward point `idx`, advancing
// to the next when within `reach`. For probes and for anything that has to
// drive a road on its own. Returns { input, idx }.
export function autopilotInput(hull, points, idx, reach = 8, tune = DRIVE_TUNE) {
  while (idx < points.length - 1 && Math.hypot(points[idx][0] - hull.x, points[idx][1] - hull.z) < reach) idx++;
  const [tx, tz] = points[Math.min(idx, points.length - 1)];
  const want = bearingTo(hull.x, hull.z, tx, tz);
  const d = wrapDeg(want - hull.heading);
  const input = { fwd: Math.abs(d) < 70 };
  if (d > 4) input.right = true; else if (d < -4) input.left = true;
  return { input, idx };
}

// --- movable solids: the containers -------------------------------------------
// A container is solid, takes no damage, and moves when the hull pushes it.
// It is not part of the cells: makeBodies frees the cells its piece claimed
// so blockedAt lets the hull reach it, and stepBodies settles the contact —
// the container gives way if it can, and the hull stops if it cannot.
// THE BODIES: the warehouse props. Pushable, and BREAKABLE: a shell or a
// ram at crushSpeed steps a body one state (the container takes two rounds
// a state, the rest one); at state 3 it is dead: debris, not solid.
export const BODY_IDS = new Set(['logistics_container', 'cargo_crate', 'secure_case', 'fuel_barrel', 'pallet_stack']);
export const BODY_HITS = { logistics_container: 2 };
export function damageBody(b) {
  if (b.dead) return null;
  b.hits = (b.hits || 0) + 1;
  if (b.hits < (BODY_HITS[b.id] || 1)) return { body: b, destroyed: false, stepped: false };
  b.hits = 0;
  b.state++;
  if (b.plate && b.plate.pieces[b.pieceIndex]) b.plate.pieces[b.pieceIndex].state = b.state;
  if (b.state >= 3) { b.dead = true; return { body: b, destroyed: true, stepped: true }; }
  return { body: b, destroyed: false, stepped: true };
}
// `dims` (id -> { w, d } metres, from the catalog's colliders) sizes the box
// the hull shoves; without it the plot's cells do, a little inset
export function makeBodies(plate, ox = 0, oz = 0, dims = null) {
  const out = [];
  plate.pieces.forEach((pc, pieceIndex) => {
    if (!BODY_IDS.has(pc.id)) return;
    for (let dz = 0; dz < pc.ph; dz++) for (let dx = 0; dx < pc.pw; dx++) {
      const i = (pc.z + dz) * plate.w + pc.x + dx;
      plate.cells[i] = KIND.FOUNDATION; plate.owner[i] = -1;
    }
    // half extents in the piece's own frame; rot 1 and 3 swap the placed dims back
    const swap = pc.rot % 2 === 1;
    const d = dims && dims[pc.id];
    out.push({
      pieceIndex, plate, id: pc.id, state: pc.state || 0, hits: 0, dead: (pc.state || 0) >= 3, moved: false, rammed: false, ramCool: 0, touched: false, touchCool: 0,
      x: ox + (pc.x + pc.pw / 2 + pc.offset[0]) * CELL_M, z: oz + (pc.z + pc.ph / 2 + pc.offset[1]) * CELL_M,
      hw: d ? d.w / 2 : (swap ? pc.ph : pc.pw) * CELL_M / 2 - 0.2, hd: d ? d.d / 2 : (swap ? pc.pw : pc.ph) * CELL_M / 2 - 0.2,
      rot: pc.rot,
    });
  });
  return out;
}
// rotation.y = -rot * PI/2 in the scene; the same turn here
const bodyTheta = (b) => -b.rot * Math.PI / 2;
function toLocal(b, x, z) {
  const t = -bodyTheta(b), dx = x - b.x, dz = z - b.z;
  return [dx * Math.cos(t) + dz * Math.sin(t), -dx * Math.sin(t) + dz * Math.cos(t)];
}
function toWorld(b, lx, lz) {
  const t = bodyTheta(b);
  return [b.x + lx * Math.cos(t) + lz * Math.sin(t), b.z - lx * Math.sin(t) + lz * Math.cos(t)];
}
export function bodyContains(b, x, z) {
  if (b.dead) return false; // debris is not solid
  const [lx, lz] = toLocal(b, x, z);
  return Math.abs(lx) <= b.hw && Math.abs(lz) <= b.hd;
}
export const bodyAt = (bodies, x, z) => bodies.some((b) => bodyContains(b, x, z));
export const bodyHit = (bodies, x, z) => bodies.find((b) => bodyContains(b, x, z)) || null;
function bodySamples(b, x, z) {
  const pts = [];
  for (const lx of [-b.hw, 0, b.hw]) for (const lz of [-b.hd, 0, b.hd]) { if (lx === 0 && lz === 0) continue; const [wx, wz] = toWorld({ ...b, x, z }, lx, lz); pts.push([wx, wz]); }
  return pts;
}
// may this body stand at (x, z)? nothing static under its outline, and no
// other body's outline under its corners (or its under theirs)
function bodyFits(b, x, z, bodies, blocked) {
  for (const [wx, wz] of bodySamples(b, x, z)) if (blocked(wx, wz)) return false;
  const moved = { ...b, x, z };
  for (const o of bodies) {
    if (o === b) continue;
    for (const [wx, wz] of bodySamples(moved, x, z)) if (bodyContains(o, wx, wz)) return false;
    for (const [wx, wz] of bodySamples(o, o.x, o.z)) if (bodyContains(moved, wx, wz)) return false;
  }
  return true;
}
// Settle the hull against every body. Returns how many bodies moved.
const TOUCH_SPEED = 1.2;
export function stepBodies(bodies, hull, blocked, tune = DRIVE_TUNE, dt = 1 / 60) {
  let moved = 0;
  for (const b of bodies) {
    b.moved = false; b.rammed = false; b.touched = false;
    if (b.ramCool > 0) b.ramCool -= dt;
    if ((b.touchCool || 0) > 0) b.touchCool -= dt;
    if (b.dead) continue;
    const [lx, lz] = toLocal(b, hull.x, hull.z);
    const cx = Math.max(-b.hw, Math.min(b.hw, lx)), cz = Math.max(-b.hd, Math.min(b.hd, lz));
    const [px, pz] = toWorld(b, cx, cz);
    let nx = hull.x - px, nz = hull.z - pz;
    let d = Math.hypot(nx, nz);
    if (d >= tune.hullR) continue;
    if (d < 1e-6) {
      // the hull centre is inside the box: push out along the hull's own motion, reversed
      const [dx, dz] = dirOfYaw(hull.heading);
      nx = -dx * Math.sign(hull.speed || 1); nz = -dz * Math.sign(hull.speed || 1); d = 0;
    } else { nx /= d; nz /= d; }
    const pen = tune.hullR - d + 0.02;
    // a RAM: contact at crushSpeed is a hit on the body, once per touch;
    // a TOUCH at any real speed is a thud, once per half second
    if (Math.abs(hull.speed || 0) >= tune.crushSpeed && b.ramCool <= 0) { b.rammed = true; b.ramCool = 0.8; }
    if (Math.abs(hull.speed || 0) >= TOUCH_SPEED && b.touchCool <= 0) { b.touched = true; b.touchCool = 0.5; }
    if (bodyFits(b, b.x - nx * pen, b.z - nz * pen, bodies, blocked)) { b.x -= nx * pen; b.z -= nz * pen; b.moved = true; moved++; }
    else { hull.x += nx * pen; hull.z += nz * pen; hull.vx = 0; hull.vz = 0; }
  }
  return moved;
}

// --- occupancy ---------------------------------------------------------------
// Outside the plate is open ground. A gate passes inside its LANE when it
// is open: the kit's clearance is 8 m wide, centred on the gate axis, so
// the lane is metric — 4 m either side of the axis — and the rest of the
// gate's three cells are the towers, which always block.
export const GATE_LANE_HALF_M = 4;
// FLAT pieces are floors: the hull drives over a pad, shells fly over it,
// it hides nothing. CRUSH pieces are small things a hull at crushSpeed
// flattens by driving into them (state 3, rubble, driveable after).
export const FLAT_IDS = new Set(['air_launchpad', 'air_drone_pad']);
export const CRUSH_IDS = new Set(['field_signal', 'research_specimen_crate', 'assembly_pallet', 'defense_radar', 'utility_conduit',
  'prop_antenna', 'prop_lamp', 'prop_banner', 'defense_searchlight', 'field_sensor', 'fence_sensor']);
const pieceAt = (plate, cx, cz) => plate.pieces[plate.owner[cz * plate.w + cx]] || null;
export function blockedAt(plate, gates, x, z) {
  const cx = toCell(x), cz = toCell(z);
  const k = cellKind(plate, cx, cz);
  if (k < 0) return false;
  if (k === KIND.WALL || k === KIND.BUILDING || k === KIND.PROP) {
    // a wall or building shot down to D3 is rubble: driveable; a pad is a floor
    const pc = pieceAt(plate, cx, cz);
    if (pc && (pc.state >= 3 || FLAT_IDS.has(pc.id))) return false;
    return true;
  }
  if (k === KIND.SENTRY) return true;
  if (k === KIND.GATE) {
    const pi = plate.owner[cz * plate.w + cx];
    const g = gates.find((gg) => gg.pieceIndex === pi);
    if (!g) return true;
    const axis = (g.at + 0.5) * CELL_M;
    const off = (g.side === 'N' || g.side === 'S') ? Math.abs(x - axis) : Math.abs(z - axis);
    return !(off < GATE_LANE_HALF_M && g.open >= 0.95);
  }
  return false;
}

// A shot landing on a destructible piece counts against it; every
// `hitsPerState` rounds it goes one state down the ladder, D0 to D3.
// Returns the piece if a STATE changed, else null. What is destructible is
// the caller's call (the catalog knows which pieces have damaged models);
// by default only the standard wall. A wall segment takes one round per
// state; a building takes one per six cells of footprint, at least one.
export const defaultDestructible = (pc) => pc.id === 'wall_standard';
export const hitsPerState = (pc) => pc.kind === KIND.WALL ? 1 : Math.max(1, Math.round(pc.pw * pc.ph / 6));
export function damageAt(plate, x, z, destructible = defaultDestructible) {
  const cx = toCell(x), cz = toCell(z);
  const k = cellKind(plate, cx, cz);
  if (k !== KIND.WALL && k !== KIND.BUILDING) return null;
  const pc = plate.pieces[plate.owner[cz * plate.w + cx]];
  if (!pc || pc.state >= 3 || !destructible(pc)) return null;
  pc.hp = (pc.hp || 0) + 1;
  if (pc.hp < hitsPerState(pc)) return null;
  pc.hp = 0;
  pc.state++;
  return pc;
}

// THE CRUSH. Before the hull moves, look a little ahead of its nose (and
// its two front corners): a CRUSH piece there, with the hull at crushSpeed,
// goes straight to state 3 and the hull loses a third of its speed to the
// crunch. Returns the pieces flattened this step, for the effect and the
// redraw. Cells stay BUILDING/PROP, so walkers still avoid the debris.
export function stepCrush(plate, hull, tune = DRIVE_TUNE) {
  const out = [];
  if (Math.abs(hull.speed || 0) < tune.crushSpeed) return out;
  const [fx, fz] = dirOfYaw(hull.heading);
  const s = Math.sign(hull.speed || 1), r = tune.hullR + 0.5;
  const rx = -fz, rz = fx;
  for (const [ax, az] of [[0, 0], [rx * 1.4, rz * 1.4], [-rx * 1.4, -rz * 1.4]]) {
    const px = hull.x + fx * r * s + ax, pz = hull.z + fz * r * s + az;
    const cx = toCell(px), cz = toCell(pz);
    const k = cellKind(plate, cx, cz);
    if (k !== KIND.BUILDING && k !== KIND.PROP) continue;
    const pc = pieceAt(plate, cx, cz);
    if (!pc || pc.state >= 3 || !CRUSH_IDS.has(pc.id) || out.includes(pc)) continue;
    pc.state = 3; pc.hp = 0; pc.crushed = true;
    out.push(pc);
  }
  if (out.length) hull.speed *= 0.7;
  return out;
}

// THE POWER: every sentry hangs off the station in the compound; at D3
// they all go down. A plate without a compound is powered by fiat.
export const powered = (plate) => !plate.power || (plate.pieces[plate.power.pieceIndex] || { state: 0 }).state < 3;

// --- gates -------------------------------------------------------------------
export function gateCentre(plate, g) {
  const pc = plate.pieces[g.pieceIndex];
  return [(pc.x + pc.pw / 2 + pc.offset[0]) * CELL_M, (pc.z + pc.ph / 2 + pc.offset[1]) * CELL_M];
}

export function makeGates(plate) {
  return plate.gates.map((g) => {
    const [cx, cz] = gateCentre(plate, g);
    return { side: g.side, at: g.at, ring: g.ring, pieceIndex: g.pieceIndex, cx, cz, open: 0 };
  });
}

export function stepGates(gates, hull, dt, tune = DRIVE_TUNE) {
  for (const g of gates) {
    const near = Math.hypot(hull.x - g.cx, hull.z - g.cz) <= tune.gateCells * CELL_M;
    const step = dt / tune.gateSecs;
    g.open = near ? Math.min(1, g.open + step) : Math.max(0, g.open - step);
  }
}

// Five cells outside a gate along its side's outward normal, facing in.
export function spawnFor(plate, g) {
  const [cx, cz] = gateCentre(plate, g);
  const [ox, oz] = DIRS[g.side];
  return { x: cx + ox * 5 * CELL_M, z: cz + oz * 5 * CELL_M, heading: yawOfSide[rotSide(g.side, 2)] };
}

// --- sentries ----------------------------------------------------------------
export function makeSentries(plate) {
  return plate.sentries.map((st, index) => ({
    index, cx: (st.x + 1) * CELL_M, cz: (st.z + 1) * CELL_M,
    home: st.yawDeg, arc: st.arcDeg, yaw: st.yawDeg, want: st.yawDeg,
    cool: 0, sweepDir: 1, tracking: false, rounds: 0,
    family: st.family, lob: LOB_FAMILIES.has(st.family),
    hp: 0, alive: true,
  }));
}

// SENTRIES ARE DAMAGEABLE. A hull round on a socket cell counts against the
// sentry standing there; at `sentryHits` it is broken: it stops tracking
// and firing, and it stays as a wreck of its own kind on its plinth (the
// scene poses it). The socket still blocks the hull; what changes for
// shells is the height: a wreck is low, and a round flies over it.
export function sentryAt(plate, sentries, x, z) {
  const cx = toCell(x), cz = toCell(z);
  if (cellKind(plate, cx, cz) !== KIND.SENTRY) return null;
  return sentries.find((s) => { const st = plate.sentries[s.index]; return st && cx >= st.x && cx < st.x + 2 && cz >= st.z && cz < st.z + 2; }) || null;
}
export function damageSentryAt(plate, sentries, x, z, tune = DRIVE_TUNE) {
  const s = sentryAt(plate, sentries, x, z);
  if (!s || !s.alive) return null;
  s.hp++;
  if (s.hp < tune.sentryHits) return { sentry: s, destroyed: false };
  s.alive = false; s.tracking = false;
  return { sentry: s, destroyed: true };
}

// A building blocks sight; the ring wall does not — the turrets stand above
// it and fire over it. Cover from a sentry is a building or its blind arc.
export function losClear(plate, ax, az, bx, bz) {
  const d = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(d / (CELL_M / 4)));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const cx = toCell(ax + (bx - ax) * t), cz = toCell(az + (bz - az) * t);
    if (cellKind(plate, cx, cz) !== KIND.BUILDING) continue;
    const pc = plate.pieces[plate.owner[cz * plate.w + cx]];
    if (!pc || (pc.state < 3 && !FLAT_IDS.has(pc.id))) return false; // rubble and pads hide nothing
  }
  return true;
}

export function stepSentries(sentries, hull, dt, los, tune = DRIVE_TUNE, isPowered = true) {
  const fired = [];
  for (const s of sentries) {
    if (s.alive === false || !isPowered) { s.tracking = false; continue; } // a wreck, or a dark one, sees nothing
    if (s.cool > 0) s.cool = Math.max(0, s.cool - dt);
    const bearing = bearingTo(s.cx, s.cz, hull.x, hull.z);
    const dist = Math.hypot(hull.x - s.cx, hull.z - s.cz);
    const inArc = Math.abs(wrapDeg(bearing - s.home)) <= s.arc / 2;
    const inRange = dist <= tune.fireCells * CELL_M;
    s.tracking = inArc && inRange && los(s.cx, s.cz, hull.x, hull.z);
    // a lobber aims where the hull will be when the shell lands
    let tx = hull.x, tz = hull.z;
    if (s.lob) {
      const flight = dist / tune.lobSpeed;
      tx += (hull.vx || 0) * flight; tz += (hull.vz || 0) * flight;
    }
    const aimBearing = s.lob ? bearingTo(s.cx, s.cz, tx, tz) : bearing;
    if (s.tracking) {
      s.want = aimBearing;
    } else {
      let rel = wrapDeg(s.want - s.home) + s.sweepDir * tune.sweepRate * dt;
      if (rel > s.arc / 2) { rel = s.arc / 2; s.sweepDir = -1; }
      if (rel < -s.arc / 2) { rel = -s.arc / 2; s.sweepDir = 1; }
      s.want = s.home + rel;
    }
    // slew the short way, at most yawRate * dt, then clamp INTO the arc
    const d = wrapDeg(s.want - s.yaw);
    const m = tune.yawRate * dt;
    let rel = wrapDeg(s.yaw + Math.max(-m, Math.min(m, d)) - s.home);
    rel = Math.max(-s.arc / 2, Math.min(s.arc / 2, rel));
    s.yaw = s.home + rel;
    if (s.tracking && Math.abs(wrapDeg(s.yaw - aimBearing)) <= tune.tolerance && s.cool <= 0) {
      s.rounds++;
      if (s.lob) {
        s.cool = tune.lobCooldown;
        const range = Math.hypot(tx - s.cx, tz - s.cz);
        fired.push({ kind: 'lob', x: s.cx, z: s.cz, x0: s.cx, z0: s.cz, tx, tz, t: 0,
          flight: Math.max(0.3, range / tune.lobSpeed), apex: tune.lobApex * Math.min(1, range / (tune.fireCells * CELL_M)) + 3,
          heading: s.yaw, from: s.index, hit: false, landed: false });
      } else {
        s.cool = tune.cooldown;
        fired.push({ kind: 'tracer', x: s.cx, z: s.cz, heading: s.yaw, left: tune.fireCells * CELL_M, from: s.index, hit: false });
      }
    }
  }
  return fired;
}

// --- tracers -----------------------------------------------------------------
function segDist(ax, az, bx, bz, px, pz) {
  const vx = bx - ax, vz = bz - az;
  const l2 = vx * vx + vz * vz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / l2));
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

// Advance every tracer; drop the spent, the stopped and the ones that hit.
// Returns how many hit the hull this step — a HUD number, not damage.
// A lob shell's height above the ground at its current point in flight.
export const lobHeight = (t) => { const u = Math.min(1, t.t / t.flight); return 4 * t.apex * u * (1 - u); };

// `groundY(x, z)` is the ground under a shell; `blockedRay(x, z, t)` may
// read `t.y` to decide whether a shell in flight clears what is below it.
export function stepTracers(tracers, hull, dt, blockedRay, tune = DRIVE_TUNE, groundY = () => 0) {
  let hits = 0;
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    if (t.kind === 'shot') {
      const nx = t.x + t.vx * dt, nz = t.z + t.vz * dt;
      const ny = t.y + t.vy * dt - 0.5 * tune.gravity * dt * dt;
      t.vy -= tune.gravity * dt;
      t.left -= Math.hypot(nx - t.x, nz - t.z);
      t.x = nx; t.z = nz; t.y = ny;
      const g = groundY(nx, nz);
      if (t.y <= g) { t.y = g; t.landed = true; blockedRay(nx, nz, t); tracers.splice(i, 1); continue; }
      if (t.left <= 0 || blockedRay(nx, nz, t)) tracers.splice(i, 1);
      continue;
    }
    if (t.kind === 'lob') {
      t.t += dt;
      const u = Math.min(1, t.t / t.flight);
      t.x = t.x0 + (t.tx - t.x0) * u; t.z = t.z0 + (t.tz - t.z0) * u;
      if (u >= 1) {
        t.landed = true;
        if (Math.hypot(hull.x - t.tx, hull.z - t.tz) <= tune.splashR) { t.hit = true; hits++; }
        blockedRay(t.tx, t.tz, t); // a landing: the tab draws the splash and plays it
        tracers.splice(i, 1);
      }
      continue;
    }
    const [dx, dz] = dirOfYaw(t.heading);
    const step = Math.min(t.left, (t.speed || tune.tracerSpeed) * dt);
    const nx = t.x + dx * step, nz = t.z + dz * step;
    if (!t.hit && segDist(t.x, t.z, nx, nz, hull.x, hull.z) <= tune.hitR) { t.hit = true; hits++; }
    t.x = nx; t.z = nz; t.left -= step;
    if (t.left <= 0 || t.hit || blockedRay(nx, nz, t)) tracers.splice(i, 1);
  }
  return hits;
}

export const buildingAt = (plate, x, z) => {
  const cx = toCell(x), cz = toCell(z);
  if (cellKind(plate, cx, cz) !== KIND.BUILDING) return false;
  const pc = plate.pieces[plate.owner[cz * plate.w + cx]];
  return !(pc && pc.state >= 3);
};
// what a hull shot stops on: anything that is not ground, road or an open lane
export const solidAt = (plate, gates, x, z) => blockedAt(plate, gates, x, z);
// how tall what stands on a cell is, metres: a shell above it flies on
export const SOLID_HEIGHT = { wall: 3.2, gate: 5.5, building: 7.0, sentry: 5.0, wreck: 1.6, prop: 1.5, body: 4.2 };
// `sentries` lets a broken sentry's cell be as low as its wreck
export function solidHeightAt(plate, x, z, sentries = null) {
  const k = cellKind(plate, toCell(x), toCell(z));
  if (k === KIND.WALL) return SOLID_HEIGHT.wall;
  if (k === KIND.GATE) return SOLID_HEIGHT.gate;
  if (k === KIND.BUILDING) { const pc = pieceAt(plate, toCell(x), toCell(z)); return pc && FLAT_IDS.has(pc.id) ? 0.3 : SOLID_HEIGHT.building; }
  if (k === KIND.SENTRY) { const s = sentries && sentryAt(plate, sentries, x, z); return s && !s.alive ? SOLID_HEIGHT.wreck : SOLID_HEIGHT.sentry; }
  if (k === KIND.PROP) return SOLID_HEIGHT.prop;
  return 0;
}
// the predicate for stepTracers: shots stop on solids they do not clear,
// sentry rounds on buildings only
export const rayStop = (plate, gates, bodies = [], sentries = null) => (x, z, t) => {
  if (!t || t.kind !== 'shot') return buildingAt(plate, x, z);
  const y = t.y ?? 0;
  if (bodyAt(bodies, x, z) && y <= SOLID_HEIGHT.body) return true;
  return solidAt(plate, gates, x, z) && y <= solidHeightAt(plate, x, z, sentries);
};
