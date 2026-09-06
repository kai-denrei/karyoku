# karyoku — working notes for Claude sessions

Firepower homage. All three PoC sub-projects are built: `#plate` (generator),
`#drive` (the MKCX-2 on a plate), `#world` (two plates on Stalberg terrain,
a road found between them). Specs in `docs/superpowers/specs/`, one per
sub-project, plans beside them.
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

## World
- `src/world.js` is pure: the 2D Stalberg kernel copied from oskar-procedure
  (`organic-grid.js`, `poisson.js`, `hex.js`, `vec2.js`, vendored
  `delaunator.js` + `robust-predicates.js`) and its value noise (`noise.js`).
  Height is a FUNCTION (`world.heightAt`), masked flat around the plates;
  the mesh samples it, the hull samples it, they cannot disagree.
- The kernel's quads are CCW in its (x, y) plane and y becomes z here, which
  flips handedness: terrain triangles are emitted REVERSED or every face
  culls from above and the ground is a field of slivers.
- The road is Dijkstra over quads sharing an edge, slope-penalised, from A's
  facing gate to B's. Trees and rocks never sit on road quads or in a plate's
  margin. Trunks and rocks block the hull; canopies do not.
- `#world?seed=7&tick=8` logs `[world] t= hull= y= goal= hits=`; `?view=overview`
  parks the camera above the whole world for a screenshot. `window.__world`.

## Feel (operator, 2026-09-06 evening)
- Plates default 32 x 26 cells, density 0.55: a 7.8 m hull needs room to
  manoeuvre; 20 x 16 was "much too small".
- Cameras: `chase` (default), `top`, `orbit`; C cycles. `?view=` picks one.
- The hull is TILTED to the terrain normal (`terrainNormal` in world.js,
  `setPose(hull, y, normal)`); flat placement clipped into every slope.
- Terrain vertices under a plate are dropped 0.8 m: coplanar with the slab
  they z-fight into a moire.
- Mortar and howitzer (`LOB_FAMILIES`) fire BALLISTIC shells: aimed at where
  the hull will be after the flight, visible arc with a ground shadow, splash
  radius on landing, long cooldown. The skill is reading the arc. Their PITCH
  node is held at `LOB_ELEV_DEG`.

## Feel, round two (operator, 2026-09-06 late)
- Keys: 1 top, 2 chase, 3 orbit, 4 overview (`CAMERA_KEYS` in drive-rig.js);
  SPACE fires the hull's gun (`fireHull`, `kind: 'shot'`, stops on solids, no
  damage). Top-level sliders: tank speed, base size (sets w and h at 4:3),
  world size; the world GROWS if the bases would not fit (`makeWorld`).
- SLOPES: the hull stands on `groundAt` (the rendered triangle's height and
  normal, found through `world.qhash`), never on the smooth function — the
  two differ by up to 3 m and the difference was the hull inside the hill.
  `splitQuad` is the one rule for turning a quad into two triangles, shared
  by the renderer and the lookup.
- The kernel's relaxer must be given the mesh's OWN mean edge as
  `SIDE_LENGTH` (and the boundary pinned): at its default 0.06 our quads
  fold — 49 inverted, 200 concave — and every fold was a crease the hull
  sank into. `test/world.mjs` asserts zero inverted and zero concave quads.

## Verify
- `npm run serve` then `http://localhost:8150/#plate?seed=7&ascii=1`.
  `?seed= ?w= ?h= ?gates= ?arc= ?density= ?tier=` override the knobs;
  `?ascii=1` logs the map. `window.__plate` is the current Plate.
- `node scripts/headless-wait.mjs --url ... --seconds 12 --size 1280x800
  --swiftshader --out shot.png` for a screenshot.
