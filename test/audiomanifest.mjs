// audiomanifest.mjs — every sound the game names exists on disk, every
// sentry family has a round, and every bus is a bus.
import { existsSync } from 'node:fs';
import { DEATH_KEYS, SOUNDS, BUSES, SENTRY_FIRE, GLOBAL_VOICE_CAP, DISTANCE_K, DEFAULT_LEVELS } from '../src/audiomanifest.js';
import { GUN_FAMILIES } from '../src/plate.js';
import { check, done } from './check.mjs';

for (const [key, s] of Object.entries(SOUNDS)) {
  check(`${key}: file on disk`, existsSync(new URL('../' + s.file, import.meta.url)), s.file);
  check(`${key}: on a known bus with a sane budget`, BUSES.includes(s.bus) && s.gain > 0 && s.gain <= 1 && s.maxVoices >= 1 && s.minInterval >= 0);
}
check('every gun family fires a sound that exists', GUN_FAMILIES.every((f) => SOUNDS[SENTRY_FIRE[f]]), GUN_FAMILIES.filter((f) => !SOUNDS[SENTRY_FIRE[f]]).join(' '));
check('the tank has a shot, a bed and an impact', ['tank_main', 'tank_thruster', 'impact_shell', 'impact_rubble'].every((k) => SOUNDS[k]));
check('three death cries, all on the manifest', DEATH_KEYS.length === 3 && DEATH_KEYS.every((k) => SOUNDS[k] && SOUNDS[k].maxVoices >= 3));
check('the assembly line has its hydraulic bed and no electric hum', SOUNDS.assembly_hydraulics && !SOUNDS.assembly_electric && SOUNDS.assembly_hydraulics.gain < 0.4);
check('every bus has a default level', BUSES.every((b) => typeof DEFAULT_LEVELS[b] === 'number'));
check('falloff is in metres', DISTANCE_K >= 10 && DISTANCE_K <= 200 && GLOBAL_VOICE_CAP >= 8);
done();
