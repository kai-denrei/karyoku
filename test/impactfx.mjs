// impactfx.mjs — the impact set's invariants. Almost all of this file is
// three.js and cannot be tested in Node, so this pins the two things that can
// be and that silently rot: the knob schema, and the recipes naming families
// that actually exist. A recipe naming a family nobody built does not throw —
// makeImpact returns null and the effect is simply missing from the hit.
import {
  IMPACT_TUNE, IMPACT_KNOBS, IMPACT_FAMILIES, IMPACT_RECIPES,
  impactKnobProblems, makeImpactParams, clampImpactParams,
} from '../src/impactfx.js';

let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { console.error(`  FAIL ${name} ${detail}`); failures++; }
};

console.log('schema:');
check('knob table is sound', impactKnobProblems().length === 0, impactKnobProblems().join('; '));
check('every knob names a real constant',
  IMPACT_KNOBS.every((k) => k.key in IMPACT_TUNE));
check('every family has at least one knob',
  IMPACT_FAMILIES.every((f) => IMPACT_KNOBS.some((k) => k.group === f)),
  IMPACT_FAMILIES.filter((f) => !IMPACT_KNOBS.some((k) => k.group === f)).join(','));

console.log('recipes:');
for (const [name, families] of Object.entries(IMPACT_RECIPES)) {
  check(`"${name}" names only families that exist`,
    families.every((f) => IMPACT_FAMILIES.includes(f)),
    families.filter((f) => !IMPACT_FAMILIES.includes(f)).join(','));
  check(`"${name}" is not empty`, families.length > 0);
}
check('every family is reachable from at least one recipe',
  IMPACT_FAMILIES.every((f) => Object.values(IMPACT_RECIPES).some((r) => r.includes(f))),
  IMPACT_FAMILIES.filter((f) => !Object.values(IMPACT_RECIPES).some((r) => r.includes(f))).join(','));

console.log('params round-trip:');
{
  const p = makeImpactParams();
  check('params carry every knob', IMPACT_KNOBS.every((k) => k.key in p));
  // a URL is untrusted input, including our own from a stale bookmark.
  // MIND THE ARGUMENT ORDER: clampParams(knobs, DEST, SRC) reads from the
  // third argument and writes into the second, so passing the dirty values as
  // the second silently folds the defaults over them and tests nothing.
  const dirty = { sparkCount: 1e9, sparkLife: -5, splashCling: 42 };
  const clean = clampImpactParams(makeImpactParams(), dirty);
  const kc = IMPACT_KNOBS.find((k) => k.key === 'sparkCount');
  const kl = IMPACT_KNOBS.find((k) => k.key === 'sparkLife');
  check('an absurd count is clamped to the knob max', clean.sparkCount === kc.max, `${clean.sparkCount}`);
  check('a negative life is clamped to the knob min', clean.sparkLife === kl.min, `${clean.sparkLife}`);
  check('a value the source never mentioned keeps its default',
    clean.emberCount === IMPACT_TUNE.emberCount, `${clean.emberCount}`);
}

console.log('the tune is sane:');
check('spark spread stays inside a hemisphere', IMPACT_TUNE.sparkSpread <= Math.PI / 2);
check('the flash is the shortest-lived family — a flash you can look at is a lamp',
  IMPACT_TUNE.flashLife < IMPACT_TUNE.sparkLife
  && IMPACT_TUNE.flashLife < IMPACT_TUNE.ringLife);
check('the scorch outlives every fast family — it is the record of your aim',
  IMPACT_TUNE.scorchLife > IMPACT_TUNE.sparkLife
  && IMPACT_TUNE.scorchLife > IMPACT_TUNE.ringLife
  && IMPACT_TUNE.scorchLife > IMPACT_TUNE.debrisLife);
check('embers outlast the bang', IMPACT_TUNE.emberLife > IMPACT_TUNE.sparkLife);
check('bounce keeps energy from being created', IMPACT_TUNE.sparkBounce <= 1);

console.log(failures ? `\n${failures} FAILURES` : '\nall impact invariants hold');
process.exit(failures ? 1 : 0);
