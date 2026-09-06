import { readFileSync } from 'node:fs';
import { CATALOG_SPEC, SECTIONS, specById } from '../src/catalog-spec.js';
import { buildCatalog, splitId, PLACEHOLDER_HEIGHT_M } from '../src/catalog.js';
import { check, done } from './check.mjs';

check('109 asset types', CATALOG_SPEC.length === 109, `got ${CATALOG_SPEC.length}`);
check('unique ids', new Set(CATALOG_SPEC.map((r) => r.id)).size === CATALOG_SPEC.length);
check('every plot is two positive integers',
  CATALOG_SPEC.every((r) => r.plot.length === 2 && r.plot.every((n) => Number.isInteger(n) && n > 0)));
check('every section is known', CATALOG_SPEC.every((r) => SECTIONS.includes(r.section)));
check('gate is 3 by 2', specById('gate_vehicle').plot[0] === 3 && specById('gate_vehicle').plot[1] === 2);
check('launch pad is 8 by 8', specById('air_launchpad').plot.join('x') === '8x8');
check('wall has a wall port', specById('wall_standard').ports.includes('wall'));
check('road has a road port', specById('road_straight').ports.includes('road'));
check('unknown id is undefined', specById('nope') === undefined);

const manifest = JSON.parse(readFileSync(new URL('../assets/base-kit/manifest.json', import.meta.url), 'utf8'));
const cat = buildCatalog(CATALOG_SPEC, manifest);

check('catalog has every spec row', cat.size === 109);
check('splitId parses a state suffix', splitId('wall_standard_d2').base === 'wall_standard' && splitId('wall_standard_d2').state === 2);
check('splitId without suffix is state 0', splitId('road_t').state === 0 && splitId('road_t').base === 'road_t');
const wall = cat.get('wall_standard');
check('wall is not a placeholder', wall.placeholder === false);
check('wall has four states', [0, 1, 2, 3].every((n) => wall.states[n] && wall.states[n].file === `wall_standard_d${n}.glb`));
check('wall sockets carried over', wall.states[0].sockets.some((s) => s.id === 'WALL_E' && s.kind === 'wall'));
const gate = cat.get('gate_vehicle');
check('gate has the open clip', gate.states[0].animations.includes('Gate_Open'));
check('gate plot matches manifest plot_m / 4', gate.plot[0] === 3 && gate.plot[1] === 2);
check('command_hq is a placeholder', cat.get('command_hq').placeholder === true && Object.keys(cat.get('command_hq').states).length === 0);
check('placeholder heights cover every section', SECTIONS.every((s) => PLACEHOLDER_HEIGHT_M[s] > 0));
// the scale contract: every manifest plot equals its spec plot times 4 m
for (const a of manifest.assets) {
  const { base } = splitId(a.id);
  const row = specById(base);
  check(`manifest ${a.id} matches spec plot`, row && a.plot_m[0] === row.plot[0] * 4 && a.plot_m[1] === row.plot[1] * 4,
    row ? `manifest ${a.plot_m} vs spec ${row.plot}` : 'no spec row');
}
done();
