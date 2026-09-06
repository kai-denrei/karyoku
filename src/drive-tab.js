// drive-tab.js — THE DRIVE: the MKCX-2 on a generated plate. Keys move the
// hull, gates open as it nears them, sentries sweep their arcs and fire
// tracers at what they can see, and a counter says how many would have
// hit. The rules are drive.js; this file owns the models, the keys, the
// two cameras and the HUD, and decides nothing else.
import * as THREE from '../vendor/three.module.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import GUI from '../vendor/lil-gui.esm.js';
import { generatePlate, makePlateParams, clampPlateParams, PLATE_KNOBS, CELL_M } from './plate.js?v=9868bf29';
import { DRIVE_KNOBS, makeDriveParams, clampDriveParams, makeHull, stepHull, blockedAt, makeGates, stepGates,
  spawnFor, makeSentries, stepSentries, losClear, stepTracers, buildingAt } from './drive.js?v=9868bf29';
import { buildPlateGroup, yawRotation } from './plate-scene.js?v=9868bf29';
import { query, loadCatalog } from './plate-tab.js?v=9868bf29';
import { loadGlb, mergeByMaterial } from './glbmodels.js?v=9868bf29';

const HULL_URL = 'assets/models/mkcx2.glb';
// The nodes that must keep moving through the merge, and the ones that
// must not be drawn at all (a collision proxy and two floating glow strips)
// — both lists are the reference project's, learned on the same file.
const HULL_PIVOTS = ['Turret_Pivot', 'Secondary_L_Pivot', 'Secondary_R_Pivot'];
const HULL_DROP = ['Hull_Collision', 'Barrel_Glow_1', 'Barrel_Glow_2'];
const KEYMAP = { w: 'fwd', ArrowUp: 'fwd', s: 'rev', ArrowDown: 'rev', a: 'left', ArrowLeft: 'left', d: 'right', ArrowRight: 'right' };

export function initDriveTab(root) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  root.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1116);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 2000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enabled = false;
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x20242c, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(60, 120, -40);
  scene.add(sun);
  const hud = document.createElement('div');
  hud.className = 'hud';
  root.appendChild(hud);
  const notice = document.createElement('div');
  notice.className = 'notice';
  notice.hidden = true;
  root.appendChild(notice);

  const q = query();
  const params = clampPlateParams(makePlateParams(), Object.fromEntries([...q.entries()]));
  const P = clampDriveParams(makeDriveParams(), Object.fromEntries([...q.entries()]));
  const view = { camera: 'top' };

  // --- the hull model ---------------------------------------------------------
  // A box stands in until the GLB lands; both live under one group so the
  // swap is invisible to everything that moves the hull.
  const hullObj = new THREE.Group();
  const stub = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.4, 7.4), new THREE.MeshStandardMaterial({ color: 0x9fb3c8, roughness: 0.6 }));
  stub.position.y = 1.0;
  hullObj.add(stub);
  scene.add(hullObj);
  loadGlb(HULL_URL).then((gltfScene) => {
    if (!gltfScene) return;
    const merged = mergeByMaterial(gltfScene, HULL_PIVOTS, HULL_DROP);
    hullObj.remove(stub);
    hullObj.add(merged);
    console.log('[drive] hull model loaded');
  });

  // --- state --------------------------------------------------------------------
  let catalog = null, plate = null, rig = null, gates = [], sentries = [], tracers = [], hull = null;
  let hits = 0, simT = 0, lastLog = 0;
  const keys = {};
  const tracerMeshes = new Map();
  const tracerGeo = new THREE.BoxGeometry(0.25, 0.25, 1.6);
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd166 });

  function build() {
    if (rig) { scene.remove(rig.group); }
    for (const m of tracerMeshes.values()) scene.remove(m);
    tracerMeshes.clear();
    plate = generatePlate(params);
    window.__plate = plate;
    rig = buildPlateGroup({ plate, catalog, animatedGates: true });
    scene.add(rig.group);
    gates = makeGates(plate);
    sentries = makeSentries(plate);
    tracers = [];
    hits = 0; simT = 0; lastLog = 0;
    const sp = spawnFor(plate, plate.gates[0]);
    hull = makeHull(sp.x, sp.z, sp.heading);
    camera.userData.placed = false;
    window.__drive = { hull, gates, sentries, tracers, get hits() { return hits; } };
  }

  function inputNow(forced) {
    if (forced) return forced;
    const inp = {};
    for (const [k, name] of Object.entries(KEYMAP)) if (keys[k]) inp[name] = true;
    return inp;
  }

  function step(dt, forced = null) {
    stepHull(hull, inputNow(forced), dt, (x, z) => blockedAt(plate, gates, x, z), P);
    stepGates(gates, hull, dt, P);
    const fired = stepSentries(sentries, hull, dt, (ax, az, bx, bz) => losClear(plate, ax, az, bx, bz), P);
    for (const t of fired) tracers.push(t);
    hits += stepTracers(tracers, hull, dt, (x, z) => buildingAt(plate, x, z), P);
    simT += dt;
  }

  const gateWord = () => gates.map((g) => `${g.side}:${g.open >= 0.95 ? 'open' : g.open <= 0 ? 'shut' : 'moving'}`).join(' ');
  const logLine = () => `[drive] t=${simT.toFixed(1)} hull=${hull.x.toFixed(1)},${hull.z.toFixed(1)} heading=${hull.heading.toFixed(0)} gates=${gateWord()} tracking=${sentries.filter((s) => s.tracking).length} hits=${hits}`;

  function sync() {
    hullObj.position.set(hull.x, 0, hull.z);
    hullObj.rotation.y = Math.PI - hull.heading * Math.PI / 180;
    sentries.forEach((s, i) => { const node = rig.sentryYaws.get(i); if (node) node.rotation.y = yawRotation(s.yaw); });
    for (const gr of rig.gateRigs) { const g = gates[gr.index]; if (g && gr.mixer) gr.mixer.setTime(g.open * gr.duration); }
    const live = new Set(tracers);
    for (const [t, m] of tracerMeshes) if (!live.has(t)) { scene.remove(m); tracerMeshes.delete(t); }
    for (const t of tracers) {
      let m = tracerMeshes.get(t);
      if (!m) { m = new THREE.Mesh(tracerGeo, tracerMat); tracerMeshes.set(t, m); scene.add(m); }
      m.position.set(t.x, 3.0, t.z);
      m.rotation.y = Math.PI - t.heading * Math.PI / 180;
    }
    if (view.camera === 'top') {
      camera.position.set(hull.x, 70, hull.z + 28);
      camera.lookAt(hull.x, 0, hull.z);
    } else {
      controls.target.set(hull.x, 1, hull.z);
      if (!camera.userData.placed) { camera.position.set(hull.x + 30, 25, hull.z + 30); camera.userData.placed = true; }
      controls.update();
    }
    hud.textContent = `hits ${hits} · gates ${gateWord()} · cam ${view.camera} · WASD / arrows drive · C camera · R regenerate`;
  }

  // --- keys -----------------------------------------------------------------------
  addEventListener('keydown', (e) => {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    if (KEYMAP[e.key] !== undefined) { keys[e.key] = true; e.preventDefault(); }
    if (e.key === 'c') { view.camera = view.camera === 'top' ? 'orbit' : 'top'; controls.enabled = view.camera === 'orbit'; camera.userData.placed = false; }
    if (e.key === 'r') { params.seed = (params.seed + 1) % 1000000; gui.controllersRecursive().forEach((c) => c.updateDisplay()); build(); }
  });
  addEventListener('keyup', (e) => { if (KEYMAP[e.key] !== undefined) keys[e.key] = false; });

  // --- panel ------------------------------------------------------------------------
  const gui = new GUI({ title: 'DRIVE', container: root });
  const pf = gui.addFolder('plate');
  for (const k of PLATE_KNOBS) pf.add(params, k.key, k.min, k.max, k.step).name(k.label).onFinishChange(build);
  pf.close();
  const folders = {};
  for (const k of DRIVE_KNOBS) {
    const f = folders[k.group] || (folders[k.group] = gui.addFolder(k.group));
    f.add(P, k.key, k.min, k.max, k.step).name(k.label);
  }
  gui.add(view, 'camera', ['top', 'orbit']).name('camera').onChange((v) => { controls.enabled = v === 'orbit'; camera.userData.placed = false; });
  gui.add({ regenerate: () => { params.seed = (params.seed + 1) % 1000000; gui.controllersRecursive().forEach((c) => c.updateDisplay()); build(); } }, 'regenerate').name('regenerate (seed+1)');

  // --- loop ---------------------------------------------------------------------------
  function resize() {
    const w = root.clientWidth, h = root.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();
  let last = 0;
  const probe = q.get('probe') === '1';
  loadCatalog().then(({ catalog: c, error }) => {
    catalog = c;
    if (error) { notice.textContent = `base-kit manifest unavailable, placeholders only (${error})`; notice.hidden = false; }
    build();
    // ?tick=N: N simulated seconds with the lever forward, before the first frame
    const tick = Number(q.get('tick') || 0);
    if (tick > 0) {
      for (let i = 0; i < tick * 60; i++) step(1 / 60, { fwd: true });
      console.log(logLine());
    }
    renderer.setAnimationLoop((now) => {
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0);
      last = now;
      step(dt);
      if (probe && simT - lastLog >= 1) { lastLog = simT; console.log(logLine()); }
      sync();
      renderer.render(scene, camera);
    });
  });
  return { resize };
}
