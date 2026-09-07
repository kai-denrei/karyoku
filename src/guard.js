// guard.js — THE RECKON GUARD: one drone per base, hovering a slow circle
// over its centre. Against an enemy hull in range it does not fire at
// once: it MARKS where the hull will be (a red pointer on the ground,
// held for markT) and only then drops a shell on the mark. The mark is
// fixed the moment it is laid, so the skill is seeing it and not being
// there when the shell lands. Pure; test/guard.mjs.
export const GUARD_TUNE = {
  alt: 14,          // m above the ground it hovers at
  orbitR: 18,       // m, its slow circle over the station
  orbitRate: 10,    // deg/s around that circle
  range: 140,       // m: an enemy hull inside this is engaged
  leadT: 1.4,       // s: the mark is laid where the hull will be after this
  markT: 1.4,       // s the pointer holds before the shell drops
  cooldown: 2.2,    // s between shells (operator: it should shoot faster)
  shellSpeed: 42,   // m/s along the ground
  apex: 3,          // m of arc above the straight fall
};
export function makeGuard(cx, cz, hostile = true, tune = GUARD_TUNE) {
  return { cx, cz, x: cx + tune.orbitR, z: cz, y: tune.alt, ang: 0, heading: 0, state: 'idle', mark: null, markT: 0, cool: 0, alive: true, shots: 0, hostile };
}
// one step; returns { mark } the frame a pointer is laid and { shot } the
// frame a shell leaves (a lob tracer with a start height)
export function stepGuard(g, hull, dt, tune = GUARD_TUNE) {
  const out = {};
  if (!g.alive) return out;
  g.ang = (g.ang + tune.orbitRate * dt) % 360;
  const a = g.ang * Math.PI / 180;
  g.x = g.cx + Math.cos(a) * tune.orbitR; g.z = g.cz + Math.sin(a) * tune.orbitR;
  g.heading = Math.atan2(hull.x - g.x, -(hull.z - g.z)) * 180 / Math.PI;
  if (g.cool > 0) g.cool = Math.max(0, g.cool - dt);
  if (!g.hostile) return out;
  const d = Math.hypot(hull.x - g.x, hull.z - g.z);
  if (g.state === 'idle') {
    if (d <= tune.range && g.cool <= 0) {
      g.state = 'mark';
      g.mark = { x: hull.x + (hull.vx || 0) * tune.leadT, z: hull.z + (hull.vz || 0) * tune.leadT };
      g.markT = tune.markT;
      out.mark = { ...g.mark };
    }
    return out;
  }
  if (g.state === 'mark') {
    g.markT -= dt;
    if (g.markT > 0) return out;
    const range = Math.hypot(g.mark.x - g.x, g.mark.z - g.z);
    out.shot = { kind: 'lob', x: g.x, z: g.z, x0: g.x, z0: g.z, y0: g.y, tx: g.mark.x, tz: g.mark.z, t: 0,
      flight: Math.max(0.5, range / tune.shellSpeed), apex: tune.apex, heading: g.heading, from: 'guard', hit: false, landed: false };
    g.shots++;
    g.state = 'idle'; g.cool = tune.cooldown; g.mark = null;
  }
  return out;
}
