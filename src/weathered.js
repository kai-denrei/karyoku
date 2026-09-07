// weathered.js — WEATHERED METAL FROM A SEED, AS BYTES.
//
// Dark gunmetal that has stood in a hostile alien atmosphere: a cool
// near-black plate, oxide creeping in patches, roughness low where the
// surface is protected and high where the wind has got at it, and a normal
// map of directional scratches over isotropic pitting.
//
// Pure: no three.js, no DOM, no canvas — three typed arrays out, Node-tested
// (test/weathered.mjs). The three.js side (DataTextures, the material, the
// apply-by-name walk) is src/cine/materials.js. Same split as
// galaxyseed.js / galaxybake.js, and for the same reason: the numbers are
// testable and the upload is not.
//
// Why it ships in kilobytes: nothing is shipped. The maps are BAKED at load
// from a seed, so an authored CC0 PBR set's megabytes become ~250 lines of
// arithmetic, and "deterministic everything" holds — same seed, same metal,
// on any machine, in any run.
//
// THE ORM PACKING IS NOT A STYLE CHOICE. three.js reads roughnessMap from
// the GREEN channel, metalnessMap from BLUE and aoMap from RED (r160,
// roughnessmap_fragment / metalnessmap_fragment / aomap_fragment). A
// single-channel RedFormat texture samples as (r, 0, 0, 1), so the obvious
// "one small texture per map" would feed roughness and metalness a hard
// ZERO. Packing AO/rough/metal into one RGB texture is glTF's own
// convention, reads correctly in all three slots, and is one upload instead
// of three. The bytes are RGBA (alpha 255): three r160 has no RGBFormat for
// a DataTexture, so stride 4 is what the GPU takes and the baker says so
// rather than making the wrapper repack.
import { mulberry32 } from './rng.js?v=8e468128';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
// smoothstep with an edge pair, the shader function by the same name
const sstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------
// The noise. Value noise on a mulberry32 table, bilinear with a smoothstep
// fade — hand-rolled rather than vendoring three's SimplexNoise addon,
// because every other seeded field in this project is a mulberry32 stream
// and weathering has no use for simplex's isotropy. A vendored addon would
// also be a second RNG in a codebase whose whole determinism story is "one
// stream from one seed".
//
// TILEABLE BY CONSTRUCTION, and the periods are why. The lattice wraps at
// an integer period PER AXIS, so sampling x = u * px for u in [0, 1) makes
// the last column hash to the same lattice point as the first. Per-axis
// periods are what let scratches be anisotropic (px 96, py 6 = long thin
// streaks) and still not show a seam.
// ---------------------------------------------------------------------------
export function makeNoise(seed, table = 4096) {
  const rng = mulberry32((seed >>> 0) || 1);
  const tab = new Float32Array(table);
  for (let i = 0; i < table; i++) tab[i] = rng();
  const mask = table - 1;          // table is a power of two
  const at = (xi, yi, px, py, salt) => {
    const i = ((xi % px) + px) % px;
    const j = ((yi % py) + py) % py;
    let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(salt + 1, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return tab[(h ^ (h >>> 16)) & mask];
  };
  return function noise(x, y, px, py, salt = 0) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const sx = sstep(0, 1, x - x0), sy = sstep(0, 1, y - y0);
    const a = at(x0, y0, px, py, salt), b = at(x0 + 1, y0, px, py, salt);
    const c = at(x0, y0 + 1, px, py, salt), d = at(x0 + 1, y0 + 1, px, py, salt);
    const top = lerp(a, b, sx), bot = lerp(c, d, sx);
    return lerp(top, bot, sy);
  };
}

// Fractal sum. Octave k doubles both periods, so every octave is still
// integer-periodic and the sum is still seamless.
export function fbm(noise, u, v, { px, py, octaves = 3, salt = 0, gain = 0.5 } = {}) {
  let sum = 0, amp = 1, norm = 0;
  for (let k = 0; k < octaves; k++) {
    const m = 1 << k;
    sum += amp * noise(u * px * m, v * py * m, px * m, py * m, salt + k * 17);
    norm += amp;
    amp *= gain;
  }
  return sum / norm;
}

// ---------------------------------------------------------------------------
// The presets. A registry, like GALAXY_PALETTES and the look tables — the
// numbers are taste and taste belongs in one place.
//
// patinaEdge is the soft threshold on the oxide field, and it is the knob
// that decides whether this is plate with patches of corrosion or corrosion
// with patches of plate. A first cut at [0.46, 0.66] covered 59% of the
// surface — measured, by the bake's own coverage number — which is the wrong
// object: armour that has stood out in weather, not armour that has
// dissolved. [0.60, 0.80] puts it near a sixth.
//
// PATINA IS TEAL-VERDIGRIS (ruling, 2026-09-04), and the reason is the belt
// palette: rust-orange is the drifter's own belt and violet is barbed and
// prime AND the wormhole throat's ambient light, so either would make
// weathered player hardware read as a threat colour or steal the throat's
// accent. Teal sits next to nothing in either belt and echoes the CRT cyan
// already on the ring's glow strips.
// ---------------------------------------------------------------------------
export const WEATHER_PRESETS = {
  // the standing look: dark cool gunmetal, oxide in teal
  // MEDIUM GREY by the operator's call (2026-09-04, from the phone, on the
  // tank): the first cut's 0x3d4247 read as a black card from the side
  // ...and the read is the operator's own from the lab (metal 128..242,
  // oxide 38%): under a black sky a fully metallic plate is black whatever
  // its base, so the oxide keeps half its metalness and takes more of the
  // surface — the diffuse half is what catches the sun and reads as grey
  gunmetal: {
    baseHex: 0x6e747b, patinaHex: 0x0d1c1a,
    metalness: [0.50, 0.95], roughness: [0.20, 0.80],
    patinaEdge: [0.60, 0.80], patinaBias: 0.04,   // 36.7% coverage at seed 4414 — the operator's 38%
    scratch: 1.0, pit: 1.0, normalStrength: 1.0,
  },
  // structural steel: darker, rougher, less oxide (it is replaced more often)
  steel: {
    baseHex: 0x5a6067, patinaHex: 0x0d1c1a,
    metalness: [0.18, 0.90], roughness: [0.30, 0.85],
    patinaEdge: [0.60, 0.80], patinaBias: -0.12,
    scratch: 1.2, pit: 0.8, normalStrength: 1.0,
  },
  // THE BOARD's preset: a detail overlay, not a paint. The board keeps its
  // grey ladder as the colour (materials.js keepColor), so the albedo here
  // sits near white and the mottle, the pits and a lighter oxide MODULATE
  // the rung instead of dimming it under the board's 0.55/0.25 light. Less
  // metal than the cinematic's: the board has no environment to reflect.
  board: {
    baseHex: 0xd8dce0, patinaHex: 0x4a625e,
    metalness: [0.45, 0.85], roughness: [0.35, 0.80],   // the dressed casts get the sky as their environment
    patinaEdge: [0.60, 0.80], patinaBias: 0.04,
    scratch: 1.0, pit: 1.3, normalStrength: 1.3,
  },
  // seals and boots: almost no metal, almost no oxide, uniformly rough
  rubber: {
    baseHex: 0x1f2225, patinaHex: 0x121a19,
    metalness: [0.02, 0.10], roughness: [0.82, 0.97],
    patinaEdge: [0.60, 0.80], patinaBias: -0.22,
    scratch: 0.3, pit: 1.4, normalStrength: 0.7,
  },
};

// The frequency plan, one place. px/py are the per-axis lattice periods, so
// each row is also its own tiling guarantee.
const F = {
  patina: { px: 5, py: 5, octaves: 3, salt: 11 },    // where the chemistry pooled
  wear: { px: 9, py: 9, octaves: 2, salt: 29 },      // exposed vs protected
  grain: { px: 64, py: 64, octaves: 2, salt: 47 },   // the plate's own tooth
  scratch: { px: 64, py: 8, octaves: 2, salt: 61 },  // stretched: directional
  pit: { px: 160, py: 160, octaves: 2, salt: 83 },   // isotropic corrosion pocks
};

/**
 * Bake one weathered-metal map set.
 *
 * @returns {{ size:number, albedo:Uint8ClampedArray, orm:Uint8ClampedArray,
 *             normal:Uint8ClampedArray, coverage:number }}
 *   albedo — sRGB bytes, RGBA (alpha 255)
 *   orm    — AO in R, roughness in G, metalness in B, 255 in A (three.js channel order)
 *   normal — tangent-space normal, RGBA, +Z out
 *   coverage — the fraction of the surface the oxide took
 */
export function bakeWeatheredMetal(opts = {}) {
  const {
    seed = 1, size = 512, preset = 'gunmetal',
  } = opts;
  const p = { ...(WEATHER_PRESETS[preset] || WEATHER_PRESETS.gunmetal), ...opts };
  const [metalLo, metalHi] = p.metalness;
  const [patE0, patE1] = p.patinaEdge || [0.60, 0.80];
  const [roughLo, roughHi] = p.roughness;
  const br = (p.baseHex >> 16) & 255, bg = (p.baseHex >> 8) & 255, bb = p.baseHex & 255;
  const pr = (p.patinaHex >> 16) & 255, pg = (p.patinaHex >> 8) & 255, pb = p.patinaHex & 255;

  const noise = makeNoise(seed);
  const n = size * size;
  const albedo = new Uint8ClampedArray(n * 4);
  const orm = new Uint8ClampedArray(n * 4);
  const normal = new Uint8ClampedArray(n * 4);
  // the height field the normal map is differentiated from, kept whole
  // because a central difference needs its neighbours
  const height = new Float32Array(n);
  // how much of the surface the oxide actually took. Counted HERE, from the
  // mask itself, because it cannot be recovered from the maps afterwards:
  // metalnessMap alone cannot distinguish corroded steel from rubber, which
  // is never metallic anywhere. A fact from the bake beats an inference.
  let covered = 0;

  // pass 1: the scalar fields, and everything that does not need a neighbour
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const k = y * size + x;

      // WHERE THE CHEMISTRY GOT IN. A low-frequency field thresholded with a
      // soft edge: oxide comes in patches with a front, not as a gradient.
      const ox = fbm(noise, u, v, F.patina) + p.patinaBias;
      const pat = sstep(patE0, patE1, ox);
      if (pat > 0.5) covered++;

      // WHAT THE WIND GOT AT. 1 = exposed and scoured, 0 = a protected
      // recess. Stands in for a curvature bake: a cinematic wants the read,
      // not the geometry (§2.7 wants contact from GTAO, not from this).
      const wear = fbm(noise, u, v, F.wear);

      const grain = fbm(noise, u, v, F.grain) - 0.5;
      // scratches are SIGNED and stretched along u; abs() would make every
      // groove a ridge and the plate would read as brushed, not scarred
      const scr = (fbm(noise, u, v, F.scratch) - 0.5) * p.scratch;
      const pit = (fbm(noise, u, v, F.pit) - 0.5) * p.pit;

      // the first still (t=8, 1024px, repeat 1) read as BRUSHED steel — a
      // machined finish, the RTF's own warning — with scratches at 0.55 of
      // the height and a 96:6 stretch. Pits carry more now and the
      // scratches are shorter and shallower: scarred, not turned on a lathe.
      height[k] = scr * 0.32 + pit * 0.42 + pat * 0.15;

      // ---- albedo: base, grained, then dragged toward the patina ----
      const g = 1 + grain * 0.16;
      // bare metal that the wind has polished reads a little lighter
      const w = 1 + sstep(0.55, 1.0, wear) * 0.10;
      const rC = lerp(br * g * w, pr, pat);
      const gC = lerp(bg * g * w, pg, pat);
      const bC = lerp(bb * g * w, pb, pat);
      albedo[k * 4] = rC; albedo[k * 4 + 1] = gC; albedo[k * 4 + 2] = bC; albedo[k * 4 + 3] = 255;

      // ---- ORM ----
      // AO (R): recesses hold shadow. Not a real occlusion bake and not
      // pretending to be one — it is the wear field read the other way.
      const ao = 1 - (1 - wear) * 0.35;
      // roughness (G): protected and smooth, exposed and scoured; oxide is
      // rougher than anything under it, and a scratch scatters either way
      const rough = clamp(
        lerp(roughLo, roughHi, wear) + pat * 0.18 + Math.abs(scr) * 0.14, 0, 1);
      // metalness (B): raw plate is metal, oxide is not. This is the channel
      // that does the work — a patch that stops being metallic stops
      // reflecting the sky, and that is what reads as corrosion.
      const metal = clamp(lerp(metalHi, metalLo, pat), 0, 1);
      orm[k * 4] = ao * 255;
      orm[k * 4 + 1] = rough * 255;
      orm[k * 4 + 2] = metal * 255;
      orm[k * 4 + 3] = 255;
    }
  }

  // pass 2: the normal map, by central difference on the height field.
  // Wrapped indices, so the normal map tiles exactly as the others do.
  const s = p.normalStrength * size / 512;   // slope per texel is resolution-relative
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const k = y * size + x;
      const xm = (x - 1 + size) % size, xp = (x + 1) % size;
      const ym = (y - 1 + size) % size, yp = (y + 1) % size;
      const dx = (height[y * size + xp] - height[y * size + xm]) * s;
      const dy = (height[yp * size + x] - height[ym * size + x]) * s;
      // the surface normal of a height field is (-dh/dx, -dh/dy, 1)
      const nx = -dx, ny = -dy, nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      normal[k * 4] = (nx * inv * 0.5 + 0.5) * 255;
      normal[k * 4 + 1] = (ny * inv * 0.5 + 0.5) * 255;
      normal[k * 4 + 2] = (nz * inv * 0.5 + 0.5) * 255;
      normal[k * 4 + 3] = 255;
    }
  }

  return { size, albedo, orm, normal, coverage: covered / n };
}

/**
 * What the bake actually contains, for tests and for a probe line. Reading
 * the maps back is the only honest way to assert a look: the numbers that
 * matter (does metalness really drop in the patina? does roughness stay
 * inside its band? does the tile have a seam?) are properties of the bytes,
 * not of the knobs.
 */
export function weatherStats(baked) {
  const { size, albedo, orm, normal } = baked;
  const n = size * size;
  let aoS = 0, roS = 0, meS = 0, roMin = 255, roMax = 0, meMin = 255, meMax = 0;
  for (let k = 0; k < n; k++) {
    const ao = orm[k * 4], ro = orm[k * 4 + 1], me = orm[k * 4 + 2];
    aoS += ao; roS += ro; meS += me;
    if (ro < roMin) roMin = ro; if (ro > roMax) roMax = ro;
    if (me < meMin) meMin = me; if (me > meMax) meMax = me;
  }
  // THE SEAM. Column 0 against column size-1 and row 0 against row size-1:
  // if the periods were not integers these would disagree, and a tiled
  // model would show a grid. Mean absolute byte difference, per map.
  const seam = (arr, ch) => {
    let du = 0, dv = 0;
    for (let i = 0; i < size; i++) {
      for (let c = 0; c < ch; c++) {
        du += Math.abs(arr[(i * size + 0) * ch + c] - arr[(i * size + size - 1) * ch + c]);
        dv += Math.abs(arr[(0 * size + i) * ch + c] - arr[((size - 1) * size + i) * ch + c]);
      }
    }
    return Math.max(du, dv) / (size * ch);
  };
  return {
    size,
    ao: aoS / n, rough: roS / n, metal: meS / n,
    roughMin: roMin, roughMax: roMax, metalMin: meMin, metalMax: meMax,
    coverage: baked.coverage,
    seamAlbedo: seam(albedo, 4), seamOrm: seam(orm, 4), seamNormal: seam(normal, 4),
    bytes: albedo.length + orm.length + normal.length,
  };
}
