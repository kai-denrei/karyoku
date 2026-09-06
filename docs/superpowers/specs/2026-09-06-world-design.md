# karyoku — World (sub-project 3 of 3)

Two plates on organic Stålberg terrain with a dirt road found between
them. Drive from plate A's gate to plate B's gate. This is the contrast
thesis on screen: irregular quads, hills and trees between two
straight-lined human plates.

Brief: `2026-09-06-plate-generator-design.md`, "World". Reuses the plate
generator and the drive rules unchanged.

## Terrain (`src/world.js`, pure, Node-tested in `test/world.mjs`)

- **Grid.** oskar-procedure's 2D kernel, copied as `src/organic-grid.js`
  (with `poisson.js`, `hex.js`, `vec2.js`, vendored `delaunator.js` and
  `robust-predicates.js`): `generateMesh({ seed, r, k })` then `relax`.
  Vertices in [0,1]² are scaled to `size` metres.
- **Heights.** A continuous function, not a per-vertex table:
  `heightAt(x, z) = mask(x, z) * (amp * n1 + amp * 0.35 * n2)` with `n1`,
  `n2` two octaves of oskar-procedure's `valueNoise2D` (copied as
  `src/noise.js`) centred on zero, and `mask` the product over plates of
  `smoothstep(0, plateMargin, distance outside the plate's rectangle)`. The
  mesh samples the same function at its vertices, and the hull samples it
  directly, so the two never disagree by more than the mesh's own
  faceting. Under and around a plate the ground is exactly flat at 0.
- **Plates.** Two, `seed` and `seed + 1`, same size knobs, centred at
  (0.25, 0.5) and (0.75, 0.5) of the world. Each carries its world origin
  `ox, oz`, and its gates and sentries from `drive.js` shifted into world
  metres. Each plate's *facing gate* is the one whose centre is nearest the
  other plate.
- **Road.** Not drawn, found: Dijkstra over the quad graph (quads sharing
  an edge) from the quad nearest A's facing gate's outside point (three
  cells out along the side's normal) to the quad nearest B's. Edge cost is
  the centroid distance times `1 + slopeK * |dh| / distance`. Road quads
  are coloured dirt and carry no trees.
- **Trees and rocks.** Per quad not on the road, with mask at least 0.5 at
  its centroid, a seeded draw against `treeRate` scaled down by height
  places a tree at the centroid with jitter; `rockRate` likewise. Trunks
  (`trunkR`) and rocks (`rockR`) block the hull; canopies do not, so a hull
  can hide under a tree.
- **Blocking.** `worldBlocked(world, x, z)`: inside a plate's rectangle the
  plate's own `blockedAt` in local metres; elsewhere trunks and rocks
  through a 16 m spatial hash.
- **Spawn and goal.** Spawn at A's facing gate's outside point, heading
  away from A. Goal is B's facing gate's outside point; arrival is the
  hull within 8 m of it.

Knobs (`WORLD_TUNE`): `size` 560 m, `r` 0.04, `relaxIters` 40, `amp`
14 m, `freq1` 90 m, `freq2` 32 m, `plateMargin` 24 m, `slopeK` 6,
`treeRate` 0.35, `rockRate` 0.06, `trunkR` 0.9 m, `rockR` 2.2 m.

**Invariants:** deterministic per seed; more than 500 quads; the plates
lie inside the world and do not overlap; `heightAt` is 0 across each
plate's footprint; the road is non-empty, consecutive road quads share an
edge, its first centroid is within 30 m of A's outside point and its last
within 30 m of B's; no tree or rock stands on a road quad or inside a
plate's margin; `worldBlocked` is true on a plate's wall cell in world
coordinates and at a trunk, false on open ground; `heightAt` changes by
less than 1 m over a 1 m step.

## Tab (`src/world-tab.js`, `#world`)

- Terrain as one non-indexed `BufferGeometry` (six vertices per quad so a
  quad can carry its own colour), vertex colours by height, road quads
  dirt-brown, `computeVertexNormals` for a low-poly look.
- Trees: one `InstancedMesh` of cones (canopy) and one of cylinders
  (trunks). Rocks: one `InstancedMesh` of dodecahedra.
- Each plate: `buildPlateGroup` with animated gates, translated to its
  origin. Sentries and gates are stepped with the drive rules in world
  metres; sight and building checks use the owning plate's local frame.
- Hull, keys, tracers, cameras and HUD as the drive tab, through the
  shared `src/drive-rig.js`. The hull's `y` is `heightAt(x, z)`.
- HUD adds `goal Nm` and `ARRIVED` once the hull reaches the goal.
- `?tick=N` and `?probe=1` as the drive tab; the log line adds `goal=`.

## Out of scope

Terrain on the sphere, helicopters, destructible trees, fuel, sound.
