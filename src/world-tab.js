// world-tab.js — THE WORLD: two plates on organic terrain, the road found
// between them, and the hull driving from one gate to the other. The
// terrain, the plates and the road are world.js; the driving is drive.js;
// this file draws them and runs the loop.
import * as THREE from '../vendor/three.module.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import GUI from '../vendor/lil-gui.esm.js';
import { makePlateParams, clampPlateParams, PLATE_KNOBS } from './plate.js?v=9c7098f2';
import { DRIVE_KNOBS, makeDriveParams, clampDriveParams, makeHull, stepHull, stepGates, stepSentries, stepTracers, fireHull, damageAt, autopilotInput, makeBodies, stepBodies, bodyAt } from './drive.js?v=9c7098f2';
import { WORLD_KNOBS, makeWorldParams, clampWorldParams, makeWorld, worldBlocked, worldBuildingAt, worldLosFor, worldSentries, worldGates, terrainNormal, splitQuad, groundAt } from './world.js?v=9c7098f2';
import { PALETTE, terrainMeshes, floraMeshes } from './looks.js?v=9c7098f2';
import { buildPlateGroup, yawRotation, setGateOpen } from './plate-scene.js?v=9c7098f2';
import { query, loadCatalog } from './plate-tab.js?v=9c7098f2';
import { makeViewer, makeHullObject, makeKeys, makeTracerPool, followCamera, CAMERA_KEYS } from './drive-rig.js?v=9c7098f2';
import { makeCrew, stepCrew } from './crew.js?v=9c7098f2';
import { makeCrewScene } from './crew-scene.js?v=9c7098f2';
import { mulberry32 } from './rng.js?v=9c7098f2';

const ARRIVE_M = 8;

export function initWorldTab(root) {
  const { renderer, scene, camera, hud, notice, resize, render, setGroups } = makeViewer(root);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enabled = false;

  const q = query();
  const qo = Object.fromEntries([...q.entries()]);
  const plateParams = clampPlateParams(makePlateParams(), qo);
  const W = clampWorldParams(makeWorldParams(), qo);
  const P = clampDriveParams(makeDriveParams(), qo);
  const view = { camera: q.get('view') || 'chase' };
  const hullObj = makeHullObject();
  scene.add(hullObj);
  const pool = makeTracerPool(scene);

  let catalog = null, world = null, group = null, rigs = [], gates = [], sentries = [], tracers = [], hull = null, bodies = [];
  let crews = [], crewRng = null;
  const CREW_N = Number(q.get('crew') || 5);
  let hits = 0, simT = 0, lastLog = 0, arrivedAt = -1, lastDt = 0.016, breached = 0;

  function build() {
    if (group) scene.remove(group);
    pool.clear();
    world = makeWorld({ ...W, seed: plateParams.seed }, plateParams);
    window.__world = world;
    group = new THREE.Group();
    const { fill, wire } = terrainMeshes(world, splitQuad);
    group.add(fill, wire);
    const flora = floraMeshes(world);
    group.add(flora);
    // the TD board's weights: the map calm, machines and effects hot
    setGroups(() => [['map', [fill, wire]], ['tank', [hullObj]], ['towers', rigs.map((r) => r.group)], ['effects', [flora]]]);
    rigs = world.plates.map((p) => {
      const rig = buildPlateGroup({ plate: p.plate, catalog, wallState: null, animatedGates: true, showBlind: false, showArcs: p.hostile, tint: p.hostile ? PALETTE.hostile : PALETTE.home });
      rig.group.position.set(p.ox, 0, p.oz);
      group.add(rig.group);
      return rig;
    });
    scene.add(group);
    gates = worldGates(world);
    sentries = worldSentries(world);
    bodies = world.plates.flatMap((p) => makeBodies(p.plate, p.ox, p.oz));
    crewRng = mulberry32(plateParams.seed ^ 0x51ed);
    // a crew per plate, in the plate's own frame under its rig group
    crews = world.plates.map((p, pi) => { const crew = makeCrew(p.plate, CREW_N, crewRng); return { plate: p.plate, crew, scene: makeCrewScene(rigs[pi].group, crew) }; });
    tracers = [];
    hits = 0; simT = 0; lastLog = 0; arrivedAt = -1; breached = 0;
    hull = makeHull(world.spawn.x, world.spawn.z, world.spawn.heading);
    camera.userData.placed = false;
    console.log(`[world] quads ${world.mesh.quads.length} road ${world.road.quads.length} trees ${world.trees.length} rocks ${world.rocks.length} warnings ${world.warnings.length}`);
    window.__drive = { hull, gates, sentries, tracers, get hits() { return hits; } };
  }

  const goalDist = () => Math.hypot(hull.x - world.goal.x, hull.z - world.goal.z);

  function step(dt, input) {
    stepHull(hull, input, dt, (x, z) => worldBlocked(world, x, z), P);
    stepBodies(bodies, hull, (x, z) => worldBlocked(world, x, z), P);
    for (const c of crews) stepCrew(c.crew, c.plate, dt, crewRng);
    if (input.fire) { const shot = fireHull(hull, P); if (shot) tracers.push(shot); }
    // every gate opens for the hull, both rings, both plates (operator: for
    // now); only the hostile plate's sentries fire
    stepGates(gates, hull, dt, P);
    for (const p of world.plates) if (p.hostile) for (const t of stepSentries(p.sentries, hull, dt, worldLosFor(p), P)) tracers.push(t);
    hits += stepTracers(tracers, hull, dt, (x, z, t) => {
      if (t && t.kind === 'shot') {
        if (bodyAt(bodies, x, z)) return true; // solid, unharmed
        if (!worldBlocked(world, x, z)) return false;
        world.plates.forEach((p, pi) => { const pc = damageAt(p.plate, x - p.ox, z - p.oz); if (pc) { if (pc.state >= 3) breached++; rigs[pi].rebuildWalls(); } });
        return true;
      }
      return worldBuildingAt(world, x, z);
    }, P);
    simT += dt;
    if (arrivedAt < 0 && goalDist() <= ARRIVE_M) arrivedAt = simT;
  }

  const logLine = () => `[world] t=${simT.toFixed(1)} hull=${hull.x.toFixed(1)},${hull.z.toFixed(1)} y=${world.heightAt(hull.x, hull.z).toFixed(2)} heading=${hull.heading.toFixed(0)} goal=${goalDist().toFixed(1)} tracking=${sentries.filter((s) => s.tracking).length} lobs=${tracers.filter((t) => t.kind === 'lob').length} hits=${hits}${arrivedAt >= 0 ? ' ARRIVED' : ''}`;

  function sync() {
    const g = groundAt(world, hull.x, hull.z);
    const y = g.y;
    hullObj.userData.setPose(hull, y + 0.3, g.normal);
    world.plates.forEach((p, pi) => {
      p.sentries.forEach((s, i) => { const node = rigs[pi].sentryYaws.get(i); if (node) node.rotation.y = yawRotation(s.yaw); });
      for (const gr of rigs[pi].gateRigs) { const g = p.gates[gr.index]; if (g) setGateOpen(gr, g.open); }
    });
    for (const c of crews) c.scene.sync(lastDt);
    for (const b of bodies) {
      const pi = world.plates.findIndex((p) => p.plate === b.plate);
      const obj = pi >= 0 ? rigs[pi].dynamic.get(b.pieceIndex) : null;
      if (obj) obj.position.set(b.x - world.plates[pi].ox, 0, b.z - world.plates[pi].oz);
    }
    pool.sync(tracers, (x, z) => world.heightAt(x, z), lastDt, P.splashR);
    followCamera(camera, controls, hull, y, view.camera, lastDt, (x, z) => groundAt(world, x, z).y, { cx: world.size / 2, cz: world.size / 2, span: world.size });
    hud.textContent = `goal ${goalDist().toFixed(0)} m${arrivedAt >= 0 ? ` · ARRIVED at ${arrivedAt.toFixed(1)} s` : ''} · hits ${hits} · shots ${hull.shots} · breached ${breached} · cam ${view.camera} · WASD drive · SPACE fire · 1 top 2 chase 3 orbit 4 overview · R regenerate`;
  }

  const regenerate = () => { plateParams.seed = (plateParams.seed + 1) % 1000000; gui.controllersRecursive().forEach((c) => c.updateDisplay()); build(); };
  const CAMS = ['chase', 'top', 'orbit', 'overview'];
  const setCam = (m) => { view.camera = m; controls.enabled = m === 'orbit'; camera.userData.placed = false; gui.controllersRecursive().forEach((c) => c.updateDisplay()); };
  const toggleCam = () => setCam(CAMS[(CAMS.indexOf(view.camera) + 1) % CAMS.length]);
  const keys = makeKeys({ c: toggleCam, r: regenerate, ...Object.fromEntries(Object.entries(CAMERA_KEYS).map(([k, m]) => [k, () => setCam(m)])) });

  const gui = new GUI({ title: 'WORLD', container: root });
  // THE THREE NUMBERS A PLAYER TOUCHES, at the top: how fast, how big a
  // base, how big a world. Base size sets both plate dimensions (4:3, even);
  // the world grows on its own if the bases would not fit.
  const top = { baseSize: plateParams.w };
  gui.add(P, 'speed', 2, 30, 1).name('tank speed (m/s)');
  gui.add(top, 'baseSize', 12, 60, 2).name('base size (cells)').onFinishChange((v) => {
    plateParams.w = v; plateParams.h = Math.max(12, Math.round(v * 0.75 / 2) * 2);
    gui.controllersRecursive().forEach((c) => c.updateDisplay()); build();
  });
  gui.add(W, 'size', 320, 1600, 40).name('world size (m)').onFinishChange(build);
  const wf = {};
  for (const k of WORLD_KNOBS) {
    if (k.key === 'size') continue;
    const f = wf[k.group] || (wf[k.group] = gui.addFolder(k.group));
    f.add(W, k.key, k.min, k.max, k.step).name(k.label).onFinishChange(build);
  }
  const pf = gui.addFolder('plates');
  for (const k of PLATE_KNOBS) pf.add(plateParams, k.key, k.min, k.max, k.step).name(k.label).onFinishChange(build);
  pf.close();
  const df = gui.addFolder('drive');
  for (const k of DRIVE_KNOBS) df.add(P, k.key, k.min, k.max, k.step).name(k.label);
  df.close();
  gui.add(view, 'camera', CAMS).name('camera').onChange((v) => { controls.enabled = v === 'orbit'; camera.userData.placed = false; });
  gui.add({ regenerate }, 'regenerate').name('regenerate (seed+1)');

  let last = 0;
  const probe = q.get('probe') === '1';
  loadCatalog().then(({ catalog: c, error }) => {
    catalog = c;
    if (error) { notice.textContent = `base-kit manifest unavailable, placeholders only (${error})`; notice.hidden = false; }
    build();
    // ?tick=N drives N seconds before the first frame; ?auto=1 follows the
    // road instead of holding the lever straight
    const tick = Number(q.get('tick') || 0);
    if (tick > 0) {
      let idx = 0;
      for (let i = 0; i < tick * 60; i++) {
        let input = { fwd: true };
        if (q.get('auto') === '1') { const r = autopilotInput(hull, world.road.points, idx, 8, P); idx = r.idx; input = r.input; }
        step(1 / 60, input);
      }
      console.log(logLine());
    }
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
