// THE AUDIO GATE — the policy for getting a browser AudioContext running.
//
// Written as pure logic because the effectful version got this wrong four
// times in one session, and none of the mistakes were about Web Audio: they
// were about control flow that nothing could test.
//
// The rules, from first principles:
//
// 1. A context can always be CREATED. It starts suspended. Creating it early
//    is good — decodeAudioData works on a suspended context, so samples can
//    be fetched during page load rather than after the first click.
//
// 2. RESUMING requires user activation, and you get MANY chances, not one.
//    The previous implementation removed its listeners synchronously, before
//    resume() had settled, so a single rejected attempt killed audio for the
//    whole session. Never stop listening until the context is actually
//    running.
//
// 3. A context created WITHOUT activation is the one browsers are most
//    reluctant to start. If resuming keeps failing, throw it away and build a
//    fresh one inside a gesture — historically the bulletproof path. Costs a
//    re-decode, but only on the failure path.
//
// 4. Contexts get suspended again: tab hidden, headphones unplugged, an OS
//    interruption. An unlock is not a one-time event, it is a state to be
//    maintained.
//
// 5. Verify. resume() is a promise; the state afterwards is the truth, not
//    the fact that it was called.

// how many gestures we will spend on resume() before deciding this context
// is a lost cause and rebuilding it
export const REBUILD_AFTER = 2;

// What to do right now, given the context's state and what we have already
// tried. `state` is null when there is no context at all.
export function gateStep(state, failedResumes, rebuilds = 0, maxRebuilds = 2) {
  if (state === 'running') return { action: 'done', listen: false };
  if (state === null || state === undefined || state === 'closed') {
    return rebuilds >= maxRebuilds
      ? { action: 'give-up', listen: false }
      : { action: 'rebuild', listen: true };
  }
  // 'suspended', or 'interrupted' on iOS
  if (failedResumes >= REBUILD_AFTER) {
    return rebuilds >= maxRebuilds
      ? { action: 'resume', listen: true }   // keep trying; better than silence
      : { action: 'rebuild', listen: true };
  }
  return { action: 'resume', listen: true };
}

// Should the gate still be armed? Kept separate so the caller can ask without
// deciding to act — a running context needs no listeners, anything else does.
export function shouldListen(state) {
  return state !== 'running';
}
