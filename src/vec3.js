// vec3.js — tiny 3D vector helpers on plain [x, y, z] arrays.
export const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
export const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const norm3 = (a) => {
  const l = len3(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const mean3 = (ps) => {
  let x = 0, y = 0, z = 0;
  for (const p of ps) { x += p[0]; y += p[1]; z += p[2]; }
  const n = ps.length;
  return [x / n, y / n, z / n];
};

// Orthonormal tangent basis at unit normal n (sphere centered at origin:
// n = normalize(surface point)). Returns [u, v] with u ⊥ v ⊥ n.
// Direction from `from` to `to`, flattened into the tangent plane at normal
// `n`. On a sphere this is "which way do I steer", and it had drifted into
// four independent copies. Kept GRAPH-FREE on purpose: callers pass the three
// vectors, so this module still knows nothing about cells or adjacency.
export const tangentDir = (n, from, to) => {
  const d = sub3(to, from);
  return norm3(sub3(d, scale3(n, dot3(d, n))));
};

export function tangentBasis(n) {
  // pick the axis least aligned with n to avoid degeneracy
  const ref = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm3(cross3(n, ref));
  const v = cross3(n, u); // already unit: n ⊥ u, both unit
  return [u, v];
}

// Order-independent key for an UNDIRECTED segment, for de-duplicating
// coincident line geometry.
//
// Why this exists: a quad grid's interior edges belong to two cells, and
// if each cell emits its own four boundary edges, every interior edge is
// drawn twice. Under AdditiveBlending those duplicates sum, and at a
// vertex — where several already-doubled edges converge on one pixel —
// brightness stacks far past the bloom threshold that the edge midspans
// stay under. The result is a bloomed blob on every vertex.
//
// ORDER INDEPENDENCE IS THE WHOLE POINT: twin edges are wound opposite
// ways (a→b in one cell, b→a in its neighbour), so a key that respects
// direction dedupes nothing at all, and does it silently.
const Q = 1e6; // quantize: absorbs float dust, keeps genuinely distinct points apart
const ptKey = (p) => `${Math.round(p[0] * Q)},${Math.round(p[1] * Q)},${Math.round(p[2] * Q)}`;
export function segKey(p, q) {
  const a = ptKey(p), b = ptKey(q);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
