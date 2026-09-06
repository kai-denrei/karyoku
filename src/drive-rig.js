// drive-rig.js — what every driving tab needs and none should own twice:
// the hull model with a stand-in until it lands, the key state, the tracer
// meshes, and the two cameras. Rendering only; the rules are drive.js.
import * as THREE from '../vendor/three.module.js';
import { loadGlb, mergeByMaterial } from './glbmodels.js?v=979b8ccb';

const HULL_URL = 'assets/models/mkcx2.glb';
// The nodes that must keep moving through the merge, and the ones that
// must not be drawn at all (a collision proxy and two floating glow strips)
// — both lists are the reference project's, learned on the same file.
const HULL_PIVOTS = ['Turret_Pivot', 'Secondary_L_Pivot', 'Secondary_R_Pivot'];
const HULL_DROP = ['Hull_Collision', 'Barrel_Glow_1', 'Barrel_Glow_2'];
export const KEYMAP = { w: 'fwd', ArrowUp: 'fwd', s: 'rev', ArrowDown: 'rev', a: 'left', ArrowLeft: 'left', d: 'right', ArrowRight: 'right' };

// A group that holds a box until the GLB replaces it; the swap is invisible
// to whatever moves the group. The hull's authored forward is +z (south),
// so `setPose` turns it by PI - heading.
export function makeHullObject() {
  const obj = new THREE.Group();
  const stub = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.4, 7.4), new THREE.MeshStandardMaterial({ color: 0x9fb3c8, roughness: 0.6 }));
  stub.position.y = 1.0;
  obj.add(stub);
  loadGlb(HULL_URL).then((gltfScene) => {
    if (!gltfScene) return;
    obj.remove(stub);
    obj.add(mergeByMaterial(gltfScene, HULL_PIVOTS, HULL_DROP));
    console.log('[drive] hull model loaded');
  });
  obj.userData.setPose = (hull, y = 0) => {
    obj.position.set(hull.x, y, hull.z);
    obj.rotation.y = Math.PI - hull.heading * Math.PI / 180;
  };
  return obj;
}

// Key state as a drive input. Extra single-press keys go through `on`.
export function makeKeys(on = {}) {
  const keys = {};
  addEventListener('keydown', (e) => {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    if (KEYMAP[e.key] !== undefined) { keys[e.key] = true; e.preventDefault(); }
    if (on[e.key]) on[e.key]();
  });
  addEventListener('keyup', (e) => { if (KEYMAP[e.key] !== undefined) keys[e.key] = false; });
  return {
    input() { const inp = {}; for (const [k, name] of Object.entries(KEYMAP)) if (keys[k]) inp[name] = true; return inp; },
  };
}

// One mesh per live tracer, created and dropped as the rules' array changes.
export function makeTracerPool(scene) {
  const meshes = new Map();
  const geo = new THREE.BoxGeometry(0.25, 0.25, 1.6);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd166 });
  return {
    sync(tracers, yAt = () => 0) {
      const live = new Set(tracers);
      for (const [t, m] of meshes) if (!live.has(t)) { scene.remove(m); meshes.delete(t); }
      for (const t of tracers) {
        let m = meshes.get(t);
        if (!m) { m = new THREE.Mesh(geo, mat); meshes.set(t, m); scene.add(m); }
        m.position.set(t.x, yAt(t.x, t.z) + 3.0, t.z);
        m.rotation.y = Math.PI - t.heading * Math.PI / 180;
      }
    },
    clear() { for (const m of meshes.values()) scene.remove(m); meshes.clear(); },
  };
}

// Top-down follows from the south so north is up and east is right; orbit
// hands the camera to OrbitControls with its target on the hull.
export function followCamera(camera, controls, hull, y, mode) {
  if (mode === 'top') {
    camera.position.set(hull.x, y + 70, hull.z + 28);
    camera.lookAt(hull.x, y, hull.z);
  } else {
    controls.target.set(hull.x, y + 1, hull.z);
    if (!camera.userData.placed) { camera.position.set(hull.x + 30, y + 25, hull.z + 30); camera.userData.placed = true; }
    controls.update();
  }
}

export function makeViewer(root) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  root.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1116);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 3000);
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
  function resize() {
    const w = root.clientWidth, h = root.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();
  return { renderer, scene, camera, hud, notice, resize };
}
