// cine/materials.js — THE THREE.JS SIDE OF THE WEATHERED METAL.
//
// src/weathered.js bakes the maps as bytes and knows nothing about the GPU;
// this uploads them, and dresses a model IN PLACE by material name. The name
// contract is the one units.js already has: M_Armour / M_Turret / M_Detail /
// M_Steel / M_Track / M_Rubber are what the container, the crane, the portal
// ring and the MK-CX/2 all call their surfaces, so one walk dresses any of
// them and there is no per-asset copy of anything (plan §0).
//
// One bake per PRESET, not per material: three bakes at most, cached by
// their knobs. The ring's grey ladder — armour brightest, rubber darkest —
// is a per-name TINT multiplying the albedo map, which is what a
// material's colour is once a map is bound. Five bakes for five rungs would
// be five seconds and sixty megabytes for a distinction a multiplier makes.
import * as THREE from '../vendor/three.module.js';
import { bakeWeatheredMetal } from './weathered.js?v=2b5e6f89';

// Which preset each named surface wears, and how bright a rung it is. The
// tints are the RING_REPAINT ladder's ratios (armour 0xc2c8ce down to
// rubber 0x5e6469), re-based so the brightest rung is the map as baked.
export const WEATHER_BY_NAME = {
  M_Armour: { preset: 'gunmetal', tint: 1.00 },
  M_Turret: { preset: 'gunmetal', tint: 0.90 },
  M_Detail: { preset: 'gunmetal', tint: 0.82 },
  M_Steel: { preset: 'steel', tint: 1.00 },
  M_Track: { preset: 'steel', tint: 0.72 },
  M_Rubber: { preset: 'rubber', tint: 1.00 },
};

// THE DARK BASE. The board's grey ladder lifts every structural material
// to a light grey WITH a grey emissive so the machines show on an unlit
// board; under a sun, a sky and ACES that reads white-hot (the first tank
// still: a paper cut-out). A cinematic lights its metal, so before any map
// is bound every named material goes to a dark grey with no emissive —
// and a material whose meshes have no uv (the merge drops it; see
// glbmodels.js) STAYS here, which is a flat dark metal rather than nothing.
export const CINE_BASE = {
  M_Armour: [0x4b5157, 0.78, 0.35], M_Turret: [0x454b51, 0.80, 0.35],
  M_Detail: [0x3c4247, 0.70, 0.45], M_Steel: [0x5a6168, 0.50, 0.80],
  M_Track: [0x30353a, 0.85, 0.30], M_Rubber: [0x1f2225, 0.95, 0.05],
};

const cache = new Map();

/**
 * The maps for one preset, as textures. Cached by every knob, so a second
 * model asking for the same metal gets the same three uploads.
 *
 * A DataTexture defaults to NEAREST filtering and no mipmaps — the settings
 * for a lookup table, not a surface. Under a raking key light that reads as
 * a screen-door of texels; linear + mipmaps + anisotropy is what a texture
 * on a model needs, and it has to be said explicitly here.
 */
export function makeWeatheredTextures({ seed = 4414, size = 1024, preset = 'gunmetal', repeat = 1, anisotropy = 8, ...knobs } = {}) {
  const key = JSON.stringify({ seed, size, preset, repeat, anisotropy, ...knobs });
  if (cache.has(key)) return cache.get(key);
  const baked = bakeWeatheredMetal({ seed, size, preset, ...knobs });
  const tex = (data, srgb) => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;    // the maps tile; that is the point of the periods
    t.repeat.set(repeat, repeat);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = anisotropy;
    t.needsUpdate = true;
    return t;
  };
  const out = {
    map: tex(baked.albedo, true),
    ormMap: tex(baked.orm, false),        // AO in R, roughness in G, metalness in B
    normalMap: tex(baked.normal, false),
    baked,
  };
  cache.set(key, out);
  return out;
}

/**
 * Dress a model in place. Walks every mesh, and for each material whose
 * name is in `byName` binds the preset's maps: albedo as `map`, the ORM
 * texture as `aoMap` AND `roughnessMap` AND `metalnessMap` (three.js reads
 * R, G and B respectively — one texture, three slots), the normal map.
 *
 * THE MAPS ARE THE MATERIAL. Once bound, `color`, `roughness` and
 * `metalness` are multipliers on them, so they go to white / 1 / 1 (the
 * tint aside), and the emissive goes to black: a cinematic lights its
 * metal, and the grey ladder's emissive rungs — there so the ring shows on
 * an unlit board — would wash the sky's reflection out.
 *
 * Returns the number of distinct materials dressed, for a probe line.
 */
export function applyWeatheredMaterial(root, {
  seed = 4414, size = 1024, repeat = 1, normalScale = 1.0, byName = WEATHER_BY_NAME, keepEmissive = false,
  // keepColor: the board's grey ladder stays as the colour and the maps
  // modulate it — the board is lit at hemi 0.55 / sun 0.25, and the
  // ladder's rungs (colour + emissive) are the only reason the machines
  // read there. A cinematic sets both false and lights its metal.
  keepColor = false,
  // envMap: an environment for the dressed materials ONLY (the board's own
  // sky bake through PMREM) — a metal shows what it reflects, and a board
  // with no environment shows a flat ladder whatever the maps say
  envMap = null, envMapIntensity = 0.8,
} = {}) {
  // A MAP ON A MESH WITH NO UVs SAMPLES ONE TEXEL. The attribute is missing,
  // WebGL feeds the shader (0,0,0,1), and the whole surface wears whatever
  // sits at the map's corner — which for a patina map can be a teal, non-
  // metallic blotch. The ring's M_Steel and M_Rubber batches come out of
  // mergeByMaterial without a uv attribute (measured, matprobe 2026-09-04),
  // so a material is dressed only if EVERY mesh wearing it has one; the
  // rest keep the flat base they came with. The honest fix — UVs surviving
  // the merge — belongs in glbmodels.js, and is named there.
  const hasUv = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const ok = !!(o.geometry && o.geometry.attributes && o.geometry.attributes.uv);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m) hasUv.set(m, (hasUv.get(m) ?? true) && ok);
    }
  });
  const done = new Set();
  let count = 0;
  const skipped = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      const spec = m && byName[m.name];
      if (!spec || done.has(m)) continue;
      done.add(m);
      // a material with no roughness has no PBR slots to bind (MeshBasic, Points)
      if (m.roughness === undefined) continue;
      // the dark base first, maps or not — unless the caller keeps the ladder
      const base = CINE_BASE[m.name];
      if (base && !keepColor) { m.color.setHex(base[0]); m.roughness = base[1]; m.metalness = base[2]; }
      if (!keepEmissive && m.emissive) { m.emissive.setHex(0x000000); m.emissiveIntensity = 0; }
      m.needsUpdate = true;
      if (!hasUv.get(m)) { skipped.push(m.name); continue; }
      let { preset = 'gunmetal', tint = 1, ...knobs } = typeof spec === 'string' ? { preset: spec } : spec;
      if (keepColor) { preset = 'board'; knobs = {}; }   // the board's detail overlay, whatever the rung
      const tx = makeWeatheredTextures({ seed, size, preset, repeat, ...knobs });
      m.map = tx.map;
      m.aoMap = tx.ormMap; m.aoMapIntensity = 1;
      m.roughnessMap = tx.ormMap;
      m.metalnessMap = tx.ormMap;
      m.normalMap = tx.normalMap;
      if (m.normalScale) m.normalScale.set(normalScale, normalScale);
      if (!keepColor) { m.color.setScalar(tint); m.roughness = 1; m.metalness = 1; }
      else {
        m.roughness = 1; m.metalness = 1;   // the maps carry both; the rung keeps its colour and emissive
        // ...and the emissive takes the albedo as ITS map too: under the
        // board's dim light the rung's emissive is most of what you see,
        // and a map that modulates only the diffuse term does not show
        if (m.emissive) m.emissiveMap = tx.map;
      }
      if (envMap) { m.envMap = envMap; m.envMapIntensity = envMapIntensity; }
      if (!keepEmissive && m.emissive) { m.emissive.setHex(0x000000); m.emissiveIntensity = 0; }
      m.needsUpdate = true;
      count++;
    }
  });
  if (skipped.length) console.warn(`WEATHER skipped ${skipped.length} material(s) with no uv: ${[...new Set(skipped)].join(', ')}`);
  return count;
}

/**
 * The sky as light. A cubemap through PMREM is the environment every PBR
 * surface reflects; the caller owns disposal of the generator's output.
 */
export function skyEnvironment(renderer, cubeTexture) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromCubemap(cubeTexture).texture;
  pmrem.dispose();
  return env;
}
