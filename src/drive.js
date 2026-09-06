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
import { makeParams, clampParams, formatKnobs, knobProblems } from './knobs.js?v=979b8ccb';
import { KIND, CELL_M, wrapDeg, dirOfYaw, DIRS, yawOfSide, rotSide } from './plate.js?v=979b8ccb';

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
  fireCells: 9,     // engagement range, cells
  tracerSpeed: 40,  // m/s
  hitR: 2.4,        // m, a tracer this close to the hull centre is a hit
};

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
  { key: 'fireCells', label: 'range (cells)', group: 'sentries', min: 2, max: 20, step: 1 },
  { key: 'tracerSpeed', label: 'tracer speed (m/s)', group: 'sentries', min: 5, max: 120, step: 5 },
  { key: 'hitR', label: 'hit radius (m)', group: 'sentries', min: 0.5, max: 6, step: 0.1 },
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
export function makeHull(x, z, heading = 0) {
  return { x, z, heading, speed: 0 };
}

// Turn, then move along the heading. The move is accepted when the four
// points at hullR around the new centre are free; else the x part alone,
// else the z part alone, else it stops. Sliding is what lets a hull hug a
// wall, which is what cover means.
export function stepHull(hull, input, dt, blocked, tune = DRIVE_TUNE) {
  const turn = ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * tune.turnRate * dt;
  hull.heading = wrapDeg(hull.heading + turn);
  const v = input.fwd ? tune.speed : input.rev ? -tune.reverse : 0;
  hull.speed = v;
  if (v === 0) return false;
  const [dx, dz] = dirOfYaw(hull.heading);
  const mx = dx * v * dt, mz = dz * v * dt;
  const r = tune.hullR;
  const freeAt = (x, z) => !blocked(x + r, z) && !blocked(x - r, z) && !blocked(x, z + r) && !blocked(x, z - r);
  if (freeAt(hull.x + mx, hull.z + mz)) { hull.x += mx; hull.z += mz; return true; }
  if (mx !== 0 && freeAt(hull.x + mx, hull.z)) { hull.x += mx; return true; }
  if (mz !== 0 && freeAt(hull.x, hull.z + mz)) { hull.z += mz; return true; }
  return false;
}

// --- occupancy ---------------------------------------------------------------
// Outside the plate is open ground. A gate passes inside its LANE when it
// is open: the kit's clearance is 8 m wide, centred on the gate axis, so
// the lane is metric — 4 m either side of the axis — and the rest of the
// gate's three cells are the towers, which always block.
export const GATE_LANE_HALF_M = 4;
export function blockedAt(plate, gates, x, z) {
  const cx = toCell(x), cz = toCell(z);
  const k = cellKind(plate, cx, cz);
  if (k < 0) return false;
  if (k === KIND.WALL || k === KIND.BUILDING || k === KIND.SENTRY || k === KIND.PROP) return true;
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

// --- gates -------------------------------------------------------------------
export function gateCentre(plate, g) {
  const pc = plate.pieces[g.pieceIndex];
  return [(pc.x + pc.pw / 2 + pc.offset[0]) * CELL_M, (pc.z + pc.ph / 2 + pc.offset[1]) * CELL_M];
}

export function makeGates(plate) {
  return plate.gates.map((g) => {
    const [cx, cz] = gateCentre(plate, g);
    return { side: g.side, at: g.at, pieceIndex: g.pieceIndex, cx, cz, open: 0 };
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
  }));
}

// A building blocks sight; the ring wall does not — the turrets stand above
// it and fire over it. Cover from a sentry is a building or its blind arc.
export function losClear(plate, ax, az, bx, bz) {
  const d = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(d / (CELL_M / 4)));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (cellKind(plate, toCell(ax + (bx - ax) * t), toCell(az + (bz - az) * t)) === KIND.BUILDING) return false;
  }
  return true;
}

export function stepSentries(sentries, hull, dt, los, tune = DRIVE_TUNE) {
  const fired = [];
  for (const s of sentries) {
    if (s.cool > 0) s.cool = Math.max(0, s.cool - dt);
    const bearing = bearingTo(s.cx, s.cz, hull.x, hull.z);
    const dist = Math.hypot(hull.x - s.cx, hull.z - s.cz);
    const inArc = Math.abs(wrapDeg(bearing - s.home)) <= s.arc / 2;
    const inRange = dist <= tune.fireCells * CELL_M;
    s.tracking = inArc && inRange && los(s.cx, s.cz, hull.x, hull.z);
    if (s.tracking) {
      s.want = bearing;
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
    if (s.tracking && Math.abs(wrapDeg(s.yaw - bearing)) <= tune.tolerance && s.cool <= 0) {
      s.cool = tune.cooldown;
      s.rounds++;
      fired.push({ x: s.cx, z: s.cz, heading: s.yaw, left: tune.fireCells * CELL_M, from: s.index, hit: false });
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
export function stepTracers(tracers, hull, dt, blockedRay, tune = DRIVE_TUNE) {
  let hits = 0;
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    const [dx, dz] = dirOfYaw(t.heading);
    const step = Math.min(t.left, tune.tracerSpeed * dt);
    const nx = t.x + dx * step, nz = t.z + dz * step;
    if (!t.hit && segDist(t.x, t.z, nx, nz, hull.x, hull.z) <= tune.hitR) { t.hit = true; hits++; }
    t.x = nx; t.z = nz; t.left -= step;
    if (t.left <= 0 || t.hit || blockedRay(nx, nz)) tracers.splice(i, 1);
  }
  return hits;
}

export const buildingAt = (plate, x, z) => cellKind(plate, toCell(x), toCell(z)) === KIND.BUILDING;
