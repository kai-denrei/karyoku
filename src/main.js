// main.js — the tab shell. Each tab initialises the first time it is shown;
// the hash picks the first one (`#drive`, `#plate?seed=7`). The build token
// in the nav is read from the <meta name="cb"> that bust.sh maintains.
import { initPlateTab } from './plate-tab.js?v=dc8a0b52';
import { initWorldTab } from './world-tab.js?v=dc8a0b52';
import { initDriveTab } from './drive-tab.js?v=dc8a0b52';
import { registerServiceWorker } from './pwa.js?v=dc8a0b52';
import { initSoundLabTab } from './soundlab-tab.js?v=dc8a0b52';

const meta = document.querySelector('meta[name="cb"]');
const tok = document.getElementById('build-token');
if (meta && tok) tok.textContent = meta.content;

const TABS = { plate: initPlateTab, drive: initDriveTab, world: initWorldTab, sounds: initSoundLabTab };
const live = {};
function show(name) {
  if (!TABS[name]) name = 'plate';
  for (const b of document.querySelectorAll('#tabbar button[data-tab]')) b.classList.toggle('active', b.dataset.tab === name);
  for (const s of document.querySelectorAll('.tab')) s.classList.toggle('active', s.id === `tab-${name}`);
  const section = document.getElementById(`tab-${name}`);
  if (!live[name]) live[name] = TABS[name](section);
  else if (live[name].resize) live[name].resize();
}
for (const b of document.querySelectorAll('#tabbar button[data-tab]')) {
  b.addEventListener('click', () => { location.hash = `#${b.dataset.tab}`; show(b.dataset.tab); });
}
show(location.hash.slice(1).split('?')[0] || 'plate');

// the panel on the shell hides behind a gear; a tap shows it
document.getElementById('gear').addEventListener('click', () => {
  const g = document.querySelector('.tab.active > .lil-gui');
  if (g) g.classList.toggle('open');
});

// the service worker: a runtime cache keyed on the build token; a new build
// waits until the player says reload (never mid-drive)
registerServiceWorker((apply) => {
  const u = document.getElementById('update');
  u.hidden = false;
  document.getElementById('update-apply').addEventListener('click', apply, { once: true });
}).then((reg) => { if (!reg) console.log(`[pwa] no worker: ${registerServiceWorker.why}`); });
