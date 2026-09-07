// enemy.js — THE ENEMY TANK. Always one (operator, 2026-09-08): it spawns
// at its base's facing gate, follows the road to ours, comes in through
// the gate (gates open for any hull) and raids our flag stand, circling
// it. It fires straight shells at the player when it has him roughly
// ahead and in range. Our sentries and our drone fire at it; three of
// the player's shells kill it, and it respawns at its base after a
// while. While it is INSIDE our base the flag hold does not count down.
// Pure; test/enemy.mjs. World metres.
import { makeHull, stepHull, autopilotInput, bearingTo, DRIVE_TUNE } from './drive.js?v=6c60467a';
import { CELL_M, wrapDeg, roadBlockKey, roadNodeCentre, roadPath } from './plate.js?v=6c60467a';
import { gateCentre } from './drive.js?v=6c60467a';

export const ENEMY_TUNE = {
  hp: 6,            // player shells to kill it (a shell is 2 points; sentry rounds chip too): twelve points, as the player
  respawnS: 8,      // s dead before it is back at its gate
  speed: 18,        // m/s: slower than the player at full lever
  fireM: 70,        // m: it shoots inside this
  aimTol: 12,       // deg: with the player this close to straight ahead
  cooldown: 1.3,    // s between its shells
  reach: 8,         // m: a path point is passed inside this
  raidR: 16,        // m: the circle it drives around our flag stand
};
export function makeEnemy(world, tune = ENEMY_TUNE) {
  const home = world.plates[0], theirs = world.plates[1];
  const sp = { x: world.goal.x, z: world.goal.z };
  // the road from their gate to ours, then INTO our base along its roads:
  // the outer facing gate, the inner gate behind it, its road port, the
  // road graph to the junction nearest our flag stand, the stand
  const road = [...world.road.points].reverse().map((p) => [p[0], p[1]]);
  const pl = home.plate;
  const standL = pl.flags ? [(pl.flags.poles[0].x + pl.flags.poles[1].x) / 2, (pl.flags.poles[0].z + pl.flags.poles[1].z) / 2] : [pl.w * CELL_M / 2, pl.h * CELL_M / 2];
  const target = [standL[0] + home.ox, standL[1] + home.oz];
  const inside = [];
  const outer = pl.gates[home.facing];
  if (outer) {
    const inner = pl.gates.find((g) => g.ring === 'inner' && g.side === outer.side && g.at === outer.at) || outer;
    for (const g of inner === outer ? [outer] : [outer, inner]) { const [gx, gz] = gateCentre(pl, g); inside.push([gx + home.ox, gz + home.oz]); }
    const port = inner.port;
    if (port && pl.roads.nodes.length) {
      const from = roadBlockKey(port.bx, port.bz);
      const to = pl.roads.nodes.reduce((best, k) => { const c = roadNodeCentre(k); const d = Math.hypot(c[0] - standL[0], c[1] - standL[1]); return d < best.d ? { k, d } : best; }, { k: null, d: Infinity }).k;
      for (const k of roadPath(pl, from, to)) { const c = roadNodeCentre(k); inside.push([c[0] + home.ox, c[1] + home.oz]); }
    }
  }
  void theirs;
  const e = { ...makeHull(sp.x, sp.z, bearingTo(sp.x, sp.z, road[Math.min(1, road.length - 1)][0], road[Math.min(1, road.length - 1)][1])), hp: tune.hp * 2, alive: true, respawnT: 0,
    spawn: sp, path: [...road, ...inside, target], idx: 0, target, state: 'invade', inside: false, kills: 0, deaths: 0, shots: 0, cool: 0, ang: 0, side: 'hostile' };
  e.ammo = 9999;
  return e;
}
// is a world point inside plate p's INNER ring (the base proper)?
export const insideBase = (p, x, z) => { const cx = (x - p.ox) / CELL_M, cz = (z - p.oz) / CELL_M; const n = p.plate.inset || 0; return cx > n && cz > n && cx < p.plate.w - n && cz < p.plate.h - n; };

// one step; returns { shot } the frame it fires, { died } the frame it dies, { respawned }
export function stepEnemy(e, world, player, dt, blocked, tune = ENEMY_TUNE, drive = DRIVE_TUNE) {
  const out = {};
  if (!e.alive) {
    e.respawnT -= dt;
    if (e.respawnT <= 0) { e.alive = true; e.hp = tune.hp * 2; e.damage = 0; e.x = e.spawn.x; e.z = e.spawn.z; e.idx = 0; e.state = 'invade'; e.speed = 0; e.heading = bearingTo(e.x, e.z, e.path[1][0], e.path[1][1]); e.inside = false; out.respawned = true; }
    return out;
  }
  // damage taken since last step
  if (e.damage) { e.hp -= e.damage; e.damage = 0; if (e.hp <= 0) { e.alive = false; e.deaths++; e.respawnT = tune.respawnS; e.inside = false; out.died = true; return out; } }
  const P = { ...drive, speed: tune.speed };
  let input;
  if (e.state === 'invade') {
    const r = autopilotInput(e, e.path, e.idx, tune.reach, P);
    e.idx = r.idx; input = r.input;
    if (e.idx >= e.path.length - 1 && Math.hypot(e.target[0] - e.x, e.target[1] - e.z) < tune.reach) e.state = 'raid';
  } else {
    // the raid: a slow circle around the stand, always somewhere to be shot from
    e.ang += 25 * dt;
    const a = e.ang * Math.PI / 180;
    const pt = [e.target[0] + Math.cos(a) * tune.raidR, e.target[1] + Math.sin(a) * tune.raidR];
    const r = autopilotInput(e, [pt], 0, 3, P);
    input = r.input;
  }
  stepHull(e, input, dt, blocked, P);
  e.inside = insideBase(world.plates[0], e.x, e.z);
  // its gun: straight at the player when he is near enough and near enough to ahead
  if (e.cool > 0) e.cool = Math.max(0, e.cool - dt);
  if (player && player.alive !== false) {
    const d = Math.hypot(player.x - e.x, player.z - e.z);
    const off = Math.abs(wrapDeg(bearingTo(e.x, e.z, player.x, player.z) - e.heading));
    if (d <= tune.fireM && off <= tune.aimTol && e.cool <= 0) {
      e.cool = tune.cooldown; e.shots++;
      const a = e.heading * Math.PI / 180, dx = Math.sin(a), dz = -Math.cos(a);
      const el = 2 * Math.PI / 180, vh = drive.shotSpeed * Math.cos(el);
      out.shot = { kind: 'shot', x: e.x + dx * 4, z: e.z + dz * 4, y: (e.y || 0) + drive.muzzleY, vx: dx * vh, vz: dz * vh, vy: drive.shotSpeed * Math.sin(el), heading: e.heading, left: drive.shotRange, from: 'enemy', hit: false, landed: false };
    }
  }
  return out;
}
