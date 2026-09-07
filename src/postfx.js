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
  from './bloomweights.js?v=cd096da1';

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

// ONE SCENE RENDER, NOT TWO (karyoku, 2026-09-07). The reference rendered
// the scene twice a frame: once with every material's colour scaled by its
// group's weight (the bloom source) and once plain. On a 120-cell plate
// that doubled five thousand draw calls. Here the WEIGHT RIDES IN THE
// ALPHA CHANNEL of the one plain render: an opaque material's `opacity`
// is written to the target's alpha untouched (nothing blends an opaque
// draw), so opacity = weight costs nothing visible and the bloom source is
// simply rgb * alpha, one full-screen pass. Transparent materials cannot
// carry a weight this way (their alpha IS their blend), so they are set
// to leave the destination alpha alone and inherit the weight of whatever
// surface they are drawn over: a wall's edge glows like the wall, the
// tank's edges like the tank. Weights are applied once and re-applied
// every few dozen frames for objects that arrived since, not per frame.
const VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
// the bloom source: the scene times its weights
const WeightShader = {
  uniforms: { tBase: { value: null } },
  vertexShader: VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tBase;
    varying vec2 vUv;
    void main() { vec4 b = texture2D(tBase, vUv); gl_FragColor = vec4(b.rgb * b.a, 1.0); }
  `,
};
// base + pure bloom, in linear space, before OutputPass converts
const AddBloomShader = {
  uniforms: { tBase: { value: null }, tBloom: { value: null } },
  vertexShader: VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tBase;
    uniform sampler2D tBloom;
    varying vec2 vUv;
    void main() { gl_FragColor = vec4(texture2D(tBase, vUv).rgb + texture2D(tBloom, vUv).rgb, 1.0); }
  `,
};
const REAPPLY_EVERY = 30; // frames between weight sweeps for newly arrived objects

export function makeBloom(renderer, scene, camera, opts = {}) {
  const o = {
    // Softer and WIDER than it was, and biting much lower: a 0.85
    // threshold only ever caught the near-white highlights, so bloom read
    // as a rim on a few bright edges. At 0.2 it catches the body colours
    // too, which is why the strength has to come down to 0.3 — the same
    // total light, spread over far more of the frame.
    strength: 0.3, radius: 0.5, threshold: 0.2, enabled: true,
    // UnrealBloomPass builds a mip chain — halve it on phones
    // half resolution everywhere now, not only on phones: the bloom is a blur, and
    // the mip chain over a 1.5x retina frame was fragment work for nothing
    scale: 0.5,
    ...opts,
  };
  let enabled = o.enabled;
  const weights = { ...DEFAULT_BLOOM_WEIGHTS };
  let groupsFn = null;   // null => no weighting, i.e. the pre-change behaviour
  let warnedConflict = false;

  const size = renderer.getSize(new THREE.Vector2());
  const b0 = bloomTargetSize(size.x, size.y, renderer.getPixelRatio(), o.scale);

  // --- A: the one scene render, weights in alpha
  const baseComposer = new EffectComposer(renderer);
  baseComposer.renderToScreen = false;
  // EffectComposer's targets are created WITHOUT samples, so compositing
  // silently discards the renderer's antialias:true. On a wireframe board
  // that is the most visible side effect of adding a chain at all — ask
  // for MSAA back (samples survives setSize, so this is set once).
  baseComposer.renderTarget1.samples = 4;
  baseComposer.renderTarget2.samples = 4;
  baseComposer.addPass(new RenderPass(scene, camera));
  const baseTexture = () => baseComposer.readBuffer.texture; // a RenderPass never swaps

  // --- B: rgb * alpha -> bloom (pure bloom left in renderTargetsHorizontal[0])
  const bloomComposer = new EffectComposer(renderer);
  bloomComposer.renderToScreen = false;
  const weightPass = new ShaderPass(WeightShader, 'tNone'); // 'tNone': keep our own input texture
  bloomComposer.addPass(weightPass);
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(b0.w, b0.h), o.strength, o.radius, o.threshold);
  bloomComposer.addPass(bloom);

  // --- C: base + bloom -> screen
  const finalComposer = new EffectComposer(renderer);
  const addPass = new ShaderPass(AddBloomShader, 'tNone');
  finalComposer.addPass(addPass);
  // linear render targets -> without OutputPass the whole scene washes out
  finalComposer.addPass(new OutputPass());

  baseComposer.setSize(size.x, size.y);
  bloomComposer.setSize(size.x, size.y);
  finalComposer.setSize(size.x, size.y);

  // --- weighting: written into the materials, kept, swept every few frames
  let frame = 0;
  function applyWeights() {
    const map = buildWeightMap(groupsFn(), weights);
    if (!warnedConflict) {
      const bad = materialConflicts(map);
      if (bad.length) {
        warnedConflict = true;
        console.warn(`[postfx] ${bad.length} material(s) shared across bloom groups — ` +
          'alpha can carry one weight per material. Give them separate materials.', bad);
      }
    }
    const dflt = clampWeight(weights.effects);
    scene.traverse((obj) => {
      const mat = obj.material;
      if (!mat) return;
      const w = Math.min(1, map.has(obj) ? map.get(obj) : dflt);
      const mats = Array.isArray(mat) ? mat : [mat];
      for (const m of mats) {
        if (m.userData.bloomW === w) continue;
        m.userData.bloomW = w;
        if (m.transparent) {
          // keep the surface behind it as the weight: blend rgb, leave alpha
          if (m.blending === THREE.NormalBlending) {
            m.blending = THREE.CustomBlending;
            m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
            m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor;
            m.needsUpdate = true;
          }
          continue;
        }
        m.opacity = w;
      }
    });
  }

  return {
    render() {
      if (!enabled) { renderer.render(scene, camera); return; }
      if (groupsFn && frame++ % REAPPLY_EVERY === 0) applyWeights();
      baseComposer.render();
      weightPass.uniforms.tBase.value = baseTexture();
      bloomComposer.render();
      // the PURE bloom, taken before UnrealBloomPass's additive blend
      addPass.uniforms.tBase.value = baseTexture();
      addPass.uniforms.tBloom.value = bloom.renderTargetsHorizontal[0].texture;
      finalComposer.render();
    },
    setSize(w, h) {
      // ORDER MATTERS: composer.setSize() re-sizes EVERY pass (at device
      // pixels), which would clobber the bloom's scaled target — re-apply
      // the scaled bloom size AFTER it, and in DEVICE pixels too.
      baseComposer.setSize(w, h);
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
    setGroups(fn) { groupsFn = typeof fn === 'function' ? fn : null; frame = 0; },
    weights,
    params: o,
  };
}
