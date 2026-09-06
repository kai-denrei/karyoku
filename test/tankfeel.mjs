// tankfeel.mjs — invariants for the shared hover/recoil/health driver
// (src/tankfeel.js). Pure module: it only writes .position/.rotation on
// objects handed to it, so plain stand-ins are enough. This suite exists
// because two callers drive it — the game and the viewer's test bench — and
// a drift between them is exactly the bug the module was made to prevent.
import {
  TANK_FEEL, makeTankFeel, stepTankFeel, landTankFeel, fireTankFeel,
  applyTankFeel, applyTankHealth, healthColor,
  TANK_FEEL_KNOBS, makeFeelParams, clampFeelParams, formatFeelCode,
} from '../src/tankfeel.js';

let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { console.error(`  FAIL ${name} ${detail}`); failures++; }
};
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// A stand-in for the bits of a three.js Object3D this module touches.
const node = (baseZ) => ({
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  userData: baseZ === undefined ? {} : { baseZ },
});
const tank = ({ turret = true, hover = true, baseZ } = {}) => {
  const u = { userData: {} };
  if (turret) u.userData.turret = node(baseZ);
  if (hover) { u.userData.hoverBody = node(); u.userData.hoverGear = node(); }
  return u;
};
const run = (st, secs, running, dt = 1 / 60) => {
  for (let i = 0; i < Math.round(secs / dt); i++) stepTankFeel(st, dt, running);
  return st;
};

console.log('hover:');
{
  const st = makeTankFeel();
  check('starts settled', st.hoverT === 0 && st.recoil === 0);
  run(st, 4, true);
  check('spools up to full', st.hoverT > 0.99, `hoverT=${st.hoverT}`);
  run(st, 4, false);
  check('spools back down', st.hoverT < 0.01, `hoverT=${st.hoverT}`);

  // Rise is a GESTURE, not a jump. The bound is on the SHAPE — no single
  // frame may deliver a large fraction, and getting there must take several
  // frames — not on a particular rate, which is the operator's to choose.
  const s2 = makeTankFeel();
  stepTankFeel(s2, 1 / 60, true);
  check('one frame delivers a fraction, not the move', s2.hoverT < 0.25, `hoverT=${s2.hoverT}`);
  let frames = 1;
  while (s2.hoverT < 0.9 && frames < 600) { stepTankFeel(s2, 1 / 60, true); frames++; }
  check('and it eases in over several frames', frames >= 5 && frames < 600, `frames=${frames}`);

  // Down must not be slower than up, or the tank sinks rather than drops.
  check('settle is at least as quick as spool-up', TANK_FEEL.down >= TANK_FEEL.up);
}

console.log('hover geometry:');
{
  const u = tank();
  const st = makeTankFeel();
  run(st, 4, true);
  applyTankFeel(u, st);
  const gap = u.userData.hoverBody.position.y - u.userData.hoverGear.position.y;
  check('body rises', u.userData.hoverBody.position.y > 0);
  check('gear drops', u.userData.hoverGear.position.y < 0);
  check('gap is rise + gearDrop', approx(gap, TANK_FEEL.rise + TANK_FEEL.gearDrop, 1e-3), `gap=${gap}`);
  // The whole point of the split: the gap opens, the tank does not levitate
  // as one lump. Total travel must stay small against tank height (~1 unit).
  check('travel stays subtle', gap < 0.25, `gap=${gap}`);
}

console.log('recoil:');
{
  const u = tank({ baseZ: -0.12 });
  const st = makeTankFeel();
  run(st, 4, true);
  const rest = (() => { applyTankFeel(u, st); return u.userData.turret.position.z; })();
  check('turret rests at baseZ', approx(rest, -0.12, 1e-3), `z=${rest}`);

  fireTankFeel(st);
  check('fire arms the full kick', approx(st.recoil, TANK_FEEL.recoilLen));
  applyTankFeel(u, st);
  check('turret slides back', u.userData.turret.position.z < rest - 0.1,
        `z=${u.userData.turret.position.z}`);
  check('body noses up', u.userData.hoverBody.rotation.x < 0,
        `rx=${u.userData.hoverBody.rotation.x}`);

  run(st, TANK_FEEL.recoilLen + 0.05, true);
  check('recoil expires', st.recoil === 0);
  applyTankFeel(u, st);
  check('turret returns to baseZ', approx(u.userData.turret.position.z, -0.12, 1e-3),
        `z=${u.userData.turret.position.z}`);
}

console.log('recoil without a hover split:');
{
  // The procedural tank has a turret but no body group. It must still kick —
  // this is why the recoil block sits ahead of the hoverBody early return.
  const u = tank({ hover: false });
  const st = makeTankFeel();
  fireTankFeel(st);
  applyTankFeel(u, st);
  check('turret still slides', u.userData.turret.position.z < 0,
        `z=${u.userData.turret.position.z}`);
  // With no baseZ recorded the rest position is 0, so the slide is the whole
  // of the displacement — not offset from somewhere else.
  check('missing baseZ reads as 0',
        approx(u.userData.turret.position.z, -TANK_FEEL.recoilSlide, 1e-9),
        `z=${u.userData.turret.position.z}`);
}

console.log('rock + recoil compose:');
{
  // Firing mid-landing must read as BOTH. Two writes to rotation.x would
  // silently keep only the last, which is the bug this asserts against.
  const u = tank();
  const st = makeTankFeel();
  run(st, 4, true);
  landTankFeel(st);
  stepTankFeel(st, 1 / 60, true);
  applyTankFeel(u, st);
  const rockOnly = u.userData.hoverBody.rotation.x;
  const rz = u.userData.hoverBody.rotation.z;
  check('landing rocks the body', rockOnly !== 0 && rz !== 0);
  fireTankFeel(st);
  applyTankFeel(u, st);
  check('recoil adds to the rock', u.userData.hoverBody.rotation.x < rockOnly - 0.01,
        `${rockOnly} -> ${u.userData.hoverBody.rotation.x}`);
  check('roll is untouched by recoil', approx(u.userData.hoverBody.rotation.z, rz));
}

console.log('vibration:');
{
  const u = tank();
  const st = makeTankFeel();
  applyTankFeel(u, st);
  check('still when stopped', u.userData.hoverBody.position.x === 0 && u.userData.hoverBody.position.z === 0);
  run(st, 4, true);
  let maxX = 0;
  for (let i = 0; i < 400; i++) { stepTankFeel(st, 1 / 60, true); applyTankFeel(u, st); maxX = Math.max(maxX, Math.abs(u.userData.hoverBody.position.x)); }
  check('vibrates when running', maxX > TANK_FEEL.vib * 0.5, `maxX=${maxX}`);
  check('vibration stays under the rise', maxX < TANK_FEEL.rise, `maxX=${maxX}`);
}

console.log('the three-tier rig:');
{
  // The mkcx rig: emitters planted, skirt settling, body rising, and the
  // weapons riding the body while shaking less than the hull does.
  const rig = () => {
    const u = tank({ baseZ: -0.12 });
    u.userData.hoverHull = node();
    u.userData.hoverWeapons = node();
    u.userData.secondaries = node();
    u.userData.hoverEmitters = node();   // present, and must never be written
    return u;
  };
  const u = rig();
  const st = makeTankFeel();
  run(st, 4, true);
  // sample the envelope: one frame can catch a zero crossing
  let hullMax = 0, gunMax = 0;
  for (let i = 0; i < 400; i++) {
    stepTankFeel(st, 1 / 60, true);
    applyTankFeel(u, st);
    hullMax = Math.max(hullMax, Math.abs(u.userData.hoverHull.position.x));
    gunMax = Math.max(gunMax, Math.abs(u.userData.hoverWeapons.position.x));
  }
  check('the hull takes the vibration', hullMax > 0, `hull=${hullMax}`);
  check('the guns take less of it', gunMax > 0 && gunMax < hullMax,
        `hull=${hullMax} guns=${gunMax}`);
  check('the guns take the declared share',
        approx(gunMax / hullMax, TANK_FEEL.vibWeapons, 1e-3),
        `${gunMax / hullMax} vs ${TANK_FEEL.vibWeapons}`);
  check('the body itself does not translate sideways',
        u.userData.hoverBody.position.x === 0 && u.userData.hoverBody.position.z === 0);
  check('the body still rises', u.userData.hoverBody.position.y > 0);
  check('the skirt still settles', u.userData.hoverGear.position.y < 0);
  check('the emitters stay planted',
        u.userData.hoverEmitters.position.x === 0
        && u.userData.hoverEmitters.position.y === 0
        && u.userData.hoverEmitters.position.z === 0);

  // Secondaries: immune by default, and dialling the share in brings them
  // back toward the body's own pitch.
  const u2 = rig();
  const s2 = makeTankFeel();
  run(s2, 4, true);
  fireTankFeel(s2);
  applyTankFeel(u2, s2);
  const bodyPitch = u2.userData.hoverBody.rotation.x;
  check('the body noses up on firing', bodyPitch < 0, `rx=${bodyPitch}`);
  // The share is a knob, so every assertion here names the share it tests
  // rather than leaning on whatever the current default happens to be.
  applyTankFeel(u2, s2, { ...TANK_FEEL, recoilSecondary: 0 });
  check('share 0 cancels the pitch entirely',
        approx(u2.userData.secondaries.rotation.x, -bodyPitch, 1e-9),
        `${u2.userData.secondaries.rotation.x} vs ${-bodyPitch}`);
  applyTankFeel(u2, s2, { ...TANK_FEEL, recoilSecondary: 1 });
  check('share 1 lets them ride it', approx(u2.userData.secondaries.rotation.x, 0, 1e-9));
  applyTankFeel(u2, s2, { ...TANK_FEEL, recoilSecondary: 0.5 });
  check('half share is half the cancel',
        approx(u2.userData.secondaries.rotation.x, -bodyPitch * 0.5, 1e-9));
}

console.log('tolerates the units that have none of this:');
{
  applyTankFeel(null, makeTankFeel());
  applyTankFeel({}, makeTankFeel());
  applyTankFeel({ userData: {} }, makeTankFeel());
  applyTankFeel({ userData: { hoverBody: { position: {}, rotation: {} } } }, makeTankFeel());
  applyTankHealth({ userData: {} }, 0.5);
  applyTankHealth(null, 0.5);
  check('no throw on bare units', true);
}

console.log('knob schema:');
{
  // The schema is the contract between the game's GUI and the viewer's modal.
  // If a constant gains a knob but the schema does not, the bench silently
  // stops covering it — so assert coverage in BOTH directions.
  const tunable = Object.keys(TANK_FEEL).filter((k) => typeof TANK_FEEL[k] === 'number');
  const keyed = TANK_FEEL_KNOBS.map((k) => k.key);
  check('every tunable has a knob',
        tunable.every((k) => keyed.includes(k)),
        `missing: ${tunable.filter((k) => !keyed.includes(k)).join(',')}`);
  check('every knob names a real constant',
        keyed.every((k) => k in TANK_FEEL),
        `stray: ${keyed.filter((k) => !(k in TANK_FEEL)).join(',')}`);
  check('no duplicate keys', new Set(keyed).size === keyed.length);
  check('every knob is fully described',
        TANK_FEEL_KNOBS.every((k) => k.label && k.group
          && Number.isFinite(k.min) && Number.isFinite(k.max) && k.step > 0));
  // A slider whose range excludes the shipped value is a trap: the first drag
  // would jump the tank to a different feel than the one you were judging.
  check('defaults sit inside their own ranges',
        TANK_FEEL_KNOBS.every((k) => TANK_FEEL[k.key] >= k.min && TANK_FEEL[k.key] <= k.max),
        TANK_FEEL_KNOBS.filter((k) => TANK_FEEL[k.key] < k.min || TANK_FEEL[k.key] > k.max)
          .map((k) => k.key).join(','));

  const p = makeFeelParams();
  check('makeFeelParams copies the defaults', TANK_FEEL_KNOBS.every((k) => p[k.key] === TANK_FEEL[k.key]));
  p.rise = 99;
  check('and is a copy, not a view', TANK_FEEL.rise !== 99);

  // Restored state is untrusted: out of range, NaN, junk keys, wrong types.
  const c = makeFeelParams();
  clampFeelParams(c, { rise: 999, decay: -50, vib: 'nonsense', nonesuch: 1 });
  check('clamps above max', c.rise === TANK_FEEL_KNOBS.find((k) => k.key === 'rise').max);
  check('clamps below min', c.decay === TANK_FEEL_KNOBS.find((k) => k.key === 'decay').min);
  check('ignores non-numeric', c.vib === TANK_FEEL.vib);
  check('ignores unknown keys', !('nonesuch' in c));
  clampFeelParams(c, {});
  check('an empty blob changes nothing', c.rise === TANK_FEEL_KNOBS.find((k) => k.key === 'rise').max);

  const code = formatFeelCode(makeFeelParams());
  check('emits a pasteable block', code.startsWith('export const TANK_FEEL = {') && code.endsWith('};'));
  check('emits every knob', TANK_FEEL_KNOBS.every((k) => code.includes(`${k.key}:`)));
  check('rounds to slider precision', !/\d\.\d{6,}/.test(code), code);
}

console.log('health colour:');
{
  const [r0, g0, b0] = healthColor(0);
  const [r1, g1, b1] = healthColor(1);
  check('full health reads blue', b1 > r1 && b1 > g1, `${r1},${g1},${b1}`);
  check('dead reads red', r0 > g0 && r0 > b0, `${r0},${g0},${b0}`);
  const [rm, gm, bm] = healthColor(0.5);
  check('midpoint is orange', rm > bm && gm > bm && gm < rm, `${rm},${gm},${bm}`);
  check('clamps below 0', healthColor(-3).every((c, i) => approx(c, healthColor(0)[i])));
  check('clamps above 1', healthColor(9).every((c, i) => approx(c, healthColor(1)[i])));
  // Monotonic blue: the beam must not brighten as the tank dies.
  let mono = true, prev = -1;
  for (let f = 0; f <= 1.0001; f += 0.05) { const b = healthColor(f)[2]; if (b < prev - 1e-9) mono = false; prev = b; }
  check('blue rises monotonically with health', mono);
}

console.log('health paint:');
{
  const mat = { color: { setRGB(r, g, b) { this.v = [r, g, b]; } },
                emissive: { setRGB(r, g, b) { this.v = [r, g, b]; } } };
  const u = { userData: { healthBeam: { material: mat } } };
  applyTankHealth(u, 1);
  check('paints colour', !!mat.color.v && mat.color.v[2] > mat.color.v[0]);
  // The hue lives in emissive; the diffuse is a dark tint of the same hue, so
  // the strip reads as a light source rather than a painted panel.
  check('emissive leads colour', mat.emissive.v[2] > mat.color.v[2]);
  check('emissive is the full hue', approx(mat.emissive.v[2], healthColor(1)[2]));
  check('diffuse keeps the hue', mat.color.v[2] > mat.color.v[0] && mat.color.v[2] < 0.4);
  // Multi-material beams (the merged GLB mast) must all get painted.
  const a = { color: { setRGB(r, g, b) { this.v = [r, g, b]; } } };
  const b = { color: { setRGB(r, g, b) { this.v = [r, g, b]; } } };
  applyTankHealth({ userData: { healthBeam: { material: [a, b] } } }, 0);
  check('paints every material', !!a.color.v && !!b.color.v);

  // The mkcx hands over a bare MATERIAL — the one instance all its running
  // lights share — not a mesh. Both shapes have to resolve.
  const shared = { color: { setRGB(r, g, b) { this.v = [r, g, b]; } },
                   emissive: { setRGB(r, g, b) { this.v = [r, g, b]; } } };
  applyTankHealth({ userData: { healthBeam: shared } }, 1);
  check('accepts a bare material', !!shared.emissive.v);
  // ...and an array of meshes, for a unit whose accents did not merge.
  const m1 = { color: { setRGB(r, g, b) { this.v = [r, g, b]; } } };
  const m2 = { color: { setRGB(r, g, b) { this.v = [r, g, b]; } } };
  applyTankHealth({ userData: { healthBeam: [{ material: m1 }, { material: m2 }] } }, 0.5);
  check('accepts an array of meshes', !!m1.color.v && !!m2.color.v);
}

console.log(failures ? `\n${failures} FAILURES` : '\nall tankfeel invariants hold');
process.exit(failures ? 1 : 0);
