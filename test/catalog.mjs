import { CATALOG_SPEC, SECTIONS, specById } from '../src/catalog-spec.js';
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
done();
