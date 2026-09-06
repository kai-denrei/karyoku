// plate-tab.js — the generator's inspection tab: an orbit camera, the knob
// panel, the wall-state selector and the ASCII overlay around a plate
// built by plate-scene.js. Owns NO layout decisions.
import * as THREE from '../vendor/three.module.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import GUI from '../vendor/lil-gui.esm.js';
import { generatePlate, PLATE_KNOBS, makePlateParams, clampPlateParams, CELL_M } from './plate.js?v=37da6c2a';
import { CATALOG_SPEC } from './catalog-spec.js?v=37da6c2a';
import { buildCatalog, BASE_KIT_URL, NASA_URL } from './catalog.js?v=37da6c2a';
import { bustToken } from './glbmodels.js?v=37da6c2a';
import { applySpaceScene, makeStars, makeComposer } from './looks.js?v=37da6c2a';
import { buildPlateGroup } from './plate-scene.js?v=37da6c2a';

// `#plate?seed=7` and `?seed=7#plate` both work: the hash's own query is
// merged under the real search string.
export function query() {
  const q = new URLSearchParams(location.search);
  const hq = location.hash.indexOf('?');
  if (hq >= 0) for (const [k, v] of new URLSearchParams(location.hash.slice(hq + 1))) if (!q.has(k)) q.set(k, v);
  return q;
}

// The catalog, once: the manifest fetched and merged, or placeholders only
// with a reason. Shared by every tab.
let catalogP = null;
export function loadCatalog() {
  if (catalogP) return catalogP;
  const get = (url) => fetch(`${url}${bustToken()}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${url}: HTTP ${r.status}`))));
  // the NASA stand-ins are optional: a missing manifest costs placeholders, not the tab
  const nasa = get(`${NASA_URL}manifest.json`).catch(() => null);
  catalogP = get(`${BASE_KIT_URL}manifest.json`)
    .then(async (m) => ({ catalog: buildCatalog(CATALOG_SPEC, m, [{ manifest: await nasa, base: NASA_URL }]), error: null }))
    .catch(async (e) => ({ catalog: buildCatalog(CATALOG_SPEC, null, [{ manifest: await nasa, base: NASA_URL }]), error: e.message }));
  return catalogP;
}

export function initPlateTab(root) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  root.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 2000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  applySpaceScene(scene, 0.0006);
  scene.add(makeStars());
  const post = makeComposer(renderer, scene, camera);

  const overlay = document.createElement('pre');
  overlay.className = 'ascii-overlay';
  overlay.hidden = true;
  root.appendChild(overlay);
  const notice = document.createElement('div');
  notice.className = 'notice';
  notice.hidden = true;
  root.appendChild(notice);

  const q = query();
  const params = clampPlateParams(makePlateParams(), Object.fromEntries([...q.entries()]));
  const view = { wallState: 0, ascii: q.get('ascii') === '1' };

  let catalog = null;
  let group = null;
  let plate = null;

  function build() {
    if (group) scene.remove(group);
    plate = generatePlate(params);
    window.__plate = plate;
    ({ group } = buildPlateGroup({ plate, catalog, wallState: view.wallState }));
    scene.add(group);
    const W = plate.w * CELL_M, H = plate.h * CELL_M;
    controls.target.set(W / 2, 0, H / 2);
    if (!camera.userData.placed) {
      // from the south, looking north: N at the top of the screen, E on the right
      camera.position.set(W / 2, Math.max(W, H) * 0.95, H * 1.35);
      camera.userData.placed = true;
    }
    overlay.textContent = plate.ascii();
    overlay.hidden = !view.ascii;
    if (q.get('ascii') === '1') console.log('[plate] ascii\n' + plate.ascii());
  }

  const gui = new GUI({ title: 'PLATE', container: root });
  const folders = {};
  for (const k of PLATE_KNOBS) {
    const f = folders[k.group] || (folders[k.group] = gui.addFolder(k.group));
    f.add(params, k.key, k.min, k.max, k.step).name(k.label).onFinishChange(build);
  }
  gui.add({ regenerate: () => { params.seed = (params.seed + 1) % 1000000; gui.controllersRecursive().forEach((c) => c.updateDisplay()); build(); } }, 'regenerate').name('regenerate (seed+1)');
  gui.add(view, 'wallState', { 'D0 intact': 0, 'D1 damaged': 1, 'D2 critical': 2, 'D3 destroyed': 3 }).name('wall state').onChange(build);
  gui.add(view, 'ascii').name('ascii overlay').onChange((v) => { overlay.hidden = !v; });

  function resize() {
    const w = root.clientWidth, h = root.clientHeight;
    renderer.setSize(w, h, false);
    post.resize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();
  loadCatalog().then(({ catalog: c, error }) => {
    catalog = c;
    if (error) { notice.textContent = `base-kit manifest unavailable, placeholders only (${error})`; notice.hidden = false; }
    build();
  });
  renderer.setAnimationLoop(() => { controls.update(); post.render(); });
  return { resize };
}
