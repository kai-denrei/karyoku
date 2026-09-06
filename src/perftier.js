// perftier.js — THE RENDER BUDGET, AS A TABLE.
//
// The phone got its render savings one at a time, each as a feeling: bloom
// halved "on phones" inside postfx.js (a matchMedia at import time), the
// wormhole at 384@30 "because 512@60 was too much", the pixel ratio capped at
// 2 everywhere. None of it was written down in one place, so nobody could say
// what a phone actually pays, or compare two phones' settings, or turn a knob
// without reading three files. This is the one place.
//
// Two tiers, not a slider: a tier is a set of decisions that were made
// together and are measured together (?perf=N prints the tier it ran under
// next to the draw stats). Picked once at boot, never mid-frame — a render
// target that changes size under a live game is a hitch nobody asked for.
//
// Pure module: no DOM. The browser-facing pick takes the facts as arguments.

export const TIERS = {
  desktop: {
    name: 'desktop',
    dprCap: 2,                          // Retina, but not a 3x phone's 3x
    antialias: true,
    wormhole: { size: 384, updateHz: 30 },   // portalfx's cost decision, 2026-09-02
    bloomScale: 1.0,
  },
  phone: {
    name: 'phone',
    dprCap: 1.5,                        // 3x glass renders 2.25x the pixels of 2x for the same look
    antialias: false,                   // MSAA on a mobile tiler is the single largest fixed cost
    wormhole: { size: 256, updateHz: 24 },   // plan §2.9: 256@24
    bloomScale: 0.5,                    // the mip chain at half res — postfx already did this
  },
};

// The pick. `forced` wins (a probe or a ?tier= asks for a tier by name);
// otherwise a coarse pointer on a phone-class short side is the phone tier —
// the same test the mobile shell uses, on purpose: one detection, two
// consumers.
export function pickTier({ coarse = false, shortSide = Infinity, forced = null } = {}) {
  if (forced && TIERS[forced]) return TIERS[forced];
  return coarse && shortSide < 900 ? TIERS.phone : TIERS.desktop;
}

// What the wormhole costs under a tier, in sine-folds per rendered frame
// and per second — the number that decided 384@30 over 512@60, so it should
// be the number that decides 256@24 too.
export function wormholeCost(tier, preset) {
  const folds = tier.wormhole.size ** 2 * preset.uSteps * preset.uTurbOctaves;
  return { folds, foldsPerSec: folds * tier.wormhole.updateHz };
}
