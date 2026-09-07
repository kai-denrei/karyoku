// audio.js — the Web Audio half: context, buffers, gain graph. Every
// decision about WHETHER a sound may play lives in audiomix.js; this
// file only carries them out. No three.js, no game knowledge, so any
// tab can adopt it.
//
// Signal graph:
//   BufferSource -> voiceGain -> busGain[bus] -> masterGain -> destination
//
// Two rules this file exists to keep:
//
// 1. THE CONTEXT IS BORN ON A USER GESTURE, never at init. Browsers
//    reject a context created before one, and a suspended context
//    swallows everything silently -- which looks exactly like a bug in
//    the game rather than a policy.
//
// 2. AUDIO NEVER THROWS INTO THE RENDER LOOP. Every entry point is
//    total. A failed fetch or decode logs once and that key becomes a
//    permanent no-op for the session; the game keeps running silent.

import { makeMixState, distanceGain, admit, addVoice, dropVoice } from './audiomix.js?v=7e146775';
import { SOUNDS, BUSES, DEFAULT_LEVELS, GLOBAL_VOICE_CAP, DISTANCE_K } from './audiomanifest.js?v=7e146775';
import { mulberry32 } from './rng.js?v=7e146775';
import { gateStep } from './audiogate.js?v=7e146775';

const STORE_KEY = 'ssg.audio.levels';
const STEAL_FADE = 0.03; // s — a hard cut mid-waveform is an audible click

// bust.sh's fingerprint-urls.py rewrites HTML attributes and CSS url()
// only -- it does NOT touch JS string literals. Reading the <meta name="cb">
// token it already maintains gets audio URLs cache-busted for free, with
// no new bust patterns and no change to check-tokens.sh.
function bustToken() {
  const m = document.querySelector('meta[name="cb"]');
  const v = m && m.content ? m.content.trim() : '';
  return v ? `?v=${encodeURIComponent(v)}` : '';
}

export function makeAudio(opts = {}) {
  const base = opts.base ?? '';
  let ctx = null;
  let master = null;
  let analyser = null;
  const busGain = Object.create(null);
  const buffers = Object.create(null); // key -> AudioBuffer | 'failed'
  const state = makeMixState();
  let nextId = 1;
  const live = new Map(); // id -> { src, gain }
  let jitter = mulberry32(opts.seed ?? 1);
  let armed = false;
  let loadStarted = false;
  let loggedFail = false;

  const levels = { ...DEFAULT_LEVELS };
  let muted = false;
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      for (const k of Object.keys(levels)) {
        if (typeof saved[k] === 'number') levels[k] = Math.min(1, Math.max(0, saved[k]));
      }
      muted = !!saved.muted;
    }
  } catch { /* private mode, corrupt value — defaults are fine */ }

  function persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...levels, muted })); } catch { /* ignore */ }
  }

  function now() { return ctx ? ctx.currentTime : 0; }

  // --- THE LEAK LEDGER ----------------------------------------------------
  //
  // The desktop-Safari silence was closed as a leaked AudioContext: contexts
  // created per page load and never closed, accumulated by WebKit until it
  // stopped granting audio sessions to this ORIGIN. Quitting Safari cleared
  // it, and a reboot clears it too.
  //
  // That explanation fits every symptom, and it has never once been MEASURED.
  // It was inferred from a fix — which is exactly the shape of reasoning that
  // cost this project ten wrong attempts before it, and it leaves the next
  // recurrence starting from zero all over again.
  //
  // So: count. The tally survives reloads (it is the accumulation ACROSS
  // reloads that the theory is about, and a per-load counter would always
  // read 1). `created` goes up when a context is born, `closed` when its
  // close() actually resolves — not when it is requested, because a close
  // that never settles is precisely the failure being hunted.
  //
  // Read it off the console at the next silence:
  //   leaked climbing with reloads  -> the theory is right, and the release
  //                                    hook is not firing on this browser
  //   leaked at 0 or 1 while silent -> the theory is WRONG and two days of
  //                                    conclusions go with it
  //
  // Either answer is worth more than the guess, and neither costs anything.
  const LEAK_KEY = 'ssg.audio.ledger';
  function ledgerRead() { return ledger(null); }
  function ledger(patch) {
    let v = { created: 0, closed: 0, loads: 0 };
    try {
      const raw = localStorage.getItem(LEAK_KEY);
      if (raw) v = { ...v, ...JSON.parse(raw) };
    } catch { /* private mode: the ledger is a diagnostic, never a dependency */ }
    if (patch) {
      Object.assign(v, patch(v));
      try { localStorage.setItem(LEAK_KEY, JSON.stringify(v)); } catch { /* ignore */ }
    }
    return v;
  }
  // exposed so a probe (and the operator's console) can clear it without
  // hunting for the key
  function resetLedger() {
    try { localStorage.removeItem(LEAK_KEY); } catch { /* ignore */ }
    console.log('AUDIO ledger cleared');
  }

  function ensureCtx() {
    if (ctx) return ctx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
      ledger((v) => ({ created: v.created + 1 }));
      master = ctx.createGain();
      master.gain.value = muted ? 0 : levels.master;
      // A TAP ON THE WAY OUT. Every layer this file can see has reported
      // healthy through seven attempts while the operator heard nothing, and
      // each round ended by asking them to listen. An analyser measures the
      // signal actually leaving master, so the page can answer that itself:
      // level > 0 with silence in the room means the graph is fine and the
      // fault is the browser or the device; level == 0 means the graph is
      // producing silence despite everything claiming otherwise.
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      master.connect(analyser);
      analyser.connect(ctx.destination);
      // An output-device change — plugging in headphones, or starting an
      // AirPlay cast mid-session — can leave the context suspended or
      // interrupted, and nothing here was listening. Cheap insurance, and
      // it is the one AirPlay-specific thing this file can actually do:
      // the ~2s buffer a TV adds is the receiver's, not ours.
      // A context can lapse long after it started — tab hidden, headphones
      // unplugged, an OS interruption. Re-arm rather than assume the unlock
      // was a one-time event.
      ctx.onstatechange = () => {
        const st = ctx ? ctx.state : 'none';
        console.log(`AUDIO state -> ${st}`);
        if (st === 'running') {
          stopListening();
          // Everything Safari-specific we can see about the OUTPUT itself.
          // The graph has measured healthy six times over; these are the
          // properties beyond ctx.destination that we have never looked at.
          try {
            const d = ctx.destination;
            console.log(`AUDIO output sampleRate=${ctx.sampleRate}`
              + ` channels=${d.channelCount}/${d.maxChannelCount}`
              + ` interp=${d.channelInterpretation} mode=${d.countMode}`
              + ` baseLatency=${ctx.baseLatency ?? 'n/a'}`
              + ` outputLatency=${ctx.outputLatency ?? 'n/a'}`
              + ` ctor=${ctx.constructor && ctx.constructor.name}`);
          } catch (e) { console.log(`AUDIO output facts failed ${(e && e.name) || e}`); }
          while (runningCbs.length) { try { runningCbs.shift()(); } catch { /* caller's problem */ } }
          if (!summaryArmed) {
            summaryArmed = true;
            // eight seconds of real play is enough to have asked for
            // something; one line, once, and then it is quiet
            setTimeout(() => {
              console.log(`AUDIO summary requested=${nRequested}`
                + ` refused-by-mix=${nRefused} started=${nStarted}`
                + ` audible=${nAudible} live=${live.size}`
                + ` ctx=${ctx ? ctx.state : 'none'} muted=${muted}`
                + ` master=${levels.master}`);
            }, 8000);
          }
        }
        else if (armed) { startListening(); if (ctx) ctx.resume().catch(() => {}); }
      };
      for (const b of BUSES) {
        const g = ctx.createGain();
        g.gain.value = levels[b] ?? 1;
        g.connect(master);
        busGain[b] = g;
      }
    } catch {
      ctx = null;
    }
    return ctx;
  }

  // --- THE GATE ----------------------------------------------------------
  // Getting a context RUNNING is a state to maintain, not an event that
  // happens once. The policy lives in audiogate.js (pure, Node-tested); this
  // half only performs it.
  //
  // What went wrong before, in order, because each is a trap worth naming:
  //   - listeners in the BUBBLE phase sat behind every handler that calls
  //     stopImmediatePropagation, and a cinematic's skip handler ate the
  //     first keypress. Hence capture + passive, first in line, never
  //     interfering.
  //   - the listeners were removed SYNCHRONOUSLY, before resume() settled,
  //     so a single rejected attempt killed audio for the session. Now they
  //     stay until the context is genuinely running.
  //   - creating the context eagerly, outside a gesture, produced the state
  //     browsers are least willing to start. Eager creation is still right
  //     for DECODING, but if resuming keeps failing the context is rebuilt
  //     inside a gesture, which is the historically reliable path.
  const ARM_EVENTS = ['pointerdown', 'pointerup', 'mouseup', 'touchstart',
    'touchend', 'keydown', 'keyup', 'click'];
  // WebKit's activation-triggering events do NOT include pointerdown,
  // mousedown or touchstart — they are the "up" family plus click and keys.
  // That distinction matters here: a context CREATED on pointerdown can run,
  // process, and feed an analyser real signal while Safari never grants the
  // page an audio session, so nothing reaches the speakers and the tab is
  // never registered as playing audio. That is exactly the operator's report,
  // including tab-mute having no effect on this tab while it works on
  // YouTube. Resuming is permissive; CREATING is not, so only these may
  // build the context.
  const CREATE_EVENTS = new Set(['pointerup', 'mouseup', 'touchend',
    'keydown', 'keyup', 'click']);
  const ARM_OPTS = { passive: true, capture: true };
  let failedResumes = 0;
  let rebuilds = 0;
  let listening = false;

  function stateNow() { return ctx ? ctx.state : null; }

  function stopListening() {
    if (!listening) return;
    listening = false;
    for (const ev of ARM_EVENTS) window.removeEventListener(ev, onGesture, true);
  }
  function startListening() {
    if (listening) return;
    listening = true;
    for (const ev of ARM_EVENTS) window.addEventListener(ev, onGesture, ARM_OPTS);
  }

  // THE SAFARI UNLOCK. Creating a context in a gesture and resuming it is
  // still not enough on Safari: the output stays dead until a buffer has
  // actually been PLAYED inside that gesture. One sample of silence is
  // enough, and it is what every audio library does. This should have been
  // here from the start — it is the single most standard thing in browser
  // audio and its absence is why five other fixes all measured healthy and
  // sounded like nothing.
  let primed = false;
  function primeOutput() {
    if (!ctx || primed) return;
    try {
      const b = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.connect(ctx.destination);
      src.start(0);
      primed = true;
      console.log('AUDIO primed (silent buffer played inside the gesture)');
    } catch (e) {
      console.log(`AUDIO prime failed ${(e && e.name) || e}`);
    }
  }

  // Kicked off from the gesture, once the context exists. load() caches its
  // promise, so calling it on every gesture is free after the first.
  function startDecoding() {
    if (!ctx) return;
    load().then(reportReady);
  }

  // Sample the output for a while and report the loudest thing seen. Uses
  // rAF rather than a timer so it follows real frames.
  function measureOutput(ms = 1500) {
    if (!analyser) { console.log('AUDIO LEVEL: no analyser'); return; }
    const buf = new Float32Array(analyser.fftSize);
    let peak = 0, frames = 0;
    const t0 = performance.now();
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      for (let i = 0; i < buf.length; i++) {
        const a = buf[i] < 0 ? -buf[i] : buf[i];
        if (a > peak) peak = a;
      }
      frames++;
      if (performance.now() - t0 < ms) requestAnimationFrame(tick);
      else {
        const verdict = frames < 10
          ? 'INCONCLUSIVE — too few frames sampled to trust this (a headless '
            + 'or backgrounded tab rations requestAnimationFrame).'
          : peak > 0.0005
            ? 'SIGNAL IS REACHING THE OUTPUT. If the room is silent, the graph '
              + 'is fine and the fault is the browser or the device.'
            : 'NO SIGNAL. The graph is producing silence despite every other '
              + 'measurement reporting healthy.';
        console.log(`AUDIO LEVEL peak=${peak.toFixed(5)} over ${frames} frames`
          + ` ctx=${ctx ? ctx.state : 'none'} — ${verdict}`);
      }
    };
    requestAnimationFrame(tick);
  }

  function rebuildCtx() {
    rebuilds++;
    failedResumes = 0;
    const old = ctx;
    ctx = null; master = null; analyser = null;
    if (old) { try { old.close(); } catch { /* already gone */ } }
    // the old context's buffers went with it; decode again on the new one
    loadPromise = null;
    loadStarted = false;
    loadSettled = false;
    for (const k of Object.keys(buffers)) delete buffers[k];
    ensureCtx();          // built inside the gesture this time
  }

  function reportReady() {
    loadSettled = true;
    if (ctx && ctx.state === 'running') {
      while (readyCbs.length) { try { readyCbs.shift()(); } catch { /* caller's problem */ } }
    }
    const total = Object.keys(SOUNDS).length;
    let ok = 0, failed = 0;
    for (const k of Object.keys(SOUNDS)) {
      if (buffers[k] === 'failed') failed++;
      else if (buffers[k]) ok++;
    }
    console.log(`AUDIO ready ctx=${stateNow()} decoded=${ok}/${total}`
      + `${failed ? ` failed=${failed}` : ''}`);
  }

  // Runs on EVERY gesture until the context is running. Cheap when it is.
  let attempts = 0;
  function onGesture(ev) {
    const type = ev && ev.type;
    const step = gateStep(stateNow(), failedResumes, rebuilds);
    // A pointerdown may resume an existing context but must not be the thing
    // that builds one — see CREATE_EVENTS. Wait for the click that follows.
    if (step.action === 'rebuild' && type && !CREATE_EVENTS.has(type)) {
      if (attempts < 3) {
        console.log(`AUDIO gesture (${type}): cannot create a context on this`
          + ' event in WebKit; waiting for a click/keyup/touchend');
      }
      return;
    }
    // A blocked context's resume() promise often never SETTLES at all — it
    // neither resolves nor rejects until activation arrives — so outcome
    // logging alone can look identical to "the listener never fired". Log the
    // attempt too, capped so a stubborn session cannot flood the console.
    if (++attempts <= 3) {
      console.log(`AUDIO gesture ${attempts} (${type}): ctx=${stateNow()} -> ${step.action}`);
    }
    if (step.action === 'done' || step.action === 'give-up') { stopListening(); return; }
    if (step.action === 'rebuild') { rebuildCtx(); }
    if (!ctx) return;
    primeOutput();            // must happen INSIDE the gesture
    startDecoding();
    ctx.resume().then(
      () => {
        if (stateNow() === 'running') {
          console.log(`AUDIO running (after ${failedResumes} failed,`
            + ` ${rebuilds} rebuild${rebuilds === 1 ? '' : 's'})`);
          stopListening();
        } else {
          // resolved but NOT running — the case the old one-shot code read as
          // success and then stopped listening on
          failedResumes++;
        }
      },
      (e) => {
        failedResumes++;
        console.log(`AUDIO resume rejected (${failedResumes}) ${(e && e.name) || e}`);
      },
    );
  }

  // RELEASE THE CONTEXT WHEN THE PAGE GOES AWAY.
  //
  // Nothing here ever closed one. WebKit has a hard cap on concurrent
  // AudioContexts and is known to hold them across page loads, so a session
  // spent reloading — which is exactly what debugging this bug looked like —
  // accumulates contexts until Safari quietly stops granting audio sessions.
  // A context in that state RUNS, PROCESSES, and feeds an analyser real
  // signal while outputting nothing, and the tab is never registered as
  // playing audio so tab-mute does nothing to it. That is the operator's
  // report, item for item, and quitting Safari cleared it.
  //
  // pagehide rather than beforeunload: it is the event Safari actually fires,
  // including into the back/forward cache. If the page is restored from
  // bfcache the context is `closed`, and gateStep already answers that state
  // with a rebuild on the next gesture.
  let unloadHooked = false;
  function hookUnload() {
    if (unloadHooked) return;
    unloadHooked = true;
    // RELEASE, THEN RE-ARM. The first cut of this released and stopped
    // there, which was a one-way door: pagehide also fires for a bfcache
    // navigation and, in some Safari versions, for a hidden tab — and by
    // then `listening` is already false (the gate stops on success) and
    // `armed` is true (so arm() returns early). The context was destroyed
    // with no path back, and audio was gone for the rest of the session.
    // That is a worse bug than the leak it was written to fix.
    const release = () => {
      if (ctx) {
        // count the close when it RESOLVES. A close that is requested and
        // never settles looks identical to a healthy one from the call site,
        // and that difference is the whole question.
        try {
          const p = ctx.close();
          if (p && p.then) p.then(() => ledger((v) => ({ closed: v.closed + 1 })), () => {});
          else ledger((v) => ({ closed: v.closed + 1 }));
        } catch { /* already gone */ }
      }
      ctx = null; master = null; analyser = null;
      loadPromise = null; loadStarted = false; loadSettled = false;
      for (const k of Object.keys(buffers)) delete buffers[k];
      failedResumes = 0;
      if (armed) startListening();   // whatever happens next, we can rebuild
    };
    addEventListener('pagehide', release);
    // restored from the back/forward cache: the context is gone, so listen
    // for the gesture that will rebuild it
    addEventListener('pageshow', (ev) => { if (ev.persisted && armed) startListening(); });
  }

  function arm() {
    if (armed) return;
    armed = true;
    hookUnload();
    // Nothing to do until a gesture: the context is born there (Safari will
    // report one created outside a gesture as `running` and still produce no
    // output), and the decode now rides the same context.
    const led = ledger((v) => ({ loads: v.loads + 1 }));
    const leaked = led.created - led.closed;
    console.log('AUDIO armed (context and decode both wait for a gesture)'
      + ` muted=${muted} master=${levels.master}`);
    // THE ONE LINE TO READ AT THE NEXT SILENCE. WebKit's cap on concurrent
    // contexts is small; if `leaked` is climbing toward it across reloads,
    // the leak theory is measured rather than assumed. If it is 0 or 1 and
    // the page is still silent, the theory is dead and this line says so.
    console.log(`AUDIO ledger origin=${location.origin} loads=${led.loads}`
      + ` contexts created=${led.created} closed=${led.closed}`
      + ` LEAKED=${leaked}`
      + `${leaked > 3 ? ' — climbing; this is the leak, and pagehide is not releasing'
        : ' — healthy'}`
      + ' (audio.resetLedger() to zero it)');
    startListening();
  }

  // DECODE ON THE PLAYBACK CONTEXT, AND ONLY ON IT.
  //
  // This briefly decoded on an OfflineAudioContext so the samples could be
  // fetched during page load rather than after the first click. Spec-wise
  // that is fine — an AudioBuffer is data, not a child of a context — and
  // Chrome and iOS Safari both play those buffers happily. Desktop Safari on
  // the operator's machine went silent across the same change, with every
  // measurement still reporting healthy, so the eager decode is reverted to
  // exactly what worked before: one context, created in the gesture, that
  // both decodes and plays.
  //
  // The cost is that decoding starts at the first gesture instead of at page
  // load. That is what the working version did, and the samples are small.
  function decodeContext() {
    return ctx;
  }

  async function decodeOne(key) {
    const spec = SOUNDS[key];
    try {
      const res = await fetch(`${base}${spec.file}${bustToken()}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const bytes = await res.arrayBuffer();
      const dc = decodeContext();
      if (!dc) throw new Error('no context to decode with');
      buffers[key] = await dc.decodeAudioData(bytes);
    } catch (err) {
      buffers[key] = 'failed';
      if (!loggedFail) {
        loggedFail = true;
        console.warn(`[audio] ${key} failed to load; that sound is off for this session`, err);
      }
    }
  }

  // Idempotent AND awaitable. It used to return a bare Promise.resolve() on
  // any call after the first, so a second caller was told "done" while the
  // decodes were still in flight — which is exactly how the ready report
  // came back decoded=0/26 on a session that went on to decode all 26.
  // Cache the promise so every caller awaits the same real work.
  let loadPromise = null;
  function load() {
    if (loadPromise) return loadPromise;
    if (!decodeContext()) return Promise.resolve();
    loadStarted = true;
    loadPromise = Promise.all(Object.keys(SOUNDS).map(decodeOne));
    return loadPromise;
  }

  function stopVoice(id, fade = STEAL_FADE) {
    const v = live.get(id);
    if (!v) return;
    live.delete(id);
    dropVoice(state, id);
    const t = now();
    try {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setValueAtTime(v.gain.gain.value, t);
      v.gain.gain.linearRampToValueAtTime(0, t + fade);
      v.src.stop(t + fade + 0.01);
      // a stolen or stopped voice unwires itself too — onended does not
      // fire for a LOOP, so this is the only place a bed ever gets cleaned
      v.src.onended = () => {
        try { v.src.disconnect(); v.gain.disconnect(); } catch { /* already gone */ }
      };
    } catch { /* already stopped */ }
  }

  // WHY A SOUND DID NOT SOUND — once per session, not per call. A silent
  // game has several causes that look identical from outside: no context, a
  // parked context, samples that never decoded, or a muted mix. start()
  // returns null for all of them, silently and correctly. This says which.
  let mutedReport = false;
  let loadSettled = false;
  let summaryArmed = false;
  const runningCbs = [];
  const readyCbs = [];
  let firstVoiceLogged = false;
  let firstAudibleLogged = false;
  // counters, so a summary can separate "nothing is asking for sound"
  // from "everything is asking and being refused" from "everything
  // plays at zero gain" — three causes, one identical symptom
  let nRequested = 0, nRefused = 0, nStarted = 0, nAudible = 0;
  function reportSilence(why, key) {
    if (mutedReport) return;
    // "not decoded yet" before the load settles is a TRANSIENT — the engine
    // asks to spool at t=0, every session, on a perfectly healthy page. The
    // reporter fires once, so letting a transient claim it would mask the
    // real cause for the rest of the session.
    if (!loadSettled && why.startsWith('sample not decoded')) return;
    mutedReport = true;
    console.log(`AUDIO silent: ${why} (first blocked sound: ${key})`
      + ` ctx=${ctx ? ctx.state : 'none'} muted=${muted} master=${levels.master}`
      + ` loadStarted=${loadStarted}`);
  }

  function start(key, o, looping) {
    const spec = SOUNDS[key];
    if (!spec) return null;
    nRequested++;
    if (!ctx) { reportSilence('no AudioContext — the gesture never armed it', key); return null; }
    // REFUSE UNTIL THE CONTEXT RUNS. This used to be implicit: there was no
    // context at all before the first gesture, so start() returned null and
    // no voice was ever built. Creating the context eagerly removed that
    // guard by accident — sounds then got wired against a SUSPENDED context
    // whose currentTime does not advance, so they occupied the voice budget,
    // polluted the mix's timing state with a stalled clock, and never
    // sounded. The engine bed was the worst of it: loop() handed back a
    // handle to a voice that could never play, the caller cached it, and it
    // never asked again.
    //
    // Returning null is the documented contract here — see loop() below: it
    // makes the caller retry next frame, which costs nothing.
    if (ctx.state !== 'running') {
      reportSilence(`context is ${ctx.state}, not running`, key);
      return null;
    }
    const buf = buffers[key];
    if (!buf || buf === 'failed') {
      reportSilence(buf === 'failed' ? 'sample failed to decode' : 'sample not decoded yet', key);
      return null;
    }

    const t = now();
    const cfg = { maxVoices: spec.maxVoices, minInterval: spec.minInterval };
    const verdict = admit(state, key, t, cfg, GLOBAL_VOICE_CAP);
    if (!verdict.ok) { nRefused++; return null; }
    if (verdict.steal !== null) stopVoice(verdict.steal);

    const jitterAmt = spec.rateJitter ? (jitter() * 2 - 1) * spec.rateJitter : 0;
    const rate = Math.max(0.05, (o.rate ?? 1) * (1 + jitterAmt));
    const g = spec.gain * (o.gain ?? 1) * distanceGain(o.dist ?? 0, DISTANCE_K);

    let src, gain;
    try {
      src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = looping;
      src.playbackRate.value = rate;
      // `offset` starts partway into the sample (a long bed picked up mid-way)
      const off = Math.max(0, Math.min(buf.duration - 0.05, o.offset ?? 0));
      gain = ctx.createGain();
      gain.gain.value = g;
      src.connect(gain);
      gain.connect(busGain[spec.bus] ?? master);
      // `duration` plays a slice of the sample: one thud out of a file of twelve
      if (o.duration) src.start(0, off, o.duration); else src.start(0, off);
    } catch {
      return null;
    }

    // Two different questions. The first voice proves sounds are being
    // wired at all; the first AUDIBLE one proves the gain chain survives to
    // something you could hear. A bed at rest legitimately has gain 0 — the
    // thruster rises with speed — so the first line alone says nothing about
    // audibility, which is exactly the trap the earlier diagnostics fell in.
    const line = (what) => `AUDIO ${what} '${key}' gain=${g.toFixed(3)}`
      + ` bus=${spec.bus}(${(levels[spec.bus] ?? 1).toFixed(2)})`
      + ` master=${levels.master} muted=${muted} rate=${rate.toFixed(2)}`
      + ` live=${live.size} ctx=${ctx.state}`;
    nStarted++;
    if (g > 0.001) nAudible++;
    if (!firstVoiceLogged) { firstVoiceLogged = true; console.log(line('first voice')); }
    if (!firstAudibleLogged && g > 0.001) {
      firstAudibleLogged = true;
      console.log(line('first AUDIBLE voice'));
    }
    const id = nextId++;
    addVoice(state, key, t, id);
    live.set(id, { src, gain });
    if (!looping) {
      src.onended = () => {
        live.delete(id);
        dropVoice(state, id);
        // UNWIRE IT. Nothing here ever disconnected a finished voice, so
        // every sound left a GainNode wired into its bus. The graph is
        // walked every render quantum whether or not a node is doing
        // anything, so a long session pays for every shot it has ever
        // fired — which is what a second game sounding worse than the
        // first looks like from the outside (operator report, laptop over
        // AirPlay). Disconnecting is the whole fix and it costs nothing.
        try { src.disconnect(); gain.disconnect(); } catch { /* already gone */ }
      };
    }
    return { id, src, gain };
  }

  return {
    arm,
    load,
    get ready() { return !!ctx; },
    // What the graph is actually carrying. Without this the only evidence
    // of an audio leak is "it sounds worse now", which is not evidence.
    get voices() { return live.size; },
    get contextState() { return ctx ? `${ctx.state} @${ctx.sampleRate}Hz` : 'none'; },
    // THE LEAK LEDGER, reachable from the console. `audio.ledger` at the
    // moment of a silence is the measurement that two days of this bug never
    // had; `audio.resetLedger()` zeroes it to start a clean count.
    get ledger() {
      const v = ledgerRead();
      return { ...v, leaked: v.created - v.closed, origin: location.origin };
    },
    resetLedger,

    // Stop everything and unwire it. A new run should not inherit the last
    // run's graph — a bed whose owner was thrown away keeps playing, and
    // keeps costing, for as long as the page is open.
    // A TONE THAT USES NONE OF THE SAMPLE PATH. Straight oscillator ->
    // destination: no decoded buffer, no bus, no master, no mix admission.
    // If this is audible and the game is not, the fault is in buffers or the
    // gain graph. If neither is audible, the context is not reaching the
    // speakers at all. That is the one question five rounds of fixes never
    // managed to ask.
    beep(freq = 880, ms = 300) {
      if (!ensureCtx()) { console.log('AUDIO beep: no context'); return false; }
      primeOutput();
      try {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = freq;
        g.gain.value = 0.25;
        o.connect(g);
        g.connect(ctx.destination);   // deliberately bypassing buses/master
        // ...but still measured: the analyser sits after master, so without
        // this tap the level reading would miss the one route that proves
        // the output stage independently of the sample path
        if (analyser) g.connect(analyser);
        o.start();
        o.stop(ctx.currentTime + ms / 1000);
        console.log(`AUDIO beep ${freq}Hz for ${ms}ms, ctx=${ctx.state},`
          + ' straight to destination (bypasses buses/master/mix)');
        return true;
      } catch (e) {
        console.log(`AUDIO beep failed ${(e && e.name) || e}`);
        return false;
      }
    },

    measureOutput,

    // Fires once, the moment the context is genuinely running. The context
    // is all an oscillator needs, so this is the right hook for a beep.
    whenRunning(cb) {
      if (ctx && ctx.state === 'running') { cb(); return; }
      runningCbs.push(cb);
    },

    // Fires once the context is running AND the samples have decoded. A
    // SAMPLE needs both: decoding now rides the playback context, so it
    // finishes after the unlock, and anything played on `running` alone
    // would be refused for a buffer that does not exist yet.
    whenReady(cb) {
      if (ctx && ctx.state === 'running' && loadSettled) { cb(); return; }
      readyCbs.push(cb);
    },

    panic() {
      for (const id of [...live.keys()]) stopVoice(id, 0.02);
    },
    levels,
    get muted() { return muted; },

    reseed(seed) { jitter = mulberry32(seed >>> 0 || 1); },

    play(key, o = {}) { start(key, o, false); },

    // a handle rather than a key, because the bed is continuous: the
    // caller nudges gain and rate every frame from the tank's speed
    // Returns NULL when it cannot start — deliberately, not a silent stub.
    // A stub handle looks successful to the caller, who stores it and never
    // asks again; that is exactly how the engine bed went silent for a whole
    // session when the first attempt landed before the buffers had decoded.
    // Null makes the caller retry next frame, which costs nothing: start()
    // bails before touching the voice budget when there is no buffer.
    loop(key, o = {}) {
      const v = start(key, o, true);
      if (!v) return null;
      return {
        set(gain, rate) {
          try {
            const t = now();
            // short ramps, not steps: a per-frame jump in gain zippers
            v.gain.gain.setTargetAtTime(Math.max(0, gain) * SOUNDS[key].gain, t, 0.05);
            v.src.playbackRate.setTargetAtTime(Math.max(0.05, rate), t, 0.08);
          } catch { /* context died */ }
        },
        stop(fade = 0.25) { stopVoice(v.id, fade); },
      };
    },

    setMaster(v) {
      levels.master = Math.min(1, Math.max(0, v));
      if (master) master.gain.setTargetAtTime(muted ? 0 : levels.master, now(), 0.02);
      persist();
    },

    setBus(name, v) {
      if (!BUSES.includes(name)) return;
      levels[name] = Math.min(1, Math.max(0, v));
      if (busGain[name]) busGain[name].gain.setTargetAtTime(levels[name], now(), 0.02);
      persist();
    },

    setMute(on) {
      muted = !!on;
      if (master) master.gain.setTargetAtTime(muted ? 0 : levels.master, now(), 0.02);
      persist();
    },
  };
}
