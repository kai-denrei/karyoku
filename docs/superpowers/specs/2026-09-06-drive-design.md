# karyoku — Drive (sub-project 2 of 3)

The MKCX-2 hover tank on a generated plate: driving, proximity gates, and
sentries that sweep limited arcs, track only what they can see inside the
arc, slew at a finite rate, and fire visible tracers. No damage. The
deliverable is a hull that can approach every default plate through a
blind angle, and a counter that says how many rounds would have hit.

Brief and decisions: `2026-09-06-plate-generator-design.md`, "Drive".
Reuses the plate generator unchanged; adds one pure module, one shared
scene builder, and one tab.

## Rules (`src/drive.js`, pure, Node-tested in `test/drive.mjs`)

All positions in **metres** on the plate's XZ plane; cells are `CELL_M`
(4 m). North is -Z, headings are compass degrees (0 N, 90 E). Everything
tunable is in `DRIVE_TUNE` with a `DRIVE_KNOBS` table.

| Knob | Default | Meaning |
| --- | --- | --- |
| `speed` | 12 m/s | forward |
| `reverse` | 6 m/s | backward |
| `turnRate` | 120 deg/s | heading change at full lever |
| `hullR` | 2.0 m | collision radius |
| `gateCells` | 3.5 | hull within this many cells of a gate centre opens it |
| `gateSecs` | 1.2 | full open or close takes this long |
| `yawRate` | 60 deg/s | sentry slew, the anti-aimbot number |
| `sweepRate` | 25 deg/s | idle sweep across the arc |
| `tolerance` | 3 deg | on-target error |
| `cooldown` | 0.9 s | between rounds |
| `fireCells` | 9 | engagement range |
| `tracerSpeed` | 40 m/s | |
| `hitR` | 2.4 m | a tracer passing this close to the hull centre is a hit |

**Hull.** `makeHull(x, z, heading)`; `stepHull(hull, input, dt, blocked, tune)`
where `input = { fwd, rev, left, right }` and `blocked(x, z)` answers in
metres. The hull turns, then moves along its heading; the move is accepted
if the four points at `hullR` around the new centre are free, else the x
move alone, else the z move alone, else it stops. Sliding along a wall is
what makes hugging cover possible.

**Occupancy.** `blockedAt(plate, gates, x, z)` in metres: outside the plate
is open ground; wall, building, sentry and prop cells block; a gate cell
blocks unless its gate is at least 0.95 open and the point is inside the
lane, 4 m either side of the gate axis (the kit's 8 m clearance); the rest
of the gate's cells are its towers; road and foundation are free.

**Gates.** `makeGates(plate)` gives `[{ side, cx, cz (metres), open: 0 }]`.
`stepGates(gates, hull, dt, tune)` moves each gate's `open` toward 1 while
the hull is within `gateCells` of its centre and toward 0 otherwise, at
`1 / gateSecs` per second.

**Sentries.** `makeSentries(plate)` gives per sentry `{ cx, cz, home
(yawDeg), arc, yaw: home, want: home, cool: 0, sweepDir: 1, tracking:
false }`. `stepSentries(sentries, hull, dt, los, tune)` per sentry:

1. Bearing and distance to the hull. `inArc` is `|wrap(bearing - home)| <=
   arc / 2`; `inRange` is distance within `fireCells`; `seen` is
   `los(cx, cz, hx, hz)`.
2. If all three: `tracking = true`, `want = bearing`. Else `tracking =
   false` and `want` sweeps between `home - arc/2` and `home + arc/2` at
   `sweepRate`, reversing at the ends.
3. `yaw` moves toward `want` by at most `yawRate * dt`, the short way, then
   is clamped into the arc. A sentry never points outside its arc.
4. If tracking, `|wrap(yaw - bearing)| <= tolerance` and `cool <= 0`: fire.
   `cool = cooldown`; a tracer `{ x, z, heading: yaw, left: fireCells *
   CELL_M }` is returned.

**Line of sight.** `losClear(plate, ax, az, bx, bz)` in metres samples the
segment every quarter cell; a building cell blocks. The ring wall does not:
the turrets stand above it and fire over it, so cover from sentries is a
building, and the wall's contribution is the arc geometry. Props, sentries
and gates do not block either.

**Tracers.** `stepTracers(tracers, hull, dt, blockedRay, tune)` advances
each by `tracerSpeed * dt`, removes it when `left <= 0` or `blockedRay`
says the new position is inside a building cell, and counts a hit
when the segment it moved along passes within `hitR` of the hull centre.
Returns the hit count for this step. Hits are a HUD number, not damage.

**Spawn.** `spawnFor(plate, gate)`: 5 cells outside the gate along its
side's outward normal, heading into the plate.

**Invariants** (`test/drive.mjs`):

- Heading 0 moves the hull toward -Z; heading 90 toward +X.
- A hull driving at a wall stops at `hullR` from it; driving diagonally
  into a wall slides along it.
- A closed gate blocks; the gate opens as the hull approaches within
  `gateCells` and is fully open after `gateSecs`; an open gate does not
  block; it closes after the hull leaves.
- A sentry with the hull outside its arc never sets `tracking` and its
  `yaw` stays inside the arc while sweeping.
- With the hull inside the arc and visible, `yaw` moves toward the bearing
  by exactly `yawRate * dt` per step until on target (no jump), and the
  first tracer appears only after `yaw` is within `tolerance`.
- A building between sentry and hull makes `losClear` false and the sentry
  does not track; the ring wall does not block sight.
- A tracer aimed at a building dies before crossing it; a tracer passing the
  hull inside `hitR` counts one hit.
- For every default seed 1..50, a hull parked on the plate's first blind
  ring cell (from `blindCells`) is tracked by no sentry.

## Scene (`src/plate-scene.js`, shared)

The rendering code now in `plate-tab.js` moves here unchanged in behaviour:
`buildPlateGroup({ plate, catalog, wallState, showArcs, showBlind }) ->
{ group, sentryYaws: Map<index, Object3D>, gateRigs: [{ index, obj, mixer,
action }], ready }`. Gates are loaded with their clips and merged with the
clip's track nodes kept as pivots (`GATE_SLAT_00..03`), one clone per gate,
never instanced. `plate-tab.js` becomes a thin panel over it.

## Tab (`src/drive-tab.js`, `#drive`)

- Same plate as `#plate` for the same URL params, plus the hull.
- **Hull model.** `assets/models/mkcx2.glb` copied from the reference:
  root `MKCX2_Root`, pivots `Turret_Pivot`, `Secondary_L_Pivot`,
  `Secondary_R_Pivot` kept, `Hull_Collision`, `Barrel_Glow_1`,
  `Barrel_Glow_2` dropped before the merge. Authored in metres, 7.8 m long,
  forward +Z, so `rotation.y = PI - heading`. Fallback: a 3 by 7 m box.
- **Input.** `w`/`ArrowUp` forward, `s`/`ArrowDown` reverse, `a`/`d` and
  left/right arrows turn, `c` toggles the camera, `r` regenerates with
  seed + 1.
- **Camera.** Top-down: position hull + (0, 70, 28), looking at the hull,
  so north is up and east is right. Orbit: `OrbitControls` with its target
  following the hull.
- **Sentries.** Each frame the YAW node gets `PI - yaw`. Tracers are 1.6 m
  emissive bars oriented along their heading, pooled.
- **Gates.** `action.time = open * clip.duration`, action paused.
- **HUD.** One line: `hits N · gates open/closed · cam top|orbit · WASD`.
- **Probes.** `?tick=N` advances the simulation N seconds with the lever
  forward from the spawn before the first frame and logs
  `[drive] t=N hull=x,z gate=open hits=N` for the headless check.
  `?probe=1` logs the same line every simulated second.

## Out of scope

Damage, tank weapons, enemies, terrain, touch controls, sound.
