# karyoku — plate generator (sub-project 1 of 3)

Karyoku is an homage to Firepower (Amiga, 1980s): a tank, hostile military
bases, sentries with dead angles, destructible walls, people to rescue.
The world thesis is a contrast: organic Stålberg terrain between bases,
rectilinear human-made bases on top. A base is a flat armored **plate** on
a regular 4 m grid, so the asset catalog's rectangular footprints apply
exactly as written, and the plate's local space is flat whether it later
sits on a plane or on the spherical grid.

The proof of concept is decomposed into three sub-projects. This spec
designs the first in full and briefs the other two at the end so the
plate's output shape serves them.

1. **Plate generator** — this document.
2. **Drive** — the MKCX on the plate, gates, sentry arcs.
3. **World** — two plates on Stålberg terrain, a dirt road between them.

## Decisions taken during brainstorming (2026-09-06)

| Question | Decision |
| --- | --- |
| What must the PoC prove | The base generator, driven through. Enemies beyond static sentries are out. |
| Map | Flat plane to start. Stålberg irregular grid for the organic terrain between bases. Bases are straight-lined plates. |
| Camera | Top-down for play, free orbit for inspecting the generator. Switchable. |
| Scope | Two plates and the terrain between them, across three sub-projects. |
| Sentries | Limited traverse arcs with visible dead angles. No aimbots. No damage in the PoC. |
| Generator | Zone-and-grow with a road spine. ASCII map as debug output and test format. |

## Project shape

- New repo `karyoku` on the `kai-denrei` GitHub account, published on
  GitHub Pages.
- Stack identical to `spherical-stalberg-grid`: vanilla ES modules, no build
  step, three.js r160 vendored by copying that project's `vendor/` folder
  verbatim, hand-written DOM plus `lil-gui` for the knob panel, Node `.mjs`
  test suites chained in `package.json`, `scripts/bust.sh` and
  `scripts/check-tokens.sh` copied and wired to a pre-push hook.
- House rules carried over: no emoji, monochrome dingbats only; no
  `Math.random` in generator logic, everything seeds from `mulberry32`; pure
  logic is DOM-free and Node-tested, tabs own rendering.
- Modules copied verbatim from the reference: `rng.js`, `vec3.js`,
  `knobs.js`, `glbmodels.js`. Nothing from `td-tab.js`.
- One tab at first: `#plate`.

## Catalog

`src/catalog.js` exports one list of asset definitions merged from two
sources.

**Source A: the base-kit manifest.** `assets/base-kit/manifest.json` and its
GLBs are vendored from `https://jelaludo.github.io/SentryTowers_A6/assets/base-kit/`.
The manifest gives, per asset: `id` (with a `_d0`..`_d3` damage suffix),
`file`, `plot_m`, typed `sockets` (kind `wall` / `road` / `foundation` /
`support`, with position and normal), `colliders`, `clearance`, and
`animations` (the vehicle gate carries `Gate_Open`). Units are metres,
`+Y` up, `+Z` forward. Seven pieces exist today: `wall_standard` in all four
states, `wall_corner_d0`, `gate_vehicle_d0`, `foundation_flat_d0`.

**Source B: the spec table.** `src/catalog-spec.js` transcribes
`base-assets.md`: for each of the 109 types, `id`, `plot` in cells (X by Z),
`section` (ground, road, perimeter, defense, command, personnel, logistics,
industry, utility, air, field, prop), and `ports` derived from the table's
placement logic (`wall`, `road`, `walk`, `roof`, `none`).

**Merge rule.** The spec table is the master list. A manifest entry attaches
`file`, sockets, colliders and animations to its spec row by id, and the set
of available damage states is whatever the manifest lists. A row with no
manifest entry is a **placeholder**: rendered as a box of its footprint,
height by section (walls 3.2 m, buildings 6 m, props 1.5 m, roads and ground
0.2 m), coloured by section, labelled with its id. When a model lands in
the kit, the manifest gains an entry and the placeholder disappears without
touching the generator.

**Scale.** One cell is 4 m. The manifest's `plot_m` divided by 4 must equal
the spec's `plot`; the catalog test asserts this for every merged entry
(the gate's `[12, 8]` m is the spec's 3 by 2).

**Sentries.** `defense_sentry_socket` receives one of the reference
project's eleven turret families at one of three tiers, loaded from
`assets/models/sentries/<family>_t<tier>.glb`, copied from the reference.
The Relay family is a mast, not a gun, and is excluded from sentry sockets.

## Generator

`src/plate.js`, pure, Node-tested. One function:

```
generatePlate(params) -> Plate
```

`params` come from a knob table (`PLATE_KNOBS` via `knobs.js`):

| Knob | Default | Range | Meaning |
| --- | --- | --- | --- |
| `seed` | 1 | integer | everything derives from it |
| `w`, `h` | 20, 16 | 12..40 | plate size in cells, including the wall ring |
| `gates` | 2 | 1..3 | vehicle gates in the ring |
| `arc` | 110 | 60..180 | sentry traverse arc in degrees |
| `density` | 0.7 | 0.3..1.0 | fraction of block area the packer tries to fill |
| `tier` | 1 | 1..3 | sentry tier |

**Steps, in order.** Each step only reads the plate state left by the ones
before it.

1. **Ring.** Perimeter cells become `wall_standard`; the four corners become
   `wall_corner`. Gates are placed on distinct sides chosen from the seed,
   centred on the side with a seeded offset, never within two cells of a
   corner. A gate replaces three wall cells (its 3 by 2 plot straddles the
   ring: one row is the wall line, one row is inside the plate) and records
   an inward road port. Gate centres sit at least six cells from a corner
   so the flank sentry sockets clear the corner sockets; a 12-cell side
   allows five, and there a flank that would overlap a corner socket is
   not placed.
2. **Roads.** A spine is laid through the plate centre: a cross of two
   road corridors, each 2 cells wide, spanning the plate interior. From each
   gate's road port a corridor runs straight inward until it meets the spine.
   A gate is 3 cells wide and a corridor 2, so the corridor starts at the
   gate's centre column rounded down to even; the gate's own plot covers
   the half-cell of mismatch.
   Road cells are resolved to `road_straight`, `road_corner`, `road_t`,
   `road_cross` by their neighbour mask; a corridor that stops short of the
   spine ends in `road_end`. Roads are 2 by 2 pieces, so corridors and the
   spine are laid on even cell coordinates.
3. **Blocks.** Interior cells not on a road flood-fill into rectangular
   blocks bounded by roads and the ring. Every road end is extended to the
   wall with 1 by 1 pedestrian corridor cells first, so a spine arm that
   stops a cell short cannot let two blocks merge. Zones are assigned in
   this order: the block nearest the plate centre is `command`; for each
   gate, the largest block beside its corridor is `logistics`; the largest
   remaining block is `air` if an 8 by 8 pad fits and `personnel`
   otherwise; the remaining blocks that touch the ring are `defense` or
   `utility` by seed, and the rest `personnel` or `industry` by seed.
4. **Packing.** Each block draws from its zone's building list, largest
   footprint first, placing at seeded positions inside the block where the
   piece fits and at least one edge of its plot touches a road cell. The
   packer stops when the block's filled fraction reaches `density` or no
   piece fits. Remaining cells take 1 by 1 props and crates from the zone's
   prop list at a seeded sparse rate, and the rest stay empty foundation.
   Rotation is chosen so the piece's entrance side faces the touching road.
5. **Sentries.** A `defense_sentry_socket` (2 by 2) is placed inside each
   ring corner and on both flanks of every gate, one cell in from the ring.
   These cells are reserved in step 3 before packing, so no packed piece
   ever occupies them and nothing is displaced here. Each
   socket gets a family drawn from the ten gun families, the `tier` knob,
   a yaw centre pointing outward (corner sentries face the diagonal, gate
   flanks face along the gate's road axis outward), and the `arc` knob.

**Dead angles by construction.** With `arc` at its default of 110 degrees a
corner sentry covers neither adjacent wall's midpoint, so on every default
plate there are perimeter cells no sentry can bear on. The invariant below
asserts this rather than trusting the arithmetic.

**Orientation.** North is -Z and east is +X, the three.js habit, so a
camera looking straight down with north up puts east on the right and the
3D view agrees with the ASCII map. The base kit labels its +Z socket "N";
that is a socket name, absorbed by the corner and gate rotations. `rot` is
quarter turns clockwise seen from above, applied as `rotation.y = -rot *
PI/2`. Yaw 0 is north, 90 is east.

**Output.** A `Plate` object:

```
{
  w, h, seed,
  cells:    Uint8Array (w*h) of cell kind: 0 foundation, 1 wall, 2 gate,
            3 road, 4 building, 5 prop, 6 sentry
  pieces:   [{ id, x, z, pw, ph, rot (0..3 quarter turns), state (0..3), zone,
              offset: [ox, oz] cells — the gate's is half a cell outward,
              because the kit's gate model puts the wall line through its centre }]
  roads:    { nodes: [cellIndex], edges: [[a, b]] }
  gates:    [{ x, z, side, rot, pieceIndex }]
  sentries: [{ x, z, family, tier, yawDeg, arcDeg, pieceIndex }]
  warnings: [string]
  ascii():  string, one char per cell
}
```

ASCII legend: `#` wall, `G` gate, `=` road or pedestrian corridor, `B`
building, `.` foundation, `o` prop, `S` sentry. Row 0 is the north edge. The ASCII map is what tests compare and what the
viewer's overlay shows.

**Failure policy.** A step that cannot satisfy its own rule (a gate that
does not fit on any side, a block too small for any building) records a
string in `warnings` and continues. `generatePlate` never throws on a valid
`params`. Invalid params are clamped by `knobs.js` before generation.

**Invariants** (`test/plate.mjs`, run over seeds 1..50 at default knobs and
at the four corners of the size range):

- Determinism: two calls with equal params produce equal `ascii()`.
- Sealed ring: every perimeter cell is wall, corner or gate.
- Gate count equals the knob, no gate within two cells of a corner, gates
  on distinct sides.
- No overlaps: each cell is claimed by at most one piece; every piece lies
  within the plate.
- Road graph connected, and every gate's road port is in it.
- Every building piece has at least one plot edge adjacent to a road cell.
- Every sentry socket is within one cell of the ring and its yaw centre
  points outward (dot product of yaw direction and outward normal positive).
- Blind approach: at default `arc` at least one perimeter cell lies outside
  every sentry's arc.
- Catalog consistency: every `pieces[].id` exists in the catalog; the
  manifest plot matches the spec plot for every merged entry.
- No warnings on the default seeds 1..50 at default knobs.

## Viewer

`src/plate-tab.js` owns rendering. It never computes layout.

- **Scene.** One slab mesh at the plate footprint, 0.4 m thick, foundation
  colour. Pieces placed from `plate.pieces`: a catalog entry with a file
  is loaded once through `glbmodels.loadGlb` and cloned per piece; walls
  are drawn with one `InstancedMesh` per merged material since a 20 by 16
  plate has around 70 of them at 5.8k triangles each. Placeholders are
  boxes with a text label on the top face. Sentries load their family GLB
  and set the yaw node to the socket's yaw centre; a translucent wedge on
  the ground shows the arc.
- **Camera.** `OrbitControls` from the vendor folder, target at plate
  centre. The top-down view of sub-project 2 is not built here.
- **Panel.** `lil-gui` with every `PLATE_KNOBS` entry, a regenerate
  button, a damage-state selector that sets every wall's `state` and swaps
  its model, and an ASCII overlay toggle that prints `plate.ascii()` in a
  monospace box over the canvas.
- **URL.** `?seed=`, `?w=`, `?h=`, `?gates=`, `?arc=` override the knobs
  at load, same pattern as the reference's tabs. `?ascii=1` logs the map to
  the console for headless checks.
- **Loading.** A missing or failed GLB resolves to null in `loadGlb`, and
  the piece falls back to its placeholder. A failed manifest fetch makes
  every piece a placeholder; the panel shows a one-line notice.

## Testing

- `npm test` runs `test/catalog.mjs` and `test/plate.mjs` in Node.
- Headless render check: Chrome with `--use-angle=swiftshader
  --enable-unsafe-swiftshader`, load `#plate?seed=7&ascii=1`, assert the
  console ASCII equals the Node output for the same seed. The capture
  helper is copied from the reference (`scripts/chrome-proc.mjs`) so the
  browser is always killed.

## Out of scope for this sub-project

Tank, driving, camera switching, gate animation, sentry fire, damage,
terrain, and any asset not in the kit or the reference project.

## Briefs for the next two sub-projects

**Drive (sub-project 2).** The MKCX-2 GLB from the reference is placed at a
gate's outer road port and driven with the flat XZ tank core from the
reference's `tanks.js` (heading, drive and reverse speeds, turn rate).
Collision is against `plate.cells`: wall, building and sentry cells block,
road and foundation cells are driveable, and gate cells are driveable only
while open. A gate opens when the hull enters its approach cells and plays
the manifest's `Gate_Open` clip. Camera is top-down with a slight tilt,
scrolling with the hull, with a key to switch to the orbit camera. Sentries
run the reference's `sentry.js` slew and envelope rules constrained to their
`arcDeg`: they track the hull only while it is inside the arc, slew at a
finite rate, and fire tracers on a fixed cadence with no damage. The
deliverable is a hull that can approach every default plate through a blind
angle.

**World (sub-project 3).** The 2D Stålberg grid kernel from
`oskar-procedure` (`grid.js`, `halfedge.js`, `dual.js`, `terrain.js`,
`biomes.js`, all pure) generates a terrain patch. It is rendered in three.js
here rather than through oskar-procedure's raw WebGL renderer. Two plates are
placed on flat-enough regions found by scanning the height field. A dirt
road is found, not drawn, as a path over the cell graph between the two
plates' gate ports, the same method as the reference's maze corridors. Trees
and rocks come from oskar-procedure's object records. The deliverable is
driving from plate A's gate to plate B's gate across organic ground.

## Firepower features and where they land

| Note from the Amiga game | Sub-project |
| --- | --- |
| Self-opening proximity gates | 2 |
| Sentries with avoidable firing patterns, limited angles | 1 places, 2 fires |
| Hide behind objects to avoid sentries | 1 and 2 |
| Destructible walls and buildings | 1 renders states; damage is later |
| Characters emerge from broken buildings, run over, red splat | later; exists in the reference's raid mission |
| Trees, hide under trees, destructible trees | 3 |
| Helicopters hunting tanks | later |
| Rescue, infirmary drop, flag capture, score | later |
| Tank lives, mines, radar, fuel | later; mines and radar exist in the reference |
