// world-tab.js — THE WORLD: two plates on organic terrain, the road found
// between them, and the hull driving from one gate to the other. The
// terrain, the plates and the road are world.js; the driving is drive.js;
// this file draws them and runs the loop.
import * as THREE from '../vendor/three.module.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import GUI from '../vendor/lil-gui.esm.js';
import { makePlateParams, clampPlateParams, PLATE_KNOBS } from './plate.js?v=bee40328';
import { DRIVE_KNOBS, makeDriveParams, clampDriveParams, makeHull, stepHull, stepGates, stepSentries, stepTracers, fireHull, damageAt } from './drive.js?v=bee40328';
import { WORLD_KNOBS, makeWorldParams, clampWorldParams, makeWorld, worldBlocked, worldBuildingAt, worldLosFor, worldSentries, worldGates, terrainNormal, splitQuad, groundAt } from './world.js?v=bee40328';
import { buildPlateGroup, yawRotation } from './plate-scene.js?v=bee40328';
import { query, loadCatalog } from './plate-tab.js?v=bee40328';
import { makeViewer, makeHullObject, makeKeys, makeTracerPool, followCamera, CAMERA_KEYS } from './drive-rig.js?v=bee40328';

const ARRIVE_M = 8;

// Six vertices per quad so each quad carries its own colour: grass by
// height, dirt on the road. Flat normals give the low-poly look.
function terrainMesh(world) {
  const { mesh, heights } = world;
  const pos = [], col = [];
  const c = new THREE.Color();
  const lo = Math.min(...heights), hi = Math.max(...heights);
  mesh.quads.forEach((q, qi) => {
    const road = world.road.set.has(qi);
    // splitQuad picks the diagonal inside a concave quad and orients both
    // triangles to face up, whatever the kernel's winding did
    const tri = splitQuad(mesh.vertices, q).flat();
    const hAvg = (heights[q[0]] + heights[q[1]] + heights[q[2]] + heights[q[3]]) / 4;
    const t = hi > lo ? (hAvg - lo) / (hi - lo) : 0.5;
    if (road) c.setHSL(0.08, 0.35, 0.28);
    else c.setHSL(0.30 - t * 0.12, 0.45, 0.22 + t * 0.2);
    for (const vi of tri) {
      const [x, z] = mesh.vertices[vi];
      // under a plate the ground is exactly the slab's height, and two
      // coplanar surfaces shimmer; the ground dips below the slab there
      const underPlate = world.plates.some((p) => x > p.ox - 2 && x < p.ox + p.wM + 2 && z > p.oz - 2 && z < p.oz + p.hM + 2);
      pos.push(x, heights[vi] - (underPlate ? 0.8 : 0), z);
      col.push(c.r, c.g, c.b);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
}

function coverMeshes(world) {
  const g = new THREE.Group();
  const m = new THREE.Matrix4();
  const trees = world.trees;
  if (trees.length) {
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.7, 1, 6), new THREE.MeshStandardMaterial({ color: 0x5a3d22, roughness: 0.9 }), trees.length);
    const canopy = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7), new THREE.MeshStandardMaterial({ color: 0x2f7a3a, roughness: 0.85 }), trees.length);
    trees.forEach((t, i) => {
      const y = world.heightAt(t.x, t.z);
      const th = t.h * 0.35;
      m.makeScale(1, th, 1); m.setPosition(t.x, y + th / 2, t.z); trunk.setMatrixAt(i, m);
      const ch = t.h * 0.75, cr = t.h * 0.42;
      m.makeScale(cr, ch, cr); m.setPosition(t.x, y + th + ch / 2 - 0.5, t.z); canopy.setMatrixAt(i, m);
    });
    trunk.instanceMatrix.needsUpdate = true; canopy.instanceMatrix.needsUpdate = true;
    g.add(trunk, canopy);
  }
  if (world.rocks.length) {
    const rock = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x6b6f75, roughness: 0.95, flatShading: true }), world.rocks.length);
    world.rocks.forEach((r, i) => {
      m.makeScale(r.r, r.h, r.r * 0.8); m.setPosition(r.x, world.heightAt(r.x, r.z) + r.h * 0.35, r.z); rock.setMatrixAt(i, m);
    });
    rock.instanceMatrix.needsUpdate = true;
    g.add(rock);
  }
  return g;
}

export function initWorldTab(root) {
  const { renderer, scene, camera, hud, notice, resize } = makeViewer(root);
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

  let catalog = null, world = null, group = null, rigs = [], gates = [], sentries = [], tracers = [], hull = null;
  let hits = 0, simT = 0, lastLog = 0, arrivedAt = -1, lastDt = 0.016, breached = 0;

  function build() {
    if (group) scene.remove(group);
    pool.clear();
    world = makeWorld({ ...W, seed: plateParams.seed }, plateParams);
    window.__world = world;
    group = new THREE.Group();
    group.add(terrainMesh(world));
    group.add(coverMeshes(world));
    rigs = world.plates.map((p) => {
      const rig = buildPlateGroup({ plate: p.plate, catalog, wallState: null, animatedGates: true, showBlind: false, showArcs: p.hostile });
      rig.group.position.set(p.ox, 0, p.oz);
      group.add(rig.group);
      return rig;
    });
    scene.add(group);
    gates = worldGates(world);
    sentries = worldSentries(world);
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
    if (input.fire) { const shot = fireHull(hull, P); if (shot) tracers.push(shot); }
    for (const p of world.plates) {
      if (!p.hostile) stepGates(p.gates, hull, dt, P);
      else for (const t of stepSentries(p.sentries, hull, dt, worldLosFor(p), P)) tracers.push(t);
    }
    hits += stepTracers(tracers, hull, dt, (x, z, t) => {
      if (t && t.kind === 'shot') {
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
      for (const gr of rigs[pi].gateRigs) { const g = p.gates[gr.index]; if (g && gr.mixer) gr.mixer.setTime(g.open * gr.duration); }
    });
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
