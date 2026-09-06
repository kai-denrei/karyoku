import { readFileSync } from 'node:fs';
import { CATALOG_SPEC, SECTIONS, specById } from '../src/catalog-spec.js';
import { MODELLED } from '../src/plate.js';
import { buildCatalog, splitId, PLACEHOLDER_HEIGHT_M, fileFor, fitFor, modelledIds, NASA_URL, HOUSE_URL, OUTPOST_URL, ASSEMBLY_URL } from '../src/catalog.js';
import { check, done } from './check.mjs';

check('117 asset types', CATALOG_SPEC.length === 117, `got ${CATALOG_SPEC.length}`);
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

check('catalog has every spec row', cat.size === 117);
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
// the NASA stand-ins: a second manifest, its own URL base, a fit per model
const nasa = JSON.parse(readFileSync(new URL('../assets/models/nasa/manifest.json', import.meta.url), 'utf8'));
const cat2 = buildCatalog(CATALOG_SPEC, manifest, [{ manifest: nasa, base: NASA_URL }]);
check('nasa manifest ids all exist in the spec', nasa.assets.every((a) => specById(splitId(a.id).base)));
check('nasa plots match the spec', nasa.assets.every((a) => { const r = specById(splitId(a.id).base); return a.plot_m[0] === r.plot[0] * 4 && a.plot_m[1] === r.plot[1] * 4; }));
check('the radome stands in for the uplink', cat2.get('command_uplink').placeholder === false && fileFor(cat2.get('command_uplink')) === NASA_URL + 'radome.glb');
check('a nasa fit is carried', fitFor(cat2.get('command_uplink')).span === 11);
check('the kit still wins its own pieces', fileFor(cat2.get('wall_standard')) === 'assets/base-kit/wall_standard_d0.glb' && fitFor(cat2.get('wall_standard')) === null);
check('fits stay inside the footprint', nasa.assets.every((a) => a.fit.span <= Math.min(a.plot_m[0], a.plot_m[1])));
const house = JSON.parse(readFileSync(new URL('../assets/models/manifest.json', import.meta.url), 'utf8'));
const cat3 = buildCatalog(CATALOG_SPEC, manifest, [{ manifest: nasa, base: NASA_URL }, { manifest: house, base: HOUSE_URL }]);
check('house manifest ids exist and plots match', house.assets.every((a) => { const r = specById(splitId(a.id).base); return r && a.plot_m[0] === r.plot[0] * 4 && a.plot_m[1] === r.plot[1] * 4; }));
check('the container is the reference container', fileFor(cat3.get('logistics_container')) === HOUSE_URL + 'container.glb');
check('the Stalheart is the command nexus', fileFor(cat3.get('command_hq')) === HOUSE_URL + 'terraformer.glb' && fitFor(cat3.get('command_hq')).span === 19);
// the research-outpost kit: twelve ids in four states, all known to the spec
const outpost = JSON.parse(readFileSync(new URL('../assets/outpost/manifest.json', import.meta.url), 'utf8'));
check('outpost manifest has 48 assets', outpost.assets.length === 48);
check('outpost ids all exist in the spec', outpost.assets.every((a) => specById(splitId(a.id).base)), outpost.assets.filter((a) => !specById(splitId(a.id).base)).map((a) => a.id).join(' '));
check('outpost plots match the spec', outpost.assets.every((a) => { const r = specById(splitId(a.id).base); return r && a.plot_m[0] === r.plot[0] * 4 && a.plot_m[1] === r.plot[1] * 4; }));
check('every outpost file is on disk', outpost.assets.every((a) => { try { readFileSync(new URL('../assets/outpost/' + a.file, import.meta.url)); return true; } catch { return false; } }));
const assembly = JSON.parse(readFileSync(new URL('../assets/assembly/manifest.json', import.meta.url), 'utf8'));
check('assembly manifest: 24 assets, all known, plots match', assembly.assets.length === 24 && assembly.assets.every((a) => { const r = specById(splitId(a.id).base); return r && a.plot_m[0] === r.plot[0] * 4 && a.plot_m[1] === r.plot[1] * 4; }));
check('every assembly file is on disk', assembly.assets.every((a) => { try { readFileSync(new URL('../assets/assembly/' + a.file, import.meta.url)); return true; } catch { return false; } }));
const cat4 = buildCatalog(CATALOG_SPEC, manifest, [{ manifest: nasa, base: NASA_URL }, { manifest: outpost, base: OUTPOST_URL }, { manifest: assembly, base: ASSEMBLY_URL }, { manifest: house, base: HOUSE_URL }]);
check('the assembly line is placeable with four states', [0, 1, 2, 3].every((n) => cat4.get('robotic_assembly_line').states[n]));
check('the barracks has four states from the outpost', [0, 1, 2, 3].every((n) => cat4.get('personnel_barracks').states[n] && cat4.get('personnel_barracks').states[n].base === OUTPOST_URL));
check('the outpost beats the NASA launcher for comms', fileFor(cat4.get('command_comms')) === OUTPOST_URL + 'command_comms_d0.glb');
check('the house container still beats the outpost container', fileFor(cat4.get('logistics_container')) === HOUSE_URL + 'container.glb');
check('the xenobiology lab is placeable', cat4.get('research_xenobiology') && !cat4.get('research_xenobiology').placeholder);
{
  const live = modelledIds(cat4);
  const missing = [...MODELLED].filter((id) => !live.has(id));
  check('the generator\'s default MODELLED set is inside the live catalog', missing.length === 0, missing.join(' '));
}
done();
