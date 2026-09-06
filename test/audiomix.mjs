// audiomix.mjs — the voice budget. This is the whole of "manage sound
// intensity": everything that decides whether a sound is allowed to
// start, and which one dies when the budget is full, is pure and lives
// here. No AudioContext, no DOM, so it is testable in Node.

import { makeMixState, distanceGain, admit, addVoice, dropVoice } from '../src/audiomix.js';

let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { console.error(`  FAIL ${name} ${detail}`); failures++; }
};

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

console.log('distanceGain:');
check('unity at zero distance', near(distanceGain(0, 2), 1));
check('half at d = k', near(distanceGain(2, 2), 0.5));
check('monotonically decreasing', distanceGain(1, 2) > distanceGain(5, 2));
check('never zero, never negative', distanceGain(1e6, 2) > 0);
check('finite for absurd input', Number.isFinite(distanceGain(1e12, 0.001)));

console.log('min-interval gating:');
{
  const s = makeMixState();
  const cfg = { maxVoices: 4, minInterval: 0.1 };
  const a = admit(s, 'k', 0, cfg, 24);
  check('first call admitted', a.ok === true && a.reason === 'ok');
  addVoice(s, 'k', 0, 1);
  const b = admit(s, 'k', 0.05, cfg, 24);
  check('retrigger inside the window is dropped', b.ok === false && b.reason === 'min-interval');
  const c = admit(s, 'k', 0.1, cfg, 24);
  check('retrigger at the window edge is admitted', c.ok === true);
  const d = admit(s, 'other', 0.05, cfg, 24);
  check('the window is per-key, not global', d.ok === true);
}

console.log('per-key voice cap:');
{
  const s = makeMixState();
  const cfg = { maxVoices: 2, minInterval: 0 };
  addVoice(s, 'k', 0.0, 1);
  addVoice(s, 'k', 0.1, 2);
  const r = admit(s, 'k', 0.2, cfg, 24);
  check('over the cap, admitted anyway', r.ok === true);
  check('over the cap, steals the OLDEST voice', r.steal === 1);
  addVoice(s, 'other', 0.0, 9);
  const r2 = admit(s, 'k', 0.3, cfg, 24);
  check('the cap counts only this key', r2.steal === 1 && r2.steal !== 9);
}

console.log('global ceiling:');
{
  const s = makeMixState();
  const cfg = { maxVoices: 99, minInterval: 0 };
  for (let i = 0; i < 24; i++) addVoice(s, `k${i}`, i * 0.001, i);
  const r = admit(s, 'fresh', 1, cfg, 24);
  check('at the ceiling, admitted by stealing', r.ok === true);
  check('the ceiling steals the globally oldest', r.steal === 0);
  check('under the ceiling steals nothing', (() => {
    const s2 = makeMixState();
    addVoice(s2, 'a', 0, 1);
    return admit(s2, 'b', 1, cfg, 24).steal === null;
  })());
}

console.log('bookkeeping:');
{
  const s = makeMixState();
  addVoice(s, 'k', 0, 1);
  addVoice(s, 'k', 0, 2);
  dropVoice(s, 1);
  check('dropVoice removes exactly one', s.voices.length === 1 && s.voices[0].id === 2);
  dropVoice(s, 999);
  check('dropping an unknown id is a no-op', s.voices.length === 1);
}

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\naudio mix invariants hold');
