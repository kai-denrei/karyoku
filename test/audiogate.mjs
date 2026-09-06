import { gateStep, shouldListen, REBUILD_AFTER } from '../src/audiogate.js';

let pass = 0;
const check = (name, cond) => {
  if (!cond) { console.log(`  FAIL ${name}`); process.exitCode = 1; }
  else { console.log(`  ok   ${name}`); pass++; }
};

console.log('audiogate:');

// --- the goal state -------------------------------------------------------
check('running is done', gateStep('running', 0).action === 'done');
check('running stops listening', gateStep('running', 0).listen === false);
check('shouldListen agrees', shouldListen('running') === false);

// --- no context -----------------------------------------------------------
check('no context rebuilds', gateStep(null, 0).action === 'rebuild');
check('undefined context rebuilds', gateStep(undefined, 0).action === 'rebuild');
check('a closed context rebuilds', gateStep('closed', 0).action === 'rebuild');

// --- suspended: try resume first ------------------------------------------
check('suspended resumes', gateStep('suspended', 0).action === 'resume');
check('iOS interrupted resumes', gateStep('interrupted', 0).action === 'resume');
check('suspended keeps listening', gateStep('suspended', 0).listen === true);

// THE BUG THIS MODULE EXISTS FOR. The old code removed its listeners
// synchronously, before resume() had settled, so one rejected attempt killed
// audio for the session. Nothing short of `running` may stop us listening.
for (const st of [null, 'closed', 'suspended', 'interrupted']) {
  check(`${st} never stops listening`, gateStep(st, 0).listen === true);
  check(`shouldListen(${st}) is true`, shouldListen(st) === true);
}
for (let f = 0; f <= 6; f++) {
  check(`suspended after ${f} failures still listens`, gateStep('suspended', f).listen === true);
}

// --- escalation: a context that will not start gets rebuilt ---------------
check(`under ${REBUILD_AFTER} failures still resumes`,
  gateStep('suspended', REBUILD_AFTER - 1).action === 'resume');
check(`at ${REBUILD_AFTER} failures rebuilds`,
  gateStep('suspended', REBUILD_AFTER).action === 'rebuild');
check('more failures still rebuilds',
  gateStep('suspended', REBUILD_AFTER + 3).action === 'rebuild');

// --- but escalation is bounded -------------------------------------------
// rebuilding forever would thrash the audio device; past the cap we fall back
// to plain resume attempts, because silence is the only worse outcome
check('rebuilds are capped, then it keeps resuming',
  gateStep('suspended', 9, 2, 2).action === 'resume');
check('capped rebuild still listens', gateStep('suspended', 9, 2, 2).listen === true);
check('no context past the cap gives up',
  gateStep(null, 9, 2, 2).action === 'give-up');
check('giving up stops listening', gateStep(null, 9, 2, 2).listen === false);

// --- a running context that lapses must re-arm ----------------------------
// tab hidden, headphones unplugged, OS interruption: an unlock is a state to
// maintain, not an event that happened once
check('a lapsed context asks to resume again', gateStep('suspended', 0).action === 'resume');
check('and listens again', shouldListen('suspended') === true);

console.log(`audiogate: ${process.exitCode ? 'FAILURES' : 'all good'} (${pass} checks)`);
