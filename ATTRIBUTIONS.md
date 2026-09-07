# Third-party assets

## A6 Fortification Lab — WALL KIT 01

- **Files:** `assets/base-kit/*.glb`, `assets/base-kit/manifest.json`
- **Source:** <https://jelaludo.github.io/SentryTowers_A6/base-kit/>
- **Author:** Jelaludo (the operator's own workshop). Vendored as part of
  the same body of work.

## Sentry Workshop turrets

- **Files:** `assets/models/sentries/*.glb`
- **Source:** <https://jelaludo.github.io/SentryTowers_A6/>
- **Author:** Jelaludo. Same terms.

## meshoptimizer — GLB decoder

- **File:** `vendor/meshopt_decoder.module.js`, MIT, by Arseny Kapoulkine.

## NASA 3D Resources — space-colony stand-ins

- **Files:** `assets/models/nasa/*.glb` (gantry, insight, ibex,
  launcher, radome, cubesat), mapped to catalog roles in
  `assets/models/nasa/manifest.json`
- **Source:** <https://github.com/nasa/NASA-3D-Resources> — Gantry, Habitat
  Demonstration Unit (part 1), InSight Cruise Lander (arm deployed),
  Interstellar Boundary Explorer (IBEX), Mobile Launcher (assembled), Radome,
  CubeSat 1RU Generic
- **Credit:** NASA
- **Terms:** *"These assets are free and without copyright."* Same three
  conditions as the reference project's dish: no insignia, no implied
  endorsement, no third-party rights. Embedded textures are the models' own
  material atlases (foil ramps, panel and AO maps, a station photo); none
  is a logo or wordmark by name, and nothing in the game claims a NASA
  association.
- **Processing:** `scripts/nasa-prep.sh` decodes the Draco originals
  (which the vendored loader cannot read), simplifies the two heaviest
  meshes, and re-encodes with meshopt. The Draco sources are not committed.

## Sound

- **Files:** `assets/audio/*.mp3`
- **Source:** the operator's own sample set from spherical-stalberg-grid
  (`assets/audio/src/` there keeps the masters, several from freesound.org
  with their ids in the file names: minigun 36769, minigun ready 244784).
  `assembly_hydraulics.mp3` is built here with
  ffmpeg from that set's hydraulic master (a dial-up build was tried and cut).

## Warehouse props and solar power (2026-09-07)

`assets/warehouse/` and `assets/solar/` are from the operator's workshop at
jelaludo.github.io/SentryTowers_A6 (warehouse-props: cargo crate, secure
case, fuel barrel, armored container, pallet stack; solar-power: the power
station and the panel rack), four damage states each, manifests in the
workshop's format with the armored container renamed to `logistics_container`.

`assets/audio/container_rumble.mp3` is the operator's clip
(metal-container-rumble-325675), low-passed, trimmed and quietened here.

Five more operator-supplied clips (2026-09-07), processed here (mono, some
low-passed or trimmed): `muzzle_gears.mp3` (bicycle gears in reverse,
100825), `ui_click.mp3` (cassette recorder stop button, 359987),
`hull_hit.mp3` (metal hit 12, 193278), `hull_wall.mp3` (hitting wall,
85571), `thuds.mp3` (thud_me, 70412: twelve thuds, sliced by offset).

## Station crew (2026-09-07)

`assets/crew/` is the workshop's station-crew kit at
jelaludo.github.io/SentryTowers_A6/station-crew (astronaut, scientist,
worker; rigged, seven clips each). The compact astronaut it replaces is
no longer in the repo.

`crush_slam.mp3` is the operator's door-close clip (universfield, 123784), trimmed and mono.

`assets/guard/` is the workshop's reckon-guard drone (jelaludo.github.io/SentryTowers_A6/reckon-guard), with its RotorSpin clip.

`assets/flags/` is the workshop's ctf-flags kit (jelaludo.github.io/SentryTowers_A6/ctf-flags): six banner units, three poles and the capture socket, all vendored for later use.
