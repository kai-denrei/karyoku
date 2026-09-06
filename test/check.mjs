// check.mjs — the one assertion helper every suite shares. A suite prints
// `ok` / `FAIL` lines and exits non-zero on any failure, so `npm test` can
// chain suites with `&&`.
let failures = 0;
export const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { console.error(`  FAIL ${name} ${detail}`); failures++; }
};
export const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;
export function done() {
  if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
  console.log('all ok');
}
