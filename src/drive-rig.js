// drive-rig.js — what every driving tab needs and none should own twice:
// the hull model with a stand-in until it lands, the key state, the tracer
// meshes, and the two cameras. Rendering only; the rules are drive.js.
import * as THREE from '../vendor/three.module.js';
import { applySpaceScene, makeStars, makeComposer, PALETTE } from './looks.js?v=1e2fbf0d';
import { castHull } from './casts.js?v=1e2fbf0d';
import { styleForLook, BZ } from './looks.js?v=1e2fbf0d';
import { STICK, stickVector, knobOffset } from './stick.js?v=1e2fbf0d';
import { query } from './url.js?v=1e2fbf0d';
import { loadGlb, mergeByMaterial } from './glbmodels.js?v=1e2fbf0d';

const HULL_URL = 'assets/models/mkcx2.glb';
// The nodes that must keep moving through the merge, and the ones that
// must not be drawn at all (a collision proxy and two floating glow strips)
// — both lists are the reference project's, learned on the same file.
// ...plus the barrel, which PITCHES with the muzzle elevation, and the hover
// rig's parts: the skirt (Hover_Gear) and the six lift emitters, which the
// reference's feel driver moves against each other — body up, skirt down,
// emitters planted — so a lift-off reads as a lift-off.
const HULL_LIFTERS = ['LiftEmitter_L1', 'LiftEmitter_L2', 'LiftEmitter_L3', 'LiftEmitter_R1', 'LiftEmitter_R2', 'LiftEmitter_R3'];
const HULL_PIVOTS = ['Turret_Pivot', 'Barrel_Pivot', 'Secondary_L_Pivot', 'Secondary_R_Pivot', 'Secondary_Turrets', 'Hover_Gear', ...HULL_LIFTERS];

// The reference's hover rig, in three tiers: emitters planted, the skirt
// settling by gearDrop, the body rising by rise — with the hull taking the
// idle vibration and the weapons a fraction of it. tankfeel.js writes onto
// these userData names; this only builds the groups.
function buildHoverSplit(merged, holder) {
  const gear = merged.getObjectByName('Hover_Gear');
  const modelRoot = gear && gear.parent;
  if (!modelRoot) return;
  const emitters = new THREE.Group(); emitters.name = 'HoverEmitters';
  modelRoot.add(emitters);
  for (const name of HULL_LIFTERS) { const e = gear.getObjectByName(name); if (e) emitters.attach(e); }
  const body = new THREE.Group(); body.name = 'HoverBody';
  for (const c of [...modelRoot.children]) if (c !== gear && c !== emitters) body.add(c);
  const weapons = new THREE.Group(); weapons.name = 'Weapons';
  const secondaries = body.getObjectByName('Secondary_Turrets');
  for (const name of ['Turret_Pivot', 'Secondary_Turrets']) { const o = body.getObjectByName(name); if (o) weapons.add(o); }
  const hull = new THREE.Group(); hull.name = 'HullVib';
  for (const c of [...body.children]) hull.add(c);
  body.add(hull); body.add(weapons);
  modelRoot.add(body);
  const turret = merged.getObjectByName('Turret_Pivot');
  if (turret) turret.userData.baseZ = turret.position.z;
  Object.assign(holder.userData, { hoverEmitters: emitters, hoverBody: body, hoverGear: gear, hoverHull: hull, hoverWeapons: weapons, secondaries, turret });
}
const HULL_DROP = ['Hull_Collision', 'Barrel_Glow_1', 'Barrel_Glow_2'];
export const KEYMAP = { w: 'fwd', ArrowUp: 'fwd', s: 'rev', ArrowDown: 'rev', a: 'left', ArrowLeft: 'left', d: 'right', ArrowRight: 'right' };
// SHIFT+W / SHIFT+S: the muzzle. A shifted W arrives as 'W'.
const SHIFTMAP = { W: 'elevUp', S: 'elevDown' };

// A group that holds a box until the GLB replaces it; the swap is invisible
// to whatever moves the group. The hull's authored forward is +z (south),
// so `setPose` turns it by PI - heading.
export function makeHullObject() {
  const obj = new THREE.Group();
  const stub = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.4, 7.4), BZ ? new THREE.MeshBasicMaterial({ color: PALETTE.hull, wireframe: true }) : new THREE.MeshStandardMaterial({ color: 0x9fb3c8, roughness: 0.6 }));
  stub.position.y = 1.0;
  obj.add(stub);
  loadGlb(HULL_URL).then((gltfScene) => {
    if (!gltfScene) return;
    obj.remove(stub);
    const merged = mergeByMaterial(gltfScene, HULL_PIVOTS, HULL_DROP);
    obj.add(BZ ? styleForLook(merged) : castHull(merged, PALETTE.hull));
    buildHoverSplit(merged, obj);
    console.log('[drive] hull model loaded');
  });
  // Heading about +y, then the whole thing tilted so its up is the ground's
  // normal — a hover tank on a slope rides the slope, it does not sink into it.
  const up = new THREE.Vector3(0, 1, 0), n = new THREE.Vector3(), qTilt = new THREE.Quaternion(), qYaw = new THREE.Quaternion();
  obj.userData.setPose = (hull, y = 0, normal = null) => {
    obj.position.set(hull.x, y, hull.z);
    // the barrel: elevation is a NEGATIVE rotation about x on a +z-forward node
    const barrel = obj.getObjectByName('Barrel_Pivot');
    if (barrel) barrel.rotation.x = -(hull.elev || 0) * Math.PI / 180;
    qYaw.setFromAxisAngle(up, Math.PI - hull.heading * Math.PI / 180);
    if (normal) { n.set(normal[0], normal[1], normal[2]).normalize(); qTilt.setFromUnitVectors(up, n); obj.quaternion.copy(qTilt).multiply(qYaw); }
    else obj.quaternion.copy(qYaw);
  };
  return obj;
}

// Key state as a drive input. Extra single-press keys go through `on`.
export function makeKeys(on = {}) {
  const keys = {};
  const extra = {};
  addEventListener('keydown', (e) => {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    if (KEYMAP[e.key] !== undefined || SHIFTMAP[e.key] !== undefined || e.key === ' ') { keys[e.key] = true; e.preventDefault(); }
    // a shift released mid-press leaves the lower-case key down: clear its twin
    if (SHIFTMAP[e.key]) keys[e.key.toLowerCase()] = false;
    if (KEYMAP[e.key] !== undefined && e.key.length === 1) keys[e.key.toUpperCase()] = false;
    if (on[e.key]) on[e.key]();
  });
  addEventListener('keyup', (e) => {
    if (KEYMAP[e.key] !== undefined || SHIFTMAP[e.key] !== undefined || e.key === ' ') keys[e.key] = false;
    if (e.key.length === 1) { keys[e.key.toLowerCase()] = false; keys[e.key.toUpperCase()] = false; }
  });
  return {
    input() { const inp = {}; for (const [k, name] of Object.entries(KEYMAP)) if (keys[k]) inp[name] = true; for (const [k, name] of Object.entries(SHIFTMAP)) if (keys[k]) inp[name] = true; if (keys[' ']) inp.fire = true; return Object.assign(inp, extra); },
    // a second input source (the mobile shell) merged over the keys
    extra,
  };
}

// One mesh per live round, created and dropped as the rules' array changes.
// A tracer is a bar along its heading. A lob SHELL is a ball on its arc with
// a shadow on the ground beneath it — the shadow is what tells a driver
// where the arc is coming down, without drawing the answer on the ground.
// A shell that lands leaves a splash ring for half a second.
export function makeTracerPool(scene) {
  const meshes = new Map();
  const geo = new THREE.BoxGeometry(0.25, 0.25, 1.6);
  const mat = new THREE.MeshBasicMaterial({ color: PALETTE.tracer });
  const shotMat = new THREE.MeshBasicMaterial({ color: PALETTE.shot });
  const shellGeo = new THREE.SphereGeometry(0.45, 10, 8);
  const shellMat = new THREE.MeshBasicMaterial({ color: PALETTE.shell });
  const shadowGeo = new THREE.CircleGeometry(0.6, 12);
  const shadowMat = new THREE.MeshBasicMaterial({ color: PALETTE.shadow, transparent: true, opacity: 0.45, depthWrite: false });
  const splashGeo = new THREE.RingGeometry(0.6, 1, 24);
  const splashes = [];
  const lobY = (t) => { const u = Math.min(1, t.t / t.flight); return 4 * t.apex * u * (1 - u); };
  return {
    sync(tracers, yAt = () => 0, dt = 0, splashR = 5) {
      const live = new Set(tracers);
      for (const [t, m] of meshes) {
        if (live.has(t)) continue;
        scene.remove(m); meshes.delete(t);
        if (t.kind === 'lob') {
          const ring = new THREE.Mesh(splashGeo, new THREE.MeshBasicMaterial({ color: PALETTE.splash, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(t.tx, yAt(t.tx, t.tz) + 0.15, t.tz);
          ring.scale.setScalar(0.3);
          splashes.push({ ring, age: 0 });
          scene.add(ring);
        }
      }
      for (const t of tracers) {
        let m = meshes.get(t);
        if (t.kind === 'lob') {
          if (!m) {
            m = new THREE.Group();
            m.add(new THREE.Mesh(shellGeo, shellMat));
            const sh = new THREE.Mesh(shadowGeo, shadowMat); sh.rotation.x = -Math.PI / 2; sh.name = 'shadow';
            m.add(sh);
            meshes.set(t, m); scene.add(m);
          }
          const g = yAt(t.x, t.z);
          m.position.set(t.x, 0, t.z);
          m.children[0].position.y = g + 1.5 + lobY(t);
          m.getObjectByName('shadow').position.y = g + 0.12;
          continue;
        }
        if (!m) { m = new THREE.Mesh(geo, t.kind === 'shot' ? shotMat : mat); meshes.set(t, m); scene.add(m); }
        if (t.kind === 'shot') {
          m.position.set(t.x, t.y, t.z);
          m.rotation.y = Math.PI - t.heading * Math.PI / 180;
          m.rotation.x = -Math.atan2(t.vy, Math.hypot(t.vx, t.vz));
        } else {
          m.position.set(t.x, yAt(t.x, t.z) + 3.0, t.z);
          m.rotation.y = Math.PI - t.heading * Math.PI / 180;
        }
      }
      for (let i = splashes.length - 1; i >= 0; i--) {
        const sp = splashes[i];
        sp.age += dt;
        const k = Math.min(1, sp.age / 0.5);
        sp.ring.scale.setScalar(0.3 + k * splashR);
        sp.ring.material.opacity = 0.8 * (1 - k);
        if (k >= 1) { scene.remove(sp.ring); sp.ring.material.dispose(); splashes.splice(i, 1); }
      }
    },
    clear() { for (const m of meshes.values()) scene.remove(m); meshes.clear(); for (const sp of splashes) scene.remove(sp.ring); splashes.length = 0; },
  };
}

// Chase sits behind the hull along its heading and eases toward where it
// should be, so a turn swings the view rather than snapping it. Top-down
// follows from the south so north is up and east is right; orbit hands the
// camera to OrbitControls with its target on the hull.
export const CAMERA_KEYS = { 1: 'top', 2: 'chase', 3: 'orbit', 4: 'overview' };
const chaseWant = new THREE.Vector3(), chaseLook = new THREE.Vector3();
// `groundY(x, z)` keeps the chase camera out of a hill behind the hull;
// `overview` is { cx, cz, span } for the 4 key.
export function followCamera(camera, controls, hull, y, mode, dt = 0.016, groundY = null, overview = null, blocked = null) {
  if (mode === 'overview' && overview) {
    camera.position.set(overview.cx, overview.span * 1.05, overview.cz + overview.span * 0.35);
    camera.lookAt(overview.cx, 0, overview.cz);
  } else if (mode === 'chase') {
    const h = hull.heading * Math.PI / 180;
    const fx = Math.sin(h), fz = -Math.cos(h);
    // back off 24 m, or as far as the ground behind is clear: a hull just
    // outside a gate had its camera inside the gate model
    let back = 24;
    if (blocked) while (back > 8 && blocked(hull.x - fx * back, hull.z - fz * back)) back -= 2;
    chaseWant.set(hull.x - fx * back, y + 11 * (back / 24) + 3, hull.z - fz * back);
    if (groundY) chaseWant.y = Math.max(chaseWant.y, groundY(chaseWant.x, chaseWant.z) + 6);
    if (!camera.userData.placed) { camera.position.copy(chaseWant); camera.userData.placed = true; }
    else camera.position.lerp(chaseWant, Math.min(1, dt * 4));
    chaseLook.set(hull.x + fx * 10, y + 2, hull.z + fz * 10);
    camera.lookAt(chaseLook);
  } else if (mode === 'top') {
    camera.position.set(hull.x, y + 70, hull.z + 28);
    camera.lookAt(hull.x, y, hull.z);
  } else {
    controls.target.set(hull.x, y + 1, hull.z);
    if (!camera.userData.placed) { camera.position.set(hull.x + 30, y + 25, hull.z + 30); camera.userData.placed = true; }
    controls.update();
  }
}

// THE MOBILE SHELL, after the reference's: a floating stick on the left
// half (touch anywhere, a ring appears, drag to drive; a finger that never
// leaves the dead zone was a tap), and thumbs on the right — FIRE held,
// MUZZLE up and down held, CAM tapped. Detection is (pointer: coarse) and a
// short side under 900 px, `?mobile=1|0` overriding. The shell writes into
// the keys' `extra` input, so the rules never know a phone from a keyboard.
export const mobileShell = (() => {
  const q = query().get('mobile');
  if (q === '1') return true;
  if (q === '0') return false;
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && Math.min(innerWidth, innerHeight) < 900;
})();

export function makeMobileShell(root, keys, { onCamera = () => {} } = {}) {
  if (!mobileShell) return null;
  document.body.classList.add('mobile-shell');
  const stickEl = document.createElement('div');
  stickEl.className = 'stick hidden';
  stickEl.innerHTML = '<div class="stick-ring"></div><div class="stick-knob"></div>';
  root.appendChild(stickEl);
  const knob = stickEl.querySelector('.stick-knob');
  let stick = null;
  const canvas = root.querySelector('canvas');
  const clear = () => { delete keys.extra.throttle; delete keys.extra.left; delete keys.extra.right; };
  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    if (ev.clientX > innerWidth * 0.5 || stick) return;
    stick = { id: ev.pointerId, x: ev.clientX, y: ev.clientY };
    stickEl.style.left = `${ev.clientX}px`; stickEl.style.top = `${ev.clientY}px`;
    knob.style.transform = 'translate(0px, 0px)';
    stickEl.classList.remove('hidden');
    canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!stick || ev.pointerId !== stick.id) return;
    const dx = ev.clientX - stick.x, dy = ev.clientY - stick.y;
    const v = stickVector(dx, dy, STICK);
    if (!v.active) { clear(); return; }
    keys.extra.throttle = v.throttle; keys.extra.left = v.left; keys.extra.right = v.right;
    const [kx, ky] = knobOffset(dx, dy, STICK);
    knob.style.transform = `translate(${kx}px, ${ky}px)`;
  });
  const end = (ev) => { if (!stick || ev.pointerId !== stick.id) return; stick = null; clear(); stickEl.classList.add('hidden'); };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  // the thumbs
  const thumbs = document.createElement('div');
  thumbs.className = 'thumbs';
  const hold = (label, name, cls = '') => {
    const b = document.createElement('button');
    b.className = `thumb ${cls}`; b.textContent = label;
    const on = (ev) => { ev.preventDefault(); keys.extra[name] = true; b.classList.add('down'); };
    const off = () => { delete keys.extra[name]; b.classList.remove('down'); };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
    thumbs.appendChild(b);
    return b;
  };
  hold('MUZZLE +', 'elevUp', 'small');
  hold('MUZZLE -', 'elevDown', 'small');
  const cam = document.createElement('button');
  cam.className = 'thumb small'; cam.textContent = 'CAM';
  cam.addEventListener('pointerdown', (ev) => { ev.preventDefault(); onCamera(); });
  thumbs.appendChild(cam);
  hold('FIRE', 'fire', 'fire');
  root.appendChild(thumbs);
  return { stickEl, thumbs };
}

export function makeViewer(root) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  root.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 3000);
  applySpaceScene(scene);
  scene.add(makeStars());
  const post = makeComposer(renderer, scene, camera);
  const hud = document.createElement('div');
  hud.className = 'hud';
  root.appendChild(hud);
  const notice = document.createElement('div');
  notice.className = 'notice';
  notice.hidden = true;
  root.appendChild(notice);
  function resize() {
    const w = root.clientWidth, h = root.clientHeight;
    renderer.setSize(w, h, false);
    post.resize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();
  return { renderer, scene, camera, hud, notice, resize, render: () => post.render(), setGroups: (fn) => post.setGroups(fn), post };
}
