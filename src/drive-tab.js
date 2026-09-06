// drive-tab.js — THE DRIVE: the MKCX-2 on a generated plate. Keys move the
// hull, gates open as it nears them, sentries sweep their arcs and fire
// tracers at what they can see, and a counter says how many would have
// hit. The rules are drive.js; this file wires the rig around them.
import { OrbitControls } from '../vendor/OrbitControls.js';
import GUI from '../vendor/lil-gui.esm.js';
import { generatePlate, makePlateParams, clampPlateParams, PLATE_KNOBS } from './plate.js?v=bf234634';
import { DRIVE_KNOBS, makeDriveParams, clampDriveParams, makeHull, stepHull, blockedAt, makeGates, stepGates,
  spawnFor, makeSentries, stepSentries, losClear, stepTracers, buildingAt } from './drive.js?v=bf234634';
import { buildPlateGroup, yawRotation } from './plate-scene.js?v=bf234634';
import { query, loadCatalog } from './plate-tab.js?v=bf234634';
import { makeViewer, makeHullObject, makeKeys, makeTracerPool, followCamera } from './drive-rig.js?v=bf234634';

export function initDriveTab(root) {
  const { renderer, scene, camera, hud, notice, resize } = makeViewer(root);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enabled = false;

  const q = query();
  const params = clampPlateParams(makePlateParams(), Object.fromEntries([...q.entries()]));
  const P = clampDriveParams(makeDriveParams(), Object.fromEntries([...q.entries()]));
  const view = { camera: q.get('view') || 'chase' };
  const hullObj = makeHullObject();
  scene.add(hullObj);
  const pool = makeTracerPool(scene);

  let catalog = null, plate = null, rig = null, gates = [], sentries = [], tracers = [], hull = null;
  let hits = 0, simT = 0, lastLog = 0, lastDt = 0.016;

  function build() {
    if (rig) scene.remove(rig.group);
    pool.clear();
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

  function step(dt, input) {
    stepHull(hull, input, dt, (x, z) => blockedAt(plate, gates, x, z), P);
    stepGates(gates, hull, dt, P);
    for (const t of stepSentries(sentries, hull, dt, (ax, az, bx, bz) => losClear(plate, ax, az, bx, bz), P)) tracers.push(t);
    hits += stepTracers(tracers, hull, dt, (x, z) => buildingAt(plate, x, z), P);
    simT += dt;
  }

  const gateWord = () => gates.map((g) => `${g.side}:${g.open >= 0.95 ? 'open' : g.open <= 0 ? 'shut' : 'moving'}`).join(' ');
  const logLine = () => `[drive] t=${simT.toFixed(1)} hull=${hull.x.toFixed(1)},${hull.z.toFixed(1)} heading=${hull.heading.toFixed(0)} gates=${gateWord()} tracking=${sentries.filter((s) => s.tracking).length} lobs=${tracers.filter((t) => t.kind === 'lob').length} hits=${hits}`;

  function sync() {
    hullObj.userData.setPose(hull, 0);
    sentries.forEach((s, i) => { const node = rig.sentryYaws.get(i); if (node) node.rotation.y = yawRotation(s.yaw); });
    for (const gr of rig.gateRigs) { const g = gates[gr.index]; if (g && gr.mixer) gr.mixer.setTime(g.open * gr.duration); }
    pool.sync(tracers, () => 0, lastDt, P.splashR);
    followCamera(camera, controls, hull, 0, view.camera, lastDt);
    hud.textContent = `hits ${hits} · gates ${gateWord()} · cam ${view.camera} · WASD / arrows drive · C camera · R regenerate`;
  }

  const regenerate = () => { params.seed = (params.seed + 1) % 1000000; gui.controllersRecursive().forEach((c) => c.updateDisplay()); build(); };
  const CAMS = ['chase', 'top', 'orbit'];
  const toggleCam = () => { view.camera = CAMS[(CAMS.indexOf(view.camera) + 1) % CAMS.length]; controls.enabled = view.camera === 'orbit'; camera.userData.placed = false; gui.controllersRecursive().forEach((c) => c.updateDisplay()); };
  const keys = makeKeys({ c: toggleCam, r: regenerate });

  const gui = new GUI({ title: 'DRIVE', container: root });
  const pf = gui.addFolder('plate');
  for (const k of PLATE_KNOBS) pf.add(params, k.key, k.min, k.max, k.step).name(k.label).onFinishChange(build);
  pf.close();
  const folders = {};
  for (const k of DRIVE_KNOBS) {
    const f = folders[k.group] || (folders[k.group] = gui.addFolder(k.group));
    f.add(P, k.key, k.min, k.max, k.step).name(k.label);
  }
  gui.add(view, 'camera', ['chase', 'top', 'orbit']).name('camera').onChange((v) => { controls.enabled = v === 'orbit'; camera.userData.placed = false; });
  gui.add({ regenerate }, 'regenerate').name('regenerate (seed+1)');

  let last = 0;
  const probe = q.get('probe') === '1';
  loadCatalog().then(({ catalog: c, error }) => {
    catalog = c;
    if (error) { notice.textContent = `base-kit manifest unavailable, placeholders only (${error})`; notice.hidden = false; }
    build();
    const tick = Number(q.get('tick') || 0);
    if (tick > 0) {
      for (let i = 0; i < tick * 60; i++) step(1 / 60, { fwd: true });
      console.log(logLine());
    }
    renderer.setAnimationLoop((now) => {
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0);
      last = now;
      lastDt = dt;
      step(dt, keys.input());
      if (probe && simT - lastLog >= 1) { lastLog = simT; console.log(logLine()); }
      sync();
      renderer.render(scene, camera);
    });
  });
  return { resize };
}
