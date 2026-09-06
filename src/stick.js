// stick.js — A FLOATING STICK, as arithmetic.
//
// The shell removed the steering pads and the throttle (tap-to-go commands
// the tank) and put nothing in their place for the moments a player wants
// to DRIVE — back out of a corner, line up a ram, nudge a metre. The stick
// is the standard answer on glass: touch anywhere on the left half, a ring
// appears under the finger, drag to drive. A finger that never leaves the
// dead zone was a tap, and a tap is still tap-to-go.
//
// The desktop's manual kinematics take a throttle (−rev..1) and two steer
// booleans (left/right at STEER_RATE), so that is what a stick vector
// becomes. Pure: pixels in, controls out. Tested in Node.

export const STICK = { radius: 72, dead: 12, steerBand: 0.28, rev: 0.55 };

// dx, dy in CSS px from the touch origin; +dy is DOWN on screen.
export function stickVector(dx, dy, cfg = STICK) {
  const r = cfg.radius, d = Math.hypot(dx, dy);
  if (!(d > cfg.dead)) return { active: false, throttle: 0, steer: 0, left: false, right: false };
  const nx = Math.max(-1, Math.min(1, dx / r));
  const ny = Math.max(-1, Math.min(1, -dy / r));       // up = forward
  const throttle = ny >= 0 ? ny : Math.max(-cfg.rev, ny * cfg.rev);
  return {
    active: true,
    throttle,
    steer: nx,
    left: nx < -cfg.steerBand,
    right: nx > cfg.steerBand,
  };
}

// Where the knob draws, clamped to the ring.
export function knobOffset(dx, dy, cfg = STICK) {
  const d = Math.hypot(dx, dy);
  if (d <= cfg.radius) return [dx, dy];
  return [(dx / d) * cfg.radius, (dy / d) * cfg.radius];
}
