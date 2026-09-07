// crew-scene.js — the crew on screen: the workshop's three station
// characters (astronaut, scientist, worker), low-poly, one skin each and
// seven clips (Idle, Walk, Run, Kneel, Scared, Point, Lie). Each model is
// loaded ONCE and every walker is a skinned clone of it (a bone-aware
// clone, the way SkeletonUtils does it, since the skeleton must be rebound
// to the clone's own bones). The walker's `act` picks the clip; weights
// crossfade so a change of mind does not snap. The dead lie where they
// fell, on the red splash — the Amiga moment with a body in it.
import * as THREE from '../vendor/three.module.js';
import { loadGlbWithClips } from './glbmodels.js?v=8e468128';
import { CREW_KINDS, CREW_PAINT, TEAM_PAINT } from './crew.js?v=8e468128';
import { BZ, styleForLook } from './looks.js?v=8e468128';

export const CREW_URLS = CREW_KINDS.map((k) => `assets/crew/${k}_station.glb`);
const AUTHORED_M = 2.1, PERSON_M = 1.8;
const FADE = 0.18; // s, between clips
const CLIPS = { idle: 'Idle', walk: 'Walk', run: 'Run', point: 'Point', kneel: 'Kneel', scared: 'Scared', lie: 'Lie' };

// THE BACKPACK is not a material of its own in the kit, so it is cut out
// by POSITION once per model: every triangle of a body part that sits
// behind the spine (model -z) between hip and shoulder height becomes a
// second skinned mesh, and that mesh wears the team's colour per walker.
const BACK_Z = -0.11, BACK_Y0 = 0.85, BACK_Y1 = 1.65;
const teamMats = new Map(); // side -> material
function teamMat(side) {
  if (!teamMats.has(side)) teamMats.set(side, BZ ? new THREE.MeshBasicMaterial({ color: TEAM_PAINT[side], wireframe: true }) : new THREE.MeshStandardMaterial({ color: TEAM_PAINT[side], roughness: 0.55, metalness: 0.2 }));
  return teamMats.get(side);
}
const prepared = new Set();
function prepareModel(res, kind) {
  if (prepared.has(res)) return;
  prepared.add(res);
  const paint = new THREE.Color(CREW_PAINT[CREW_KINDS[kind]]);
  const backs = [];
  res.scene.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const name = (o.material && o.material.name) || '';
    if (/suit/.test(name)) o.material.color.copy(paint);
    const g = o.geometry;
    const pos = g.attributes.position;
    const idx = g.index ? Array.from(g.index.array) : [...Array(pos.count).keys()];
    const back = [], front = [];
    const isBack = (i) => pos.getZ(i) < BACK_Z && pos.getY(i) > BACK_Y0 && pos.getY(i) < BACK_Y1;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      (isBack(a) && isBack(b) && isBack(c) ? back : front).push(a, b, c);
    }
    if (back.length < 30 || /visor|status|marking/.test(name)) return; // nothing worth a colour here
    const bg = g.clone(); bg.setIndex(back);
    g.setIndex(front);
    const bm = new THREE.SkinnedMesh(bg, o.material);
    bm.name = 'backpack';
    bm.bindMode = o.bindMode; bm.bindMatrix.copy(o.bindMatrix);
    bm.skeleton = o.skeleton;
    bm.bind(o.skeleton, o.bindMatrix);
    backs.push({ parent: o.parent, mesh: bm, from: name });
  });
  for (const b of backs) b.parent.add(b.mesh);
  console.log(`[crew] ${CREW_KINDS[kind]}: backpack cut from ${backs.map((b) => b.from.split('/').pop().trim()).join(', ') || 'nothing'}`);
}

// SkeletonUtils.clone, the part of it a skinned GLB needs
function cloneSkinned(source) {
  const sourceLookup = new Map(), cloneLookup = new Map();
  const clone = source.clone();
  const pair = (a, b) => { sourceLookup.set(b, a); cloneLookup.set(a, b); for (let i = 0; i < a.children.length; i++) pair(a.children[i], b.children[i]); };
  pair(source, clone);
  clone.traverse((node) => {
    if (!node.isSkinnedMesh) return;
    const src = sourceLookup.get(node);
    node.skeleton = src.skeleton.clone();
    node.bindMatrix.copy(src.bindMatrix);
    node.skeleton.bones = src.skeleton.bones.map((bone) => cloneLookup.get(bone));
    node.bind(node.skeleton, node.bindMatrix);
  });
  return clone;
}

// one walker of a kind: { obj, setPose, tick }, or null when the model failed
export async function makeWalkerRig(kind, side = 'home') {
  const res = await loadGlbWithClips(CREW_URLS[kind % CREW_URLS.length]);
  if (!res) return null;
  prepareModel(res, kind % CREW_URLS.length);
  const scene = cloneSkinned(res.scene);
  scene.traverse((o) => { if (o.name === 'backpack') o.material = teamMat(side); });
  scene.scale.setScalar(PERSON_M / AUTHORED_M);
  if (BZ) styleForLook(scene);
  else scene.traverse((o) => { if (o.isMesh && o.material && o.material.emissive) o.material.emissive.setHex(0x000000); });
  const obj = new THREE.Group();
  obj.add(scene);
  const mixer = new THREE.AnimationMixer(scene);
  const acts = {};
  for (const [act, name] of Object.entries(CLIPS)) {
    const clip = res.clips.find((c) => c.name === name);
    if (!clip) continue;
    const a = mixer.clipAction(clip);
    if (act === 'lie') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    a.play();
    a.setEffectiveWeight(act === 'idle' ? 1 : 0);
    acts[act] = a;
  }
  let mode = 'idle';
  const weights = { idle: 1 };
  return {
    obj,
    // the model's authored forward is +z; heading 0 is north (-z)
    setPose(x, y, z, headingDeg, act) {
      obj.position.set(x, y, z);
      obj.rotation.y = Math.PI - headingDeg * Math.PI / 180;
      const want = acts[act] ? act : (act === 'run' && acts.walk ? 'walk' : 'idle');
      if (want !== mode) { mode = want; if (want === 'lie' && acts.lie) acts.lie.reset().play(); }
    },
    tick(dt) {
      // crossfade toward the wanted clip
      for (const [k, a] of Object.entries(acts)) {
        const target = k === mode ? 1 : 0;
        const cur = weights[k] ?? 0;
        const next = cur + Math.max(-1, Math.min(1, (target - cur))) * Math.min(1, dt / FADE);
        weights[k] = next;
        a.setEffectiveWeight(next);
      }
      mixer.update(dt);
    },
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

// A plate's crew as objects: built lazily, in order, so a slow load never
// stalls the frame. `sync(dt, groundY, near)` poses whoever is ready, lays
// a splash for whoever died since last frame, and leaves the body lying.
export function makeCrewScene(group, crew) {
  const rigs = [];
  const asked = new Set();
  const splatted = new Set();
  let announced = false;
  // rigs are made on demand, in order, so a crew that GROWS (rescued
  // walkers unloading at home) gets its new members drawn too
  const ensure = (i) => {
    if (asked.has(i)) return;
    asked.add(i);
    makeWalkerRig(crew.walkers[i].kind || 0, crew.hostile ? 'hostile' : 'home').then((rig) => {
      if (!rig) return;
      rigs[i] = rig;
      if (!crew.walkers[i].gone) group.add(rig.obj);
      if (!announced && rigs.filter(Boolean).length >= Math.min(crew.walkers.length, 3)) { announced = true; console.log(`[crew] ${crew.walkers.length} walkers: ${crew.walkers.map((w) => CREW_KINDS[w.kind || 0]).join(' ')}`); }
    });
  };
  return {
    group,
    sync(dt, groundY = () => 0, near = null) {
      crew.walkers.forEach((w, i) => {
        if (!asked.has(i)) ensure(i);
        const rig = rigs[i];
        // gone: aboard the hull or through a door; no body, no splash
        if (w.gone) { if (rig && rig.obj.parent) group.remove(rig.obj); return; }
        if (!w.alive && !splatted.has(w)) { splatted.add(w); group.add(makeSplat(w.x, groundY(w.x, w.z), w.z)); }
        if (!rig) return;
        const show = !near || near(w.x, w.z);
        rig.obj.visible = show;
        if (!show) return;
        rig.setPose(w.x, groundY(w.x, w.z), w.z, w.heading, w.act || 'idle');
        rig.tick(dt);
      });
    },
  };
}
