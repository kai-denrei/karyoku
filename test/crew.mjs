import { generatePlate, makePlateParams, PLATE_TUNE, CELL_M } from '../src/plate.js';
import { makeCrew, stepCrew, stepSquash, keyAreas, crewWalkableAt, CREW_TUNE, SUIT } from '../src/crew.js';
import { mulberry32 } from '../src/rng.js';
import { check, done } from './check.mjs';

const plate = generatePlate(makePlateParams({ ...PLATE_TUNE, seed: 7 }));
const rng = mulberry32(99);
const areas = keyAreas(plate);
check('key areas exist: building fronts, gates, the infirmary', areas.length >= 6 && areas.some((a) => a.tag === 'infirmary') && areas.some((a) => a.tag === 'gate'), `${areas.length} areas, tags ${[...new Set(areas.map((a) => a.tag))].join(' ')}`);
check('key areas are walkable', areas.every((a) => crewWalkableAt(plate, a.x, a.z)));
const crew = makeCrew(plate, 8, rng);
check('eight walkers, all alive, one suit colour', crew.walkers.length === 8 && crew.walkers.every((w) => w.alive) && SUIT === 0xff7a1a);
let everOff = false, ran = 0, movingFrames = 0;
const start = crew.walkers.map((w) => [w.x, w.z]);
for (let i = 0; i < 90 * 60; i++) {
  stepCrew(crew, plate, 1 / 60, rng);
  if (crew.walkers.some((w) => !crewWalkableAt(plate, w.x, w.z))) everOff = true;
  movingFrames += crew.walkers.filter((w) => w.moving).length;
  ran += crew.walkers.filter((w) => w.moving && w.running).length;
}
let moved = 0;
crew.walkers.forEach((w, i) => { if (Math.hypot(w.x - start[i][0], w.z - start[i][1]) > 4) moved++; });
check('ninety seconds of walking never leaves walkable ground', !everOff);
check('they walk between areas', moved >= 5 && movingFrames > 90 * 8, `moved ${moved} movingFrames ${movingFrames}`);
check('sometimes they run', ran > 0 && ran < movingFrames * 0.6, `ran ${ran} of ${movingFrames}`);
// an enemy hull nearby: everyone within fleeM runs, and most get farther
// from it (a walker cornered between a wall and two buildings can only run
// past it — the ground decides, and the rules must not pretend otherwise)
{
  let fled = 0, farther = 0;
  for (let k = 0; k < 6; k++) {
    const c2 = makeCrew(plate, 6, mulberry32(5));
    const w = c2.walkers[k];
    // the threat comes from the west: several walkers share a key area at
    // the road's western end, with the base wall at their backs
    const threat = { x: w.x - 10, z: w.z };
    const d0 = Math.hypot(w.x - threat.x, w.z - threat.z);
    for (let i = 0; i < 4 * 60; i++) stepCrew(c2, plate, 1 / 60, rng, threat);
    const d1 = Math.hypot(w.x - threat.x, w.z - threat.z);
    if (w.fleeing) fled++;
    if (d1 > d0 + 5) farther++;
  }
  check('every threatened walker flees', fled === 6, `${fled} of 6`);
  check('most of them get well away from the threat', farther >= 4, `${farther} of 6`);
}
// the Amiga moment
{
  const c3 = makeCrew(plate, 3, mulberry32(9));
  const w = c3.walkers[0];
  const still = { x: w.x, z: w.z, speed: 0 };
  check('a parked hull squashes no one', stepSquash(c3, still, 2).length === 0 && w.alive);
  const rolling = { x: w.x + 1, z: w.z, speed: 6 };
  const dead = stepSquash(c3, rolling, 2);
  check('a moving hull over a walker leaves one dead for the splash', dead.length === 1 && !w.alive);
  stepCrew(c3, plate, 1, rng);
  check('the dead do not walk', !w.moving && !w.alive);
}
done();
