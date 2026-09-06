// crew.js — THE CREW: astronauts walking about a base. Pure: no DOM, no
// three.js, Node-tested in test/crew.mjs. Each walker picks a cell it can
// see straight across walkable ground, walks there, pauses, picks another.
// crew-scene.js draws them with the compact astronaut and its walk clip.
//
// Local plate metres, like drive.js. Walkable is foundation and road; a
// walker never enters a wall, building, socket or gate cell, and never
// leaves the plate.
import { KIND, CELL_M } from './plate.js?v=e280e775';

export const CREW_TUNE = { walk: 1.4, idleMin: 0.8, idleMax: 3.0, reachMin: 3, reachMax: 14, radius: 0.35 };
export const SUITS = [0xf2f4f6, 0xff8c42, 0x7df9ff, 0xb6ff5c, 0xff5cf0, 0xffd166];

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

function pickTarget(plate, w, rng, tune) {
  for (let tries = 0; tries < 12; tries++) {
    const r = tune.reachMin + rng() * (tune.reachMax - tune.reachMin);
    const a = rng() * Math.PI * 2;
    const tx = w.x + Math.sin(a) * r * CELL_M / 2, tz = w.z - Math.cos(a) * r * CELL_M / 2;
    if (!crewWalkableAt(plate, tx, tz)) continue;
    if (!straightClear(plate, w.x, w.z, tx, tz)) continue;
    return [tx, tz];
  }
  return null;
}

// n walkers on random walkable cells inside the inner base
export function makeCrew(plate, n, rng, tune = CREW_TUNE) {
  const cells = [];
  const inset = plate.inset || 0;
  for (let z = inset + 1; z < plate.h - 1 - inset; z++) for (let x = inset + 1; x < plate.w - 1 - inset; x++) if (walkable(plate, x, z)) cells.push([x, z]);
  const crew = [];
  for (let i = 0; i < n && cells.length; i++) {
    const [cx, cz] = cells[Math.floor(rng() * cells.length)];
    const w = { x: (cx + 0.5) * CELL_M, z: (cz + 0.5) * CELL_M, heading: rng() * 360, target: null, wait: rng() * tune.idleMax, suit: i % SUITS.length, moving: false };
    crew.push(w);
  }
  return crew;
}

export function stepCrew(crew, plate, dt, rng, tune = CREW_TUNE) {
  for (const w of crew) {
    if (!w.target) {
      w.moving = false;
      w.wait -= dt;
      if (w.wait > 0) continue;
      w.target = pickTarget(plate, w, rng, tune);
      if (!w.target) { w.wait = tune.idleMin; continue; }
    }
    const dx = w.target[0] - w.x, dz = w.target[1] - w.z;
    const d = Math.hypot(dx, dz);
    const step = tune.walk * dt;
    w.heading = Math.atan2(dx, -dz) * 180 / Math.PI;
    if (d <= step) {
      w.x = w.target[0]; w.z = w.target[1]; w.target = null; w.moving = false;
      w.wait = tune.idleMin + rng() * (tune.idleMax - tune.idleMin);
      continue;
    }
    const nx = w.x + dx / d * step, nz = w.z + dz / d * step;
    if (!crewWalkableAt(plate, nx, nz)) { w.target = null; w.moving = false; w.wait = tune.idleMin; continue; }
    w.x = nx; w.z = nz; w.moving = true;
  }
}
