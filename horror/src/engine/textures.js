import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Procedural PBR texture factory — English Victorian interior.
//
// Everything is generated on canvases at load time so the game ships with zero
// binary assets. The library covers a real house: damask and flock papers,
// oak wainscot, block parquet, marble, quarry tile, glazed and common brick,
// flagstone, book spines, rugs, fabric — plus skin, cloth and hair for the
// cast.
//
// Two things keep the bake affordable:
//   * `field()` caches the expensive fbm base fields, so the six papers share
//     one plaster substrate and the four timbers share one grain field
//     instead of each recomputing it per pixel.
//   * `buildTextureLibrary()` is async and yields to the browser between
//     surfaces, so the loading screen keeps painting instead of freezing.
// ---------------------------------------------------------------------------

const PERM = new Uint8Array(512);
(function seedPermutation() {
  let seed = 1337;
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) base[i] = i;
  for (let i = 255; i > 0; i -= 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    const tmp = base[i];
    base[i] = base[j];
    base[j] = tmp;
  }
  for (let i = 0; i < 512; i += 1) PERM[i] = base[i & 255];
})();

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const TAU = Math.PI * 2;

function grad(hash, x, y) {
  switch (hash & 3) {
    case 0: return x + y;
    case 1: return -x + y;
    case 2: return x - y;
    default: return -x - y;
  }
}

// Tiling value/perlin hybrid. `period` keeps the result seamless.
export function noise2D(x, y, period = 256) {
  const wrap = (v) => ((v % period) + period) % period;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const x0 = wrap(xi);
  const y0 = wrap(yi);
  const x1 = wrap(xi + 1);
  const y1 = wrap(yi + 1);
  const u = fade(xf);
  const v = fade(yf);
  const aa = PERM[(PERM[x0 & 255] + y0) & 255];
  const ba = PERM[(PERM[x1 & 255] + y0) & 255];
  const ab = PERM[(PERM[x0 & 255] + y1) & 255];
  const bb = PERM[(PERM[x1 & 255] + y1) & 255];
  return lerp(
    lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
    lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u),
    v
  );
}

export function fbm(x, y, octaves = 5, period = 256) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += noise2D(x * freq, y * freq, period * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/** Deterministic per-id hash in 0..1 — used for tile/brick/plank variance. */
function hash1(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** 1 inside `inner`, ramping to 0 at `outer`. The workhorse for motif edges. */
function band(d, inner, outer) {
  if (d <= inner) return 1;
  if (d >= outer) return 0;
  return 1 - (d - inner) / (outer - inner);
}

function makeCanvas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function toTexture(canvas, { srgb = false, repeat = 1 } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 8;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Convert a height field (Float32Array, size*size, values 0..1) into a
 * tangent-space normal map texture.
 */
function heightToNormal(height, size, strength = 2.2) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx;
      let ny = -dy;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const idx = (y * size + x) * 4;
      image.data[idx] = (nx * 0.5 + 0.5) * 255;
      image.data[idx + 1] = (ny * 0.5 + 0.5) * 255;
      image.data[idx + 2] = (nz * 0.5 + 0.5) * 255;
      image.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return toTexture(canvas);
}

function writeGray(values, size) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i += 1) {
    const v = Math.max(0, Math.min(255, Math.round(values[i] * 255)));
    image.data[i * 4] = v;
    image.data[i * 4 + 1] = v;
    image.data[i * 4 + 2] = v;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return toTexture(canvas);
}

// --- shared base fields -----------------------------------------------------
//
// An fbm sample is by far the most expensive thing in this file. Every paper
// wants the same plaster substrate and every timber the same grain, so each
// field is computed once and sampled by index from then on.

const FIELDS = new Map();

function field(key, size, fn) {
  const id = `${key}@${size}`;
  const cached = FIELDS.get(id);
  if (cached) return cached;
  const values = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) values[y * size + x] = fn(x, y);
  }
  FIELDS.set(id, values);
  return values;
}

/** Damp, cracked, peeling plaster — the substrate under every wall covering. */
function plasterFields(size) {
  return {
    base: field('plaster.base', size, (x, y) => fbm(x * 0.014, y * 0.014, 6) * 0.5 + 0.5),
    fine: field('plaster.fine', size, (x, y) => fbm(x * 0.12, y * 0.12, 3) * 0.5 + 0.5),
    stain: field('plaster.stain', size, (x, y) => (
      Math.pow(Math.max(0, fbm(x * 0.006 + 40, y * 0.006 - 12, 4) * 0.5 + 0.5), 2.2)
    )),
    peel: field('plaster.peel', size, (x, y) => fbm(x * 0.009 - 80, y * 0.009 + 33, 4) * 0.5 + 0.5),
    crack: field('plaster.crack', size, (x, y) => {
      const main = Math.abs(fbm(x * 0.013 + 200, y * 0.013 - 90, 4));
      const branch = Math.abs(fbm(x * 0.031 - 15, y * 0.031 + 61, 3));
      return Math.max(main < 0.022 ? 1 - main / 0.022 : 0, branch < 0.016 ? 0.55 : 0);
    }),
    grime: field('plaster.grime', size, (x, y) => fbm(x * 0.02, y * 0.02, 4) * 0.5 + 0.5),
  };
}

/** Sawn timber: curving growth rings plus wear. Shared by every wood surface. */
function timberFields(size) {
  return {
    warp: field('timber.warp', size, (x, y) => fbm(x * 0.02 + 11, y * 0.02 - 4, 3)),
    fibre: field('timber.fibre', size, (x, y) => fbm(x * 0.09, y * 0.012, 5) * 0.5 + 0.5),
    wear: field('timber.wear', size, (x, y) => fbm(x * 0.02, y * 0.02, 4) * 0.5 + 0.5),
  };
}

// --- surface scaffold -------------------------------------------------------

/**
 * Runs `fn(x, y, i, out)` over every texel and packages the result as a PBR
 * set. `out` is reused between texels, so a generator writes colour in
 * `out.r/g/b` (0..1), displacement in `out.h`, and `out.rough` / `out.metal`.
 */
function surface(size, opts, fn) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const data = image.data;
  const height = new Float32Array(size * size);
  const rough = new Float32Array(size * size);
  const metal = opts.metal ? new Float32Array(size * size) : null;
  const out = { r: 0, g: 0, b: 0, h: 0, rough: 0.8, metal: 0 };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      out.h = 0; out.rough = 0.8; out.metal = 0;
      fn(x, y, i, out);
      const idx = i * 4;
      data[idx] = clamp01(out.r) * 255;
      data[idx + 1] = clamp01(out.g) * 255;
      data[idx + 2] = clamp01(out.b) * 255;
      data[idx + 3] = 255;
      height[i] = out.h;
      rough[i] = out.rough;
      if (metal) metal[i] = out.metal;
    }
  }
  ctx.putImageData(image, 0, 0);

  const result = {
    map: toTexture(canvas, { srgb: true, repeat: opts.repeat ?? 1 }),
    normalMap: heightToNormal(height, size, opts.normalStrength ?? 2.2),
    roughnessMap: writeGray(rough, size),
  };
  if (metal) result.metalnessMap = writeGray(metal, size);
  return result;
}

/** Multiply a linear tint into `out`, given a single scalar shade. */
function tinted(out, shade, tint) {
  out.r = shade * tint[0];
  out.g = shade * tint[1];
  out.b = shade * tint[2];
}

// --- wall coverings ---------------------------------------------------------

/**
 * A damask motif inside a unit cell, mirrored about the vertical axis.
 * Every damask is the same three elements: an ogee frame, a palmette on the
 * axis, and scrolling leaves in the shoulders. Returns 0..1 coverage.
 */
function damaskMotif(u, v) {
  const mu = Math.abs(u - 0.5) * 2;         // 0 on the axis, 1 at the cell edge
  let m = 0;

  // ogee frame — a pointed oval that swells at mid-height
  const halfWidth = Math.pow(Math.sin(Math.PI * v), 0.75) * 0.94;
  m = Math.max(m, band(Math.abs(mu - halfWidth), 0.05, 0.10));

  // central palmette
  const dx = (u - 0.5) * 2.3;
  const dy = (v - 0.5) * 1.7;
  const r = Math.hypot(dx, dy);
  const theta = Math.atan2(dy, dx);
  const lobe = 0.30 + 0.10 * Math.cos(theta * 5) + 0.045 * Math.cos(theta * 10);
  m = Math.max(m, band(r - lobe, 0, 0.035));

  // stem running down the axis out of the palmette
  if (v > 0.5) m = Math.max(m, band(mu, 0.035, 0.075) * band(v - 0.86, 0, 0.10));

  // shoulder scrolls, one either side, mirrored by construction
  [0.28, 0.72].forEach((cv) => {
    const sx = mu - 0.46;
    const sy = (v - cv) * 2.3;
    const sr = Math.hypot(sx, sy);
    m = Math.max(m, band(Math.abs(sr - 0.17), 0.02, 0.055));
  });

  return m;
}

/** A sprig of leaves on a diagonal grid — the cheaper bedroom papers. */
function floralMotif(u, v) {
  const dx = (u - 0.5) * 2.0;
  const dy = (v - 0.5) * 2.0;
  const r = Math.hypot(dx, dy);
  const theta = Math.atan2(dy, dx);
  // five-petal rosette
  const petal = 0.30 + 0.17 * Math.abs(Math.cos(theta * 2.5));
  let m = band(r - petal, 0, 0.05);
  m = Math.max(m, band(Math.abs(r - 0.09), 0.02, 0.04));   // calyx ring
  // two leaves on a stem
  [[-0.42, 0.34], [0.42, 0.34]].forEach(([lx, ly]) => {
    const ex = (dx - lx) * 2.6;
    const ey = (dy - ly) * 1.1;
    m = Math.max(m, band(Math.hypot(ex, ey) - 0.30, 0, 0.06));
  });
  return m;
}

/**
 * Papered wall. `motif` draws the pattern, `cells` sets the repeat, and the
 * pattern is carried by *sheen* as much as colour — which is what a real
 * damask or flock does, and what makes it come alive under a moving torch.
 */
function paperedWall(size, opts) {
  const f = plasterFields(size);
  const {
    ground, pattern, cells = 3, motif = damaskMotif, dropped = true,
    raise = 0.5, sheen = 0.42, damp = 0.8, plaster: plasterTint = [0.62, 0.57, 0.5],
  } = opts;

  return surface(size, { normalStrength: 1.9 }, (x, y, i, out) => {
    const base = f.base[i];
    const fine = f.fine[i];
    const stain = f.stain[i];
    const peel = f.peel[i];
    const crack = f.crack[i];

    // cell coordinates; a half-drop repeat staggers alternate columns
    const cell = size / cells;
    const cx = Math.floor(x / cell);
    const vOffset = dropped && cx % 2 ? 0.5 : 0;
    const u = (x % cell) / cell;
    const v = ((y / cell) + vOffset) % 1;
    const m = motif(u, v);

    // paper torn away in patches, exposing the plaster underneath
    const torn = peel > 0.605 ? 1 : 0;
    const curl = peel > 0.585 && peel <= 0.605 ? 1 : 0;

    if (torn) {
      let shade = 0.52 + base * 0.30 + fine * 0.12;
      shade *= 1 - stain * damp * 0.7;
      shade *= 1 - crack * 0.6;
      tinted(out, shade, plasterTint);
      out.h = base * 0.5 + fine * 0.2 - crack * 0.8 - 0.35;
      out.rough = 0.88 + fine * 0.1;
      return;
    }

    // paper: ground colour, motif lifted slightly in value and a lot in sheen
    const mix = m;
    out.r = lerp(ground[0], pattern[0], mix);
    out.g = lerp(ground[1], pattern[1], mix);
    out.b = lerp(ground[2], pattern[2], mix);

    const soil = 0.80 + base * 0.28;
    const water = stain * damp;
    out.r *= soil * (1 - water * 0.55);
    out.g *= soil * (1 - water * 0.62);
    out.b *= soil * (1 - water * 0.70);      // damp goes yellow-brown, not grey
    if (curl) { out.r *= 0.55; out.g *= 0.52; out.b *= 0.5; }

    out.h = base * 0.25 + m * raise + (curl ? 0.5 : 0);
    // flock/silk motif is smoother than the matte ground — this is the pattern
    // you actually read at a glance when the flashlight sweeps across it
    out.rough = (0.86 - m * sheen) + fine * 0.08 - water * 0.28;
  });
}

/** Plain lime plaster, no covering — service rooms and outbuildings. */
function plaster(size, tint, damp) {
  const f = plasterFields(size);
  return surface(size, { normalStrength: 1.8 }, (x, y, i, out) => {
    const base = f.base[i];
    const fine = f.fine[i];
    const stain = f.stain[i];
    const peeled = f.peel[i] > 0.58 ? 1 : 0;
    const cracked = f.crack[i];
    let shade = 0.55 + base * 0.3 + fine * 0.12;
    shade *= 1 - stain * damp * 0.75;
    if (peeled) shade *= 0.62;
    shade *= 1 - cracked * 0.62;
    tinted(out, shade, tint);
    out.h = base * 0.6 + fine * 0.25 - peeled * 0.35 - cracked * 0.8;
    out.rough = 0.72 + fine * 0.2 - stain * damp * 0.35 + cracked * 0.2;
  });
}

/**
 * Stile-and-rail oak wainscot. Each cell is one panel: a flat frame around a
 * bevelled, recessed field, with the grain running along each member.
 */
function oakPanel(size, tint) {
  const t = timberFields(size);
  const cells = 2;
  const cell = size / cells;
  const stile = 0.17;              // frame width as a fraction of the panel

  return surface(size, { normalStrength: 3.0 }, (x, y, i, out) => {
    const u = (x % cell) / cell;
    const v = (y % cell) / cell;
    const panelId = Math.floor(x / cell) * 17 + Math.floor(y / cell) * 31;

    const du = Math.min(u, 1 - u);
    const dv = Math.min(v, 1 - v);
    const edge = Math.min(du, dv);
    const onFrame = edge < stile;
    const bevel = clamp01((edge - stile) / 0.075);      // 0 at the frame, 1 in the field

    // grain runs vertically in the stiles, horizontally in the rails and field
    const vertical = onFrame && du < dv;
    const along = vertical ? y / size : x / size;
    const across = vertical ? x / size : y / size;
    const warp = t.warp[i] * 1.8;
    const rings = Math.abs(Math.sin(along * 30 + warp * 6 + panelId * 0.7));
    const grain = rings * 0.6 + t.fibre[i] * 0.4;
    const wear = t.wear[i];

    let shade = 0.40 + grain * 0.30;
    shade *= 0.74 + wear * 0.38;
    if (onFrame) shade *= 1.06;                        // proud members catch light
    else shade *= 0.80 + bevel * 0.16;                 // recessed field sits darker
    // a dark line in the quirk where field meets frame
    if (!onFrame && bevel < 0.12) shade *= 0.55 + bevel * 3.5;
    void across;

    tinted(out, shade, tint);
    out.h = (onFrame ? 1.0 : 0.34 + bevel * 0.30) + rings * 0.10;
    // waxed oak: polished on the frame, duller in the recess where nobody wipes
    out.rough = 0.52 - rings * 0.05 + (onFrame ? 0 : 0.16) + (1 - wear) * 0.12;
  });
}

// --- floors -----------------------------------------------------------------

function woodPlanks(size, tint) {
  const t = timberFields(size);
  return surface(size, { normalStrength: 2.6 }, (x, y, i, out) => {
    const plank = size / 8;
    const row = Math.floor(y / plank);
    const offset = (row % 2) * plank * 0.5;
    const px = (x + offset) % size;
    const along = px / size;
    const seam = Math.min(y % plank, plank - (y % plank)) / plank;
    const boardSeam = Math.min(px % (plank * 2), plank * 2 - (px % (plank * 2))) / (plank * 2);
    const warp = t.warp[i] * 1.9;
    const rings = Math.abs(Math.sin(along * 26 + warp * 6 + row * 2.1));
    const grain = rings * 0.62 + t.fibre[i] * 0.38;
    const knot = Math.max(0, 1 - Math.hypot(
      ((px % (plank * 2)) - plank) / plank,
      ((y % plank) - plank * 0.5) / (plank * 0.5)
    ) * 1.7);
    const wear = t.wear[i];

    let shade = 0.45 + grain * 0.32 + knot * 0.18;
    shade *= 0.72 + wear * 0.4;
    if (seam < 0.06) shade *= 0.25 + seam * 6;
    if (boardSeam < 0.02) shade *= 0.35 + boardSeam * 20;
    tinted(out, shade, tint);

    out.h = shade * 0.55 + (seam < 0.06 ? -0.6 : 0) + rings * 0.42;
    const traffic = Math.max(0, 1 - Math.abs((y % (plank * 4)) / (plank * 4) - 0.5) * 3.4);
    out.rough = 0.72 - traffic * 0.34 + (1 - wear) * 0.18 - rings * 0.06;
  });
}

/**
 * Block parquet: squares of narrow fingers, grain alternating like a
 * chessboard. Standard Victorian work for a hall or a library, and it reads
 * instantly as *not* a plain floorboard.
 */
function parquet(size, tint) {
  const t = timberFields(size);
  const cells = 6;
  const cell = size / cells;
  const fingers = 4;

  return surface(size, { normalStrength: 2.8 }, (x, y, i, out) => {
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const turned = (cx + cy) % 2 === 0;
    const u = (x % cell) / cell;
    const v = (y % cell) / cell;

    // within a block the grain runs along one axis; fingers split the other
    const along = turned ? u : v;
    const across = turned ? v : u;
    const fingerId = Math.floor(across * fingers);
    const inFinger = (across * fingers) % 1;
    const fingerSeam = Math.min(inFinger, 1 - inFinger);
    const blockSeam = Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v));

    const id = cx * 41 + cy * 7 + fingerId * 3;
    const warp = t.warp[i] * 1.6;
    const rings = Math.abs(Math.sin(along * 34 + warp * 5 + id * 1.7));
    const grain = rings * 0.58 + t.fibre[i] * 0.42;
    const wear = t.wear[i];
    const tone = 0.86 + hash1(id) * 0.28;              // block-to-block colour

    let shade = (0.42 + grain * 0.30) * tone;
    shade *= 0.76 + wear * 0.34;
    if (fingerSeam < 0.035) shade *= 0.34 + fingerSeam * 18;
    if (blockSeam < 0.018) shade *= 0.28 + blockSeam * 38;

    tinted(out, shade, tint);
    out.h = 0.5 + rings * 0.28 - (fingerSeam < 0.035 ? 0.55 : 0) - (blockSeam < 0.018 ? 0.7 : 0);
    // wax polish: bright where feet travel, dull and dusty in the corners
    out.rough = 0.42 + (1 - wear) * 0.30 - rings * 0.05;
  });
}

/** Polished marble chequer — the entrance hall floor of every manor. */
function marbleCheck(size, light, dark) {
  const veins = field('marble.vein', size, (x, y) => (
    Math.abs(fbm(x * 0.010 + 5, y * 0.016 - 21, 5))
  ));
  const drift = field('marble.drift', size, (x, y) => fbm(x * 0.004 - 60, y * 0.004 + 9, 3));
  const cells = 8;
  const cell = size / cells;

  return surface(size, { normalStrength: 1.1 }, (x, y, i, out) => {
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const white = (cx + cy) % 2 === 0;
    const u = (x % cell) / cell;
    const v = (y % cell) / cell;
    const joint = Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v));

    const tint = white ? light : dark;
    // veining: thin ridges of a warped field, brighter on dark stone
    const vein = band(veins[i], 0.006, 0.05) * (0.55 + hash1(cx * 13 + cy * 7) * 0.5);
    const cloud = drift[i] * 0.5 + 0.5;
    let shade = 0.74 + cloud * 0.22;
    const veinLift = white ? -0.28 : 0.55;
    shade *= 1 + vein * veinLift;

    tinted(out, shade, tint);
    if (joint < 0.012) {                                 // grout
      out.r *= 0.30; out.g *= 0.30; out.b *= 0.32;
      out.h = 0.05;
      out.rough = 0.85;
      return;
    }
    out.h = 0.6 + vein * 0.06;
    // polished stone, dulled a little where it has been walked
    out.rough = 0.11 + cloud * 0.10 + vein * 0.05;
  });
}

/** Plain veined marble for chimneypieces and sills. */
function marbleSlab(size, tint) {
  const veins = field('marble.slabvein', size, (x, y) => (
    Math.abs(fbm(x * 0.008 + 71, y * 0.013 - 40, 5))
  ));
  const drift = field('marble.drift', size, (x, y) => fbm(x * 0.004 - 60, y * 0.004 + 9, 3));
  return surface(size, { normalStrength: 0.9 }, (x, y, i, out) => {
    const vein = band(veins[i], 0.004, 0.042);
    const fine = band(veins[i], 0.05, 0.09) * 0.35;
    const cloud = drift[i] * 0.5 + 0.5;
    const shade = (0.80 + cloud * 0.18) * (1 - (vein + fine) * 0.42);
    tinted(out, shade, tint);
    out.h = 0.6 - vein * 0.08;
    out.rough = 0.10 + cloud * 0.08;
  });
}

/** Unglazed red quarry tile — the kitchen and scullery floor. */
function quarryTile(size, tint) {
  const f = plasterFields(size);
  const cells = 7;
  const cell = size / cells;
  return surface(size, { normalStrength: 2.6 }, (x, y, i, out) => {
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const u = (x % cell) / cell;
    const v = (y % cell) / cell;
    const joint = Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v));
    const id = cx * 23 + cy * 47;
    const tone = 0.82 + hash1(id) * 0.34;
    const grime = f.grime[i];
    const bevel = clamp01((joint - 0.03) / 0.05);

    if (joint < 0.03) {                                  // sandy mortar
      const m = 0.46 + f.fine[i] * 0.22 - grime * 0.2;
      tinted(out, m, [0.72, 0.68, 0.6]);
      out.h = 0.12;
      out.rough = 0.94;
      return;
    }
    let shade = (0.52 + f.base[i] * 0.16) * tone;
    shade *= 1 - grime * 0.26;
    shade *= 0.86 + bevel * 0.14;
    tinted(out, shade, tint);
    out.h = 0.5 + bevel * 0.34;
    // unglazed but sealed and scrubbed for fifty years
    out.rough = 0.55 + grime * 0.30 - bevel * 0.06;
  });
}

/**
 * Irregular stone flags via a jittered Worley cell. The feature point of each
 * cell is looked up through a wrapped index, so the field tiles seamlessly
 * even though the cells themselves are irregular.
 */
function flagstone(size, tint) {
  const f = plasterFields(size);
  const cells = 5;
  const cell = size / cells;
  /** Jitter of a cell, in cell-local 0..1, wrapped so the pattern tiles. */
  const jitter = (cx, cy) => {
    const wx = ((cx % cells) + cells) % cells;
    const wy = ((cy % cells) + cells) % cells;
    const h = wx * 37 + wy * 91;
    return [0.18 + hash1(h) * 0.64, 0.18 + hash1(h + 5) * 0.64];
  };

  return surface(size, { normalStrength: 2.4 }, (x, y, i, out) => {
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    let best = 1e9;
    let second = 1e9;
    let bestId = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const [jx, jy] = jitter(cx + dx, cy + dy);
        const px = (cx + dx + jx) * cell;
        const py = (cy + dy + jy) * cell;
        const d = Math.hypot(x - px, y - py);
        if (d < best) {
          second = best;
          best = d;
          bestId = (((cx + dx) % cells) + cells) % cells * 71 + (((cy + dy) % cells) + cells) % cells * 13;
        } else if (d < second) second = d;
      }
    }
    const joint = second - best;                        // 0 on the cell boundary
    const tone = 0.80 + hash1(bestId) * 0.38;
    const grime = f.grime[i];

    if (joint < cell * 0.05) {
      const m = 0.34 + f.fine[i] * 0.18;
      tinted(out, m, [0.6, 0.58, 0.54]);
      out.h = 0.1;
      out.rough = 0.95;
      return;
    }
    const wearIn = clamp01((joint - cell * 0.05) / (cell * 0.18));
    let shade = (0.46 + f.base[i] * 0.24) * tone;
    shade *= 1 - grime * 0.24;
    tinted(out, shade, tint);
    out.h = 0.35 + wearIn * 0.45 + f.fine[i] * 0.08;
    // worn smooth in the middle of each flag, rough at the edges
    out.rough = 0.88 - wearIn * 0.26 + grime * 0.1;
  });
}

function tiles(size, tint) {
  const f = plasterFields(size);
  const cell = size / 6;
  return surface(size, { normalStrength: 3.4 }, (x, y, i, out) => {
    const gx = Math.min(x % cell, cell - (x % cell)) / cell;
    const gy = Math.min(y % cell, cell - (y % cell)) / cell;
    const grout = Math.min(gx, gy);
    const id = Math.floor(x / cell) * 31 + Math.floor(y / cell) * 17;
    const variance = hash1(id);
    const grime = f.grime[i];
    const crack = Math.abs(fbm(x * 0.05 + 9, y * 0.05 - 3, 3));
    const bevel = clamp01((grout - 0.05) / 0.06);
    let shade = 0.68 + variance * 0.12 - grime * 0.28;
    if (crack < 0.02) shade *= 0.45;
    if (grout < 0.05) shade *= 0.32;
    else shade *= 0.82 + bevel * 0.18;
    tinted(out, shade, tint);
    out.h = grout < 0.05 ? 0.05 : 0.42 + bevel * 0.42 + grime * 0.08;
    out.rough = grout < 0.05 ? 0.85 : 0.18 + grime * 0.45;
  });
}

// --- masonry ----------------------------------------------------------------

/**
 * Running-bond brick. `glazed` switches between white glazed kitchen brick
 * (smooth, crazed) and common red stock (rough, chipped, efflorescent).
 */
function brick(size, tint, { glazed = false, courses = 8 } = {}) {
  const f = plasterFields(size);
  const crazeField = glazed
    ? field('brick.craze', size, (x, y) => Math.abs(fbm(x * 0.09 + 3, y * 0.09 - 7, 3)))
    : null;
  const courseH = size / courses;
  const brickW = courseH * 2.2;

  return surface(size, { normalStrength: glazed ? 2.0 : 3.2 }, (x, y, i, out) => {
    const course = Math.floor(y / courseH);
    const offset = (course % 2) * brickW * 0.5;
    const bx = (x + offset) % size;
    const id = course * 53 + Math.floor(bx / brickW) * 13;

    const inY = (y % courseH) / courseH;
    const inX = (bx % brickW) / brickW;
    const mortar = Math.min(
      Math.min(inY, 1 - inY) * (courseH / 5.5),
      Math.min(inX, 1 - inX) * (brickW / 5.5)
    );

    if (mortar < 1) {                                    // struck mortar joint
      const wet = f.stain[i];
      const m = (glazed ? 0.34 : 0.42) + f.fine[i] * 0.2 - wet * 0.18;
      tinted(out, m, glazed ? [0.45, 0.46, 0.48] : [0.68, 0.64, 0.55]);
      out.h = 0.08 + mortar * 0.1;
      out.rough = 0.95;
      return;
    }

    const tone = 0.80 + hash1(id) * 0.40;
    const face = f.base[i];
    const grime = f.grime[i];
    const bevel = clamp01((mortar - 1) / 3);

    if (glazed) {
      // white glazed brick: near-white, very smooth, with a fine crackle
      const craze = crazeField[i] < 0.012 ? 1 : 0;
      let shade = (0.86 + face * 0.10) * (0.94 + hash1(id) * 0.10);
      shade *= 1 - grime * 0.22 - craze * 0.18;
      tinted(out, shade, tint);
      out.h = 0.55 + bevel * 0.2 - craze * 0.35;
      out.rough = 0.13 + grime * 0.4 + craze * 0.2;
      return;
    }

    // common stock: colour varies brick to brick, edges chipped, salt bloom
    const chip = hash1(id + 3) > 0.86 && mortar < 3.5 ? 1 : 0;
    const bloom = Math.pow(Math.max(0, f.stain[i]), 1.3);
    let shade = (0.44 + face * 0.26) * tone;
    shade *= 1 - grime * 0.20;
    out.r = shade * tint[0] + bloom * 0.30;
    out.g = shade * tint[1] + bloom * 0.30;
    out.b = shade * tint[2] + bloom * 0.32;
    if (chip) { out.r *= 0.72; out.g *= 0.70; out.b *= 0.68; }
    out.h = 0.5 + bevel * 0.28 + face * 0.12 - chip * 0.4;
    out.rough = 0.86 + grime * 0.1 - bloom * 0.1;
  });
}

function concrete(size, tint) {
  const f = plasterFields(size);
  const agg = field('concrete.agg', size, (x, y) => fbm(x * 0.28, y * 0.28, 2) * 0.5 + 0.5);
  const pit = field('concrete.pit', size, (x, y) => (
    Math.pow(Math.max(0, fbm(x * 0.16, y * 0.16, 2) * 0.5 + 0.5), 6)
  ));
  return surface(size, { normalStrength: 2.4 }, (x, y, i, out) => {
    const base = f.base[i];
    const pits = pit[i];
    const wet = Math.pow(Math.max(0, f.stain[i]), 0.8);
    const stone = agg[i];
    const aggregate = stone > 0.74 ? (stone - 0.74) * 3.2 : 0;
    const shutter = Math.abs(((y % 96) / 96) - 0.5) > 0.482 ? 1 : 0;
    let shade = 0.42 + base * 0.26 - pits * 0.3 + aggregate * 0.34;
    shade *= 1 - wet * 0.35;
    shade *= 1 - shutter * 0.30;
    tinted(out, shade, tint);
    out.h = base * 0.7 - pits * 0.6 + aggregate * 0.4 - shutter * 0.5;
    out.rough = 0.86 - wet * 0.6 + pits * 0.1 - aggregate * 0.25;
  });
}

function rustedMetal(size, tint) {
  const rustField = field('metal.rust', size, (x, y) => (
    Math.pow(Math.max(0, fbm(x * 0.018, y * 0.018, 5) * 0.5 + 0.5), 1.4)
  ));
  const scratchField = field('metal.scratch', size, (x, y) => Math.abs(fbm(x * 0.4, y * 0.02, 2)));
  return surface(size, { normalStrength: 2.0, metal: true }, (x, y, i, out) => {
    const rust = rustField[i];
    const scratch = scratchField[i];
    const shade = 0.32 + scratch * 0.2;
    out.r = shade * tint[0] + rust * 0.42;
    out.g = shade * tint[1] + rust * 0.18;
    out.b = shade * tint[2] + rust * 0.07;
    out.h = rust * 0.5 + scratch * 0.3;
    out.rough = 0.26 + rust * 0.62;
    out.metal = 1 - rust * 0.85;
  });
}

// --- furnishings ------------------------------------------------------------

/**
 * A run of book spines. Widths, heights and colours all vary, some volumes
 * lean, some slots are empty — which is the whole reason a bookcase reads as
 * a library rather than a striped box.
 */
function bookSpines(size) {
  const f = plasterFields(size);
  const PALETTE = [
    [0.30, 0.10, 0.09], [0.14, 0.20, 0.13], [0.28, 0.22, 0.12],
    [0.10, 0.12, 0.22], [0.34, 0.28, 0.20], [0.19, 0.09, 0.13],
    [0.24, 0.16, 0.08], [0.12, 0.16, 0.17],
  ];
  // lay out the run once so every texel agrees on where each book sits
  const books = [];
  for (let s = 0; s < size;) {
    const id = books.length;
    const w = 9 + Math.floor(hash1(id * 3.1) * 22);
    const gap = hash1(id * 7.7) > 0.90;                 // a missing volume
    books.push({
      x: s, w, gap,
      top: 0.06 + hash1(id * 2.3) * 0.16,               // shorter/taller books
      colour: PALETTE[Math.floor(hash1(id * 5.9) * PALETTE.length) % PALETTE.length],
      lean: (hash1(id * 11.3) > 0.9 ? (hash1(id * 4.1) - 0.5) * 0.16 : 0),
      bands: 1 + Math.floor(hash1(id * 13.7) * 3),
    });
    s += w;
  }

  return surface(size, { normalStrength: 2.6 }, (x, y, i, out) => {
    const v = y / size;
    let book = books[books.length - 1];
    for (let b = 0; b < books.length; b += 1) {
      if (x >= books[b].x && x < books[b].x + books[b].w) { book = books[b]; break; }
    }
    const shelfShadow = clamp01((v - 0.86) / 0.14);
    const lean = book.lean * (1 - v);
    const u = (x - book.x) / book.w + lean;

    if (book.gap || v < book.top || u < 0.04 || u > 0.96) {
      // the dark of the shelf behind
      const d = 0.05 + f.fine[i] * 0.04;
      tinted(out, d, [1, 0.96, 0.9]);
      out.h = 0;
      out.rough = 0.95;
      return;
    }

    const c = book.colour;
    const edge = Math.min(u - 0.04, 0.96 - u) / 0.14;
    const round = 0.72 + clamp01(edge) * 0.34;          // spines are curved
    const scuff = 0.86 + f.base[i] * 0.26;
    let r = c[0] * round * scuff;
    let g = c[1] * round * scuff;
    let b = c[2] * round * scuff;

    // gilt bands and a title block near the top of the spine
    const yy = (v - book.top) / (1 - book.top);
    let gilt = 0;
    for (let k = 0; k < book.bands; k += 1) {
      const at = 0.16 + k * 0.14;
      gilt = Math.max(gilt, band(Math.abs(yy - at), 0.006, 0.016));
    }
    if (yy > 0.26 && yy < 0.40 && u > 0.2 && u < 0.8) {
      gilt = Math.max(gilt, hash1(Math.floor(yy * 90) + book.x) > 0.55 ? 0.7 : 0);
    }
    r = lerp(r, 0.62, gilt); g = lerp(g, 0.50, gilt); b = lerp(b, 0.20, gilt);

    const dark = 1 - shelfShadow * 0.55;
    out.r = r * dark; out.g = g * dark; out.b = b * dark;
    out.h = 0.45 + clamp01(edge) * 0.4 + gilt * 0.12;
    out.rough = 0.62 - gilt * 0.35 + f.fine[i] * 0.12;
  });
}

/**
 * A Persian carpet: guard stripes, a bordered main band, a lobed central
 * medallion and corner spandrels, worn thin down the middle.
 */
function persianRug(size) {
  const f = plasterFields(size);
  const GROUND = [0.34, 0.08, 0.07];      // madder red
  const BORDER = [0.07, 0.10, 0.21];      // indigo
  const IVORY = [0.62, 0.56, 0.42];
  const GOLD = [0.46, 0.34, 0.11];

  return surface(size, { normalStrength: 1.5 }, (x, y, i, out) => {
    const u = x / size;
    const v = y / size;
    const edge = Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v));

    let col = GROUND;
    let motif = 0;

    if (edge < 0.045) col = BORDER;                                 // outer guard
    else if (edge < 0.065) col = IVORY;
    else if (edge < 0.155) {
      col = BORDER;                                                 // main border
      // a repeating rosette along the band
      const t = (edge < 0.155 && (u < 0.155 || u > 0.845)) ? v : u;
      const rep = (t * 14) % 1;
      motif = band(Math.abs(rep - 0.5) - 0.16, 0, 0.10);
    } else if (edge < 0.175) col = IVORY;
    else {
      // the field: medallion, spandrels, and a scattered herati fill
      const dx = (u - 0.5) * 2.6;
      const dy = (v - 0.5) * 1.9;
      const r = Math.hypot(dx, dy);
      const th = Math.atan2(dy, dx);
      const lobe = 0.34 + 0.10 * Math.cos(th * 8);
      if (r < lobe) {
        col = BORDER;
        motif = band(Math.abs(r - lobe * 0.55) - 0.05, 0, 0.05);
      } else {
        const cellU = (u * 9) % 1;
        const cellV = (v * 9) % 1;
        motif = band(Math.hypot(cellU - 0.5, cellV - 0.5) - 0.14, 0, 0.07) * 0.85;
      }
      // corner spandrels
      const cd = Math.hypot(Math.min(u, 1 - u) - 0.175, Math.min(v, 1 - v) - 0.175);
      if (cd < 0.10) { col = BORDER; motif = Math.max(motif, band(cd - 0.06, 0, 0.04)); }
    }

    const pileTone = 0.78 + f.base[i] * 0.34;
    const wear = clamp01((0.5 - Math.abs(v - 0.5)) * 1.6) * f.grime[i];
    const r0 = lerp(col[0], GOLD[0], motif) * pileTone;
    const g0 = lerp(col[1], GOLD[1], motif) * pileTone;
    const b0 = lerp(col[2], GOLD[2], motif) * pileTone;
    // trodden pile goes pale and grey
    out.r = lerp(r0, 0.30, wear * 0.35);
    out.g = lerp(g0, 0.28, wear * 0.35);
    out.b = lerp(b0, 0.26, wear * 0.35);

    // knotted pile: a fine grid of tufts
    const knot = (Math.sin(x * 1.7) * Math.sin(y * 2.1)) * 0.5 + 0.5;
    out.h = 0.55 + knot * 0.30 + motif * 0.12 - wear * 0.3;
    out.rough = 0.96 - wear * 0.08;
  });
}

/** Diagonal twill — upholstery, curtains and the cast's clothing. */
function twill(size, tint) {
  const f = plasterFields(size);
  return surface(size, { normalStrength: 1.6 }, (x, y, i, out) => {
    // 2/2 twill: the float steps one thread per pick, giving the diagonal wale
    const rib = ((x + y) % 4) < 2 ? 1 : 0;
    const weft = (y % 2) === 0 ? 1 : 0;
    const thread = 0.82 + rib * 0.20 + weft * 0.05;
    const slub = f.fine[i];
    const soil = f.grime[i];
    const shade = thread * (0.86 + slub * 0.22) * (1 - soil * 0.18);
    tinted(out, shade, tint);
    out.h = rib * 0.55 + weft * 0.18 + slub * 0.2;
    out.rough = 0.92 - rib * 0.06 + slub * 0.06;
  });
}

/** Smooth lime ceiling: stipple, hairline cracks and a damp bloom. */
function ceilingPlaster(size, tint) {
  const f = plasterFields(size);
  return surface(size, { normalStrength: 1.3 }, (x, y, i, out) => {
    const stipple = f.fine[i];
    const cracked = f.crack[i];
    const damp = Math.pow(Math.max(0, f.stain[i]), 1.6);
    let shade = 0.78 + f.base[i] * 0.16 + stipple * 0.06;
    shade *= 1 - cracked * 0.5;
    out.r = shade * tint[0] * (1 - damp * 0.30);
    out.g = shade * tint[1] * (1 - damp * 0.38);
    out.b = shade * tint[2] * (1 - damp * 0.48);
    out.h = stipple * 0.28 - cracked * 0.8;
    out.rough = 0.88 + stipple * 0.08 - damp * 0.2;
  });
}

// --- the cast ---------------------------------------------------------------

/** Skin: blotch, pore, and the roughness break that stops it reading as vinyl. */
function skinSurface(size, tint) {
  const blotch = field('skin.blotch', size, (x, y) => fbm(x * 0.03, y * 0.03, 4) * 0.5 + 0.5);
  const pore = field('skin.pore', size, (x, y) => fbm(x * 0.42, y * 0.42, 2) * 0.5 + 0.5);
  const vein = field('skin.vein', size, (x, y) => Math.abs(fbm(x * 0.02 + 31, y * 0.02 - 7, 3)));
  return surface(size, { normalStrength: 1.1 }, (x, y, i, out) => {
    const b = blotch[i];
    const p = pore[i];
    const v = band(vein[i], 0.008, 0.04) * 0.35;
    const shade = 0.86 + b * 0.20 - p * 0.10;
    // redness pools where the blotch field is high — cheeks, knuckles, ears
    out.r = shade * tint[0] * (1 + b * 0.10);
    out.g = shade * tint[1] * (1 - b * 0.05 - v * 0.2);
    out.b = shade * tint[2] * (1 - b * 0.08 - v * 0.1);
    out.h = p * 0.30 + b * 0.15 - v * 0.2;
    out.rough = 0.62 + p * 0.22 - b * 0.10;
  });
}

/** Hair: fine directional strands with a specular break along the length. */
function hairSurface(size, tint) {
  const strand = field('hair.strand', size, (x, y) => fbm(x * 0.9, y * 0.02, 3) * 0.5 + 0.5);
  const clump = field('hair.clump', size, (x, y) => fbm(x * 0.06, y * 0.01, 3) * 0.5 + 0.5);
  return surface(size, { normalStrength: 2.4 }, (x, y, i, out) => {
    const s = strand[i];
    const c = clump[i];
    const shade = 0.55 + s * 0.42 + c * 0.18;
    tinted(out, shade, tint);
    out.h = s * 0.7 + c * 0.3;
    out.rough = 0.44 + (1 - s) * 0.34;
  });
}

// --- volumetric / sampling helpers ------------------------------------------

/** Blue-noise-ish dust field sampled by the volumetric raymarch. */
function dustField(size) {
  const values = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const n = fbm(x * 0.03, y * 0.03, 5) * 0.5 + 0.5;
      const n2 = fbm(x * 0.11 + 17, y * 0.11 - 5, 3) * 0.5 + 0.5;
      values[y * size + x] = Math.min(1, n * 0.7 + n2 * 0.45);
    }
  }
  return writeGray(values, size);
}

/** White noise used to rotate SSR / SSAO sample kernels per pixel. */
function blueNoise(size) {
  const values = new Float32Array(size * size);
  let seed = 90210;
  for (let i = 0; i < size * size; i += 1) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    values[i] = (seed >>> 8) / 16777216;
  }
  const texture = writeGray(values, size);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  return texture;
}

// --- library ----------------------------------------------------------------

const S = 512;      // hero surfaces
const M = 256;      // supporting surfaces — character skin, hair, cloth

/**
 * Every surface in the game, in bake order. Architecture first, so that on a
 * slow machine the surfaces the player will actually be standing in are the
 * ones that finish first.
 *
 * Colourways are NOT baked. A damask is tone-on-tone by construction — the
 * pattern is carried by sheen and relief, not hue — so one bake serves the
 * crimson drawing room, the sage library and the ochre bedroom, tinted through
 * `material.color` in `builder.js`. Same for parquet, twill and skin. Baking
 * each colourway separately tripled the texture memory for nothing.
 */
const RECIPES = [
  // floors
  ['woodFloor', () => woodPlanks(S, [0.62, 0.44, 0.3])],
  ['darkWood', () => woodPlanks(S, [0.34, 0.24, 0.18])],
  ['parquet', () => parquet(S, [0.62, 0.44, 0.29])],
  ['marbleCheck', () => marbleCheck(S, [0.86, 0.84, 0.79], [0.19, 0.18, 0.20])],
  ['marbleSlab', () => marbleSlab(S, [0.84, 0.82, 0.78])],
  ['quarryTile', () => quarryTile(S, [0.60, 0.31, 0.22])],
  ['flagstone', () => flagstone(S, [0.56, 0.54, 0.50])],
  ['tileFloor', () => tiles(S, [0.72, 0.72, 0.68])],
  ['concrete', () => concrete(S, [0.55, 0.55, 0.56])],

  // wall coverings
  ['damask', () => paperedWall(S, {
    ground: [0.64, 0.62, 0.59], pattern: [0.84, 0.81, 0.77], cells: 3, raise: 0.55, sheen: 0.46,
  })],
  ['flock', () => paperedWall(S, {
    ground: [0.58, 0.55, 0.53], pattern: [0.78, 0.74, 0.71], cells: 2,
    raise: 0.95, sheen: 0.55, damp: 0.6,
  })],
  ['floralPaper', () => paperedWall(S, {
    ground: [0.74, 0.71, 0.67], pattern: [0.88, 0.76, 0.74], cells: 5,
    motif: floralMotif, raise: 0.3, sheen: 0.30,
  })],
  ['wallPaper', () => plaster(S, [0.7, 0.63, 0.52], 0.85)],
  ['wallStone', () => plaster(S, [0.5, 0.5, 0.52], 0.6)],
  ['limewash', () => plaster(S, [0.78, 0.76, 0.70], 0.5)],
  ['oakPanel', () => oakPanel(S, [0.64, 0.47, 0.32])],
  ['ceilingPlaster', () => ceilingPlaster(S, [0.80, 0.78, 0.72])],

  // masonry
  ['redBrick', () => brick(S, [0.50, 0.26, 0.20], { courses: 8 })],
  ['glazedBrick', () => brick(S, [0.86, 0.87, 0.84], { glazed: true, courses: 10 })],

  // furnishings
  ['bookSpines', () => bookSpines(S)],
  ['rug', () => persianRug(S)],
  ['twill', () => twill(S, [0.62, 0.60, 0.58])],
  ['metal', () => rustedMetal(S, [0.6, 0.62, 0.66])],

  // the cast — finer weave scale than the upholstery, so worth its own bake
  ['skin', () => skinSurface(M, [0.86, 0.80, 0.74])],
  ['clothTwill', () => twill(M, [0.66, 0.65, 0.64])],
  ['hair', () => hairSurface(M, [0.42, 0.36, 0.32])],

  // sampling
  ['dust', () => dustField(M)],
  ['noise', () => blueNoise(128)],
];

const nextFrame = () => new Promise((resolve) => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
  else setTimeout(resolve, 0);
});

let cache = null;

/**
 * Bakes every surface, yielding to the browser between each so the loading
 * screen keeps painting. `onProgress(done, total, name)` drives the readout.
 */
export async function buildTextureLibrary(onProgress = null) {
  if (cache) return cache;
  const library = {};
  for (let i = 0; i < RECIPES.length; i += 1) {
    const [name, make] = RECIPES[i];
    library[name] = make();
    if (onProgress) onProgress(i + 1, RECIPES.length, name);
    // let the frame land before starting the next surface
    if (i % 2 === 1) await nextFrame();
  }
  // the base fields are only needed while baking; they are megabytes each
  FIELDS.clear();
  cache = library;
  return cache;
}
