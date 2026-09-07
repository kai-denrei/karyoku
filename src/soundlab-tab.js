// soundlab-tab.js — the Sound Lab: every element and event from soundlab.js
// as a table, a play or loop control per clip, a distance slider standing in
// for the listener, and the bus faders. Calibration, and the list of what
// is missing. Owns no game state; it speaks to the audio engine directly.
import { makeAudio } from './audio.js?v=ef335ef3';
import { SOUNDS, SENTRY_FIRE, DEFAULT_LEVELS } from './audiomanifest.js?v=ef335ef3';
import { ELEMENTS, labRows, labSummary } from './soundlab.js?v=ef335ef3';

const STATUS_WORD = { wired: 'wired', unwired: 'clip unused', missing: 'MISSING', nofile: 'NO FILE' };

export function initSoundLabTab(root) {
  const audio = makeAudio({ seed: 1 });
  const rows = labRows(ELEMENTS, SOUNDS, SENTRY_FIRE);
  const sum = labSummary(rows);
  let dist = 0;
  const loops = new Map();   // key -> handle, or 'pending' while decoding
  let pending = [];

  root.innerHTML = `
    <div class="lab">
      <header class="lab-head">
        <div class="lab-title">SOUND LAB</div>
        <div class="lab-sum">${sum.wired} wired, ${sum.unwired} clips unused, ${sum.missing} missing, ${sum.total} events</div>
        <label>listener distance <input type="range" id="lab-dist" min="0" max="140" step="1" value="0"> <span id="lab-dist-v">0 m</span></label>
        ${['master', 'towers', 'tank', 'ambient'].map((b) => `<label>${b} <input type="range" data-bus="${b}" min="0" max="1" step="0.01" value="${DEFAULT_LEVELS[b]}"></label>`).join('')}
        <button id="lab-stop">stop all</button>
        <span class="lab-note">first click arms the audio context</span>
      </header>
      <table class="lab-table">
        <thead><tr><th>element</th><th>event</th><th>clip</th><th>bus</th><th>gain</th><th>status</th><th>play</th><th>brief for a missing sound</th></tr></thead>
        <tbody>${rows.map((r, i) => `<tr class="st-${r.status}" data-i="${i}">
          <td>${r.label}</td><td>${r.event}</td><td class="mono">${r.key || ''}</td><td>${r.bus || ''}</td><td>${r.gain == null ? '' : r.gain.toFixed(2)}</td>
          <td><span class="pill ${r.status}">${STATUS_WORD[r.status]}</span></td>
          <td>${r.key ? `<button data-play="${i}">${r.loop ? 'loop' : 'play'}</button>` : ''}</td>
          <td class="want">${r.want}</td></tr>`).join('')}</tbody>
      </table>
    </div>`;

  const distV = root.querySelector('#lab-dist-v');
  root.querySelector('#lab-dist').addEventListener('input', (e) => { dist = Number(e.target.value); distV.textContent = `${dist} m`; });
  for (const s of root.querySelectorAll('[data-bus]')) {
    const apply = () => { const v = Number(s.value); if (s.dataset.bus === 'master') audio.setMaster(v); else audio.setBus(s.dataset.bus, v); };
    s.addEventListener('input', apply);
  }
  const stopAll = () => { for (const [k, h] of loops) { if (h && h !== 'pending') h.stop(0.2); const b = root.querySelector(`[data-key="${k}"]`); } loops.clear(); pending = []; for (const b of root.querySelectorAll('button.on')) { b.classList.remove('on'); b.textContent = 'loop'; } };
  root.querySelector('#lab-stop').addEventListener('click', stopAll);

  // loop() returns null until the clip has decoded, so a loop request waits
  // in `pending` and is retried on a short interval until a handle arrives
  const retry = () => {
    pending = pending.filter(({ key, btn }) => {
      const h = audio.loop(key, { gain: 1, dist });
      if (!h) return true;
      loops.set(key, h); btn.classList.add('on'); btn.textContent = 'stop';
      return false;
    });
    if (pending.length) setTimeout(retry, 120);
  };

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-play]');
    if (!b) return;
    audio.arm();
    const r = rows[Number(b.dataset.play)];
    if (!r.loop) { audio.play(r.key, { dist }); b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 150); return; }
    const h = loops.get(r.key);
    if (h) { if (h !== 'pending') h.stop(0.2); loops.delete(r.key); pending = pending.filter((p) => p.key !== r.key); b.classList.remove('on'); b.textContent = 'loop'; return; }
    loops.set(r.key, 'pending'); pending.push({ key: r.key, btn: b }); retry();
  });

  console.log(`[soundlab] ${sum.wired} wired ${sum.unwired} unwired ${sum.missing} missing ${sum.total} rows`);
  return { resize() {}, rows, stopAll };
}
