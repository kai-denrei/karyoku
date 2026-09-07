import { makeCtf, stepCtf, poleState, CTF_TUNE, SLOTS } from '../src/ctf.js';
import { check, done } from './check.mjs';

const stands = { home: [{ x: 0, z: 0 }, { x: 8, z: 0 }], hostile: [{ x: 300, z: 0 }, { x: 308, z: 0 }] };
const c = makeCtf(stands);
check('slots: fire then power, ember then vanguard', SLOTS[0].glyph === 'fire' && SLOTS[0].banner === 'flag_ember' && SLOTS[1].glyph === 'power' && SLOTS[1].banner === 'flag_vanguard');
check('at the start home holds fire, its power pole empty; the enemy the reverse', poleState(c, 'home', 0) === 'flag' && poleState(c, 'home', 1) === 'empty' && poleState(c, 'hostile', 1) === 'flag' && poleState(c, 'hostile', 0) === 'empty');
check('rolling past the enemy pole takes nothing', stepCtf(c, { x: 308, z: 1, speed: 8 }).length === 0 && !c.carrying);
check('stopping by our own full pole takes nothing', stepCtf(c, { x: 0, z: 1, speed: 0 }).length === 0 && !c.carrying);
check('stopping by the enemy\'s EMPTY pole takes nothing', stepCtf(c, { x: 300, z: 1, speed: 0 }).length === 0 && !c.carrying);
const ev = stepCtf(c, { x: 306, z: 2, speed: 0 });
check('stopping by the enemy\'s full pole captures its power flag', ev.includes('capture') && c.carrying && c.carrying.glyph === 'power' && poleState(c, 'hostile', 1) === 'empty' && c.captures === 1);
check('a second stop there takes nothing more', stepCtf(c, { x: 306, z: 2, speed: 0 }).length === 0);
check('stopping by home\'s FIRE pole (the wrong slot) plants nothing', stepCtf(c, { x: 1, z: 1, speed: 0 }).length === 0 && c.carrying && !c.won);
const ev2 = stepCtf(c, { x: 9, z: 1, speed: 0 });
check('stopping by home\'s empty power pole plants it: the set is complete, the win', ev2.includes('plant') && c.won && !c.carrying && poleState(c, 'home', 1) === 'flag' && c.score === CTF_TUNE.winBonus);
check('after the win nothing more happens', stepCtf(c, { x: 306, z: 2, speed: 0 }).length === 0);
done();
