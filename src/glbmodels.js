// glbmodels.js — shared machinery for authored models (.glb) used as game
// pieces. DOM-light; imported by towerlooks.js and units.js.
//
// Three problems every authored model hits here, all of them measured
// rather than assumed:
//
// 1. SCALE. Exported models carry whatever units the artist worked in.
//    Fitting matters in a specific way: these models are much WIDER than
//    they are tall, so fitting by footprint makes a squat smear and fitting
//    by height alone sprawls them over their neighbours. Fit by height,
//    capped by span.
// 2. VISIBILITY. A dark machine vanishes against a black board of neon
//    wire. The game colour goes on as EMISSIVE rather than replacing the
//    model's own materials.
// 3. DRAW CALLS. These models are ~60-110 separate meshes. Merging per
//    material cuts that by an order of magnitude — but merging destroys
//    articulation, so anything that must still MOVE has to be preserved.
import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { MeshoptDecoder } from '../vendor/meshopt_decoder.module.js';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';

// MESHOPT. A model exported with EXT_meshopt_compression does not fail with a
// bad mesh or a warning — GLTFLoader THROWS on the first compressed buffer
// view and the whole file resolves to null, so the piece is simply absent and
// the fallback covers for it. astronaut-compact.glb is such a file ("compact"
// is the compression, not the silhouette), and this is a one-line fix that
// costs an hour to find.
//
// The decoder is vendored rather than pulled from a sibling's node_modules,
// and unlike the Line2 trio (a recorded dead end in .deban) that is safe
// here: it is standalone MIT code with embedded WASM, no three.js imports at
// all, so it cannot disagree with our r160 the way a versioned addon does.
//
// ONE loader, configured once. Every load in this file goes through it, so a
// compressed asset works wherever an uncompressed one would.
const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

// bust.sh's fingerprint-urls.py rewrites HTML attributes and CSS url() only
// — never JS string literals — so a path built here would ship untokened.
// Reading the <meta name="cb"> tag it already maintains gets it for free.
export function bustToken() {
  const m = typeof document !== 'undefined' && document.querySelector('meta[name="cb"]');
  const v = m && m.content ? m.content.trim() : '';
  return v ? `?v=${encodeURIComponent(v)}` : '';
}

// One in-flight load per URL, cached forever. Never rejects: a failed load
// resolves to null so callers fall back to a procedural model rather than
// rendering nothing.
const loads = new Map();
export function loadGlb(url) {
  if (loads.has(url)) return loads.get(url);
  // No DOM means no document base for a relative URL, so GLTFLoader throws
  // rather than fetching. That is the Node test environment: resolve to null
  // and let callers keep their procedural fallback. Guarding HERE rather
  // than at each call site, because any caller can now trigger a load —
  // buildUnit('mkcx') starts one by itself.
  if (typeof document === 'undefined') {
    const none = Promise.resolve(null);
    loads.set(url, none);
    return none;
  }
  const p = new Promise((resolve) => {
    gltfLoader.load(`${url}${bustToken()}`,
      (gltf) => resolve(gltf.scene),
      undefined,
      (err) => { console.warn(`[glbmodels] ${url} failed to load`, err); resolve(null); });
  });
  loads.set(url, p);
  return p;
}

// ...and the same load, keeping the CLIPS. `loadGlb` resolves the scene alone
// because every model this project casts is a static prop; the astronaut is
// the first rigged one, and an animation is no use to a caller that never
// received it. Separate cache, so a caller asking for either gets what it
// asked for without the other's shape.
const fullLoads = new Map();
export function loadGlbWithClips(url) {
  if (fullLoads.has(url)) return fullLoads.get(url);
  if (typeof document === 'undefined') {
    const none = Promise.resolve(null);
    fullLoads.set(url, none);
    return none;
  }
  const p = new Promise((resolve) => {
    gltfLoader.load(`${url}${bustToken()}`,
      (gltf) => resolve({ scene: gltf.scene, clips: gltf.animations || [] }),
      undefined,
      (err) => { console.warn(`[glbmodels] ${url} failed to load`, err); resolve(null); });
  });
  fullLoads.set(url, p);
  return p;
}

// Collapse leaf meshes to ONE MESH PER (articulation owner, material).
//
// `pivotNames` are nodes that must keep moving — a turret that aims, a gun
// that tracks. Meshes under one of those merge into THAT node's local space
// and stay attached to it; everything else merges into the root. Empty
// Object3Ds left behind cost nothing and keep the original transforms
// intact, so a preserved pivot still sits exactly where the artist put it.
//
// With no pivots this is a full flatten, which is what a static prop wants.
// uv by box projection: each vertex takes the two coordinates across its
// normal's dominant axis, in the geometry's own frame, scaled so one unit
// of the model is one repeat — the same scale a texture on the authored
// parts sees, near enough for a weathered plate.
function boxProjectUv(g) {
  const pos = g.attributes.position, nrm = g.attributes.normal;
  const n = pos.count;
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)), nz = Math.abs(nrm.getZ(i));
    let u, v;
    if (nx >= ny && nx >= nz) { u = z; v = y; } else if (ny >= nz) { u = x; v = z; } else { u = x; v = y; }
    uv[i * 2] = u; uv[i * 2 + 1] = v;
  }
  return new THREE.BufferAttribute(uv, 2);
}

export function mergeByMaterial(root, pivotNames = [], exclude = []) {
  root.updateMatrixWorld(true);
  // Drop unwanted parts BEFORE merging — afterwards they are welded into a
  // shared mesh and can no longer be addressed individually.
  for (const name of exclude) {
    let o;
    while ((o = root.getObjectByName(name))) o.parent.remove(o);
  }
  const pivots = pivotNames
    .map((n) => root.getObjectByName(n))
    .filter(Boolean);
  const ownerOf = (mesh) => {
    for (let o = mesh; o; o = o.parent) if (pivots.includes(o)) return o;
    return root;
  };

  const batches = new Map(); // owner -> Map(material -> [geometry])
  const originals = [];
  const inv = new THREE.Matrix4();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    // A pivot that IS a mesh (a small indicator, say) stays exactly as
    // authored: collecting it would merge it into itself and then remove it
    // from the tree, so getObjectByName would stop finding it. Preserving a
    // node has to mean preserving it whether it is a group or a mesh.
    if (pivots.includes(o)) return;
    const owner = ownerOf(o);
    const g = o.geometry.clone();
    // express the geometry in the OWNER's local space, not the world's
    inv.copy(owner.matrixWorld).invert();
    g.applyMatrix4(inv.multiply(o.matrixWorld));
    // mergeGeometries needs an identical attribute set across the batch and
    // returns null rather than throwing when they differ — so normalize to
    // the attributes every part is guaranteed to have: position, normal,
    // and uv IF the whole batch carries one (decided below, per batch).
    // uv used to be dropped here with everything else, which is why no
    // merged model could wear a texture: the cinematics' weathered metal
    // (cine/materials.js) found every batch uv-less (2026-09-04). The board
    // binds no maps, so a kept uv is inert there.
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    // A part without uv gets a BOX PROJECTION in its own frame — the
    // standard fallback — so the batch keeps uv and can wear a texture.
    // The ring's pod parts came without one (2026-09-04), and one bare
    // part made mergeByMaterial drop uv for the whole batch: the pods wore
    // the dark base while the plates wore the weathered metal.
    if (!g.attributes.uv) g.setAttribute('uv', boxProjectUv(g));
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!batches.has(owner)) batches.set(owner, new Map());
    const byMat = batches.get(owner);
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat).push(g);
    originals.push(o);
  });

  for (const o of originals) o.parent?.remove(o);
  for (const [owner, byMat] of batches) {
    for (const [mat, geos] of byMat) {
      // a batch keeps uv only if every part has it; one part without would
      // make mergeGeometries return null and the model fall apart
      if (!geos.every((g) => g.attributes.uv)) for (const g of geos) if (g.attributes.uv) g.deleteAttribute('uv');
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (!merged) { // defensive: keep the parts rather than lose the model
        for (const g of geos) owner.add(new THREE.Mesh(g, mat));
        continue;
      }
      owner.add(new THREE.Mesh(merged, mat));
    }
  }
  return root;
}

// Fit a model into a target envelope and rest it on y=0.
//
// `recentreOn` names a node to centre horizontally on INSTEAD of the
// bounding box. That matters: a tank's bounding box is skewed forward by
// its gun barrel, so centring on the box would make it pivot around a point
// out in front of itself. Centre on the hull.
// IDEMPOTENT BY CONSTRUCTION, and that is a bug fix rather than tidiness.
//
// This measures an object and then scales THAT SAME OBJECT. loadGlb caches by
// URL, so every caller asking for a model gets one shared scene — and two
// callers fitting it in turn is a compounding disaster: the first measures a
// 170-unit model and sets scale 0.005; the second measures the RESULT, 0.85
// units, computes k = 1.0, and the model is suddenly 170 units across.
//
// That is the "sometimes the tank and containers load enormous" report
// exactly: intermittent because it needs two fits to race, browser-specific
// because the ordering differs, and CURED BY A RESET because a fresh load
// starts from a raw model again. Chasing it by reproduction was never going
// to work; it is a shape of code, not a moment in time.
//
// So the measurement is always taken at scale 1: reset, measure, scale. Fit
// the same object twice and you get the same answer twice.
export function fitModel(obj, { height, maxSpan, recentreOn = null }) {
  obj.scale.setScalar(1);
  obj.position.set(0, 0, 0);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3(); box.getSize(size);
  const centre = new THREE.Vector3(); box.getCenter(centre);
  // AND REFUSE THE ABSURD. An empty Box3 (a model whose geometry has not
  // landed) measures -Infinity, and a nearly-flat one divides `height` by
  // almost nothing — both produce a model hundreds of times too big rather
  // than an error. A piece at the wrong scale should say so, once, and stand
  // at 1:1 where it can be seen and reported.
  if (!Number.isFinite(size.x) || !Number.isFinite(size.y) || !Number.isFinite(size.z)
      || Math.max(size.x, size.y, size.z) < 1e-4) {
    console.warn('[glbmodels] fitModel: refusing to scale a model that measures'
      + ` ${size.x}x${size.y}x${size.z} — its geometry is missing or degenerate`);
    const g0 = new THREE.Group();
    g0.add(obj);
    g0.userData.fitScale = 1;
    g0.userData.fitRefused = true;
    return g0;
  }

  let cx = centre.x, cz = centre.z;
  if (recentreOn) {
    const node = obj.getObjectByName(recentreOn);
    if (node) {
      const p = new THREE.Vector3();
      node.getWorldPosition(p);
      cx = p.x; cz = p.z;
    }
  }

  const wide = Math.max(size.x, size.z) || 1;
  const k = Math.min(height / (size.y || 1), maxSpan / wide);
  const g = new THREE.Group();
  obj.scale.setScalar(k);
  obj.position.set(-cx * k, -box.min.y * k, -cz * k);
  g.add(obj);
  g.userData.fitScale = k;
  return g;
}

// Tint an authored model so it reads as a shaded machine rather than a
// single coloured mass.
//
// The naive version — one emissive wash over every material — is what
// produced the mass. Measured on mkcx, its four structural materials sit at
// luminance 0.061 to 0.113: a span of 0.05, all muddy olive-grey. Adding an
// identical wash to each compressed even that away.
//
// So each material gets its own rung on a lightness LADDER, keyed by name.
// Same hue, clearly different values — armour bright, steel dark — which is
// what makes panels, plates and mantlets read as separate surfaces. The
// parts the artist named "glow" keep full emissive colour and sit above the
// ladder entirely.
const GLOW = /glow/i;
// ...and a caller may name its OWN hot materials. The Sentry Workshop calls
// its indicator surfaces "Signal" and "Identification", which no regex for
// the word "glow" will ever match — and those two are exactly the parts that
// should carry the tower's colour at full strength, because they are what
// tells one family from another at board scale.
const DEFAULT_SHADES = { armour: 1.0, turret: 0.72, detail: 0.5, steel: 0.34 };

function rungFor(name, shades) {
  const n = (name || '').toLowerCase();
  for (const key of Object.keys(shades)) if (n.includes(key)) return shades[key];
  return 0.6; // unnamed / unknown: mid-ladder
}

export function tintModel(root, color, opts = {}) {
  // number = the old wash-only form, kept so the towers keep their look
  const o = typeof opts === 'number' ? { wash: opts } : opts;
  const wash = o.wash ?? 0.28;
  const shades = o.shades ?? null;      // null = wash only, no ladder
  const sat = o.sat ?? 0.55;
  const loFrom = o.lightFrom ?? 0.20;
  const loTo = o.lightTo ?? 0.62;
  const glow = o.glow ?? GLOW;

  const c = new THREE.Color(color);
  const dim = c.clone().multiplyScalar(wash);
  const hsl = {}; c.getHSL(hsl);

  root.traverse((obj) => {
    // outlines are LineSegments, not meshes — they take the tint at full
    // strength, because the bright edge IS the read
    if (obj.isLineSegments && obj.material) {
      const lm = obj.material.clone();
      if (lm.color) lm.color.copy(c);
      obj.material = lm;
      return;
    }
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    obj.material = mats.map((m) => {
      const cl = m.clone(); // clone: prototypes are shared between instances
      const hot = glow.test(m.name || '');
      if (hot) {
        if (cl.emissive) {
          cl.emissive.copy(c);
          if ('emissiveIntensity' in cl) cl.emissiveIntensity = 1.6;
        } else if (cl.color) {
          cl.color.copy(c); // unlit: no emissive channel to use
        }
        return cl;
      }
      if (shades && cl.color) {
        const rung = rungFor(m.name, shades);
        // same hue, desaturated toward metal, LIGHTNESS carrying the rung
        cl.color.setHSL(hsl.h, hsl.s * sat, loFrom + (loTo - loFrom) * rung);
        if (cl.emissive) cl.emissive.copy(c).multiplyScalar(wash * 0.45 * rung);
      } else if (cl.emissive) {
        cl.emissive.copy(dim);
      }
      return cl;
    });
    if (obj.material.length === 1) obj.material = obj.material[0];
  });
}

// A 3x3 shell rack, matching the procedural tank's: row-major, index < ammo
// lit. Returned so the caller can hand it to td-tab as userData.ammoDots.
export function makeShellRack(parent, { x = 0, y = 0, z = 0, dot = 0.05, gapX = 0.24, gapZ = 0.28,
  plate = null } = {}) {
  // Optional backing plate, sized to hold the whole 3x3. An imported model's
  // own roof panel is whatever the artist drew and will not fit a rack that
  // wasn't designed for it, so the rack brings its own.
  if (plate) {
    const w = gapX * 2 + dot * 2 + (plate.pad ?? dot * 1.6);
    const d = gapZ * 2 + dot * 2 + (plate.pad ?? dot * 1.6);
    const h = plate.thickness ?? dot * 0.9;
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color: plate.color ?? 0x2b3240 }));
    slab.position.set(x, y - dot - h * 0.5, z);
    parent.add(slab);
    if (plate.outline) {
      slab.add(new THREE.LineSegments(
        new THREE.EdgesGeometry(slab.geometry),
        new THREE.LineBasicMaterial({
          color: plate.outline, transparent: true, opacity: 0.8,
          blending: THREE.AdditiveBlending, depthWrite: false,
        })));
    }
  }
  const geo = new THREE.SphereGeometry(dot, 6, 6);
  const dots = [];
  for (let r = 0; r < 3; r++) {
    for (let col = 0; col < 3; col++) {
      const d = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      d.position.set(x + (col - 1) * gapX, y, z + (r - 1) * gapZ);
      parent.add(d);
      dots.push(d);
    }
  }
  return dots;
}

// --- the house Tron kit ---------------------------------------------------
// Our procedural units are dark bodies wearing bright additive edges; an
// imported model arrives as shaded surfaces with no edges at all, which is
// most of why it reads as a lump next to them. These give a model the same
// language.

// Bright creases on every merged mesh. `angle` is what keeps this from
// becoming a wireframe: EdgesGeometry defaults to 1 degree and would draw
// every triangle boundary. ~28 degrees keeps only the real panel lines.
//
// Built on the PROTOTYPE so the geometry is computed once and every clone
// shares it; tintModel recolours the material per instance.
export function addEdgeOutlines(root, { angle = 28, opacity = 0.85, color = 0xffffff } = {}) {
  const mat = new THREE.LineBasicMaterial({
    color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const meshes = [];
  // not the helpers: a hidden collision box outlined is a red box with a
  // diagonal across the container's face (the metal lab, 2026-09-04)
  root.traverse((o) => { if (o.isMesh && o.geometry && o.visible && !/collision|callout|helper/i.test(o.name || '')) meshes.push(o); });
  for (const m of meshes) {
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, angle), mat));
  }
  return root;
}

// A heat sleeve around a gun: the diegetic gauge our tank already uses,
// cool cyan to red as the cannon heats. Returned so the caller can hand it
// over as userData.heatSleeve — td-tab lerps its material colour directly.
export function makeHeatSleeve(parent, { radius = 0.32, len = 0.5, z = 1.4, color = 0x7df9ff } = {}) {
  const geo = new THREE.CylinderGeometry(radius, radius, len, 12, 1, true)
    .rotateX(Math.PI / 2); // barrels run along +Z, cylinders are born along +Y
  const sleeve = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
  }));
  sleeve.position.z = z;
  parent.add(sleeve);
  return sleeve;
}

// Glowing tubes for a pair of guns, matching the procedural tank's
// mini-guns. Inserted at child index 0 because td-tab reads the heat gauge
// off guns[0].children[0] — appending would leave it recolouring a chunk of
// the model instead. One shared material, so both tubes heat together.
export function addGunTubes(guns, { radius = 0.12, len = 1.0, z = 0.5, color = 0x7df9ff } = {}) {
  const geo = new THREE.CylinderGeometry(radius, radius * 1.25, len, 8)
    .rotateX(Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color });
  for (const gun of guns) {
    const tube = new THREE.Mesh(geo, mat);
    tube.position.z = z;
    gun.add(tube);
    gun.children.splice(gun.children.indexOf(tube), 1);
    gun.children.unshift(tube); // index 0: the gauge td-tab drives
  }
  return mat;
}
