// looks.js — THE SPACE-COLONY LOOK: Tron surfaces, Battlezone ground. Dark
// filled facets so hills still hide things, glowing edges so the shapes
// read, emissive tints on every model, a star field, and bloom to make the
// glow bleed. Everything visual that is not a model lives here, so a tab
// asks for the look rather than owning a palette.
import * as THREE from '../vendor/three.module.js';
import { makeBloom } from './postfx.js?v=8de06158';
import { tintModel, addEdgeOutlines } from './glbmodels.js?v=8de06158';
import { query } from './url.js?v=8de06158';

// TWO LOOKS. 'colony' is the Tron-and-TD-board look; 'battlezone' is the
// 1980 vector display: black, one green, every shape an edge. `?look=`
// picks, battlezone by default while it is being tried.
export const LOOKS = ['battlezone', 'colony'];
const wanted = (typeof location !== 'undefined' ? query().get('look') : null) || 'battlezone';
export const LOOK = LOOKS.includes(wanted) ? wanted : 'battlezone';
export const BZ = LOOK === 'battlezone';

const G = { dim: 0x1c7a3a, mid: 0x2ecc5e, hi: 0x7dffa0, road: 0xa8ff9a };
const COLONY = {
  bg: 0x0d1017,
  fog: 0x0d1017,
  ground: [0x07131c, 0x0c2433],
  wire: 0x1fb6cc,
  road: 0xff7a1a,
  roadFill: 0x2a1408,
  slab: 0x070d16,
  grid: 0x0e4b5a,
  home: 0x2ad2ff,
  hostile: 0xff4d2e,
  hull: 0x7df9ff,
  crystal: 0xd05cff,
  dome: 0x3cf2b0,
  rock: 0x3a4a5c,
  star: 0x9fb0c8,
  tracer: 0xffd166, shot: 0x7df9ff, shell: 0xff8c42, splash: 0xff8c42, arc: 0xc0392b, blind: 0x2ecc71, shadow: 0x000000, tick: 0xffffff, cross: 0xff5c5c,
  section: {
    ground: 0x2a3f52, road: 0xff7a1a, perimeter: 0x2ad2ff, defense: 0xff4d2e,
    command: 0x7df9ff, personnel: 0x3cf2b0, logistics: 0xffb347, industry: 0xff8c42,
    utility: 0xf5e663, air: 0xc77dff, field: 0xff6b6b, prop: 0x9fb3c8, research: 0x48dbfb, assembly: 0xffa94d,
  },
};
const BATTLEZONE = {
  bg: 0x000000,
  fog: 0x000000,
  ground: [0x000000, 0x000000],
  wire: G.mid,
  road: G.road,
  roadFill: 0x000000,
  slab: 0x000000,
  grid: G.dim,
  home: G.mid,
  hostile: G.mid,
  hull: G.hi,
  crystal: G.mid,
  dome: G.mid,
  rock: G.dim,
  star: 0x1d6b33,
  tracer: G.hi, shot: G.hi, shell: G.hi, splash: G.hi, arc: G.dim, blind: G.hi, shadow: G.dim, tick: G.mid, cross: G.hi,
  section: Object.fromEntries(['ground', 'road', 'perimeter', 'defense', 'command', 'personnel', 'logistics', 'industry', 'utility', 'air', 'field', 'prop', 'research', 'assembly'].map((k) => [k, G.mid])),
};
export const PALETTE = BZ ? BATTLEZONE : COLONY;

// --- the battlezone materials ---------------------------------------------------
// One black fill for everything solid (it occludes; a vector display did
// not, and that is the one liberty taken), one green line, one green wire
// for skinned meshes whose edges cannot follow their bones.
// DoubleSide: the NASA gantry is authored with double-sided materials and
// faces that wind inward; a front-only black fill left it hollow, every
// edge showing through (operator's screenshot, 2026-09-07 00:21).
export const BZ_BLACK = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
export const BZ_WIRE = new THREE.MeshBasicMaterial({ color: G.mid, wireframe: true });
export const BZ_EDGE_ANGLE = 28;

// Per-model edge overrides, by file name. THE CONTAINER (operator's
// screenshot, 2026-09-06 23:32): the reference container is corrugated, its
// ribs give edge lines centimetres apart, and a yard of them blooms into a
// white slab. Sparser edges, a dimmer line, half the opacity — until a
// container authored for a vector look replaces it (noted in CLAUDE.md).
export const BZ_OVERRIDES = {
  'container.glb': { angle: 60, color: G.dim, opacity: 0.5 },
};
export const bzStyleFor = (url) => (url ? BZ_OVERRIDES[url.split('/').pop()] : null) || { angle: BZ_EDGE_ANGLE, color: G.hi, opacity: 0.9 };

// Dress a model for the current look. Colony: nothing (the casts did it).
// Battlezone: black fills, green edges; skinned meshes go wireframe. The
// edge style is remembered on the root so instancing can bake the same.
export function styleForLook(root, url = null) {
  if (!BZ) return root;
  const style = bzStyleFor(url);
  root.userData.bzStyle = style;
  root.traverse((o) => {
    if (o.isLineSegments) { o.material = new THREE.LineBasicMaterial({ color: style.color, transparent: true, opacity: style.opacity }); return; }
    if (!o.isMesh) return;
    o.material = o.isSkinnedMesh ? BZ_WIRE : BZ_BLACK;
  });
  const skinned = [];
  root.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
  if (!skinned.length) addEdgeOutlines(root, { angle: style.angle, opacity: style.opacity, color: style.color });
  return root;
}

// Edges of every mesh in a prototype, baked once per instance transform into
// ONE LineSegments — the instanced pieces' green lines. `parts` are
// { geometry, local } as meshesOf() returns them.
export function bakeEdges(parts, matrices, style = null) {
  const st = style || { angle: BZ_EDGE_ANGLE, color: G.hi, opacity: 0.9 };
  const pos = [];
  const v = new THREE.Vector3(), m = new THREE.Matrix4();
  for (const part of parts) {
    const eg = new THREE.EdgesGeometry(part.geometry, st.angle);
    const arr = eg.attributes.position.array;
    for (const M of matrices) {
      m.multiplyMatrices(M, part.local);
      for (let i = 0; i < arr.length; i += 3) { v.set(arr[i], arr[i + 1], arr[i + 2]).applyMatrix4(m); pos.push(v.x, v.y, v.z); }
    }
    eg.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: st.color, transparent: true, opacity: st.opacity }));
}

export function applySpaceScene(scene) {
  scene.background = new THREE.Color(PALETTE.bg);
  if (typeof document !== 'undefined') document.body.classList.add(`look-${LOOK}`);
  scene.add(new THREE.HemisphereLight(0xc8cfe0, 0x555060, 1.5));
  const sun = new THREE.DirectionalLight(0xffe8c8, 1.1);
  sun.position.set(2, 3, 1.5);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x8a96c8, 0.8);
  fill.position.set(-2.5, -1.5, -3);
  scene.add(fill);
}

export function makeStars(n = 1600, radius = 1800) {
  const pos = new Float32Array(n * 3);
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < n; i++) {
    const u = rnd() * 2 - 1, phi = rnd() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    pos[i * 3] = r * Math.cos(phi) * radius; pos[i * 3 + 1] = Math.abs(u) * radius * 0.9 + 20; pos[i * 3 + 2] = r * Math.sin(phi) * radius;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  // dim and small on purpose: a star over the bloom threshold blooms into a square
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: PALETTE.star, size: 1.4, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.55 }));
  pts.frustumCulled = false;
  return pts;
}

// The TD board's bloom: postfx.js's two-composer chain at its defaults
// (strength 0.3, radius 0.5, threshold 0.2, MSAA back on the final pass),
// with the per-group weights — the map at 0.35 so the wire stays a line
// rather than a glow, machines and effects at 1. setGroups(fn) names what
// is what; resize(w, h) keeps the passes in step.
export function makeComposer(renderer, scene, camera, opts = {}) {
  const post = makeBloom(renderer, scene, camera, { scale: 1, ...opts });
  return {
    post,
    render() { post.render(); },
    resize(w, h) { post.setSize(w, h); },
    setGroups(fn) { post.setGroups(fn); },
  };
}

// Emissive tint on a model prototype, at a wash that lets the glow strips
// stay the brightest thing on it.
export function tintProto(root, color, wash = 0.14) {
  tintModel(root, color, { wash });
  return root;
}

// A placeholder as a dark box with neon edges in its section colour.
export function neonBox(w, h, d, color) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const fill = new THREE.Mesh(geo, BZ ? BZ_BLACK : new THREE.MeshStandardMaterial({ color: 0x08101a, emissive: new THREE.Color(color).multiplyScalar(0.08), roughness: 0.9 }));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color }));
  const g = new THREE.Group();
  g.add(fill, edges);
  return g;
}

// --- terrain: dark facets under a glowing wire --------------------------------
export function terrainMeshes(world, splitQuad) {
  const { mesh, heights } = world;
  const pos = [], col = [];
  const c = new THREE.Color(), lo = new THREE.Color(PALETTE.ground[0]), hi = new THREE.Color(PALETTE.ground[1]), roadC = new THREE.Color(PALETTE.roadFill);
  const hMin = Math.min(...heights), hMax = Math.max(...heights);
  const drop = (x, z) => world.plates.some((p) => x > p.ox - 2 && x < p.ox + p.wM + 2 && z > p.oz - 2 && z < p.oz + p.hM + 2) ? 0.8 : 0;
  mesh.quads.forEach((q, qi) => {
    const road = world.road.set.has(qi);
    const hAvg = (heights[q[0]] + heights[q[1]] + heights[q[2]] + heights[q[3]]) / 4;
    const t = hMax > hMin ? (hAvg - hMin) / (hMax - hMin) : 0.5;
    if (road) c.copy(roadC); else c.copy(lo).lerp(hi, t);
    for (const vi of splitQuad(mesh.vertices, q).flat()) {
      const [x, z] = mesh.vertices[vi];
      pos.push(x, heights[vi] - drop(x, z), z);
      col.push(c.r, c.g, c.b);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const fill = new THREE.Mesh(geo, BZ
    ? new THREE.MeshBasicMaterial({ color: 0x000000, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })
    : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  // the wire: every quad edge once, orange where it borders the road
  const seen = new Map();
  mesh.quads.forEach((q, qi) => {
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4];
      const k = a < b ? a * 1e6 + b : b * 1e6 + a;
      const e = seen.get(k) || { a, b, road: false };
      if (world.road.set.has(qi)) e.road = true;
      seen.set(k, e);
    }
  });
  const wpos = [], wcol = [];
  const wc = new THREE.Color(PALETTE.wire), rc = new THREE.Color(PALETTE.road);
  for (const e of seen.values()) {
    for (const vi of [e.a, e.b]) {
      const [x, z] = mesh.vertices[vi];
      wpos.push(x, heights[vi] - drop(x, z) + 0.05, z);
      const cc = e.road ? rc : wc;
      wcol.push(cc.r, cc.g, cc.b);
    }
  }
  const wgeo = new THREE.BufferGeometry();
  wgeo.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
  wgeo.setAttribute('color', new THREE.Float32BufferAttribute(wcol, 3));
  const wire = new THREE.LineSegments(wgeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75 }));
  return { fill, wire };
}

// --- flora: crystal spires and lichen domes where the trees were -------------
export function floraMeshes(world) {
  const g = new THREE.Group();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const items = world.trees;
  let seed = world.seed * 7919 + 1;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const spires = items.filter((t, i) => i % 3 !== 2), domes = items.filter((t, i) => i % 3 === 2);
  if (spires.length) {
    const geo = new THREE.ConeGeometry(1, 1, 5);
    const mat = BZ ? new THREE.MeshBasicMaterial({ color: PALETTE.crystal, wireframe: true }) : new THREE.MeshStandardMaterial({ color: 0x1a0a2a, emissive: new THREE.Color(PALETTE.crystal), emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.2 });
    const im = new THREE.InstancedMesh(geo, mat, spires.length * 2);
    let n = 0;
    for (const t of spires) {
      const y = world.heightAt(t.x, t.z);
      for (let k = 0; k < 2; k++) {
        const h = t.h * (k ? 0.55 : 1.0), r = t.r * (k ? 0.9 : 1.3);
        const tilt = (rnd() - 0.5) * 0.35, spin = rnd() * Math.PI * 2;
        q.setFromEuler(new THREE.Euler(tilt, spin, tilt * 0.6));
        s.set(r, h, r);
        p.set(t.x + (k ? (rnd() - 0.5) * 3 : 0), y + h / 2 - 0.3, t.z + (k ? (rnd() - 0.5) * 3 : 0));
        m.compose(p, q, s);
        im.setMatrixAt(n++, m);
      }
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    g.add(im);
  }
  if (domes.length) {
    const geo = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const mat = BZ ? new THREE.MeshBasicMaterial({ color: PALETTE.dome, wireframe: true }) : new THREE.MeshStandardMaterial({ color: 0x06201a, emissive: new THREE.Color(PALETTE.dome), emissiveIntensity: 0.55, roughness: 0.6 });
    const im = new THREE.InstancedMesh(geo, mat, domes.length);
    domes.forEach((t, i) => {
      const r = t.h * 0.35;
      m.makeScale(r, r * 0.55, r); m.setPosition(t.x, world.heightAt(t.x, t.z), t.z);
      im.setMatrixAt(i, m);
    });
    im.instanceMatrix.needsUpdate = true;
    g.add(im);
  }
  if (world.rocks.length) {
    const im = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), BZ ? new THREE.MeshBasicMaterial({ color: PALETTE.rock, wireframe: true }) : new THREE.MeshStandardMaterial({ color: 0x0a121c, emissive: new THREE.Color(PALETTE.rock).multiplyScalar(0.35), roughness: 0.95, flatShading: true }), world.rocks.length);
    world.rocks.forEach((r, i) => { m.makeScale(r.r, r.h, r.r * 0.8); m.setPosition(r.x, world.heightAt(r.x, r.z) + r.h * 0.35, r.z); im.setMatrixAt(i, m); });
    im.instanceMatrix.needsUpdate = true;
    g.add(im);
  }
  return g;
}
