// impactfx.js — WHAT A HIT LOOKS LIKE. Seven families of impact effect, each
// a factory returning an Object3D with `userData.tick(dt) -> alive`, which is
// the same contract makeDebris and makeDotBurst already use, so td-tab's
// existing `debris` array can carry these without learning anything new.
//
// Why this exists: until now the board had ONE impact effect — makeDotBurst,
// a puff of tinted dots — reused for a run-over, a shell, a laser tick and a
// portal collapse. Four very different events reading as the same puff is why
// hits feel weightless, and it is not a tuning problem: a spark shower and a
// flash are different phenomena and no amount of knobs turns one into the
// other.
//
// EVERY EFFECT IS BUILT IN LOCAL SPACE around the origin, with +Z pointing
// ALONG THE SURFACE NORMAL. The caller positions and orients; the effect
// never learns where it is on the board. That is what lets the same effect
// serve a wall in this lab, a hull on the sphere, and a target in the sentry
// range without three sign conventions.
//
// Deterministic: a hashed pseudo-stream per effect, seeded by the caller.
// House rule — no Math.random in anything the game can replay.
import * as THREE from '../vendor/three.module.js';
import { makeParams, clampParams, formatKnobs, knobProblems } from './knobs.js?v=8e468128';

export const IMPACT_TUNE = {
  // SPARK SHOWER — hot chips thrown off the surface, falling under gravity
  sparkCount: 34,
  sparkSpeed: 2.4,        // units/s at birth
  sparkSpread: 0.85,      // radians off the normal — 0 is a needle, 1.5 a fan
  sparkLife: 0.55,        // seconds
  sparkGravity: 5.5,      // units/s^2, along -Z (into the surface's floor)
  sparkBounce: 0.35,      // how much of the speed survives hitting the surface
  sparkSize: 2.2,         // px
  // FLASH — the brief pop at the contact point
  flashLife: 0.13,
  flashSize: 0.17,
  flashRings: 2,
  // SHOCKWAVE — an expanding ring lying ON the surface
  ringLife: 0.42,
  ringEnd: 0.62,          // final radius
  ringWidth: 0.08,
  // SCORCH — the mark that outlives the hit
  scorchLife: 3.0,
  scorchSize: 0.17,
  // DEBRIS — solid tumbling fragments knocked off the surface
  debrisCount: 9,
  debrisSpeed: 1.7,
  debrisLife: 1.4,
  debrisSize: 0.028,
  // PLASMA SPLASH — molten matter that clings, sags and drips
  splashCount: 22,
  splashLife: 1.1,
  splashCling: 0.72,      // how much of the throw is killed on contact
  splashSag: 2.2,         // units/s^2 of droop once it has stuck
  // EMBERS — the slow bright motes that trail after everything else
  emberCount: 16,
  emberLife: 1.9,
  emberRise: 0.75,        // units/s upward drift
  emberDrag: 0.86,
};

export const IMPACT_KNOBS = [
  { key: 'sparkCount', label: 'sparks', group: 'spark', min: 0, max: 160, step: 1 },
  { key: 'sparkSpeed', label: 'speed', group: 'spark', min: 0.2, max: 20, step: 0.1 },
  { key: 'sparkSpread', label: 'spread (rad)', group: 'spark', min: 0, max: 1.57, step: 0.01 },
  { key: 'sparkLife', label: 'life (s)', group: 'spark', min: 0.05, max: 3, step: 0.05 },
  { key: 'sparkGravity', label: 'gravity', group: 'spark', min: 0, max: 30, step: 0.5 },
  { key: 'sparkBounce', label: 'bounce', group: 'spark', min: 0, max: 1, step: 0.05 },
  { key: 'sparkSize', label: 'size (px)', group: 'spark', min: 0.5, max: 10, step: 0.1 },
  { key: 'flashLife', label: 'life (s)', group: 'flash', min: 0.02, max: 1, step: 0.01 },
  { key: 'flashSize', label: 'size', group: 'flash', min: 0.05, max: 4, step: 0.05 },
  { key: 'flashRings', label: 'rings', group: 'flash', min: 1, max: 5, step: 1 },
  { key: 'ringLife', label: 'life (s)', group: 'ring', min: 0.05, max: 3, step: 0.05 },
  { key: 'ringEnd', label: 'radius', group: 'ring', min: 0.2, max: 8, step: 0.1 },
  { key: 'ringWidth', label: 'width', group: 'ring', min: 0.01, max: 1, step: 0.01 },
  { key: 'scorchLife', label: 'life (s)', group: 'scorch', min: 0.2, max: 20, step: 0.1 },
  { key: 'scorchSize', label: 'size', group: 'scorch', min: 0.05, max: 4, step: 0.05 },
  { key: 'debrisCount', label: 'chunks', group: 'debris', min: 0, max: 60, step: 1 },
  { key: 'debrisSpeed', label: 'speed', group: 'debris', min: 0.2, max: 20, step: 0.1 },
  { key: 'debrisLife', label: 'life (s)', group: 'debris', min: 0.1, max: 6, step: 0.1 },
  { key: 'debrisSize', label: 'size', group: 'debris', min: 0.01, max: 0.6, step: 0.005 },
  { key: 'splashCount', label: 'blobs', group: 'splash', min: 0, max: 90, step: 1 },
  { key: 'splashLife', label: 'life (s)', group: 'splash', min: 0.1, max: 5, step: 0.1 },
  { key: 'splashCling', label: 'cling', group: 'splash', min: 0, max: 1, step: 0.02 },
  { key: 'splashSag', label: 'sag', group: 'splash', min: 0, max: 12, step: 0.1 },
  { key: 'emberCount', label: 'embers', group: 'ember', min: 0, max: 80, step: 1 },
  { key: 'emberLife', label: 'life (s)', group: 'ember', min: 0.1, max: 8, step: 0.1 },
  { key: 'emberRise', label: 'rise', group: 'ember', min: -3, max: 6, step: 0.05 },
  { key: 'emberDrag', label: 'drag', group: 'ember', min: 0.5, max: 1, step: 0.01 },
];

export const makeImpactParams = (src = IMPACT_TUNE) => makeParams(IMPACT_KNOBS, src);
export const clampImpactParams = (p, src) => clampParams(IMPACT_KNOBS, p, src);
export const formatImpactTune = (p) => formatKnobs('IMPACT_TUNE', IMPACT_KNOBS, p);
export const impactKnobProblems = () => knobProblems(IMPACT_KNOBS, IMPACT_TUNE);

export const IMPACT_FAMILIES = ['spark', 'flash', 'ring', 'scorch', 'debris', 'splash', 'ember'];

// A hit is not one effect, it is a RECIPE. These are the three the game
// actually needs, named after what fires them rather than after what they
// look like — so a call site asks for "what a laser does to a wall" and does
// not have to know which families that turns out to be.
export const IMPACT_RECIPES = {
  shell:  ['flash', 'spark', 'ring', 'debris', 'scorch'],
  laser:  ['flash', 'spark', 'splash', 'ember', 'scorch'],
  plasma: ['flash', 'splash', 'ember', 'ring'],
  light:  ['flash', 'spark'],          // a small-arms tick: cheap, still reads
  crush:  ['debris'],                  // a thing run over: chunks fly, nothing burns
};

// --- the deterministic stream ---------------------------------------------
// One hash per (seed, index), not a running generator: an effect's particle i
// must get the same numbers whether it is built alone or as the fourth family
// in a recipe, or a shared generator makes every effect depend on spawn order.
function hash(seed, i) {
  const s = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// A direction within `spread` radians of +Z, deterministic in (seed, i).
function cone(seed, i, spread) {
  const a = hash(seed, i) * Math.PI * 2;
  // cosine-ish distribution so the middle of the cone is denser than its rim,
  // which is what a real spray does and what an even one conspicuously does not
  const t = Math.acos(1 - hash(seed, i + 977) * (1 - Math.cos(spread)));
  const st = Math.sin(t);
  return [Math.cos(a) * st, Math.sin(a) * st, Math.cos(t)];
}

const softDot = (() => {
  let tex = null;
  return () => {
    if (tex || typeof document === 'undefined') return tex;
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    tex = new THREE.CanvasTexture(c);
    return tex;
  };
})();

// --- SPARK SHOWER ----------------------------------------------------------
// Hot chips off the surface. The two things that make them read as METAL
// rather than as confetti: they FALL (gravity along -Z, the surface's own
// down) and they BOUNCE off the plane they were struck from, instead of
// sinking through it. A spark that passes through the wall it came off tells
// the eye there is no wall.
export function makeSparks(tune = IMPACT_TUNE, colorHex = 0xffd08a, seed = 1) {
  const n = Math.max(0, Math.round(tune.sparkCount));
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  const life = new Float32Array(n);
  const c = new THREE.Color(colorHex);
  for (let i = 0; i < n; i++) {
    const d = cone(seed, i, tune.sparkSpread);
    const sp = tune.sparkSpeed * (0.45 + hash(seed, i + 51) * 0.9);
    vel[i * 3] = d[0] * sp; vel[i * 3 + 1] = d[1] * sp; vel[i * 3 + 2] = d[2] * sp;
    life[i] = tune.sparkLife * (0.6 + hash(seed, i + 133) * 0.7);
    const b = 0.75 + 0.25 * hash(seed, i + 200);
    col[i * 3] = c.r * b; col[i * 3 + 1] = c.g * b; col[i * 3 + 2] = c.b * b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: tune.sparkSize, sizeAttenuation: false, vertexColors: true,
    map: softDot(), alphaTest: 0.02,
    transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  let age = 0;
  const maxLife = tune.sparkLife * 1.3;
  pts.userData.tick = (dt) => {
    age += dt;
    for (let i = 0; i < n; i++) {
      if (age > life[i]) continue;
      vel[i * 3 + 2] -= tune.sparkGravity * dt;      // +Z is out of the surface
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      // the surface is the z=0 plane in local space: bounce, never pass through
      if (pos[i * 3 + 2] < 0) {
        pos[i * 3 + 2] = -pos[i * 3 + 2] * tune.sparkBounce;
        vel[i * 3 + 2] = -vel[i * 3 + 2] * tune.sparkBounce;
        vel[i * 3] *= 0.7; vel[i * 3 + 1] *= 0.7;    // friction on the skid
      }
    }
    geo.attributes.position.needsUpdate = true;
    mat.opacity = Math.max(0, 1 - age / maxLife);
    return age < maxLife;
  };
  pts.userData.kind = 'fx';
  return pts;
}

// --- FLASH -----------------------------------------------------------------
// The pop. Concentric additive discs facing the camera, gone in ~0.13s — it
// is the shortest-lived thing here on purpose: a flash you can look at is a
// lamp, and the eye reads a lamp as a light source rather than an event.
export function makeFlash(tune = IMPACT_TUNE, colorHex = 0xfff3d0) {
  const grp = new THREE.Group();
  const rings = Math.max(1, Math.round(tune.flashRings));
  const mats = [];
  for (let i = 0; i < rings; i++) {
    const m = new THREE.MeshBasicMaterial({
      color: new THREE.Color(colorHex), transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const q = new THREE.Mesh(new THREE.CircleGeometry(tune.flashSize * (1 - i * 0.28), 20), m);
    q.position.z = 0.01 * (i + 1);
    grp.add(q); mats.push(m);
  }
  let age = 0;
  grp.userData.tick = (dt) => {
    age += dt;
    const u = age / tune.flashLife;
    // fast attack, faster decay — the shape of every real flash
    const k = u < 0.18 ? u / 0.18 : Math.max(0, 1 - (u - 0.18) / 0.82);
    for (let i = 0; i < mats.length; i++) mats[i].opacity = k * (1 - i * 0.22);
    grp.scale.setScalar(0.7 + u * 0.8);
    return age < tune.flashLife;
  };
  grp.userData.kind = 'fx';
  return grp;
}

// --- SHOCKWAVE RING --------------------------------------------------------
// Lies ON the surface (the local z=0 plane), so it is the one effect that
// tells you the geometry of what was hit — it deforms around nothing, it just
// spreads flat, and a flat spreading ring is what says "a plane is here".
export function makeRing(tune = IMPACT_TUNE, colorHex = 0x9fe4ff) {
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(colorHex), transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), mat);
  mesh.position.z = 0.012;   // off the surface, or it z-fights the wall
  let age = 0;
  mesh.userData.tick = (dt) => {
    age += dt;
    const u = Math.min(1, age / tune.ringLife);
    const r = 0.05 + u * tune.ringEnd;
    mesh.scale.set(r, r, 1);
    // the ring THINS as it grows: a constant-width ring reads as a rubber
    // band being stretched rather than as energy running out
    mat.opacity = 0.9 * (1 - u) * (1 - u);
    return age < tune.ringLife;
  };
  mesh.userData.kind = 'fx';
  return mesh;
}

// --- SCORCH ----------------------------------------------------------------
// The mark that outlives the hit. Everything else here is over in under two
// seconds; without this, a wall that has been shot fifty times looks exactly
// like a wall that has never been touched, and the player has no record of
// their own aim.
export function makeScorch(tune = IMPACT_TUNE, colorHex = 0x120c08) {
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(colorHex), transparent: true, opacity: 0.85,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(tune.scorchSize, 18), mat);
  mesh.position.z = 0.006;
  let age = 0;
  mesh.userData.tick = (dt) => {
    age += dt;
    const u = age / tune.scorchLife;
    // it does NOT shrink — a scorch that shrinks reads as an animal. It only
    // fades, and it holds full strength for the first third of its life.
    mat.opacity = 0.85 * (u < 0.33 ? 1 : 1 - (u - 0.33) / 0.67);
    return age < tune.scorchLife;
  };
  mesh.userData.kind = 'fx';
  return mesh;
}

// --- DEBRIS ----------------------------------------------------------------
// Solid tumbling fragments. These are the heaviest thing in the set and the
// only family with FACES — a shell knocks pieces off a wall, and a piece is
// something with a silhouette. Sparks cannot do this job: a chip that catches
// the light as it turns is the whole read.
export function makeChunks(tune = IMPACT_TUNE, colorHex = 0x8a8f94, seed = 3) {
  const n = Math.max(0, Math.round(tune.debrisCount));
  const grp = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(colorHex), roughness: 0.85, metalness: 0.3,
    transparent: true, opacity: 1,
  });
  const bits = [];
  for (let i = 0; i < n; i++) {
    const s = tune.debrisSize * (0.5 + hash(seed, i) * 1.1);
    const m = new THREE.Mesh(new THREE.TetrahedronGeometry(s), mat);
    const d = cone(seed, i, 1.1);
    const sp = tune.debrisSpeed * (0.4 + hash(seed, i + 61) * 1.0);
    bits.push({
      m, v: [d[0] * sp, d[1] * sp, d[2] * sp],
      spin: [(hash(seed, i + 11) - 0.5) * 14, (hash(seed, i + 22) - 0.5) * 14, (hash(seed, i + 33) - 0.5) * 14],
      life: tune.debrisLife * (0.6 + hash(seed, i + 99) * 0.8),
    });
    grp.add(m);
  }
  let age = 0;
  const maxLife = tune.debrisLife * 1.4;
  grp.userData.tick = (dt) => {
    age += dt;
    for (const b of bits) {
      if (age > b.life) { b.m.visible = false; continue; }
      b.v[2] -= tune.sparkGravity * dt;
      b.m.position.x += b.v[0] * dt;
      b.m.position.y += b.v[1] * dt;
      b.m.position.z += b.v[2] * dt;
      if (b.m.position.z < 0) {
        b.m.position.z = -b.m.position.z * 0.3;
        b.v[2] = -b.v[2] * 0.3;
        b.v[0] *= 0.6; b.v[1] *= 0.6;
        b.spin[0] *= 0.5; b.spin[1] *= 0.5; b.spin[2] *= 0.5;
      }
      b.m.rotation.x += b.spin[0] * dt;
      b.m.rotation.y += b.spin[1] * dt;
      b.m.rotation.z += b.spin[2] * dt;
    }
    mat.opacity = Math.max(0, 1 - Math.max(0, age - maxLife * 0.6) / (maxLife * 0.4));
    mat.transparent = mat.opacity < 1;
    return age < maxLife;
  };
  grp.userData.kind = 'fx';
  return grp;
}

// --- PLASMA SPLASH ---------------------------------------------------------
// Molten matter that STICKS. It is thrown like a spark, but on touching the
// surface it keeps only `cling` of its speed and then sags — so the effect
// ends as a set of drips running down a wall rather than as a cloud that went
// away. That persistence is what separates plasma from a spark shower; both
// are bright specks in the first 100ms.
export function makeSplash(tune = IMPACT_TUNE, colorHex = 0x9dffcf, seed = 5) {
  const n = Math.max(0, Math.round(tune.splashCount));
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  const stuck = new Uint8Array(n);
  const c = new THREE.Color(colorHex);
  for (let i = 0; i < n; i++) {
    const d = cone(seed, i, 1.25);
    const sp = 3.0 * (0.35 + hash(seed, i + 71) * 1.0);
    vel[i * 3] = d[0] * sp; vel[i * 3 + 1] = d[1] * sp; vel[i * 3 + 2] = d[2] * sp;
    const b = 0.7 + 0.3 * hash(seed, i + 210);
    col[i * 3] = c.r * b; col[i * 3 + 1] = c.g * b; col[i * 3 + 2] = c.b * b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 5.0, sizeAttenuation: false, vertexColors: true, map: softDot(), alphaTest: 0.02,
    transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  let age = 0;
  pts.userData.tick = (dt) => {
    age += dt;
    for (let i = 0; i < n; i++) {
      if (stuck[i]) {
        // stuck to the wall: it no longer flies, it RUNS DOWN it
        vel[i * 3 + 1] -= tune.splashSag * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        continue;
      }
      vel[i * 3 + 2] -= tune.sparkGravity * 0.4 * dt;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      if (pos[i * 3 + 2] <= 0.01) {
        pos[i * 3 + 2] = 0.01;
        stuck[i] = 1;
        vel[i * 3] = 0; vel[i * 3 + 2] = 0;
        vel[i * 3 + 1] *= (1 - tune.splashCling);
      }
    }
    geo.attributes.position.needsUpdate = true;
    mat.opacity = Math.max(0, 1 - age / tune.splashLife);
    return age < tune.splashLife;
  };
  pts.userData.kind = 'fx';
  return pts;
}

// --- EMBERS ----------------------------------------------------------------
// The slow bright motes that outlast the bang. Everything else in this file is
// fast; the embers are what stop a hit ending all at once, and they are the
// cheapest way to make a big hit feel bigger than a small one — because the
// eye reads duration as size.
export function makeEmbers(tune = IMPACT_TUNE, colorHex = 0xffb060, seed = 7) {
  const n = Math.max(0, Math.round(tune.emberCount));
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  const phase = new Float32Array(n);
  const c = new THREE.Color(colorHex);
  for (let i = 0; i < n; i++) {
    const d = cone(seed, i, 1.4);
    const sp = 1.5 * (0.3 + hash(seed, i + 41) * 1.0);
    vel[i * 3] = d[0] * sp; vel[i * 3 + 1] = d[1] * sp; vel[i * 3 + 2] = d[2] * sp;
    phase[i] = hash(seed, i + 300) * 6.28;
    const b = 0.6 + 0.4 * hash(seed, i + 260);
    col[i * 3] = c.r * b; col[i * 3 + 1] = c.g * b; col[i * 3 + 2] = c.b * b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 3.2, sizeAttenuation: false, vertexColors: true, map: softDot(), alphaTest: 0.02,
    transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  let age = 0;
  pts.userData.tick = (dt) => {
    age += dt;
    const drag = Math.pow(tune.emberDrag, dt * 60);
    for (let i = 0; i < n; i++) {
      vel[i * 3] *= drag; vel[i * 3 + 2] *= drag;
      // buoyancy in the surface's own up (+Y in local space), plus a slow
      // wander so a dozen embers do not rise as one rigid formation
      vel[i * 3 + 1] = vel[i * 3 + 1] * drag + tune.emberRise * dt;
      pos[i * 3] += (vel[i * 3] + Math.sin(age * 1.7 + phase[i]) * 0.12) * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
    }
    geo.attributes.position.needsUpdate = true;
    // embers PULSE as they die — a cooling ember does not fade smoothly
    const u = age / tune.emberLife;
    mat.opacity = Math.max(0, (1 - u)) * (0.75 + 0.25 * Math.sin(age * 9));
    return age < tune.emberLife;
  };
  pts.userData.kind = 'fx';
  return pts;
}

const BUILDERS = {
  spark: makeSparks, flash: makeFlash, ring: makeRing, scorch: makeScorch,
  debris: makeChunks, splash: makeSplash, ember: makeEmbers,
};

// Build one family by name. Colours are per family and per caller, because a
// laser's sparks are not a shell's sparks — the colour is most of what says
// which weapon hit you.
export function makeImpact(family, tune = IMPACT_TUNE, colorHex, seed = 1) {
  const b = BUILDERS[family];
  return b ? b(tune, colorHex, seed) : null;
}

// A whole recipe, as one group the caller positions and orients ONCE. `tick`
// returns false only when every family in it has finished, so a caller can
// drop the group in a debris array and forget it.
// SIZE IS ONE NUMBER, and it belongs on the group rather than in the tune.
// The same hit has to serve a 4-unit wall in this lab and a cell on the
// sphere that is a fiftieth of that; retuning twenty knobs for each would
// give two effects that drift apart. The caller scales the group and every
// family inside it comes along — which works precisely because they are all
// authored in local space around the origin.
export function makeImpactBurst(recipe, tune = IMPACT_TUNE, colors = {}, seed = 1, size = 1) {
  const names = Array.isArray(recipe) ? recipe : (IMPACT_RECIPES[recipe] || IMPACT_RECIPES.light);
  const grp = new THREE.Group();
  const parts = [];
  names.forEach((name, i) => {
    const o = makeImpact(name, tune, colors[name], seed + i * 17);
    if (!o) return;
    grp.add(o);
    parts.push(o);
  });
  grp.userData.tick = (dt) => {
    let alive = false;
    for (const p of parts) {
      if (!p.visible) continue;
      if (p.userData.tick(dt)) alive = true;
      else p.visible = false;
    }
    return alive;
  };
  grp.scale.setScalar(size);
  grp.userData.kind = 'fx';
  grp.userData.families = names;
  return grp;
}

// ORIENT AN IMPACT. Every effect is authored with +Z along the surface
// normal, so a caller has exactly one job: put the group at the contact point
// and turn its +Z to face out of the surface. Deriving this here rather than
// at each call site is the point — three call sites deriving a basis is three
// chances to pick a different sign convention, which is the recurring bug
// this project keeps paying for.
export function orientImpact(obj, point, normal, up = [0, 1, 0]) {
  obj.position.set(point[0], point[1], point[2]);
  const n = new THREE.Vector3(normal[0], normal[1], normal[2]).normalize();
  const u = new THREE.Vector3(up[0], up[1], up[2]);
  if (Math.abs(u.dot(n)) > 0.98) u.set(1, 0, 0);       // degenerate: pick another
  const x = new THREE.Vector3().crossVectors(u, n).normalize();
  const y = new THREE.Vector3().crossVectors(n, x).normalize();
  obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, n));
  return obj;
}
