// plate-tab.js — the generator's inspection tab: an orbit camera, the knob
// panel, the wall-state selector and the ASCII overlay around a plate
// built by plate-scene.js. Owns NO layout decisions.
import * as THREE from '../vendor/three.module.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import GUI from '../vendor/lil-gui.esm.js';
import { generatePlate, PLATE_KNOBS, makePlateParams, clampPlateParams, CELL_M } from './plate.js?v=1abb261a';
import { CATALOG_SPEC } from './catalog-spec.js?v=1abb261a';
import { buildCatalog, modelledIds, BASE_KIT_URL, NASA_URL, HOUSE_URL, OUTPOST_URL, ASSEMBLY_URL, WAREHOUSE_URL, SOLAR_URL } from './catalog.js?v=1abb261a';
import { bustToken } from './glbmodels.js?v=1abb261a';
import { applySpaceScene, makeStars, makeComposer, LOOK, LOOKS } from './looks.js?v=1abb261a';
import { withParam } from './url.js?v=1abb261a';
import { tickFps } from './fps.js?v=1abb261a';
import { buildPlateGroup } from './plate-scene.js?v=1abb261a';

import { query } from './url.js?v=1abb261a';
export { query };

// The catalog, once: the manifest fetched and merged, or placeholders only
// with a reason. Shared by every tab.
let catalogP = null;
export function loadCatalog() {
  if (catalogP) return catalogP;
  const get = (url) => fetch(`${url}${bustToken()}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${url}: HTTP ${r.status}`))));
  // the NASA stand-ins are optional: a missing manifest costs placeholders, not the tab
  const nasa = get(`${NASA_URL}manifest.json`).catch(() => null);
  const house = get(`${HOUSE_URL}manifest.json`).catch(() => null);
  const outpost = get(`${OUTPOST_URL}manifest.json`).catch(() => null);
  const assembly = get(`${ASSEMBLY_URL}manifest.json`).catch(() => null);
  const warehouse = get(`${WAREHOUSE_URL}manifest.json`).catch(() => null);
  const solar = get(`${SOLAR_URL}manifest.json`).catch(() => null);
  // order matters: a later manifest wins — the outpost kit beats the NASA
  // stand-ins, the house casts beat both
  const extras = async () => [{ manifest: await nasa, base: NASA_URL }, { manifest: await outpost, base: OUTPOST_URL }, { manifest: await assembly, base: ASSEMBLY_URL }, { manifest: await warehouse, base: WAREHOUSE_URL }, { manifest: await solar, base: SOLAR_URL }, { manifest: await house, base: HOUSE_URL }];
  catalogP = get(`${BASE_KIT_URL}manifest.json`)
    .then(async (m) => ({ catalog: buildCatalog(CATALOG_SPEC, m, await extras()), error: null }))
    .catch(async (e) => ({ catalog: buildCatalog(CATALOG_SPEC, null, await extras()), error: e.message }));
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
  applySpaceScene(scene);
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
    plate = generatePlate(params, modelledIds(catalog));
    window.__plate = plate;
    ({ group } = buildPlateGroup({ plate, catalog, wallState: view.wallState }));
    scene.add(group);
    post.setGroups(() => [['towers', [group]]]);
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
  gui.add({ look: LOOK }, 'look', LOOKS).name('look').onChange((v) => { location.href = withParam('look', v); location.reload(); });
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
  renderer.setAnimationLoop((now) => { controls.update(); post.render(); tickFps(now, renderer, scene); });
  return { resize };
}
