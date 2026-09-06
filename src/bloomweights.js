// bloomweights.js — which things bloom how much, as pure data + pure
// functions. No three.js import, no DOM: the walk uses .children rather
// than Object3D.traverse so it is testable on plain objects.
//
// One bloom chain is fed a WEIGHTED render of the scene, so a group's
// weight controls how hard it glows without touching how brightly it
// draws. That decoupling is the whole point: the board can stay bright
// cyan and barely bloom, which dimming it could never achieve.

export const BLOOM_GROUPS = ['map', 'enemies', 'tank', 'towers', 'effects'];

// Starting points, not conclusions — derived from the complaint (the board
// reads too hot) rather than from looking at them. Tune with the sliders,
// then write the keepers back here.
export const DEFAULT_BLOOM_WEIGHTS = {
  map: 0.35,      // bright lines, almost no glow
  enemies: 1.3,   // hot against a calmed board
  tank: 1.0,
  towers: 1.0,
  effects: 1.0,   // also the fallback for anything untagged
};

export const MAX_BLOOM_WEIGHT = 3;

export function clampWeight(w) {
  if (typeof w !== 'number' || !Number.isFinite(w)) return 1;
  return Math.min(MAX_BLOOM_WEIGHT, Math.max(0, w));
}

// groupRoots: [[groupName, [rootNode, ...]], ...]
// Descendants inherit their root's weight. A node reachable from two
// groups keeps the FIRST — declaration order is the tie-break, so the
// result never depends on traversal accidents.
export function buildWeightMap(groupRoots, weights) {
  const out = new Map();
  for (const [group, roots] of groupRoots || []) {
    const w = weights && group in weights ? clampWeight(weights[group]) : null;
    if (w === null) continue; // unknown group name: skip rather than guess
    for (const root of roots || []) walk(root, w, out);
  }
  return out;
}

function walk(node, w, out) {
  if (!node || out.has(node)) return; // out.has also breaks cycles
  out.set(node, w);
  const kids = node.children;
  if (!kids) return;
  for (const k of kids) walk(k, w, out);
}

// Tripwire. Cross-group material sharing does not exist today, but if it
// ever appears, the weighted pass would write one weight and render the
// other — a silent, baffling bug. Better to say so out loud.
export function materialConflicts(weightMap) {
  const seen = new Map(); // material -> weight
  const bad = new Map();  // material -> Set(weights)
  for (const [node, w] of weightMap) {
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    for (const mat of mats) {
      if (!mat) continue;
      if (!seen.has(mat)) { seen.set(mat, w); continue; }
      if (seen.get(mat) !== w) {
        if (!bad.has(mat)) bad.set(mat, new Set([seen.get(mat)]));
        bad.get(mat).add(w);
      }
    }
  }
  return [...bad].map(([material, ws]) => ({ material, weights: [...ws] }));
}
