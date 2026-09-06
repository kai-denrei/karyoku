// audiomix.js — the voice budget, as pure functions over a plain state
// object. DOM-free, AudioContext-free, Node-tested.
//
// Managing sound intensity is four layers, cheapest first:
//   1. per-key minInterval  — a retrigger inside the window is DROPPED.
//      This is what keeps eight rapid towers from becoming a buzz.
//   2. per-key maxVoices    — over the cap the OLDEST voice is stolen.
//   3. a global ceiling     — a backstop independent of any one key.
//   4. distanceGain         — events far from the camera are quieter.
//
// Stealing returns an id rather than doing anything: the caller ramps
// that voice down over ~30ms before stopping it, because a hard cut
// mid-waveform is an audible click. Keeping that decision here and the
// ramp there is what makes this half testable.

export function makeMixState() {
  return { voices: [], lastFire: Object.create(null) };
}

// Inverse-distance falloff. Plain gain, deliberately NOT a PannerNode:
// true 3D panning on a sphere the player orbits is disorienting, and a
// panner per voice is real cost for a cue the player reads visually.
export function distanceGain(d, k) {
  const kk = k > 0 ? k : 1e-6;
  const g = 1 / (1 + Math.max(0, d) / kk);
  return Number.isFinite(g) ? Math.max(1e-6, g) : 1e-6;
}

function oldest(voices, key) {
  let best = null;
  for (const v of voices) {
    if (key !== null && v.key !== key) continue;
    if (best === null || v.t < best.t) best = v;
  }
  return best;
}

// Decide whether `key` may start now. Never throws; never blocks.
export function admit(state, key, now, cfg, globalCap) {
  const minInterval = cfg.minInterval ?? 0;
  const last = state.lastFire[key];
  if (last !== undefined && now - last < minInterval) {
    return { ok: false, steal: null, reason: 'min-interval' };
  }

  const maxVoices = cfg.maxVoices ?? 4;
  let steal = null;

  let n = 0;
  for (const v of state.voices) if (v.key === key) n++;
  if (n >= maxVoices) {
    const o = oldest(state.voices, key);
    if (o) steal = o.id;
  }

  // the global ceiling is a separate backstop: it can bite even when the
  // per-key cap is fine (many different keys, all live at once)
  if (steal === null && state.voices.length >= globalCap) {
    const o = oldest(state.voices, null);
    if (o) steal = o.id;
  }

  return { ok: true, steal, reason: 'ok' };
}

export function addVoice(state, key, now, id) {
  state.voices.push({ id, key, t: now });
  state.lastFire[key] = now;
  return id;
}

export function dropVoice(state, id) {
  const i = state.voices.findIndex((v) => v.id === id);
  if (i !== -1) state.voices.splice(i, 1);
}
