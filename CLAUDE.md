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

## Firepower layout, damage, hostility (operator, 2026-09-06 late)
- A plate has TWO RINGS when it can afford them: outer perimeter, an empty
  band (`moat` knob; `inset` is the inner ring's row, even, at least 4, and
  0 on plates under 20 cells), then the base wall. Gates on both rings share
  side and `at`; a band road joins them; the inner gate carries the `port`
  and links the graph across itself. `innerRect`, `blockBounds`.
- Sockets: outer corners in the band (`where: 'outer'`), inner corners and
  inner-gate flanks inside. Buildings only inside the inner ring.
- WALLS ARE DESTRUCTIBLE: `damageAt` steps a `wall_standard` piece D0..D3;
  D3 is rubble and `blockedAt` lets the hull through. The scene draws walls
  by `piece.state` (`wallState: null`) and `rig.rebuildWalls()` after a hit.
  Corners and gates have no damaged models yet and shrug rounds off.
- World: plate A is HOME (gates open, sentries silent), plate B is HOSTILE
  (gates shut, sentries live) — you breach B through its wall.
- Probes: `#drive?seed=7&tick=4&fire=1&hold=1&aim=wall` shoots the wall
  beside the gate and logs `shots= damaged= breached=`.

## The look (operator, 2026-09-06 night: Tron colours, Battlezone, space colony)
- `src/looks.js` owns it: PALETTE, `applySpaceScene` (black, exp fog, dim
  lights), `makeStars`, `makeComposer` (RenderPass + UnrealBloomPass +
  OutputPass; every tab renders through `post.render()`), `terrainMeshes`
  (dark facets + one LineSegments of every quad edge, orange on the road),
  `floraMeshes` (crystal spires and lichen domes on the old tree records),
  `neonBox` placeholders, `tintProto` (glbmodels' emissive tint; wash 0.14,
  the hull 0.08 — higher and a wall is a solid cyan slab).
- Plates are tinted by side: `PALETTE.home` cyan, `PALETTE.hostile` red.
  NASA stand-ins take their section colour. `proto()` keys its cache on
  url + fit + tint.
- Stars sit UNDER the bloom threshold (dim, small): over it they bloom
  into grey squares.
- Cache: `npm run serve` is `scripts/serve.py`, which sends `no-cache` on
  every response; the nav's build token is the visual confirmation. Pages
  still caches 600 s.

## The reference board's light and metal (operator, 2026-09-06 late night)
- Lights, background and bloom are the TD board's, verbatim: hemi
  0xc8cfe0/0x555060 at 1.5, sun 0xffe8c8 1.1, fill 0x8a96c8 0.8, bg 0x0d1017,
  no fog; `postfx.js` (copied) at strength 0.3 / radius 0.5 / threshold 0.2
  with `bloomweights.js` groups — map 0.35, tank/towers/effects 1.0. Each
  tab names its groups through `setGroups`.
- Every cast goes through `casts.js`: `prepFor(url)` (empty the container,
  repaint the terraformer) BEFORE the merge, then `ladderTint` (tintModel's
  grey ladder, wash 0.22) and `dressMetal` (`materials.js` +
  `weathered.js`, seed 4414, size 512, keepColor + keepEmissive). The hull
  is `castHull`: edge outlines on the prototype first, then the same.
- House casts: `assets/models/manifest.json` maps the container to
  `logistics_container` and the terraformer (the Stalheart) to
  `command_hq`; it loads last so it beats the NASA stand-ins.

## Yard, bodies, gates (operator, 2026-09-06 late night, round two)
- Plates default 40 x 32, density 0.4, and a `gap` of 2 cells kept clear
  around every building inside its block (`laneClear`): the hull needs lanes.
- The band holds CONTAINERS as dressing (`stepBand`, zone 'band'); they are
  BODIES in the drive (`makeBodies` frees their cells, `stepBodies` settles
  the hull against them): solid, no damage, and they give way when pushed
  unless something static or another body is behind them. Shots stop on
  them. The scene keeps each one as its own object (`rig.dynamic`).
- EVERY gate opens for the hull — both rings, both plates — for now; only
  the hostile plate's sentries fire. The clip is scrubbed by `setGateOpen`
  (action.time + mixer.update(0)): `mixer.setTime` on a PAUSED action does
  nothing, and the gate stood shut at open=1.00 until `?gateprobe=1` said so.
- The kit has no image textures: its look is authored material colours,
  and the grey ladder painted over them. Kit URLs get a 0.10 emissive wash
  only; house and NASA casts get the ladder and the metal.

## The research-outpost kit and the crew (operator, 2026-09-07)
- `assets/outpost/` is the workshop's research-outpost kit: twelve ids in
  four damage states (48 GLBs, 19 MB), manifest in the base-kit format.
  Loads after NASA and before the house casts, so it beats the NASA
  stand-ins and loses the container and the Stalheart to the house.
  Two ids were new and joined `base-assets.md` under "Research"
  (`research_xenobiology`, `research_specimen_crate`); the spec is 111 rows.
  Same workshop paint rule as the base kit: wash only, no ladder.
- THE CREW: `crew.js` (pure, `test/crew.mjs`) walks astronauts between
  cells they can see straight across walkable ground; `crew-scene.js`
  PARSES the compact astronaut fresh per walker (51 skins, three Mixamo
  clips — a clone needs SkeletonUtils, which is not vendored) from one
  fetched buffer, colours the suit materials per walker, and blends the
  walk and idle clips by whether the walker is moving. `?crew=N` sets the
  count (6 on a plate, 5 per plate in the world).

## Verify
- `npm run serve` then `http://localhost:8150/#plate?seed=7&ascii=1`.
  `?seed= ?w= ?h= ?gates= ?arc= ?density= ?tier=` override the knobs;
  `?ascii=1` logs the map. `window.__plate` is the current Plate.
- `node scripts/headless-wait.mjs --url ... --seconds 12 --size 1280x800
  --swiftshader --out shot.png` for a screenshot.
