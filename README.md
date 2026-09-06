# karyoku

Homage to Firepower (Amiga). Procedural military bases on flat 4 m plates,
organic Stålberg terrain between them. Vanilla ES modules, three.js r160,
no build step.

Design: `docs/superpowers/specs/2026-09-06-plate-generator-design.md`.
Working notes for agents: `CLAUDE.md`.

The `#plate` tab generates a base from a seed: wall ring with gates, road
spine, functional blocks packed from the asset catalog, sentry sockets with
limited arcs (green markers show ring cells no sentry can bear on). Kit
models render where they exist; everything else is a labelled placeholder.

    npm run serve        # http://localhost:8150/#plate
    npm test             # Node invariant suites
    ./scripts/bust.sh    # bump cache-bust tokens after editing src/, HTML, CSS
