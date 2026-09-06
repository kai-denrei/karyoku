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
import { makeParams, clampParams, formatKnobs, knobProblems } from './knobs.js?v=9a9954fb';
import { KIND, CELL_M, wrapDeg, dirOfYaw, DIRS, yawOfSide, rotSide } from './plate.js?v=9a9954fb';

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
  shotSpeed: 70,    // m/s
  shotRange: 90,    // m
  shotCooldown: 0.6,
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
  { key: 'fireCells', label: 'range (cells)', group: 'sentries', min: 2, max: 20, step: 1 },
  { key: 'tracerSpeed', label: 'tracer speed (m/s)', group: 'sentries', min: 5, max: 120, step: 5 },
  { key: 'hitR', label: 'hit radius (m)', group: 'sentries', min: 0.5, max: 6, step: 0.1 },
  { key: 'lobSpeed', label: 'shell speed (m/s)', group: 'lobbers', min: 5, max: 80, step: 1 },
  { key: 'lobApex', label: 'shell apex (m)', group: 'lobbers', min: 2, max: 60, step: 1 },
  { key: 'splashR', label: 'splash radius (m)', group: 'lobbers', min: 1, max: 15, step: 0.5 },
  { key: 'lobCooldown', label: 'lob cooldown (s)', group: 'lobbers', min: 0.5, max: 10, step: 0.1 },
  { key: 'shotSpeed', label: 'shot speed (m/s)', group: 'gun', min: 10, max: 200, step: 5 },
  { key: 'shotRange', label: 'shot range (m)', group: 'gun', min: 10, max: 300, step: 5 },
  { key: 'shotCooldown', label: 'shot cooldown (s)', group: 'gun', min: 0.1, max: 3, step: 0.1 },
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
  return { x, z, heading, speed: 0, vx: 0, vz: 0, cool: 0, shots: 0 };
}

// Turn, then move along the heading. The move is accepted when the four
// points at hullR around the new centre are free; else the x part alone,
// else the z part alone, else it stops. Sliding is what lets a hull hug a
// wall, which is what cover means.
export function stepHull(hull, input, dt, blocked, tune = DRIVE_TUNE) {
  if (hull.cool > 0) hull.cool = Math.max(0, hull.cool - dt);
  const turn = ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * tune.turnRate * dt;
  hull.heading = wrapDeg(hull.heading + turn);
  const v = input.fwd ? tune.speed : input.rev ? -tune.reverse : 0;
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
  return false;
}

// Fire the main gun: a shot from 4 m ahead of the hull centre along the
// heading, or null while the gun is cooling.
export function fireHull(hull, tune = DRIVE_TUNE) {
  if (hull.cool > 0) return null;
  hull.cool = tune.shotCooldown;
  hull.shots++;
  const [dx, dz] = dirOfYaw(hull.heading);
  return { kind: 'shot', x: hull.x + dx * 4, z: hull.z + dz * 4, heading: hull.heading, left: tune.shotRange, from: -1, hit: false,
    speed: tune.shotSpeed };
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
export const BODY_IDS = new Set(['logistics_container']);
export function makeBodies(plate, ox = 0, oz = 0) {
  const out = [];
  plate.pieces.forEach((pc, pieceIndex) => {
    if (!BODY_IDS.has(pc.id)) return;
    for (let dz = 0; dz < pc.ph; dz++) for (let dx = 0; dx < pc.pw; dx++) {
      const i = (pc.z + dz) * plate.w + pc.x + dx;
      plate.cells[i] = KIND.FOUNDATION; plate.owner[i] = -1;
    }
    // half extents in the piece's own frame; rot 1 and 3 swap the placed dims back
    const swap = pc.rot % 2 === 1;
    out.push({
      pieceIndex, plate,
      x: ox + (pc.x + pc.pw / 2 + pc.offset[0]) * CELL_M, z: oz + (pc.z + pc.ph / 2 + pc.offset[1]) * CELL_M,
      hw: (swap ? pc.ph : pc.pw) * CELL_M / 2 - 0.2, hd: (swap ? pc.pw : pc.ph) * CELL_M / 2 - 0.2,
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
  const [lx, lz] = toLocal(b, x, z);
  return Math.abs(lx) <= b.hw && Math.abs(lz) <= b.hd;
}
export const bodyAt = (bodies, x, z) => bodies.some((b) => bodyContains(b, x, z));
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
export function stepBodies(bodies, hull, blocked, tune = DRIVE_TUNE) {
  let moved = 0;
  for (const b of bodies) {
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
    if (bodyFits(b, b.x - nx * pen, b.z - nz * pen, bodies, blocked)) { b.x -= nx * pen; b.z -= nz * pen; moved++; }
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
export function blockedAt(plate, gates, x, z) {
  const cx = toCell(x), cz = toCell(z);
  const k = cellKind(plate, cx, cz);
  if (k < 0) return false;
  if (k === KIND.WALL || k === KIND.BUILDING) {
    // a wall or building shot down to D3 is rubble: driveable
    const pc = plate.pieces[plate.owner[cz * plate.w + cx]];
    return !(pc && pc.state >= 3);
  }
  if (k === KIND.SENTRY || k === KIND.PROP) return true;
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
  }));
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
    if (!pc || pc.state < 3) return false; // rubble no longer hides anything
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

export function stepTracers(tracers, hull, dt, blockedRay, tune = DRIVE_TUNE) {
  let hits = 0;
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    if (t.kind === 'lob') {
      t.t += dt;
      const u = Math.min(1, t.t / t.flight);
      t.x = t.x0 + (t.tx - t.x0) * u; t.z = t.z0 + (t.tz - t.z0) * u;
      if (u >= 1) {
        t.landed = true;
        if (Math.hypot(hull.x - t.tx, hull.z - t.tz) <= tune.splashR) { t.hit = true; hits++; }
        tracers.splice(i, 1);
      }
      continue;
    }
    const [dx, dz] = dirOfYaw(t.heading);
    const step = Math.min(t.left, (t.speed || tune.tracerSpeed) * dt);
    const nx = t.x + dx * step, nz = t.z + dz * step;
    if (t.kind !== 'shot' && !t.hit && segDist(t.x, t.z, nx, nz, hull.x, hull.z) <= tune.hitR) { t.hit = true; hits++; }
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
// the predicate for stepTracers: shots stop on solids, sentry rounds on buildings only
export const rayStop = (plate, gates, bodies = []) => (x, z, t) => (t && t.kind === 'shot') ? (solidAt(plate, gates, x, z) || bodyAt(bodies, x, z)) : buildingAt(plate, x, z);
