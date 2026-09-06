// crew.js — THE CREW: astronauts about a base. Pure: no DOM, no three.js,
// Node-tested in test/crew.mjs. They walk from key area to key area — the
// fronts of buildings, the gates, the infirmary — pause, and go again;
// sometimes they run. An ENEMY hull nearby makes them run away from it.
// And, the Amiga homage: a hull that drives over one leaves a red splash
// on the floor, friendly or not.
//
// Local plate metres, like drive.js. Walkable is foundation and road; a
// walker never enters a wall, building, socket or gate cell, and never
// leaves the plate.
import { KIND, CELL_M, rotSide, DIRS } from './plate.js?v=83129e6c';

export const CREW_TUNE = {
  walk: 1.4, run: 4.6,      // m/s
  idleMin: 1.0, idleMax: 4.0,
  runChance: 0.15,          // a trip taken at a run for no reason
  fleeM: 32, safeM: 48,     // an enemy hull inside fleeM starts a flight that ends past safeM
  radius: 0.35,
  squashM: 0.6,             // beyond the hull's own radius
  squashSpeed: 2.0,         // m/s the hull must be doing
};
export const SUIT = 0xff7a1a; // orange, every one of them

const walkable = (plate, cx, cz) => {
  if (cx < 1 || cz < 1 || cx >= plate.w - 1 || cz >= plate.h - 1) return false;
  const k = plate.cells[cz * plate.w + cx];
  return k === KIND.FOUNDATION || k === KIND.ROAD;
};
export const crewWalkableAt = (plate, x, z) => walkable(plate, Math.floor(x / CELL_M), Math.floor(z / CELL_M));

// every quarter cell along the way must be walkable
function straightClear(plate, ax, az, bx, bz) {
  const d = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(d / (CELL_M / 4)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (!crewWalkableAt(plate, ax + (bx - ax) * t, az + (bz - az) * t)) return false;
  }
  return true;
}

// THE KEY AREAS: the walkable cell in front of each building's entrance
// (its authored S face, turned by rot), the cell inside each gate, and any
// walkable cell touching the infirmary. In metres, cell centres.
export function keyAreas(plate) {
  const out = [];
  const push = (cx, cz, tag) => { if (walkable(plate, cx, cz)) out.push({ x: (cx + 0.5) * CELL_M, z: (cz + 0.5) * CELL_M, tag }); };
  for (const pc of plate.pieces) {
    if (pc.kind === KIND.BUILDING && pc.zone !== 'band' && pc.id !== 'logistics_container') {
      const side = rotSide('S', pc.rot);
      const [dx, dz] = DIRS[side];
      const mx = pc.x + Math.floor(pc.pw / 2), mz = pc.z + Math.floor(pc.ph / 2);
      const cx = side === 'E' ? pc.x + pc.pw : side === 'W' ? pc.x - 1 : mx;
      const cz = side === 'S' ? pc.z + pc.ph : side === 'N' ? pc.z - 1 : mz;
      push(cx, cz, pc.landmark ? 'infirmary' : pc.id);
      void dx; void dz;
    }
  }
  for (const g of plate.gates) {
    if (g.ring !== 'inner' && plate.inset > 0) continue;
    const [ox, oz] = DIRS[g.side];
    const gc = plate.pieces[g.pieceIndex];
    push(Math.floor(gc.x + gc.pw / 2 - ox * 2), Math.floor(gc.z + gc.ph / 2 - oz * 2), 'gate');
  }
  return out;
}

// Flight: straight away from the threat, 16 m, trying the away line and
// then fans of 30 degrees either side; the first clear one wins. Null when
// every way is blocked.
export function fleePoint(plate, w, threat) {
  const ax = w.x - threat.x, az = w.z - threat.z;
  const base = Math.atan2(az, ax);
  // a long dash first; a walker beside a building may only have a short one
  for (const reach of [16, 10, 6]) {
    for (const off of [0, 0.52, -0.52, 1.05, -1.05, 1.57, -1.57]) {
      const a = base + off;
      const tx = w.x + Math.cos(a) * reach, tz = w.z + Math.sin(a) * reach;
      if (crewWalkableAt(plate, tx, tz) && straightClear(plate, w.x, w.z, tx, tz)) return { x: tx, z: tz, tag: 'flee' };
    }
  }
  return null;
}

function pickArea(plate, w, areas, rng, avoid = null) {
  const seen = areas.filter((a) => Math.hypot(a.x - w.x, a.z - w.z) > 2 && straightClear(plate, w.x, w.z, a.x, a.z));
  if (avoid) {
    // flee: away from the threat if the ground allows, else the reachable
    // area farthest from it, and only if that is farther than here
    const away = fleePoint(plate, w, avoid);
    if (away) return away;
    // ...and never a run PAST the threat: an area counts only if it lies
    // on the walker's side away from it. Cornered, a walker stays.
    const dHere = Math.hypot(w.x - avoid.x, w.z - avoid.z);
    const far = seen.filter((a) => Math.hypot(a.x - avoid.x, a.z - avoid.z) > dHere + 4
      && (a.x - w.x) * (w.x - avoid.x) + (a.z - w.z) * (w.z - avoid.z) > 0);
    if (!far.length) return null;
    return far.reduce((best, a) => (Math.hypot(a.x - avoid.x, a.z - avoid.z) > Math.hypot(best.x - avoid.x, best.z - avoid.z) ? a : best), far[0]);
  }
  if (!seen.length) return null;
  return seen[Math.floor(rng() * seen.length)];
}

// n walkers, standing at key areas (or on random walkable cells inside the
// base when there are fewer areas than walkers)
export function makeCrew(plate, n, rng, tune = CREW_TUNE) {
  const areas = keyAreas(plate);
  const cells = [];
  const inset = plate.inset || 0;
  for (let z = inset + 1; z < plate.h - 1 - inset; z++) for (let x = inset + 1; x < plate.w - 1 - inset; x++) if (walkable(plate, x, z)) cells.push([x, z]);
  const crew = [];
  for (let i = 0; i < n && (areas.length || cells.length); i++) {
    let x, z;
    if (areas.length) { const a = areas[Math.floor(rng() * areas.length)]; x = a.x; z = a.z; }
    else { const [cx, cz] = cells[Math.floor(rng() * cells.length)]; x = (cx + 0.5) * CELL_M; z = (cz + 0.5) * CELL_M; }
    crew.push({ x, z, heading: rng() * 360, target: null, wait: rng() * tune.idleMax, running: false, fleeing: false, moving: false, alive: true });
  }
  return { walkers: crew, areas };
}

// One step. `threat` is an enemy hull's position in plate metres, or null.
export function stepCrew(crew, plate, dt, rng, threat = null, tune = CREW_TUNE) {
  const { walkers, areas } = crew;
  for (const w of walkers) {
    if (!w.alive) continue;
    const near = threat ? Math.hypot(threat.x - w.x, threat.z - w.z) : Infinity;
    if (threat && near < tune.fleeM && !w.fleeing) {
      w.fleeing = true; w.running = true; w.target = pickArea(plate, w, areas, rng, threat); w.wait = 0;
    }
    if (w.fleeing && near > tune.safeM && !w.target) w.fleeing = false;
    if (!w.target) {
      w.moving = false;
      w.wait -= dt;
      if (w.wait > 0) continue;
      w.target = pickArea(plate, w, areas, rng, w.fleeing ? threat : null);
      w.running = w.fleeing || rng() < tune.runChance;
      if (!w.target) { w.wait = tune.idleMin; continue; }
    }
    const dx = w.target.x - w.x, dz = w.target.z - w.z;
    const d = Math.hypot(dx, dz);
    const step = (w.running ? tune.run : tune.walk) * dt;
    w.heading = Math.atan2(dx, -dz) * 180 / Math.PI;
    if (d <= step) {
      w.x = w.target.x; w.z = w.target.z; w.target = null; w.moving = false;
      w.wait = w.fleeing ? 0.2 : tune.idleMin + rng() * (tune.idleMax - tune.idleMin);
      continue;
    }
    const nx = w.x + dx / d * step, nz = w.z + dz / d * step;
    if (!crewWalkableAt(plate, nx, nz)) { w.target = null; w.moving = false; w.wait = tune.idleMin; continue; }
    w.x = nx; w.z = nz; w.moving = true;
  }
}

// The Amiga moment: a hull moving over a walker. Returns the walkers it
// squashed this step, marked dead, for the splash.
export function stepSquash(crew, hull, hullR, tune = CREW_TUNE) {
  const out = [];
  if (Math.abs(hull.speed || 0) < tune.squashSpeed) return out;
  for (const w of crew.walkers) {
    if (!w.alive) continue;
    if (Math.hypot(hull.x - w.x, hull.z - w.z) <= hullR + tune.squashM) { w.alive = false; w.moving = false; out.push(w); }
  }
  return out;
}
