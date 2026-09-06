// crew-scene.js — the astronauts on screen. The compact astronaut GLB is
// skinned (51 skins, three Mixamo clips), so a walker cannot be a clone of
// a shared prototype without SkeletonUtils: each one is PARSED fresh from
// the one downloaded buffer. Orange suits, NOT glowing: the crew sits in a
// bloom group of weight zero. Walk, run and idle clips blend by state. A
// squashed walker leaves a red splash on the floor — the Amiga moment.
import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { MeshoptDecoder } from '../vendor/meshopt_decoder.module.js';
import { fitModel, bustToken } from './glbmodels.js?v=19ae0665';
import { SUIT } from './crew.js?v=19ae0665';
import { BZ } from './looks.js?v=19ae0665';

const ASTRO_URL = 'assets/models/astronaut-compact.glb';
const PERSON_M = 1.8;
const SUIT_MATS = /^mat_(body|body1|pauldrons|backpack|knee_pod|helmet_cap)$/;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
let bufferP = null;
function buffer() {
  if (!bufferP) bufferP = fetch(`${ASTRO_URL}${bustToken()}`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))));
  return bufferP;
}
function parseFresh() {
  return buffer().then((buf) => new Promise((resolve, reject) => loader.parse(buf.slice(0), '', resolve, reject)));
}

// One walker: { obj, setPose, tick }. Resolves null if the model cannot load.
export async function makeAstronaut() {
  let gltf;
  try { gltf = await parseFresh(); } catch (e) { console.warn('[crew] astronaut failed to load', e); return null; }
  const scene = gltf.scene;
  const colour = new THREE.Color(SUIT);
  scene.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (SUIT_MATS.test(m.name || '')) {
        // battlezone: a flat unlit orange, no emissive; colony: orange with the
        // suit's own shading — and in neither look does the crew bloom
        if (BZ) { o.material = new THREE.MeshBasicMaterial({ color: colour }); }
        else { m.color.copy(colour); if (m.emissive) m.emissive.setHex(0x000000); }
      }
    }
  });
  const obj = fitModel(scene, { height: PERSON_M, maxSpan: PERSON_M * 2 });
  const mixer = new THREE.AnimationMixer(scene);
  const clipOf = (re) => gltf.animations.find((c) => re.test(c.name));
  const acts = {
    walk: clipOf(/walk/i) ? mixer.clipAction(clipOf(/walk/i)) : null,
    run: clipOf(/run/i) ? mixer.clipAction(clipOf(/run/i)) : null,
    idle: clipOf(/idle/i) ? mixer.clipAction(clipOf(/idle/i)) : null,
  };
  for (const [k, a] of Object.entries(acts)) if (a) { a.play(); a.setEffectiveWeight(k === 'idle' ? 1 : 0); }
  let mode = 'idle';
  return {
    obj,
    // the model's authored forward is +z; heading 0 is north (-z)
    setPose(x, y, z, headingDeg, moving, running) {
      obj.position.set(x, y, z);
      obj.rotation.y = Math.PI - headingDeg * Math.PI / 180;
      const want = !moving ? 'idle' : running && acts.run ? 'run' : 'walk';
      if (want !== mode) {
        mode = want;
        for (const [k, a] of Object.entries(acts)) if (a) a.setEffectiveWeight(k === mode ? 1 : 0);
      }
    },
    tick(dt) { mixer.update(dt); },
  };
}

// A red splash on the floor: a flat blot at the spot, kept for the rest of
// the run. Red in both looks — that is the homage.
export function makeSplat(x, y, z) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xd8102a, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const blobs = [[0, 0, 1.4], [0.9, 0.4, 0.7], [-0.7, 0.6, 0.6], [0.3, -0.9, 0.5], [-0.5, -0.5, 0.45]];
  for (const [bx, bz, r] of blobs) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 14), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(bx, 0.04, bz);
    g.add(m);
  }
  g.position.set(x, y, z);
  return g;
}

// A plate's crew as objects: builds them lazily, in order, so a slow parse
// never stalls the frame. `sync(dt, groundY)` moves whoever is ready and
// lays a splash for whoever died since last frame.
export function makeCrewScene(group, crew) {
  const rigs = new Array(crew.walkers.length).fill(null);
  const splatted = new Set();
  (async () => {
    for (let i = 0; i < crew.walkers.length; i++) {
      const rig = await makeAstronaut();
      if (!rig) return;
      rigs[i] = rig;
      group.add(rig.obj);
    }
    console.log(`[crew] ${rigs.filter(Boolean).length} astronauts on the plate`);
  })();
  return {
    group,
    sync(dt, groundY = () => 0) {
      crew.walkers.forEach((w, i) => {
        const rig = rigs[i];
        if (!w.alive) {
          if (rig && rig.obj.parent) group.remove(rig.obj);
          if (!splatted.has(w)) { splatted.add(w); group.add(makeSplat(w.x, groundY(w.x, w.z), w.z)); }
          return;
        }
        if (!rig) return;
        rig.setPose(w.x, groundY(w.x, w.z), w.z, w.heading, w.moving, w.running);
        rig.tick(dt);
      });
    },
  };
}
