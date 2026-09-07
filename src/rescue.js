// rescue.js — the stranded and the saved. Pure, tested in test/rescue.mjs.
//
// Our outposts' crews are STRANDED: a hull that stops near them is a lift
// home. They run to it and climb aboard (ten fit), vanish into the hull,
// and when the hull stops again by the home base's infirmary they climb
// down one by one, run to the door and go in, and each one in is a bonus.
export const RESCUE_TUNE = {
  capacity: 10,
  boardM: 24,        // m: a stranded walker inside this runs for a STOPPED hull
  boardAt: 5.2,      // m from the hull's centre: aboard (past the hull's own 4 m half-length, which blocks a walker coming along the axis)
  stopSpeed: 1.5,    // m/s: slower than this counts as stopped
  unloadM: 18,       // m from the drop point (the infirmary front) to unload
  unloadEvery: 0.6,  // s between walkers climbing down
  bonus: 100,        // points per walker through the door
};
export function makeRescue() { return { aboard: 0, rescued: 0, score: 0, unloadT: 0, boarded: 0 }; }

// Stranded crews (an array of crew objects in the hull's metres) against
// the hull: sets boarding targets, takes walkers aboard. Returns how many
// climbed aboard this step.
export function stepBoarding(rescue, crews, hull, tune = RESCUE_TUNE) {
  let n = 0;
  const stopped = Math.abs(hull.speed || 0) < tune.stopSpeed;
  for (const crew of crews) {
    for (const w of crew.walkers) {
      if (!w.alive || w.gone) continue;
      const d = Math.hypot(w.x - hull.x, w.z - hull.z);
      if (rescue.aboard < tune.capacity && stopped && d < tune.boardM) {
        w.boarding = true; w.fleeing = false; w.cowering = false; w.actT = 0; w.face = null;
        w.running = true; w.target = { x: hull.x, z: hull.z, tag: 'board' };
        if (d < tune.boardAt) { w.alive = false; w.gone = true; w.aboard = true; rescue.aboard++; rescue.boarded++; n++; }
      } else if (w.boarding && (!stopped || d > tune.boardM * 1.5 || rescue.aboard >= tune.capacity)) {
        w.boarding = false; w.target = null;
      }
    }
  }
  return n;
}

// At the drop point with the hull stopped, one walker climbs down every
// unloadEvery seconds. Returns 1 when one should be spawned now, else 0.
export function stepUnloading(rescue, hull, dropX, dropZ, dt, tune = RESCUE_TUNE) {
  if (rescue.aboard <= 0) { rescue.unloadT = 0; return 0; }
  const stopped = Math.abs(hull.speed || 0) < tune.stopSpeed;
  const near = Math.hypot(hull.x - dropX, hull.z - dropZ) < tune.unloadM;
  if (!stopped || !near) { rescue.unloadT = 0; return 0; }
  rescue.unloadT -= dt;
  if (rescue.unloadT > 0) return 0;
  rescue.unloadT = tune.unloadEvery;
  rescue.aboard--;
  return 1;
}

// A rescued walker set down at (x, z), bound for `goal` (an area object;
// arriving there is going through the door: crew.js marks it `entered`).
export function makeRescued(x, z, kind, goal, heading = 0) {
  return { x, z, heading, target: null, wait: 0, running: true, fleeing: false, moving: false, alive: true,
    kind, act: 'run', actT: 0, face: null, cowering: false, mission: 'enter', goal, rescued: true };
}

// Score every rescued walker who has gone through the door since last asked.
export function stepEntered(rescue, crew, tune = RESCUE_TUNE) {
  let n = 0;
  for (const w of crew.walkers) {
    if (w.rescued && w.entered && !w.scored) { w.scored = true; rescue.rescued++; rescue.score += tune.bonus; n++; }
  }
  return n;
}
