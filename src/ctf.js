// ctf.js — CAPTURE THE FLAG. Each base keeps two poles: slot 1 is the
// FIRE flag, slot 2 the POWER flag. Home starts holding fire with power's
// pole empty; the enemy holds power with fire's pole empty. The hull that
// stops by the enemy's full pole takes its flag; stopped by its own empty
// pole it plants it, the set is complete, and that is the win. Pure;
// test/ctf.mjs. Positions in world metres.
export const CTF_TUNE = { captureM: 7, stopSpeed: 1.5, winBonus: 1000 };
export const SLOTS = [{ glyph: 'fire', banner: 'flag_ember', pole: 'pole_beacon' }, { glyph: 'power', banner: 'flag_vanguard', pole: 'pole_tactical' }];

// `stands`: { home: [{x,z},{x,z}], hostile: [{x,z},{x,z}] } (slot order)
export function makeCtf(stands) {
  return {
    stands,
    // who holds what: the flag of each slot, where it is
    flags: [
      { slot: 0, glyph: 'fire', owner: 'home', at: 'home', carried: false },
      { slot: 1, glyph: 'power', owner: 'hostile', at: 'hostile', carried: false },
    ],
    carrying: null,   // the flag the hull carries, or null
    won: false, score: 0, captures: 0, events: [],
  };
}
const nearPole = (hull, stands, side, slot, tune) => stands[side] && stands[side][slot] && Math.hypot(hull.x - stands[side][slot].x, hull.z - stands[side][slot].z) <= tune.captureM;

// one step; returns events: 'capture' the frame the enemy flag is taken,
// 'plant' (and won) the frame it goes up on the home pole
export function stepCtf(ctf, hull, tune = CTF_TUNE) {
  const out = [];
  if (ctf.won) return out;
  const stopped = Math.abs(hull.speed || 0) < tune.stopSpeed;
  if (!stopped) return out;
  if (!ctf.carrying) {
    // the enemy's full pole: its own flag, at home there
    const f = ctf.flags.find((x) => x.owner === 'hostile' && x.at === 'hostile' && !x.carried);
    if (f && nearPole(hull, ctf.stands, 'hostile', f.slot, tune)) { f.carried = true; f.at = 'hull'; ctf.carrying = f; ctf.captures++; out.push('capture'); }
    return out;
  }
  // home's empty pole for this slot
  const f = ctf.carrying;
  if (nearPole(hull, ctf.stands, 'home', f.slot, tune)) {
    f.carried = false; f.at = 'home'; ctf.carrying = null;
    ctf.won = true; ctf.score += tune.winBonus;
    out.push('plant');
  }
  return out;
}
// what stands on a side's slot right now: 'flag' (that slot's flag is there) or 'empty'
export const poleState = (ctf, side, slot) => (ctf.flags.some((f) => f.slot === slot && f.at === side) ? 'flag' : 'empty');
