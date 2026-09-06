// drive-tab.js — THE DRIVE: the MKCX-2 on a generated plate. Keys move the
// hull, gates open as it nears them, sentries sweep their arcs and fire
// tracers at what they can see, and a counter says how many would have
// hit. The rules are drive.js; this file wires the rig around them.
import * as THREE from '../vendor/three.module.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import GUI from '../vendor/lil-gui.esm.js';
import { generatePlate, makePlateParams, clampPlateParams, PLATE_KNOBS, CELL_M } from './plate.js?v=b7486121';
import { DRIVE_KNOBS, makeDriveParams, clampDriveParams, makeHull, stepHull, blockedAt, makeGates, stepGates,
  spawnFor, makeSentries, stepSentries, losClear, stepTracers, rayStop, fireHull, damageAt, makeBodies, stepBodies } from './drive.js?v=b7486121';
import { PALETTE, LOOK, LOOKS } from './looks.js?v=b7486121';
import { withParam } from './url.js?v=b7486121';
import { buildPlateGroup, yawRotation, setGateOpen } from './plate-scene.js?v=b7486121';
import { query, loadCatalog } from './plate-tab.js?v=b7486121';
import { makeViewer, makeHullObject, makeKeys, makeTracerPool, followCamera, CAMERA_KEYS } from './drive-rig.js?v=b7486121';
import { makeCrew, stepCrew } from './crew.js?v=b7486121';
import { makeCrewScene } from './crew-scene.js?v=b7486121';
import { mulberry32 } from './rng.js?v=b7486121';

export function initDriveTab(root) {
  const { renderer, scene, camera, hud, notice, resize, render, setGroups } = makeViewer(root);
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

  let catalog = null, plate = null, rig = null, gates = [], sentries = [], tracers = [], hull = null, bodies = [];
  let crew = [], crewScene = null, crewRng = null;
  const destructible = (pc) => { const e = catalog && catalog.get(pc.id); return !!(e && e.states[1] && e.states[3]); };
  const CREW_N = Number(q.get('crew') || 6);
  let hits = 0, simT = 0, lastLog = 0, lastDt = 0.016, breached = 0;

  function build() {
    if (rig) scene.remove(rig.group);
    pool.clear();
    plate = generatePlate(params);
    window.__plate = plate;
    rig = buildPlateGroup({ plate, catalog, wallState: null, animatedGates: true, tint: PALETTE.hostile });
    scene.add(rig.group);
    setGroups(() => [['tank', [hullObj]], ['towers', [rig.group]]]);
    gates = makeGates(plate);
    sentries = makeSentries(plate);
    bodies = makeBodies(plate);
    crewRng = mulberry32(params.seed ^ 0x51ed);
    crew = makeCrew(plate, CREW_N, crewRng);
    crewScene = makeCrewScene(rig.group, crew);
    tracers = [];
    hits = 0; simT = 0; lastLog = 0; breached = 0;
    const sp = spawnFor(plate, plate.gates[0]);
    // ?aim=wall: spawn six cells along the wall from the gate, so a probe's
    // shots land on standard wall segments rather than the gate
    if (q.get('aim') === 'wall') { const g = plate.gates[0]; if (g.side === 'N' || g.side === 'S') sp.x += 6 * CELL_M; else sp.z += 6 * CELL_M; }
    hull = makeHull(sp.x, sp.z, sp.heading);
    camera.userData.placed = false;
    window.__drive = { hull, gates, sentries, tracers, get hits() { return hits; } };
  }

  function step(dt, input) {
    stepHull(hull, input, dt, (x, z) => blockedAt(plate, gates, x, z), P);
    stepBodies(bodies, hull, (x, z) => blockedAt(plate, gates, x, z), P);
    stepCrew(crew, plate, dt, crewRng);
    if (input.fire) { const shot = fireHull(hull, P); if (shot) tracers.push(shot); }
    stepGates(gates, hull, dt, P);
    for (const t of stepSentries(sentries, hull, dt, (ax, az, bx, bz) => losClear(plate, ax, az, bx, bz), P)) tracers.push(t);
    const stop = rayStop(plate, gates, bodies);
    hits += stepTracers(tracers, hull, dt, (x, z, t) => {
      if (!stop(x, z, t)) return false;
      if (t && t.kind === 'shot') { const pc = damageAt(plate, x, z, destructible); if (pc) { if (pc.state >= 3) breached++; rig.rebuild(); } }
      return true;
    }, P);
    simT += dt;
  }

  const gateWord = () => gates.map((g) => `${g.side}:${g.open >= 0.95 ? 'open' : g.open <= 0 ? 'shut' : 'moving'}`).join(' ');
  const logLine = () => `[drive] t=${simT.toFixed(1)} hull=${hull.x.toFixed(1)},${hull.z.toFixed(1)} heading=${hull.heading.toFixed(0)} gates=${gateWord()} tracking=${sentries.filter((s) => s.tracking).length} lobs=${tracers.filter((t) => t.kind === 'lob').length} hits=${hits} shots=${hull.shots} damaged=${plate.pieces.filter((pc) => pc.kind === 1 && pc.state > 0).length} breached=${breached}`;

  function sync() {
    hullObj.userData.setPose(hull, 0);
    sentries.forEach((s, i) => { const node = rig.sentryYaws.get(i); if (node) node.rotation.y = yawRotation(s.yaw); });
    for (const gr of rig.gateRigs) { const g = gates[gr.index]; if (g) setGateOpen(gr, g.open); }
    for (const b of bodies) { const obj = rig.dynamic.get(b.pieceIndex); if (obj) obj.position.set(b.x, 0, b.z); }
    if (crewScene) crewScene.sync(lastDt);
    pool.sync(tracers, () => 0, lastDt, P.splashR);
    followCamera(camera, controls, hull, 0, view.camera, lastDt, null, { cx: plate.w * CELL_M / 2, cz: plate.h * CELL_M / 2, span: Math.max(plate.w, plate.h) * CELL_M });
    hud.textContent = `hits ${hits} · shots ${hull.shots} · breached ${breached} · gates ${gateWord()} · cam ${view.camera} · WASD drive · SPACE fire · 1 top 2 chase 3 orbit 4 overview · R regenerate`;
  }

  const regenerate = () => { params.seed = (params.seed + 1) % 1000000; gui.controllersRecursive().forEach((c) => c.updateDisplay()); build(); };
  const CAMS = ['chase', 'top', 'orbit', 'overview'];
  const setCam = (m) => { view.camera = m; controls.enabled = m === 'orbit'; camera.userData.placed = false; gui.controllersRecursive().forEach((c) => c.updateDisplay()); };
  const toggleCam = () => setCam(CAMS[(CAMS.indexOf(view.camera) + 1) % CAMS.length]);
  const keys = makeKeys({ c: toggleCam, r: regenerate, ...Object.fromEntries(Object.entries(CAMERA_KEYS).map(([k, m]) => [k, () => setCam(m)])) });

  const gui = new GUI({ title: 'DRIVE', container: root });
  gui.add(P, 'speed', 2, 30, 1).name('tank speed (m/s)');
  const pf = gui.addFolder('plate');
  for (const k of PLATE_KNOBS) pf.add(params, k.key, k.min, k.max, k.step).name(k.label).onFinishChange(build);
  pf.close();
  const folders = {};
  for (const k of DRIVE_KNOBS) {
    const f = folders[k.group] || (folders[k.group] = gui.addFolder(k.group));
    f.add(P, k.key, k.min, k.max, k.step).name(k.label);
  }
  gui.add({ look: LOOK }, 'look', LOOKS).name('look').onChange((v) => { location.href = withParam('look', v); location.reload(); });
  gui.add(view, 'camera', CAMS).name('camera').onChange((v) => { controls.enabled = v === 'orbit'; camera.userData.placed = false; });
  gui.add({ regenerate }, 'regenerate').name('regenerate (seed+1)');

  let last = 0;
  const probe = q.get('probe') === '1';
  loadCatalog().then(({ catalog: c, error }) => {
    catalog = c;
    if (error) { notice.textContent = `base-kit manifest unavailable, placeholders only (${error})`; notice.hidden = false; }
    build();
    const tick = Number(q.get('tick') || 0);
    if (tick > 0) {
      const firing = q.get('fire') === '1';
      for (let i = 0; i < tick * 60; i++) step(1 / 60, { fwd: q.get('hold') !== '1', fire: firing });
      console.log(logLine());
    }
    // ?bzprobe=1: anything drawn that is not black-or-green — what escaped the look
    if (q.get('bzprobe') === '1') rig.ready.then(() => {
      const seen = new Map();
      scene.traverse((o) => {
        if (!o.material) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          const c = m.color ? '#' + m.color.getHexString() : 'none';
          const e = m.emissive ? '#' + m.emissive.getHexString() : '';
          const k = `${o.type}:${m.type}:${c}:${e}:${m.name || ''}`;
          seen.set(k, (seen.get(k) || 0) + 1);
        }
      });
      for (const [k, n] of seen) console.log(`[bz] ${n} x ${k}`);
    });
    // ?gateprobe=1: after the tick, say what each gate rig is actually doing
    if (q.get('gateprobe') === '1') rig.ready.then(() => {
      sync();
      for (const gr of rig.gateRigs) {
        const g = gates[gr.index];
        const slat = gr.obj.getObjectByName('GATE_SLAT_00');
        const p0 = slat ? slat.getWorldPosition(new THREE.Vector3()) : null;
        console.log(`[gate] ${g ? g.side + ':' + g.ring : '?'} open=${g ? g.open.toFixed(2) : '?'} duration=${gr.duration.toFixed(2)} actionTime=${gr.action ? gr.action.time.toFixed(2) : 'none'} slatY=${p0 ? p0.y.toFixed(2) : 'no slat'} clips=${gr.mixer ? 'yes' : 'no'}`);
      }
    });
    renderer.setAnimationLoop((now) => {
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0);
      last = now;
      lastDt = dt;
      step(dt, keys.input());
      if (probe && simT - lastLog >= 1) { lastLog = simT; console.log(logLine()); }
      sync();
      render();
    });
  });
  return { resize };
}
