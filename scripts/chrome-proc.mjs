// chrome-proc.mjs — LAUNCH A HEADLESS CHROME THAT ALWAYS DIES WITH US.
//
// Written after a 16GB machine reached 84% memory with leaked Chrome trees
// reparented to launchd, traced to this project's capture scripts. Both had
// the same shape: cleanup was ONE LINE at the very end of the happy path.
//
//   ws.close(); chrome.kill();
//
// Everything that can throw before that line leaks the whole browser — and in
// practice something did: a screenshot written to an unwritable --out path
// threw EROFS, the script exited, and Chrome was never signalled. A bad
// argument should not cost 300MB of resident memory until somebody notices.
//
// Three separate faults, all fixed here rather than in each caller:
//
// 1. CLEANUP ONLY ON SUCCESS. Any throw, rejection, or signal skipped it.
//    Now it is registered against exit / SIGINT / SIGTERM / SIGHUP /
//    uncaughtException / unhandledRejection, and it is idempotent.
//
// 2. KILLING THE PARENT IS NOT KILLING CHROME. Chrome is a tree — renderer,
//    GPU, network, utility. `chrome.kill()` signals the top process only, and
//    when it goes without cleaning up, its children are reparented to launchd
//    (ppid 1), which is exactly how they were found. So the child is spawned
//    DETACHED, making it a process-group leader, and the whole GROUP is
//    signalled with `process.kill(-pid)`.
//
// 3. NO UPPER BOUND. A page that never loads held a browser forever. There is
//    a hard watchdog now: past it, the tree is killed and the script exits
//    non-zero rather than sitting on the memory in silence.
import { spawn } from 'node:child_process';

const CHROME = process.env.CHROME
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export function launchChrome(flags, { watchdogMs = 180000 } = {}) {
  // detached: its own process group, so `-pid` reaches the whole tree. Without
  // this the tree sits in OUR group and a group kill would take us with it.
  const chrome = spawn(CHROME, [...flags, 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'], detached: true });

  let dead = false;
  const kill = (why = '') => {
    if (dead) return;
    dead = true;
    clearTimeout(timer);
    // TERM the group, give it a beat, then KILL whatever ignored it.
    //
    // THE WAIT MUST BE SYNCHRONOUS. The first cut escalated on a setTimeout,
    // and every caller of this function exits immediately afterwards — so the
    // timer never fired and the watchdog left two live processes behind while
    // reporting that it had killed the tree. A timer is not a guarantee when
    // the next statement is process.exit().
    //
    // Chrome here is a throwaway with no state to save, so the graceful half
    // is a courtesy with a 60 ms budget, and SIGKILL is the part that counts.
    try { process.kill(-chrome.pid, 'SIGTERM'); } catch {}
    try {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60);
    } catch {}
    try { process.kill(-chrome.pid, 'SIGKILL'); } catch {}
    if (why) console.error(`[chrome-proc] killed the browser tree (${why})`);
  };

  const timer = setTimeout(() => {
    kill(`watchdog: ${Math.round(watchdogMs / 1000)}s elapsed`);
    process.exit(3);
  }, watchdogMs);
  timer.unref();

  // EVERY door out of this process, not just the front one.
  process.on('exit', () => kill());
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => { kill(sig); process.exit(130); });
  }
  process.on('uncaughtException', (e) => {
    kill('uncaught: ' + e.message); console.error(e); process.exit(1);
  });
  process.on('unhandledRejection', (e) => {
    kill('rejected: ' + (e && e.message)); console.error(e); process.exit(1);
  });

  // the DevTools port, or a rejection that still cleans up after itself
  const port = new Promise((resolve, reject) => {
    let buf = '';
    chrome.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/);
      if (m) resolve(Number(m[1]));
    });
    chrome.on('exit', () => reject(new Error('chrome exited before it was ready')));
  });

  return { chrome, port, kill };
}
