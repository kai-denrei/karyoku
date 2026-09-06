// postfx.js — the bloom chain, with a PER-GROUP intensity.
//
// UnrealBloomPass is a full-screen effect: it has no idea what an object
// is. So per-group bloom is not a parameter, it is a render path. One
// chain is fed a WEIGHTED render of the scene (each object's colour
// scaled by its group's weight), and the pure bloom from that is added to
// a normal, unweighted render:
//
//     output = scene + bloom(scene x weights)
//
// which means a weight changes how hard something GLOWS without changing
// how brightly it DRAWS. That is the point — dimming the board would have
// calmed its glow and its lines together; this calms only the glow.
//
// The trick that makes it clean: r160's UnrealBloomPass blends its result
// additively over its input and ignores this.clear at that step, so the
// pass output is always input+bloom and can't be made bloom-only. But it
// leaves the PURE bloom in renderTargetsHorizontal[0] just before that
// blend, and that texture is readable. No scene term leaks into the add.
import { EffectComposer } from '../vendor/EffectComposer.js';
import { RenderPass } from '../vendor/RenderPass.js';
import { UnrealBloomPass } from '../vendor/UnrealBloomPass.js';
import { ShaderPass } from '../vendor/ShaderPass.js';
import { OutputPass } from '../vendor/OutputPass.js';
import * as THREE from '../vendor/three.module.js';
import { buildWeightMap, materialConflicts, clampWeight, DEFAULT_BLOOM_WEIGHTS }
  from './bloomweights.js?v=2b5e6f89';

const COARSE = typeof matchMedia === 'function'
  && matchMedia('(pointer: coarse)').matches;

// The bloom's target size, in DEVICE pixels. EffectComposer sizes every
// pass at device pixels (it multiplies by the renderer's pixelRatio);
// anything that RE-APPLIES a pass size afterwards has to do the same, or
// it silently drops the ratio. Getting this wrong is invisible on a
// dpr-1 display and blocky on every Retina one, so it is pure and tested.
export function bloomTargetSize(cssW, cssH, pixelRatio, scale) {
  const f = (pixelRatio || 1) * (scale || 1);
  return {
    w: Math.max(1, Math.round(cssW * f)),
    h: Math.max(1, Math.round(cssH * f)),
  };
}

// base + bloom, in linear space, before OutputPass converts. Same place
// the bloom was applied before this change.
const AddBloomShader = {
  uniforms: { tDiffuse: { value: null }, tBloom: { value: null } },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform sampler2D tBloom;
    varying vec2 vUv;
    void main() { gl_FragColor = texture2D(tDiffuse, vUv) + texture2D(tBloom, vUv); }
  `,
};

export function makeBloom(renderer, scene, camera, opts = {}) {
  const o = {
    // Softer and WIDER than it was, and biting much lower: a 0.85
    // threshold only ever caught the near-white highlights, so bloom read
    // as a rim on a few bright edges. At 0.2 it catches the body colours
    // too, which is why the strength has to come down to 0.3 — the same
    // total light, spread over far more of the frame.
    strength: 0.3, radius: 0.5, threshold: 0.2, enabled: true,
    // UnrealBloomPass builds a mip chain — halve it on phones
    scale: COARSE ? 0.5 : 1.0,
    ...opts,
  };
  let enabled = o.enabled;
  const weights = { ...DEFAULT_BLOOM_WEIGHTS };
  let groupsFn = null;   // null => no weighting, i.e. the pre-change behaviour
  let warnedConflict = false;

  const size = renderer.getSize(new THREE.Vector2());
  const b0 = bloomTargetSize(size.x, size.y, renderer.getPixelRatio(), o.scale);

  // --- pass A: the weighted scene -> bloom
  const bloomComposer = new EffectComposer(renderer);
  bloomComposer.renderToScreen = false;
  bloomComposer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(b0.w, b0.h), o.strength, o.radius, o.threshold);
  bloomComposer.addPass(bloom);

  // --- pass B: the real scene + that bloom
  const finalComposer = new EffectComposer(renderer);
  // EffectComposer's targets are created WITHOUT samples, so compositing
  // silently discards the renderer's antialias:true. On a wireframe board
  // that is the most visible side effect of adding a chain at all — ask
  // for MSAA back (samples survives setSize, so this is set once).
  finalComposer.renderTarget1.samples = 4;
  finalComposer.renderTarget2.samples = 4;
  finalComposer.addPass(new RenderPass(scene, camera));
  const addPass = new ShaderPass(AddBloomShader);
  finalComposer.addPass(addPass);
  // linear render targets -> without OutputPass the whole scene washes out
  finalComposer.addPass(new OutputPass());

  bloomComposer.setSize(size.x, size.y);
  finalComposer.setSize(size.x, size.y);

  // --- weighting: applied before the bloom render, undone straight after
  const saved = [];          // { mat, r, g, b } and { obj, visible }
  const savedVis = [];
  const black = new THREE.Color(0, 0, 0);
  let sceneBgSaved;

  function applyWeights() {
    const map = buildWeightMap(groupsFn(), weights);
    if (!warnedConflict) {
      const bad = materialConflicts(map);
      if (bad.length) {
        warnedConflict = true;
        console.warn(`[postfx] ${bad.length} material(s) shared across bloom groups — ` +
          'the weighted pass can only render one weight. Give them separate materials.', bad);
      }
    }
    const dflt = clampWeight(weights.effects);
    scene.traverse((obj) => {
      const mat = obj.material;
      if (!mat) return;
      const w = map.has(obj) ? map.get(obj) : dflt;
      if (w === 0) { savedVis.push(obj); obj.visible = false; return; }
      if (w === 1) return; // nothing to do — the common case, kept cheap
      const mats = Array.isArray(mat) ? mat : [mat];
      for (const m of mats) {
        if (!m.color) continue;
        saved.push({ mat: m, r: m.color.r, g: m.color.g, b: m.color.b });
        m.color.setRGB(m.color.r * w, m.color.g * w, m.color.b * w);
      }
    });
    sceneBgSaved = scene.background;
    scene.background = black; // the sky must not bloom
  }

  function restoreWeights() {
    for (const s of saved) s.mat.color.setRGB(s.r, s.g, s.b);
    saved.length = 0;
    for (const obj of savedVis) obj.visible = true;
    savedVis.length = 0;
    scene.background = sceneBgSaved;
  }

  return {
    render() {
      if (!enabled) { renderer.render(scene, camera); return; }
      if (groupsFn) applyWeights();
      bloomComposer.render();
      if (groupsFn) restoreWeights();
      // the PURE bloom, taken before UnrealBloomPass's additive blend
      addPass.uniforms.tBloom.value = bloom.renderTargetsHorizontal[0].texture;
      finalComposer.render();
    },
    setSize(w, h) {
      // ORDER MATTERS: composer.setSize() re-sizes EVERY pass (at device
      // pixels), which would clobber the bloom's scaled target — re-apply
      // the scaled bloom size AFTER it, and in DEVICE pixels too.
      bloomComposer.setSize(w, h);
      finalComposer.setSize(w, h);
      const b = bloomTargetSize(w, h, renderer.getPixelRatio(), o.scale);
      bloom.setSize(b.w, b.h);
    },
    setParams({ strength, radius, threshold } = {}) {
      if (strength !== undefined) bloom.strength = strength;
      if (radius !== undefined) bloom.radius = radius;
      if (threshold !== undefined) bloom.threshold = threshold;
    },
    setEnabled(v) { enabled = !!v; },
    get enabled() { return enabled; },
    // a pass AFTER the OutputPass, in display space (the cinematics' film
    // pass: letterbox, grain, titles). The composer renders its last
    // enabled pass to the screen, so appending is enough.
    addFinalPass(pass) { finalComposer.addPass(pass); },
    // fn() -> [[group, [roots]], ...], read fresh each frame so the caller
    // never has to tell us when its collections change.
    setGroups(fn) { groupsFn = typeof fn === 'function' ? fn : null; },
    weights,
    params: o,
  };
}
