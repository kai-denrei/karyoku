// audiomanifest.js — every sound the game can make, as data. The reference
// project's table, cut to what karyoku fires and extended with the
// assembly line's beds and the impact aliases. The engine (audio.js) knows
// nothing about the game.
//
// Per-entry budget fields (see audiomix.js): gain (artistic level),
// maxVoices (concurrent copies before the oldest is stolen), minInterval
// (seconds; a retrigger inside the window is dropped), rateJitter (+/-
// fraction of playbackRate from the deterministic stream).
export const BUSES = ['towers', 'tank', 'ambient', 'ui'];

const A = 'assets/audio';

export const SOUNDS = {
  // --- the turrets, by what the round is -----------------------------------
  tower_single:  { file: `${A}/tower_single.mp3`,  bus: 'towers', gain: 0.55, maxVoices: 4, minInterval: 0.06, rateJitter: 0.06 },
  tower_rapid:   { file: `${A}/tower_rapid.mp3`,   bus: 'towers', gain: 0.34, maxVoices: 5, minInterval: 0.05, rateJitter: 0.08 },
  tower_homing:  { file: `${A}/tower_homing.mp3`,  bus: 'towers', gain: 0.50, maxVoices: 3, minInterval: 0.09, rateJitter: 0.05 },
  tower_laser:   { file: `${A}/tower_laser.mp3`,   bus: 'towers', gain: 0.40, maxVoices: 3, minInterval: 0.08, rateJitter: 0.03 },
  tower_aoe:     { file: `${A}/tower_aoe.mp3`,     bus: 'towers', gain: 0.70, maxVoices: 2, minInterval: 0.14, rateJitter: 0.05 },
  tower_sniper:  { file: `${A}/tower_sniper.mp3`,  bus: 'towers', gain: 0.75, maxVoices: 2, minInterval: 0.16, rateJitter: 0.04 },
  minigun_ready: { file: `${A}/minigun_ready.mp3`, bus: 'towers', gain: 0.42, maxVoices: 1, minInterval: 1.7, rateJitter: 0.02 },
  minigun_fire:  { file: `${A}/minigun_fire.mp3`,  bus: 'towers', gain: 0.22, maxVoices: 5, minInterval: 0.04, rateJitter: 0.07 },

  // --- the tank ---------------------------------------------------------------
  // the shell is the loudest thing in the game on purpose: the player's own act
  tank_main:      { file: `${A}/tank_main.mp3`,      bus: 'tank', gain: 1.00, maxVoices: 2, minInterval: 0.10, rateJitter: 0.03 },
  tank_secondary: { file: `${A}/tank_secondary.mp3`, bus: 'tank', gain: 0.30, maxVoices: 3, minInterval: 0.11, rateJitter: 0.10 },
  tank_destroyed: { file: `${A}/tank_destroyed.mp3`, bus: 'tank', gain: 1.0, maxVoices: 1, minInterval: 0.5, rateJitter: 0 },
  tank_shells:    { file: `${A}/tank_shells.mp3`,    bus: 'tank', gain: 0.70, maxVoices: 2, minInterval: 0.05, rateJitter: 0.04 },
  // The engine is THREE sounds, not one: hydraulics lift the tank as it
  // starts, a thruster bed carries it while moving, hydraulics set it back
  // down when it stops. A single looping sample could never give the start
  // and stop any weight.
  tank_spool_up:   { file: `${A}/tank_spool_up.mp3`,   bus: 'tank', gain: 0.55, maxVoices: 1, minInterval: 0.25, rateJitter: 0.03 },
  tank_spool_down: { file: `${A}/tank_spool_down.mp3`, bus: 'tank', gain: 0.50, maxVoices: 1, minInterval: 0.25, rateJitter: 0.03 },
  // the bed under everything while moving; the caller sets gain and rate from speed
  tank_thruster:  { file: `${A}/tank_thruster.mp3`,  bus: 'tank', gain: 0.34, maxVoices: 1, minInterval: 0, rateJitter: 0 },
  tank_engine:    { file: `${A}/tank_engine.mp3`,    bus: 'tank', gain: 0.22, maxVoices: 1, minInterval: 0, rateJitter: 0 },
  laser_click:    { file: `${A}/laser_click.mp3`,    bus: 'tank', gain: 0.5, maxVoices: 1, minInterval: 0.22, rateJitter: 0.06 },

  // --- impacts: what a hit sounds like, keyed by what was hit ----------------
  impact_shell:  { file: `${A}/tower_single.mp3`,   bus: 'tank', gain: 0.55, maxVoices: 3, minInterval: 0.05, rateJitter: 0.10 },
  impact_rubble: { file: `${A}/tank_destroyed.mp3`, bus: 'tank', gain: 0.70, maxVoices: 2, minInterval: 0.20, rateJitter: 0.05 },
  impact_hit:    { file: `${A}/tank_secondary.mp3`, bus: 'tank', gain: 0.45, maxVoices: 3, minInterval: 0.08, rateJitter: 0.12 },

  // --- the assembly line: a faint hydraulic bed per machine ------------------
  // (an electric hum built from a dial-up master was cut: it read as a modem)
  assembly_hydraulics: { file: `${A}/assembly_hydraulics.mp3`, bus: 'ambient', gain: 0.30, maxVoices: 3, minInterval: 0, rateJitter: 0 },
};

// the sentry families' rounds; a lobber's is the aoe thump
export const SENTRY_FIRE = {
  needle: 'tower_sniper', rotor: 'minigun_fire', kiln: 'tower_aoe', quiver: 'tower_homing', lancer: 'tower_laser',
  railgun: 'tower_sniper', howitzer: 'tower_aoe', mortar: 'tower_aoe', plasma: 'tower_laser', heptapod_a6: 'tower_homing',
};

export const DEATH_KEYS = [];
export const GLOBAL_VOICE_CAP = 24;
// inverse-distance falloff, in METRES here: a turret 45 m off is half as loud
export const DISTANCE_K = 45;
export const DEFAULT_LEVELS = { master: 0.7, towers: 0.5, tank: 0.8, ambient: 0.5, ui: 0.4 };
