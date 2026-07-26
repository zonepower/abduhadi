import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Procedural PBR texture factory. Everything is generated on canvases at load
// time so the game ships with zero binary assets.
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

// --- surface generators -----------------------------------------------------

function woodPlanks(size, tint) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const height = new Float32Array(size * size);
  const rough = new Float32Array(size * size);
  const plank = size / 8;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const row = Math.floor(y / plank);
      const offset = (row % 2) * plank * 0.5;
      const px = (x + offset) % size;
      const along = px / size;
      const seam = Math.min(y % plank, plank - (y % plank)) / plank;
      const boardSeam = Math.min((px % (plank * 2)), plank * 2 - (px % (plank * 2))) / (plank * 2);
      // long grain stretched along the plank
      const grain = fbm(along * 18 + row * 7.3, (y % plank) * 0.18 + row * 3.1, 5);
      const knot = Math.max(0, 1 - Math.hypot(((px % (plank * 2)) - plank) / plank, ((y % plank) - plank * 0.5) / (plank * 0.5)) * 1.7);
      const wear = fbm(x * 0.02, y * 0.02, 4) * 0.5 + 0.5;
      let shade = 0.45 + grain * 0.32 + knot * 0.18;
      shade *= 0.72 + wear * 0.4;
      if (seam < 0.06) shade *= 0.25 + seam * 6;
      if (boardSeam < 0.02) shade *= 0.35 + boardSeam * 20;
      const idx = (y * size + x) * 4;
      image.data[idx] = Math.min(255, shade * tint[0] * 255);
      image.data[idx + 1] = Math.min(255, shade * tint[1] * 255);
      image.data[idx + 2] = Math.min(255, shade * tint[2] * 255);
      image.data[idx + 3] = 255;
      height[y * size + x] = shade * 0.7 + (seam < 0.06 ? -0.5 : 0) + grain * 0.25;
      // polished where worn down, rough where damp
      rough[y * size + x] = 0.42 + (1 - wear) * 0.45 + grain * 0.1;
    }
  }
  ctx.putImageData(image, 0, 0);
  return {
    map: toTexture(canvas, { srgb: true }),
    normalMap: heightToNormal(height, size, 2.6),
    roughnessMap: writeGray(rough, size),
  };
}

function plaster(size, tint, damp) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const height = new Float32Array(size * size);
  const rough = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const base = fbm(x * 0.014, y * 0.014, 6) * 0.5 + 0.5;
      const fine = fbm(x * 0.12, y * 0.12, 3) * 0.5 + 0.5;
      const stain = Math.pow(Math.max(0, fbm(x * 0.006 + 40, y * 0.006 - 12, 4) * 0.5 + 0.5), 2.2);
      // peeling patches: sharp threshold on a low-frequency field
      const peel = fbm(x * 0.009 - 80, y * 0.009 + 33, 4) * 0.5 + 0.5;
      const peeled = peel > 0.58 ? 1 : 0;
      let shade = 0.55 + base * 0.3 + fine * 0.12;
      shade *= 1 - stain * damp * 0.75;
      if (peeled) shade *= 0.62;
      const idx = (y * size + x) * 4;
      image.data[idx] = Math.min(255, shade * tint[0] * 255);
      image.data[idx + 1] = Math.min(255, shade * tint[1] * 255);
      image.data[idx + 2] = Math.min(255, shade * tint[2] * 255);
      image.data[idx + 3] = 255;
      height[y * size + x] = base * 0.6 + fine * 0.25 - peeled * 0.35;
      rough[y * size + x] = 0.72 + fine * 0.2 - stain * damp * 0.35;
    }
  }
  ctx.putImageData(image, 0, 0);
  return {
    map: toTexture(canvas, { srgb: true }),
    normalMap: heightToNormal(height, size, 1.8),
    roughnessMap: writeGray(rough, size),
  };
}

function tiles(size, tint) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const height = new Float32Array(size * size);
  const rough = new Float32Array(size * size);
  const cell = size / 6;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const gx = Math.min(x % cell, cell - (x % cell)) / cell;
      const gy = Math.min(y % cell, cell - (y % cell)) / cell;
      const grout = Math.min(gx, gy);
      const id = Math.floor(x / cell) * 31 + Math.floor(y / cell) * 17;
      const variance = (Math.sin(id * 12.9898) * 43758.5453) % 1;
      const grime = fbm(x * 0.02, y * 0.02, 4) * 0.5 + 0.5;
      const crack = Math.abs(fbm(x * 0.05 + 9, y * 0.05 - 3, 3));
      let shade = 0.68 + variance * 0.12 - grime * 0.28;
      if (crack < 0.02) shade *= 0.45;
      if (grout < 0.05) shade *= 0.32;
      const idx = (y * size + x) * 4;
      image.data[idx] = Math.min(255, shade * tint[0] * 255);
      image.data[idx + 1] = Math.min(255, shade * tint[1] * 255);
      image.data[idx + 2] = Math.min(255, shade * tint[2] * 255);
      image.data[idx + 3] = 255;
      height[y * size + x] = grout < 0.05 ? 0.1 : 0.75 + grime * 0.1;
      // glazed tiles stay smooth, grout lines are matte
      rough[y * size + x] = grout < 0.05 ? 0.85 : 0.18 + grime * 0.45;
    }
  }
  ctx.putImageData(image, 0, 0);
  return {
    map: toTexture(canvas, { srgb: true }),
    normalMap: heightToNormal(height, size, 3.4),
    roughnessMap: writeGray(rough, size),
  };
}

function concrete(size, tint) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const height = new Float32Array(size * size);
  const rough = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const base = fbm(x * 0.02, y * 0.02, 6) * 0.5 + 0.5;
      const pits = Math.pow(Math.max(0, fbm(x * 0.16, y * 0.16, 2) * 0.5 + 0.5), 6);
      const wet = Math.pow(Math.max(0, fbm(x * 0.008 - 20, y * 0.008 + 60, 4) * 0.5 + 0.5), 1.6);
      let shade = 0.42 + base * 0.26 - pits * 0.3;
      shade *= 1 - wet * 0.35;
      const idx = (y * size + x) * 4;
      image.data[idx] = Math.min(255, shade * tint[0] * 255);
      image.data[idx + 1] = Math.min(255, shade * tint[1] * 255);
      image.data[idx + 2] = Math.min(255, shade * tint[2] * 255);
      image.data[idx + 3] = 255;
      height[y * size + x] = base * 0.7 - pits * 0.6;
      rough[y * size + x] = 0.86 - wet * 0.6 + pits * 0.1;
    }
  }
  ctx.putImageData(image, 0, 0);
  return {
    map: toTexture(canvas, { srgb: true }),
    normalMap: heightToNormal(height, size, 2.4),
    roughnessMap: writeGray(rough, size),
  };
}

function rustedMetal(size, tint) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const height = new Float32Array(size * size);
  const rough = new Float32Array(size * size);
  const metal = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const rust = Math.pow(Math.max(0, fbm(x * 0.018, y * 0.018, 5) * 0.5 + 0.5), 1.4);
      const scratch = Math.abs(fbm(x * 0.4, y * 0.02, 2));
      const shade = 0.32 + scratch * 0.2;
      const idx = (y * size + x) * 4;
      image.data[idx] = Math.min(255, (shade * tint[0] + rust * 0.42) * 255);
      image.data[idx + 1] = Math.min(255, (shade * tint[1] + rust * 0.18) * 255);
      image.data[idx + 2] = Math.min(255, (shade * tint[2] + rust * 0.07) * 255);
      image.data[idx + 3] = 255;
      height[y * size + x] = rust * 0.5 + scratch * 0.3;
      rough[y * size + x] = 0.26 + rust * 0.62;
      metal[y * size + x] = 1 - rust * 0.85;
    }
  }
  ctx.putImageData(image, 0, 0);
  return {
    map: toTexture(canvas, { srgb: true }),
    normalMap: heightToNormal(height, size, 2.0),
    roughnessMap: writeGray(rough, size),
    metalnessMap: writeGray(metal, size),
  };
}

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

let cache = null;

export function buildTextureLibrary() {
  if (cache) return cache;
  cache = {
    woodFloor: woodPlanks(512, [0.62, 0.44, 0.3]),
    darkWood: woodPlanks(512, [0.34, 0.24, 0.18]),
    wallPaper: plaster(512, [0.7, 0.63, 0.52], 0.85),
    wallStone: plaster(512, [0.5, 0.5, 0.52], 0.6),
    tileFloor: tiles(512, [0.72, 0.72, 0.68]),
    concrete: concrete(512, [0.55, 0.55, 0.56]),
    metal: rustedMetal(512, [0.6, 0.62, 0.66]),
    dust: dustField(256),
    noise: blueNoise(128),
  };
  return cache;
}
