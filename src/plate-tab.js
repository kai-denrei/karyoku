// plate-tab.js — draws a Plate. Owns the renderer, the camera, the knob
// panel and the overlay; owns NO layout decisions. Every piece is either a
// catalog GLB (the kit's walls, corners and gate; the workshop's turrets)
// or a placeholder box of its footprint, labelled with what it will become.
import * as THREE from '../vendor/three.module.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import GUI from '../vendor/lil-gui.esm.js';
import { generatePlate, PLATE_KNOBS, makePlateParams, clampPlateParams, KIND, CELL_M, ringCoverage } from './plate.js?v=42b5b52b';
import { CATALOG_SPEC } from './catalog-spec.js?v=42b5b52b';
import { buildCatalog, fileFor, SECTION_COLOR, PLACEHOLDER_HEIGHT_M, BASE_KIT_URL } from './catalog.js?v=42b5b52b';
import { bustToken, loadGlb, mergeByMaterial, fitModel } from './glbmodels.js?v=42b5b52b';

// `#plate?seed=7` and `?seed=7#plate` both work: the hash's own query is
// merged under the real search string.
function query() {
  const q = new URLSearchParams(location.search);
  const hq = location.hash.indexOf('?');
  if (hq >= 0) for (const [k, v] of new URLSearchParams(location.hash.slice(hq + 1))) if (!q.has(k)) q.set(k, v);
  return q;
}

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

// One merged prototype per model URL. The kit's pieces are static, so
// everything merges; a sentry keeps YAW / PITCH / RECOIL as pivots. A load
// that fails resolves to null and the piece stays a placeholder.
const protos = new Map();
function proto(url, pivots = [], fit = null) {
  if (protos.has(url)) return protos.get(url);
  const p = loadGlb(url).then((scene) => {
    if (!scene) return null;
    const merged = mergeByMaterial(scene, pivots);
    return fit ? fitModel(merged, fit) : merged;
  });
  protos.set(url, p);
  return p;
}
const sentryUrl = (family, tier) => `assets/models/sentries/${family}_t${tier}.glb`;

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

export function initPlateTab(root) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  root.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1116);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 2000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x20242c, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(60, 120, -40);
  scene.add(sun);

  const overlay = document.createElement('pre');
  overlay.className = 'ascii-overlay';
  overlay.hidden = true;
  root.appendChild(overlay);
  const notice = document.createElement('div');
  notice.className = 'notice';
  notice.hidden = true;
  root.appendChild(notice);

  // --- params from URL ------------------------------------------------------
  const q = query();
  const params = clampPlateParams(makePlateParams(), Object.fromEntries([...q.entries()]));
  const view = { wallState: 0, ascii: q.get('ascii') === '1' };

  // --- catalog --------------------------------------------------------------
  let catalog = buildCatalog(CATALOG_SPEC, null);
  const catalogReady = fetch(`${BASE_KIT_URL}manifest.json${bustToken()}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((m) => { catalog = buildCatalog(CATALOG_SPEC, m); })
    .catch((e) => { notice.textContent = `base-kit manifest unavailable, placeholders only (${e.message})`; notice.hidden = false; });

  // --- scene contents -------------------------------------------------------
  let group = null;
  let plate = null;
  let buildGen = 0;

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
  function placePiece(obj, piece) {
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

  function build() {
    if (group) { scene.remove(group); group.traverse((o) => { if (o.geometry && !o.isInstancedMesh && o.userData.own) o.geometry.dispose(); }); }
    group = new THREE.Group();
    plate = generatePlate(params);
    window.__plate = plate;
    const gen = ++buildGen;
    const W = plate.w * CELL_M, H = plate.h * CELL_M;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(W, 0.4, H), new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.95 }));
    slab.position.set(W / 2, -0.2, H / 2);
    group.add(slab);
    const grid = new THREE.GridHelper(Math.max(W, H), Math.max(plate.w, plate.h), 0x2a3140, 0x1c212b);
    grid.position.set(Math.max(W, H) / 2, 0.02, Math.max(W, H) / 2);
    group.add(grid);

    const byModel = new Map(); // url -> pieces drawn from it
    for (const piece of plate.pieces) {
      const entry = catalog.get(piece.id);
      if (!entry) continue;
      const state = piece.kind === KIND.WALL ? view.wallState : piece.state;
      const url = entry.placeholder ? null : fileFor(entry, state);
      if (!url) { const obj = placeholderMesh(piece, entry); placePiece(obj, piece); group.add(obj); continue; }
      if (!byModel.has(url)) byModel.set(url, []);
      byModel.get(url).push(piece);
    }
    for (const [url, pieces] of byModel) {
      proto(url).then((root) => {
        if (gen !== buildGen) return; // a newer plate replaced this one while the model loaded
        if (!root) {
          for (const piece of pieces) { const obj = placeholderMesh(piece, catalog.get(piece.id)); placePiece(obj, piece); group.add(obj); }
          return;
        }
        group.add(instanced(root, pieces, pieceMatrix));
      });
    }
    for (const st of plate.sentries) {
      group.add(arcWedge(st));
      proto(sentryUrl(st.family, st.tier), ['YAW', 'PITCH', 'RECOIL'], { height: 4.5, maxSpan: 7 }).then((root) => {
        if (gen !== buildGen || !root) return;
        const inst = root.clone();
        const yaw = inst.getObjectByName('YAW');
        // the turret's forward is its +z, which is S here; yaw 0 must face N
        if (yaw) yaw.rotation.y = Math.PI - st.yawDeg * Math.PI / 180;
        inst.position.set((st.x + 1) * CELL_M, 0.6, (st.z + 1) * CELL_M);
        group.add(inst);
      });
    }
    // blind ring cells: a green marker above the wall
    for (const c of ringCoverage(plate)) {
      if (c.covered) continue;
      const m = new THREE.Mesh(new THREE.BoxGeometry(CELL_M * 0.5, 0.2, CELL_M * 0.5), new THREE.MeshBasicMaterial({ color: 0x2ecc71 }));
      m.position.set((c.x + 0.5) * CELL_M, 3.8, (c.z + 0.5) * CELL_M);
      group.add(m);
    }
    scene.add(group);
    controls.target.set(W / 2, 0, H / 2);
    if (!camera.userData.placed) {
      // from the south, looking north: N at the top of the screen, E on the right
      camera.position.set(W / 2, Math.max(W, H) * 0.95, H * 1.35);
      camera.userData.placed = true;
    }
    overlay.textContent = plate.ascii();
    overlay.hidden = !view.ascii;
    console.log('[plate] models', byModel.size, 'pieces', plate.pieces.length, 'sentries', plate.sentries.length, 'warnings', plate.warnings.length);
    if (q.get('ascii') === '1') console.log('[plate] ascii\n' + plate.ascii());
  }

  // --- panel ----------------------------------------------------------------
  const gui = new GUI({ title: 'PLATE', container: root });
  const folders = {};
  for (const k of PLATE_KNOBS) {
    const f = folders[k.group] || (folders[k.group] = gui.addFolder(k.group));
    f.add(params, k.key, k.min, k.max, k.step).name(k.label).onFinishChange(build);
  }
  gui.add({ regenerate: () => { params.seed = (params.seed + 1) % 1000000; gui.controllersRecursive().forEach((c) => c.updateDisplay()); build(); } }, 'regenerate').name('regenerate (seed+1)');
  gui.add(view, 'wallState', { 'D0 intact': 0, 'D1 damaged': 1, 'D2 critical': 2, 'D3 destroyed': 3 }).name('wall state').onChange(build);
  gui.add(view, 'ascii').name('ascii overlay').onChange((v) => { overlay.hidden = !v; });

  // --- loop -----------------------------------------------------------------
  function resize() {
    const w = root.clientWidth, h = root.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();
  catalogReady.then(build);
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
}
