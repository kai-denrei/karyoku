#!/usr/bin/env bash
# nasa-prep.sh — turn NASA 3D Resources GLBs (Draco-compressed, sometimes
# 170k triangles) into what this project can load: Draco decoded, heavy
# meshes simplified, meshopt-encoded (vendor/meshopt_decoder handles that;
# nothing here decodes Draco at runtime). Run once per new model; the
# *.src.glb inputs are gitignored, the outputs are committed.
#   ./scripts/nasa-prep.sh            # all models below
set -euo pipefail
cd "$(dirname "$0")/../assets/models/nasa"
GT="npx -y @gltf-transform/cli"
prep() { # name ratio
  local n="$1" r="$2"
  [[ -f "$n.src.glb" ]] || { echo "skip $n (no source)"; return; }
  $GT optimize "$n.src.glb" "$n.glb" --compress meshopt --simplify true --simplify-ratio "$r" --simplify-error 0.01 --texture-compress false --join true --flatten true > /dev/null
  printf '%-10s %7d KB\n' "$n" $(( $(stat -f %z "$n.glb") / 1024 ))
}
prep gantry   0.15
prep insight  0.20
prep cubesat  0.50
prep launcher 0.60
prep ibex     0.60
prep habitat  1.0
