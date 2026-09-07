// fps.js — the frame counter in the nav, and the perf probe. Every tab's
// loop calls tickFps(now); once a second the nav shows the rate and
// window.__fps carries it for a probe. `?perf=1` logs the renderer's
// counts every two seconds: draw calls are what a big plate costs.
import { query } from './url.js?v=c43c648b';
let frames = 0, last = 0, fps = 0, el = null, perfAt = 0;
const perf = query().get('perf') === '1';
export function tickFps(now, renderer = null, scene = null) {
  frames++;
  // the composer renders several passes; autoReset would leave only the last one's counts
  if (renderer && perf && renderer.info.autoReset) renderer.info.autoReset = false;
  if (!last) last = now;
  if (now - last >= 1000) {
    fps = Math.round(frames * 1000 / (now - last));
    frames = 0; last = now;
    if (!el) el = document.getElementById('fps');
    if (el) el.textContent = `${fps} fps`;
    window.__fps = fps;
    if (perf && renderer && now - perfAt >= 2000) {
      perfAt = now;
      const r = renderer.info.render, m = renderer.info.memory;
      let objs = 0, inst = 0, lines = 0, skinned = 0, points = 0;
      if (scene) scene.traverse((o) => { if (o.visible === false) return; objs++; if (o.isInstancedMesh) inst++; if (o.isLineSegments) lines++; if (o.isSkinnedMesh) skinned++; if (o.isPoints) points++; });
      const groups = new Map();
      if (scene) scene.traverse((o) => { if (o.visible === false) return; let g = o; while (g.parent && g.parent !== scene && !g.name) g = g.parent; const k = g.name || g.type; groups.set(k, (groups.get(k) || 0) + 1); });
      const top = [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k}:${n}`).join(' ');
      console.log(`[perf] by group ${top}`);
      console.log(`[perf] fps=${fps} calls=${r.calls} tris=${r.triangles} lines=${r.lines} points=${r.points} geoms=${m.geometries} tex=${m.textures} progs=${renderer.info.programs.length} objs=${objs} instanced=${inst} lineSets=${lines} skinned=${skinned} pointSets=${points} dpr=${renderer.getPixelRatio()} size=${renderer.domElement.width}x${renderer.domElement.height}`);
      renderer.info.reset();
    }
  }
  return fps;
}
export const getFps = () => fps;
