// sfx.js — what the game SOUNDS like and what a hit LOOKS like, in one place
// the tabs call. audio.js (the reference's engine) plays; impactfx.js (the
// reference's effects) draws; this file knows the game: which family fires
// which round, how the engine bed follows the throttle, where a shell's
// impact goes and which way it faces, how far a machine's hum carries.
import * as THREE from '../vendor/three.module.js';
import { makeAudio } from './audio.js?v=1e2fbf0d';
import { SENTRY_FIRE } from './audiomanifest.js?v=1e2fbf0d';
import { makeImpactBurst, IMPACT_TUNE, orientImpact } from './impactfx.js?v=1e2fbf0d';
import { PALETTE, BZ } from './looks.js?v=1e2fbf0d';
import { makeTankFeel, stepTankFeel, landTankFeel, fireTankFeel, applyTankFeel } from './tankfeel.js?v=1e2fbf0d';

// the impact set is authored for a 4-unit wall; a shell on a 4 m cell
// wants about this much of it
const SHELL_SIZE = 2.6;
const HUM_REACH = 60; // m — a machine's hum is gone past this

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
  const hums = new Map();   // key -> { h: loop handle | null, e: loop handle | null }
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
    sentryFired(family, dist) { audio.play(SENTRY_FIRE[family] || 'tower_single', { dist }); },
    hitOnHull() { audio.play('impact_hit'); },
    // a machine's beds, kept by key, gain by distance from the listener
    machine(key, dist) {
      let m = hums.get(key);
      if (!m) { m = { h: null }; hums.set(key, m); }
      const g = Math.max(0, 1 - dist / HUM_REACH);
      if (!m.h) m.h = audio.loop('assembly_hydraulics', { gain: 0.001 });
      if (m.h) m.h.set(g, 1);
    },
    clearMachines() { for (const m of hums.values()) if (m.h) m.h.stop(); hums.clear(); },
    // a hit: the recipe at the point, facing along the normal, sized for the
    // board; and its sound, faded by distance from the listener
    impact(recipe, point, normal, dist, size = SHELL_SIZE, sound = 'impact_shell') {
      const g = makeImpactBurst(recipe, IMPACT_TUNE, colors, seed++, size);
      orientImpact(g, point, normal);
      scene.add(g);
      fx.push(g);
      if (sound) audio.play(sound, { dist });
    },
    tick(dt) {
      for (let i = fx.length - 1; i >= 0; i--) {
        if (!fx[i].userData.tick(dt)) { scene.remove(fx[i]); fx.splice(i, 1); }
      }
    },
    get live() { return fx.length; },
  };
}
