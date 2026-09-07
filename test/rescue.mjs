import { makeCrew, stepCrew, CREW_TUNE } from '../src/crew.js';
import { makeRescue, stepBoarding, stepUnloading, makeRescued, stepEntered, RESCUE_TUNE } from '../src/rescue.js';
import { mulberry32 } from '../src/rng.js';
import { check, done } from './check.mjs';

// an open clearing, 30 m across, as an outpost's ground
const ground = { walkableAt: (x, z) => Math.hypot(x, z) < 30 };
const areas = [{ x: 4, z: 0, tag: 'a', fx: 6, fz: 0 }, { x: -4, z: 3, tag: 'b', fx: -6, fz: 4 }, { x: 0, z: -5, tag: 'c', fx: 0, fz: -8 }];
const rng = mulberry32(3);
const crew = makeCrew(ground, 6, rng, CREW_TUNE, null, areas);
check('an outpost crew stands on its own areas', crew.walkers.length === 6 && crew.walkers.every((w) => Math.hypot(w.x, w.z) < 8));
const rescue = makeRescue();
const hull = { x: 9, z: 0, heading: 0, speed: 0 };
let boarded = 0;
for (let i = 0; i < 20 * 60; i++) { boarded += stepBoarding(rescue, [crew], hull); stepCrew(crew, ground, 1 / 60, rng); }
check('a stopped hull nearby takes the whole crew aboard in time', boarded === 6 && rescue.aboard === 6 && crew.walkers.every((w) => w.gone && w.aboard), `aboard ${rescue.aboard}`);
// capacity
const big = makeCrew(ground, 14, mulberry32(4), CREW_TUNE, null, areas);
const r2 = makeRescue();
for (let i = 0; i < 30 * 60; i++) { stepBoarding(r2, [big], hull); stepCrew(big, ground, 1 / 60, rng); }
check('ten fit, the rest stay', r2.aboard === RESCUE_TUNE.capacity && big.walkers.filter((w) => !w.gone).length === 4);
// a moving hull is no lift
const c3 = makeCrew(ground, 3, mulberry32(5), CREW_TUNE, null, areas);
const r3 = makeRescue();
const rolling = { x: 6, z: 0, heading: 0, speed: 8 };
for (let i = 0; i < 5 * 60; i++) { stepBoarding(r3, [c3], rolling); stepCrew(c3, ground, 1 / 60, rng); }
check('a rolling hull takes nobody', r3.aboard === 0 && c3.walkers.every((w) => !w.boarding));
// unloading: one every unloadEvery seconds at the drop, none away from it or while moving
const r4 = makeRescue(); r4.aboard = 3;
let spawned = 0;
for (let i = 0; i < 60; i++) spawned += stepUnloading(r4, { x: 200, z: 0, speed: 0 }, 0, 0, 1 / 60);
check('far from the drop nobody climbs down', spawned === 0 && r4.aboard === 3);
for (let i = 0; i < 3 * 60; i++) spawned += stepUnloading(r4, { x: 5, z: 0, speed: 0 }, 0, 0, 1 / 60);
check('at the drop, stopped, they climb down one by one', spawned === 3 && r4.aboard === 0);
// the walk to the door and the bonus
const home = { walkableAt: () => true };
const door = { x: 0, z: -20, tag: 'infirmary', fx: 0, fz: -24 };
const hc = makeCrew(home, 0, rng, CREW_TUNE, null, [door]);
hc.walkers.push(makeRescued(0, 0, 1, door));
let entered = 0;
for (let i = 0; i < 12 * 60; i++) { stepCrew(hc, home, 1 / 60, rng); entered += stepEntered(r4, hc); }
check('a rescued walker runs to the door, goes in, and scores once', entered === 1 && r4.rescued === 1 && r4.score === RESCUE_TUNE.bonus && hc.walkers[0].gone && stepEntered(r4, hc) === 0);
done();
