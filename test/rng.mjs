import { mulberry32 } from '../src/rng.js';
import { check, done } from './check.mjs';

const a = mulberry32(7), b = mulberry32(7);
const sa = Array.from({ length: 5 }, () => a());
const sb = Array.from({ length: 5 }, () => b());
check('same seed, same sequence', sa.every((v, i) => v === sb[i]));
check('values in [0,1)', sa.every((v) => v >= 0 && v < 1));
check('different seed differs', mulberry32(8)() !== sa[0]);
done();
