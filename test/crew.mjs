import { generatePlate, makePlateParams, PLATE_TUNE, CELL_M } from '../src/plate.js';
import { makeCrew, stepCrew, stepSquash, shotHits, splashHits, keyAreas, crewWalkableAt, crewFreeAt, hullCovers, escape, CREW_TUNE, CREW_KINDS, ACTS, SUIT } from '../src/crew.js';
import { mulberry32 } from '../src/rng.js';
import { check, done } from './check.mjs';

const plate = generatePlate(makePlateParams({ ...PLATE_TUNE, seed: 7 }));
const rng = mulberry32(99);
const areas = keyAreas(plate);
check('key areas exist: building fronts, gates, the infirmary', areas.length >= 6 && areas.some((a) => a.tag === 'infirmary') && areas.some((a) => a.tag === 'gate'), `${areas.length} areas, tags ${[...new Set(areas.map((a) => a.tag))].join(' ')}`);
check('key areas are walkable', areas.every((a) => crewWalkableAt(plate, a.x, a.z)));
const crew = makeCrew(plate, 16, rng); // sixteen: a 100-cell plate's trips are long, so eight pick too few for the run coin to show
check('sixteen walkers, all alive, one suit colour', crew.walkers.length === 16 && crew.walkers.every((w) => w.alive) && SUIT === 0xff7a1a);
let everOff = false, ran = 0, movingFrames = 0;
const start = crew.walkers.map((w) => [w.x, w.z]);
const reach = crew.walkers.map(() => 0); // the farthest each walker ever got from where it began
for (let i = 0; i < 180 * 60; i++) {
  stepCrew(crew, plate, 1 / 60, rng);
  if (crew.walkers.some((w) => !crewWalkableAt(plate, w.x, w.z))) everOff = true;
  movingFrames += crew.walkers.filter((w) => w.moving).length;
  ran += crew.walkers.filter((w) => w.moving && w.running).length;
  crew.walkers.forEach((w, k) => { reach[k] = Math.max(reach[k], Math.hypot(w.x - start[k][0], w.z - start[k][1])); });
}
// a walker may be back near its start when the clock stops; what matters is that it went somewhere
const moved = reach.filter((d) => d > 4).length;
check('three minutes of walking never leaves walkable ground', !everOff);
check('they walk between areas', moved >= 10 && movingFrames > 180 * 16, `moved ${moved} movingFrames ${movingFrames}`);
check('sometimes they run', ran > 0 && ran < movingFrames * 0.6, `ran ${ran} of ${movingFrames}`);
// an enemy hull nearby: everyone within fleeM runs, and most get farther
// from it (a walker cornered between a wall and two buildings can only run
// past it — the ground decides, and the rules must not pretend otherwise)
{
  let fled = 0, cowered = 0, fledFar = 0;
  for (let k = 0; k < 6; k++) {
    const c2 = makeCrew(plate, 6, mulberry32(5));
    c2.hostile = true; // the enemy's crew: the ones who may cower
    const w = c2.walkers[k];
    // the threat comes from the west: several walkers share a key area at
    // the road's western end, with the base wall at their backs
    const threat = { x: w.x - 10, z: w.z };
    const d0 = Math.hypot(w.x - threat.x, w.z - threat.z);
    for (let i = 0; i < 4 * 60; i++) { stepCrew(c2, plate, 1 / 60, rng, threat); if (w.fleeing) w.wasFleeing = true; if (w.cowering) w.wasCowering = true; }
    const d1 = Math.hypot(w.x - threat.x, w.z - threat.z);
    if (w.wasFleeing) fled++;
    else if (w.wasCowering) cowered++;
    if (w.wasFleeing && d1 > d0 + 5) fledFar++;
  }
  check('every threatened walker runs or cowers', fled + cowered === 6, `fled ${fled} cowered ${cowered} of 6`);
  check('both answers show up across the six', fled >= 1 && cowered >= 1, `fled ${fled} cowered ${cowered}`);
  check('those who ran got well away', fledFar >= fled - 1, `${fledFar} of ${fled}`);
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
// SOLIDS the cells do not know: containers as bodies, and the tank
{
  check('hullCovers is the hull box, turned by heading', hullCovers({ x: 0, z: 0, heading: 90 }, 3, 0) && !hullCovers({ x: 0, z: 0, heading: 90 }, 0, 3)
    && hullCovers({ x: 0, z: 0, heading: 0 }, 0, -3) && !hullCovers({ x: 0, z: 0, heading: 0 }, 3, 0) && !hullCovers(null, 0, 0));
  // a container box parked across the plate's busiest road cell, and a hull
  // parked on a key area: neither is ever entered in ninety seconds
  const c4 = makeCrew(plate, 8, mulberry32(3));
  const road = [];
  for (let z = 0; z < plate.h; z++) for (let x = 0; x < plate.w; x++) if (plate.cells[z * plate.w + x] === 3 && crewWalkableAt(plate, (x + 0.5) * CELL_M, (z + 0.5) * CELL_M)) road.push([(x + 0.5) * CELL_M, (z + 0.5) * CELL_M]);
  const box = road[Math.floor(road.length / 2)];
  const hull = { x: areas[0].x, z: areas[0].z, heading: 45, speed: 0 };
  const solid = (x, z) => (Math.abs(x - box[0]) <= 3 && Math.abs(z - box[1]) <= 1.5) || hullCovers(hull, x, z);
  let inside = 0, frames = 0, moving = 0;
  const r2 = mulberry32(11);
  for (let i = 0; i < 90 * 60; i++) {
    stepCrew(c4, plate, 1 / 60, r2, null, CREW_TUNE, solid);
    for (const w of c4.walkers) { frames++; if (!crewFreeAt(plate, w.x, w.z, solid)) inside++; if (w.moving) moving++; }
  }
  check('with a container and a parked hull as solids, no walker is ever inside one', inside === 0, `${inside} of ${frames} frames`);
  check('and they still walk', moving > 90 * 8, `moving ${moving}`);
  // the shove: a hull creeping onto a walker moves them out, alive
  const c5 = makeCrew(plate, 1, mulberry32(4));
  const w = c5.walkers[0];
  const creeper = { x: w.x + 0.5, z: w.z, heading: 0, speed: 1 };
  const under = (x, z) => hullCovers(creeper, x, z);
  check('the walker starts under the creeping hull', !crewFreeAt(plate, w.x, w.z, under) && escape(plate, w, under) !== null);
  stepCrew(c5, plate, 1 / 60, mulberry32(5), null, CREW_TUNE, under);
  check('one step later they have been shoved clear, alive', w.alive && crewFreeAt(plate, w.x, w.z, under) && Math.hypot(w.x - creeper.x, w.z - creeper.z) >= CREW_TUNE.hullHalfW);
  // the disc: a walker's radius keeps it off a wall it walks past
  const wallX = plate.pieces.find((p) => p.kind === 1);
  check('a point a hand off a wall cell is not free for a walker', wallX && !crewFreeAt(plate, (wallX.x + 1) * CELL_M + 0.2, (wallX.z + 0.5) * CELL_M));
}
// THE SOFT BODIES: a shell through an astronaut, a landing beside one
{
  const c6 = makeCrew(plate, 4, mulberry32(21));
  const [a, b] = c6.walkers;
  b.x = a.x + 6; b.z = a.z;
  check('a shell 3 m up passes over a walker', shotHits(c6, a.x, a.z, 3.0) === null && a.alive);
  check('a shell a metre past a walker misses', shotHits(c6, a.x + 1.2, a.z, 1.0) === null && a.alive);
  const hit = shotHits(c6, a.x + 0.5, a.z, 1.0);
  check('a shell through a walker kills that walker, no other', hit === a && !a.alive && b.alive);
  check('a dead walker is not hit again', shotHits(c6, a.x, a.z, 1.0) === null);
  const killed = splashHits(c6, b.x + 2, b.z);
  check('a landing kills everyone in its splash, once', killed.length === 1 && killed[0] === b && !b.alive && splashHits(c6, b.x, b.z).length === 0);
  check('a landing well away kills no one', splashHits(c6, b.x + 20, b.z + 20).length === 0);
}
// ENEMY crews are rolled over, home crews are shoved
{
  const home = makeCrew(plate, 1, mulberry32(4));
  const w = home.walkers[0];
  const creeper = { x: w.x + 0.5, z: w.z, heading: 0, speed: 1 };
  const under = (x, z) => hullCovers(creeper, x, z);
  stepCrew(home, plate, 1 / 60, mulberry32(5), null, CREW_TUNE, under, under);
  check('a home walker under a creeping hull is shoved clear', w.alive && crewFreeAt(plate, w.x, w.z, under));
  check('...and a creeping hull does not squash them', stepSquash(home, creeper, 2).length === 0);
  const enemy = makeCrew(plate, 1, mulberry32(4));
  enemy.hostile = true;
  const e = enemy.walkers[0];
  const creeper2 = { x: e.x + 0.5, z: e.z, heading: 0, speed: 1 };
  const under2 = (x, z) => hullCovers(creeper2, x, z);
  stepCrew(enemy, plate, 1 / 60, mulberry32(5), null, CREW_TUNE, under2, under2);
  check('an enemy walker under a creeping hull stays put', e.alive && !crewFreeAt(plate, e.x, e.z, under2));
  check('...and the creeping hull squashes them', stepSquash(enemy, creeper2, 2).length === 1 && !e.alive);
}
// LIVELY: three kinds, pointing and kneeling at the fronts, apart from each other, the dead lying
{
  const c7 = makeCrew(plate, 9, mulberry32(31));
  check('the three kinds cycle through the crew', CREW_KINDS.length === 3 && c7.walkers.every((w, i) => w.kind === i % 3));
  check('key areas know what they face (roads and gates face nothing)', keyAreas(plate).filter((a) => a.tag !== 'gate' && a.tag !== 'road').every((a) => typeof a.fx === 'number') && keyAreas(plate).some((a) => a.tag === 'road'));
  const seen = new Set();
  let tooClose = 0, frames = 0;
  const r7 = mulberry32(32);
  for (let i = 0; i < 180 * 60; i++) {
    stepCrew(c7, plate, 1 / 60, r7);
    for (const w of c7.walkers) seen.add(w.act);
    for (let a = 0; a < c7.walkers.length; a++) for (let b = a + 1; b < c7.walkers.length; b++) { frames++; if (Math.hypot(c7.walkers[a].x - c7.walkers[b].x, c7.walkers[a].z - c7.walkers[b].z) < CREW_TUNE.separation * 0.6) tooClose++; }
  }
  check('in three minutes they walk, run, point and kneel', ['walk', 'run', 'point', 'kneel', 'idle'].every((a) => seen.has(a)), [...seen].join(' '));
  check('every act is a known act', [...seen].every((a) => ACTS.includes(a)));
  check('they keep apart: almost never inside half the separation', tooClose / frames < 0.002, `${tooClose} of ${frames}`);
  const w0 = c7.walkers[0];
  stepSquash(c7, { x: w0.x, z: w0.z, speed: 6 }, 2);
  stepCrew(c7, plate, 1 / 60, r7);
  check('the dead lie', !w0.alive && w0.act === 'lie');
}
// THE OPERATOR'S FEAR RULES: a moving tank scares everyone; ours never cower and relax when it stops
{
  const home = makeCrew(plate, 8, mulberry32(41));
  const w = home.walkers[0];
  const moving = { x: w.x - 10, z: w.z, moving: true };
  let fled = 0, cowered = 0;
  for (let i = 0; i < 3 * 60; i++) { stepCrew(home, plate, 1 / 60, mulberry32(42 + i), moving); for (const x of home.walkers) { if (x.fleeing) fled++; if (x.cowering) cowered++; } }
  check('our crew runs from a moving tank and never cowers', fled > 0 && cowered === 0, `fled ${fled} cowered ${cowered}`);
  const stopped = { x: w.x - 10, z: w.z, moving: false };
  for (let i = 0; i < 60; i++) stepCrew(home, plate, 1 / 60, mulberry32(7), stopped);
  check('and stops running the moment it stops', home.walkers.every((x) => !x.fleeing && !x.cowering));
  const calm = makeCrew(plate, 4, mulberry32(43));
  for (let i = 0; i < 2 * 60; i++) stepCrew(calm, plate, 1 / 60, mulberry32(9), { x: calm.walkers[0].x - 8, z: calm.walkers[0].z, moving: false });
  check('a parked friendly tank frightens nobody', calm.walkers.every((x) => !x.fleeing && !x.cowering));
  const enemy = makeCrew(plate, 6, mulberry32(44)); enemy.hostile = true;
  let ef = 0, ec = 0;
  for (let k = 0; k < 6; k++) { const e = makeCrew(plate, 6, mulberry32(50 + k)); e.hostile = true; const t = { x: e.walkers[k].x - 10, z: e.walkers[k].z, moving: true }; for (let i = 0; i < 2 * 60; i++) stepCrew(e, plate, 1 / 60, mulberry32(60 + i), t); if (e.walkers[k].fleeing || e.walkers[k].wasFleeing) ef++; if (e.walkers[k].cowering) ec++; }
  check('the enemy\'s crew runs or cowers', ef + ec >= 4 && ec >= 1, `ran ${ef} cowered ${ec}`);
}
done();
