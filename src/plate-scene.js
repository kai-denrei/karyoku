// plate-scene.js — the plate as three.js objects, shared by every tab that
// shows one. Takes a Plate and a catalog; decides nothing about layout.
// Kit pieces with a file are drawn as InstancedMeshes (one per material),
// gates optionally as animated clones (one each, never instanced), turrets
// as clones with their YAW pivot exposed, and everything else as a labelled
// placeholder box of its footprint.
import * as THREE from '../vendor/three.module.js';
import { KIND, CELL_M, ringCoverage } from './plate.js?v=9868bf29';
import { fileFor, SECTION_COLOR, PLACEHOLDER_HEIGHT_M } from './catalog.js?v=9868bf29';
import { loadGlb, loadGlbWithClips, mergeByMaterial, fitModel } from './glbmodels.js?v=9868bf29';

const labelCache = new Map();
function labelTexture(text) {
  if (labelCache.has(text)) return labelCache.get(text);
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 64);
  g.fillStyle = '#e8eef6'; g.font = '30px ui-monospace, Menlo, monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text.replace(/^[a-z]+_/, ''), 128, 32);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  labelCache.set(text, t);
  return t;
}

// One merged prototype per model URL. Static pieces merge fully; a caller
// names the pivots that must keep moving. A load that fails resolves to
// null and the piece stays a placeholder.
const protos = new Map();
export function proto(url, pivots = [], fit = null) {
  if (protos.has(url)) return protos.get(url);
  const p = loadGlb(url).then((scene) => {
    if (!scene) return null;
    const merged = mergeByMaterial(scene, pivots);
    return fit ? fitModel(merged, fit) : merged;
  });
  protos.set(url, p);
  return p;
}

// ...and the same for a model that must keep its clips: the pivots are
// read off the clip's own tracks, so whatever the animation moves survives
// the merge. Resolves { root, clips } or null.
const animProtos = new Map();
export function animProto(url) {
  if (animProtos.has(url)) return animProtos.get(url);
  const p = loadGlbWithClips(url).then((res) => {
    if (!res || !res.scene) return null;
    const pivots = new Set();
    for (const c of res.clips) for (const tr of c.tracks) pivots.add(String(tr.name).split('.')[0]);
    return { root: mergeByMaterial(res.scene, [...pivots]), clips: res.clips };
  });
  animProtos.set(url, p);
  return p;
}

export const sentryUrl = (family, tier) => `assets/models/sentries/${family}_t${tier}.glb`;

// Every mesh of a prototype, with its transform relative to the prototype
// root, so a set of pieces can be drawn as InstancedMeshes.
function meshesOf(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const out = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    out.push({ geometry: o.geometry, material: o.material, local: new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld) });
  });
  return out;
}

function instanced(root, pieces, transformOf) {
  const g = new THREE.Group();
  const m = new THREE.Matrix4();
  for (const part of meshesOf(root)) {
    const im = new THREE.InstancedMesh(part.geometry, part.material, pieces.length);
    pieces.forEach((piece, i) => { im.setMatrixAt(i, m.multiplyMatrices(transformOf(piece), part.local)); });
    im.instanceMatrix.needsUpdate = true;
    g.add(im);
  }
  return g;
}

function placeholderMesh(piece, entry) {
  const h = piece.kind === KIND.SENTRY ? 0.6 : (PLACEHOLDER_HEIGHT_M[entry.section] || 2);
  const inset = piece.kind === KIND.BUILDING ? 0.6 : 0.2;
  const geo = new THREE.BoxGeometry(piece.pw * CELL_M - inset * 2, h, piece.ph * CELL_M - inset * 2);
  const mat = new THREE.MeshStandardMaterial({ color: SECTION_COLOR[entry.section] || 0x888888, roughness: 0.85, metalness: 0.1 });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = h / 2;
  const g = new THREE.Group();
  g.add(m);
  if (piece.kind === KIND.BUILDING) {
    const lw = Math.min(piece.pw, piece.ph) * CELL_M * 0.9;
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(lw, lw * 0.25),
      new THREE.MeshBasicMaterial({ map: labelTexture(piece.id), transparent: true, depthWrite: false }));
    lab.rotation.x = -Math.PI / 2;
    lab.position.y = h + 0.05;
    g.add(lab);
    // an entrance tick on the S face at rot 0 (+z), so the rotation is visible
    const tick = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 0.4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    tick.position.set(0, 0.15, (piece.ph * CELL_M) / 2 - inset - 0.2);
    g.add(tick);
  }
  return g;
}

// piece -> world transform. Rect centre in cells, plus the piece's own
// outward offset (the gate), then rot: clockwise from above is a NEGATIVE
// rotation about +y.
export function placePiece(obj, piece) {
  obj.position.set((piece.x + piece.pw / 2 + piece.offset[0]) * CELL_M, 0, (piece.z + piece.ph / 2 + piece.offset[1]) * CELL_M);
  obj.rotation.y = -piece.rot * Math.PI / 2;
}
const pieceMatrix = (piece) => {
  const o = new THREE.Object3D();
  placePiece(o, piece);
  o.updateMatrix();
  return o.matrix.clone();
};

// yaw 0 is N (-z): direction (sin yaw, -cos yaw)
function arcWedge(st) {
  const R = 9 * CELL_M, n = 24;
  const a0 = (st.yawDeg - st.arcDeg / 2) * Math.PI / 180, a1 = (st.yawDeg + st.arcDeg / 2) * Math.PI / 180;
  const pos = [0, 0.08, 0];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * i / n;
    pos.push(Math.sin(a) * R, 0.08, -Math.cos(a) * R);
  }
  const idxs = [];
  for (let i = 1; i <= n; i++) idxs.push(0, i, i + 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idxs);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xc0392b, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
  m.position.set((st.x + 1) * CELL_M, 0, (st.z + 1) * CELL_M);
  return m;
}

// The turret's authored forward is its +z, which is S here; yaw 0 faces N.
export const yawRotation = (yawDeg) => Math.PI - yawDeg * Math.PI / 180;

export function buildPlateGroup({ plate, catalog, wallState = 0, showArcs = true, showBlind = true, animatedGates = false }) {
  const group = new THREE.Group();
  const sentryYaws = new Map();   // sentry index -> the node to turn
  const gateRigs = [];            // { index, obj, mixer, action, duration }
  const pending = [];
  const W = plate.w * CELL_M, H = plate.h * CELL_M;

  const slab = new THREE.Mesh(new THREE.BoxGeometry(W, 0.4, H), new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.95 }));
  slab.position.set(W / 2, -0.2, H / 2);
  group.add(slab);
  const grid = new THREE.GridHelper(Math.max(W, H), Math.max(plate.w, plate.h), 0x2a3140, 0x1c212b);
  grid.position.set(Math.max(W, H) / 2, 0.02, Math.max(W, H) / 2);
  group.add(grid);

  const fallback = (piece) => { const obj = placeholderMesh(piece, catalog.get(piece.id)); placePiece(obj, piece); group.add(obj); };
  const byModel = new Map(); // url -> pieces drawn from it
  for (const piece of plate.pieces) {
    const entry = catalog.get(piece.id);
    if (!entry) continue;
    const state = piece.kind === KIND.WALL ? wallState : piece.state;
    const url = entry.placeholder ? null : fileFor(entry, state);
    if (!url) { fallback(piece); continue; }
    if (animatedGates && piece.kind === KIND.GATE) {
      const gi = plate.gates.findIndex((g) => g.pieceIndex === plate.pieces.indexOf(piece));
      pending.push(animProto(url).then((res) => {
        if (!res) { fallback(piece); return; }
        const obj = res.root.clone();
        placePiece(obj, piece);
        group.add(obj);
        const clip = res.clips.find((c) => /open/i.test(c.name)) || res.clips[0];
        let mixer = null, action = null;
        if (clip) {
          mixer = new THREE.AnimationMixer(obj);
          action = mixer.clipAction(clip);
          action.play();
          action.paused = true;
          mixer.setTime(0);
        }
        gateRigs.push({ index: gi, obj, mixer, action, duration: clip ? clip.duration : 0 });
      }));
      continue;
    }
    if (!byModel.has(url)) byModel.set(url, []);
    byModel.get(url).push(piece);
  }
  for (const [url, pieces] of byModel) {
    pending.push(proto(url).then((root) => {
      if (!root) { for (const piece of pieces) fallback(piece); return; }
      group.add(instanced(root, pieces, pieceMatrix));
    }));
  }
  plate.sentries.forEach((st, index) => {
    if (showArcs) group.add(arcWedge(st));
    pending.push(proto(sentryUrl(st.family, st.tier), ['YAW', 'PITCH', 'RECOIL'], { height: 4.5, maxSpan: 7 }).then((root) => {
      if (!root) return;
      const inst = root.clone();
      const yaw = inst.getObjectByName('YAW') || inst;
      yaw.rotation.y = yawRotation(st.yawDeg);
      inst.position.set((st.x + 1) * CELL_M, 0.6, (st.z + 1) * CELL_M);
      group.add(inst);
      sentryYaws.set(index, yaw);
    }));
  });
  if (showBlind) {
    for (const c of ringCoverage(plate)) {
      if (c.covered) continue;
      const m = new THREE.Mesh(new THREE.BoxGeometry(CELL_M * 0.5, 0.2, CELL_M * 0.5), new THREE.MeshBasicMaterial({ color: 0x2ecc71 }));
      m.position.set((c.x + 0.5) * CELL_M, 3.8, (c.z + 0.5) * CELL_M);
      group.add(m);
    }
  }
  console.log('[plate] models', byModel.size, 'pieces', plate.pieces.length, 'sentries', plate.sentries.length, 'warnings', plate.warnings.length);
  return { group, sentryYaws, gateRigs, ready: Promise.all(pending) };
}
