import { generatePlate, makePlateParams, PLATE_TUNE } from '../src/plate.js';
import { makeCrew, stepCrew, crewWalkableAt, SUITS, CREW_TUNE } from '../src/crew.js';
import { mulberry32 } from '../src/rng.js';
import { check, done } from './check.mjs';

const plate = generatePlate(makePlateParams({ ...PLATE_TUNE, seed: 7 }));
const rng = mulberry32(99);
const crew = makeCrew(plate, 6, rng);
check('six walkers', crew.length === 6);
check('they start on walkable ground', crew.every((w) => crewWalkableAt(plate, w.x, w.z)));
check('suits differ', new Set(crew.map((w) => w.suit)).size === 6 && SUITS.length >= 6);
let everOff = false, moved = 0, movingFrames = 0;
const start = crew.map((w) => [w.x, w.z]);
for (let i = 0; i < 60 * 60; i++) {
  stepCrew(crew, plate, 1 / 60, rng);
  if (crew.some((w) => !crewWalkableAt(plate, w.x, w.z))) everOff = true;
  movingFrames += crew.filter((w) => w.moving).length;
}
crew.forEach((w, i) => { if (Math.hypot(w.x - start[i][0], w.z - start[i][1]) > 4) moved++; });
check('a minute of walking never leaves walkable ground', !everOff);
check('they actually walk', moved >= 4 && movingFrames > 60 * 60, `moved ${moved} movingFrames ${movingFrames}`);
check('walk speed is a stroll', CREW_TUNE.walk > 0.8 && CREW_TUNE.walk < 2.5);
done();
