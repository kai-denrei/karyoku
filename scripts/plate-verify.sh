#!/usr/bin/env bash
# plate-verify.sh — the browser's plate is the Node plate. Generates seed N
# in Node, loads #plate?seed=N&ascii=1 headless, and diffs the two ASCII
# maps. Any drift means the tab is deciding layout, which it must never do.
set -euo pipefail
cd "$(dirname "$0")/.."
SEED="${1:-7}"
PORT="${PORT:-8150}"
TMP="${TMPDIR:-/tmp}"
node -e "import('./src/plate.js').then(m => console.log(m.generatePlate(m.makePlateParams({...m.PLATE_TUNE, seed: $SEED})).ascii()))" > "$TMP/karyoku-node.txt"
node scripts/headless-wait.mjs --url "http://localhost:$PORT/?seed=$SEED&ascii=1#plate" --seconds 8 --size 1280x800 --swiftshader --grep '\[plate\]|glbmodels|exception' 2>/dev/null \
  | tee "$TMP/karyoku-console.txt" | grep -E '^[#G=Bo.S]{12,}$' > "$TMP/karyoku-browser.txt" || true
if diff -q "$TMP/karyoku-node.txt" "$TMP/karyoku-browser.txt" > /dev/null; then
  echo "ok   browser plate == node plate (seed $SEED)"
  grep -E 'models|exception|failed' "$TMP/karyoku-console.txt" || true
else
  echo "FAIL browser plate != node plate (seed $SEED)"
  cat "$TMP/karyoku-console.txt"
  diff "$TMP/karyoku-node.txt" "$TMP/karyoku-browser.txt" || true
  exit 1
fi
