// radar.js — the scope's arithmetic, pure and tested. The reference's PPI
// idiom (a rotating beam, contacts that flare when it passes and decay
// behind it) on a flat plane: heading-up, the hull at the centre, a
// contact beyond range pinned to the rim. The painting lives in
// drive-rig.js; the conventions live here, where a test can hold them.
export const SWEEP_PERIOD = 2.6;    // seconds per revolution
export const PHOSPHOR_DECAY = 1.12; // brightness lost per full turn behind the beam
export const RADAR_RANGE_M = 220;

// who is what on the scope: ours blue (static) and dark blue (people),
// theirs red (static) and orange (people); the hull itself is white
export const RADAR_COLORS = {
  'home:static': '#3f8fff', 'home:unit': '#1f4fb0',
  'hostile:static': '#ff4d4d', 'hostile:unit': '#ff9a3c',
  self: '#e8fbff',
};
export const radarColor = (side, kind) => (side === 'self' ? RADAR_COLORS.self : RADAR_COLORS[`${side}:${kind}`] || '#888');

// A world point onto the scope, in scope-radius units, heading-up: y is
// SCREEN y (down positive). A contact straight ahead of the hull sits at
// (0, -d/range); one off its right at (+, 0).
export function radarProject(x, z, hx, hz, headingDeg, range = RADAR_RANGE_M) {
  const a = headingDeg * Math.PI / 180;
  const fx = Math.sin(a), fz = -Math.cos(a);   // forward
  const rx = Math.cos(a), rz = Math.sin(a);    // right
  const dx = x - hx, dz = z - hz;
  let sx = (dx * rx + dz * rz) / range;
  let sy = -(dx * fx + dz * fz) / range;
  const len = Math.hypot(sx, sy);
  const clamped = len > 1;
  if (clamped) { sx /= len; sy /= len; }
  return { x: sx, y: sy, clamped };
}
// bearing of a scope point, radians clockwise from screen-north
export const radarBearing = (x, y) => Math.atan2(x, -y);
export function sweepAngle(t) { const TAU = Math.PI * 2; return ((t / SWEEP_PERIOD) * TAU) % TAU; }
// 1 the instant the beam passes, decaying behind it, never fully dark
export function radarPhosphor(bearing, sweep) {
  const TAU = Math.PI * 2;
  const age = (((sweep - bearing) % TAU) + TAU) % TAU / TAU;
  return Math.max(0.16, 1 - age * PHOSPHOR_DECAY);
}
