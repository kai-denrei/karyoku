import { makeGuard, stepGuard, GUARD_TUNE } from '../src/guard.js';
import { lobHeight, stepTracers, DRIVE_TUNE } from '../src/drive.js';
import { check, near, done } from './check.mjs';

const g = makeGuard(100, 100, true);
check('the guard hovers at altitude on its circle', near(g.y, GUARD_TUNE.alt) && near(Math.hypot(g.x - 100, g.z - 100), GUARD_TUNE.orbitR));
// a hull rolling north at 10 m/s, 60 m off
const hull = { x: 100, z: 160, vx: 0, vz: -10, speed: 10 };
let ev = stepGuard(g, hull, 1 / 60);
check('in range it lays a mark where the hull WILL be, not where it is', ev.mark && near(ev.mark.x, 100) && near(ev.mark.z, 160 - 10 * GUARD_TUNE.leadT) && g.state === 'mark');
const mark = { ...g.mark };
let shot = null, frames = 0;
while (!shot && frames < 600) { hull.z -= 10 / 60; ev = stepGuard(g, hull, 1 / 60); frames++; if (ev.shot) shot = ev.shot; }
check('the shell drops after markT, on the MARK, though the hull has moved on', shot && near(frames / 60, GUARD_TUNE.markT, 0.05) && near(shot.tx, mark.x) && near(shot.tz, mark.z) && shot.y0 === GUARD_TUNE.alt);
check('then it cools before marking again', g.state === 'idle' && g.cool > 0 && !stepGuard(g, hull, 1 / 60).mark);
// the shell's arc starts at altitude and lands on the mark, and a hull still there is hit
check('a lob with a start height begins up there and ends on the ground', near(lobHeight({ ...shot, t: 0 }), GUARD_TUNE.alt) && near(lobHeight({ ...shot, t: shot.flight }), 0));
const parked = { x: mark.x, z: mark.z, speed: 0 };
const tr = [shot];
let hits = 0;
for (let i = 0; i < 600 && tr.length; i++) hits += stepTracers(tr, parked, 1 / 60, () => false, DRIVE_TUNE);
check('a hull that stayed on the mark takes the splash', hits === 1);
const dodged = { x: mark.x + DRIVE_TUNE.splashR + 3, z: mark.z, speed: 0 };
const g2 = makeGuard(100, 100, true); stepGuard(g2, { x: 100, z: 150, vx: 0, vz: 0 }, 1 / 60);
let shot2 = null; for (let i = 0; i < 600 && !shot2; i++) shot2 = stepGuard(g2, dodged, 1 / 60).shot;
const tr2 = [shot2]; let hits2 = 0;
for (let i = 0; i < 600 && tr2.length; i++) hits2 += stepTracers(tr2, dodged, 1 / 60, () => false, DRIVE_TUNE);
check('a hull that left the mark is missed', hits2 === 0);
// out of range, and a home guard, never mark
const far = makeGuard(0, 0, true);
check('out of range it idles', !stepGuard(far, { x: 500, z: 500, vx: 0, vz: 0 }, 1 / 60).mark && far.state === 'idle');
const home = makeGuard(0, 0, false);
check('a home guard hovers and never marks', !stepGuard(home, { x: 10, z: 10, vx: 0, vz: 0 }, 1 / 60).mark && home.state === 'idle');
done();
