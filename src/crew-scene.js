// crew-scene.js — the astronauts on screen. The compact astronaut GLB is
// skinned (51 skins, three Mixamo clips), so a walker cannot be a clone of
// a shared prototype without SkeletonUtils: each one is PARSED fresh from
// the one downloaded buffer, which costs a parse per walker and nothing
// else. Suits are coloured per walker on the body materials.
import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { MeshoptDecoder } from '../vendor/meshopt_decoder.module.js';
import { fitModel, bustToken } from './glbmodels.js?v=b7486121';
import { SUITS } from './crew.js?v=b7486121';
import { styleForLook, BZ } from './looks.js?v=b7486121';

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

// One walker: { obj, mixer, walk, idle, setSuit }. Resolves null if the
// model cannot load, and the caller draws nothing for it.
export async function makeAstronaut(suitIndex = 0) {
  let gltf;
  try { gltf = await parseFresh(); } catch (e) { console.warn('[crew] astronaut failed to load', e); return null; }
  const scene = gltf.scene;
  const colour = new THREE.Color(SUITS[suitIndex % SUITS.length]);
  scene.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (SUIT_MATS.test(m.name || '')) { m.color.copy(colour); if (m.emissive) m.emissive.copy(colour).multiplyScalar(0.12); }
    }
  });
  // authored in centimetres; a person is PERSON_M tall here
  const obj = fitModel(scene, { height: PERSON_M, maxSpan: PERSON_M * 2 });
  // battlezone: a dense wireframe blooms into a blob at full brightness, so
  // the suit keeps its hue at half strength
  if (BZ) { styleForLook(obj); obj.traverse((o) => { if (o.isSkinnedMesh) { o.material = o.material.clone(); o.material.color.copy(colour).multiplyScalar(0.45); } }); }
  const mixer = new THREE.AnimationMixer(scene);
  const clipOf = (re) => gltf.animations.find((c) => re.test(c.name));
  const walkClip = clipOf(/walk/i), idleClip = clipOf(/idle/i);
  const walk = walkClip ? mixer.clipAction(walkClip) : null;
  const idle = idleClip ? mixer.clipAction(idleClip) : null;
  if (idle) { idle.play(); }
  if (walk) { walk.play(); walk.setEffectiveWeight(0); }
  let moving = false;
  return {
    obj, mixer,
    // the model's authored forward is +z; heading 0 is north (-z)
    setPose(x, y, z, headingDeg, isMoving) {
      obj.position.set(x, y, z);
      obj.rotation.y = Math.PI - headingDeg * Math.PI / 180;
      if (isMoving !== moving && walk && idle) {
        moving = isMoving;
        walk.setEffectiveWeight(moving ? 1 : 0);
        idle.setEffectiveWeight(moving ? 0 : 1);
      }
    },
    tick(dt) { mixer.update(dt); },
  };
}

// A plate's crew as objects: builds them lazily, in order, so a slow parse
// never stalls the frame. `sync(crew, groundY)` moves whoever is ready.
export function makeCrewScene(group, crew) {
  const rigs = new Array(crew.length).fill(null);
  (async () => {
    for (let i = 0; i < crew.length; i++) {
      const rig = await makeAstronaut(crew[i].suit);
      if (!rig) return;
      rigs[i] = rig;
      group.add(rig.obj);
    }
    console.log(`[crew] ${rigs.filter(Boolean).length} astronauts on the plate`);
  })();
  return {
    sync(dt, groundY = () => 0) {
      crew.forEach((w, i) => {
        const rig = rigs[i];
        if (!rig) return;
        rig.setPose(w.x, groundY(w.x, w.z), w.z, w.heading, w.moving);
        rig.tick(dt);
      });
    },
  };
}
