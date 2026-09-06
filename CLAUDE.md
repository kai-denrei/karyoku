# karyoku — working notes for Claude sessions

Firepower homage. Sub-project 1 (plate generator, `#plate`) and 2 (drive,
`#drive`) are built; World is briefed in
`docs/superpowers/specs/2026-09-06-plate-generator-design.md`. Drive's
rules: `docs/superpowers/specs/2026-09-06-drive-design.md`.
Stack and rules mirror ~/Dev/spherical-stalberg-grid (three r160 vendored,
no build step, Node invariant suites).

## Hard rules
- After editing `src/*.js`, HTML or CSS: `./scripts/bust.sh --quiet`, then
  commit ALL of its output (`git add -A`). Never `?v=` on a `../vendor/` import.
- No emoji. `scripts/check-emoji.sh` and `scripts/check-tokens.sh` run on
  pre-push (`git config core.hooksPath .githooks`, set per clone).
- `npm test` must stay green: catalog and plate invariants over seeds 1..50
  and the four size corners. The default seeds produce NO warnings; that is
  the contract, fix the generator rather than the test.
- Pure modules (`plate.js`, `catalog.js`, `catalog-spec.js`) never import
  three.js. `plate-tab.js` never decides layout; `scripts/plate-verify.sh N`
  proves it by diffing the browser's ASCII against Node's.
- `src/catalog-spec.js` is GENERATED from `base-assets.md` by
  `scripts/gen-catalog-spec.py`. Edit the markdown, re-run the script.
- Every headless capture goes through `scripts/chrome-proc.mjs` (via
  `scripts/headless-wait.mjs`), never a bare Chrome spawn. Check for leaks
  with `ps -eo pid,args | grep -- --headless`.

## Conventions
- 1 cell = 4 m. North is -Z, east is +X. `rot` is quarter turns clockwise
  from above, `rotation.y = -rot * PI/2`. Yaw 0 = N, 90 = E, direction
  `[sin, -cos]`. Plate width and depth are even.
- The base kit names its +Z socket "N"; the corner (legs E and S at rot 0,
  the NW corner) and gate (outward -Z at rot 0, drawn half a cell outward)
  absorb that.
- Sentry models keep YAW / PITCH / RECOIL pivots through the merge; the
  turret's forward is its +Z, so `YAW.rotation.y = PI - yawDeg`.

## Drive
- `src/drive.js` is pure (hull, gates, sentries, tracers, sight); `test/drive.mjs`.
- Sentries are NOT aimbots: they cannot point outside their arc and slew at
  `yawRate`. Sight is blocked by BUILDINGS only; the ring wall is not cover
  (turrets stand above it). The gate lane is METRIC, 8 m wide on the gate
  axis: a 4 m hull cannot pass a 4 m lane, and the first probe stopped at
  the wall line for exactly that reason.
- The hull model's forward is +Z, so `rotation.y = PI - heading`.
- `#drive?seed=7&tick=6` simulates six seconds with the lever forward from
  the spawn outside the first gate and logs `[drive] t= hull= gates= hits=`;
  `?probe=1` logs it every simulated second. `window.__drive` is the state.
- Keys: WASD / arrows drive, C toggles top-down and orbit, R regenerates.

## Verify
- `npm run serve` then `http://localhost:8150/#plate?seed=7&ascii=1`.
  `?seed= ?w= ?h= ?gates= ?arc= ?density= ?tier=` override the knobs;
  `?ascii=1` logs the map. `window.__plate` is the current Plate.
- `node scripts/headless-wait.mjs --url ... --seconds 12 --size 1280x800
  --swiftshader --out shot.png` for a screenshot.
