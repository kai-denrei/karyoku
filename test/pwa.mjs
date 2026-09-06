// pwa.mjs — the service worker's cache key must be THE build token.
//
// The roadmap blocked installed-PWA on exactly this: a worker whose cache is
// not keyed off the token serves stale modules and defeats the badge.
// scripts/bust.sh stamps sw.js on every bump; this fails the suite if the
// stamp ever stops matching index.html's <meta name="cb">.
import { readFileSync } from 'node:fs';

let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { console.error(`  FAIL ${name} ${detail}`); failures++; }
};

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const meta = (html.match(/<meta name="cb" content="([0-9a-f]{8})">/) || [])[1];
const key = (sw.match(/const CB_TOKEN = '([0-9a-f]{8})'/) || [])[1];
console.log(`       index.html cb=${meta} · sw.js CB_TOKEN=${key}`);
check('index.html carries a build token', !!meta);
check('sw.js carries a cache key', !!key);
check('they are the same token (bust.sh stamps both)', meta === key);
check('the worker never skips waiting on its own', !/^\s*self\.skipWaiting\(\)/m.test(sw));
check('the worker never caches cross-origin', /url\.origin !== self\.location\.origin/.test(sw));
check('the registration URL is relative (a project path on Pages)', /register\('\.\/sw\.js'/.test(readFileSync(new URL('../src/pwa.js', import.meta.url), 'utf8')));

if (failures) { console.error(`pwa: ${failures} FAILED`); process.exit(1); }
console.log('pwa: all good');
