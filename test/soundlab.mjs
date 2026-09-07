// soundlab.mjs — the lab's table against the manifest and the generator.
import { SOUNDS, SENTRY_FIRE } from '../src/audiomanifest.js';
import { GUN_FAMILIES } from '../src/plate.js';
import { ELEMENTS, labRows, labSummary, unclaimedKeys } from '../src/soundlab.js';

let fails = 0;
const check = (name, ok) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) fails++; };

const rows = labRows(ELEMENTS, SOUNDS, SENTRY_FIRE);
const sum = labSummary(rows);
check('every row has an element, an event and a status', rows.every((r) => r.element && r.event && ['wired', 'unwired', 'missing', 'nofile'].includes(r.status)));
check('no row names a key the manifest lacks', sum.nofile === 0 && rows.every((r) => !r.key || SOUNDS[r.key]));
check('every sentry family has a row', GUN_FAMILIES.every((f) => rows.some((r) => r.family === f)));
check('a family with a round is wired, one without is missing', rows.filter((r) => r.family).every((r) => (SENTRY_FIRE[r.family] ? r.status === 'wired' : r.status === 'missing')));
check('missing rows carry a brief', rows.filter((r) => r.status === 'missing').every((r) => r.want.length > 8));
check('the engine is three wired events', ['tank_spool_up', 'tank_thruster', 'tank_spool_down'].every((k) => rows.some((r) => r.key === k && r.status === 'wired')));
check('the electric hum is gone from the manifest and listed as removed', !SOUNDS.assembly_electric && rows.some((r) => r.element === 'assembly' && r.status === 'missing' && /REMOVED/.test(r.want)));
check('every manifest key is claimed by some element', unclaimedKeys(rows, SOUNDS).length === 0);
check('the summary adds up', sum.wired + sum.unwired + sum.missing + sum.nofile === sum.total && sum.total === rows.length);
check('loops are beds: thruster, hydraulics, the rumble', rows.filter((r) => r.loop).every((r) => ['tank_thruster', 'tank_engine', 'assembly_hydraulics', 'container_rumble'].includes(r.key)));
check('the lab knows more gaps than clips it owns', sum.missing > 0);
// families share rounds on purpose (railgun and needle both crack like a sniper), so a key may sit under several wired rows
check('a shared round is listed under every family that fires it', Object.entries(SENTRY_FIRE).every(([f, k]) => rows.some((r) => r.family === f && r.key === k)));

console.log(`soundlab: ${sum.wired} wired, ${sum.unwired} unwired, ${sum.missing} missing across ${sum.total} rows`);
console.log(fails ? `${fails} FAILED` : 'all soundlab checks passed');
process.exit(fails ? 1 : 0);
