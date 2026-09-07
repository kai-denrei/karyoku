// catalog.js — ONE list of what can stand on a plate, merged from two
// sources. The spec table (catalog-spec.js, generated from base-assets.md)
// is the master list: every id the generator may place is there, with its
// footprint. The base-kit manifest (assets/base-kit/manifest.json) attaches
// a FILE, sockets, colliders and animations to the rows that have been
// modelled. A row with no manifest entry is a PLACEHOLDER, drawn as a box
// of its footprint until the model lands — and then it stops being one
// without the generator noticing.
//
// Pure: no DOM, no three.js. The browser fetches the manifest and hands it
// here; the test reads it from disk and hands it here.
export const BASE_KIT_URL = 'assets/base-kit/';
export const CELL_M = 4;

// Placeholder box heights by section, metres. Walls match the kit's own
// collider (3.2 m); buildings read as buildings; ground pieces are slabs.
export const PLACEHOLDER_HEIGHT_M = {
  ground: 0.2, road: 0.2, perimeter: 3.2, defense: 3.0, command: 7.0,
  personnel: 5.0, logistics: 6.0, industry: 6.0, utility: 5.0, air: 4.0,
  field: 0.8, prop: 1.5, research: 5.5, assembly: 4.0,
};

// Placeholder colours by section — one hue per function so a plate reads
// as zones from the orbit camera before any model exists.
export const SECTION_COLOR = {
  ground: 0x3a3f47, road: 0x2a2e36, perimeter: 0x6b7583, defense: 0xc0392b,
  command: 0x7df9ff, personnel: 0x2ecc71, logistics: 0xf39c12, industry: 0xe67e22,
  utility: 0xf1c40f, air: 0x9b59b6, field: 0xff6b6b, prop: 0x95a5a6, research: 0x48dbfb, assembly: 0xffa94d,
};

// 'wall_standard_d2' -> { base: 'wall_standard', state: 2 }. An id with no
// suffix is its intact state.
export function splitId(id) {
  const m = /^(.*)_d([0-3])$/.exec(id);
  return m ? { base: m[1], state: Number(m[2]) } : { base: id, state: 0 };
}

// `extras` are more manifests of the same shape, each with the URL base its
// files live under — the NASA models are one. A later manifest wins a state
// an earlier one also names, so the kit's own model beats a stand-in. A
// state may carry `fit` ({ span, height } in metres): the model is scaled to
// sit inside that footprint rather than trusted at its authored size.
export function buildCatalog(spec, manifest, extras = []) {
  const cat = new Map();
  for (const row of spec) {
    cat.set(row.id, { ...row, placeholder: true, states: {} });
  }
  const sources = [[manifest, BASE_KIT_URL], ...extras.map((e) => [e.manifest, e.base])];
  for (const [m, base] of sources) {
    for (const a of (m && m.assets) || []) {
      const { base: id, state } = splitId(a.id);
      const entry = cat.get(id);
      if (!entry) continue; // a modelled asset the spec does not know: ignored, never placed
      entry.states[state] = {
        file: a.file,
        base,
        fit: a.fit || null,
        sockets: a.sockets || [],
        colliders: a.colliders || [],
        animations: a.animations || [],
        clearance: a.clearance || [],
      };
      entry.placeholder = false;
    }
  }
  return cat;
}
// every id the catalog can draw — what the generator may place
export const modelledIds = (cat) => new Set([...cat].filter(([, e]) => !e.placeholder).map(([id]) => id));
export const NASA_URL = 'assets/models/nasa/';
export const HOUSE_URL = 'assets/models/';
export const OUTPOST_URL = 'assets/outpost/';
export const ASSEMBLY_URL = 'assets/assembly/';
export const WAREHOUSE_URL = 'assets/warehouse/';
export const SOLAR_URL = 'assets/solar/';
export const TERRAFORMER_URL = 'assets/terraformer/';

// A body's box in metres from its intact model's first collider (the
// workshop authors one per prop), for the drive: the plot is the cell
// footprint, the collider is what the tank actually shoves.
export function bodyDims(cat) {
  const out = {};
  for (const [id, e] of cat) {
    const c = e.states[0] && e.states[0].colliders && e.states[0].colliders[0];
    if (c && c.size_m) out[id] = { w: c.size_m[0], h: c.size_m[1], d: c.size_m[2] };
  }
  return out;
}

// The fit for an entry's state, or null when the model is trusted as authored.
export function fitFor(entry, state = 0) {
  for (let s = state; s >= 0; s--) if (entry.states[s]) return entry.states[s].fit || null;
  return null;
}

// The file for an entry at a damage state, falling back down the ladder so
// a wall that only has D0 modelled still renders when asked for D3. Returns
// null for a placeholder.
export function fileFor(entry, state = 0) {
  for (let s = state; s >= 0; s--) {
    if (entry.states[s]) return (entry.states[s].base || BASE_KIT_URL) + entry.states[s].file;
  }
  return null;
}
