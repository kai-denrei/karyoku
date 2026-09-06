// knobs.js — the machinery behind a tuning panel, with no opinion about what
// is being tuned.
//
// The tank's feel tuner proved the shape of this: one table describing every
// tunable (key, label, group, range, step), a mutable params object the
// sliders write into, a defensive restore for anything coming back from
// storage, and a copy-as-source button so a good setting reaches the repo
// instead of dying in one browser.
//
// Towers want exactly the same four things. Rather than a second copy that
// drifts, both sides declare a knob table and share this.
//
// Pure: no DOM, no three.js, Node-testable.

// A fresh, mutable set of values — what the sliders write to.
export function makeParams(knobs, src) {
  const p = {};
  for (const k of knobs) p[k.key] = src[k.key];
  return p;
}

// Fold a loose object (a stored blob, a URL param) onto a params set, keeping
// only known keys and only finite values inside their declared range.
// Anything restored from outside the app is untrusted input — including our
// own localStorage after a schema change.
export function clampParams(knobs, p, src = {}) {
  for (const k of knobs) {
    if (k.bool) {
      // booleans restore as booleans or as '0'/'1'/0/1; anything else is junk
      const v = src[k.key];
      if (typeof v === 'boolean') p[k.key] = v;
      else if (v === 1 || v === '1') p[k.key] = true;
      else if (v === 0 || v === '0') p[k.key] = false;
      continue;
    }
    const v = Number(src[k.key]);
    if (Number.isFinite(v)) p[k.key] = Math.min(k.max, Math.max(k.min, v));
  }
  return p;
}

// Snap to the slider's own precision, so a drag never emits 0.13999999999.
export function roundToStep(v, step) {
  const dp = Math.max(0, Math.ceil(-Math.log10(step)));
  return Number(Number(v).toFixed(dp));
}

// The tuned values as a paste-ready source block. Without this a good setting
// lives in one browser and never reaches the repo, which makes the whole
// bench a toy — you can find the right feel and still not ship it.
export function formatKnobs(name, knobs, p) {
  const groups = [...new Set(knobs.map((k) => k.group))];
  const w = Math.max(...knobs.map((k) => k.key.length));
  const body = groups.map((g) => knobs.filter((k) => k.group === g)
    .map((k) => `  ${(k.key + ':').padEnd(w + 1)} ${fmt(p[k.key], k)},`.padEnd(30)
                + ` // ${k.label}`)
    .join('\n')).join('\n\n');
  return `export const ${name} = {\n${body}\n};`;
}

// Choice knobs carry their value as a string and must be quoted; numeric ones
// are snapped to their step.
function fmt(v, k) {
  if (k.bool) return String(!!v);
  return k.choices ? JSON.stringify(v) : roundToStep(v, k.step);
}

// Every invariant a knob table has to satisfy to be safe to build UI from.
// Returned rather than thrown so a test can report all of them at once.
export function knobProblems(knobs, defaults) {
  const out = [];
  const seen = new Set();
  for (const k of knobs) {
    if (seen.has(k.key)) out.push(`duplicate key: ${k.key}`);
    seen.add(k.key);
    if (!k.label || !k.group) out.push(`${k.key}: missing label or group`);
    if (!(k.key in defaults)) out.push(`${k.key}: names no constant`);
    if (k.bool) {
      if (typeof defaults[k.key] !== 'boolean') out.push(`${k.key}: bool knob with a non-boolean default`);
      continue;
    }
    if (k.choices) {
      if (!k.choices.includes(defaults[k.key])) out.push(`${k.key}: default is not one of its choices`);
      continue;
    }
    if (!(Number.isFinite(k.min) && Number.isFinite(k.max) && k.step > 0)) {
      out.push(`${k.key}: bad range`);
    } else if (defaults[k.key] < k.min || defaults[k.key] > k.max) {
      // a slider whose range excludes the shipped value is a trap: the first
      // drag jumps to a different look than the one you were judging
      out.push(`${k.key}: default ${defaults[k.key]} outside ${k.min}..${k.max}`);
    }
  }
  for (const key of Object.keys(defaults)) {
    if (!seen.has(key)) out.push(`${key}: tunable with no knob`);
  }
  return out;
}
