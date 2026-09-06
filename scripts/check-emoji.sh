#!/usr/bin/env bash
# check-emoji.sh — NO EMOJI IN THIS PROJECT (operator, 2026-09-06: a chain
# emoji on the deep-link button "stands out in a bad way").
#
# The distinction is PRESENTATION, not Unicode block. The whole interface is
# built out of MONOCHROME dingbats — ⬢ ⬤ ✦ ⧉ ⇄ ♥ ⌖ ◉ ◈ ▮ ↗ ⊙ ↻ ♪ ⊘ — and those
# stay. What is banned is anything a platform renders as a COLOUR pictograph,
# because one of those in a terminal-green HUD is louder than every deliberate
# thing on the screen.
#
# THREE ENCODINGS, and the first sweep of this feature caught only one of them:
#   1. the literal character            🔗
#   2. an HTML numeric entity           &#128279;  &#x1F517;
#   3. a JS escape                      \u{1F517}  \uD83D\uDD17
# The button the operator actually complained about was written as (2), so a
# scan for (1) reported the project clean while the emoji was still on screen.
# U+FE0F is banned with them: it is invisible in a diff and it is exactly how a
# monochrome dingbat silently becomes an emoji.
set -euo pipefail
cd "$(dirname "$0")/.."
BAD=$(python3 - <<'PY'
import re, subprocess

LIT = re.compile(
  '[\U0001F000-\U0001FAFF]'          # pictographs, transport, supplemental symbols
  '|[\U0001F1E6-\U0001F1FF]'         # regional indicators (flags)
  '|\uFE0F'                          # the emoji-presentation selector itself
  '|[\u2600-\u27BF]\uFE0F'           # a dingbat forced to emoji presentation
)
ENT = re.compile(r'&#(x[0-9a-fA-F]+|\d+);')
ESC = re.compile(r'\\u\{([0-9a-fA-F]+)\}|\\u(d8[0-9a-f]{2}|D8[0-9A-F]{2})', re.I)

def banned(cp):
    return cp >= 0x1F000 or cp == 0xFE0F

files = subprocess.run(['git', 'ls-files'], capture_output=True, text=True).stdout.split()
SKIP = ('.png', '.jpg', '.jpeg', '.glb', '.mp3', '.ogg', '.wav',
        '.woff', '.woff2', '.ttf', '.zip', '.webm', '.mp4', '.ico')
out = []
for p in files:
    if p.endswith(SKIP) or p.startswith(('vendor/', 'minigames/')):
        continue
    if p == 'scripts/check-emoji.sh':      # this file names what it bans
        continue
    try:
        t = open(p, encoding='utf-8').read()
    except Exception:
        continue
    for i, line in enumerate(t.split('\n'), 1):
        for m in LIT.findall(line):
            out.append(f'{p}:{i}: literal {m!r}  {line.strip()[:80]}')
        for m in ENT.finditer(line):
            v = m.group(1)
            cp = int(v[1:], 16) if v[0] in 'xX' else int(v)
            if banned(cp):
                out.append(f'{p}:{i}: entity {m.group(0)} = U+{cp:04X}  {line.strip()[:80]}')
        for m in ESC.finditer(line):
            if m.group(1) and banned(int(m.group(1), 16)):
                out.append(f'{p}:{i}: escape {m.group(0)}  {line.strip()[:80]}')
            elif m.group(2):               # a high surrogate: always an astral char
                out.append(f'{p}:{i}: surrogate escape {m.group(0)}  {line.strip()[:80]}')
print('\n'.join(out))
PY
)
if [ -n "$BAD" ]; then
  echo "✗ emoji found — this project uses monochrome dingbats only:"
  echo "$BAD"
  exit 1
fi
echo "✓ no emoji (literals, HTML entities and JS escapes all checked)"
