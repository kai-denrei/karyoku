// soundlab.js — the game's elements and what each one sounds like, as data.
// The lab tab renders this; the test checks it against the manifest. Its
// job is calibration and GAPS: every element the game has is listed, with
// its events, whether the event has a clip, and whether the game actually
// fires that clip. A row with no key is a sound we are missing. A row with a
// key nothing fires is a clip we own and have not yet used.
//
// `wired` says the game code fires it (sfx.js or a tab). `loop` says it is
// a bed the lab should toggle rather than trigger. `want` describes what a
// missing sound should be, so the gap is a brief, not just a blank.

export const ELEMENTS = [
  { id: 'tank', label: 'MKCX-2 hover tank', events: [
    { event: 'engine start: hydraulics lift the hull', key: 'tank_spool_up', wired: true },
    { event: 'engine bed while moving (gain and rate follow speed)', key: 'tank_thruster', wired: true, loop: true },
    { event: 'engine stop: hydraulics set it down', key: 'tank_spool_down', wired: true },
    { event: 'main gun fires', key: 'tank_main', wired: true },
    { event: 'secondary guns fire', key: 'tank_secondary', wired: false },
    { event: 'shell casings ejected', key: 'tank_shells', wired: false },
    { event: 'hit by a sentry round', key: 'impact_hit', wired: true },
    { event: 'destroyed', key: 'tank_destroyed', wired: false },
    { event: 'idle bed (engine running, not moving)', key: 'tank_engine', wired: false, loop: true },
    { event: 'pushing a container', key: null, want: 'metal scrape, low, sustained while the push lasts' },
    { event: 'scraping a wall', key: null, want: 'short metallic grind on contact' },
    { event: 'muzzle elevation change', key: null, want: 'faint servo tick per step' },
  ] },
  { id: 'sentries', label: 'Sentries', events: [
    { event: 'needle fires', family: 'needle' },
    { event: 'rotor fires', family: 'rotor' },
    { event: 'kiln fires', family: 'kiln' },
    { event: 'quiver fires', family: 'quiver' },
    { event: 'lancer fires', family: 'lancer' },
    { event: 'railgun fires', family: 'railgun' },
    { event: 'howitzer lobs', family: 'howitzer' },
    { event: 'mortar lobs', family: 'mortar' },
    { event: 'plasma fires', family: 'plasma' },
    { event: 'heptapod fires', family: 'heptapod_a6' },
    { event: 'rotor spins up before firing', key: 'minigun_ready', wired: false },
    { event: 'a family with no round of its own (fallback)', key: 'tower_single', wired: true },
    { event: 'rapid round (reference leftover)', key: 'tower_rapid', wired: false },
    { event: 'turret slews onto the hull', key: null, want: 'servo whine, pitched by slew rate, audible only near' },
    { event: 'sentry destroyed', key: null, want: 'not in the PoC: sentries take no damage yet' },
  ] },
  { id: 'impacts', label: 'Shell impacts', events: [
    { event: 'shell hits a wall or building', key: 'impact_shell', wired: true },
    { event: 'wall panel collapses to rubble', key: 'impact_rubble', wired: true },
    { event: 'shell hits the ground', key: null, want: 'dull thud with dirt, quieter than a wall hit' },
    { event: 'lob lands (splash ring)', key: null, want: 'heavy crump, low, felt more than heard' },
    { event: 'sentry round hits a wall', key: null, want: 'small ricochet ping' },
  ] },
  { id: 'gates', label: 'Gates', events: [
    { event: 'gate opens on approach', key: null, want: 'motor and slat rattle over the 1.2 s open' },
    { event: 'gate closes behind', key: null, want: 'the same reversed, ending in a latch' },
  ] },
  { id: 'assembly', label: 'Robotic assembly line', events: [
    { event: 'hydraulic bed, faint, per machine', key: 'assembly_hydraulics', wired: true, loop: true },
    { event: 'electric hum', key: null, want: 'REMOVED: the dial-up build read as a modem. Wants a clean transformer hum, no modulation' },
  ] },
  { id: 'crew', label: 'Astronauts', events: [
    { event: 'run over (red splash)', key: null, want: 'wet crunch, short; the Firepower moment' },
    { event: 'flee from the enemy tank', key: null, want: 'a muffled shout through the suit radio' },
    { event: 'footsteps', key: null, want: 'probably none: too many walkers, too faint at camera range' },
  ] },
  { id: 'containers', label: 'Containers', events: [
    { event: 'shoved and sliding', key: null, want: 'metal on concrete scrape while it moves' },
    { event: 'hit by a shell (no damage)', key: null, want: 'hollow steel ring' },
  ] },
  { id: 'ui', label: 'Interface', events: [
    { event: 'camera switch', key: null, want: 'small click, ui bus' },
    { event: 'regenerate base', key: null, want: 'none, or a soft chime' },
    { event: 'laser click (reference leftover)', key: 'laser_click', wired: false },
  ] },
  { id: 'ambient', label: 'World', events: [
    { event: 'colony wind bed', key: null, want: 'thin wind, barely there, lifts with camera height' },
    { event: 'terraformer Stalheart', key: null, want: 'deep pulse, very slow, only near' },
  ] },
];

// Flatten to rows the lab draws. Sentry rows take their key from the
// family map so the lab and the game can never disagree about which round a
// family fires. Status is the whole point:
//   wired    the clip exists and the game fires it
//   unwired  the clip exists, nothing fires it
//   missing  no clip at all (the `want` says what it should be)
//   nofile   a key with no manifest entry: a bug, the test fails on it
export function labRows(elements, sounds, sentryFire) {
  const rows = [];
  for (const el of elements) {
    for (const ev of el.events) {
      const key = ev.family ? (sentryFire[ev.family] || null) : ev.key;
      const wired = ev.family ? Boolean(key) : Boolean(ev.wired);
      const entry = key ? sounds[key] : null;
      const status = !key ? 'missing' : !entry ? 'nofile' : wired ? 'wired' : 'unwired';
      rows.push({ element: el.id, label: el.label, event: ev.event, key, family: ev.family || null, loop: Boolean(ev.loop), status, want: ev.want || '', bus: entry ? entry.bus : null, gain: entry ? entry.gain : null, file: entry ? entry.file : null });
    }
  }
  return rows;
}

export function labSummary(rows) {
  const s = { wired: 0, unwired: 0, missing: 0, nofile: 0, total: rows.length };
  for (const r of rows) s[r.status]++;
  return s;
}

// Manifest keys no element claims: clips we carry and have forgotten about.
export function unclaimedKeys(rows, sounds) {
  const used = new Set(rows.map((r) => r.key).filter(Boolean));
  return Object.keys(sounds).filter((k) => !used.has(k));
}
