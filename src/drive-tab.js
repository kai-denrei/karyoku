// drive-tab.js — THE DRIVE: the MKCX-2 on a generated plate. Keys move the
// hull, gates open as it nears them, sentries sweep their arcs and fire
// tracers at what they can see, and a counter says how many would have
// hit. The rules are drive.js; this file wires the rig around them.
import * as THREE from '../vendor/three.module.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import GUI from '../vendor/lil-gui.esm.js';
import { noteStep } from './fps.js?v=110951bf';
import { bodyDims } from './catalog.js?v=110951bf';
import { generatePlate, makePlateParams, clampPlateParams, PLATE_KNOBS, CELL_M, dirOfYaw, reservedAt } from './plate.js?v=110951bf';
import { DRIVE_KNOBS, makeDriveParams, clampDriveParams, makeHull, stepHull, blockedAt, makeGates, stepGates,
  spawnFor, makeSentries, stepSentries, losClear, stepTracers, rayStop, fireHull, damageAt, makeBodies, stepBodies, bodyAt, shotRangeFor, damageSentryAt, stepCrush, stepRam, ammoDotsLit, bodyHit, damageBody, powered, damageSplit } from './drive.js?v=110951bf';
import { PALETTE, LOOK, LOOKS } from './looks.js?v=110951bf';
import { withParam } from './url.js?v=110951bf';
import { buildPlateGroup, yawRotation, setGateOpen } from './plate-scene.js?v=110951bf';
import { query, loadCatalog } from './plate-tab.js?v=110951bf';
import { modelledIds } from './catalog.js?v=110951bf';
import { makeViewer, makeHullObject, makeKeys, makeTracerPool, followCamera, CAMERA_KEYS, makeMobileShell, mobileShell, makeGuardObject, makeFlagStand, makeCarriedFlag } from './drive-rig.js?v=110951bf';
import { makeSfx } from './sfx.js?v=110951bf';
import { makeCrew, stepCrew, stepSquash, shotHits, splashHits, hullCovers, crewFreeAt, CREW_TUNE } from './crew.js?v=110951bf';
import { makeCrewScene } from './crew-scene.js?v=110951bf';
import { makeGuard, stepGuard, GUARD_TUNE } from './guard.js?v=110951bf';
import { makeCtf, stepCtf, poleState, SLOTS, CTF_TUNE } from './ctf.js?v=110951bf';
import { mulberry32 } from './rng.js?v=110951bf';

export function initDriveTab(root) {
  const { renderer, scene, camera, hud, notice, resize, render, setGroups, post, radar } = makeViewer(root);
  post.post.weights.crew = 0; // orange suits, not glowing
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
  const sfx = makeSfx(scene);

  let catalog = null, plate = null, rig = null, gates = [], sentries = [], tracers = [], hull = null, bodies = [];
  // what the crew's cells do not know is solid: the containers and the tank
  const crewSolid = (x, z) => bodyAt(bodies, x, z) || hullCovers(hull, x, z);
  let crew = [], crewScene = null, crewRng = null;
  const destructible = (pc) => { const e = catalog && catalog.get(pc.id); return !!(e && e.states[1] && e.states[3]); };
  const CREW_N = Number(q.get('crew') || 18);
  let hits = 0, simT = 0, lastLog = 0, lastDt = 0.016, breached = 0, squashed = 0, crushed = 0, powerWas = true, bodiesBroken = 0;
  let guard = null;
  let ctf = null, stand = null, carried = null;
  const guardObj = makeGuardObject(scene);
  scene.add(guardObj.obj);

  function build() {
    if (rig) scene.remove(rig.group);
    pool.clear();
    sfx.clearMachines();
    plate = generatePlate(params, modelledIds(catalog));
    window.__plate = plate;
    rig = buildPlateGroup({ plate, catalog, wallState: null, animatedGates: true, tint: PALETTE.hostile });
    scene.add(rig.group);
    setGroups(() => [['tank', [hullObj]], ['towers', [rig.group]], ['crew', [crewScene.group]]]);
    gates = makeGates(plate);
    sentries = makeSentries(plate);
    bodies = makeBodies(plate, 0, 0, bodyDims(catalog));
    powerWas = true;
    crewRng = mulberry32(params.seed ^ 0x51ed);
    crew = makeCrew(plate, CREW_N, crewRng, CREW_TUNE, crewSolid);
    crew.hostile = true; // this plate is the target: its crew is the enemy's, and the hull rolls over them
    // THE FLAGS: this plate is the enemy's; its stand holds the power flag, to be taken (no home here to plant it)
    if (stand) scene.remove(stand.group);
    if (carried) { carried.remove(); carried = null; }
    ctf = makeCtf({ home: null, hostile: plate.flags ? plate.flags.poles : null });
    stand = plate.flags ? makeFlagStand(scene, plate.flags.poles, 'hostile', SLOTS) : null;
    if (stand) { stand.set(0, poleState(ctf, 'hostile', 0)); stand.set(1, poleState(ctf, 'hostile', 1)); }
    // THE GUARD: this plate's, over the compound (or the plate's centre), hostile
    { const st = plate.power ? plate.pieces[plate.power.pieceIndex] : null; guard = makeGuard(st ? (st.x + 1) * CELL_M : plate.w * CELL_M / 2, st ? (st.z + 1) * CELL_M : plate.h * CELL_M / 2, true); }
    sfx.clearBodies();
    const crewGroup = new THREE.Group(); crewGroup.name = 'crew';
    rig.group.add(crewGroup);
    crewScene = makeCrewScene(crewGroup, crew);
    squashed = 0; crushed = 0;
    tracers = [];
    hits = 0; simT = 0; lastLog = 0; breached = 0;
    const sp = spawnFor(plate, plate.gates[0]);
    // ?aim=wall: spawn six cells along the wall from the gate, so a probe's
    // shots land on standard wall segments rather than the gate
    if (q.get('aim') === 'wall') { const g = plate.gates[0]; if (g.side === 'N' || g.side === 'S') sp.x += 6 * CELL_M; else sp.z += 6 * CELL_M; }
    // ?aim=sentry: park in the band three and a half cells behind the first
    // sentry (inside the ring, so the wall is not in the way), facing it
    // along its own home line, so a probe's flat shots land on its socket
    // ?aim=power: park three cells outside the compound's gate, facing the station
    if (q.get('aim') === 'power' && plate.power) { const g = plate.gates.find((gg) => gg.ring === 'power'); const gp = plate.pieces[g.pieceIndex]; const [ox, oz] = dirOfYaw({ N: 0, E: 90, S: 180, W: 270 }[g.side]); sp.x = (gp.x + gp.pw / 2) * CELL_M + ox * 4 * CELL_M; sp.z = (gp.z + gp.ph / 2) * CELL_M + oz * 4 * CELL_M; sp.heading = ({ N: 180, E: 270, S: 0, W: 90 })[g.side]; }
    if (q.get('aim') === 'sentry' && sentries.length) { const s = sentries[0]; const [dx, dz] = dirOfYaw(s.home); sp.x = s.cx - dx * 3.5 * CELL_M; sp.z = s.cz - dz * 3.5 * CELL_M; sp.heading = s.home; }
    hull = makeHull(sp.x, sp.z, sp.heading, P);
    if (q.get('elev') !== null) hull.elev = Number(q.get('elev')); // a probe's muzzle
    if (q.get('ammo') !== null) hull.ammo = Number(q.get('ammo')); // a probe's rack
    // ?breakat=x,z: the body nearest that point starts DESTROYED (state 3), to see what its debris looks like
    if (q.get('breakat')) { const [bx, bz] = q.get('breakat').split(',').map(Number); const b = bodies.reduce((best, c) => (Math.hypot(c.x - bx, c.z - bz) < Math.hypot(best.x - bx, best.z - bz) ? c : best), bodies[0]); if (b) { const to = q.get('breakto') !== null ? Number(q.get('breakto')) : 3; while (!b.dead && b.state < to) damageBody(b); console.log(`[drive] broke ${b.id} to d${b.state} at ${b.x.toFixed(0)},${b.z.toFixed(0)}`); } }
    // ?at=x,z and ?heading=deg park a probe's hull anywhere on the plate
    if (q.get('at')) { const [ax, az] = q.get('at').split(',').map(Number); if (Number.isFinite(ax) && Number.isFinite(az)) { hull.x = ax; hull.z = az; } }
    if (q.get('heading') !== null) hull.heading = Number(q.get('heading'));
    camera.userData.placed = false;
    window.__drive = { hull, gates, sentries, tracers, get hits() { return hits; } };
  }

  function step(dt, input) {
    for (const pc of stepCrush(plate, hull, P)) { crushed++; sfx.crush([(pc.x + pc.pw / 2) * CELL_M, 0.6, (pc.z + pc.ph / 2) * CELL_M], 0); rig.rebuild(); }
    // a ram on the comms tower: a state off it, rubble at the third
    for (const pc of stepRam(plate, hull, dt, P)) { const cx = (pc.x + pc.pw / 2) * CELL_M, cz = (pc.z + pc.ph / 2) * CELL_M; sfx.impact('shell', [cx, 2.5, cz], [0, 1, 0], 0, pc.state >= 3 ? 4.5 : 3.0, 'impact_rubble'); if (pc.state >= 3) breached++; rig.rebuild(); }
    stepHull(hull, input, dt, (x, z) => blockedAt(plate, gates, x, z), P);
    if (hull.bump) sfx.wallHit(hull.bump);
    sfx.elevating(Boolean(hull.elevating));
    stepBodies(bodies, hull, (x, z) => blockedAt(plate, gates, x, z) || reservedAt(plate, Math.floor(x / CELL_M), Math.floor(z / CELL_M)), P, dt);
    for (const b of bodies) {
      sfx.body(b.pieceIndex, b.moved, Math.hypot(b.x - hull.x, b.z - hull.z), dt);
      if (b.touched) sfx.thud(0);
      if (b.rammed) { const r = damageBody(b); if (r && r.stepped) bodiesBroken++; sfx.bodyHit(b, [b.x, 1.2, b.z], 0, r, true); }
    }
    // THE POWER: the compound's station at D3 drops every sentry
    const isPowered = powered(plate);
    if (powerWas && !isPowered) { rig.setPowered(false); sfx.impact('shell', [(plate.pieces[plate.power.pieceIndex].x + 1) * CELL_M, 3, (plate.pieces[plate.power.pieceIndex].z + 1) * CELL_M], [0, 1, 0], 0, 4.5, 'impact_rubble'); }
    powerWas = isPowered;
    // this plate is the target: the hull is the enemy its crew runs from
    stepCrew(crew, plate, dt, crewRng, { x: hull.x, z: hull.z, moving: Math.abs(hull.speed) >= 1.5 }, CREW_TUNE, crewSolid, (x, z) => hullCovers(hull, x, z));
    for (const w of stepSquash(crew, hull, P.hullR)) { squashed++; sfx.softHit([w.x, 0.6, w.z], 0); }
    if (input.fire) { const shot = fireHull(hull, P); if (shot) { tracers.push(shot); sfx.fire(); } else if (hull.empty) sfx.empty(); }
    sfx.engine(hull.speed, P.speed, dt);
    stepGates(gates, hull, dt, P);
    if (ctf) for (const ev of stepCtf(ctf, hull, CTF_TUNE, dt)) if (ev === 'capture') { const f = ctf.carrying; if (stand) stand.set(f.slot, 'empty'); carried = makeCarriedFlag(hullObj, SLOTS[f.slot].banner); sfx.flagTaken(); console.log(`[ctf] captured the ${f.glyph} flag`); }
    if (guard) {
      const ev = stepGuard(guard, hull, dt, GUARD_TUNE);
      const gd = Math.hypot(guard.x - hull.x, guard.z - hull.z);
      if (ev.mark) sfx.guardMark(gd);
      if (ev.shot) { tracers.push(ev.shot); sfx.guardFire(gd); }
    }
    for (const t of stepSentries(sentries, hull, dt, (ax, az, bx, bz) => losClear(plate, ax, az, bx, bz), P, isPowered)) {
      tracers.push(t);
      const s = sentries[t.from];
      if (s) sfx.sentryFired(s.family, Math.hypot(s.cx - hull.x, s.cz - hull.z));
    }
    const stop = rayStop(plate, gates, bodies, sentries);
    const distTo = (x, z) => Math.hypot(x - hull.x, z - hull.z);
    const wound = (x, z, pc) => { if (pc.state >= 3) { breached++; sfx.impact('shell', [x, 4, z], [0, 1, 0], distTo(x, z), 4.5, 'impact_rubble'); } rig.rebuild(); };
    const before = hits;
    // the soft bodies: a landing kills everyone in its splash
    const splash = (x, z) => { for (const w of splashHits(crew, x, z)) { squashed++; sfx.softHit([w.x, 1.0, w.z], distTo(w.x, w.z)); } };
    hits += stepTracers(tracers, hull, dt, (x, z, t) => {
      if (t && t.kind === 'lob' && t.landed) { sfx.impact('shell', [x, 0.1, z], [0, 1, 0], distTo(x, z), 3.2, 'tower_aoe'); splash(x, z); return true; }
      if (t && t.kind === 'shot' && t.landed) {
        const pcs = damageSplit(plate, x, z, destructible);
        sfx.impact('shell', [x, 0.1, z], [0, 1, 0], distTo(x, z));
        for (const pc of pcs) wound(x, z, pc);
        splash(x, z);
        return true;
      }
      // ...and a shell through an astronaut stops there: the blast, the cry, the burst
      if (t && t.kind === 'shot') {
        const w = shotHits(crew, x, z, t.y);
        if (w) {
          const n = Math.hypot(t.vx, t.vz) || 1;
          squashed++;
          sfx.impact('shell', [x, t.y, z], [-t.vx / n, 0.2, -t.vz / n], distTo(x, z));
          sfx.softHit([w.x, 1.0, w.z], distTo(x, z), [-t.vx / n, 0.4, -t.vz / n]);
          return true;
        }
      }
      if (!stop(x, z, t)) return false;
      if (t && t.kind === 'shot') {
        const n = Math.hypot(t.vx, t.vz) || 1;
        // a body takes the round: a state off it, and debris when it dies
        const hb = bodyHit(bodies, x, z);
        if (hb) { const r = damageBody(hb); if (r && r.stepped) bodiesBroken++; sfx.bodyHit(hb, [x, t.y, z], distTo(x, z), r); return true; }
        sfx.impact('shell', [x, t.y, z], [-t.vx / n, 0.2, -t.vz / n], distTo(x, z));
        for (const pc of damageSplit(plate, x, z, destructible)) wound(x, z, pc); // a seam hit wounds both walls
        const sd = damageSentryAt(plate, sentries, x, z, P);
        if (sd && sd.destroyed) { rig.breakSentry(sd.sentry.index); sfx.sentryDestroyed([sd.sentry.cx, 3.2, sd.sentry.cz], distTo(x, z)); }
      }
      return true;
    }, P, () => 0);
    if (hits > before) { sfx.impact('light', [hull.x, 1.5, hull.z], [0, 1, 0], 0, 2, null); sfx.hitOnHull(); }
    simT += dt;
  }

  const gateWord = () => gates.map((g) => `${g.side}:${g.open >= 0.95 ? 'open' : g.open <= 0 ? 'shut' : 'moving'}`).join(' ');
  const logLine = () => `[drive] t=${simT.toFixed(1)} hull=${hull.x.toFixed(1)},${hull.z.toFixed(1)} heading=${hull.heading.toFixed(0)} gates=${gateWord()} tracking=${sentries.filter((s) => s.tracking).length} lobs=${tracers.filter((t) => t.kind === 'lob').length} hits=${hits} shots=${hull.shots} ammo=${hull.ammo} down=${squashed} sentriesDown=${sentries.filter((s) => !s.alive).length} crushed=${crushed} bodiesBroken=${bodiesBroken} power=${powered(plate) ? 'on' : 'off'} guard=${guard ? guard.state + ':' + guard.shots : '-'} flag=${ctf ? (ctf.carrying ? 'carried' : 'theirs') : '-'} damaged=${plate.pieces.filter((pc) => pc.kind === 1 && pc.state > 0).length} breached=${breached} fx=${sfx.live} crewIn=${crew ? crew.walkers.filter((w) => w.alive && !crewFreeAt(plate, w.x, w.z, crewSolid)).length : 0} engine=${sfx.running ? 'on' : 'off'} hover=${sfx.feel.hoverT.toFixed(2)} bodyY=${hullObj.userData.hoverBody ? hullObj.userData.hoverBody.position.y.toFixed(3) : 'none'}`;

  function sync() {
    hullObj.userData.setPose(hull, 0);
    sfx.applyFeel(hullObj);
    if (hullObj.userData.setAmmoDots) hullObj.userData.setAmmoDots(ammoDotsLit(hull.ammo, P));
    sentries.forEach((s, i) => { const node = rig.sentryYaws.get(i); if (node) node.rotation.y = yawRotation(s.yaw); });
    for (const gr of rig.gateRigs) { const g = gates[gr.index]; if (g) setGateOpen(gr, g.open); }
    rig.syncBodies(bodies);
    if (guard) guardObj.setPose(guard, () => 0, lastDt);
    if (stand) stand.tick(lastDt);
    if (carried) carried.tick(lastDt);
    // render only what is closer: past CULL_M from the camera a tile is skipped; the overview sees all
    const far = camera.position.y > 150 ? Infinity : CULL_M;
    rig.cull(camera.position.x, camera.position.z, far);
    if (crewScene) crewScene.sync(lastDt, () => 0, (x, z) => far === Infinity || Math.hypot(x - camera.position.x, z - camera.position.z) < far);
    rig.loopRigs.forEach((r, i) => { r.mixer.update(lastDt); sfx.machine(i, Math.hypot(r.obj.position.x - hull.x, r.obj.position.z - hull.z)); });
    sfx.tick(lastDt);
    pool.sync(tracers, () => 0, lastDt, P.splashR);
    followCamera(camera, controls, hull, 0, view.camera, lastDt, null, { cx: plate.w * CELL_M / 2, cz: plate.h * CELL_M / 2, span: Math.max(plate.w, plate.h) * CELL_M }, (x, z) => blockedAt(plate, gates, x, z));
    // the scope: this plate is the enemy's, so its towers are red and its people orange
    const contacts = [];
    for (const s of sentries) if (s.alive) contacts.push({ x: s.cx, z: s.cz, side: 'hostile', kind: 'static' });
    if (guard) contacts.push({ x: guard.x, z: guard.z, side: 'hostile', kind: 'static' });
    if (plate.flags) for (const q of plate.flags.poles) contacts.push({ x: q.x, z: q.z, side: 'hostile', kind: 'static' });
    if (plate.power && powered(plate)) { const st = plate.pieces[plate.power.pieceIndex]; contacts.push({ x: (st.x + 1) * CELL_M, z: (st.z + 1) * CELL_M, side: 'hostile', kind: 'static' }); }
    if (crew) for (const w of crew.walkers) if (w.alive) contacts.push({ x: w.x, z: w.z, side: 'hostile', kind: 'unit' });
    radar.paint(simT, hull, contacts);
    hud.textContent = mobileShell
      ? `muzzle ${hull.elev.toFixed(0)} · range ${shotRangeFor(hull, P).toFixed(0)} m · shells ${hull.ammo} · hits ${hits} · breached ${breached} · crew down ${squashed}`
      : `muzzle ${hull.elev.toFixed(0)} deg · range ${shotRangeFor(hull, P).toFixed(0)} m · hits ${hits} · shots ${hull.shots} · shells ${hull.ammo}/${P.ammoMax} · breached ${breached} · crew down ${squashed} · sentries ${sentries.filter((s) => s.alive).length}/${sentries.length} · power ${powered(plate) ? 'on' : 'OFF'} · gates ${gateWord()} · cam ${view.camera} · WASD drive · SPACE fire · SHIFT+W/S muzzle · 1-4 cameras · R regenerate`;
  }

  const regenerate = () => { params.seed = (params.seed + 1) % 1000000; gui.controllersRecursive().forEach((c) => c.updateDisplay()); build(); };
  const CAMS = ['chase', 'top', 'orbit', 'overview'];
  const setCam = (m) => { if (m !== view.camera) sfx.uiClick(); view.camera = m; controls.enabled = m === 'orbit'; camera.userData.placed = false; gui.controllersRecursive().forEach((c) => c.updateDisplay()); };
  const toggleCam = () => setCam(CAMS[(CAMS.indexOf(view.camera) + 1) % CAMS.length]);
  const keys = makeKeys({ c: toggleCam, r: regenerate, ...Object.fromEntries(Object.entries(CAMERA_KEYS).map(([k, m]) => [k, () => setCam(m)])) });
  makeMobileShell(root, keys, { onCamera: toggleCam });

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
  const CULL_M = q.get('cull') !== null ? Number(q.get('cull')) : 260;
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
      const inp = keys.input();
      if (q.get('autofire') === '1') inp.fire = true; // a probe that keeps shooting live
      const t0 = performance.now();
      step(dt, inp);
      sync();
      noteStep(performance.now() - t0);
      render();
      // logged AFTER sync so the line reports what was drawn, feel offsets included
      if (probe && simT - lastLog >= 1) { lastLog = simT; console.log(logLine()); }
    });
  });
  return { resize };
}
