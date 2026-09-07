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
  impact_hit:    { file: `${A}/hull_hit.mp3`,       bus: 'tank', gain: 0.70, maxVoices: 3, minInterval: 0.08, rateJitter: 0.08 },
  // the hull against the world: a wall at speed; a crate, barrel, case,
  // pallet or container at any speed (one of THUD_SLICES, a slice each)
  hull_wall:     { file: `${A}/hull_wall.mp3`,      bus: 'tank', gain: 0.60, maxVoices: 2, minInterval: 0.35, rateJitter: 0.05 },
  thud:          { file: `${A}/thuds.mp3`,          bus: 'tank', gain: 0.55, maxVoices: 3, minInterval: 0.12, rateJitter: 0.06 },
  // something small run over or rammed apart: the operator's door slam
  crush_slam:    { file: `${A}/crush_slam.mp3`,     bus: 'tank', gain: 0.60, maxVoices: 2, minInterval: 0.15, rateJitter: 0.08 },
  // the muzzle's gears while the elevation changes (a loop, muffled)
  muzzle_gears:  { file: `${A}/muzzle_gears.mp3`,   bus: 'tank', gain: 0.35, maxVoices: 1, minInterval: 0, rateJitter: 0 },
  // the interface: a cassette deck's stop button for a camera change
  ui_click:      { file: `${A}/ui_click.mp3`,       bus: 'ui',   gain: 0.60, maxVoices: 2, minInterval: 0.08, rateJitter: 0 },
  // a sentry breaking: the reference's tank death, which is the big one
  sentry_destroyed: { file: `${A}/tank_destroyed.mp3`, bus: 'towers', gain: 0.90, maxVoices: 2, minInterval: 0.30, rateJitter: 0.05 },

  // --- the soft bodies: an astronaut hit by a shell, or run over. Three
  // cries, picked at random per death so a crowd never chants ------------
  enemy_die_a: { file: `${A}/enemy_die_a.mp3`, bus: 'tank', gain: 0.60, maxVoices: 3, minInterval: 0.04, rateJitter: 0.12 },
  enemy_die_b: { file: `${A}/enemy_die_b.mp3`, bus: 'tank', gain: 0.60, maxVoices: 3, minInterval: 0.04, rateJitter: 0.12 },
  enemy_die_c: { file: `${A}/enemy_die_c.mp3`, bus: 'tank', gain: 0.60, maxVoices: 3, minInterval: 0.04, rateJitter: 0.12 },

  // --- a container being shoved: the operator's rumble, low-passed and
  // quiet, looped from a random point so two never move in step ----------
  container_rumble: { file: `${A}/container_rumble.mp3`, bus: 'ambient', gain: 0.30, maxVoices: 3, minInterval: 0, rateJitter: 0 },

  // --- the assembly line: a faint hydraulic bed per machine ------------------
  // (an electric hum built from a dial-up master was cut: it read as a modem)
  assembly_hydraulics: { file: `${A}/assembly_hydraulics.mp3`, bus: 'ambient', gain: 0.30, maxVoices: 3, minInterval: 0, rateJitter: 0 },
};

// the sentry families' rounds; a lobber's is the aoe thump
export const SENTRY_FIRE = {
  needle: 'tower_sniper', rotor: 'minigun_fire', kiln: 'tower_aoe', quiver: 'tower_homing', lancer: 'tower_laser',
  railgun: 'tower_sniper', howitzer: 'tower_aoe', mortar: 'tower_aoe', plasma: 'tower_laser', heptapod_a6: 'tower_homing',
};

export const DEATH_KEYS = ['enemy_die_a', 'enemy_die_b', 'enemy_die_c'];
// the thud file's twelve thuds: [offset, duration] seconds (silencedetect at -35 dB)
export const THUD_SLICES = [0.27, 1.79, 3.29, 4.64, 5.72, 6.96, 7.96, 9.06, 10.13, 11.11, 12.02, 13.13].map((t) => [t, 0.45]);
export const GLOBAL_VOICE_CAP = 24;
// inverse-distance falloff, in METRES here: a turret 45 m off is half as loud
export const DISTANCE_K = 45;
export const DEFAULT_LEVELS = { master: 0.7, towers: 0.5, tank: 0.8, ambient: 0.5, ui: 0.4 };
