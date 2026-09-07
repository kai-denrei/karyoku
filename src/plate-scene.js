// plate-scene.js — the plate as three.js objects, shared by every tab that
// shows one. Takes a Plate and a catalog; decides nothing about layout.
// Kit pieces with a file are drawn as InstancedMeshes (one per material),
// gates optionally as animated clones (one each, never instanced), turrets
// as clones with their YAW pivot exposed, and everything else as a labelled
// placeholder box of its footprint.
import * as THREE from '../vendor/three.module.js';
import { KIND, CELL_M, ringCoverage, LANDMARK, dirOfYaw } from './plate.js?v=ef62a95e';
import { fileFor, fitFor, SECTION_COLOR, PLACEHOLDER_HEIGHT_M } from './catalog.js?v=ef62a95e';
import { LOB_FAMILIES, LOB_ELEV_DEG } from './drive.js?v=ef62a95e';
import { PALETTE, neonBox, BZ, styleForLook, bakeEdges } from './looks.js?v=ef62a95e';
import { prepFor, ladderTint, dressMetal } from './casts.js?v=ef62a95e';
import { tintModel } from './glbmodels.js?v=ef62a95e';
import { BODY_IDS } from './drive.js?v=ef62a95e';
// pieces whose model carries a looping clip: the assembly kit's machines
export const LOOP_IDS = new Set(['robotic_assembly_line', 'robotic_arm', 'conveyor_module']);
import { loadGlb, loadGlbWithClips, mergeByMaterial, fitModel } from './glbmodels.js?v=ef62a95e';

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
    if (tint !== null && !BZ) {
      // ...and so does the research-outpost kit, from the same workshop
      if (url.startsWith('assets/base-kit/') || url.startsWith('assets/outpost/') || url.startsWith('assets/warehouse/') || url.startsWith('assets/solar/')) tintModel(fitted, tint, { wash: 0.10 });
      else { ladderTint(fitted, tint); dressMetal(fitted); }
    }
    return styleForLook(fitted, url);
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
    return { root: styleForLook(mergeByMaterial(res.scene, [...pivots]), url), clips: res.clips };
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
  const parts = meshesOf(root);
  const matrices = pieces.map((piece) => transformOf(piece));
  for (const part of parts) {
    const im = new THREE.InstancedMesh(part.geometry, part.material, pieces.length);
    matrices.forEach((M, i) => { im.setMatrixAt(i, m.multiplyMatrices(M, part.local)); });
    im.instanceMatrix.needsUpdate = true;
    g.add(im);
  }
  // battlezone: the instances' edges, baked once into one line set
  if (BZ) g.add(bakeEdges(parts, matrices, root.userData.bzStyle || null));
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
    const tick = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 0.4), new THREE.MeshBasicMaterial({ color: PALETTE.tick }));
    tick.position.set(0, 0.15, (piece.ph * CELL_M) / 2 - inset - 0.2);
    g.add(tick);
  }
  return g;
}

// piece -> world transform. Rect centre in cells, plus the piece's own
// outward offset (the gate), then rot: clockwise from above is a NEGATIVE
// rotation about +y.
// A road deck lies exactly on the slab's top, and two coplanar surfaces
// shimmer (operator's screenshot, 2026-09-07): roads sit 6 cm proud, above
// the grid too.
const ROAD_LIFT = 0.06;
export function placePiece(obj, piece) {
  obj.position.set((piece.x + piece.pw / 2 + piece.offset[0]) * CELL_M, piece.kind === KIND.ROAD ? ROAD_LIFT : 0, (piece.z + piece.ph / 2 + piece.offset[1]) * CELL_M);
  obj.rotation.y = -piece.rot * Math.PI / 2;
}
// CHUNKS: the static and body layers are instanced per 128 m tile as well
// as per model, so `cull` can hide whole tiles by distance from the camera.
// Three culls each object by its bounding sphere already; a tile's sphere
// is small enough to fall outside the frustum, and the distance rule is
// what keeps the far half of a 480 m plate off the GPU at ground level.
export const CHUNK_M = 128;
const chunkOf = (x, z) => `${Math.floor(x / CHUNK_M)},${Math.floor(z / CHUNK_M)}`;
const chunkCentre = (key) => { const [i, j] = key.split(',').map(Number); return { cx: (i + 0.5) * CHUNK_M, cz: (j + 0.5) * CHUNK_M }; };
const pieceCentre = (piece) => [(piece.x + piece.pw / 2) * CELL_M, (piece.z + piece.ph / 2) * CELL_M];

const pieceMatrix = (piece) => {
  const o = new THREE.Object3D();
  placePiece(o, piece);
  o.updateMatrix();
  return o.matrix.clone();
};
// a crushed piece whose kit has no rubble model: the same model pressed
// flat (a tenth of its height) and tilted a little, its own way each time
const crushedMatrix = (piece, index) => {
  const o = new THREE.Object3D();
  placePiece(o, piece);
  const h = Math.sin(index * 12.9898) * 43758.5453, j = h - Math.floor(h);
  o.rotation.x += (j - 0.5) * 0.16;
  o.rotation.z += (j * 7 % 1 - 0.5) * 0.16;
  o.scale.y = 0.1;
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
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: PALETTE.arc, transparent: true, opacity: 0.09, side: THREE.DoubleSide, depthWrite: false }));
  m.position.set((st.x + 1) * CELL_M, 0, (st.z + 1) * CELL_M);
  return m;
}

// A large + for a roof: two flat bars, lit, in the look's cross colour.
function roofCross(size) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: PALETTE.cross });
  const a = new THREE.Mesh(new THREE.BoxGeometry(size, 0.25, size * 0.28), mat);
  const b = new THREE.Mesh(new THREE.BoxGeometry(size * 0.28, 0.25, size), mat);
  g.add(a, b);
  if (BZ) for (const m of [a, b]) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: PALETTE.cross })));
  return g;
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
  const cullables = [];           // { obj, cx, cz } in plate metres: hidden past the cull distance
  const sentryYaws = new Map();   // sentry index -> the node to turn
  const sentryRigs = new Map();   // sentry index -> { inst, yaw, pitch }
  const brokenSentries = new Set(); // indices broken before or after their model arrived
  const gateRigs = [];            // { index, obj, mixer, action, duration }
  const dynamic = new Map();      // piece index -> its own object, for the bodies the drive moves
  const loopRigs = [];            // { obj, mixer }: the assembly kit's Assembly_Cycle, looping
  const pending = [];
  const W = plate.w * CELL_M, H = plate.h * CELL_M;

  const slab = new THREE.Mesh(new THREE.BoxGeometry(W, 0.4, H), BZ ? new THREE.MeshBasicMaterial({ color: 0x000000 }) : new THREE.MeshStandardMaterial({ color: PALETTE.slab, roughness: 0.95 }));
  slab.position.set(W / 2, -0.2, H / 2);
  group.add(slab);
  const grid = new THREE.GridHelper(Math.max(W, H), Math.max(plate.w, plate.h), PALETTE.grid, PALETTE.grid);
  grid.material.transparent = true; grid.material.opacity = 0.45;
  grid.position.set(Math.max(W, H) / 2, 0.02, Math.max(W, H) / 2);
  if (!BZ) group.add(grid); // in battlezone a dense grid at the horizon is a band of noise

  // THE STATIC LAYER: every wall, building, road, prop and socket, instanced
  // by model, drawn at each piece's own damage state (the plate tab's
  // selector forces walls to one). `rebuild()` redraws it after a shot
  // changed a state.
  // NO PLACEHOLDER BOXES (operator, 2026-09-07). A piece with no model draws
  // nothing — except a sentry socket, whose plinth IS the socket.
  const fallback = (piece) => {
    if (piece.kind !== KIND.SENTRY) return new THREE.Group();
    const obj = placeholderMesh(piece, catalog.get(piece.id)); placePiece(obj, piece); group.add(obj); return obj;
  };
  // The layer is REPLACED, never emptied: the new set is built first and
  // swapped in when every model has resolved, so a shot that turns one wall
  // segment D1 (whose model may still be downloading) no longer blanks the
  // whole ring for a frame (operator: "all the walls flicker").
  let staticObjs = [];
  let staticModels = 0;
  let staticGen = 0;
  function drawStatic() {
    const gen = ++staticGen;
    const next = [];
    const byKey = new Map();
    for (const piece of plate.pieces) {
      if (piece.kind === KIND.GATE || BODY_IDS.has(piece.id) || LOOP_IDS.has(piece.id)) continue;
      const entry = catalog.get(piece.id);
      if (!entry) continue;
      const state = piece.kind === KIND.WALL && wallState !== null ? wallState : piece.state;
      const url = entry.placeholder ? null : fileFor(entry, state);
      if (!url) { if (piece.kind === KIND.SENTRY) { const obj = placeholderMesh(piece, entry); placePiece(obj, piece); next.push(obj); } continue; }
      const fit = fitOf(entry, state);
      const sectionTint = piece.kind === KIND.WALL ? tint : (PALETTE.section[entry.section] || tint);
      const flat = state >= 3 && !entry.states[3];
      const chunk = chunkOf(...pieceCentre(piece));
      const key = url + (fit ? JSON.stringify(fit) : '') + '#' + sectionTint + (flat ? '#flat' : '') + '@' + chunk;
      if (!byKey.has(key)) byKey.set(key, { url, fit, tint: sectionTint, flat, chunk, pieces: [] });
      byKey.get(key).pieces.push(piece);
    }
    staticModels = byKey.size;
    const loads = [...byKey.values()].map(({ url, fit, tint: t, flat, chunk, pieces }) => proto(url, [], fit, t).then((root) => {
      if (!root) return;
      const im = instanced(root, pieces, flat ? (piece) => crushedMatrix(piece, plate.pieces.indexOf(piece)) : pieceMatrix);
      im.name = 'static';
      im.userData.chunk = chunkCentre(chunk);
      next.push(im);
      if (pieces[0].id === LANDMARK) {
        // the Isolation Infirmary wears a cross on its roof, sized to the plot
        const top = new THREE.Box3().setFromObject(root).max.y + 0.15;
        for (const piece of pieces) {
          const c = roofCross(Math.min(piece.pw, piece.ph) * CELL_M * 0.55);
          placePiece(c, piece);
          c.position.y = top;
          next.push(c);
        }
      }
    }));
    const swap = Promise.all(loads).then(() => {
      if (gen !== staticGen) return; // a newer rebuild superseded this one
      for (const o of staticObjs) { group.remove(o); const i = cullables.findIndex((c) => c.obj === o); if (i >= 0) cullables.splice(i, 1); }
      staticObjs = next;
      for (const o of next) { group.add(o); if (o.userData.chunk) cullables.push({ obj: o, ...o.userData.chunk }); }
    });
    pending.push(swap);
    return swap;
  }
  drawStatic();
  const byModel = new Map();
  for (const piece of plate.pieces) {
    if (piece.kind !== KIND.GATE && !BODY_IDS.has(piece.id) && !LOOP_IDS.has(piece.id)) continue;
    const entry = catalog.get(piece.id);
    if (!entry) continue;
    const state = piece.state;
    const url = entry.placeholder ? null : fileFor(entry, state);
    if (!url) { fallback(piece); continue; }
    const fit = fitOf(entry, state);
    const mkey = fit ? url + JSON.stringify(fit) : url;
    if (LOOP_IDS.has(piece.id)) {
      // an animated machine: its own clone, its clip looping
      pending.push(animProto(url).then((res) => {
        if (!res) { fallback(piece); return; }
        const obj = res.root.clone();
        if (!BZ) tintModel(obj, PALETTE.section[entry.section] || tint, { wash: 0.10 });
        placePiece(obj, piece);
        group.add(obj);
        const clip = res.clips[0];
        if (clip) {
          const mixer = new THREE.AnimationMixer(obj);
          const action = mixer.clipAction(clip);
          action.play();
          obj.name = 'loop';
          loopRigs.push({ obj, mixer });
          cullables.push({ obj, cx: obj.position.x, cz: obj.position.z });
        }
      }));
      continue;
    }
    if (BODY_IDS.has(piece.id)) continue; // bodies are drawn by syncBodies, instanced per model and state
    if (animatedGates) {
      const gi = plate.gates.findIndex((g) => g.pieceIndex === plate.pieces.indexOf(piece));
      pending.push(animProto(url).then((res) => {
        if (!res) { fallback(piece); return; }
        const obj = res.root.clone();
        if (!BZ) tintModel(obj, tint, { wash: 0.10 });
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
        obj.name = 'gate';
        gateRigs.push({ index: gi, obj, mixer, action, duration: clip ? clip.duration : 0 });
      }));
      continue;
    }
    // a static gate (the plate tab): instanced like everything else
    if (!byModel.has(mkey)) byModel.set(mkey, { url, fit, pieces: [] });
    byModel.get(mkey).pieces.push(piece);
  }
  for (const { url, fit, pieces } of byModel.values()) {
    pending.push(proto(url, [], fit, tint).then((root) => {
      if (!root) { for (const piece of pieces) fallback(piece); return; }
      group.add(instanced(root, pieces, pieceMatrix));
    }));
  }
  plate.sentries.forEach((st, index) => {
    if (showArcs) group.add(arcWedge(st));
    pending.push(proto(sentryUrl(st.family, st.tier), ['YAW', 'PITCH', 'RECOIL'], { height: 4.5, maxSpan: 7 }, tint).then((root) => {
      if (!root) return;
      const inst = root.clone();
      inst.name = 'sentry';
      const yaw = inst.getObjectByName('YAW') || inst;
      yaw.rotation.y = yawRotation(st.yawDeg);
      // a lobber holds its barrel up: the workshop applies elevation as a
      // NEGATIVE rotation about x on the PITCH node
      const pitch = inst.getObjectByName('PITCH');
      if (pitch && LOB_FAMILIES.has(st.family)) pitch.rotation.x = -LOB_ELEV_DEG * Math.PI / 180;
      inst.position.set((st.x + 1) * CELL_M, 0.6, (st.z + 1) * CELL_M);
      group.add(inst);
      sentryYaws.set(index, yaw);
      sentryRigs.set(index, { inst, yaw, pitch, home: st.yawDeg, broken: false });
      cullables.push({ obj: inst, cx: inst.position.x, cz: inst.position.z });
      // a probe (or a fast player) can break it before the model has loaded
      if (brokenSentries.has(index)) wreck(index);
    }));
  });
  // THE WRECK: the same tower, broken. The plinth and base stay; the head
  // (everything under YAW) is knocked off its bearing and lies beside the
  // base on its side, barrel drooped, and the whole thing goes dark. The
  // tab stops turning the yaw node once it is broken.
  group.name = 'plate';
  // THE BODIES, instanced: one InstancedMesh per part per (model, state),
  // the matrices rewritten for the bodies that moved this frame, the whole
  // set rebuilt when a body changes state. 430 separate corrugated
  // containers were most of a 120-cell plate's 50 M triangles a frame.
  const bodyLayer = new THREE.Group(); bodyLayer.name = 'bodies'; group.add(bodyLayer);
  let bodySets = [], bodyGen = 0, bodyKeys = '';
  const bodyMatrix = (b, ox, oz) => { const o = new THREE.Object3D(); o.position.set(b.x - ox, 0, b.z - oz); o.rotation.y = -b.rot * Math.PI / 2; o.updateMatrix(); return o.matrix.clone(); };
  const tmpM = new THREE.Matrix4();
  function drawBodies(bodies, ox, oz) {
    const gen = ++bodyGen;
    const byKey = new Map();
    for (const b of bodies) {
      const entry = catalog.get(b.id);
      if (!entry) continue;
      const url = entry.placeholder ? null : fileFor(entry, b.state);
      if (!url) continue;
      const fit = fitOf(entry, b.state);
      const chunk = chunkOf(b.x - ox, b.z - oz);
      const key = url + (fit ? JSON.stringify(fit) : '') + '#' + tint + '@' + chunk;
      if (!byKey.has(key)) byKey.set(key, { url, fit, chunk, bodies: [] });
      byKey.get(key).bodies.push(b);
    }
    const sets = [];
    const loads = [...byKey.values()].map(({ url, fit, chunk, bodies: bs }) => proto(url, [], fit, tint).then((root) => {
      if (!root) return;
      const parts = meshesOf(root);
      const matrices = bs.map((b) => bodyMatrix(b, ox, oz));
      const g = new THREE.Group(); g.name = 'bodyset';
      g.userData.chunk = chunkCentre(chunk);
      const meshes = [];
      for (const part of parts) {
        const im = new THREE.InstancedMesh(part.geometry, part.material, bs.length);
        matrices.forEach((M, i) => im.setMatrixAt(i, tmpM.multiplyMatrices(M, part.local)));
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.instanceMatrix.needsUpdate = true;
        g.add(im); meshes.push(im);
      }
      const style = root.userData.bzStyle || null;
      let edges = null;
      if (BZ) { edges = bakeEdges(parts, matrices, style); g.add(edges); }
      sets.push({ group: g, bodies: bs, parts, matrices, meshes, edges, style });
    }));
    const swap = Promise.all(loads).then(() => {
      if (gen !== bodyGen) return;
      for (const s of bodySets) { bodyLayer.remove(s.group); if (s.edges) s.edges.geometry.dispose(); const i = cullables.findIndex((c) => c.obj === s.group); if (i >= 0) cullables.splice(i, 1); }
      bodySets = sets;
      for (const s of sets) { bodyLayer.add(s.group); cullables.push({ obj: s.group, ...s.group.userData.chunk }); }
    });
    pending.push(swap);
    return swap;
  }
  // called every frame by the tab with the drive's bodies (world metres;
  // ox, oz shift them into this plate's frame)
  function syncBodies(bodies, ox = 0, oz = 0) {
    const keys = bodies.map((b) => b.id + b.state).join(',');
    if (keys !== bodyKeys) { bodyKeys = keys; drawBodies(bodies, ox, oz); return; }
    for (const s of bodySets) {
      let dirty = false;
      s.bodies.forEach((b, i) => {
        if (!b.moved) return;
        const M = bodyMatrix(b, ox, oz);
        s.matrices[i] = M;
        for (let k = 0; k < s.meshes.length; k++) s.meshes[k].setMatrixAt(i, tmpM.multiplyMatrices(M, s.parts[k].local));
        dirty = true;
      });
      if (!dirty) continue;
      for (const im of s.meshes) im.instanceMatrix.needsUpdate = true;
      if (BZ && s.edges) {
        s.group.remove(s.edges); s.edges.geometry.dispose();
        s.edges = bakeEdges(s.parts, s.matrices, s.style);
        s.group.add(s.edges);
      }
    }
  }

  // THE CABLES: from the station's roof to every sentry's head, a sagging
  // line each, one line set. Dark when the power is out.
  const cables = new THREE.Group(); cables.name = 'cables'; group.add(cables);
  let cableMat = null;
  if (plate.power) {
    const st = plate.pieces[plate.power.pieceIndex];
    const sx = (st.x + 1) * CELL_M, sz = (st.z + 1) * CELL_M, sy = 3.6;
    const pos = [];
    for (const sn of plate.sentries) {
      const ex = (sn.x + 1) * CELL_M, ez = (sn.z + 1) * CELL_M, ey = 4.4;
      const n = 12, sag = Math.min(2.5, 0.06 * Math.hypot(ex - sx, ez - sz));
      let prev = null;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const p = [sx + (ex - sx) * t, sy + (ey - sy) * t - sag * 4 * t * (1 - t), sz + (ez - sz) * t];
        if (prev) pos.push(...prev, ...p);
        prev = p;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    cableMat = new THREE.LineBasicMaterial({ color: BZ ? 0x3fbf5a : PALETTE.wire, transparent: true, opacity: 0.55 });
    const ls = new THREE.LineSegments(geo, cableMat);
    ls.name = 'cable';
    cables.add(ls);
  }
  // darken a rig's paint: scorched in the colony look, dim lines in battlezone
  const darken = (inst) => inst.traverse((o) => {
    if (o.isLineSegments) { o.material = o.material.clone(); o.material.color.multiplyScalar(0.4); return; }
    if (!o.isMesh || BZ) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const dark = mats.map((m) => { const c = m.clone(); if (c.color) c.color.multiplyScalar(0.3); if (c.emissive) c.emissive.setScalar(0); return c; });
    o.material = Array.isArray(o.material) ? dark : dark[0];
  });
  let poweredNow = true;
  // power lost: the cables go dark, every standing sentry droops and dims
  const setPowered = (on) => {
    if (on === poweredNow) return;
    poweredNow = on;
    if (cableMat) { cableMat.color.setHex(on ? (BZ ? 0x3fbf5a : PALETTE.wire) : 0x2a2f38); cableMat.opacity = on ? 0.55 : 0.35; }
    for (const r of sentryRigs.values()) {
      if (r.broken) continue;
      if (r.pitch) r.pitch.rotation.x = on ? (LOB_FAMILIES.has(plate.sentries[[...sentryRigs.entries()].find(([, v]) => v === r)[0]].family) ? -LOB_ELEV_DEG * Math.PI / 180 : 0) : 0.35;
      if (!on) darken(r.inst);
    }
  };
  // hide everything cullable farther than maxDist from (x, z), plate metres;
  // Infinity shows all (the overview camera)
  const cull = (x, z, maxDist) => {
    const r2 = maxDist * maxDist;
    for (const c of cullables) { const dx = c.cx - x, dz = c.cz - z; c.obj.visible = !(dx * dx + dz * dz > r2); }
  };
  const breakSentry = (index) => { brokenSentries.add(index); wreck(index); };
  const wreck = (index) => {
    const r = sentryRigs.get(index);
    if (!r || r.broken) return;
    r.broken = true;
    sentryYaws.delete(index);
    const { inst, yaw, pitch } = r;
    // it falls BACKWARD, into the band behind it: sideways along the ring
    // put a corner sentry's head through the wall
    const [dx, dz] = dirOfYaw(r.home + 180);
    // the proto is FIT to the socket, so the yaw node's frame is scaled:
    // metres wanted here must be divided by that scale before they are local
    const sc = new THREE.Vector3();
    yaw.parent.getWorldScale(sc);
    const k = 1 / (sc.y || 1);
    yaw.rotation.order = 'YZX';
    yaw.rotation.set(0.35, yawRotation(r.home + 25), 1.75);
    yaw.position.set(dx * 2.2 * k, 0, dz * 2.2 * k);
    if (pitch) pitch.rotation.x = 0.5;
    // rest it on the ground: the pivot is up at the bearing, so after the
    // tip the head hangs in the air until measured down
    inst.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(yaw);
    const groundY = new THREE.Vector3().setFromMatrixPosition(inst.matrixWorld).y - 0.6;
    if (Number.isFinite(box.min.y)) yaw.position.y -= (box.min.y - groundY - 0.05) * k;
    inst.updateMatrixWorld(true);
    const after = new THREE.Box3().setFromObject(yaw), wp = new THREE.Vector3();
    yaw.getWorldPosition(wp);
    console.log(`[wreck] sentry ${index} ground=${groundY.toFixed(2)} head at ${wp.x.toFixed(1)},${wp.y.toFixed(2)},${wp.z.toFixed(1)} box y ${after.min.y.toFixed(2)}..${after.max.y.toFixed(2)} x ${after.min.x.toFixed(1)}..${after.max.x.toFixed(1)} z ${after.min.z.toFixed(1)}..${after.max.z.toFixed(1)} meshes ${(() => { let n = 0; yaw.traverse((o) => { if (o.isMesh || o.isLineSegments) n++; }); return n; })()}`);
    // and dark: scorched paint in the colony look, dimmed lines in battlezone
    darken(inst);
  };
  if (showBlind) {
    for (const c of ringCoverage(plate)) {
      if (c.covered) continue;
      const m = new THREE.Mesh(new THREE.BoxGeometry(CELL_M * 0.5, 0.2, CELL_M * 0.5), new THREE.MeshBasicMaterial({ color: PALETTE.blind }));
      m.position.set((c.x + 0.5) * CELL_M, 3.8, (c.z + 0.5) * CELL_M);
      group.add(m);
    }
  }
  console.log('[plate] models', byModel.size + staticModels, 'pieces', plate.pieces.length, 'sentries', plate.sentries.length, 'warnings', plate.warnings.length);
  return { group, sentryYaws, sentryRigs, breakSentry, setPowered, syncBodies, cull, gateRigs, dynamic, loopRigs, ready: Promise.all(pending), rebuildWalls: drawStatic, rebuild: drawStatic };
}
