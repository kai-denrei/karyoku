#!/usr/bin/env node
/**
 * headless-wait — open a page in headless Chrome ON THE GPU, IN REAL TIME,
 * hold it for N seconds, print its console, take a screenshot.
 *
 *   node scripts/headless-wait.mjs --url 'http://localhost:8144/?stateprobe=1#td' --seconds 24 --size 844x390 --out shot.png
 *
 * The verification recipe's --virtual-time-budget runs stop advancing the
 * frame loop's clock (performance.now) after the first moments, so any
 * time-driven flow — a cold open, a deploy, a countdown — replicates
 * wrongly under it. This is the honest replica for "it starts and then…"
 * reports. Same CDP shape as scripts/cine-capture.mjs.
 */
import { writeFileSync } from 'node:fs';
import { launchChrome } from './chrome-proc.mjs';
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) =>
  a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : '1'] : []).filter((x) => x.length));
const url = args.url, seconds = Number(args.seconds || 10);
const [W, H] = (args.size || '844x390').split('x').map(Number);
const grep = args.grep ? new RegExp(args.grep) : null;
if (!url) { console.error('usage: --url <page> [--seconds N --size WxH --out shot.png --grep REGEX --swiftshader]'); process.exit(2); }
const flags = ['--headless=new', '--remote-debugging-port=0', `--window-size=${W},${H + 87}`, '--hide-scrollbars', '--mute-audio'];
if (args.swiftshader) flags.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
// launchChrome owns the LIFETIME: it spawns detached so the whole tree can be
// signalled as a group, and registers cleanup against every way this process
// can end. Cleanup used to be one line on the happy path, which is how a bad
// --out path turned into a leaked browser reparented to launchd.
const { chrome, port: portP, kill } = launchChrome(flags,
  { watchdogMs: (seconds + 90) * 1000 });
const port = await portP;
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id != null && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
  else if (msg.method === 'Runtime.consoleAPICalled') {
    const line = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (!grep || grep.test(line)) console.log(line.slice(0, 2000));   // a DIAG line is ~700 chars
  } else if (msg.method === 'Runtime.exceptionThrown') {
    console.log('[exception] ' + JSON.stringify(msg.params.exceptionDetails).slice(0, 300));
  }
});
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
await new Promise((r) => setTimeout(r, seconds * 1000));
if (args.out) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  try {
    writeFileSync(args.out, Buffer.from(shot.data, 'base64'));
  } catch (e) {
    // THIS is the line that leaked a browser: an unwritable --out threw EROFS
    // and the process died before anything killed Chrome. It is caught now,
    // and the run still reports whatever the page logged, because the console
    // output is usually the reason the run existed.
    console.error(`[headless-wait] could not write ${args.out}: ${e.message}`);
    process.exitCode = 2;
  }
}
// belt and braces: the exit handler in chrome-proc would do this anyway, but
// closing here means the browser is gone before the screenshot's caller
// returns rather than a tick later
ws.close();
kill();
