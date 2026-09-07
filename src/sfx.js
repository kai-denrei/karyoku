// sfx.js — what the game SOUNDS like and what a hit LOOKS like, in one place
// the tabs call. audio.js (the reference's engine) plays; impactfx.js (the
// reference's effects) draws; this file knows the game: which family fires
// which round, how the engine bed follows the throttle, where a shell's
// impact goes and which way it faces, how far a machine's hum carries.
import * as THREE from '../vendor/three.module.js';
import { makeAudio } from './audio.js?v=cd096da1';
import { SENTRY_FIRE, DEATH_KEYS, THUD_SLICES } from './audiomanifest.js?v=cd096da1';
import { makeImpactBurst, IMPACT_TUNE, orientImpact } from './impactfx.js?v=cd096da1';
import { PALETTE, BZ } from './looks.js?v=cd096da1';
import { makeTankFeel, stepTankFeel, landTankFeel, fireTankFeel, applyTankFeel } from './tankfeel.js?v=cd096da1';

// the impact set is authored for a 4-unit wall; a shell on a 4 m cell
// wants about this much of it
const SHELL_SIZE = 2.6;
const HUM_REACH = 60; // m — a machine's hum is gone past this

// THE SOFT BURST, the reference's makeDotBurst in metres: n dots from one
// point, thrown flat against the surface normal with a small pop along it,
// fading over LIFE. Half the dots wear the suit, half the blood; the same
// two-colour hurt the reference's creatures flash. Deterministic per seed.
const SUIT_DOT = 0xff7a1a, BLOOD_DOT = 0xd8102a;
function makeSoftBurst(normal, seed, n = 36, reach = 1.3) {
  const hshf = (i) => { const s = Math.sin(i * 91.7 + seed * 13.1 + 2.3) * 43758.5453; return s - Math.floor(s); };
  const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const cs = new THREE.Color(SUIT_DOT), cb = new THREE.Color(BLOOD_DOT);
  for (let i = 0; i < n; i++) {
    const th = hshf(i) * 6.283, up = hshf(i + 50) * 0.55;
    let dx = Math.cos(th), dy = 0, dz = Math.sin(th);
    dx += normal[0] * up; dy += normal[1] * up; dz += normal[2] * up;
    const sp = (0.45 + hshf(i + 100) * 1.1) * reach;
    vel[i * 3] = dx * sp; vel[i * 3 + 1] = dy * sp; vel[i * 3 + 2] = dz * sp;
    const c = hshf(i + 200) < 0.5 ? cs : cb, b = 0.7 + 0.3 * hshf(i + 150);
    col[i * 3] = c.r * b; col[i * 3 + 1] = c.g * b; col[i * 3 + 2] = c.b * b;
  }
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 3.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 1, depthWrite: false });
  const pts = new THREE.Points(geo, mat);
  const LIFE = 0.7;
  let life = 0;
  pts.userData.tick = (dt) => {
    life += dt;
    for (let i = 0; i < n; i++) { pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt; }
    posAttr.needsUpdate = true;
    mat.opacity = Math.max(0, 1 - life / LIFE);
    return life < LIFE;
  };
  return pts;
}

export function makeSfx(scene) {
  const audio = makeAudio({ seed: 1 });
  audio.arm();
  // THE ENGINE, the reference's way: a smoothed level (spins up fast, spools
  // down slow), a spool-up cue the first frame it moves, the bed while it
  // moves, and a spool-down cue plus the touchdown rock once it has been
  // still for ENGINE_STOP. The feel state rides the same `running`, so the
  // visible lift and the audible hydraulics cannot drift apart.
  const ENGINE_STOP = 0.10;
  let thruster = null, level = 0, idle = 0, running = false;
  const feel = makeTankFeel();
  let gears = null;         // the muzzle's loop while elevating
  const hums = new Map();   // key -> { h: loop handle | null, e: loop handle | null }
  const rumbles = new Map(); // body key -> { h: loop handle | null, still: seconds since it last moved }
  const RUMBLE_REACH = 50;   // m — a shoved container is silent past this
  const RUMBLE_HOLD = 0.35;  // s still before the rumble fades out
  const fx = [];            // impact groups with userData.tick(dt) -> alive
  // the impacts' colours: the reference's warm sparks in colony, one green in battlezone
  const colors = BZ
    ? { spark: PALETTE.hull, flash: PALETTE.hull, ring: PALETTE.wire, debris: PALETTE.rock, scorch: 0x000000, ember: PALETTE.hull, splash: PALETTE.wire }
    : {};
  let seed = 1;
  return {
    audio,
    feel,
    get running() { return running; },
    engine(speed, maxSpeed, dt = 0.016) {
      const target = Math.min(1, Math.abs(speed) / Math.max(1e-6, maxSpeed));
      const k = target > level ? 6 : 2.5;
      level += (target - level) * Math.min(1, k * dt);
      const moving = level > 0.03;
      idle = moving ? 0 : idle + dt;
      stepTankFeel(feel, dt, running);
      if (moving && !running) { audio.play('tank_spool_up'); running = true; }
      // RETRY every frame while moving: loop() returns null until the buffer
      // has decoded, and latching a failed handle is what silenced the bed
      if (moving && !thruster) thruster = audio.loop('tank_thruster', { gain: 0.001, rate: 0.92 });
      if (!moving && idle >= ENGINE_STOP && running) {
        if (thruster) thruster.stop(ENGINE_STOP);
        thruster = null; level = 0;
        audio.play('tank_spool_down');
        landTankFeel(feel);
        running = false;
      } else if (thruster) {
        thruster.set(0.34 + 0.66 * level, 0.92 + 0.22 * level);
      }
    },
    // write the lift, the rock, the vibration and the recoil onto the hull
    applyFeel(hullObj) { applyTankFeel(hullObj, feel); },
    fire() { audio.play('tank_main'); fireTankFeel(feel); },
    empty() { audio.play('laser_click'); },
    sentryFired(family, dist) { audio.play(SENTRY_FIRE[family] || 'tower_single', { dist }); },
    hitOnHull() { audio.play('impact_hit'); },
    // the hull against the world
    wallHit(speed) { audio.play('hull_wall', { gain: Math.min(1, 0.45 + speed / 12) }); },
    thud(dist) { const [offset, duration] = THUD_SLICES[seed++ % THUD_SLICES.length]; audio.play('thud', { offset, duration, dist }); },
    // the muzzle's gears turn while the elevation changes: a loop that
    // starts with the key and stops with it
    elevating(active) {
      if (active && !gears) gears = audio.loop('muzzle_gears', { gain: 1 });
      else if (!active && gears) { gears.stop(0.08); gears = null; }
    },
    uiClick() { audio.play('ui_click'); },
    // the guard's pointer lands on you: the spin-up as a lock warning; its shell is the aoe thump
    guardMark(dist) { audio.play('minigun_ready', { dist }); },
    // the flags: a take and a plant (the interface click for now; the lab lists what they want)
    flagTaken() { audio.play('ui_click'); },
    flagPlanted() { audio.play('tank_spool_up'); },
    guardFire(dist) { audio.play('tower_aoe', { dist }); },
    // a machine's beds, kept by key, gain by distance from the listener
    machine(key, dist) {
      let m = hums.get(key);
      if (!m) { m = { h: null }; hums.set(key, m); }
      const g = Math.max(0, 1 - dist / HUM_REACH);
      if (!m.h) m.h = audio.loop('assembly_hydraulics', { gain: 0.001 });
      if (m.h) m.h.set(g, 1);
    },
    clearMachines() { for (const m of hums.values()) if (m.h) m.h.stop(); hums.clear(); },
    // a body's rumble: starts the frame it moves, from a random point in
    // the sample (the operator's option B: no bookkeeping of where each
    // one left off), follows the listener's distance, loops past the end,
    // and fades once it has been still for RUMBLE_HOLD
    body(key, moving, dist, dt) {
      let r = rumbles.get(key);
      if (moving) {
        if (!r) { r = { h: null, still: 0 }; rumbles.set(key, r); }
        r.still = 0;
        if (!r.h) r.h = audio.loop('container_rumble', { gain: 0.001, offset: (seed++ % 97) / 97 * 20 });
      } else if (r) {
        r.still += dt;
        if (r.still >= RUMBLE_HOLD) { if (r.h) r.h.stop(0.4); rumbles.delete(key); return; }
      }
      if (r && r.h) r.h.set(Math.max(0, 1 - dist / RUMBLE_REACH), 1);
    },
    clearBodies() { for (const r of rumbles.values()) if (r.h) r.h.stop(); rumbles.clear(); },
    // a hit: the recipe at the point, facing along the normal, sized for the
    // board; and its sound, faded by distance from the listener
    impact(recipe, point, normal, dist, size = SHELL_SIZE, sound = 'impact_shell') {
      const g = makeImpactBurst(recipe, IMPACT_TUNE, colors, seed++, size);
      orientImpact(g, point, normal);
      scene.add(g);
      fx.push(g);
      if (sound) audio.play(sound, { dist });
    },
    // a body hit: a light tick while it stands, the rubble crunch when a
    // state breaks off, and a barrel that dies goes up like a sentry
    // `rammed`: the hull did it, not a shell. Nothing burns when a crate
    // is driven over: chunks and the slam. A barrel still goes up.
    bodyHit(b, point, dist, result, rammed = false) {
      if (!result) return;
      if (result.destroyed && b.id === 'fuel_barrel') { this.impact('shell', point, [0, 1, 0], dist, 4.2, 'sentry_destroyed'); return; }
      if (rammed) { this.impact('crush', point, [0, 1, 0], dist, b.id === 'logistics_container' ? 3.0 : 2.2, 'crush_slam'); return; }
      if (result.destroyed || result.stepped) { this.impact('shell', point, [0, 1, 0], dist, b.id === 'logistics_container' ? 3.2 : 2.2, 'impact_rubble'); return; }
      this.impact('light', point, [0, 1, 0], dist, 1.6, 'impact_shell');
    },
    // a small thing run over: chunks, no fire, the slam
    crush(point, dist) { this.impact('crush', point, [0, 1, 0], dist, 2.4, 'crush_slam'); },
    // a sentry breaking: the full shell recipe twice over, big, at the head
    // and at the plinth (the second one lays the scorch), and the blast
    sentryDestroyed(point, dist) {
      this.impact('shell', point, [0, 1, 0], dist, 5.0, 'sentry_destroyed');
      this.impact('shell', [point[0], point[1] - 2.6, point[2]], [0, 1, 0], dist, 3.4, null);
    },
    // a soft body hit: one of three cries, faded by distance, and the
    // two-colour burst at the body; the light impact recipe's flash and
    // spark on top so the strike reads at any range. The caller lays the
    // splat (crew-scene does, for any dead walker).
    softHit(point, dist, normal = [0, 1, 0]) {
      audio.play(DEATH_KEYS[seed % DEATH_KEYS.length], { dist });
      const burst = makeSoftBurst(normal, seed++);
      burst.position.set(point[0], point[1], point[2]);
      scene.add(burst);
      fx.push(burst);
      const g = makeImpactBurst('light', IMPACT_TUNE, colors, seed++, 1.6);
      orientImpact(g, point, normal);
      scene.add(g);
      fx.push(g);
    },
    tick(dt) {
      for (let i = fx.length - 1; i >= 0; i--) {
        if (!fx[i].userData.tick(dt)) { scene.remove(fx[i]); fx.splice(i, 1); }
      }
    },
    get live() { return fx.length; },
  };
}
