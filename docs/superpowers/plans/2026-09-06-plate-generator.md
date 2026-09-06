# Plate Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A seeded generator that lays out a military base on a flat 4 m plate from the asset catalog, with a three.js viewer to inspect it, served from `npm run serve`.

**Architecture:** Pure logic (`catalog-spec.js`, `catalog.js`, `plate.js`) is DOM-free and Node-tested; `plate-tab.js` renders a `Plate` and never computes layout. Assets come from the vendored base-kit manifest (real GLBs) and the transcribed spec table (placeholder boxes). Everything derives from `params.seed` through `mulberry32`.

**Tech Stack:** Vanilla ES modules, three.js r160 vendored from `~/Dev/spherical-stalberg-grid/vendor/`, `lil-gui`, Node 18+ for tests, Python 3 for the static server and the catalog transcription script.

## Global Constraints

- No build step. Browser-native ES modules only. No npm runtime dependencies.
- three.js r160, vendored. Never put `?v=` on a `../vendor/` import.
- Every `src/*.js` relative import carries `?v=<token>`; `./scripts/bust.sh --quiet` rewrites tokens after any edit to `src/`, HTML or CSS. Commit bust output atomically (`git add -A`).
- No emoji anywhere, monochrome dingbats only. `scripts/check-emoji.sh` enforces it.
- No `Math.random` in generator logic. Everything seeds from `params.seed` via `mulberry32`.
- One cell is 4 m (`CELL_M = 4`). Plate width and depth are even.
- Directions: N is +Z, E is +X (the base kit's own convention). `rot` is quarter turns clockwise seen from above: N to E to S to W. In three.js that is `rotation.y = rot * Math.PI / 2`.
- Sentry yaw: degrees compass-style, 0 is N (+Z), 90 is E (+X). Direction vector is `[sin(yaw), cos(yaw)]` in `[x, z]`.
- Pure modules never import three.js or touch `document`.
- Commit author must be `Kai Denrei <270854086+kai-denrei@users.noreply.github.com>` (already set in this repo).

---

## File structure

| Path | Responsibility |
| --- | --- |
| `index.html` | Shell: canvas root, one tab, meta cb token |
| `styles.css` | Minimal dark layout, ASCII overlay box |
| `src/main.js` | Boots the plate tab |
| `src/rng.js`, `src/vec3.js`, `src/knobs.js`, `src/glbmodels.js` | Copied verbatim from the reference |
| `src/catalog-spec.js` | Generated transcription of `base-assets.md`: 109 rows |
| `src/catalog.js` | Merge spec rows with the base-kit manifest into one catalog |
| `src/plate.js` | The generator: knobs, ring, gates, roads, blocks, packing, sentries, ascii, coverage |
| `src/plate-tab.js` | three.js viewer, knob panel, URL params, ASCII overlay |
| `assets/base-kit/` | Vendored manifest and seven GLBs |
| `assets/models/sentries/` | 33 sentry GLBs copied from the reference |
| `scripts/gen-catalog-spec.py` | Parses `base-assets.md` into `src/catalog-spec.js` |
| `scripts/bust.sh`, `scripts/fingerprint-urls.py`, `scripts/check-tokens.sh`, `scripts/check-emoji.sh`, `scripts/chrome-proc.mjs`, `scripts/headless-wait.mjs` | Copied from the reference |
| `scripts/plate-verify.sh` | Headless: browser ASCII equals Node ASCII for one seed |
| `test/check.mjs` | Shared `check` and `done` helpers |
| `test/catalog.mjs`, `test/plate.mjs` | Invariant suites |
| `.githooks/pre-push` | Runs the token and emoji checks |

---

### Task 1: Scaffold the repo from the reference

**Files:**
- Create: `package.json`, `index.html`, `styles.css`, `src/main.js`, `test/check.mjs`, `test/rng.mjs`, `.githooks/pre-push`, `README.md`
- Copy: `vendor/` (whole folder), `src/rng.js`, `src/vec3.js`, `src/knobs.js`, `src/glbmodels.js`, `scripts/bust.sh`, `scripts/fingerprint-urls.py`, `scripts/check-tokens.sh`, `scripts/check-emoji.sh`, `scripts/chrome-proc.mjs`, `scripts/headless-wait.mjs`

**Interfaces:**
- Produces: `test/check.mjs` exporting `check(name, cond, detail)` and `done()`; `npm test`; `npm run serve` on port 8150; `./scripts/bust.sh --quiet`.

- [ ] **Step 1: Copy the reference files**

```bash
cd /Users/minikai/Dev/karyoku
REF=/Users/minikai/Dev/spherical-stalberg-grid
mkdir -p src scripts test .githooks assets/models
cp -R "$REF/vendor" vendor
cp "$REF/src/rng.js" "$REF/src/vec3.js" "$REF/src/knobs.js" "$REF/src/glbmodels.js" src/
cp "$REF/scripts/bust.sh" "$REF/scripts/fingerprint-urls.py" "$REF/scripts/check-tokens.sh" \
   "$REF/scripts/check-emoji.sh" "$REF/scripts/chrome-proc.mjs" "$REF/scripts/headless-wait.mjs" scripts/
cp "$REF/.githooks/pre-push" .githooks/
chmod +x scripts/*.sh .githooks/pre-push
git config core.hooksPath .githooks
ls vendor | wc -l
```
Expected: 21 vendor files listed. `src/glbmodels.js` imports `../vendor/three.module.js`, `../vendor/GLTFLoader.js`, `../vendor/meshopt_decoder.module.js`, `../vendor/BufferGeometryUtils.js`, all present.

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "karyoku",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node test/rng.mjs && node test/catalog.mjs && node test/plate.mjs",
    "serve": "python3 -m http.server 8150",
    "bust": "./scripts/bust.sh"
  }
}
```

Until Tasks 2 and 4 exist, run suites individually with `node test/<name>.mjs`.

- [ ] **Step 3: Write `test/check.mjs`**

```js
// check.mjs — the one assertion helper every suite shares. A suite prints
// `ok` / `FAIL` lines and exits non-zero on any failure, so `npm test` can
// chain suites with `&&`.
let failures = 0;
export const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { console.error(`  FAIL ${name} ${detail}`); failures++; }
};
export const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;
export function done() {
  if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
  console.log('all ok');
}
```

- [ ] **Step 4: Write `test/rng.mjs` (proves the chain runs)**

```js
import { mulberry32 } from '../src/rng.js';
import { check, done } from './check.mjs';

const a = mulberry32(7), b = mulberry32(7);
const sa = Array.from({ length: 5 }, () => a());
const sb = Array.from({ length: 5 }, () => b());
check('same seed, same sequence', sa.every((v, i) => v === sb[i]));
check('values in [0,1)', sa.every((v) => v >= 0 && v < 1));
check('different seed differs', mulberry32(8)() !== sa[0]);
done();
```

Run: `node test/rng.mjs`
Expected: three `ok` lines and `all ok`.

- [ ] **Step 5: Write `index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>karyoku</title>
  <meta name="theme-color" content="#0e1116">
  <link rel="stylesheet" href="./styles.css?v=00000000">
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
  <meta name="cb" content="00000000">
</head>
<body>
  <nav id="tabbar">
    <span class="brand">karyoku</span>
    <button data-tab="plate" class="active">plate</button>
    <span class="build">build <code id="build-token"></code></span>
  </nav>
  <main>
    <section id="tab-plate" class="tab active"></section>
  </main>
  <script type="module" src="./src/main.js?v=00000000"></script>
</body>
</html>
```

- [ ] **Step 6: Write `styles.css`**

```css
:root { --bg: #0e1116; --fg: #cfd6e0; --dim: #6b7583; --line: #232a35; --accent: #7df9ff; }
html, body { margin: 0; height: 100%; background: var(--bg); color: var(--fg);
  font: 13px/1.4 ui-monospace, Menlo, Consolas, monospace; overflow: hidden; }
#tabbar { position: fixed; top: 0; left: 0; right: 0; height: 36px; display: flex;
  align-items: center; gap: 12px; padding: 0 12px; background: #0a0d12;
  border-bottom: 1px solid var(--line); z-index: 10; }
#tabbar .brand { color: var(--accent); letter-spacing: 0.12em; }
#tabbar button { background: none; border: 1px solid var(--line); color: var(--fg);
  padding: 3px 10px; font: inherit; cursor: pointer; }
#tabbar button.active { border-color: var(--accent); color: var(--accent); }
#tabbar .build { margin-left: auto; color: var(--dim); }
main { position: absolute; top: 36px; left: 0; right: 0; bottom: 0; }
.tab { position: absolute; inset: 0; display: none; }
.tab.active { display: block; }
.tab canvas { display: block; width: 100%; height: 100%; }
.ascii-overlay { position: absolute; left: 12px; bottom: 12px; padding: 8px 10px;
  background: rgba(10, 13, 18, 0.88); border: 1px solid var(--line); color: var(--fg);
  white-space: pre; font-size: 11px; line-height: 1.05; letter-spacing: 0.35em;
  pointer-events: none; }
.ascii-overlay[hidden] { display: none; }
.notice { position: absolute; left: 12px; top: 12px; padding: 4px 8px; color: #ffb454;
  background: rgba(10, 13, 18, 0.88); border: 1px solid var(--line); }
.notice[hidden] { display: none; }
.lil-gui { --width: 280px; }
```

- [ ] **Step 7: Write `src/main.js`**

```js
// main.js — boots the one tab. The build token in the nav is read from the
// <meta name="cb"> that bust.sh maintains, so the page says which build it is.
import { initPlateTab } from './plate-tab.js?v=00000000';

const meta = document.querySelector('meta[name="cb"]');
const tok = document.getElementById('build-token');
if (meta && tok) tok.textContent = meta.content;

initPlateTab(document.getElementById('tab-plate'));
```

`src/plate-tab.js` does not exist yet; the page will 404 on it until Task 8. That is expected.

- [ ] **Step 8: Write `README.md`**

```markdown
# karyoku

Homage to Firepower (Amiga). Procedural military bases on flat 4 m plates,
organic Stålberg terrain between them. Vanilla ES modules, three.js r160,
no build step.

Design: `docs/superpowers/specs/2026-09-06-plate-generator-design.md`.

    npm run serve        # http://localhost:8150/#plate
    npm test             # Node invariant suites
    ./scripts/bust.sh    # bump cache-bust tokens after editing src/, HTML, CSS
```

- [ ] **Step 9: Bust tokens and verify the guards**

```bash
./scripts/bust.sh --quiet && ./scripts/check-tokens.sh && ./scripts/check-emoji.sh
```
Expected: `cache-bust tokens OK (?v=<token>)` and the emoji check passes. The `00000000` placeholders in `index.html` and `src/main.js` are now the real token.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "scaffold: vendor three r160, shared modules, scripts, test harness

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GjhA7Eswq3G5DUd7Ymvu88"
```

---

### Task 2: Catalog spec transcription

**Files:**
- Create: `scripts/gen-catalog-spec.py`, `src/catalog-spec.js` (generated), `test/catalog.mjs`

**Interfaces:**
- Produces: `CATALOG_SPEC` array of `{ id, name, section, plot: [x, z], ports }` and `specById(id)`; `SECTIONS` list.

- [ ] **Step 1: Write the failing test**

`test/catalog.mjs`:
```js
import { CATALOG_SPEC, SECTIONS, specById } from '../src/catalog-spec.js';
import { check, done } from './check.mjs';

check('109 asset types', CATALOG_SPEC.length === 109, `got ${CATALOG_SPEC.length}`);
check('unique ids', new Set(CATALOG_SPEC.map((r) => r.id)).size === CATALOG_SPEC.length);
check('every plot is two positive integers',
  CATALOG_SPEC.every((r) => r.plot.length === 2 && r.plot.every((n) => Number.isInteger(n) && n > 0)));
check('every section is known', CATALOG_SPEC.every((r) => SECTIONS.includes(r.section)));
check('gate is 3 by 2', specById('gate_vehicle').plot[0] === 3 && specById('gate_vehicle').plot[1] === 2);
check('launch pad is 8 by 8', specById('air_launchpad').plot.join('x') === '8x8');
check('wall has a wall port', specById('wall_standard').ports.includes('wall'));
check('road has a road port', specById('road_straight').ports.includes('road'));
check('unknown id is undefined', specById('nope') === undefined);
done();
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node test/catalog.mjs`
Expected: `ERR_MODULE_NOT_FOUND` for `src/catalog-spec.js`.

- [ ] **Step 3: Write the transcription script**

`scripts/gen-catalog-spec.py`:
```python
#!/usr/bin/env python3
"""Transcribe base-assets.md into src/catalog-spec.js.

The markdown is the master list an artist edits; this makes the JS a
derived file so the two cannot drift. Re-run after editing the markdown.
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'base-assets.md'
OUT = ROOT / 'src' / 'catalog-spec.js'

SECTION_OF = {
    'Ground and foundations': 'ground',
    'Roads and circulation': 'road',
    'Perimeter and access': 'perimeter',
    'Defense and observation': 'defense',
    'Command and communications': 'command',
    'Personnel and medical': 'personnel',
    'Logistics and storage': 'logistics',
    'Industry and maintenance': 'industry',
    'Power, life support and utilities': 'utility',
    'Air, orbital and drone operations': 'air',
    'Field devices and deployable protection': 'field',
    'Identity, interiors and environmental props': 'prop',
}

def ports_for(section, rid):
    if section == 'perimeter':
        return ['wall'] if not rid.startswith('fence') else ['fence']
    if rid.startswith('road_'):
        return ['road']
    if rid.startswith('walk_'):
        return ['walk']
    if rid in ('prop_vent', 'prop_antenna'):
        return ['roof']
    if section in ('command', 'personnel', 'logistics', 'industry', 'utility', 'air', 'defense'):
        return ['road']
    return ['none']

rows, section = [], None
for line in SRC.read_text(encoding='utf-8').splitlines():
    m = re.match(r'^## (.+)$', line)
    if m:
        section = SECTION_OF.get(m.group(1).strip())
        continue
    m = re.match(r'^\| `([a-z0-9_]+)` \| ([^|]+) \| (\d+) × (\d+) \| ([^|]+) \|$', line)
    if m and section:
        rid, name, px, pz, note = m.groups()
        rows.append((rid, name.strip(), section, int(px), int(pz), ports_for(section, rid), note.strip()))

if len(rows) != 109:
    sys.exit(f'expected 109 rows, parsed {len(rows)}')

def js_str(s):
    return "'" + s.replace('\\', '\\\\').replace("'", "\\'") + "'"

lines = [
    '// catalog-spec.js — GENERATED by scripts/gen-catalog-spec.py from',
    '// base-assets.md. Do not edit by hand; edit the markdown and re-run.',
    '// Plots are in 4 m cells, X by Z. Pure: no DOM, no three.js.',
    '',
    'export const SECTIONS = ' + str(list(dict.fromkeys(SECTION_OF.values()))).replace('"', "'") + ';',
    '',
    'export const CATALOG_SPEC = [',
]
for rid, name, section, px, pz, ports, note in rows:
    ports_js = '[' + ', '.join(js_str(p) for p in ports) + ']'
    lines.append(f"  {{ id: {js_str(rid)}, name: {js_str(name)}, section: {js_str(section)}, "
                 f"plot: [{px}, {pz}], ports: {ports_js}, note: {js_str(note)} }},")
lines += [
    '];',
    '',
    'const byId = new Map(CATALOG_SPEC.map((r) => [r.id, r]));',
    'export const specById = (id) => byId.get(id);',
    '',
]
OUT.write_text('\n'.join(lines), encoding='utf-8')
print(f'wrote {OUT.relative_to(ROOT)} with {len(rows)} rows')
```

- [ ] **Step 4: Generate and run the test**

```bash
python3 scripts/gen-catalog-spec.py && node test/catalog.mjs
```
Expected: `wrote src/catalog-spec.js with 109 rows`, then nine `ok` lines and `all ok`. If the row count is wrong, the regex did not match a table line; print the unmatched lines containing a backtick id and fix the pattern (the markdown uses `×` U+00D7 between plot numbers).

- [ ] **Step 5: Commit**

```bash
git add scripts/gen-catalog-spec.py src/catalog-spec.js test/catalog.mjs
git commit -m "catalog: transcribe the 109-row asset spec from base-assets.md

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GjhA7Eswq3G5DUd7Ymvu88"
```

---

### Task 3: Vendor the base kit and merge it into the catalog

**Files:**
- Create: `assets/base-kit/manifest.json` plus seven `.glb`, `src/catalog.js`, `ATTRIBUTIONS.md`
- Modify: `test/catalog.mjs`

**Interfaces:**
- Consumes: `CATALOG_SPEC`, `specById`.
- Produces: `buildCatalog(spec, manifest) -> Map<id, Entry>` where `Entry = { id, name, section, plot, ports, placeholder: boolean, states: { [n]: { file, sockets, colliders, animations, clearance } } }`; `splitId('wall_standard_d2') -> { base: 'wall_standard', state: 2 }`; `BASE_KIT_URL = 'assets/base-kit/'`; `PLACEHOLDER_HEIGHT_M` by section.

- [ ] **Step 1: Download the kit**

```bash
mkdir -p assets/base-kit && cd assets/base-kit
BASE=https://jelaludo.github.io/SentryTowers_A6/assets/base-kit
curl -sSL -o manifest.json "$BASE/manifest.json"
for f in wall_standard_d0 wall_standard_d1 wall_standard_d2 wall_standard_d3 wall_corner_d0 gate_vehicle_d0 foundation_flat_d0; do
  curl -sSL -o "$f.glb" "$BASE/$f.glb"
done
ls -la && python3 -c "import json; m=json.load(open('manifest.json')); print(len(m['assets']), 'assets')"
cd ../..
```
Expected: seven GLBs with sizes 149 KB to 1.06 MB and `7 assets`.

- [ ] **Step 2: Write `ATTRIBUTIONS.md`**

```markdown
# Third-party assets

## A6 Fortification Lab — WALL KIT 01

- **Files:** `assets/base-kit/*.glb`, `assets/base-kit/manifest.json`
- **Source:** <https://jelaludo.github.io/SentryTowers_A6/base-kit/>
- **Author:** Jelaludo (the operator's own workshop). Vendored with permission
  as part of the same body of work.

## Sentry Workshop turrets

- **Files:** `assets/models/sentries/*.glb`
- **Source:** <https://jelaludo.github.io/SentryTowers_A6/>
- **Author:** Jelaludo. Same terms.

## meshoptimizer — GLB decoder

- **File:** `vendor/meshopt_decoder.module.js`, MIT, by Arseny Kapoulkine.
```

- [ ] **Step 3: Extend the failing test**

Append to `test/catalog.mjs` before `done();`:
```js
import { readFileSync } from 'node:fs';
import { buildCatalog, splitId, PLACEHOLDER_HEIGHT_M } from '../src/catalog.js';

const manifest = JSON.parse(readFileSync(new URL('../assets/base-kit/manifest.json', import.meta.url), 'utf8'));
const cat = buildCatalog(CATALOG_SPEC, manifest);

check('catalog has every spec row', cat.size === 109);
check('splitId parses a state suffix', splitId('wall_standard_d2').base === 'wall_standard' && splitId('wall_standard_d2').state === 2);
check('splitId without suffix is state 0', splitId('road_t').state === 0 && splitId('road_t').base === 'road_t');
const wall = cat.get('wall_standard');
check('wall is not a placeholder', wall.placeholder === false);
check('wall has four states', [0, 1, 2, 3].every((n) => wall.states[n] && wall.states[n].file === `wall_standard_d${n}.glb`));
check('wall sockets carried over', wall.states[0].sockets.some((s) => s.id === 'WALL_E' && s.kind === 'wall'));
const gate = cat.get('gate_vehicle');
check('gate has the open clip', gate.states[0].animations.includes('Gate_Open'));
check('gate plot matches manifest plot_m / 4', gate.plot[0] === 3 && gate.plot[1] === 2);
check('command_hq is a placeholder', cat.get('command_hq').placeholder === true && Object.keys(cat.get('command_hq').states).length === 0);
check('placeholder heights cover every section', SECTIONS.every((s) => PLACEHOLDER_HEIGHT_M[s] > 0));
// the scale contract: every manifest plot equals its spec plot times 4 m
for (const a of manifest.assets) {
  const { base } = splitId(a.id);
  const row = specById(base);
  check(`manifest ${a.id} matches spec plot`, row && a.plot_m[0] === row.plot[0] * 4 && a.plot_m[1] === row.plot[1] * 4,
    row ? `manifest ${a.plot_m} vs spec ${row.plot}` : 'no spec row');
}
```
Move the two `import` lines to the top of the file with the others.

- [ ] **Step 4: Run to verify it fails**

Run: `node test/catalog.mjs`
Expected: `ERR_MODULE_NOT_FOUND` for `src/catalog.js`.

- [ ] **Step 5: Write `src/catalog.js`**

```js
// catalog.js — ONE list of what can stand on a plate, merged from two
// sources. The spec table (catalog-spec.js, generated from base-assets.md)
// is the master list: every id the generator may place is there, with its
// footprint. The base-kit manifest (assets/base-kit/manifest.json) attaches
// a FILE, sockets, colliders and animations to the rows that have been
// modelled. A row with no manifest entry is a PLACEHOLDER, drawn as a box
// of its footprint until the model lands — and then it stops being one
// without the generator noticing.
//
// Pure: no DOM, no three.js. The browser fetches the manifest and hands it
// here; the test reads it from disk and hands it here.
export const BASE_KIT_URL = 'assets/base-kit/';
export const CELL_M = 4;

// Placeholder box heights by section, metres. Walls match the kit's own
// collider (3.2 m); buildings read as buildings; ground pieces are slabs.
export const PLACEHOLDER_HEIGHT_M = {
  ground: 0.2, road: 0.2, perimeter: 3.2, defense: 3.0, command: 7.0,
  personnel: 5.0, logistics: 6.0, industry: 6.0, utility: 5.0, air: 4.0,
  field: 0.8, prop: 1.5,
};

// Placeholder colours by section — one hue per function so a plate reads
// as zones from the orbit camera before any model exists.
export const SECTION_COLOR = {
  ground: 0x3a3f47, road: 0x2a2e36, perimeter: 0x6b7583, defense: 0xc0392b,
  command: 0x7df9ff, personnel: 0x2ecc71, logistics: 0xf39c12, industry: 0xe67e22,
  utility: 0xf1c40f, air: 0x9b59b6, field: 0xff6b6b, prop: 0x95a5a6,
};

// 'wall_standard_d2' -> { base: 'wall_standard', state: 2 }. An id with no
// suffix is its intact state.
export function splitId(id) {
  const m = /^(.*)_d([0-3])$/.exec(id);
  return m ? { base: m[1], state: Number(m[2]) } : { base: id, state: 0 };
}

export function buildCatalog(spec, manifest) {
  const cat = new Map();
  for (const row of spec) {
    cat.set(row.id, { ...row, placeholder: true, states: {} });
  }
  const assets = (manifest && manifest.assets) || [];
  for (const a of assets) {
    const { base, state } = splitId(a.id);
    const entry = cat.get(base);
    if (!entry) continue; // a modelled asset the spec does not know: ignored, never placed
    entry.states[state] = {
      file: a.file,
      sockets: a.sockets || [],
      colliders: a.colliders || [],
      animations: a.animations || [],
      clearance: a.clearance || [],
    };
    entry.placeholder = false;
  }
  return cat;
}

// The file for an entry at a damage state, falling back down the ladder so
// a wall that only has D0 modelled still renders when asked for D3. Returns
// null for a placeholder.
export function fileFor(entry, state = 0) {
  for (let s = state; s >= 0; s--) {
    if (entry.states[s]) return BASE_KIT_URL + entry.states[s].file;
  }
  return null;
}
```

- [ ] **Step 6: Run the test**

Run: `node test/catalog.mjs`
Expected: every line `ok`, including seven `manifest ... matches spec plot` lines, then `all ok`.

- [ ] **Step 7: Commit**

```bash
git add assets/base-kit ATTRIBUTIONS.md src/catalog.js test/catalog.mjs
git commit -m "catalog: vendor WALL KIT 01 and merge its manifest onto the spec rows

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GjhA7Eswq3G5DUd7Ymvu88"
```

---

### Task 4: Generator step 1 — knobs, ring, gates, ASCII

**Files:**
- Create: `src/plate.js`, `test/plate.mjs`

**Interfaces:**
- Consumes: `mulberry32`, `makeParams`/`clampParams`/`formatKnobs`/`knobProblems`, `specById`.
- Produces (used by every later task): `PLATE_TUNE`, `PLATE_KNOBS`, `makePlateParams`, `clampPlateParams`, `plateKnobProblems`, `KIND`, `ASCII_OF_KIND`, `DIRS`, `SIDES`, `rotSide(side, rot)`, `yawOfSide`, `dirOfYaw(deg)`, `generatePlate(params) -> Plate`, and the internal state shape `{ w, h, seed, params, cells: Uint8Array, owner: Int16Array, pieces, roads, gates, sentries, blocks, warnings, ascii() }`. Piece shape: `{ id, x, z, pw, ph, rot, state, kind, zone, offset: [ox, oz] }`. Gate shape: `{ side, at, x, z, rot, pieceIndex, port: { bx, bz } }`.

- [ ] **Step 1: Write the failing test**

`test/plate.mjs`:
```js
import { generatePlate, makePlateParams, plateKnobProblems, KIND, rotSide, dirOfYaw, PLATE_TUNE } from '../src/plate.js';
import { check, near, done } from './check.mjs';

check('knob table is sound', plateKnobProblems().length === 0, plateKnobProblems().join('; '));
check('rotSide: N rotated once is E', rotSide('N', 1) === 'E');
check('rotSide: W rotated once wraps to N', rotSide('W', 1) === 'N');
check('dirOfYaw(0) is +z', near(dirOfYaw(0)[0], 0) && near(dirOfYaw(0)[1], 1));
check('dirOfYaw(90) is +x', near(dirOfYaw(90)[0], 1) && near(dirOfYaw(90)[1], 0));

const SEEDS = Array.from({ length: 50 }, (_, i) => i + 1);
const SIZES = [[12, 12], [40, 12], [12, 40], [40, 40]];

const ringCells = (p) => {
  const out = [];
  for (let x = 0; x < p.w; x++) out.push([x, 0], [x, p.h - 1]);
  for (let z = 1; z < p.h - 1; z++) out.push([0, z], [p.w - 1, z]);
  return out;
};
const cellAt = (p, x, z) => p.cells[z * p.w + x];

function checkRing(p, label) {
  check(`${label}: sealed ring`, ringCells(p).every(([x, z]) => cellAt(p, x, z) === KIND.WALL || cellAt(p, x, z) === KIND.GATE));
  check(`${label}: gate count`, p.gates.length === p.params.gates, `got ${p.gates.length}`);
  check(`${label}: gates on distinct sides`, new Set(p.gates.map((g) => g.side)).size === p.gates.length);
  check(`${label}: no gate within two cells of a corner`, p.gates.every((g) => g.at >= 3 && g.at <= ((g.side === 'N' || g.side === 'S') ? p.w : p.h) - 4));
  check(`${label}: four corners are wall pieces`, [[0, 0], [p.w - 1, 0], [0, p.h - 1], [p.w - 1, p.h - 1]]
    .every(([x, z]) => p.pieces[p.owner[z * p.w + x]].id === 'wall_corner'));
  const a = p.ascii().split('\n');
  check(`${label}: ascii is h rows of w chars`, a.length === p.h && a.every((r) => r.length === p.w));
  check(`${label}: ascii top row is the N side`, a[0].includes('#'));
}

for (const seed of SEEDS) {
  const p = generatePlate(makePlateParams({ ...PLATE_TUNE, seed }));
  const q = generatePlate(makePlateParams({ ...PLATE_TUNE, seed }));
  check(`seed ${seed}: deterministic`, p.ascii() === q.ascii());
  checkRing(p, `seed ${seed}`);
}
for (const [w, h] of SIZES) {
  for (const gates of [1, 3]) {
    const p = generatePlate(makePlateParams({ ...PLATE_TUNE, seed: 3, w, h, gates }));
    checkRing(p, `${w}x${h} g${gates}`);
  }
}
done();
```

- [ ] **Step 2: Run to verify it fails**

Run: `node test/plate.mjs`
Expected: `ERR_MODULE_NOT_FOUND` for `src/plate.js`.

- [ ] **Step 3: Write `src/plate.js` with ring, gates and ascii**

```js
// plate.js — THE PLATE GENERATOR. Seed and knobs in, a base out: a sealed
// wall ring with gates, a road spine, functional blocks packed with
// buildings, sentry sockets with limited arcs. Pure: no DOM, no three.js,
// Node-tested in test/plate.mjs. plate-tab.js draws what this returns and
// never decides where anything goes.
//
// CONVENTIONS, ONCE, HERE. One cell is 4 m. N is +z and E is +x, because
// that is what the base kit's own sockets say (WALL_N sits at +Z). `rot` is
// quarter turns CLOCKWISE seen from above, N -> E -> S -> W, which in
// three.js is `rotation.y = rot * PI/2`. Yaw is compass degrees, 0 = N.
// Plate width and depth are EVEN, because roads are 2 x 2 pieces laid on
// even coordinates and a gate's road port has to land on one.
import { mulberry32 } from './rng.js?v=00000000';
import { makeParams, clampParams, formatKnobs, knobProblems } from './knobs.js?v=00000000';
import { specById } from './catalog-spec.js?v=00000000';

export const CELL_M = 4;

export const KIND = { FOUNDATION: 0, WALL: 1, GATE: 2, ROAD: 3, BUILDING: 4, PROP: 5, SENTRY: 6 };
export const ASCII_OF_KIND = ['.', '#', 'G', '=', 'B', 'o', 'S'];

export const PLATE_TUNE = {
  seed: 1,
  w: 20,          // cells, including the ring; even
  h: 16,          // cells, including the ring; even
  gates: 2,
  arc: 110,       // sentry traverse, degrees
  density: 0.7,   // fraction of a block the packer tries to fill
  tier: 1,        // sentry tier
};

export const PLATE_KNOBS = [
  { key: 'seed', label: 'seed', group: 'plate', min: 0, max: 999999, step: 1 },
  { key: 'w', label: 'width (cells)', group: 'plate', min: 12, max: 40, step: 2 },
  { key: 'h', label: 'depth (cells)', group: 'plate', min: 12, max: 40, step: 2 },
  { key: 'gates', label: 'gates', group: 'plate', min: 1, max: 3, step: 1 },
  { key: 'density', label: 'build density', group: 'packing', min: 0.3, max: 1.0, step: 0.05 },
  { key: 'arc', label: 'sentry arc (deg)', group: 'sentries', min: 60, max: 180, step: 5 },
  { key: 'tier', label: 'sentry tier', group: 'sentries', min: 1, max: 3, step: 1 },
];
export const makePlateParams = (src = PLATE_TUNE) => makeParams(PLATE_KNOBS, src);
export const clampPlateParams = (p, src) => clampParams(PLATE_KNOBS, p, src);
export const formatPlateTune = (p) => formatKnobs('PLATE_TUNE', PLATE_KNOBS, p);
export const plateKnobProblems = () => knobProblems(PLATE_KNOBS, PLATE_TUNE);

// --- directions ------------------------------------------------------------
export const SIDES = ['N', 'E', 'S', 'W'];
export const DIRS = { N: [0, 1], E: [1, 0], S: [0, -1], W: [-1, 0] };
export const rotSide = (side, rot) => SIDES[(SIDES.indexOf(side) + rot) & 3];
export const yawOfSide = { N: 0, E: 90, S: 180, W: 270 };
export const dirOfYaw = (deg) => [Math.sin(deg * Math.PI / 180), Math.cos(deg * Math.PI / 180)];
export const wrapDeg = (a) => ((a + 180) % 360 + 360) % 360 - 180;

// --- state -----------------------------------------------------------------
const idx = (s, x, z) => z * s.w + x;
const inside = (s, x, z) => x >= 0 && z >= 0 && x < s.w && z < s.h;

function makeState(p) {
  // even, always: the knob table's step is 2, but a URL can hand us 13
  const w = p.w & ~1, h = p.h & ~1;
  return {
    w, h, seed: p.seed, params: { ...p, w, h },
    cells: new Uint8Array(w * h),
    owner: new Int16Array(w * h).fill(-1),
    pieces: [], roads: { nodes: [], edges: [] }, gates: [], sentries: [], blocks: [],
    warnings: [],
    ascii() { return asciiOf(this); },
  };
}

// Claim a rectangle for a piece. No fit check here — callers decide what
// may be overwritten (the ring is laid around gates, roads are laid on
// foundation, buildings only on free cells via `free`).
function place(s, id, x, z, pw, ph, rot, kind, extra = {}) {
  const pi = s.pieces.length;
  s.pieces.push({ id, x, z, pw, ph, rot, state: 0, kind, zone: null, offset: [0, 0], ...extra });
  for (let dz = 0; dz < ph; dz++) {
    for (let dx = 0; dx < pw; dx++) {
      const i = idx(s, x + dx, z + dz);
      s.cells[i] = kind;
      s.owner[i] = pi;
    }
  }
  return pi;
}

function asciiOf(s) {
  const rows = [];
  for (let z = s.h - 1; z >= 0; z--) {
    let r = '';
    for (let x = 0; x < s.w; x++) r += ASCII_OF_KIND[s.cells[idx(s, x, z)]];
    rows.push(r);
  }
  return rows.join('\n');
}

// --- step 1: ring and gates -------------------------------------------------
// A gate is 3 cells along its side and 2 deep: the ring row and the row
// inside it. The kit's gate model puts its WALL line through its own
// centre, so the model is drawn half a cell OUTWARD of those two rows —
// that is `offset`, and the viewer applies it. Gate centres stay at least
// five cells from a corner so the flank sentry sockets (Task 7) clear the
// corner sockets.
function chooseGates(s, rng) {
  const sides = [...SIDES];
  for (let i = sides.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [sides[i], sides[j]] = [sides[j], sides[i]];
  }
  const out = [];
  for (const side of sides.slice(0, s.params.gates)) {
    const len = (side === 'N' || side === 'S') ? s.w : s.h;
    const lo = 5, hi = len - 6;
    if (hi < lo) { s.warnings.push(`gate on ${side}: side too short`); continue; }
    const at = lo + Math.floor(rng() * (hi - lo + 1));
    out.push({ side, at });
  }
  return out;
}

function gateRect(s, g) {
  // origin, dims, rot, outward offset in cells
  switch (g.side) {
    case 'N': return { x: g.at - 1, z: s.h - 2, pw: 3, ph: 2, rot: 0, offset: [0, 0.5] };
    case 'S': return { x: g.at - 1, z: 0, pw: 3, ph: 2, rot: 2, offset: [0, -0.5] };
    case 'E': return { x: s.w - 2, z: g.at - 1, pw: 2, ph: 3, rot: 1, offset: [0.5, 0] };
    default: return { x: 0, z: g.at - 1, pw: 2, ph: 3, rot: 3, offset: [-0.5, 0] };
  }
}

function stepRing(s, rng) {
  const { w, h } = s;
  const gates = chooseGates(s, rng);
  const gateCells = new Set();
  for (const g of gates) {
    const r = gateRect(s, g);
    for (let dz = 0; dz < r.ph; dz++) for (let dx = 0; dx < r.pw; dx++) gateCells.add(idx(s, r.x + dx, r.z + dz));
  }
  // corners: SW is the kit's authored pose (ports E and N); clockwise from there
  place(s, 'wall_corner', 0, 0, 1, 1, 0, KIND.WALL);
  place(s, 'wall_corner', 0, h - 1, 1, 1, 1, KIND.WALL);
  place(s, 'wall_corner', w - 1, h - 1, 1, 1, 2, KIND.WALL);
  place(s, 'wall_corner', w - 1, 0, 1, 1, 3, KIND.WALL);
  for (let x = 1; x < w - 1; x++) {
    if (!gateCells.has(idx(s, x, 0))) place(s, 'wall_standard', x, 0, 1, 1, 0, KIND.WALL);
    if (!gateCells.has(idx(s, x, h - 1))) place(s, 'wall_standard', x, h - 1, 1, 1, 0, KIND.WALL);
  }
  for (let z = 1; z < h - 1; z++) {
    if (!gateCells.has(idx(s, 0, z))) place(s, 'wall_standard', 0, z, 1, 1, 1, KIND.WALL);
    if (!gateCells.has(idx(s, w - 1, z))) place(s, 'wall_standard', w - 1, z, 1, 1, 1, KIND.WALL);
  }
  for (const g of gates) {
    const r = gateRect(s, g);
    const pieceIndex = place(s, 'gate_vehicle', r.x, r.z, r.pw, r.ph, r.rot, KIND.GATE, { offset: r.offset });
    // the road port: the 2 x 2 road block just inside the gate, on even coordinates
    const even = g.at & ~1;
    const port = (g.side === 'N') ? { bx: even / 2, bz: (h - 4) / 2 }
      : (g.side === 'S') ? { bx: even / 2, bz: 1 }
      : (g.side === 'E') ? { bx: (w - 4) / 2, bz: even / 2 }
      : { bx: 1, bz: even / 2 };
    s.gates.push({ side: g.side, at: g.at, x: r.x, z: r.z, rot: r.rot, pieceIndex, port });
  }
}

// --- entry -----------------------------------------------------------------
export function generatePlate(params) {
  const p = clampPlateParams(makePlateParams(), params);
  const s = makeState(p);
  const rng = mulberry32(p.seed);
  stepRing(s, rng);
  return s;
}
```

- [ ] **Step 4: Run the test**

Run: `node test/plate.mjs`
Expected: all `ok`, then `all ok`. The `ascii top row is the N side` check passes because row 0 of the output is z = h-1.

- [ ] **Step 5: Bust, check, commit**

```bash
./scripts/bust.sh --quiet && ./scripts/check-tokens.sh && npm test
git add -A
git commit -m "plate: knobs, sealed ring, gates on distinct sides, ascii map

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GjhA7Eswq3G5DUd7Ymvu88"
```

---

### Task 5: Generator step 2 — roads

**Files:**
- Modify: `src/plate.js`, `test/plate.mjs`

**Interfaces:**
- Produces: `s.roads = { nodes: [blockKey], edges: [[a, b]], blocks: Map<blockKey, { bx, bz, pieceIndex }> }` with `blockKey = bz * 1000 + bx`; `roadBlockKey(bx, bz)`; `roadsConnected(plate) -> boolean`; every road block is a placed piece among `road_end`, `road_straight`, `road_corner`, `road_t`, `road_cross`.

- [ ] **Step 1: Write the failing test**

Append to `test/plate.mjs` before `done();`, and add `roadsConnected, roadBlockKey` to the import:
```js
function checkRoads(p, label) {
  check(`${label}: road graph connected`, roadsConnected(p));
  check(`${label}: every gate port is a road block`, p.gates.every((g) => p.roads.blocks.has(roadBlockKey(g.port.bx, g.port.bz))));
  check(`${label}: road cells are all owned by road pieces`, (() => {
    for (let i = 0; i < p.cells.length; i++) {
      if (p.cells[i] !== KIND.ROAD) continue;
      const pc = p.pieces[p.owner[i]];
      if (!pc || !pc.id.startsWith('road_')) return false;
    }
    return true;
  })());
  check(`${label}: road pieces are 2x2 on even cells`, p.pieces.filter((pc) => pc.kind === KIND.ROAD)
    .every((pc) => pc.pw === 2 && pc.ph === 2 && pc.x % 2 === 0 && pc.z % 2 === 0));
  check(`${label}: has a crossroads`, p.pieces.some((pc) => pc.id === 'road_cross'));
}
for (const seed of SEEDS) checkRoads(generatePlate(makePlateParams({ ...PLATE_TUNE, seed })), `seed ${seed}`);
for (const [w, h] of SIZES) checkRoads(generatePlate(makePlateParams({ ...PLATE_TUNE, seed: 3, w, h, gates: 3 })), `${w}x${h}`);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node test/plate.mjs`
Expected: `SyntaxError: The requested module '../src/plate.js' does not provide an export named 'roadsConnected'`.

- [ ] **Step 3: Add the road step to `src/plate.js`**

Insert after `stepRing` and before the `--- entry ---` section:
```js
// --- step 2: roads -----------------------------------------------------------
// Roads are 2 x 2 pieces on even coordinates: block (bx, bz) covers cells
// 2bx..2bx+1, 2bz..2bz+1. A SPINE crosses the plate centre, then each gate's
// corridor runs straight from its port to the spine. Laying stops at the
// first block that is not free — a sentry socket, a gate — and that is what
// road_end is for. We do not draw roads; we lay blocks and then READ the
// piece off each block's neighbour mask.
export const roadBlockKey = (bx, bz) => bz * 1000 + bx;

const ROAD_PORTS = {
  road_end: ['N'],
  road_straight: ['N', 'S'],
  road_corner: ['N', 'E'],
  road_t: ['N', 'E', 'S'],
  road_cross: ['N', 'E', 'S', 'W'],
};

// The rotation that turns a piece's authored ports into the wanted set.
function fitPorts(canon, want) {
  for (let rot = 0; rot < 4; rot++) {
    const got = canon.map((sd) => rotSide(sd, rot));
    if (got.length === want.size && got.every((sd) => want.has(sd))) return rot;
  }
  return -1;
}

function blockFree(s, bx, bz) {
  const x = 2 * bx, z = 2 * bz;
  if (!inside(s, x, z) || !inside(s, x + 1, z + 1)) return false;
  if (x < 1 || z < 1 || x + 1 > s.w - 2 || z + 1 > s.h - 2) return false; // never on the ring
  for (let dz = 0; dz < 2; dz++) {
    for (let dx = 0; dx < 2; dx++) {
      const i = idx(s, x + dx, z + dz);
      if (s.cells[i] !== KIND.FOUNDATION && s.cells[i] !== KIND.ROAD) return false;
      if (s.owner[i] !== -1) return false;
    }
  }
  return true;
}

function layBlock(s, laid, bx, bz) {
  if (!blockFree(s, bx, bz)) return false;
  for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) s.cells[idx(s, 2 * bx + dx, 2 * bz + dz)] = KIND.ROAD;
  laid.set(roadBlockKey(bx, bz), { bx, bz, pieceIndex: -1 });
  return true;
}

function layRun(s, laid, bx, bz, dx, dz, stopAt) {
  // lay from (bx,bz) stepping (dx,dz) until the stop predicate holds or a block is not free
  let x = bx, z = bz;
  for (;;) {
    if (!layBlock(s, laid, x, z)) return false;
    if (stopAt(x, z)) return true;
    x += dx; z += dz;
  }
}

function stepRoads(s) {
  const { w, h } = s;
  const bxMax = (w - 4) / 2, bzMax = (h - 4) / 2;
  const bxS = Math.min(bxMax, Math.max(1, Math.round((w - 2) / 4)));
  const bzS = Math.min(bzMax, Math.max(1, Math.round((h - 2) / 4)));
  const laid = new Map();
  // spine: from the centre outward in all four directions
  layBlock(s, laid, bxS, bzS);
  layRun(s, laid, bxS, bzS + 1, 0, 1, (x, z) => z === bzMax);
  layRun(s, laid, bxS, bzS - 1, 0, -1, (x, z) => z === 1);
  layRun(s, laid, bxS + 1, bzS, 1, 0, (x, z) => x === bxMax);
  layRun(s, laid, bxS - 1, bzS, -1, 0, (x, z) => x === 1);
  // gate corridors: from the port straight to the spine line
  for (const g of s.gates) {
    const { bx, bz } = g.port;
    let ok;
    if (g.side === 'N') ok = layRun(s, laid, bx, bz, 0, -1, (x, z) => z === bzS);
    else if (g.side === 'S') ok = layRun(s, laid, bx, bz, 0, 1, (x, z) => z === bzS);
    else if (g.side === 'E') ok = layRun(s, laid, bx, bz, -1, 0, (x, z) => x === bxS);
    else ok = layRun(s, laid, bx, bz, 1, 0, (x, z) => x === bxS);
    if (!ok) s.warnings.push(`gate ${g.side}@${g.at}: corridor blocked before the spine`);
  }
  // read the pieces off the neighbour masks
  const edges = [];
  for (const b of laid.values()) {
    const want = new Set();
    for (const side of SIDES) {
      const [dx, dz] = DIRS[side];
      const nk = roadBlockKey(b.bx + dx, b.bz + dz);
      if (laid.has(nk)) {
        want.add(side);
        if (nk > roadBlockKey(b.bx, b.bz)) edges.push([roadBlockKey(b.bx, b.bz), nk]);
      }
    }
    let id;
    if (want.size === 0) { id = 'road_end'; want.add('N'); s.warnings.push(`isolated road block at ${b.bx},${b.bz}`); }
    else if (want.size === 1) id = 'road_end';
    else if (want.size === 2) id = (want.has('N') && want.has('S')) || (want.has('E') && want.has('W')) ? 'road_straight' : 'road_corner';
    else if (want.size === 3) id = 'road_t';
    else id = 'road_cross';
    const rot = fitPorts(ROAD_PORTS[id], want);
    b.pieceIndex = place(s, id, 2 * b.bx, 2 * b.bz, 2, 2, rot < 0 ? 0 : rot, KIND.ROAD);
  }
  s.roads = { nodes: [...laid.keys()], edges, blocks: laid };
}

export function roadsConnected(s) {
  const { nodes, edges } = s.roads;
  if (nodes.length === 0) return false;
  const adj = new Map(nodes.map((n) => [n, []]));
  for (const [a, b] of edges) { adj.get(a).push(b); adj.get(b).push(a); }
  const seen = new Set([nodes[0]]);
  const stack = [nodes[0]];
  while (stack.length) {
    const n = stack.pop();
    for (const m of adj.get(n)) if (!seen.has(m)) { seen.add(m); stack.push(m); }
  }
  return seen.size === nodes.length;
}
```
And in `generatePlate`, after `stepRing(s, rng);` add `stepRoads(s);`.

- [ ] **Step 4: Run the test**

Run: `node test/plate.mjs`
Expected: all `ok`. If `has a crossroads` fails on a size, the spine centre block has fewer than four road neighbours; check `bxS`/`bzS` are strictly inside `[2, max-1]` for that size and adjust the clamp to `Math.max(2, ...)` and `Math.min(max - 1, ...)`.

- [ ] **Step 5: Look at one plate**

```bash
node -e "import('./src/plate.js').then(m => console.log(m.generatePlate(m.makePlateParams({...m.PLATE_TUNE, seed: 7})).ascii()))"
```
Expected: a `#` ring with `G` gaps, a `=` cross through the middle, corridors from each gate to the cross.

- [ ] **Step 6: Bust, commit**

```bash
./scripts/bust.sh --quiet && npm test && git add -A
git commit -m "plate: road spine and gate corridors, pieces read off neighbour masks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GjhA7Eswq3G5DUd7Ymvu88"
```

---

### Task 6: Generator steps 3 and 4 — blocks, zones, packing

**Files:**
- Modify: `src/plate.js`, `test/plate.mjs`

**Interfaces:**
- Produces: `ZONES` table; `s.blocks = [{ x0, z0, x1, z1, cellSet: Set<index>, cells: [[x,z]], zone, touchesRing, gateSides: Set }]`; `sentrySockets(s) -> [{ x, z, yawDeg, where }]` (used by Task 7); buildings placed with `kind: KIND.BUILDING, zone`; props with `kind: KIND.PROP`.

- [ ] **Step 1: Write the failing test**

Append before `done();` and add `ZONES, sentrySockets` to the import:
```js
const ROAD_TOUCH = (p, pc) => {
  for (let dz = -1; dz <= pc.ph; dz++) {
    for (let dx = -1; dx <= pc.pw; dx++) {
      const x = pc.x + dx, z = pc.z + dz;
      const edge = dz === -1 || dz === pc.ph || dx === -1 || dx === pc.pw;
      if (!edge) continue;
      if (x < 0 || z < 0 || x >= p.w || z >= p.h) continue;
      if (p.cells[z * p.w + x] === KIND.ROAD) return true;
    }
  }
  return false;
};
function checkPacking(p, label) {
  const buildings = p.pieces.filter((pc) => pc.kind === KIND.BUILDING);
  check(`${label}: has buildings`, buildings.length >= 3, `got ${buildings.length}`);
  check(`${label}: every building touches a road`, buildings.every((pc) => ROAD_TOUCH(p, pc)));
  check(`${label}: every piece is inside the plate`, p.pieces.every((pc) => pc.x >= 0 && pc.z >= 0 && pc.x + pc.pw <= p.w && pc.z + pc.ph <= p.h));
  // no overlaps: count claimed cells per piece against owner
  const claimed = new Map();
  for (let i = 0; i < p.cells.length; i++) if (p.owner[i] >= 0) claimed.set(p.owner[i], (claimed.get(p.owner[i]) || 0) + 1);
  check(`${label}: no overlaps`, p.pieces.every((pc, i) => claimed.get(i) === pc.pw * pc.ph), 'a piece owns fewer cells than its plot');
  check(`${label}: a command zone exists`, p.blocks.some((b) => b.zone === 'command'));
  check(`${label}: every zone is known`, p.blocks.every((b) => ZONES[b.zone]));
  check(`${label}: building plots match the spec`, buildings.every((pc) => {
    const sp = specById(pc.id).plot;
    return (pc.rot % 2 === 0) ? (pc.pw === sp[0] && pc.ph === sp[1]) : (pc.pw === sp[1] && pc.ph === sp[0]);
  }));
  check(`${label}: sentry cells reserved`, sentrySockets(p).every((sk) => [0, 1].every((dz) => [0, 1].every((dx) =>
    p.cells[(sk.z + dz) * p.w + sk.x + dx] === KIND.SENTRY))));
}
for (const seed of SEEDS) checkPacking(generatePlate(makePlateParams({ ...PLATE_TUNE, seed })), `seed ${seed}`);
for (const [w, h] of SIZES) checkPacking(generatePlate(makePlateParams({ ...PLATE_TUNE, seed: 3, w, h, gates: 3 })), `${w}x${h}`);
```
Add `import { specById } from '../src/catalog-spec.js';` at the top.

- [ ] **Step 2: Run to verify it fails**

Run: `node test/plate.mjs`
Expected: `does not provide an export named 'ZONES'`.

- [ ] **Step 3: Add blocks, zones and packing to `src/plate.js`**

Insert after `roadsConnected` and before the `--- entry ---` section:
```js
// --- step 3: blocks and zones ----------------------------------------------
// Sentry sockets are decided by the ring alone, so they are RESERVED here,
// before anything else can claim their cells, and only cast as pieces in
// step 5. Then every free cell floods into a region; the region's bounding
// box is the block, and the packer stays inside the region's own cell set
// so an L-shaped region cannot leak into a neighbour's box.
export function sentrySockets(s) {
  const { w, h } = s;
  const out = [
    { x: 1, z: 1, yawDeg: 225, where: 'corner' },
    { x: 1, z: h - 3, yawDeg: 315, where: 'corner' },
    { x: w - 3, z: h - 3, yawDeg: 45, where: 'corner' },
    { x: w - 3, z: 1, yawDeg: 135, where: 'corner' },
  ];
  for (const g of s.gates) {
    if (g.side === 'N') out.push({ x: g.at - 3, z: h - 3, yawDeg: 0, where: 'flank' }, { x: g.at + 2, z: h - 3, yawDeg: 0, where: 'flank' });
    else if (g.side === 'S') out.push({ x: g.at - 3, z: 1, yawDeg: 180, where: 'flank' }, { x: g.at + 2, z: 1, yawDeg: 180, where: 'flank' });
    else if (g.side === 'E') out.push({ x: w - 3, z: g.at - 3, yawDeg: 90, where: 'flank' }, { x: w - 3, z: g.at + 2, yawDeg: 90, where: 'flank' });
    else out.push({ x: 1, z: g.at - 3, yawDeg: 270, where: 'flank' }, { x: 1, z: g.at + 2, yawDeg: 270, where: 'flank' });
  }
  return out;
}

function reserveSentries(s) {
  for (const sk of sentrySockets(s)) {
    for (let dz = 0; dz < 2; dz++) {
      for (let dx = 0; dx < 2; dx++) {
        const i = idx(s, sk.x + dx, sk.z + dz);
        if (s.cells[i] === KIND.FOUNDATION && s.owner[i] === -1) s.cells[i] = KIND.SENTRY;
        else s.warnings.push(`sentry socket at ${sk.x},${sk.z} collides with ${ASCII_OF_KIND[s.cells[i]]}`);
      }
    }
  }
}

export const ZONES = {
  command:   { buildings: ['command_hq', 'command_operations', 'command_uplink', 'command_server', 'command_comms'],
               props: ['command_beacon', 'prop_terminal', 'prop_lamp'] },
  logistics: { buildings: ['logistics_warehouse', 'logistics_loading_dock', 'logistics_crane', 'ground_hardstand', 'logistics_container'],
               props: ['crate_general', 'crate_parts', 'logistics_pallet', 'crate_secure'] },
  defense:   { buildings: ['defense_bunker', 'defense_watchtower', 'defense_radar', 'defense_interceptor'],
               props: ['defense_searchlight', 'field_barrier', 'field_sensor'] },
  utility:   { buildings: ['utility_reactor', 'utility_solar', 'utility_water', 'utility_battery', 'utility_waste', 'utility_substation', 'utility_tank', 'utility_cooling'],
               props: ['utility_junction', 'utility_conduit', 'crate_energy'] },
  air:       { buildings: ['air_launchpad', 'air_hangar', 'air_control', 'air_fuel_service', 'air_drone_pad'],
               props: ['field_signal', 'prop_lamp', 'prop_sign'] },
  personnel: { buildings: ['personnel_mess', 'personnel_barracks', 'personnel_infirmary', 'personnel_recreation', 'personnel_shelter', 'personnel_hygiene', 'personnel_triage'],
               props: ['prop_seating', 'prop_planter', 'prop_lamp'] },
  industry:  { buildings: ['industry_garage', 'industry_fabricator', 'industry_workshop', 'industry_recycler', 'industry_test_cell', 'industry_drone_bench', 'industry_service_lift'],
               props: ['industry_tool_rack', 'crate_parts', 'logistics_pallet'] },
};
// Buildings a block may hold more than once. Everything else is one per block.
const REPEATABLE = new Set(['personnel_barracks', 'logistics_container', 'logistics_warehouse', 'ground_hardstand',
  'defense_bunker', 'utility_battery', 'industry_workshop', 'utility_solar']);
const PROP_RATE = 0.12;

function floodBlocks(s) {
  const seen = new Uint8Array(s.w * s.h);
  const blocks = [];
  for (let z0 = 1; z0 < s.h - 1; z0++) {
    for (let x0 = 1; x0 < s.w - 1; x0++) {
      const i0 = idx(s, x0, z0);
      if (seen[i0] || s.cells[i0] !== KIND.FOUNDATION || s.owner[i0] !== -1) continue;
      const cells = [], stack = [[x0, z0]];
      seen[i0] = 1;
      let x1 = x0, z1 = z0, xa = x0, za = z0;
      while (stack.length) {
        const [x, z] = stack.pop();
        cells.push([x, z]);
        xa = Math.min(xa, x); za = Math.min(za, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z);
        for (const side of SIDES) {
          const nx = x + DIRS[side][0], nz = z + DIRS[side][1];
          const ni = idx(s, nx, nz);
          if (!inside(s, nx, nz) || seen[ni]) continue;
          if (s.cells[ni] !== KIND.FOUNDATION || s.owner[ni] !== -1) continue;
          seen[ni] = 1; stack.push([nx, nz]);
        }
      }
      blocks.push({ x0: xa, z0: za, x1, z1, cells, cellSet: new Set(cells.map(([x, z]) => idx(s, x, z))), zone: null,
        touchesRing: xa === 1 || za === 1 || x1 === s.w - 2 || z1 === s.h - 2, gateSides: new Set() });
    }
  }
  return blocks;
}

function markGateAdjacency(s, blocks) {
  // a block touches a gate corridor if any of its cells neighbours a road cell of that corridor
  for (const g of s.gates) {
    const corridor = new Set();
    const { bx, bz } = g.port;
    const [dx, dz] = g.side === 'N' ? [0, -1] : g.side === 'S' ? [0, 1] : g.side === 'E' ? [-1, 0] : [1, 0];
    for (let x = bx, z = bz; s.roads.blocks.has(roadBlockKey(x, z)); x += dx, z += dz) {
      for (let cz = 0; cz < 2; cz++) for (let cx = 0; cx < 2; cx++) corridor.add(idx(s, 2 * x + cx, 2 * z + cz));
      const b = s.roads.blocks.get(roadBlockKey(x, z));
      if (s.pieces[b.pieceIndex].id === 'road_cross' || s.pieces[b.pieceIndex].id === 'road_t') break;
    }
    for (const b of blocks) {
      if (b.cells.some(([x, z]) => SIDES.some((sd) => corridor.has(idx(s, x + DIRS[sd][0], z + DIRS[sd][1]))))) b.gateSides.add(g.side);
    }
  }
}

function assignZones(s, rng, blocks) {
  const area = (b) => b.cells.length;
  const cx = s.w / 2, cz = s.h / 2;
  const dist = (b) => Math.hypot((b.x0 + b.x1) / 2 + 0.5 - cx, (b.z0 + b.z1) / 2 + 0.5 - cz);
  const left = [...blocks].sort((a, b) => area(b) - area(a));
  const take = (pred) => { const i = left.findIndex(pred); return i < 0 ? null : left.splice(i, 1)[0]; };
  // command: the block nearest the centre
  const cmd = left.length ? left.reduce((best, b) => (dist(b) < dist(best) ? b : best), left[0]) : null;
  if (cmd) { cmd.zone = 'command'; left.splice(left.indexOf(cmd), 1); }
  // logistics: the largest block beside each gate corridor
  for (const g of s.gates) { const b = take((x) => x.gateSides.has(g.side)); if (b) b.zone = 'logistics'; }
  // air: the largest remaining block if a pad fits, else personnel
  const big = take(() => true);
  if (big) big.zone = (big.x1 - big.x0 + 1 >= 8 && big.z1 - big.z0 + 1 >= 8) ? 'air' : 'personnel';
  // ring-touching: defense or utility by seed; the rest: personnel or industry by seed
  for (const b of left) {
    if (b.touchesRing) b.zone = rng() < 0.5 ? 'defense' : 'utility';
    else b.zone = rng() < 0.5 ? 'personnel' : 'industry';
  }
}

function stepBlocks(s, rng) {
  reserveSentries(s);
  const blocks = floodBlocks(s);
  markGateAdjacency(s, blocks);
  assignZones(s, rng, blocks);
  s.blocks = blocks;
}

// --- step 4: packing ----------------------------------------------------------
function rectFree(s, block, x, z, pw, ph) {
  for (let dz = 0; dz < ph; dz++) {
    for (let dx = 0; dx < pw; dx++) {
      const i = idx(s, x + dx, z + dz);
      if (!block.cellSet.has(i)) return false;
      if (s.cells[i] !== KIND.FOUNDATION || s.owner[i] !== -1) return false;
    }
  }
  return true;
}

// Which sides of a rect have a road cell directly beyond them.
function roadSides(s, x, z, pw, ph) {
  const out = new Set();
  for (let dx = 0; dx < pw; dx++) {
    if (inside(s, x + dx, z + ph) && s.cells[idx(s, x + dx, z + ph)] === KIND.ROAD) out.add('N');
    if (inside(s, x + dx, z - 1) && s.cells[idx(s, x + dx, z - 1)] === KIND.ROAD) out.add('S');
  }
  for (let dz = 0; dz < ph; dz++) {
    if (inside(s, x + pw, z + dz) && s.cells[idx(s, x + pw, z + dz)] === KIND.ROAD) out.add('E');
    if (inside(s, x - 1, z + dz) && s.cells[idx(s, x - 1, z + dz)] === KIND.ROAD) out.add('W');
  }
  return out;
}

function shuffled(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// The entrance is the authored S face (rot 0). Unswapped dims allow rot 0
// (entrance S) or 2 (entrance N); swapped dims allow rot 1 (W) or 3 (E).
function findSpot(s, rng, block, def) {
  const [px, pz] = def.plot;
  const orients = shuffled(rng, [[px, pz, [0, 2]], [pz, px, [1, 3]]]);
  const spots = [];
  for (let z = block.z0; z <= block.z1; z++) for (let x = block.x0; x <= block.x1; x++) spots.push([x, z]);
  const order = shuffled(rng, spots);
  for (const [pw, ph, rots] of orients) {
    for (const [x, z] of order) {
      if (x + pw - 1 > block.x1 || z + ph - 1 > block.z1) continue;
      if (!rectFree(s, block, x, z, pw, ph)) continue;
      const sides = roadSides(s, x, z, pw, ph);
      if (sides.size === 0) continue;
      const rot = rots.find((r) => sides.has(rotSide('S', r)));
      return { x, z, pw, ph, rot: rot === undefined ? rots[0] : rot };
    }
  }
  return null;
}

function packBlock(s, rng, block) {
  const zone = ZONES[block.zone];
  const list = zone.buildings.map(specById).sort((a, b) => b.plot[0] * b.plot[1] - a.plot[0] * a.plot[1]);
  const target = s.params.density * block.cells.length;
  const used = new Map();
  let filled = 0, placedAny = true;
  while (filled < target && placedAny) {
    placedAny = false;
    for (const def of list) {
      if (filled >= target) break;
      if (used.get(def.id) && !REPEATABLE.has(def.id)) continue;
      const spot = findSpot(s, rng, block, def);
      if (!spot) continue;
      place(s, def.id, spot.x, spot.z, spot.pw, spot.ph, spot.rot, KIND.BUILDING, { zone: block.zone });
      used.set(def.id, (used.get(def.id) || 0) + 1);
      filled += spot.pw * spot.ph;
      placedAny = true;
    }
  }
  for (const [x, z] of block.cells) {
    const i = idx(s, x, z);
    if (s.cells[i] !== KIND.FOUNDATION || s.owner[i] !== -1) continue;
    if (rng() >= PROP_RATE) continue;
    const id = zone.props[Math.floor(rng() * zone.props.length)];
    place(s, id, x, z, 1, 1, Math.floor(rng() * 4), KIND.PROP, { zone: block.zone });
  }
}

function stepPacking(s, rng) {
  for (const block of s.blocks) packBlock(s, rng, block);
}
```
In `generatePlate`, after `stepRoads(s);` add `stepBlocks(s, rng);` and `stepPacking(s, rng);`.

- [ ] **Step 4: Run the test**

Run: `node test/plate.mjs`
Expected: all `ok`. If `sentry socket ... collides` warnings appear in a later step's no-warnings check, a gate corridor ran through a flank socket; the gate range `[5, len-6]` in `chooseGates` guarantees it cannot, so the fault would be in `sentrySockets` coordinates.

- [ ] **Step 5: Look at a plate**

```bash
node -e "import('./src/plate.js').then(m => { const p = m.generatePlate(m.makePlateParams({...m.PLATE_TUNE, seed: 7})); console.log(p.ascii()); console.log(p.blocks.map(b => b.zone + ' ' + b.cells.length)); console.log(p.warnings); })"
```
Expected: `B` rectangles beside `=` roads, `S` pairs in the corners and beside gates, `o` scattered, zones listed, an empty warnings array.

- [ ] **Step 6: Bust, commit**

```bash
./scripts/bust.sh --quiet && npm test && git add -A
git commit -m "plate: flood blocks, assign zones, pack buildings largest-first facing roads

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GjhA7Eswq3G5DUd7Ymvu88"
```

---

### Task 7: Generator step 5 — sentries, coverage, no-warnings gate

**Files:**
- Modify: `src/plate.js`, `test/plate.mjs`

**Interfaces:**
- Produces: `GUN_FAMILIES`; `s.sentries = [{ x, z, family, tier, yawDeg, arcDeg, pieceIndex, where }]`; `sentryBears(sentry, cx, cz) -> boolean` (cell centre coordinates); `ringCoverage(plate) -> [{ x, z, covered }]`; `blindCells(plate) -> [[x, z]]`.

- [ ] **Step 1: Write the failing test**

Append before `done();` and add `blindCells, sentryBears, GUN_FAMILIES, dirOfYaw` to the import (dirOfYaw is already there):
```js
check('sentryBears: dead ahead is covered', sentryBears({ x: 0, z: 0, yawDeg: 0, arcDeg: 90 }, 1, 6));
check('sentryBears: behind is not', !sentryBears({ x: 0, z: 0, yawDeg: 0, arcDeg: 90 }, 1, -6));
check('sentryBears: wrap across 360', sentryBears({ x: 0, z: 0, yawDeg: 350, arcDeg: 40 }, 1.5, 6));
function checkSentries(p, label) {
  const sockets = sentrySockets(p);
  check(`${label}: one sentry per socket`, p.sentries.length === sockets.length, `${p.sentries.length} vs ${sockets.length}`);
  check(`${label}: sentries are gun families`, p.sentries.every((st) => GUN_FAMILIES.includes(st.family)));
  check(`${label}: sentries carry the knobs`, p.sentries.every((st) => st.arcDeg === p.params.arc && st.tier === p.params.tier));
  check(`${label}: sentry yaw points outward`, p.sentries.every((st) => {
    const [dx, dz] = dirOfYaw(st.yawDeg);
    const ox = (st.x + 1) - p.w / 2, oz = (st.z + 1) - p.h / 2;
    return dx * ox + dz * oz > 0;
  }));
  check(`${label}: every sentry within one cell of the ring`, p.sentries.every((st) => st.x <= 1 || st.z <= 1 || st.x + 2 >= p.w - 1 || st.z + 2 >= p.h - 1));
  check(`${label}: sentry piece owns its cells`, p.sentries.every((st) => p.pieces[st.pieceIndex].id === 'defense_sentry_socket'));
  check(`${label}: no warnings`, p.warnings.length === 0, p.warnings.join('; '));
}
for (const seed of SEEDS) {
  const p = generatePlate(makePlateParams({ ...PLATE_TUNE, seed }));
  checkSentries(p, `seed ${seed}`);
  check(`seed ${seed}: a blind approach exists at the default arc`, blindCells(p).length > 0);
}
for (const [w, h] of SIZES) checkSentries(generatePlate(makePlateParams({ ...PLATE_TUNE, seed: 3, w, h, gates: 3 })), `${w}x${h}`);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node test/plate.mjs`
Expected: `does not provide an export named 'blindCells'`.

- [ ] **Step 3: Add sentries and coverage to `src/plate.js`**

Insert before the `--- entry ---` section:
```js
// --- step 5: sentries ---------------------------------------------------------
// The workshop's gun families; the Relay is a mast and never sits in a
// socket. A sentry is NOT an aimbot: it bears on a cell only inside its
// arc, and the arc is narrower than the geometry on purpose, so a plate
// always has approaches nothing can see. `blindCells` is that promise as a
// function, and the suite asserts it on every default seed.
export const GUN_FAMILIES = ['needle', 'rotor', 'kiln', 'quiver', 'lancer', 'railgun', 'howitzer', 'mortar', 'plasma', 'heptapod_a6'];

function stepSentries(s, rng) {
  for (const sk of sentrySockets(s)) {
    const ok = [0, 1].every((dz) => [0, 1].every((dx) => s.cells[idx(s, sk.x + dx, sk.z + dz)] === KIND.SENTRY && s.owner[idx(s, sk.x + dx, sk.z + dz)] === -1));
    if (!ok) { s.warnings.push(`sentry socket at ${sk.x},${sk.z} lost its reservation`); continue; }
    const family = GUN_FAMILIES[Math.floor(rng() * GUN_FAMILIES.length)];
    const pieceIndex = place(s, 'defense_sentry_socket', sk.x, sk.z, 2, 2, 0, KIND.SENTRY, { zone: 'defense' });
    s.sentries.push({ x: sk.x, z: sk.z, family, tier: s.params.tier, yawDeg: sk.yawDeg, arcDeg: s.params.arc, pieceIndex, where: sk.where });
  }
}

// Can this sentry bear on the point (cx, cz), in cell units? The socket's
// centre is one cell in from its origin on both axes.
export function sentryBears(st, cx, cz) {
  const dx = cx - (st.x + 1), dz = cz - (st.z + 1);
  const bearing = Math.atan2(dx, dz) * 180 / Math.PI;
  return Math.abs(wrapDeg(bearing - st.yawDeg)) <= st.arcDeg / 2;
}

export function ringCoverage(s) {
  const out = [];
  const push = (x, z) => out.push({ x, z, covered: s.sentries.some((st) => sentryBears(st, x + 0.5, z + 0.5)) });
  for (let x = 0; x < s.w; x++) { push(x, 0); push(x, s.h - 1); }
  for (let z = 1; z < s.h - 1; z++) { push(0, z); push(s.w - 1, z); }
  return out;
}

export const blindCells = (s) => ringCoverage(s).filter((c) => !c.covered).map((c) => [c.x, c.z]);
```
In `generatePlate`, after `stepPacking(s, rng);` add `stepSentries(s, rng);`.

- [ ] **Step 4: Run the test**

Run: `node test/plate.mjs`
Expected: all `ok`, `all ok`. If a `no warnings` check fails, print `p.warnings` for that seed and fix the cause in the generator rather than the test: the default seeds are the contract.

- [ ] **Step 5: Bust, commit**

```bash
./scripts/bust.sh --quiet && npm test && git add -A
git commit -m "plate: sentry sockets with outward yaw and limited arcs; blind approaches proven

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GjhA7Eswq3G5DUd7Ymvu88"
```

---

### Task 8: Viewer with placeholders, orbit camera, knobs, ASCII overlay

**Files:**
- Create: `src/plate-tab.js`, `scripts/plate-verify.sh`

**Interfaces:**
- Consumes: `generatePlate`, `PLATE_KNOBS`, `PLATE_TUNE`, `makePlateParams`, `clampPlateParams`, `KIND`, `CELL_M`, `buildCatalog`, `CATALOG_SPEC`, `SECTION_COLOR`, `PLACEHOLDER_HEIGHT_M`, `fileFor`, `ringCoverage`.
- Produces: `initPlateTab(root)`; URL params `seed w h gates arc density tier` and `ascii=1`; console line `[plate] ascii` followed by the map; `window.__plate` for probes.

- [ ] **Step 1: Write `src/plate-tab.js`**

```js
// plate-tab.js — draws a Plate. Owns the renderer, the camera, the knob
// panel and the overlay; owns NO layout decisions. Every piece is either a
// catalog GLB (Task 9) or, here, a placeholder box of its footprint.
import * as THREE from '../vendor/three.module.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import GUI from '../vendor/lil-gui.esm.js';
import { generatePlate, PLATE_KNOBS, PLATE_TUNE, makePlateParams, clampPlateParams, KIND, CELL_M, ringCoverage, dirOfYaw } from './plate.js?v=00000000';
import { CATALOG_SPEC } from './catalog-spec.js?v=00000000';
import { buildCatalog, SECTION_COLOR, PLACEHOLDER_HEIGHT_M, BASE_KIT_URL } from './catalog.js?v=00000000';
import { bustToken } from './glbmodels.js?v=00000000';

// `#plate?seed=7` and `?seed=7#plate` both work: the hash's own query is
// merged under the real search string.
function query() {
  const q = new URLSearchParams(location.search);
  const hq = location.hash.indexOf('?');
  if (hq >= 0) for (const [k, v] of new URLSearchParams(location.hash.slice(hq + 1))) if (!q.has(k)) q.set(k, v);
  return q;
}

const labelCache = new Map();
function labelTexture(text) {
  if (labelCache.has(text)) return labelCache.get(text);
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0)'; g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#e8eef6'; g.font = '28px ui-monospace, Menlo, monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text.replace(/^[a-z]+_/, ''), 128, 32);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  labelCache.set(text, t);
  return t;
}

export function initPlateTab(root) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  root.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1116);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 2000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x20242c, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(60, 120, 40);
  scene.add(sun);

  const overlay = document.createElement('pre');
  overlay.className = 'ascii-overlay';
  overlay.hidden = true;
  root.appendChild(overlay);
  const notice = document.createElement('div');
  notice.className = 'notice';
  notice.hidden = true;
  root.appendChild(notice);

  // --- params from URL ------------------------------------------------------
  const q = query();
  const params = clampPlateParams(makePlateParams(), Object.fromEntries([...q.entries()]));
  const view = { wallState: 0, ascii: q.get('ascii') === '1' };

  // --- catalog --------------------------------------------------------------
  let catalog = buildCatalog(CATALOG_SPEC, null);
  const catalogReady = fetch(`${BASE_KIT_URL}manifest.json${bustToken()}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((m) => { catalog = buildCatalog(CATALOG_SPEC, m); })
    .catch((e) => { notice.textContent = `base-kit manifest unavailable, placeholders only (${e.message})`; notice.hidden = false; });

  // --- scene contents -------------------------------------------------------
  let group = null;
  let plate = null;

  function placeholderMesh(piece, entry) {
    const h = PLACEHOLDER_HEIGHT_M[entry.section] || 2;
    const inset = piece.kind === KIND.BUILDING ? 0.6 : 0.2;
    const geo = new THREE.BoxGeometry(piece.pw * CELL_M - inset * 2, h, piece.ph * CELL_M - inset * 2);
    const mat = new THREE.MeshStandardMaterial({ color: SECTION_COLOR[entry.section] || 0x888888, roughness: 0.85, metalness: 0.1 });
    const m = new THREE.Mesh(geo, mat);
    m.position.y = h / 2;
    const g = new THREE.Group();
    g.add(m);
    if (piece.kind === KIND.BUILDING || piece.kind === KIND.SENTRY) {
      const lab = new THREE.Mesh(new THREE.PlaneGeometry(piece.pw * CELL_M * 0.9, piece.pw * CELL_M * 0.225),
        new THREE.MeshBasicMaterial({ map: labelTexture(piece.id), transparent: true, depthWrite: false }));
      lab.rotation.x = -Math.PI / 2;
      lab.position.y = h + 0.05;
      g.add(lab);
      // an entrance tick on the S face at rot 0, so the rotation is visible
      const tick = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 0.4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      tick.position.set(0, 0.15, -(piece.ph * CELL_M) / 2 + inset + 0.2);
      g.add(tick);
    }
    return g;
  }

  // piece -> world transform. Rect centre in cells, plus the piece's own
  // outward offset (the gate), then rot about +Y clockwise from above.
  function placePiece(obj, piece) {
    obj.position.set((piece.x + piece.pw / 2 + piece.offset[0]) * CELL_M, 0, (piece.z + piece.ph / 2 + piece.offset[1]) * CELL_M);
    obj.rotation.y = piece.rot * Math.PI / 2;
  }

  function arcWedge(st) {
    const R = 9 * CELL_M, n = 24;
    const a0 = (st.yawDeg - st.arcDeg / 2) * Math.PI / 180, a1 = (st.yawDeg + st.arcDeg / 2) * Math.PI / 180;
    const pos = [0, 0.08, 0];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * i / n;
      pos.push(Math.sin(a) * R, 0.08, Math.cos(a) * R);
    }
    const idxs = [];
    for (let i = 1; i <= n; i++) idxs.push(0, i, i + 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idxs);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xc0392b, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
    m.position.set((st.x + 1) * CELL_M, 0, (st.z + 1) * CELL_M);
    return m;
  }

  function build() {
    if (group) { scene.remove(group); group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    group = new THREE.Group();
    plate = generatePlate(params);
    window.__plate = plate;
    const W = plate.w * CELL_M, H = plate.h * CELL_M;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(W, 0.4, H), new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.95 }));
    slab.position.set(W / 2, -0.2, H / 2);
    group.add(slab);
    const grid = new THREE.GridHelper(Math.max(W, H), Math.max(plate.w, plate.h), 0x2a3140, 0x1c212b);
    grid.position.set(Math.max(W, H) / 2, 0.02, Math.max(W, H) / 2);
    group.add(grid);
    for (const piece of plate.pieces) {
      const entry = catalog.get(piece.id);
      if (!entry) continue;
      const obj = placeholderMesh(piece, entry);
      placePiece(obj, piece);
      group.add(obj);
    }
    for (const st of plate.sentries) group.add(arcWedge(st));
    // blind ring cells: a dim marker on the ring outside the wall
    for (const c of ringCoverage(plate)) {
      if (c.covered) continue;
      const m = new THREE.Mesh(new THREE.BoxGeometry(CELL_M * 0.5, 0.2, CELL_M * 0.5), new THREE.MeshBasicMaterial({ color: 0x2ecc71 }));
      m.position.set((c.x + 0.5) * CELL_M, 3.6, (c.z + 0.5) * CELL_M);
      group.add(m);
    }
    scene.add(group);
    controls.target.set(W / 2, 0, H / 2);
    if (!camera.userData.placed) {
      camera.position.set(W / 2, Math.max(W, H) * 0.9, -H * 0.35);
      camera.userData.placed = true;
    }
    overlay.textContent = plate.ascii();
    overlay.hidden = !view.ascii;
    if (q.get('ascii') === '1') { console.log('[plate] ascii'); console.log(plate.ascii()); }
  }

  // --- panel ----------------------------------------------------------------
  const gui = new GUI({ title: 'PLATE', container: root });
  const folders = {};
  for (const k of PLATE_KNOBS) {
    const f = folders[k.group] || (folders[k.group] = gui.addFolder(k.group));
    f.add(params, k.key, k.min, k.max, k.step).name(k.label).onFinishChange(build);
  }
  gui.add({ regenerate: () => { params.seed = (params.seed + 1) % 1000000; gui.controllersRecursive().forEach((c) => c.updateDisplay()); build(); } }, 'regenerate').name('regenerate (seed+1)');
  gui.add(view, 'wallState', { 'D0 intact': 0, 'D1 damaged': 1, 'D2 critical': 2, 'D3 destroyed': 3 }).name('wall state').onChange(build);
  gui.add(view, 'ascii').name('ascii overlay').onChange((v) => { overlay.hidden = !v; });

  // --- loop -----------------------------------------------------------------
  function resize() {
    const w = root.clientWidth, h = root.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();
  catalogReady.then(build);
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
}
```

- [ ] **Step 2: Bust and serve**

```bash
./scripts/bust.sh --quiet && ./scripts/check-tokens.sh
(python3 -m http.server 8150 > /dev/null 2>&1 &) ; sleep 1; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8150/
```
Expected: `200`.

- [ ] **Step 3: Headless check script**

`scripts/plate-verify.sh`:
```bash
#!/usr/bin/env bash
# plate-verify.sh — the browser's plate is the Node plate. Generates seed N
# in Node, loads #plate?seed=N&ascii=1 headless, and diffs the two ASCII
# maps. Any drift means the tab is deciding layout, which it must never do.
set -euo pipefail
cd "$(dirname "$0")/.."
SEED="${1:-7}"
PORT="${PORT:-8150}"
node -e "import('./src/plate.js').then(m => console.log(m.generatePlate(m.makePlateParams({...m.PLATE_TUNE, seed: $SEED})).ascii()))" > /tmp/karyoku-node.txt
node scripts/headless-wait.mjs --url "http://localhost:$PORT/?seed=$SEED&ascii=1#plate" --seconds 6 --size 1280x800 --swiftshader --grep '^[#G=Bo.S]{12,}$' 2>/dev/null \
  | grep -E '^[#G=Bo.S]{12,}$' > /tmp/karyoku-browser.txt || true
if diff -q /tmp/karyoku-node.txt /tmp/karyoku-browser.txt > /dev/null; then
  echo "ok   browser plate == node plate (seed $SEED)"
else
  echo "FAIL browser plate != node plate (seed $SEED)"; diff /tmp/karyoku-node.txt /tmp/karyoku-browser.txt || true; exit 1
fi
```
Read `scripts/headless-wait.mjs` first: confirm it prints console lines to stdout and that `--grep` filters them. If it prefixes lines (for example with `console:`), adjust the second `grep -E` to strip the prefix with `sed`.

- [ ] **Step 4: Run it**

```bash
chmod +x scripts/plate-verify.sh && ./scripts/plate-verify.sh 7
```
Expected: `ok   browser plate == node plate (seed 7)`. Then take a screenshot for the eye:
```bash
node scripts/headless-wait.mjs --url "http://localhost:8150/?seed=7#plate" --seconds 6 --size 1280x800 --out /private/tmp/claude-501/-Users-minikai-Dev-karyoku/7ea2c5c9-1c76-4f2f-826d-147104d6d7de/scratchpad/plate-7.png
```
Open the PNG and confirm: a grey slab, a ring of grey boxes, coloured building boxes beside dark road slabs, red wedges at the corners and gate flanks, green markers on blind ring cells.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "plate-tab: viewer with placeholders, orbit camera, knob panel, ascii overlay

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GjhA7Eswq3G5DUd7Ymvu88"
```

---

### Task 9: Viewer with the real kit — instanced walls, corners, gate, sentries

**Files:**
- Modify: `src/plate-tab.js`
- Copy: `assets/models/sentries/*.glb` from the reference

**Interfaces:**
- Consumes: `loadGlb`, `mergeByMaterial`, `fitModel` from `glbmodels.js`; `fileFor(entry, state)`; `sentryUrl(family, tier)` defined here as `assets/models/sentries/${family}_t${tier}.glb`.

- [ ] **Step 1: Copy the sentry models**

```bash
mkdir -p assets/models/sentries
cp /Users/minikai/Dev/spherical-stalberg-grid/assets/models/sentries/*.glb assets/models/sentries/
ls assets/models/sentries | wc -l
```
Expected: `33`.

- [ ] **Step 2: Add model loading to `src/plate-tab.js`**

Change the glbmodels import to:
```js
import { bustToken, loadGlb, mergeByMaterial, fitModel } from './glbmodels.js?v=00000000';
```
Add after `labelTexture`:
```js
// One merged prototype per model URL. The kit's pieces are static, so
// everything merges; a sentry keeps YAW / PITCH / RECOIL as pivots. A load
// that fails resolves to null and the piece stays a placeholder.
const protos = new Map();
function proto(url, pivots = [], fit = null) {
  if (protos.has(url)) return protos.get(url);
  const p = loadGlb(url).then((scene) => {
    if (!scene) return null;
    const merged = mergeByMaterial(scene, pivots);
    return fit ? fitModel(merged, fit) : merged;
  });
  protos.set(url, p);
  return p;
}
const sentryUrl = (family, tier) => `assets/models/sentries/${family}_t${tier}.glb`;

// Every mesh of a prototype, with its transform relative to the prototype
// root, so a set of pieces can be drawn as InstancedMeshes.
function meshesOf(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const out = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    out.push({ geometry: o.geometry, material: o.material, local: new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld) });
  });
  return out;
}

function instanced(root, pieces, transformOf) {
  const g = new THREE.Group();
  const m = new THREE.Matrix4();
  for (const part of meshesOf(root)) {
    const im = new THREE.InstancedMesh(part.geometry, part.material, pieces.length);
    pieces.forEach((piece, i) => { im.setMatrixAt(i, m.multiplyMatrices(transformOf(piece), part.local)); });
    im.instanceMatrix.needsUpdate = true;
    g.add(im);
  }
  return g;
}
```
In `build()`, replace the piece loop with:
```js
    const pieceMatrix = (piece) => {
      const o = new THREE.Object3D();
      placePiece(o, piece);
      o.updateMatrix();
      return o.matrix.clone();
    };
    const byModel = new Map(); // url -> pieces drawn from it
    for (const piece of plate.pieces) {
      const entry = catalog.get(piece.id);
      if (!entry) continue;
      const state = piece.kind === KIND.WALL ? view.wallState : piece.state;
      const url = entry.placeholder ? null : fileFor(entry, state);
      if (!url) { const obj = placeholderMesh(piece, entry); placePiece(obj, piece); group.add(obj); continue; }
      if (!byModel.has(url)) byModel.set(url, []);
      byModel.get(url).push(piece);
    }
    const gen = ++buildGen;
    for (const [url, pieces] of byModel) {
      proto(url).then((root) => {
        if (gen !== buildGen) return; // a newer plate replaced this one while the model loaded
        if (!root) { for (const piece of pieces) { const obj = placeholderMesh(piece, catalog.get(piece.id)); placePiece(obj, piece); group.add(obj); } return; }
        group.add(instanced(root, pieces, pieceMatrix));
      });
    }
    for (const st of plate.sentries) {
      group.add(arcWedge(st));
      proto(sentryUrl(st.family, st.tier), ['YAW', 'PITCH', 'RECOIL'], { height: 4.5, maxSpan: 7 }).then((root) => {
        if (gen !== buildGen || !root) return;
        const inst = root.clone();
        const yaw = inst.getObjectByName('YAW');
        if (yaw) yaw.rotation.y = st.yawDeg * Math.PI / 180;
        inst.position.set((st.x + 1) * CELL_M, 0.2, (st.z + 1) * CELL_M);
        group.add(inst);
      });
    }
```
Declare `let buildGen = 0;` beside `let group = null;`. Keep the socket placeholder for the sentry piece itself (it is `defense_sentry_socket`, a placeholder in the catalog, so it draws as a low red box under the turret; that is the plinth).

- [ ] **Step 3: Verify in the browser**

```bash
./scripts/bust.sh --quiet && ./scripts/check-tokens.sh && ./scripts/plate-verify.sh 7
node scripts/headless-wait.mjs --url "http://localhost:8150/?seed=7#plate" --seconds 10 --size 1280x800 --out /private/tmp/claude-501/-Users-minikai-Dev-karyoku/7ea2c5c9-1c76-4f2f-826d-147104d6d7de/scratchpad/plate-7-kit.png
```
Expected: verify prints `ok`; the screenshot shows modelled wall segments in the ring with corners, a modelled gate straddling the ring with its half-cell overhang, turret models on the sockets facing outward, and placeholder boxes for everything else. Check the console for `[glbmodels] ... failed to load` lines with `--grep glbmodels`; there should be none.

Also switch the wall state through the URL is not supported; use the panel in a real browser: open `http://localhost:8150/#plate`, set `wall state` to D3, confirm the ring rebuilds with the destroyed segments.

- [ ] **Step 4: Draw-call sanity**

In the browser console: `renderer` is not exposed; instead count instanced meshes: `window.__plate.pieces.filter(p => p.kind === 1).length` gives the wall count (about 66 at 20 by 16), and the scene should hold one `InstancedMesh` per wall material rather than 66 groups. Add to `build()` after the loop: `console.log('[plate] models', byModel.size, 'pieces', plate.pieces.length);` and confirm the number of models is small (3 to 4) while pieces is large.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "plate-tab: kit walls, corners and gate as instanced GLBs; turrets on the sockets

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GjhA7Eswq3G5DUd7Ymvu88"
```

---

### Task 10: Docs, remote, and the running localhost

**Files:**
- Create: `CLAUDE.md`
- Modify: `README.md`, `docs/superpowers/specs/2026-09-06-plate-generator-design.md` (record the two zone-order deviations below)

- [ ] **Step 1: Record what changed from the spec**

In the spec's Generator section, replace the zone assignment sentence in step 3 with the order the code uses: command (nearest centre), one logistics block per gate (largest adjacent), the largest remaining block becomes air if an 8 by 8 pad fits and personnel otherwise, ring-touching blocks split defense and utility by seed, the rest personnel or industry by seed. Add one line under Ring: gate centres sit at least five cells from a corner so the flank sockets clear the corner sockets. Add one line under Output: pieces carry `offset` in cells, and the gate's is half a cell outward.

- [ ] **Step 2: Write `CLAUDE.md`**

```markdown
# karyoku — working notes for Claude sessions

Firepower homage. Sub-project 1 (plate generator) is built; Drive and World
are briefed in the spec. Stack and rules mirror ~/Dev/spherical-stalberg-grid.

## Hard rules
- After editing `src/*.js`, HTML or CSS: `./scripts/bust.sh --quiet`, commit ALL of its output.
- Never `?v=` on a `../vendor/` import.
- No emoji. `scripts/check-emoji.sh` and `scripts/check-tokens.sh` run on pre-push (`git config core.hooksPath .githooks`).
- `npm test` must stay green: catalog and plate invariants over seeds 1..50.
- Pure modules (`plate.js`, `catalog.js`, `catalog-spec.js`) never import three.js. `plate-tab.js` never decides layout.
- `src/catalog-spec.js` is GENERATED from `base-assets.md` by `scripts/gen-catalog-spec.py`.

## Conventions
- 1 cell = 4 m. N is +Z, E is +X. `rot` is quarter turns clockwise from above, `rotation.y = rot * PI/2`. Yaw 0 = N, 90 = E.
- Plate width and depth are even.

## Verify
- `npm run serve` then `http://localhost:8150/#plate?seed=7&ascii=1`.
- `./scripts/plate-verify.sh 7` diffs the browser's ASCII against Node's.
- Headless: `node scripts/headless-wait.mjs --url ... --swiftshader --out shot.png`; every capture goes through `scripts/chrome-proc.mjs`.
```

- [ ] **Step 3: Create the GitHub repo and push**

```bash
gh repo create kai-denrei/karyoku --public --source=. --remote=origin --description "Firepower homage: procedural military bases on Stalberg terrain" --push
gh repo view kai-denrei/karyoku --json url -q .url
```
Expected: the repo URL. The pre-push hook runs both checks; if it blocks, fix and push again.

- [ ] **Step 4: Final verification and the localhost**

```bash
npm test && ./scripts/check-tokens.sh && ./scripts/check-emoji.sh
pgrep -f "http.server 8150" || (python3 -m http.server 8150 > /dev/null 2>&1 &)
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8150/index.html"
```
Expected: suites green, both checks pass, `200`. The deliverable is `http://localhost:8150/#plate`.

- [ ] **Step 5: Commit and push**

```bash
git add -A
git commit -m "docs: CLAUDE.md, spec deviations recorded

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GjhA7Eswq3G5DUd7Ymvu88"
git push
```
