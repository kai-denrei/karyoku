import { makeWorld, WORLD_TUNE, worldBlocked } from '../src/world.js';
import { PLATE_TUNE } from '../src/plate.js';
import { makeEnemy, stepEnemy, insideBase, ENEMY_TUNE } from '../src/enemy.js';
import { makeHull, stepTracers, stepGates, DRIVE_TUNE } from '../src/drive.js';
import { check, near, done } from './check.mjs';

const w = makeWorld({ ...WORLD_TUNE, seed: 7 }, { ...PLATE_TUNE, w: 40, h: 32 });
const e = makeEnemy(w);
check('the enemy spawns at its own gate, bound for ours', near(e.x, w.goal.x) && near(e.z, w.goal.z) && e.path.length > 3 && e.state === 'invade' && e.alive);
const far = makeHull(-1000, -1000, 0);
const blocked = (x, z) => worldBlocked(w, x, z);
const d0 = Math.hypot(e.x - w.spawn.x, e.z - w.spawn.z);
for (let i = 0; i < 20 * 60; i++) stepEnemy(e, w, far, 1 / 60, blocked);
const d1 = Math.hypot(e.x - w.spawn.x, e.z - w.spawn.z);
check('twenty seconds later it is well along the road toward our gate', d1 < d0 - 100, `${d0.toFixed(0)} -> ${d1.toFixed(0)}`);
check('it has not fired at a player a kilometre away', e.shots === 0);
// given time, and nobody shooting it, it comes in along our roads and reaches the raid
const e5 = makeEnemy(w);
let reached = 0;
for (let i = 0; i < 240 * 60 && !reached; i++) { for (const p of w.plates) stepGates(p.gates, e5, 1 / 60); stepEnemy(e5, w, far, 1 / 60, blocked); if (e5.state === 'raid') reached = i / 60; } // gates open for any hull, as in the tab
check('in four minutes it is raiding our flag stand', reached > 0 && e5.inside, `raid at ${reached.toFixed(0)} s, state ${e5.state} at ${e5.x.toFixed(0)},${e5.z.toFixed(0)} idx ${e5.idx}/${e5.path.length}`);
// a player straight ahead and in range: it fires; one off to the side: it does not
const ahead = { x: e.x + Math.sin(e.heading * Math.PI / 180) * 40, z: e.z - Math.cos(e.heading * Math.PI / 180) * 40, alive: true };
const shot = stepEnemy(e, w, ahead, 1 / 60, () => false).shot;
check('with the player forty metres ahead it fires an enemy shell', shot && shot.from === 'enemy' && e.shots === 1);
const beside = { x: e.x - Math.cos(e.heading * Math.PI / 180) * 40, z: e.z - Math.sin(e.heading * Math.PI / 180) * 40, alive: true };
e.cool = 0;
check('with the player off its beam it holds fire', !stepEnemy(e, w, beside, 1 / 60, () => false).shot);
// the player's shell hits it; three kill it; it respawns at its gate
const p = makeHull(e.x, e.z + 30, 0);
const tr = [{ kind: 'shot', x: e.x, z: e.z + 6, y: 2, vx: 0, vz: -40, vy: 0, heading: 0, left: 100, from: -1, hit: false, landed: false }];
for (let i = 0; i < 60 && tr.length; i++) stepTracers(tr, [p, e], 1 / 60, () => false, DRIVE_TUNE);
check('the player\'s shell through the enemy hull is two points of damage on it, none on the player', e.damage === 2 && !p.damage && tr.length === 0);
stepEnemy(e, w, far, 1 / 60, () => false);
check('it is hurt, not dead', e.alive && e.hp === ENEMY_TUNE.hp * 2 - 2);
e.damage = 10;
const died = stepEnemy(e, w, far, 1 / 60, () => false);
check('enough damage kills it', died.died && !e.alive && e.deaths === 1);
let back = null;
for (let i = 0; i < (ENEMY_TUNE.respawnS + 1) * 60 && !back; i++) { const r = stepEnemy(e, w, far, 1 / 60, () => false); if (r.respawned) back = r; }
check('it respawns at its gate with full points', back && e.alive && near(e.x, w.goal.x) && e.hp === ENEMY_TUNE.hp * 2);
// an enemy shell hits the player, not the enemy; a sentry round chips whoever it passes
const p2 = makeHull(0, 0, 0), e2 = makeHull(0, -50, 180); e2.alive = true;
const t2 = [{ kind: 'shot', x: 0, z: -20, y: 2, vx: 0, vz: 40, vy: 0, heading: 180, left: 100, from: 'enemy', hit: false, landed: false }];
let hits = 0; for (let i = 0; i < 60 && t2.length; i++) hits += stepTracers(t2, [p2, e2], 1 / 60, () => false, DRIVE_TUNE);
check('an enemy shell hits the player for two points, one hit event', p2.damage === 2 && hits === 1 && !e2.damage);
const t3 = [{ x: 0, z: -60, heading: 180, left: 200 }];
for (let i = 0; i < 60 && t3.length; i++) stepTracers(t3, [p2, e2], 1 / 60, () => false, DRIVE_TUNE);
check('a sentry round chips the enemy hull it passes', e2.damage === 1);
check('inside our base is inside the inner ring', insideBase(w.plates[0], w.plates[0].ox + w.plates[0].wM / 2, w.plates[0].oz + w.plates[0].hM / 2) && !insideBase(w.plates[0], w.plates[0].ox + 2, w.plates[0].oz + 2));
done();
