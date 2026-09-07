// world-tab.js — THE WORLD: two plates on organic terrain, the road found
// between them, and the hull driving from one gate to the other. The
// terrain, the plates and the road are world.js; the driving is drive.js;
// this file draws them and runs the loop.
import * as THREE from '../vendor/three.module.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import GUI from '../vendor/lil-gui.esm.js';
import { bodyDims } from './catalog.js?v=7dcea21e';
import { makePlateParams, clampPlateParams, PLATE_KNOBS, CELL_M } from './plate.js?v=7dcea21e';
import { DRIVE_KNOBS, makeDriveParams, clampDriveParams, makeHull, stepHull, stepGates, stepSentries, stepTracers, fireHull, damageAt, autopilotInput, makeBodies, stepBodies, bodyAt, shotRangeFor, solidHeightAt, SOLID_HEIGHT, damageSentryAt, stepCrush, ammoDotsLit, bodyHit, damageBody, powered } from './drive.js?v=7dcea21e';
import { WORLD_KNOBS, makeWorldParams, clampWorldParams, makeWorld, worldBlocked, worldBuildingAt, worldLosFor, worldSentries, worldGates, terrainNormal, splitQuad, groundAt } from './world.js?v=7dcea21e';
import { PALETTE, terrainMeshes, floraMeshes, LOOK, LOOKS } from './looks.js?v=7dcea21e';
import { withParam } from './url.js?v=7dcea21e';
import { buildPlateGroup, yawRotation, setGateOpen } from './plate-scene.js?v=7dcea21e';
import { query, loadCatalog } from './plate-tab.js?v=7dcea21e';
import { modelledIds } from './catalog.js?v=7dcea21e';
import { makeViewer, makeHullObject, makeKeys, makeTracerPool, followCamera, CAMERA_KEYS, makeMobileShell, mobileShell } from './drive-rig.js?v=7dcea21e';
import { makeSfx } from './sfx.js?v=7dcea21e';
import { makeCrew, stepCrew, stepSquash, shotHits, splashHits, hullCovers, crewFreeAt, CREW_TUNE } from './crew.js?v=7dcea21e';
import { makeCrewScene } from './crew-scene.js?v=7dcea21e';
import { mulberry32 } from './rng.js?v=7dcea21e';

const ARRIVE_M = 8;

export function initWorldTab(root) {
  const { renderer, scene, camera, hud, notice, resize, render, setGroups, post } = makeViewer(root);
  post.post.weights.crew = 0; // orange suits, not glowing
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
  const sfx = makeSfx(scene);

  let catalog = null, world = null, group = null, rigs = [], gates = [], sentries = [], tracers = [], hull = null, bodies = [];
  let crews = [], crewRng = null;
  // what a shot can damage: anything the catalog has damaged models for
  const destructible = (pc) => { const e = catalog && catalog.get(pc.id); return !!(e && e.states[1] && e.states[3]); };
  const CREW_N = Number(q.get('crew') || 7);
  let hits = 0, simT = 0, lastLog = 0, arrivedAt = -1, lastDt = 0.016, breached = 0, squashed = 0, crushed = 0, powerWas = [], bodiesBroken = 0;

  function build() {
    if (group) scene.remove(group);
    pool.clear();
    sfx.clearMachines();
    world = makeWorld({ ...W, seed: plateParams.seed }, plateParams, modelledIds(catalog));
    window.__world = world;
    group = new THREE.Group();
    const { fill, wire } = terrainMeshes(world, splitQuad);
    group.add(fill, wire);
    const flora = floraMeshes(world);
    group.add(flora);
    // the TD board's weights: the map calm, machines and effects hot
    setGroups(() => [['map', [fill, wire]], ['tank', [hullObj]], ['towers', rigs.map((r) => r.group)], ['effects', [flora]], ['crew', crews.map((c) => c.scene.group)]]);
    rigs = world.plates.map((p) => {
      const rig = buildPlateGroup({ plate: p.plate, catalog, wallState: null, animatedGates: true, showBlind: false, showArcs: p.hostile, tint: p.hostile ? PALETTE.hostile : PALETTE.home });
      rig.group.position.set(p.ox, 0, p.oz);
      group.add(rig.group);
      return rig;
    });
    scene.add(group);
    gates = worldGates(world);
    sentries = worldSentries(world);
    bodies = world.plates.flatMap((p) => makeBodies(p.plate, p.ox, p.oz, bodyDims(catalog)));
    powerWas = world.plates.map(() => true);
    crewRng = mulberry32(plateParams.seed ^ 0x51ed);
    // a crew per plate, in the plate's own frame under its rig group
    crews = world.plates.map((p, pi) => {
      // solid to this plate's crew, in plate metres: the world's bodies shifted in, and the hull
      const solid = (x, z) => bodyAt(bodies, x + p.ox, z + p.oz) || (hull && hullCovers({ x: hull.x - p.ox, z: hull.z - p.oz, heading: hull.heading }, x, z));
      const crew = makeCrew(p.plate, CREW_N, crewRng, CREW_TUNE, solid);
      crew.hostile = p.hostile; // the enemy's crew is rolled over; home's is shoved aside
      const g = new THREE.Group(); g.name = 'crew'; rigs[pi].group.add(g);
      return { plate: p.plate, p, crew, solid, scene: makeCrewScene(g, crew) };
    });
    squashed = 0; crushed = 0; sfx.clearBodies();
    tracers = [];
    hits = 0; simT = 0; lastLog = 0; arrivedAt = -1; breached = 0;
    hull = makeHull(world.spawn.x, world.spawn.z, world.spawn.heading);
    if (q.get('ammo') !== null) hull.ammo = Number(q.get('ammo')); // a probe's rack
    camera.userData.placed = false;
    console.log(`[world] quads ${world.mesh.quads.length} road ${world.road.quads.length} trees ${world.trees.length} rocks ${world.rocks.length} warnings ${world.warnings.length}`);
    window.__drive = { hull, gates, sentries, tracers, get hits() { return hits; } };
  }

  const goalDist = () => Math.hypot(hull.x - world.goal.x, hull.z - world.goal.z);

  function step(dt, input) {
    world.plates.forEach((p, pi) => {
      const local = { x: hull.x - p.ox, z: hull.z - p.oz, heading: hull.heading, speed: hull.speed };
      for (const pc of stepCrush(p.plate, local, P)) {
        hull.speed = local.speed; crushed++;
        const cx = (pc.x + pc.pw / 2) * CELL_M + p.ox, cz = (pc.z + pc.ph / 2) * CELL_M + p.oz;
        sfx.impact('shell', [cx, groundAt(world, cx, cz).y + 0.6, cz], [0, 1, 0], 0, 2.4, 'impact_rubble');
        rigs[pi].rebuild();
      }
    });
    stepHull(hull, input, dt, (x, z) => worldBlocked(world, x, z), P);
    if (hull.bump) sfx.wallHit(hull.bump);
    sfx.elevating(Boolean(hull.elevating));
    stepBodies(bodies, hull, (x, z) => worldBlocked(world, x, z), P, dt);
    bodies.forEach((b, i) => {
      sfx.body(i, b.moved, Math.hypot(b.x - hull.x, b.z - hull.z), dt);
      if (b.touched) sfx.thud(0);
      if (b.rammed) { const r = damageBody(b); if (r && r.stepped) bodiesBroken++; sfx.bodyHit(b, [b.x, groundAt(world, b.x, b.z).y + 1.2, b.z], 0, r); }
    });
    // THE POWER, per plate: a station at D3 drops that plate's sentries
    world.plates.forEach((p, pi) => {
      const on = powered(p.plate);
      if (powerWas[pi] && !on) { rigs[pi].setPowered(false); const st = p.plate.pieces[p.plate.power.pieceIndex]; const cx = (st.x + 1) * CELL_M + p.ox, cz = (st.z + 1) * CELL_M + p.oz; sfx.impact('shell', [cx, groundAt(world, cx, cz).y + 3, cz], [0, 1, 0], Math.hypot(cx - hull.x, cz - hull.z), 4.5, 'impact_rubble'); }
      powerWas[pi] = on;
    });
    // a crew fears the hull only on the hostile plate; a hull squashes anyone, anywhere
    for (const c of crews) {
      const local = { x: hull.x - c.p.ox, z: hull.z - c.p.oz, heading: hull.heading, speed: hull.speed };
      stepCrew(c.crew, c.plate, dt, crewRng, c.p.hostile ? local : null, CREW_TUNE, c.solid, (x, z) => hullCovers(local, x, z));
      for (const w of stepSquash(c.crew, local, P.hullR)) { squashed++; sfx.softHit([w.x + c.p.ox, groundAt(world, w.x + c.p.ox, w.z + c.p.oz).y + 0.6, w.z + c.p.oz], 0); }
    }
    if (input.fire) { const shot = fireHull(hull, P); if (shot) { tracers.push(shot); sfx.fire(); } else if (hull.empty) sfx.empty(); }
    sfx.engine(hull.speed, P.speed, dt);
    // every gate opens for the hull, both rings, both plates (operator: for
    // now); only the hostile plate's sentries fire
    stepGates(gates, hull, dt, P);
    for (const p of world.plates) if (p.hostile) for (const t of stepSentries(p.sentries, hull, dt, worldLosFor(p), P, powered(p.plate))) {
      tracers.push(t);
      const s = p.sentries[t.from];
      if (s) sfx.sentryFired(s.family, Math.hypot(s.cx - hull.x, s.cz - hull.z));
    }
    const distTo = (x, z) => Math.hypot(x - hull.x, z - hull.z);
    const damage = (x, z) => world.plates.forEach((p, pi) => {
      const sd = damageSentryAt(p.plate, p.sentries, x - p.ox, z - p.oz, P);
      if (sd && sd.destroyed) { rigs[pi].breakSentry(sd.sentry.index); sfx.sentryDestroyed([sd.sentry.cx, groundAt(world, sd.sentry.cx, sd.sentry.cz).y + 3.2, sd.sentry.cz], distTo(x, z)); }
      const pc = damageAt(p.plate, x - p.ox, z - p.oz, destructible);
      if (!pc) return;
      if (pc.state >= 3) { breached++; sfx.impact('shell', [x, groundAt(world, x, z).y + 4, z], [0, 1, 0], distTo(x, z), 4.5, 'impact_rubble'); }
      rigs[pi].rebuild();
    });
    const before = hits;
    // the soft bodies, per plate in plate metres: a landing kills everyone
    // in its splash; a shell through an astronaut stops there
    const splash = (x, z) => {
      for (const c of crews) for (const w of splashHits(c.crew, x - c.p.ox, z - c.p.oz)) { squashed++; sfx.softHit([w.x + c.p.ox, groundAt(world, w.x + c.p.ox, w.z + c.p.oz).y + 1.0, w.z + c.p.oz], distTo(x, z)); }
    };
    const through = (x, z, y, t) => {
      for (const c of crews) {
        const w = shotHits(c.crew, x - c.p.ox, z - c.p.oz, y);
        if (w) {
          const n = Math.hypot(t.vx, t.vz) || 1;
          squashed++;
          sfx.impact('shell', [x, t.y, z], [-t.vx / n, 0.2, -t.vz / n], distTo(x, z));
          sfx.softHit([w.x + c.p.ox, t.y, w.z + c.p.oz], distTo(x, z), [-t.vx / n, 0.4, -t.vz / n]);
          return true;
        }
      }
      return false;
    };
    hits += stepTracers(tracers, hull, dt, (x, z, t) => {
      if (t && t.kind === 'lob' && t.landed) { sfx.impact('shell', [x, groundAt(world, x, z).y + 0.1, z], [0, 1, 0], distTo(x, z), 3.2, 'tower_aoe'); splash(x, z); return true; }
      if (t && t.kind === 'shot') {
        const y = t.y - groundAt(world, x, z).y; // height above the ground under it
        if (t.landed) { sfx.impact('shell', [x, t.y + 0.1, z], groundAt(world, x, z).normal, distTo(x, z)); damage(x, z); splash(x, z); return true; }
        if (through(x, z, y, t)) return true;
        const hb = bodyHit(bodies, x, z);
        if (hb && y <= SOLID_HEIGHT.body) { const r = damageBody(hb); if (r && r.stepped) bodiesBroken++; sfx.bodyHit(hb, [x, t.y, z], distTo(x, z), r); return true; }
        if (!worldBlocked(world, x, z)) return false;
        const p = world.plates.find((q) => x >= q.ox && x < q.ox + q.wM && z >= q.oz && z < q.oz + q.hM);
        const h = p ? solidHeightAt(p.plate, x - p.ox, z - p.oz, p.sentries) : 6; // a trunk or rock off-plate
        if (y > h) return false;
        const n = Math.hypot(t.vx, t.vz) || 1;
        sfx.impact('shell', [x, t.y, z], [-t.vx / n, 0.2, -t.vz / n], distTo(x, z));
        damage(x, z);
        return true;
      }
      return worldBuildingAt(world, x, z);
    }, P, (x, z) => groundAt(world, x, z).y);
    if (hits > before) { sfx.impact('light', [hull.x, hull.y + 1.5, hull.z], [0, 1, 0], 0, 2, null); sfx.hitOnHull(); }
    simT += dt;
    if (arrivedAt < 0 && goalDist() <= ARRIVE_M) arrivedAt = simT;
  }

  const logLine = () => `[world] t=${simT.toFixed(1)} hull=${hull.x.toFixed(1)},${hull.z.toFixed(1)} y=${world.heightAt(hull.x, hull.z).toFixed(2)} heading=${hull.heading.toFixed(0)} goal=${goalDist().toFixed(1)} tracking=${sentries.filter((s) => s.tracking).length} lobs=${tracers.filter((t) => t.kind === 'lob').length} hits=${hits} ammo=${hull.ammo} down=${squashed} sentriesDown=${sentries.filter((s) => !s.alive).length} crushed=${crushed} bodiesBroken=${bodiesBroken} power=${world.plates.map((p) => (powered(p.plate) ? 'on' : 'off')).join('/')} crewIn=${crews.reduce((n, c) => n + c.crew.walkers.filter((w) => w.alive && !crewFreeAt(c.plate, w.x, w.z, c.solid)).length, 0)}${arrivedAt >= 0 ? ' ARRIVED' : ''}`;

  function sync() {
    const g = groundAt(world, hull.x, hull.z);
    const y = g.y;
    hull.y = y;
    hullObj.userData.setPose(hull, y + 0.3, g.normal);
    sfx.applyFeel(hullObj);
    if (hullObj.userData.setAmmoDots) hullObj.userData.setAmmoDots(ammoDotsLit(hull.ammo, P));
    world.plates.forEach((p, pi) => {
      rigs[pi].syncBodies(bodies.filter((b) => b.plate === p.plate), p.ox, p.oz);
      rigs[pi].cull(camera.position.x - p.ox, camera.position.z - p.oz, camera.position.y - y > 150 ? Infinity : CULL_M);
      p.sentries.forEach((s, i) => { const node = rigs[pi].sentryYaws.get(i); if (node) node.rotation.y = yawRotation(s.yaw); });
      for (const gr of rigs[pi].gateRigs) { const g = p.gates[gr.index]; if (g) setGateOpen(gr, g.open); }
    });
    for (const c of crews) c.scene.sync(lastDt, () => 0, (x, z) => camera.position.y - y > 150 || Math.hypot(x + c.p.ox - camera.position.x, z + c.p.oz - camera.position.z) < CULL_M);
    rigs.forEach((r, pi) => r.loopRigs.forEach((lr, i) => { lr.mixer.update(lastDt); const p = world.plates[pi]; sfx.machine(`${pi}:${i}`, Math.hypot(lr.obj.position.x + p.ox - hull.x, lr.obj.position.z + p.oz - hull.z)); }));
    sfx.tick(lastDt);
    pool.sync(tracers, (x, z) => world.heightAt(x, z), lastDt, P.splashR);
    followCamera(camera, controls, hull, y, view.camera, lastDt, (x, z) => groundAt(world, x, z).y, { cx: world.size / 2, cz: world.size / 2, span: world.size }, (x, z) => worldBlocked(world, x, z));
    hud.textContent = mobileShell
      ? `goal ${goalDist().toFixed(0)} m${arrivedAt >= 0 ? ' · ARRIVED' : ''} · muzzle ${hull.elev.toFixed(0)} · range ${shotRangeFor(hull, P).toFixed(0)} m · shells ${hull.ammo} · hits ${hits} · breached ${breached} · crew down ${squashed}`
      : `goal ${goalDist().toFixed(0)} m${arrivedAt >= 0 ? ` · ARRIVED at ${arrivedAt.toFixed(1)} s` : ''} · muzzle ${hull.elev.toFixed(0)} deg · range ${shotRangeFor(hull, P).toFixed(0)} m · hits ${hits} · shots ${hull.shots} · shells ${hull.ammo}/${P.ammoMax} · breached ${breached} · crew down ${squashed} · sentries ${sentries.filter((s) => s.alive).length}/${sentries.length} · cam ${view.camera} · WASD drive · SPACE fire · SHIFT+W/S muzzle · 1-4 cameras · R regenerate`;
  }

  const regenerate = () => { plateParams.seed = (plateParams.seed + 1) % 1000000; gui.controllersRecursive().forEach((c) => c.updateDisplay()); build(); };
  const CAMS = ['chase', 'top', 'orbit', 'overview'];
  const setCam = (m) => { if (m !== view.camera) sfx.uiClick(); view.camera = m; controls.enabled = m === 'orbit'; camera.userData.placed = false; gui.controllersRecursive().forEach((c) => c.updateDisplay()); };
  const toggleCam = () => setCam(CAMS[(CAMS.indexOf(view.camera) + 1) % CAMS.length]);
  const keys = makeKeys({ c: toggleCam, r: regenerate, ...Object.fromEntries(Object.entries(CAMERA_KEYS).map(([k, m]) => [k, () => setCam(m)])) });
  makeMobileShell(root, keys, { onCamera: toggleCam });

  const gui = new GUI({ title: 'WORLD', container: root });
  // THE THREE NUMBERS A PLAYER TOUCHES, at the top: how fast, how big a
  // base, how big a world. Base size sets both plate dimensions (4:3, even);
  // the world grows on its own if the bases would not fit.
  const top = { baseSize: plateParams.w };
  gui.add(P, 'speed', 2, 30, 1).name('tank speed (m/s)');
  gui.add(top, 'baseSize', 12, 120, 2).name('base size (cells)').onFinishChange((v) => {
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
  gui.add({ look: LOOK }, 'look', LOOKS).name('look').onChange((v) => { location.href = withParam('look', v); location.reload(); });
  gui.add(view, 'camera', CAMS).name('camera').onChange((v) => { controls.enabled = v === 'orbit'; camera.userData.placed = false; });
  gui.add({ regenerate }, 'regenerate').name('regenerate (seed+1)');

  let last = 0;
  const probe = q.get('probe') === '1';
  const CULL_M = q.get('cull') !== null ? Number(q.get('cull')) : 260;
  loadCatalog().then(({ catalog: c, error }) => {
    catalog = c;
    if (error) { notice.textContent = `base-kit manifest unavailable, placeholders only (${error})`; notice.hidden = false; }
    build();
    // ?tick=N drives N seconds before the first frame; ?auto=1 follows the
    // road instead of holding the lever straight
    // ?killpower=N: plate N's station goes to D3 after two simulated seconds (the freeze probe)
    const killPower = q.get('killpower') !== null ? Number(q.get('killpower')) : -1;
    if (killPower >= 0) { const p = world.plates[killPower]; if (p && p.plate.power) setTimeout(() => { p.plate.pieces[p.plate.power.pieceIndex].state = 3; rigs[killPower].rebuild(); console.log('[world] station felled on plate', killPower); }, 2000); }
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
