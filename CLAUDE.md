# karyoku — working notes for Claude sessions

Public: https://kai-denrei.github.io/karyoku/ (Pages from main, root, `.nojekyll`;
`max-age=600` CDN lag — the nav's build token says which build is served).

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
- SENTRIES ARE DAMAGEABLE: `damageSentryAt(plate, sentries, x, z, tune)`
  counts hull rounds on the socket (`sentryHits` 3); at the third the
  sentry is `alive: false`: `stepSentries` skips it, `solidHeightAt(...,
  sentries)` drops its cell to `SOLID_HEIGHT.wreck` so shells fly over,
  `rayStop(plate, gates, bodies, sentries)`. THE WRECK stays: the scene's
  `breakSentry(index)` keeps the plinth and base, knocks the head (the
  YAW subtree) backward into the band on its side, rests it on the ground
  by its measured box (offsets DIVIDED by the fit scale: the node's frame
  is scaled), darkens it (0.3 colour, no emissive; dim lines in BZ), and
  remembers indices broken before the model loaded. `sfx.sentryDestroyed`
  is two shell bursts (head 5.0, plinth 3.4) and `sentry_destroyed`.
  Probe: `?aim=sentry&fire=1&hold=1&elev=2&tick=6` logs `sentriesDown=1`
  and a `[wreck]` line with the head's box.
- RUN OVER: `FLAT_IDS` (the pads) are floors: no block, shells and sight
  pass. `CRUSH_IDS` (antenna, crate, pallet, radar, conduit, small props)
  block until the hull drives into them at `crushSpeed` (3 m/s):
  `stepCrush` (called BEFORE stepHull) sets state 3, `crushed`, and the
  hull keeps 70% of its speed. A crushed piece whose kit has no rubble
  model is drawn by `crushedMatrix`: the same model at a tenth of its
  height, tilted. Probe: `crushed=`.
- CREW SIDES: `crew.hostile` (the drive plate's crew; the world's plate B)
  is not shoved by the hull (`hullAt` passed to `stepCrew`) and is
  squashed at `squashSpeedEnemy` 0.4 m/s inside `squashMEnemy`; the home
  crew keeps the shove and the 2 m/s threshold.
- THE RUMBLE: `sfx.body(key, moved, dist, dt)` per body per frame; a
  moving body loops `container_rumble` (the operator's clip, low-passed
  at 650 Hz, -7 dB, mono, 21.9 s) from a RANDOM offset (audio.js `offset`
  option), follows distance, fades 0.35 s after it stops. `b.moved` is set
  by `stepBodies`.
- THE RACK: `hull.ammo` (27, `ammoMax`), `fireHull` refuses at 0 and sets
  `hull.empty` for the click (`laser_click`); nine dots on the model's
  `ShellRack_Mount` (`makeShellRack`, kept as a pivot), `ammoDotsLit` =
  ceil(ammo / 3). `?ammo=N` for probes. No resupply yet.
- FPS AND PERF: `#fps` in the nav (`fps.js`, `tickFps` from every loop);
  `?perf=1` logs calls/tris/objects every 2 s with a by-group breakdown
  (renderer.info.autoReset off so the composer's passes add up). At
  120 x 90 cells: ~430 band containers as separate unmerged corrugated
  models were 5.5k objects and most of 50 M triangles a frame. Pixel
  ratio capped at 1.5. Bodies want instancing and a lighter container.

## Power, warehouse bodies, chunks (operator, 2026-09-07)
- THE POWER COMPOUND (`stepPower`, first in `stepPacking`): an 8 x 6 ring
  of wall with one `gate_vehicle` (ring 'power') toward the block's road,
  in the block nearest the plate centre; inside, `solar_power_station`
  (2 x 2, `power: true`) at the back and three `solar_panel_rack`s.
  `plate.power = { pieceIndex, rect, rot, gate }`; the gate's approach is
  RESERVED foundation (`owner === RESERVED` (-2)), else yard stock boxed
  it in. `powered(plate)` is the station under D3; `stepSentries(...,
  isPowered)` drops every sentry when it falls; the scene strings CABLES
  from the station to every sentry head and `setPowered(false)` darkens
  them and droops the heads. A narrow plate (interior under 14 cells)
  skips the compound silently. The line landmark loses its block on a few
  seeds now (test allows 3 of 50). Probe: `?aim=power&elev=8&fire=1&hold=1
  &tick=8` ends `power=off`.
- WAREHOUSE PROPS: `assets/warehouse/` (crate, case, barrel, pallet, and
  the armored container remapped to `logistics_container`, plot 2 x 1),
  four states each; the solar kit's station and rack in `assets/solar/`
  (the complex and the array were 50 MB and were not vendored). The house
  container and the outpost container are gone. `YARD_IDS` pack like the
  old containers (rows, no lane, no road) and stock the band
  (`BAND_STOCK`); the specimen crate and assembly pallet left the zone lists.
- BODIES BREAK: `BODY_IDS` = the five; `damageBody` steps a state per
  `BODY_HITS` (container 2, else 1); state 3 is `dead`: not solid,
  drawn as its d3 model. Shells (`bodyHit` in the tabs' ray) and RAMS at
  `crushSpeed` (`b.rammed`, 0.8 s per touch, from `stepBodies(..., dt)`)
  damage them; `sfx.bodyHit` picks the cue (a barrel dies like a sentry).
  `makeBodies(plate, ox, oz, bodyDims(catalog))` sizes boxes from the
  kit's colliders.
- RENDER ONLY WHAT IS CLOSER: static and body layers are instanced per
  model AND per 128 m tile (`CHUNK_M`, `chunkOf`); `rig.cull(x, z, maxDist)`
  hides tiles, sentries and loop rigs past `CULL_M` (260 m, `?cull=`), the
  crew scene takes a `near` predicate; the overview camera (y > 150) sees
  all. Bodies are `syncBodies` sets (InstancedMesh per part, matrices
  rewritten for moved bodies, edges rebaked in BZ), rebuilt when a state
  changes. Props capped at 6 per block. At 120 x 90: 11.2k -> ~3k objects,
  61 M -> 35 M tris (colony), the composer still renders the scene twice
  (was two passes; see ONE SCENE RENDER); the old astronaut (95k tris) is gone.
- FIVE MORE CUES (operator clips, processed): `hull.bump` (set by
  `stepHull` when a solid stops it dead at >= 1.5 m/s) -> `sfx.wallHit`;
  `hull.elevating` (the muzzle actually moved) -> `sfx.elevating` loops
  `muzzle_gears`; `b.touched` (contact at >= 1.2 m/s, 0.5 s per body) ->
  `sfx.thud`, one of `THUD_SLICES` (twelve thuds in one file, played by
  `offset` + `duration`, both audio.js options now); `setCam` ->
  `sfx.uiClick`; `impact_hit` is the metal-hit clip.
- NO FIRE ON A RUN-OVER: `IMPACT_RECIPES.crush` is debris only; `sfx.crush`
  and a RAMMED `sfx.bodyHit(..., true)` use it with `crush_slam` (the
  operator's door slam). Shells keep the shell recipe; a barrel still blows.
- ONE SCENE RENDER (postfx.js): the bloom WEIGHT rides in the ALPHA of the
  single base render (an opaque material's `opacity` is written to alpha
  untouched, so opacity = weight); the bloom source is rgb * alpha in a
  full-screen pass; transparent materials get CustomBlending that leaves
  the destination alpha alone and so inherit the weight of the surface
  behind them. Weights are swept into materials every 30 frames, never
  per frame. Three composers: base (MSAA), bloom, final. Calls at 120 x 90
  went 5.5k -> 2.3k, tris 35 M -> 14 M.
- A tab's step() must not call a helper declared LATER in the same
  function (`const` is in its dead zone): the world tab's power-down block
  did and every frame threw once the station fell ("the game freezes").
  `?killpower=N` fells plate N's station after two seconds to prove it.
- THE STATION CREW (replaces the compact astronaut, which is gone):
  `assets/crew/` holds the workshop's astronaut, scientist and worker
  (1.5k tris, one skin, clips Idle/Walk/Run/Kneel/Scared/Point/Lie,
  authored 2.1 m, scaled to 1.8). `crew-scene.js` loads each ONCE and
  clones per walker with a bone-rebinding clone (`cloneSkinned`, the
  SkeletonUtils recipe); `w.act` picks the clip, weights crossfade in
  0.18 s; Lie plays once and clamps; the body stays on the splat.
  `crew.js`: `w.kind` cycles the three; on arrival at a front a walker
  POINTS at it (`pointChance`, faces `area.fx, fz`) or KNEELS; a threat
  inside `fleeM` is a coin (`cowerChance`): run, or cower facing it
  (`scared`) until it leaves `safeM` or comes inside `cowerBreakM`, then
  run; walkers keep `separation` (0.9 m) apart by a pairwise push onto
  free ground. Defaults: 18 on the drive plate, 12 per world plate.
  PAINT: the suit says the trade (`CREW_PAINT`: astronaut grey, scientist
  blue, worker orange), the BACKPACK says the team (`TEAM_PAINT`): the kit
  has no backpack material, so `prepareModel` cuts every triangle behind
  the spine (z < -0.11, y 0.85..1.65) out of each body part into a second
  skinned mesh named 'backpack' that wears the side's material per clone.
- THE RADAR (`radar.js` pure, `makeRadar` in drive-rig): a PPI scope
  top-left (the notice moved right of it), heading-up, 220 m, sweep and
  phosphor as the reference; contacts `{ x, z, side, kind }` from the tabs
  every frame: ours blue squares (statics) and dark-blue dots (people),
  theirs red and orange, the hull a white arrowhead. `test/radar.mjs`
  holds the conventions.
- THE PICK: a click names what is under the pointer (notice + `[pick]`
  log): instanced pieces and bodies by instance (`im.userData.pieces` /
  `.bodies`), sentries by label, else the nearest named ancestor.
- THE WRECK slumps IN PLACE now (tilted on its plinth, sunk 0.4 m, dark):
  the toppled-beside pose made a heptapod's legs a bright unnameable pile.
- Probes: `?breakat=x,z` starts the nearest body destroyed.
- THE SECOND SPIKY JUMBLE (operator, 2026-09-07 13:36) was the NASA
  Habitat Demonstration Unit standing in for `personnel_recreation` and
  `personnel_shelter`: a 2.3k-triangle nine-metre cone whose facets and
  airlock box read as shards under the vector look. Removed (manifest,
  MODELLED, disk); those two ids are unmodelled again. `[proto]` logs
  every prototype's file, triangles and size at load: read it before
  guessing. `?breakat=x,z&breakto=N` starts the nearest body at state N.

## Big plates (operator, 2026-09-07: 70 cells ran at 21 fps)
- THE CPU WAS THE FRAME: `[perf] step=` (an EMA of step + sync ms, and the
  worst frame; `noteStep` from both loops) read 10 ms average and 60 ms
  spikes at 70 x 52 against 1.7 ms at 40 x 32. Every crew step asked
  `bodyAt` for five points per walker and every trip pick a few hundred
  more, each a scan of all 283 bodies. THE BODY INDEX (`indexBodies`,
  8 m buckets on `bodies.index`, rebuilt by `stepBodies` each frame;
  `nearBodies` reads 3 x 3 buckets; `bodyAt` / `bodyHit` / `bodyFits` use
  it) and `tripM` 70 m (a walker only considers areas that near) took it
  to 1.2 ms average, 4 ms worst. The bloom source is half resolution in
  every look now (`scale: 0.5`). syncBodies keys on a numeric hash.
- Still on the GPU at scale: 429 wall segments at 5.9k tris each, and in
  battlezone 650 line sets / 4 M line segments at 70 cells. Next lever: a
  box LOD per tile beyond ~120 m for static and body sets.
- DOORS STAY CLEAR: `frontCell(pc)` is the cell before a piece's S face;
  `reserveEntrance` marks it and its two neighbours along the face
  RESERVED after every non-yard building and landmark (so yard stock and
  props never pack there); `findSpot` turns a building whose S face
  finds no road toward OPEN ground (`frontOpen`) before settling for any
  orientation; the tabs' body blocker includes `reservedAt`, so a shoved
  crate cannot stop on a doorstep. Test: every building's door opens
  onto free ground or road; the infirmary's doorstep is reserved.
- `command_uplink` is GONE from the game entirely (operator, 2026-09-07: it
  never displayed properly): the radome stand-in, its manifest entry, the
  asset row, the modelled set and the command zone list. A 40k Stalheart
  is in the works at the workshop to replace the 165k terraformer.
- KEY AREAS (`keyAreas`): the fronts of buildings with doors (NOT yard
  stock, which is bodies and moves; NOT the compound's station and racks,
  which stand behind a wall a walker cannot cross), the ROAD JUNCTIONS
  (`plate.roads.nodes`, tag 'road', nothing to face) and the inner gates.
  Before this, yard fronts were areas: walkers spawned boxed inside yards
  and three of eight never walked; one paced inside the compound. The
  walking test measures the farthest REACH from the start, not the end.
- THE RAM: `RAM_IDS` (the comms tower) take a round per hit at
  `ramSpeed` 10 m/s, once per touch (0.8 s, `pc.ramCool`), down the same
  D0..D3 ladder as shells (`stepRam(plate, hull, dt, tune)`, called
  before stepHull; the hull keeps half its speed). Three full-speed rams
  are rubble. The drone's `cooldown` is 2.2 s, `markT` 1.4.
- THE TERRAFORMER (`assets/terraformer/`, d0 and d3 only, 15 MB;
  `terraformer_3000`, plot 12 x 14 cells, 165k tris, `Terraforming_Cycle`):
  a LANDMARK with `minSide` 40 (the plate's interior short side in
  cells), so only plates of about 60 cells and up hold it and a default
  plate skips it without a warning; a LOOP_IDS rig (its own clone, the
  clip looping, logged as `[loop] url tris clips`); battlezone edges at
  55 degrees and dim (`BZ_OVERRIDES`). `command_hq` (the old 6k-tri cast,
  5 x 4) stays the nexus on every plate.

## Outposts and the rescue (operator, 2026-09-07)
- `world.outposts` (`WORLD_TUNE.outposts` 4, `OUTPOST_R` 14): camps on
  open ground, ours and theirs by turns, off the road (R + 16), outside
  the plate margins, 90 m apart; five props on a wide ring (crates,
  barrel, rack, pallet) as blockers in `world.hash` (`kind: 'prop'`),
  work spots INSIDE the ring (`o.areas`, each facing its prop) so every
  walk crosses the clearing; trees and rocks keep out of R + 8.
  `outpostGround(world, o)` is a duck-typed ground (`walkableAt`) the
  crew module accepts in place of a plate (`crewWalkableAt`); `makeCrew`
  takes `areasOverride`.
- RESCUE (`rescue.js`, `test/rescue.mjs`): a STOPPED hull (< 1.5 m/s)
  within `boardM` 24 m of a home camp pulls its walkers to it; within
  `boardAt` 5.2 m (past the hull's own 4 m half-length) they are
  `gone`/`aboard`, ten fit. At the drop (the home infirmary front, else
  the facing gate) a stopped hull unloads one every 0.6 s behind itself
  into the home crew as `makeRescued` walkers with `goal` = the door area
  (`mission: 'enter'`; `stepCrew` sends a goal-bearing walker straight
  there and marks `entered`/`gone` on arrival); `stepEntered` scores
  `bonus` 100 each. HUD: `aboard N/10 · rescued · score`; probe
  `aboard= rescued= score= camps=`; `?rescueprobe=1&tick=26` parks the
  hull at our first camp at t=1 and at the drop at t=8 and ends
  `rescued=4 score=400`. Crew scenes GROW (rigs made on demand) and a
  `gone` walker is removed with no splash.
- The radar shows camp props as statics and their crews as units by side.
- THE RECKON GUARD (`guard.js`, `test/guard.mjs`; model `assets/guard/`):
  one per base, hovering `alt` 14 m on an `orbitR` 18 m circle over the
  compound; a HOSTILE guard with the hull inside `range` 140 m lays a MARK
  where the hull will be after `leadT` 1.4 s, holds it `markT` 1.6 s (the
  red pointer: `makeGuardObject` in drive-rig draws a beam from the drone
  to a pulsing red ring on the ground), then drops a lob with `y0` (its
  altitude; `lobHeight` honours `y0`) onto the mark: the existing landing
  splash counts the hit. Cooldown 4.5 s. A home guard only hovers. Sounds:
  `minigun_ready` as the lock warning, `tower_aoe` for the shell. Probe:
  `guard=state:shots` (drive), `guards=` (world). Not damageable yet.
- FEAR RULES (operator): `threat = { x, z, moving }` is passed for EVERY
  crew now. A moving tank scares everyone inside `fleeM`: the enemy's
  crew runs or cowers (coin), ours always runs and never cowers, and ours
  stops fearing the moment the tank stops (`moving: false`); a walker on
  a mission (`goal`) or already `boarding` ignores it. Stranded crews
  board a STOPPED friendly tank (rescue.js); rescued ones go into the
  infirmary and stay.
- CAPTURE THE FLAG (`ctf.js`, `test/ctf.mjs`; kit `assets/flags/`, all
  six banners, three poles and the socket vendored): the generator's
  `stepFlags` places a 3 x 1 `ctf_stand` PROP beside a road near the
  centre (`plate.flags.poles`, slot 1 then slot 2, a cell apart; the
  scene draws nothing for it, the tab stands the kit's units). Slot 1 is
  FIRE (`flag_ember`, the kit's 火), slot 2 POWER (`flag_vanguard`, 力).
  Home holds fire, its power pole empty; the enemy the reverse. A hull
  STOPPED within `captureM` 7 m of the enemy's full pole takes the flag
  (carried on the hull: `makeCarriedFlag`); stopped by our empty pole it
  plants it (`Raise` clip): `ctf.won`, `winBonus` 1000. `makeFlagStand`
  draws a banner unit (Flutter looping) or a bare pole per slot. HUD
  leads with the flag state; probe `flag=theirs|carried|won`;
  `?ctfprobe=1&tick=8` ends `flag=won score=1000`. The drive tab has the
  enemy stand only (capture, no home to plant).
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

## Battlezone (operator, 2026-09-07)
- TWO LOOKS in `looks.js`, `?look=battlezone` (default while it is tried)
  or `?look=colony`; the panels' `look` dropdown reloads with the param.
  `BZ` is the switch; `PALETTE` is the active palette (tracers, shells,
  arcs, blind markers, section colours all read from it).
- Battlezone: black fills (`BZ_BLACK`, they occlude), green edges
  (`styleForLook` = addEdgeOutlines at 28 degrees), skinned meshes as green
  wireframe because edge lines cannot follow bones. Instanced pieces get
  their edges BAKED once per instance into one LineSegments (`bakeEdges`).
  No ladder, no metal, no tint in this look. The TD bloom stays.
- DESTRUCTIBLE BUILDINGS: `damageAt(plate, x, z, destructible)` — the tabs
  pass a predicate from the catalog (states 1 and 3 modelled), so the
  outpost's twelve and the standard wall take damage; `hitsPerState` is 1
  for a wall, footprint/6 for a building. D3 is rubble: driveable, no
  longer stops sentry rounds or blocks sight. The scene's static layer
  (`rig.rebuild()`) redraws walls AND buildings at their states.
- Road decks sit 6 cm proud of the slab (`ROAD_LIFT`): coplanar they moire.

## Modelled only (operator, 2026-09-07)
- The generator places ONLY ids in `allowed` (`generatePlate(params, allowed)`,
  default `MODELLED` in plate.js; the tabs pass `modelledIds(catalog)`).
  `test/catalog.mjs` asserts MODELLED is inside the live catalog. Zone lists
  are modelled ids only; road junctions and the sentry socket are structural
  and exempt. The scene draws NOTHING for a placeholder except the socket's
  plinth.
- THE LANDMARK: `personnel_infirmary` goes first, into the largest non-command
  block, once per plate (`stepLandmark`), and wears a `roofCross` in
  `PALETTE.cross`. A plate under 400 interior cells skips it silently.
- CONTAINER YARDS: `NO_LANE` / `NO_ROAD` ids (the container) pack with gap 0,
  beside their own kind first, keeping the block's first orientation. A
  cramped yard may still hold one per orientation; the test is a rate.
- meshopt-encoded models load INTERLEAVED and `mergeGeometries` refuses them,
  so `mergeByMaterial` de-interleaves first (glbmodels.js). Five casts were
  silently missing before that.

## Open: a better container (operator, 2026-09-06 late)
- The reference container.glb is corrugated; in battlezone its ribs make
  edge lines centimetres apart and a yard of them blooms into a white slab.
  `BZ_OVERRIDES['container.glb']` (looks.js) tames it for now — sparser
  edges, dim line, half opacity. WANTED: a container authored for the vector
  look (flat panels, few edges), or the outpost kit's container tried in its
  place (it has four damage states already). Same applies to any dense
  model that lands here.

## Assembly line, crew, ballistics (operator, 2026-09-07)
- `assets/assembly/` is the workshop's assembly-line kit: six ids in four
  states (24 GLBs, 27 MB); the six joined `base-assets.md` under "Assembly"
  (117 rows). `LOOP_IDS` (line, arm, conveyor) carry an `Assembly_Cycle`
  clip and are drawn as looping clones (`rig.loopRigs`), never instanced.
  The line is the SECOND LANDMARK (`LANDMARKS`): 5 x 8 cells with a one-cell
  lane into the largest block left — with a two-cell lane it never fit.
- THE STATIC LAYER SWAPS, never empties: `drawStatic` builds the next set
  and replaces the old one when every model resolved. Emptying first made
  every wall vanish for a frame while a damaged state's model downloaded
  (operator: "all the walls flicker").
- THE CREW: orange suits (`SUIT`), bloom group `crew` at weight 0 so they
  never glow. They walk between `keyAreas` (building fronts, gates, the
  infirmary), run 15% of trips, and FLEE an enemy hull inside `fleeM` —
  straight away by `fleePoint`, else to a key area on the far side, never
  past the threat; cornered, they stay. `stepSquash`: a hull moving over
  `squashSpeed` within hullR + 0.6 m kills a walker and `makeSplat` lays a
  red blot. A crew fears the hull only on the hostile plate; the hull
  squashes anyone anywhere. The chase camera backs off only over clear
  ground (a hull just outside a gate had the camera inside the gate).
- CREW COLLISION: the cells do not know the containers (makeBodies frees
  their cells) or the hull, so the tabs pass `solid(x, z)` (`bodyAt` plus
  `hullCovers`, the MKCX as a 8 x 3.8 m box turned by heading) into
  `makeCrew` / `stepCrew`. `crewFreeAt` tests a walker's disc (radius
  0.35) against cells AND solids; trips slide along an obstacle or are
  given up; something rolling onto a walker slowly shoves them out
  (`escape`), fast squashes them. Probe lines carry `crewIn=` (must be 0).
- SOFT BODIES: `shotHits(crew, x, z, y)` (a shell within `softR` 0.9 m and
  under `softH`) and `splashHits(crew, x, z)` (`splashR` 3 m at a shell or
  lob landing) kill walkers; the tabs then `sfx.softHit(point, dist,
  normal)`: one of `DEATH_KEYS` at random, the two-colour suit-and-blood
  dot burst (`makeSoftBurst`), the light recipe's flash; a direct hit also
  lands the shell blast and stops the shell. The run-over gets the same
  `softHit`. crew-scene lays the splat for ANY dead walker. HUD and probe:
  `crew down` / `down=`.
- BALLISTICS: a hull shot leaves at `shotSpeed` and `hull.elev` degrees
  (SHIFT+W / SHIFT+S, `elevRate`, stops `elevMin..elevMax`), falls under
  `gravity`, lands on `groundY` or stops on a solid it does not clear
  (`solidHeightAt`, `SOLID_HEIGHT`); `shotRangeFor` is the HUD's range read.
  `shotRange` is a safety cap only. The barrel pitches (`Barrel_Pivot` is a
  hull pivot now). `?elev=N` sets a probe's muzzle.

## Phone shell and PWA (2026-09-07)
- `mobileShell` (drive-rig.js): coarse pointer and short side < 900, or
  `?mobile=1`. `makeMobileShell` adds the stick (left half, `stick.js`) and
  the thumbs; it writes `keys.extra` (throttle, left, right, fire, elevUp,
  elevDown) which `input()` merges over the keys. `input.throttle` scales
  speed in `stepHull`. `body.mobile-shell` CSS: compact HUD, panel behind
  `#gear`. Probe: `?mobile=1` at 844x390 headless.
- PWA: `sw.js` is a runtime cache keyed on `CB_TOKEN` (bust.sh stamps it;
  `test/pwa.mjs` asserts it equals the meta token); no precache; no
  skipWaiting without the player's tap on the nav's update button.
  `manifest.webmanifest`, `icons/` (hand-written PNGs), iOS tags in the head.
- DEVLOG.md: per-commit entries, newest first, in the reference's style —
  get the hash first, then append. `.deban/` is the local decision vault
  (gitignored): sync it after meaningful sessions.

## Sound and impacts (2026-09-07)
- `sfx.js` is the only file that knows what the game sounds like; audio.js,
  audiomix.js, audiogate.js are the reference's engine, copied. Keys:
  `tank_main`, `tank_thruster` (a loop set from speed), `SENTRY_FIRE[family]`
  with `dist`, `assembly_hydraulics` (a loop per machine; the electric hum was cut as a modem,
  faded by distance), `impact_shell` / `impact_rubble` / `impact_hit`.
  `DISTANCE_K` is 45 METRES. The context needs a gesture (`arm()`).
- Impacts: `sfx.impact(recipe, point, normal, dist, size, sound)` wraps
  impactfx.js's `makeImpactBurst` + `orientImpact`; groups tick in `sfx.tick`.
  Sizes: shell 2.6, breach 4.5, lob landing 3.2, hull hit 2.
- Lob shells call `blockedRay(tx, tz, t)` with `t.landed` on landing so a tab
  can draw and play it. `?autofire=1` fires live; `fx=` in the drive probe.
- The engine is THREE sounds (`sfx.engine(speed, max, dt)`): `tank_spool_up`
  the frame the smoothed level passes 0.03, the thruster bed while moving,
  `tank_spool_down` after 0.10 s still, which also lands the feel. The feel
  (`tankfeel.js`, copied) rides `sfx.feel`; `sfx.applyFeel(hullObj)` every
  frame after `setPose`. `makeHullObject` builds the reference's hover split
  (HoverEmitters planted, Hover_Gear drops, HoverBody rises 0.095 m, HullVib
  and Weapons take the vibration, Turret_Pivot the recoil slide).
- `#sounds` is the Sound Lab: `soundlab.js` (pure) lists every element and
  event with its clip, `wired` / `clip unused` / `MISSING` plus a brief for
  each gap; `test/soundlab.mjs` fails on a key the manifest lacks or a
  manifest key no element claims. Add a row when adding a sound, and set
  `wired: true` only when game code fires it. Probe line: `[soundlab] ...`.

## Verify
- `npm run serve` then `http://localhost:8150/#plate?seed=7&ascii=1`.
  `?seed= ?w= ?h= ?gates= ?arc= ?density= ?tier=` override the knobs;
  `?ascii=1` logs the map. `window.__plate` is the current Plate.
- `node scripts/headless-wait.mjs --url ... --seconds 12 --size 1280x800
  --swiftshader --out shot.png` for a screenshot.
