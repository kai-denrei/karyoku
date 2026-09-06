#!/bin/sh
# check-tokens.sh — cache-bust token guard.
#
# Two failure modes this repo keeps hitting (see CLAUDE.md):
#   1) split tokens — a partial commit after scripts/bust.sh leaves asset
#      files at different ?v= values, so a client can serve a stale module
#      alongside fresh ones. bust.sh stamps ONE token per run, so a healthy
#      tree has exactly one distinct ?v= value.
#   2) tokened vendor import — a ?v= on a ../vendor/ path makes the browser
#      load a second copy of three.js (the "multiple instances" bug); vendor
#      imports must stay token-free.
#
# Exits non-zero (with a report) on either. Run it by hand before a push, or
# let .githooks/pre-push run it for you (git config core.hooksPath .githooks).

root=$(git rev-parse --show-toplevel) || exit 2
cd "$root" || exit 2
fail=0

# 1. no ?v= on any vendor/ import
vend=$(grep -rnE "vendor/[^'\"]*\?v=" --include='*.js' --include='*.html' \
  --exclude-dir=.git --exclude-dir=.claude . 2>/dev/null)
if [ -n "$vend" ]; then
  echo "✗ tokened vendor import (a ?v= on vendor/ loads a 2nd copy of three.js):"
  echo "$vend"
  fail=1
fi

# 1b. no EMPTY token. `./x.js?v=` and `./x.js?v=abc` are two different URLs, so
# an empty one loads a second copy exactly as an absent one does — but it LOOKS
# tokened, so the mutable-state check below waves it through and the agreement
# check never sees it (its pattern needs at least one hex digit). Found the
# hard way: a hand-written import left `?v=` bare, every guard passed, and the
# page would have loaded two copies of towers.js.
empty=$(grep -rnE "\?v=(['\"]|$|&)" --include='*.js' --include='*.html' \
  --exclude-dir=vendor --exclude-dir=minigames . 2>/dev/null || true)
if [ -n "$empty" ]; then
  echo "✗ an EMPTY ?v= token — that is still a distinct URL, so it loads a 2nd copy:"
  echo "$empty"
  exit 1
fi

# 2. every ?v= cache-bust token must agree
# .claude/worktrees holds SEPARATE checkouts, each legitimately stamped with
# its own token — scanning them reports a split that isn't one, and would
# block a push on the state of an unrelated worktree.
toks=$(grep -rhoE "\?v=[0-9a-f]+" --include='*.js' --include='*.html' \
  --exclude-dir=vendor --exclude-dir=docs --exclude-dir=.git --exclude-dir=.claude \
  . 2>/dev/null | sort -u)
n=$(printf '%s\n' "$toks" | grep -c .)
if [ "$n" -gt 1 ]; then
  echo "✗ split cache-bust tokens — $n distinct values in the tree:"
  printf '   %s\n' "$toks"
  echo "  fix: ./scripts/bust.sh --quiet && git add -A   (commit ALL of bust's output)"
  fail=1
fi

# 3. A MODULE WITH MUTABLE STATE MUST BE IMPORTED ONE WAY.
#
# `?v=` on an import specifier is part of the URL, so `./x.js` and
# `./x.js?v=abc` are two different modules to the browser and it loads BOTH.
# For a pure module that is only wasted bytes, and ~27 of them are split that
# way in this tree already. For a module that holds mutable module-level
# state — anything with an exported `let` — it is a correctness bug, and a
# silent one: the writer sets a value on one instance and the reader sees the
# default on the other. That is exactly how the second tower roster failed
# first time out (roster.js switched a copy of towers.js that nothing else
# was using, and the board came up as the campaign).
#
# bust.sh only UPDATES tokens, never adds them, so an untokened import stays
# untokened forever and nothing else notices.
mut=""
for f in src/*.js; do
  grep -qE "^export let " "$f" || continue
  base=$(basename "$f")
  # imported WITH a token anywhere, and WITHOUT one anywhere
  with=$(grep -rlE "(from|import) '\./${base}\?v=" --include='*.js' src/ 2>/dev/null || true)
  without=$(grep -rlE "(from|import) '\./${base}'" --include='*.js' src/ 2>/dev/null || true)
  if [ -n "$with" ] && [ -n "$without" ]; then
    mut="${mut}   ${base} (exports mutable state)\n     tokened  : $(echo "$with" | tr '\n' ' ')\n     untokened: $(echo "$without" | tr '\n' ' ')\n"
  fi
done
if [ -n "$mut" ]; then
  echo "✗ a module with MUTABLE state is imported both with and without ?v= —"
  echo "  the browser loads two copies and the write lands on the wrong one:"
  printf "%b" "$mut"
  echo "  fix: give every import of it the same specifier (tokened)."
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "✓ cache-bust tokens OK (${toks:-none})"
fi
exit "$fail"
