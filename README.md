# karyoku

Homage to Firepower (Amiga). Procedural military bases on flat 4 m plates,
organic Stålberg terrain between them. Vanilla ES modules, three.js r160,
no build step.

Public: <https://kai-denrei.github.io/karyoku/> (GitHub Pages, `max-age=600`
CDN lag; the build token in the nav bar says which build is served).

Design: `docs/superpowers/specs/2026-09-06-plate-generator-design.md`.
Working notes for agents: `CLAUDE.md`.

The `#plate` tab generates a base from a seed: wall ring with gates, road
spine, functional blocks packed from the asset catalog, sentry sockets with
limited arcs (green markers show ring cells no sentry can bear on). Kit
models render where they exist; everything else is a labelled placeholder.

The `#drive` tab puts the MKCX-2 outside the first gate. WASD drives, the
gate opens on approach, the sentries sweep their arcs and fire tracers at
what they can see, and the HUD counts the rounds that would have hit. C
switches between the top-down and orbit cameras.

The `#world` tab is the whole PoC: two plates on organic Stalberg terrain,
a dirt road found between their facing gates, trees and rocks. Drive from
plate A's gate to plate B's. `?view=overview` shows it all from above.

    npm run serve        # http://localhost:8150/#plate
    npm test             # Node invariant suites
    ./scripts/bust.sh    # bump cache-bust tokens after editing src/, HTML, CSS
