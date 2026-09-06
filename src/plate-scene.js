// plate-scene.js — the plate as three.js objects, shared by every tab that
// shows one. Takes a Plate and a catalog; decides nothing about layout.
// Kit pieces with a file are drawn as InstancedMeshes (one per material),
// gates optionally as animated clones (one each, never instanced), turrets
// as clones with their YAW pivot exposed, and everything else as a labelled
// placeholder box of its footprint.
import * as THREE from '../vendor/three.module.js';
import { KIND, CELL_M, ringCoverage } from './plate.js?v=965abc95';
import { fileFor, fitFor, SECTION_COLOR, PLACEHOLDER_HEIGHT_M } from './catalog.js?v=965abc95';
import { LOB_FAMILIES, LOB_ELEV_DEG } from './drive.js?v=965abc95';
import { PALETTE, neonBox } from './looks.js?v=965abc95';
import { prepFor, ladderTint, dressMetal } from './casts.js?v=965abc95';
import { tintModel } from './glbmodels.js?v=965abc95';
import { BODY_IDS } from './drive.js?v=965abc95';
import { loadGlb, loadGlbWithClips, mergeByMaterial, fitModel } from './glbmodels.js?v=965abc95';

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
export function proto(url, pivots = [], fit = null, tint = null) {
  const key = url + (fit ? JSON.stringify(fit) : '') + (tint !== null ? '#' + tint : '');
  if (protos.has(key)) return protos.get(key);
  const p = loadGlb(url).then((scene) => {
    if (!scene) return null;
    // the cast's own prep (empty the container, repaint the terraformer)
    // BEFORE the merge welds its parts away
    const prep = prepFor(url);
    if (prep) prep(scene);
    const merged = mergeByMaterial(scene, pivots);
    const fitted = fit ? fitModel(merged, fit) : merged;
    // THE KIT KEEPS ITS PAINT. Its materials are authored colours — blue
    // steel, graphite, amber caution, mint status — and the grey ladder
    // painted over all of them. A faint emissive wash by side is all it gets.
    if (tint !== null) {
      if (url.startsWith('assets/base-kit/')) tintModel(fitted, tint, { wash: 0.10 });
      else { ladderTint(fitted, tint); dressMetal(fitted); }
    }
    return fitted;
  });
  protos.set(key, p);
  return p;
}
// a catalog state's fit as fitModel's options: scaled to sit inside the
// footprint (span) and under a height, whichever binds first
const fitOf = (entry, state) => { const f = fitFor(entry, state); return f ? { height: f.height, maxSpan: f.span } : null; };

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
  const m = neonBox(piece.pw * CELL_M - inset * 2, h, piece.ph * CELL_M - inset * 2, PALETTE.section[entry.section] || 0x888888);
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
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xc0392b, transparent: true, opacity: 0.09, side: THREE.DoubleSide, depthWrite: false }));
  m.position.set((st.x + 1) * CELL_M, 0, (st.z + 1) * CELL_M);
  return m;
}

// The turret's authored forward is its +z, which is S here; yaw 0 faces N.
export const yawRotation = (yawDeg) => Math.PI - yawDeg * Math.PI / 180;

// `wallState` forces every wall to one state (the plate tab's selector);
// null draws each wall at its own `piece.state`, and `rebuildWalls()` redraws
// them after a shot changed one.
// Scrub a gate rig to a fraction open. NOT mixer.setTime on a paused
// action: a paused action ignores it and the gate stays shut while the
// rules say open (measured: actionTime 0.00 at open 1.00). The action's own
// clock is set and the mixer evaluated with a zero step.
export function setGateOpen(gr, open) {
  if (!gr.action || !gr.mixer) return;
  gr.action.time = Math.max(0, Math.min(gr.duration, open * gr.duration));
  gr.mixer.update(0);
}

export function buildPlateGroup({ plate, catalog, wallState = 0, showArcs = true, showBlind = true, animatedGates = false, tint = PALETTE.home }) {
  const group = new THREE.Group();
  const sentryYaws = new Map();   // sentry index -> the node to turn
  const gateRigs = [];            // { index, obj, mixer, action, duration }
  const dynamic = new Map();      // piece index -> its own object, for the bodies the drive moves
  const pending = [];
  const W = plate.w * CELL_M, H = plate.h * CELL_M;

  const slab = new THREE.Mesh(new THREE.BoxGeometry(W, 0.4, H), new THREE.MeshStandardMaterial({ color: PALETTE.slab, roughness: 0.95 }));
  slab.position.set(W / 2, -0.2, H / 2);
  group.add(slab);
  const grid = new THREE.GridHelper(Math.max(W, H), Math.max(plate.w, plate.h), PALETTE.grid, PALETTE.grid);
  grid.material.transparent = true; grid.material.opacity = 0.45;
  grid.position.set(Math.max(W, H) / 2, 0.02, Math.max(W, H) / 2);
  group.add(grid);

  const fallback = (piece) => { const obj = placeholderMesh(piece, catalog.get(piece.id)); placePiece(obj, piece); group.add(obj); };
  const wallObjs = [];
  function drawWalls() {
    for (const o of wallObjs) group.remove(o);
    wallObjs.length = 0;
    const byUrl = new Map();
    for (const piece of plate.pieces) {
      if (piece.kind !== KIND.WALL) continue;
      const entry = catalog.get(piece.id);
      if (!entry) continue;
      const url = entry.placeholder ? null : fileFor(entry, wallState === null ? piece.state : wallState);
      if (!url) { fallback(piece); continue; }
      if (!byUrl.has(url)) byUrl.set(url, []);
      byUrl.get(url).push(piece);
    }
    for (const [url, pieces] of byUrl) {
      pending.push(proto(url, [], null, tint).then((root) => {
        if (!root) { for (const piece of pieces) fallback(piece); return; }
        const g = instanced(root, pieces, pieceMatrix);
        wallObjs.push(g);
        group.add(g);
      }));
    }
    return byUrl.size;
  }
  const wallModels = drawWalls();
  const byModel = new Map(); // url -> pieces drawn from it
  for (const piece of plate.pieces) {
    const entry = catalog.get(piece.id);
    if (!entry || piece.kind === KIND.WALL) continue;
    const state = piece.state;
    const url = entry.placeholder ? null : fileFor(entry, state);
    if (!url) { fallback(piece); continue; }
    const fit = fitOf(entry, state);
    const mkey = fit ? url + JSON.stringify(fit) : url;
    if (BODY_IDS.has(piece.id)) {
      // a body is one object of its own, never an instance: the drive moves it
      const pi = plate.pieces.indexOf(piece);
      pending.push(proto(url, [], fit, tint).then((root) => {
        if (!root) { fallback(piece); return; }
        const obj = root.clone();
        placePiece(obj, piece);
        group.add(obj);
        dynamic.set(pi, obj);
      }));
      continue;
    }
    if (animatedGates && piece.kind === KIND.GATE) {
      const gi = plate.gates.findIndex((g) => g.pieceIndex === plate.pieces.indexOf(piece));
      pending.push(animProto(url).then((res) => {
        if (!res) { fallback(piece); return; }
        const obj = res.root.clone();
        tintModel(obj, tint, { wash: 0.10 });
        placePiece(obj, piece);
        group.add(obj);
        const clip = res.clips.find((c) => /open/i.test(c.name)) || res.clips[0];
        let mixer = null, action = null;
        if (clip) {
          mixer = new THREE.AnimationMixer(obj);
          action = mixer.clipAction(clip);
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
          action.play();
          mixer.update(0);
        }
        gateRigs.push({ index: gi, obj, mixer, action, duration: clip ? clip.duration : 0 });
      }));
      continue;
    }
    if (!byModel.has(mkey)) byModel.set(mkey, { url, fit, pieces: [] });
    byModel.get(mkey).pieces.push(piece);
  }
  for (const { url, fit, pieces } of byModel.values()) {
    const sectionTint = PALETTE.section[catalog.get(pieces[0].id).section] || tint;
    pending.push(proto(url, [], fit, sectionTint).then((root) => {
      if (!root) { for (const piece of pieces) fallback(piece); return; }
      group.add(instanced(root, pieces, pieceMatrix));
    }));
  }
  plate.sentries.forEach((st, index) => {
    if (showArcs) group.add(arcWedge(st));
    pending.push(proto(sentryUrl(st.family, st.tier), ['YAW', 'PITCH', 'RECOIL'], { height: 4.5, maxSpan: 7 }, tint).then((root) => {
      if (!root) return;
      const inst = root.clone();
      const yaw = inst.getObjectByName('YAW') || inst;
      yaw.rotation.y = yawRotation(st.yawDeg);
      // a lobber holds its barrel up: the workshop applies elevation as a
      // NEGATIVE rotation about x on the PITCH node
      const pitch = inst.getObjectByName('PITCH');
      if (pitch && LOB_FAMILIES.has(st.family)) pitch.rotation.x = -LOB_ELEV_DEG * Math.PI / 180;
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
  console.log('[plate] models', byModel.size + wallModels, 'pieces', plate.pieces.length, 'sentries', plate.sentries.length, 'warnings', plate.warnings.length);
  return { group, sentryYaws, gateRigs, dynamic, ready: Promise.all(pending), rebuildWalls: drawWalls };
}
