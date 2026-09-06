// crew.js — THE CREW: astronauts about a base. Pure: no DOM, no three.js,
// Node-tested in test/crew.mjs. They walk from key area to key area — the
// fronts of buildings, the gates, the infirmary — pause, and go again;
// sometimes they run. An ENEMY hull nearby makes them run away from it.
// And, the Amiga homage: a hull that drives over one leaves a red splash
// on the floor, friendly or not.
//
// Local plate metres, like drive.js. Walkable is foundation and road; a
// walker never enters a wall, building, socket or gate cell, and never
// leaves the plate. The cells do not know everything solid: the drive
// turns containers into BODIES and frees their cells, and the hull is a
// vehicle, not a cell. Both come in through `solid(x, z)`, a predicate the
// tab composes from bodyAt and hullCovers; every walkability test here
// asks it too, with the walker's own radius, so nobody walks through a
// container or the tank. Something that rolls onto a walker slowly shoves
// them out (`escape`); fast, it squashes them (stepSquash).
import { KIND, CELL_M, rotSide, DIRS } from './plate.js?v=8de06158';

export const CREW_TUNE = {
  walk: 1.4, run: 4.6,      // m/s
  idleMin: 1.0, idleMax: 4.0,
  runChance: 0.15,          // a trip taken at a run for no reason
  fleeM: 32, safeM: 48,     // an enemy hull inside fleeM starts a flight that ends past safeM
  radius: 0.35,
  hullHalfL: 4.0, hullHalfW: 1.9, // the MKCX as a box to a walker: 7.8 m long, 3.5 m wide, plus a step
  escapeM: 3,               // how far a shoved walker is moved to find free ground
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

// The hull as an oriented box in plate metres. Heading is compass degrees,
// forward is [sin, -cos] (drive.js), right is [cos, sin].
export function hullCovers(hull, x, z, tune = CREW_TUNE) {
  if (!hull) return false;
  const a = (hull.heading || 0) * Math.PI / 180;
  const fx = Math.sin(a), fz = -Math.cos(a);
  const dx = x - hull.x, dz = z - hull.z;
  const along = dx * fx + dz * fz, across = dx * -fz + dz * fx;
  return Math.abs(along) <= tune.hullHalfL && Math.abs(across) <= tune.hullHalfW;
}

// Free for a walker: the centre and four points at its radius all on
// walkable cells and clear of every solid. The radius is what keeps a
// walker from clipping a corner it is walking past.
const DISC = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
export function crewFreeAt(plate, x, z, solid = null, r = CREW_TUNE.radius) {
  for (const [ox, oz] of DISC) {
    const px = x + ox * r, pz = z + oz * r;
    if (!crewWalkableAt(plate, px, pz)) return false;
    if (solid && solid(px, pz)) return false;
  }
  return true;
}

// every quarter cell along the way must be free
function straightClear(plate, ax, az, bx, bz, solid = null) {
  const d = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(d / (CELL_M / 4)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (!crewFreeAt(plate, ax + (bx - ax) * t, az + (bz - az) * t, solid)) return false;
  }
  return true;
}

// The nearest free point in rings around a walker something has rolled
// onto, up to escapeM away: the shove. Null when there is none.
export function escape(plate, w, solid, tune = CREW_TUNE) {
  for (let r = 0.5; r <= tune.escapeM; r += 0.5) {
    for (let k = 0; k < 12; k++) {
      const a = w.heading * Math.PI / 180 + k * Math.PI / 6;
      const x = w.x + Math.sin(a) * r, z = w.z - Math.cos(a) * r;
      if (crewFreeAt(plate, x, z, solid)) return { x, z };
    }
  }
  return null;
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
export function fleePoint(plate, w, threat, solid = null) {
  const ax = w.x - threat.x, az = w.z - threat.z;
  const base = Math.atan2(az, ax);
  // a long dash first; a walker beside a building may only have a short one
  for (const reach of [16, 10, 6]) {
    for (const off of [0, 0.52, -0.52, 1.05, -1.05, 1.57, -1.57]) {
      const a = base + off;
      const tx = w.x + Math.cos(a) * reach, tz = w.z + Math.sin(a) * reach;
      if (straightClear(plate, w.x, w.z, tx, tz, solid)) return { x: tx, z: tz, tag: 'flee' };
    }
  }
  return null;
}

function pickArea(plate, w, areas, rng, avoid = null, solid = null) {
  const seen = areas.filter((a) => Math.hypot(a.x - w.x, a.z - w.z) > 2 && straightClear(plate, w.x, w.z, a.x, a.z, solid));
  if (avoid) {
    // flee: away from the threat if the ground allows, else the reachable
    // area farthest from it, and only if that is farther than here
    const away = fleePoint(plate, w, avoid, solid);
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
export function makeCrew(plate, n, rng, tune = CREW_TUNE, solid = null) {
  const areas = keyAreas(plate);
  const cells = [];
  const inset = plate.inset || 0;
  for (let z = inset + 1; z < plate.h - 1 - inset; z++) for (let x = inset + 1; x < plate.w - 1 - inset; x++) if (walkable(plate, x, z)) cells.push([x, z]);
  const crew = [];
  for (let i = 0; i < n && (areas.length || cells.length); i++) {
    let x, z;
    if (areas.length) { const a = areas[Math.floor(rng() * areas.length)]; x = a.x; z = a.z; }
    else { const [cx, cz] = cells[Math.floor(rng() * cells.length)]; x = (cx + 0.5) * CELL_M; z = (cz + 0.5) * CELL_M; }
    const w = { x, z, heading: rng() * 360, target: null, wait: rng() * tune.idleMax, running: false, fleeing: false, moving: false, alive: true };
    // never born inside a container: shoved to the nearest free ground
    if (!crewFreeAt(plate, w.x, w.z, solid)) { const e = escape(plate, w, solid, tune); if (e) { w.x = e.x; w.z = e.z; } }
    crew.push(w);
  }
  return { walkers: crew, areas };
}

// One step. `threat` is an enemy hull's position in plate metres, or null.
// `solid(x, z)` is what the cells do not know: bodies and the hull.
export function stepCrew(crew, plate, dt, rng, threat = null, tune = CREW_TUNE, solid = null) {
  const { walkers, areas } = crew;
  for (const w of walkers) {
    if (!w.alive) continue;
    // something rolled onto this walker (a slow hull, a pushed container):
    // shove them to the nearest free ground and let them pick again
    if (solid && !crewFreeAt(plate, w.x, w.z, solid)) {
      const e = escape(plate, w, solid, tune);
      if (e) { w.x = e.x; w.z = e.z; w.target = null; w.wait = 0.3; w.moving = false; }
    }
    const near = threat ? Math.hypot(threat.x - w.x, threat.z - w.z) : Infinity;
    if (threat && near < tune.fleeM && !w.fleeing) {
      w.fleeing = true; w.running = true; w.target = pickArea(plate, w, areas, rng, threat, solid); w.wait = 0;
    }
    if (w.fleeing && near > tune.safeM && !w.target) w.fleeing = false;
    if (!w.target) {
      w.moving = false;
      w.wait -= dt;
      if (w.wait > 0) continue;
      w.target = pickArea(plate, w, areas, rng, w.fleeing ? threat : null, solid);
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
    // the way was clear when the trip was picked; a container may have been
    // pushed into it or the hull parked across it since. Slide along the
    // obstacle if that still gains ground; otherwise give the trip up.
    let mx = nx, mz = nz, ok = crewFreeAt(plate, nx, nz, solid);
    if (!ok && crewFreeAt(plate, nx, w.z, solid) && Math.hypot(w.target.x - nx, w.target.z - w.z) < d - step * 0.1) { mx = nx; mz = w.z; ok = true; }
    if (!ok && crewFreeAt(plate, w.x, nz, solid) && Math.hypot(w.target.x - w.x, w.target.z - nz) < d - step * 0.1) { mx = w.x; mz = nz; ok = true; }
    if (!ok) { w.target = null; w.moving = false; w.wait = w.fleeing ? 0.2 : tune.idleMin; continue; }
    w.x = mx; w.z = mz; w.moving = true;
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
