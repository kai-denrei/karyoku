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

- **Files:** `assets/models/nasa/*.glb` (gantry, habitat, insight, ibex,
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
  `assembly_hydraulics.mp3` and `assembly_electric.mp3` are built here with
  ffmpeg from that set's hydraulic and dial-up masters.
