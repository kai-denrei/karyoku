// casts.js — how a GLB becomes a piece of THIS board: the reference project's
// recipe for its casts (units.js there), kept as one place here. A model
// arrives near-black and unlit; it leaves repainted on the grey ladder,
// wearing the weathered metal, edged where it is a machine you look at up
// close. The board's light is the TD board's, so the numbers are theirs.
import * as THREE from '../vendor/three.module.js';
import { tintModel, addEdgeOutlines } from './glbmodels.js?v=ef335ef3';
import { applyWeatheredMaterial } from './materials.js?v=ef335ef3';

export function hideCollisionNodes(root) {
  root.traverse((o) => { if (/collision/i.test(o.name || '')) o.visible = false; });
}

// The grey ladder by material name: colour and emissive per rung, because
// under this light a standard material painted dark is a silhouette.
function repaint(scene, table) {
  const painted = new Set();
  scene.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      const rung = table[m.name];
      if (!rung || painted.has(m)) continue;
      painted.add(m);
      m.color.setHex(rung[0]);
      if (m.emissive) m.emissive.setHex(rung[1]);
      if (m.metalness !== undefined) m.metalness = Math.min(m.metalness, 0.45);
      if (m.roughness !== undefined) m.roughness = Math.max(m.roughness, 0.55);
    }
  });
}

// The container ships with cargo; the operator's spec empties it.
export function prepContainer(scene) {
  const cargo = scene.getObjectByName('Cargo_Group');
  if (cargo && cargo.parent) cargo.parent.remove(cargo);
  hideCollisionNodes(scene);
  repaint(scene, {
    M_Armour: [0xb4bac0, 0x3a4046],
    M_Steel: [0x7d848a, 0x23282c],
    M_Detail: [0x9aa0a4, 0x2e3236],
  });
}

// The Stalheart: the terraformer gantry, the reference's colony heart.
export function prepTerraformer(scene) {
  hideCollisionNodes(scene);
  repaint(scene, {
    M_Armour: [0xb9bfc4, 0x3c4247], M_Steel: [0x848b91, 0x242a2e], M_Detail: [0x9ea4a8, 0x2f3337],
    M_Turret: [0x9aa1a6, 0x2b3034], M_Track: [0x4a5054, 0x15181a], M_Rubber: [0x2a2e31, 0x0c0e10],
    M_Glow2: [0x7df9ff, 0x2aa8bf], M_Glow4: [0xffb000, 0x8a5b00],
  });
}

export const PREP = { 'container.glb': prepContainer, 'terraformer.glb': prepTerraformer };
export const prepFor = (url) => PREP[url.split('/').pop()] || null;

// The reference tank's ladder: same hue as the tint, lightness by rung.
export const CAST_SHADES = { armour: 1.0, turret: 0.7, detail: 0.55, steel: 0.34 };
export function ladderTint(root, color, wash = 0.22) {
  tintModel(root, color, { wash, shades: CAST_SHADES });
  return root;
}

// The TD board's metal: the weathered maps over the ladder, colour and
// emissive kept, because under this light the rungs are why machines read.
// No sky bake here yet, so no environment map.
export function dressMetal(root, size = 512) {
  try {
    return applyWeatheredMaterial(root, { seed: 4414, size, repeat: 2, normalScale: 0.8, keepEmissive: true, keepColor: true });
  } catch (e) { console.warn('METAL: dress failed', e); return 0; }
}

// The hull: outlines on the prototype (EdgesGeometry once), then the ladder
// and the metal — the reference's exact order.
export function castHull(merged, color) {
  addEdgeOutlines(merged, { angle: 28, opacity: 0.85 });
  ladderTint(merged, color);
  dressMetal(merged);
  return merged;
}
export { THREE };
