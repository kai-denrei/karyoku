# Dev Log

Newest first. Each entry: what landed, then how it works, for programmers.
Decisions and dead ends in more detail live in `.deban/` (local, not
published).

## df02eb7 — the station crew

The workshop's three station characters replace the compact astronaut:
astronaut, scientist and worker, fifteen hundred triangles each against
the old ninety-five thousand, one skin, seven clips (Idle, Walk, Run,
Kneel, Scared, Point, Lie). Each model loads once and every walker is a
bone-rebinding clone of it (the SkeletonUtils recipe, written here since
it is not vendored); the walker's `act` picks the clip and the weights
crossfade in a fifth of a second.

They are livelier now. Walkers cycle the three kinds. Arriving at a
building's front, a walker may point at it for a few seconds (the key
areas now carry what they face) or kneel as if checking something. A
tank inside the flee radius is a coin toss: run for a far key area, or
freeze and cower facing it until it leaves, and a cowering walker whose
tank comes inside nine metres breaks and runs. Walkers keep nine tenths
of a metre apart by a pairwise push onto free ground, so a crowd at a
gate no longer stands inside itself, and they still slide around
containers, the tank and every wall. The dead lie where they fell, on
the red splash, in the Lie clip clamped at its end. The suite watches a
crew for three simulated minutes and asserts it walked, ran, pointed and
knelt, kept apart, answered a threat both ways across six walkers, and
lay down when run over.

## 8b1cc57 — one scene render, and the freeze

THE FREEZE. Felling the power station in the world stopped the game: the
power-down block in the world tab's step called a distance helper
declared later in the same function (a `const` in its dead zone) and used
the cell size without importing it, so from that frame on every frame
threw before it rendered. Both fixed; `?killpower=N` fells plate N's
station after two seconds and the probe line keeps coming with `power=off`.

ONE RENDER, NOT TWO. The reference's per-group bloom rendered the scene
twice a frame: once with every colour scaled by its group's weight (the
bloom source) and once plain. On a 120-cell plate that doubled five
thousand draw calls, and it swept every material twice a frame. The
weight now rides in the ALPHA of the one plain render: an opaque
material's opacity is written to the target's alpha untouched (nothing
blends an opaque draw), so opacity is the weight and costs nothing
visible; the bloom source is rgb times alpha in one full-screen pass;
transparent materials are set to leave the destination alpha alone and
inherit the weight of whatever they are drawn over, so a wall's edges glow
like the wall and the tank's like the tank. Weights are swept into the
materials every thirty frames for objects that arrived since. Three
composers now: base (with MSAA), bloom, final. At 120 x 90 the draw calls
went from 5.5k to 2.3k and the triangles from 35 M to 14 M a frame.

## 7d52ad2 — five cues from the operator's clips

The hull now reports two things the sound layer hangs on: `bump`, the
speed it was doing when a solid stopped it dead this step (a slide along
a wall is not a bump), and `elevating`, whether the muzzle actually moved
(held at a stop it did not). The bump plays the wall clip with gain
following the speed; elevating loops the muffled gears while the key is
held. A body touched at any real speed reports `touched` once per half
second, and the tab plays ONE thud out of twelve: the operator's thud file
holds a dozen, found by silence detection, and audio.js learned
`duration` beside `offset` so a voice can play a slice. A camera change
clicks like a cassette deck's stop button, and a sentry round on the hull
is the metal-hit clip now. The lab counts 35 wired, 6 unused, 16 missing.

## eacf40d — the power compound, the warehouse yards, and tiles you can hide

THE POWER. Every base now has a walled compound at its centre: an 8 x 6
ring of the kit's wall with one vehicle gate toward the block's road, and
inside it the solar kit's power station (2 x 2 cells) at the back with
three panel racks. It is laid first, into the block nearest the plate's
centre, so the rest of the plate packs around it; the gate's approach is
reserved foundation, because yard stock packs with no gap and the first
cut boxed the gate in on a dozen seeds. The scene strings a sagging cable
from the station's roof to every sentry's head. Three hull rounds put the
station at D3, and `powered(plate)` goes false: every sentry stops
tracking and firing, the cables go dark, the heads droop and dim. A
narrow plate (interior under 14 cells) skips the compound silently; the
assembly line loses its block to the compound on two default seeds and
the test now allows three of fifty.

THE WAREHOUSE. The workshop's crates, secure cases, fuel barrels, pallet
stacks and armored container replace every container and box we had: the
armored container is `logistics_container` now (plot 2 x 1, the old
corrugated cast and the outpost's container are gone), the other four are
new ids in the yards and the band. All five are BODIES: the drive shoves
them, and now breaks them. A shell steps a body one state (the container
two rounds a state), a ram at crush speed does the same once per touch,
and state 3 is death: debris, not solid, drawn as the kit's destroyed
model. A barrel dies like a sentry. Body boxes come from the kit's own
colliders rather than the plot.

FEWER TRIANGLES. The perf probe named the cost at 120 x 90 cells: 430
separate corrugated containers, 486 antenna stand-ins from the prop rate,
780 wall segments, and a composer that renders the scene twice. Bodies
are instanced now (one InstancedMesh per part per model and state, the
matrices rewritten for whoever moved, battlezone edges rebaked); the
static and body layers are instanced per 128 m TILE as well, and
`rig.cull` hides tiles, sentries, loop rigs and walkers farther than 260 m
from the camera (the overview sees all); props are capped at six a block.
Objects at 120 x 90 went from 11.2k to about 3k and triangles from 61 M
to 35 M in the colony look. The composer's double render and the 95k
triangle astronaut are the next levers.

## 7f77bd7 — sentries break, and stay broken

Three hull rounds on a sentry's socket break it (`sentryHits`, a knob).
`damageSentryAt` (drive.js) resolves a socket cell to its sentry through
the plate's sentry records, counts the round, and at the third marks it
dead: `stepSentries` skips a dead one (no tracking, no fire), and its
cell's solid height drops from 5 m to a 1.6 m wreck, so the next shell
flies over it and lands on whatever stood behind. The socket still blocks
the hull: a wreck is a wreck, not a road.

The explosion is the full shell recipe twice, big at the head and smaller
at the plinth (that one lays the scorch), with the reference's tank death
as the blast. And the tower does not vanish: the scene's `breakSentry`
keeps the plinth and the base, knocks the head (everything under YAW) off
its bearing backward into the band, on its side with the barrel drooped,
rests it on the ground by its measured bounding box, and darkens it (a
third of its colour, no emissive; dimmed lines in battlezone). Two things
that went wrong on the way: the yaw node's frame is scaled by the socket
fit, so metres set on it went several times too far (divided by the world
scale now); and a probe breaks the sentry before its model has loaded, so
the scene remembers broken indices and poses the wreck when the model
arrives. Sideways was the first fall direction, and a corner sentry's head
went through the ring wall; backward into the band is always clear.
`?aim=sentry` parks a probe behind the first sentry, inside the ring;
`sentriesDown=` on the probe lines, `sentries N/M` on the HUD, and the
lab lists the blast as wired and a heavier clang for a standing hit as a gap.

## 48efa34 — the soft bodies

The reference's hit on a soft creature, brought across whole. There the
tank's shell one-shots anything below the heavy tier, and a death is
three things at once: one of three cries picked at random and faded by
distance, a tinted dot burst thrown flat against the surface from the
body, and the shell's own blast at the impact. Here the soft bodies are
the astronauts. `shotHits` (crew.js, pure) finds a live walker within
0.9 m of a shell in flight below 1.9 m and marks them dead; `splashHits`
kills everyone within 3 m of a shell or lob landing. The tabs stop the
shell on a direct hit, land the shell blast there, and call
`sfx.softHit`: the cry (`DEATH_KEYS`, the reference's three clips), the
burst (`makeSoftBurst`, the reference's makeDotBurst in metres, half the
dots in suit orange and half in blood red, the way its creatures flash
two hurt colours), and the light recipe's flash and spark so the strike
reads at range. The run-over gets the same cry and burst under the splat
it already left. crew-scene lays the splat for any dead walker whatever
killed them. The HUD counts `crew down`; the probe lines carry `down=`;
the Sound Lab lists the three cries as wired and keeps the crunch under a
run-over as a gap.

## f513ab7 — the crew stops walking through things

Astronauts walked through containers and through the tank. Two causes,
one shape: the crew tested walkability against the plate's CELLS, and the
cells do not know either. `makeBodies` frees a container's cells the
moment it becomes a pushable body (the hull needs that), and the hull is
a vehicle, not a cell. So the crew now takes `solid(x, z)`, a predicate
the tab composes from `bodyAt` and `hullCovers` (the MKCX as an oriented
8 x 3.8 m box), and every walkability test asks it: the trip pick, the
flee fan, the spawn, and each step. `crewFreeAt` tests a walker's DISC
(radius 0.35 m, centre and four points) rather than a point, so a walker
no longer clips the corner of a wall it walks past.

A trip that was clear when picked can close: a container gets pushed
across it, the hull parks on it. The step then slides along the obstacle
if that still gains ground on the target, else the walker gives the trip
up and picks another. And something that rolls onto a walker SLOWLY
shoves them: `escape` finds the nearest free ground in rings up to 3 m
and moves them there, alive; fast, `stepSquash` still leaves the splash.
The world tab composes the predicate per plate in plate metres (bodies
shifted by the plate's origin, the hull's heading carried across). The
probe lines carry `crewIn=`, the count of walkers inside a solid, and the
suite holds it at zero for ninety seconds with a box on the busiest road
cell and a hull parked on a key area.

## ee5219e — the Sound Lab, and the modem cut

`#sounds` is a table, not a canvas: `soundlab.js` (pure) lists every
element the game has (tank, sentries by family, impacts, gates, assembly
line, astronauts, containers, interface, world) and every event each one
makes, with the clip it plays. `labRows` resolves sentry rows through
`SENTRY_FIRE`, so the lab and the game cannot disagree about which round a
family fires, and gives each row a status: `wired` (the game fires it),
`clip unused` (we own it, nothing fires it), `MISSING` (no clip; the row
carries a brief for what it should sound like). The tab draws the rows
with a play or loop control per clip, a listener-distance slider through
the same inverse-distance falloff the game uses, the bus faders, and a
first-click arm. `test/soundlab.mjs` fails on a key the manifest lacks and
on a manifest key no element claims, so a new clip has to be placed on an
element and a deleted one cannot leave a row behind. First count: 19
wired, 7 unused, 20 missing over 46 events.

The assembly line's electric hum, built from the reference's dial-up
master, read as a modem and was jarring; it is gone from the manifest,
the mixer and the disk. The hydraulic bed stays. The lab lists the gap
with what a replacement wants to be (a clean transformer hum, no
modulation).

## 1ed0a42 — the engine as three sounds, and the hover feel

The reference's engine sequencing, replicated in `sfx.engine(speed, max,
dt)`: a smoothed level (spins up at 6/s, spools down at 2.5/s), a
`tank_spool_up` cue the frame the level passes 0.03, the thruster bed
while moving (retried every frame until decoded, then gain and rate follow
the level), and `tank_spool_down` once the hull has been still for 0.10 s.
The bed stops with the same fade so the two never overlap.

The feel (`tankfeel.js`, copied with its 64-check suite) rides the same
`running` flag: the hover timer lifts the body 0.095 m and drops the skirt
0.15 m against planted lift emitters, the hull idles with two
incommensurate vibrations while the weapons take three quarters of it, the
stop rocks the body with a decaying sway, and a shot slides the turret
back 0.5 m on a squared curve. For that, `makeHullObject` now builds the
reference's hover split after the merge: `HoverEmitters` (the six
`LiftEmitter_*` re-attached in world space), `Hover_Gear`, and a
`HoverBody` holding `HullVib` and `Weapons` (`Turret_Pivot` with its
`baseZ`, `Secondary_Turrets`). `setPose` still writes the root; the feel
writes the children, so they compose. The probe line prints `engine=`,
`hover=` and `bodyY=`, and is logged after `sync` so it reports what was
drawn.

## 0075ead — sound, and what a hit looks like

The reference's audio engine (`audio.js`, `audiomix.js`, `audiogate.js`)
came across verbatim with its tests; `audiomanifest.js` is cut to what
karyoku fires and extended. `sfx.js` is the one game-facing file: the
thruster bed is a LOOP whose gain and rate follow the throttle every frame
(a null handle means "not decoded yet", retried next frame — the
reference's lesson); the shot is `tank_main`; each sentry family fires its
own round through `SENTRY_FIRE`, faded by distance from the hull with the
falloff constant re-based to metres (45 m is half); the assembly machines
carry two faint beds, hydraulics and an electric hum built with ffmpeg
from the reference's masters, keyed per machine and faded by distance.
The context is born on a gesture, never at init, so a headless run shows a
healthy ledger and hears nothing.

Impacts are the reference's `impactfx.js` recipes: `shell` (flash, spark
shower, shockwave ring, debris chunks, scorch) at every strike, oriented
along the surface normal — the reverse of the shell's flight on a wall,
the ground's normal on a landing — and sized 2.6 for a 4 m cell; a breach
adds a bigger burst and the rubble sound; a lob landing gets the recipe
with the aoe thump; a sentry round on the hull gets the `light` recipe.
Battlezone colours the sparks green. `?autofire=1` keeps the gun firing
live for a probe, and `fx=` in the probe line counts live effects.


## e1e0581 — a hollow gantry

Operator's screenshot: one structure in the green look rendered as a
tangle, every edge from every side showing at once. The fill was not wrong,
it was ABSENT: the battlezone fill was a front-side-only black material, and
the NASA gantry is thin single-sided lattice panels (six other NASA models
are authored double-sided outright), so from most angles the faces were
culled and nothing occluded the lines behind them. A scan for mirrored
node transforms found none — it is the geometry, not the transforms.
`BZ_BLACK` is `DoubleSide` now; the cost is a few hundred thousand extra
back faces on a frame that draws lines anyway. `?at=x,z&heading=deg` park a
probe's hull anywhere, which is how the fix was photographed.


## ebb9e10 — a phone shell and an installable app

**The shell**, after the reference's mobile plan: on a coarse pointer with a
short side under 900 px (`?mobile=1|0` overrides), the drive and world tabs
grow a FLOATING STICK on the left half — touch anywhere, a ring appears
under the finger, drag to drive; the reference's `stick.js` is copied
verbatim with its test, pixels in, a throttle and two steer booleans out —
and four thumbs on the right: MUZZLE up and down held, CAM tapped, FIRE
held. The rules gained one thing: `input.throttle` (-rev..1) scales the
speed, so a half-pushed stick is half speed. The shell writes into the
keys' `extra` input, so drive.js never knows a phone from a keyboard. The
HUD shrinks to the numbers; the knob panel hides behind a `knobs` button.

**The app.** `manifest.webmanifest` (fullscreen, landscape, `#world` as the
start), icons drawn by a forty-line PNG writer (no Pillow on the machine),
the iOS head tags, and `sw.js` copied in shape from the reference: a RUNTIME
cache only — no precache list, this project's runtime is 70 MB of GLBs —
keyed on the build token, which `bust.sh` already stamped in `sw.js`;
`test/pwa.mjs` fails the suite if the worker's key and `index.html`'s token
ever differ. Navigations are network-first with a 3 s timeout, tokened
assets cache-first (a changed file is a changed URL), everything else
stale-while-revalidate. The worker never calls `skipWaiting()` on its own;
a new build shows `new build ready: reload` in the nav and waits.

Untested on a real device. The reference's own lesson stands: headless
clamps and crops, and "verified by feel" is not verified.


## ebc9452 — the assembly line, the crew in orange, ballistic shells, and why the walls flickered

Three operator asks and one report landed together.

**The assembly-line kit** (`assets/assembly/`, six ids in four states, 27 MB)
joined the catalog under a new "Assembly" section. Three of its ids carry an
`Assembly_Cycle` clip; `LOOP_IDS` in plate-scene.js draws them as their own
clones with a looping mixer, never instanced, and the tabs tick those rigs.
The line itself is 5 x 8 cells, and with the two-cell lane every building
gets it fit in none of eighty seeds — so it is the SECOND LANDMARK, placed
right after the infirmary into the largest block left, with a one-cell lane.
`test/plate.mjs` asserts one on every default plate.

**The crew** walks key areas now: `keyAreas(plate)` is the cell in front of
each building's entrance (its authored S face, turned by rot), the cell
inside each gate, and the infirmary's front. A trip is a run 15% of the
time. An enemy hull inside `fleeM` starts a flight: `fleePoint` tries 16, 10
and 6 m dashes across a fan away from the threat and takes the first clear
one; failing that, a key area on the far side — never an area past the
threat, which the first fallback did (traced: walkers ran 16 m, hit the base
wall, then ran back past the hull to a gate). Cornered walkers stay.
`stepSquash` kills a walker within hullR + 0.6 m of a hull doing over 2 m/s,
and `makeSplat` lays a red blot, in both looks. Suits are one orange; the
crew sits in a bloom group of weight zero, so they never glow.

**Ballistic shells.** `fireHull` leaves at `shotSpeed` along the heading and
`hull.elev` degrees up, from `muzzleY`; `stepTracers` integrates gravity and
lands the shell on `groundY(x, z)` or stops it on a solid it does not clear
(`solidHeightAt`: wall 3.2, gate 5.5, building 7, sentry 5, prop 1.5, body
4.2). SHIFT+W and SHIFT+S move the muzzle at `elevRate` inside the stops;
the barrel pivots (`Barrel_Pivot` kept through the merge). `shotRangeFor` is
the HUD's range read. The old 90 m range became a safety cap at 260 m,
because the test found it cutting a shell off in mid-air.

**The flicker.** Every damage state change blanked every wall for a frame:
the static layer emptied itself and re-added pieces as their models
resolved, and the first time a damaged state's model had to download that
gap was the whole download. `drawStatic` now builds the next set and swaps it
in when every model has resolved; a newer rebuild supersedes an older one
by generation.

Also: the chase camera backs off only over clear ground (a hull just outside
a gate had its camera inside the gate model).


## 5d68ba6 — bases from real assets only

The generator places only ids the catalog can draw: `generatePlate(params,
allowed)`, the tabs pass `modelledIds(catalog)`, and `MODELLED` in plate.js
is the Node default, asserted to be inside the live catalog. Zone lists were
rewritten to modelled ids. The Isolation Infirmary is the landmark: placed
first into the largest non-command block, once, with a `roofCross` sized to
its plot. Logistics yards pack containers with no lane, beside their own
kind and keeping the block's first orientation, so they line up in rows
(a rate across seeds, because a cramped yard may hold one per orientation).
A piece without a model draws nothing, except the sentry socket's plinth.

A hidden fault fell out: meshopt-encoded models load with INTERLEAVED
vertex buffers and `mergeGeometries` refuses them, so five casts had been
silently missing. `mergeByMaterial` de-interleaves first.


## f772bbc — a green vector look, and destructible buildings

`looks.js` holds two looks: colony (Tron over the TD board's light) and
battlezone (black fills that occlude, one green, every shape an edge).
`?look=` picks, the panels reload with it. Battlezone models are
`styleForLook`: black basic material, edges by `addEdgeOutlines` at 28
degrees; instanced pieces get their edges BAKED once per instance into one
`LineSegments` (`bakeEdges`). Skinned meshes cannot carry edge lines, so the
crew is wireframe. The corrugated container blooms into a slab at full edge
density; `BZ_OVERRIDES` gives it a 60 degree threshold, a dim line and half
the opacity — a better container is an open item.

`damageAt(plate, x, z, destructible)`: the tab decides what is destructible
from the catalog (states 1 and 3 modelled), so the outpost's twelve
buildings take rounds now — one per state for a wall, footprint / 6 for a
building. D3 is rubble: driveable, and neither sight nor sentry rounds stop
at it. Base size to 120 cells; a 120 x 120 plate generates in under four
seconds.

Road decks sat exactly at the slab's height and moiréd; roads are 6 cm proud.


## 36dedb7 — the research-outpost kit and the crew

Twelve outpost ids in four damage states (48 GLBs) vendored in the base-kit
manifest format; two research ids joined `base-assets.md`. The crew
(`crew.js`, `crew-scene.js`): the compact astronaut is skinned with 51 skins
and three Mixamo clips, so each walker is parsed fresh from one buffer
rather than cloned.


## bb529b3, c615146 — the yard, bodies, and a gate that never opened

Plates 40 x 32 with a two-cell lane around every building. Containers in the
perimeter band as BODIES: `makeBodies` frees their cells, `stepBodies`
settles the hull against them — a container gives way if nothing static or
no other body is behind it, else the hull stops. Shots stop on them and do no
harm. Every gate opens for the hull (operator: for now). The gate had never
animated: `mixer.setTime` on a paused action does nothing, and
`?gateprobe=1` showed `actionTime=0.00` at `open=1.00`; `setGateOpen` sets
the action's own clock and evaluates the mixer with a zero step.


## 8936ae2 — the TD board's light, bloom and metal

Verbatim from spherical-stalberg-grid: hemi 0xc8cfe0/0x555060 at 1.5, sun
0xffe8c8 1.1, fill 0x8a96c8 0.8, background 0x0d1017, no fog; `postfx.js`
copied whole (two composers, strength 0.3 / radius 0.5 / threshold 0.2,
MSAA back on the final pass) with `bloomweights.js` groups; `weathered.js`
and `materials.js` copied for the metal; `casts.js` is the recipe in one
place (prep by file, ladder tint, metal; the hull gets edge outlines first).
The reference container and the terraformer — the Stalheart — as house
casts.


## f9a0f59 — Tron surfaces, Battlezone wire

Dark facets under one `LineSegments` of every quad edge, orange on the
road; neon placeholders; tinted models by side; crystal spires and lichen
domes on the tree records; stars under the bloom threshold (over it they
bloom into squares); the dev server sends `no-cache` on everything.


## 014dec5 — Firepower's layout, and walls that come down

A plate has two rings when it can afford them: outer perimeter, empty band
(`moat`), base wall; gates on both rings share side and position with a
band road between; sockets on the outer corners, inner corners and
inner-gate flanks. `damageAt` steps a standard wall D0..D3; at D3
`blockedAt` lets the hull through. Plate A is home (gates open, sentries
silent), plate B hostile.


## 0f566f1, 7591a53 — feel, twice

Round one: 32 x 26 plates, chase camera, the hull tilted to the terrain
normal, mortars and howitzers lobbing ballistic shells with a ground shadow
and a splash, no moiré under plates. Round two: keys 1-4 for cameras, tank
speed and base/world size sliders, Space fires. The slopes were still
wrong: the hull stood on the smooth height function while the screen showed
an 11 m faceted mesh (up to 3 m apart), so `groundAt` reads the rendered
triangle through a quad bucket hash; and the relaxer folded the mesh at its
default side length (49 inverted, 200 concave quads) — matched to the
mesh's own mean edge, with the boundary pinned, there are none, by test.


## 2666543 — the PoC in three sub-projects

`#plate`: a seeded base generator (ring, gates, road spine, blocks, zones,
packing, sentry sockets with limited arcs) over a catalog transcribed from
`base-assets.md` and merged with the base kit's machine-readable manifest;
invariants over 50 seeds incl. a guaranteed blind approach;
`scripts/plate-verify.sh` diffs the browser's ASCII against Node's.
`#drive`: pure hull, gates, sentries with finite slew, tracers, sight.
`#world`: oskar-procedure's Stålberg kernel, a height FUNCTION masked flat
around two plates, a road found by Dijkstra over the quad graph, cover with
a spatial hash. North was made -Z before the first viewer so the 3D view
matches the map; the gate lane became metric (8 m) because a 4 m hull
cannot pass a 4 m lane; the kernel's CCW quads flip handedness when y
becomes z, so terrain triangles are emitted reversed.
