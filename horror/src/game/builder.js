import * as THREE from 'three';
import { mergeGroup } from '../engine/geometry.js';
import { roomType } from './levels.js';

// ---------------------------------------------------------------------------
// Turns a level blueprint into geometry, collision and a nav grid.
//
// The blueprint carries a *zone map*: which room owns each tile. That is what
// lets one chapter render a marble hall, a papered library and a brick cellar
// instead of one grey box repeated — the room type picks the floor, the wall
// build-up, the ceiling treatment, the light fixture and the furniture.
// ---------------------------------------------------------------------------

export const TILE = 2.6;

const WALL_CHARS = new Set(['#', 'X']);

/** Chars that carry *behaviour* rather than looks. Appearance comes from the room. */
const FLOOR_TYPES = {
  '.': 'wood',
  ',': 'carpet',
  '=': 'tile',
  '%': 'concrete',
  '~': 'water',
  ';': 'grass',
};

/** Which footstep the audio engine should play on each floor material. */
const STEP_KIND = {
  marbleCheck: 'tile', tileFloor: 'tile', quarryTile: 'tile',
  flagstone: 'concrete', concrete: 'concrete',
  parquet: 'wood', woodFloor: 'wood', darkWood: 'wood', grass: 'wood',
  water: 'water', rug: 'carpet', carpet: 'carpet',
};

const DIRS = [[0, -1, 0], [1, 0, Math.PI / 2], [0, 1, Math.PI], [-1, 0, -Math.PI / 2]];

// --- material set -----------------------------------------------------------

function mat(textures, key, opts = {}) {
  const set = textures[key];
  const material = new THREE.MeshStandardMaterial({
    map: set?.map || null,
    normalMap: set?.normalMap || null,
    roughnessMap: set?.roughnessMap || null,
    metalnessMap: set?.metalnessMap || null,
    color: opts.color ?? 0xffffff,
    roughness: opts.roughness ?? 1,
    metalness: opts.metalness ?? (set?.metalnessMap ? 1 : 0),
    ...opts.extra,
  });
  if (material.normalMap) material.normalScale.set(opts.normalScale ?? 1, opts.normalScale ?? 1);
  material.userData.reflectivity = opts.reflectivity ?? 0;
  // architecture takes only a hint of the probe; the ray-marched passes do the
  // heavy lifting and doubling up would wash the levels out
  material.envMapIntensity = opts.envMapIntensity ?? (material.metalness > 0.5 ? 1.8 : 0.5);
  return material;
}

export function createMaterials(textures) {
  const plain = (color, roughness, extra = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });
    m.userData.reflectivity = extra.reflectivity ?? 0.05;
    return m;
  };

  return {
    // --- floors ---
    woodFloor: mat(textures, 'woodFloor', { reflectivity: 0.28, roughness: 0.85, normalScale: 1.4 }),
    darkWood: mat(textures, 'darkWood', { reflectivity: 0.2, roughness: 0.75 }),
    parquet: mat(textures, 'parquet', { reflectivity: 0.42, roughness: 0.55, normalScale: 1.5 }),
    marbleCheck: mat(textures, 'marbleCheck', { reflectivity: 0.72, roughness: 0.2, normalScale: 0.9 }),
    marbleSlab: mat(textures, 'marbleSlab', { reflectivity: 0.6, roughness: 0.22, normalScale: 0.7 }),
    quarryTile: mat(textures, 'quarryTile', { reflectivity: 0.3, roughness: 0.6, normalScale: 1.5 }),
    flagstone: mat(textures, 'flagstone', { reflectivity: 0.16, roughness: 0.88, normalScale: 1.5 }),
    tileFloor: mat(textures, 'tileFloor', { reflectivity: 0.55, roughness: 0.45, normalScale: 1.6 }),
    concrete: mat(textures, 'concrete', { reflectivity: 0.12, roughness: 0.95, normalScale: 1.3 }),
    carpet: mat(textures, 'darkWood', { color: 0x6b2f38, reflectivity: 0.04, roughness: 1 }),
    grass: mat(textures, 'concrete', { color: 0x33422a, reflectivity: 0.08, roughness: 1 }),
    water: new THREE.MeshStandardMaterial({
      color: 0x25454f, roughness: 0.07, metalness: 0.2, transparent: true, opacity: 0.82,
    }),

    // --- wall coverings ---
    damask: mat(textures, 'damask', { reflectivity: 0.14, roughness: 0.9, normalScale: 1.3 }),
    flock: mat(textures, 'flock', { reflectivity: 0.10, roughness: 0.95, normalScale: 1.6 }),
    floralPaper: mat(textures, 'floralPaper', { reflectivity: 0.08, roughness: 0.95, normalScale: 1.1 }),
    wallPaper: mat(textures, 'wallPaper', { reflectivity: 0.06, roughness: 0.95, normalScale: 1.5 }),
    wallStone: mat(textures, 'wallStone', { color: 0x8f8f96, reflectivity: 0.1, roughness: 0.9, normalScale: 1.5 }),
    limewash: mat(textures, 'limewash', { reflectivity: 0.05, roughness: 0.97, normalScale: 1.2 }),
    oakPanel: mat(textures, 'oakPanel', { reflectivity: 0.3, roughness: 0.55, normalScale: 1.5 }),
    ceilingPlaster: mat(textures, 'ceilingPlaster', { reflectivity: 0.05, roughness: 0.95, normalScale: 1.0 }),
    redBrick: mat(textures, 'redBrick', { reflectivity: 0.07, roughness: 0.94, normalScale: 1.7 }),
    glazedBrick: mat(textures, 'glazedBrick', { reflectivity: 0.5, roughness: 0.25, normalScale: 1.4 }),

    // --- joinery and dressing ---
    trim: mat(textures, 'darkWood', { color: 0x8a705a, reflectivity: 0.22, roughness: 0.62 }),
    panel: mat(textures, 'darkWood', { reflectivity: 0.2, roughness: 0.75 }),
    stoneTrim: mat(textures, 'wallStone', { color: 0xa39a8c, reflectivity: 0.12, roughness: 0.82 }),
    books: mat(textures, 'bookSpines', { reflectivity: 0.14, roughness: 0.75, normalScale: 1.2 }),
    rug: mat(textures, 'rug', { reflectivity: 0.03, roughness: 0.98, normalScale: 1.2 }),
    upholstery: mat(textures, 'twill', { color: 0x6b3038, reflectivity: 0.05, roughness: 0.94, normalScale: 1.3 }),
    curtainCloth: mat(textures, 'twill', { color: 0x4a2530, reflectivity: 0.05, roughness: 0.95, normalScale: 1.4 }),
    metal: mat(textures, 'metal', { reflectivity: 0.7, roughness: 0.4, metalness: 1, envMapIntensity: 2.0 }),
    iron: mat(textures, 'metal', { color: 0x4a4a50, reflectivity: 0.5, roughness: 0.55, metalness: 1, envMapIntensity: 1.5 }),
    brass: mat(textures, 'metal', { color: 0xb59243, reflectivity: 0.8, roughness: 0.28, metalness: 1, envMapIntensity: 2.2 }),
    copper: mat(textures, 'metal', { color: 0xa5643c, reflectivity: 0.75, roughness: 0.34, metalness: 1, envMapIntensity: 2.0 }),
    mirror: new THREE.MeshStandardMaterial({
      color: 0x9fb0c0, roughness: 0.02, metalness: 1, envMapIntensity: 2.2,
    }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x88aabb, roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.35,
    }),
    cloth: plain(0x2a2028, 1),
    // shared so a wall of pictures stays one draw call instead of one each
    canvasArt: plain(0x3a2a22, 0.92),
    wax: plain(0xe6d9bd, 0.85),
    flesh: plain(0x6d2b2b, 0.75),
    bone: plain(0xc9bfa4, 0.6),
    coal: plain(0x121014, 0.98),
    gold: new THREE.MeshStandardMaterial({ color: 0xb08a3a, roughness: 0.28, metalness: 1, envMapIntensity: 2.0 }),
    blood: new THREE.MeshStandardMaterial({
      color: 0x4a0d0d, roughness: 0.25, metalness: 0, transparent: true, opacity: 0.92,
    }),
  };
}

// --- geometry helpers -------------------------------------------------------

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 10) => new THREE.CylinderGeometry(rt, rb, h, s);

function group(...children) {
  const g = new THREE.Group();
  children.forEach((c) => c && g.add(c));
  return g;
}

function part(geometry, material, x = 0, y = 0, z = 0, rot = null) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// --- props ------------------------------------------------------------------
//
// Each factory returns a Group. `userData.collider` gives the dresser its
// footprint; `userData.light` marks a fixture; `userData.merge = false` opts a
// prop out of merging (anything that animates its own children).

export const PROPS = {
  // ---- seating and tables ----
  table(m) {
    const g = group(
      part(box(1.7, 0.12, 1.0), m.panel, 0, 0.86),
      part(box(0.12, 0.86, 0.12), m.panel, -0.75, 0.43, -0.4),
      part(box(0.12, 0.86, 0.12), m.panel, 0.75, 0.43, -0.4),
      part(box(0.12, 0.86, 0.12), m.panel, -0.75, 0.43, 0.4),
      part(box(0.12, 0.86, 0.12), m.panel, 0.75, 0.43, 0.4),
    );
    g.userData.collider = { w: 1.8, d: 1.1, h: 1.0 };
    return g;
  },
  diningTable(m) {
    const g = group(
      part(box(3.1, 0.10, 1.25), m.panel, 0, 0.76),
      part(box(3.0, 0.06, 1.15), m.panel, 0, 0.70),
      part(box(2.6, 0.09, 0.09), m.panel, 0, 0.30, -0.42),
      part(box(2.6, 0.09, 0.09), m.panel, 0, 0.30, 0.42),
    );
    [[-1.32, -0.46], [1.32, -0.46], [-1.32, 0.46], [1.32, 0.46]].forEach(([x, z]) => {
      g.add(part(cyl(0.07, 0.10, 0.72, 8), m.panel, x, 0.36, z));
      g.add(part(box(0.16, 0.14, 0.16), m.panel, x, 0.68, z));      // turned collar
    });
    // a runner and a pair of candlesticks left mid-meal
    g.add(part(box(2.4, 0.015, 0.42), m.curtainCloth, 0, 0.815));
    [-0.7, 0.7].forEach((x) => {
      g.add(part(cyl(0.045, 0.075, 0.24, 8), m.brass, x, 0.93));
      g.add(part(cyl(0.028, 0.032, 0.16, 8), m.wax, x, 1.13));
    });
    g.userData.collider = { w: 3.2, d: 1.4, h: 1.0 };
    return g;
  },
  chair(m) {
    const g = group(
      part(box(0.5, 0.08, 0.5), m.panel, 0, 0.48),
      part(box(0.5, 0.7, 0.08), m.panel, 0, 0.85, -0.21),
      part(box(0.06, 0.48, 0.06), m.panel, -0.2, 0.24, -0.2),
      part(box(0.06, 0.48, 0.06), m.panel, 0.2, 0.24, -0.2),
      part(box(0.06, 0.48, 0.06), m.panel, -0.2, 0.24, 0.2),
      part(box(0.06, 0.48, 0.06), m.panel, 0.2, 0.24, 0.2),
    );
    g.userData.collider = { w: 0.6, d: 0.6, h: 1.2 };
    return g;
  },
  carverChair(m) {
    const g = group(
      part(box(0.50, 0.07, 0.48), m.panel, 0, 0.46),
      part(box(0.46, 0.05, 0.44), m.upholstery, 0, 0.51),
      part(box(0.09, 1.05, 0.09), m.panel, -0.21, 0.52, -0.22),
      part(box(0.09, 1.05, 0.09), m.panel, 0.21, 0.52, -0.22),
      part(box(0.34, 0.42, 0.04), m.upholstery, 0, 0.86, -0.20),
      part(box(0.50, 0.09, 0.07), m.panel, 0, 1.04, -0.22),      // crest rail
    );
    [[-0.21, 0.21], [0.21, 0.21], [-0.21, -0.22], [0.21, -0.22]].forEach(([x, z], i) => {
      if (i < 2) g.add(part(cyl(0.035, 0.05, 0.46, 8), m.panel, x, 0.23, z));
    });
    g.add(part(box(0.44, 0.05, 0.05), m.panel, 0, 0.14, 0.21));   // stretcher
    g.userData.collider = { w: 0.58, d: 0.58, h: 1.2 };
    return g;
  },
  wingChair(m) {
    const g = group(
      part(box(0.74, 0.34, 0.72), m.upholstery, 0, 0.30),
      part(box(0.66, 0.14, 0.62), m.upholstery, 0, 0.50),          // seat cushion
      part(box(0.74, 0.86, 0.16), m.upholstery, 0, 0.78, -0.31),   // back
      part(box(0.14, 0.62, 0.66), m.upholstery, -0.31, 0.66, 0.02),
      part(box(0.14, 0.62, 0.66), m.upholstery, 0.31, 0.66, 0.02),
      part(box(0.16, 0.34, 0.22), m.upholstery, -0.31, 1.02, -0.20),  // wings
      part(box(0.16, 0.34, 0.22), m.upholstery, 0.31, 1.02, -0.20),
    );
    [[-0.30, 0.28], [0.30, 0.28], [-0.30, -0.28], [0.30, -0.28]].forEach(([x, z]) => {
      g.add(part(box(0.08, 0.14, 0.08), m.panel, x, 0.07, z));
    });
    g.userData.collider = { w: 0.85, d: 0.85, h: 1.2 };
    return g;
  },
  chaise(m) {
    const g = group(
      part(box(1.90, 0.30, 0.72), m.upholstery, 0, 0.36),
      part(box(1.84, 0.14, 0.66), m.upholstery, 0, 0.56),
      part(box(0.18, 0.74, 0.72), m.upholstery, -0.86, 0.78, 0),   // raised head end
      part(box(1.0, 0.46, 0.14), m.upholstery, -0.35, 0.72, -0.32),
      part(box(0.16, 0.10, 0.62), m.panel, -0.90, 0.16, 0),
    );
    [[-0.80, 0.30], [0.86, 0.30], [-0.80, -0.30], [0.86, -0.30]].forEach(([x, z]) => {
      g.add(part(cyl(0.045, 0.055, 0.20, 8), m.panel, x, 0.10, z));
    });
    g.userData.collider = { w: 2.0, d: 0.85, h: 1.0 };
    return g;
  },
  footstool(m) {
    const g = group(
      part(box(0.44, 0.14, 0.36), m.upholstery, 0, 0.30),
      part(box(0.40, 0.06, 0.32), m.panel, 0, 0.22),
    );
    [[-0.16, 0.13], [0.16, 0.13], [-0.16, -0.13], [0.16, -0.13]].forEach(([x, z]) => {
      g.add(part(cyl(0.025, 0.032, 0.20, 6), m.panel, x, 0.10, z));
    });
    g.userData.collider = { w: 0.5, d: 0.42, h: 0.4 };
    return g;
  },
  sideTable(m) {
    const g = group(
      part(cyl(0.34, 0.34, 0.06, 14), m.panel, 0, 0.72),
      part(cyl(0.05, 0.06, 0.68, 8), m.panel, 0, 0.36),
      part(cyl(0.24, 0.26, 0.05, 12), m.panel, 0, 0.03),
    );
    g.userData.collider = { w: 0.7, d: 0.7, h: 0.8 };
    return g;
  },

  // ---- storage ----
  shelf(m) {
    const g = group(
      part(box(1.6, 2.2, 0.1), m.panel, 0, 1.1, -0.2),
      part(box(0.1, 2.2, 0.45), m.panel, -0.75, 1.1, 0),
      part(box(0.1, 2.2, 0.45), m.panel, 0.75, 1.1, 0),
      part(box(1.6, 0.06, 0.45), m.panel, 0, 0.5, 0),
      part(box(1.6, 0.06, 0.45), m.panel, 0, 1.1, 0),
      part(box(1.6, 0.06, 0.45), m.panel, 0, 1.7, 0),
    );
    g.userData.collider = { w: 1.7, d: 0.6, h: 2.2 };
    return g;
  },
  bookcase(m) {
    const H = 2.55;
    const g = group(
      part(box(1.5, H, 0.08), m.panel, 0, H / 2, -0.24),        // back
      part(box(0.09, H, 0.52), m.panel, -0.70, H / 2, 0),
      part(box(0.09, H, 0.52), m.panel, 0.70, H / 2, 0),
      part(box(1.5, 0.10, 0.56), m.panel, 0, H - 0.05, 0.02),   // cornice
      part(box(1.6, 0.13, 0.62), m.trim, 0, H + 0.02, 0.03),
      part(box(1.5, 0.16, 0.54), m.panel, 0, 0.08, 0),          // plinth
    );
    // five shelves, each with a run of books
    for (let i = 0; i < 5; i += 1) {
      const y = 0.30 + i * 0.46;
      g.add(part(box(1.36, 0.045, 0.50), m.panel, 0, y, 0));
      const fill = 0.60 + ((i * 7) % 5) * 0.08;                 // some shelves thin out
      g.add(part(box(1.30 * fill, 0.36, 0.30), m.books,
        -0.65 + (1.30 * fill) / 2 + 0.02, y + 0.20, -0.06));
    }
    g.userData.collider = { w: 1.6, d: 0.65, h: 2.6 };
    return g;
  },
  larderShelf(m) {
    const g = group(
      part(box(0.08, 1.9, 0.42), m.panel, -0.62, 0.95, 0),
      part(box(0.08, 1.9, 0.42), m.panel, 0.62, 0.95, 0),
    );
    for (let i = 0; i < 4; i += 1) {
      const y = 0.45 + i * 0.45;
      g.add(part(box(1.3, 0.04, 0.42), m.panel, 0, y, 0));
      // crocks and jars, a couple missing
      for (let j = -1; j <= 1; j += 1) {
        if ((i * 3 + j + 4) % 5 === 0) continue;
        g.add(part(cyl(0.09, 0.10, 0.20, 8), m.bone, j * 0.38, y + 0.12, 0));
      }
    }
    g.userData.collider = { w: 1.4, d: 0.5, h: 1.9 };
    return g;
  },
  sideboard(m) {
    const g = group(
      part(box(2.0, 0.10, 0.66), m.marbleSlab, 0, 0.94),          // marble top
      part(box(1.9, 0.80, 0.60), m.panel, 0, 0.50),
      part(box(1.9, 0.14, 0.62), m.panel, 0, 0.08),
      part(box(1.9, 0.70, 0.06), m.panel, 0, 1.55, -0.28),        // back board
      part(box(2.0, 0.10, 0.12), m.trim, 0, 1.92, -0.28),
    );
    [-0.62, 0, 0.62].forEach((x) => {
      g.add(part(box(0.54, 0.34, 0.03), m.trim, x, 0.72, 0.31));  // drawer fronts
      g.add(part(cyl(0.03, 0.03, 0.03, 8), m.brass, x, 0.72, 0.34, [Math.PI / 2, 0, 0]));
      g.add(part(box(0.54, 0.36, 0.03), m.trim, x, 0.34, 0.31));
    });
    // a decanter and glasses on the marble
    g.add(part(cyl(0.07, 0.09, 0.22, 8), m.glass, -0.6, 1.10));
    [0.1, 0.26, 0.42].forEach((x) => g.add(part(cyl(0.04, 0.03, 0.10, 6), m.glass, x, 1.04)));
    g.userData.collider = { w: 2.1, d: 0.75, h: 1.0 };
    return g;
  },
  kitchenDresser(m) {
    const g = group(
      part(box(1.8, 0.90, 0.58), m.panel, 0, 0.50),
      part(box(1.86, 0.08, 0.64), m.panel, 0, 0.98),
      part(box(1.8, 0.12, 0.60), m.panel, 0, 0.06),
      part(box(1.7, 1.5, 0.06), m.panel, 0, 1.78, -0.24),
      part(box(0.08, 1.5, 0.32), m.panel, -0.81, 1.78, -0.10),
      part(box(0.08, 1.5, 0.32), m.panel, 0.81, 1.78, -0.10),
      part(box(1.86, 0.11, 0.40), m.trim, 0, 2.55, -0.08),
    );
    // three plate shelves, plates stood on edge
    for (let i = 0; i < 3; i += 1) {
      const y = 1.28 + i * 0.44;
      g.add(part(box(1.66, 0.04, 0.30), m.panel, 0, y, -0.10));
      for (let j = -2; j <= 2; j += 1) {
        g.add(part(cyl(0.14, 0.14, 0.02, 12), m.bone, j * 0.33, y + 0.16, -0.20, [Math.PI / 2, 0, 0]));
      }
    }
    [-0.45, 0.45].forEach((x) => {
      g.add(part(box(0.76, 0.60, 0.03), m.trim, x, 0.46, 0.30));
      g.add(part(cyl(0.025, 0.025, 0.05, 8), m.brass, x + 0.28, 0.46, 0.33, [Math.PI / 2, 0, 0]));
    });
    g.userData.collider = { w: 1.9, d: 0.7, h: 2.6 };
    return g;
  },
  wardrobe(m) {
    const g = group(
      part(box(1.35, 2.20, 0.62), m.panel, 0, 1.12),
      part(box(1.45, 0.14, 0.72), m.trim, 0, 2.28),               // cornice
      part(box(1.40, 0.16, 0.68), m.trim, 0, 0.08),               // plinth
    );
    [-0.34, 0.34].forEach((x, i) => {
      g.add(part(box(0.60, 1.80, 0.04), m.trim, x, 1.20, 0.32));
      g.add(part(box(0.44, 1.50, 0.02), m.panel, x, 1.20, 0.345));
      g.add(part(cyl(0.022, 0.022, 0.09, 8), m.brass,
        x + (i ? -0.24 : 0.24), 1.15, 0.38, [Math.PI / 2, 0, 0]));
    });
    g.userData.collider = { w: 1.45, d: 0.75, h: 2.3 };
    return g;
  },
  wineRack(m) {
    const g = group(
      part(box(0.10, 1.9, 0.52), m.panel, -0.62, 0.95, 0),
      part(box(0.10, 1.9, 0.52), m.panel, 0.62, 0.95, 0),
    );
    for (let i = 0; i < 5; i += 1) {
      const y = 0.30 + i * 0.38;
      g.add(part(box(1.26, 0.05, 0.50), m.panel, 0, y, 0));
      for (let j = 0; j < 5; j += 1) {
        if ((i * 5 + j) % 7 === 0) continue;                      // a few gone
        g.add(part(cyl(0.055, 0.055, 0.30, 8), m.glass,
          -0.5 + j * 0.25, y + 0.10, 0, [Math.PI / 2, 0, 0]));
      }
    }
    g.userData.collider = { w: 1.35, d: 0.6, h: 1.9 };
    return g;
  },
  crate(m, variant = 0) {
    const g = group(part(box(0.9, 0.9, 0.9), m.panel, 0, 0.45));
    g.rotation.y = (variant % 3) * 0.4;
    [-0.44, 0.44].forEach((z) => {
      g.add(part(box(0.94, 0.08, 0.04), m.trim, 0, 0.78, z));
      g.add(part(box(0.94, 0.08, 0.04), m.trim, 0, 0.14, z));
    });
    g.userData.collider = { w: 1.0, d: 1.0, h: 0.9 };
    return g;
  },
  barrel(m) {
    const g = group(
      part(cyl(0.36, 0.42, 1.05, 14), m.panel, 0, 0.53),
      part(new THREE.TorusGeometry(0.42, 0.03, 6, 16), m.iron, 0, 0.28, 0, [Math.PI / 2, 0, 0]),
      part(new THREE.TorusGeometry(0.42, 0.03, 6, 16), m.iron, 0, 0.78, 0, [Math.PI / 2, 0, 0]),
      part(cyl(0.35, 0.35, 0.03, 12), m.panel, 0, 1.06),
    );
    g.userData.collider = { w: 0.9, d: 0.9, h: 1.05 };
    return g;
  },

  // ---- desks, beds, washing ----
  readingDesk(m) {
    const g = group(
      part(box(1.6, 0.08, 0.86), m.panel, 0, 0.76),
      part(box(1.46, 0.02, 0.74), m.upholstery, 0, 0.805),        // leather inset
      part(box(0.44, 0.52, 0.72), m.panel, -0.54, 0.44, 0),       // pedestals
      part(box(0.44, 0.52, 0.72), m.panel, 0.54, 0.44, 0),
      part(box(1.6, 0.10, 0.90), m.trim, 0, 0.14),
    );
    [-0.54, 0.54].forEach((x) => {
      [0.30, 0.52].forEach((y) => {
        g.add(part(box(0.38, 0.18, 0.03), m.trim, x, y, 0.37));
        g.add(part(cyl(0.02, 0.02, 0.04, 8), m.brass, x, y, 0.40, [Math.PI / 2, 0, 0]));
      });
    });
    // an open ledger and an inkwell
    g.add(part(box(0.42, 0.03, 0.30), m.bone, 0.1, 0.82, 0.02, [0, 0.2, 0]));
    g.add(part(cyl(0.05, 0.06, 0.09, 8), m.glass, -0.45, 0.85));
    g.userData.collider = { w: 1.7, d: 1.0, h: 0.9 };
    return g;
  },
  dressingTable(m) {
    const g = group(
      part(box(1.1, 0.07, 0.50), m.panel, 0, 0.74),
      part(box(1.0, 0.28, 0.44), m.panel, 0, 0.58),
      part(box(0.70, 0.80, 0.04), m.panel, 0, 1.20, -0.20),
      part(box(0.58, 0.66, 0.02), m.mirror, 0, 1.22, -0.17),
    );
    [-0.42, 0.42].forEach((x) => g.add(part(cyl(0.035, 0.05, 0.54, 8), m.panel, x, 0.27, 0.16)));
    g.add(part(cyl(0.04, 0.05, 0.12, 8), m.glass, 0.32, 0.83, 0.05));
    g.userData.collider = { w: 1.2, d: 0.6, h: 0.9 };
    return g;
  },
  brassBed(m) {
    const g = group(
      part(box(1.42, 0.16, 2.05), m.panel, 0, 0.46),
      part(box(1.36, 0.22, 1.98), m.cloth, 0, 0.63),              // mattress
      part(box(1.36, 0.08, 1.30), m.curtainCloth, 0, 0.75, 0.30), // counterpane
      part(box(0.62, 0.16, 0.36), m.bone, -0.30, 0.80, -0.78),    // pillows
      part(box(0.62, 0.16, 0.36), m.bone, 0.32, 0.80, -0.78),
    );
    // brass head and foot: posts, rails and turned spindles
    [[-1.03, 1.15], [1.03, 0.78]].forEach(([z, top]) => {
      [-0.66, 0.66].forEach((x) => g.add(part(cyl(0.035, 0.035, top, 10), m.brass, x, top / 2, z)));
      [-0.66, 0.66].forEach((x) => g.add(part(new THREE.SphereGeometry(0.055, 10, 8), m.brass, x, top, z)));
      g.add(part(cyl(0.028, 0.028, 1.32, 8), m.brass, 0, top - 0.06, z, [0, 0, Math.PI / 2]));
      g.add(part(cyl(0.028, 0.028, 1.32, 8), m.brass, 0, top * 0.55, z, [0, 0, Math.PI / 2]));
      for (let i = -2; i <= 2; i += 1) {
        g.add(part(cyl(0.018, 0.018, top * 0.45, 6), m.brass, i * 0.24, top * 0.78, z));
      }
    });
    g.userData.collider = { w: 1.5, d: 2.2, h: 1.2 };
    return g;
  },
  washstand(m) {
    const g = group(
      part(box(0.94, 0.08, 0.48), m.marbleSlab, 0, 0.86),
      part(box(0.86, 0.60, 0.42), m.panel, 0, 0.54),
      part(box(0.90, 0.10, 0.46), m.panel, 0, 0.08),
      part(box(0.94, 0.34, 0.05), m.marbleSlab, 0, 1.05, -0.22),  // splash back
      part(cyl(0.19, 0.15, 0.13, 14), m.bone, -0.16, 0.96),       // basin
      part(cyl(0.11, 0.13, 0.24, 12), m.bone, 0.26, 1.02),        // ewer
    );
    g.userData.collider = { w: 1.0, d: 0.6, h: 1.0 };
    return g;
  },
  workbench(m) {
    const g = group(
      part(box(1.9, 0.10, 0.66), m.panel, 0, 0.88),
      part(box(0.14, 0.88, 0.14), m.panel, -0.85, 0.44, -0.24),
      part(box(0.14, 0.88, 0.14), m.panel, 0.85, 0.44, -0.24),
      part(box(0.14, 0.88, 0.14), m.panel, -0.85, 0.44, 0.24),
      part(box(0.14, 0.88, 0.14), m.panel, 0.85, 0.44, 0.24),
      part(box(1.7, 0.05, 0.30), m.panel, 0, 0.28, -0.18),
      part(box(0.26, 0.22, 0.18), m.iron, 0.70, 0.99, 0.20),      // vice
      part(cyl(0.022, 0.022, 0.30, 6), m.iron, 0.70, 0.99, 0.38, [0, 0, Math.PI / 2]),
    );
    // tools hung on the wall board behind
    g.add(part(box(1.7, 0.7, 0.03), m.panel, 0, 1.35, -0.31));
    [-0.5, -0.1, 0.3].forEach((x, i) => {
      g.add(part(box(0.05, 0.34 + i * 0.06, 0.03), m.iron, x, 1.32, -0.28));
    });
    g.userData.collider = { w: 2.0, d: 0.8, h: 1.6 };
    return g;
  },

  // ---- kitchen and service ----
  range(m) {
    const g = group(
      part(box(1.5, 1.02, 0.72), m.iron, 0, 0.51),
      part(box(1.56, 0.08, 0.78), m.iron, 0, 1.05),
      part(box(1.34, 0.44, 0.04), m.iron, 0, 0.62, 0.37),         // oven door
      part(cyl(0.03, 0.03, 0.9, 8), m.brass, 0, 0.44, 0.41, [0, 0, Math.PI / 2]),
      part(box(1.34, 0.26, 0.04), m.iron, 0, 0.22, 0.37),
      part(box(1.7, 1.9, 0.30), m.redBrick, 0, 0.95, -0.48),      // chimney breast
      part(box(1.9, 0.16, 0.44), m.stoneTrim, 0, 1.86, -0.42),
    );
    // hotplates and a kettle
    [-0.38, 0.38].forEach((x) => g.add(part(cyl(0.20, 0.20, 0.03, 14), m.iron, x, 1.10, -0.02)));
    g.add(part(cyl(0.13, 0.16, 0.20, 10), m.copper, -0.38, 1.21));
    g.add(part(new THREE.TorusGeometry(0.09, 0.012, 5, 10), m.copper, -0.38, 1.33, 0, [0, 0, 0]));
    const glow = new THREE.PointLight(0xff6a22, 6, 4.5, 1.8);
    glow.position.set(0, 0.55, 0.5);
    g.add(glow);
    g.userData.light = glow;
    g.userData.flicker = true;
    g.userData.collider = { w: 1.9, d: 1.0, h: 1.9 };
    return g;
  },
  stoneSink(m) {
    const g = group(
      part(box(1.05, 0.42, 0.60), m.stoneTrim, 0, 0.68),
      part(box(0.88, 0.30, 0.46), m.cloth, 0, 0.76),              // the dark of the basin
      part(box(0.16, 0.66, 0.16), m.stoneTrim, -0.42, 0.33, 0),
      part(box(0.16, 0.66, 0.16), m.stoneTrim, 0.42, 0.33, 0),
      part(cyl(0.028, 0.028, 0.46, 8), m.brass, 0, 1.10, -0.22),
      part(cyl(0.022, 0.022, 0.20, 8), m.brass, 0, 1.30, -0.13, [Math.PI / 2.4, 0, 0]),
    );
    g.userData.collider = { w: 1.15, d: 0.7, h: 1.1 };
    return g;
  },
  potRack(m) {
    const g = group(
      part(box(1.4, 0.06, 0.06), m.iron, 0, 0, 0),
      part(box(0.06, 0.06, 0.5), m.iron, -0.66, 0, 0),
      part(box(0.06, 0.06, 0.5), m.iron, 0.66, 0, 0),
    );
    [-0.5, -0.17, 0.17, 0.5].forEach((x, i) => {
      g.add(part(cyl(0.012, 0.012, 0.22, 5), m.iron, x, -0.11, 0));
      const r = 0.11 + (i % 2) * 0.05;
      g.add(part(cyl(r, r * 0.86, 0.18, 10), m.copper, x, -0.31, 0));
    });
    g.userData.hangs = true;
    return g;
  },
  pot(m, variant = 0) {
    const r = 0.11 + (variant % 3) * 0.03;
    const g = group(
      part(cyl(r, r * 0.86, 0.20, 10), m.copper, 0, 0.10),
      part(new THREE.TorusGeometry(r * 0.9, 0.012, 5, 10), m.copper, 0, 0.20, 0, [Math.PI / 2, 0, 0]),
    );
    g.userData.collider = { w: 0.3, d: 0.3, h: 0.25 };
    return g;
  },
  bottle(m) {
    const g = group(
      part(cyl(0.045, 0.055, 0.20, 8), m.glass, 0, 0.10),
      part(cyl(0.018, 0.032, 0.12, 6), m.glass, 0, 0.24),
      part(cyl(0.020, 0.020, 0.03, 6), m.trim, 0, 0.31),
    );
    return g;
  },
  clothPile(m) {
    const g = group(
      part(box(0.52, 0.12, 0.40), m.curtainCloth, 0, 0.06, 0, [0, 0.3, 0]),
      part(box(0.44, 0.10, 0.34), m.cloth, 0.04, 0.16, 0.02, [0, -0.4, 0]),
      part(box(0.36, 0.09, 0.28), m.curtainCloth, -0.03, 0.24, -0.02, [0, 0.8, 0]),
    );
    return g;
  },
  coalPile(m) {
    const g = new THREE.Group();
    for (let i = 0; i < 18; i += 1) {
      const a = (i / 18) * Math.PI * 2;
      const r = 0.15 + (i % 5) * 0.13;
      g.add(part(new THREE.IcosahedronGeometry(0.09 + (i % 3) * 0.05, 0), m.coal,
        Math.cos(a) * r, 0.06 + (i % 4) * 0.07, Math.sin(a) * r,
        [i * 0.7, i * 1.3, i * 0.4]));
    }
    g.userData.collider = { w: 1.1, d: 1.1, h: 0.5 };
    return g;
  },
  boiler(m) {
    const g = group(
      part(cyl(0.55, 0.55, 1.7, 16), m.iron, 0, 0.85),
      part(cyl(0.58, 0.58, 0.10, 16), m.iron, 0, 1.72),
      part(new THREE.TorusGeometry(0.56, 0.04, 6, 18), m.iron, 0, 0.45, 0, [Math.PI / 2, 0, 0]),
      part(new THREE.TorusGeometry(0.56, 0.04, 6, 18), m.iron, 0, 1.25, 0, [Math.PI / 2, 0, 0]),
      part(cyl(0.26, 0.26, 0.06, 12), m.iron, 0, 0.62, 0.55, [Math.PI / 2, 0, 0]),  // firebox door
      part(cyl(0.09, 0.09, 1.4, 8), m.iron, 0.72, 1.1, 0),                          // flue
      part(cyl(0.09, 0.09, 0.8, 8), m.iron, 0.36, 1.78, 0, [0, 0, Math.PI / 2]),
      part(cyl(0.10, 0.10, 0.04, 12), m.brass, -0.30, 1.20, 0.50, [Math.PI / 2, 0, 0]),
    );
    const glow = new THREE.PointLight(0xff5a1e, 8, 5, 1.8);
    glow.position.set(0, 0.62, 0.7);
    g.add(glow);
    g.userData.light = glow;
    g.userData.flicker = true;
    g.userData.collider = { w: 1.3, d: 1.3, h: 1.9 };
    return g;
  },

  // ---- fixed joinery and wall furniture ----
  chimneypiece(m) {
    const g = group(
      part(box(2.0, 0.14, 0.42), m.marbleSlab, 0, 1.24),          // mantel shelf
      part(box(0.30, 1.18, 0.34), m.marbleSlab, -0.78, 0.59, 0),  // jambs
      part(box(0.30, 1.18, 0.34), m.marbleSlab, 0.78, 0.59, 0),
      part(box(1.30, 0.22, 0.34), m.marbleSlab, 0, 1.06, 0),      // frieze
      part(box(1.28, 0.98, 0.24), m.cloth, 0, 0.49, -0.06),       // the opening
      part(box(1.20, 0.10, 0.30), m.stoneTrim, 0, 0.05, 0.04),    // hearth
      part(box(1.10, 0.36, 0.06), m.iron, 0, 0.20, -0.02),        // grate
    );
    for (let i = -4; i <= 4; i += 1) {
      g.add(part(box(0.03, 0.30, 0.03), m.iron, i * 0.12, 0.20, 0.06));
    }
    // an overmantel mirror, and a clock and candlesticks on the shelf
    g.add(part(box(1.10, 1.00, 0.06), m.trim, 0, 1.92, -0.14));
    g.add(part(box(0.94, 0.84, 0.02), m.mirror, 0, 1.92, -0.10));
    g.add(part(box(0.26, 0.30, 0.16), m.panel, 0, 1.46, 0));
    g.add(part(cyl(0.10, 0.10, 0.02, 12), m.bone, 0, 1.50, 0.09, [Math.PI / 2, 0, 0]));
    [-0.62, 0.62].forEach((x) => {
      g.add(part(cyl(0.04, 0.07, 0.20, 8), m.brass, x, 1.41));
      g.add(part(cyl(0.026, 0.030, 0.14, 8), m.wax, x, 1.58));
    });
    const glow = new THREE.PointLight(0xff7a2e, 5, 4.5, 1.8);
    glow.position.set(0, 0.30, 0.35);
    g.add(glow);
    g.userData.light = glow;
    g.userData.flicker = true;
    g.userData.collider = { w: 2.1, d: 0.55, h: 2.4 };
    return g;
  },
  longcaseClock(m) {
    const g = group(
      part(box(0.52, 1.40, 0.30), m.panel, 0, 0.72),              // trunk
      part(box(0.40, 0.90, 0.03), m.glass, 0, 0.86, 0.16),
      part(box(0.60, 0.22, 0.36), m.trim, 0, 1.50),
      part(box(0.58, 0.62, 0.34), m.panel, 0, 1.90),              // hood
      part(box(0.66, 0.14, 0.40), m.trim, 0, 2.26),
      part(cyl(0.05, 0.05, 0.16, 8), m.brass, 0, 2.40),
      part(new THREE.SphereGeometry(0.055, 10, 8), m.brass, 0, 2.50),
      part(box(0.58, 0.20, 0.34), m.panel, 0, 0.10),              // plinth
    );
    // dial, hands and the pendulum behind the glass
    g.add(part(cyl(0.19, 0.19, 0.03, 20), m.bone, 0, 1.92, 0.16, [Math.PI / 2, 0, 0]));
    g.add(part(new THREE.TorusGeometry(0.19, 0.018, 6, 20), m.brass, 0, 1.92, 0.17));
    g.add(part(box(0.015, 0.14, 0.01), m.iron, 0, 1.98, 0.19));
    g.add(part(box(0.10, 0.014, 0.01), m.iron, 0.04, 1.92, 0.19, [0, 0, 0.5]));
    g.add(part(cyl(0.008, 0.008, 0.80, 6), m.brass, 0, 0.90, 0.02));
    g.add(part(cyl(0.09, 0.09, 0.015, 14), m.brass, 0, 0.50, 0.02, [Math.PI / 2, 0, 0]));
    g.userData.collider = { w: 0.7, d: 0.45, h: 2.5 };
    return g;
  },
  hallStand(m) {
    const g = group(
      part(box(1.20, 0.08, 0.36), m.panel, 0, 0.80),              // shelf
      part(box(1.10, 0.30, 0.32), m.panel, 0, 0.62),              // glove drawer
      part(box(1.24, 1.70, 0.06), m.panel, 0, 1.70, -0.16),       // back board
      part(box(0.70, 0.90, 0.02), m.mirror, 0, 1.72, -0.12),
      part(box(1.32, 0.12, 0.14), m.trim, 0, 2.58, -0.14),
      part(box(0.16, 0.80, 0.30), m.panel, -0.56, 0.40, 0),
      part(box(0.16, 0.80, 0.30), m.panel, 0.56, 0.40, 0),
    );
    [-0.50, -0.28, 0.28, 0.50].forEach((x, i) => {
      g.add(part(cyl(0.018, 0.018, 0.13, 6), m.brass, x, 2.30 - (i % 2) * 0.18, -0.10, [Math.PI / 2.5, 0, 0]));
      g.add(part(new THREE.SphereGeometry(0.030, 8, 6), m.brass, x, 2.24 - (i % 2) * 0.18, -0.03));
    });
    // a coat still hanging, and a stick in the well
    g.add(part(box(0.40, 0.90, 0.16), m.curtainCloth, -0.39, 1.70, 0.02));
    g.add(part(cyl(0.018, 0.018, 0.80, 6), m.panel, 0.58, 0.42, 0.02, [0.10, 0, 0.06]));
    g.userData.collider = { w: 1.35, d: 0.5, h: 2.6 };
    return g;
  },
  coatHooks(m) {
    const g = group(part(box(1.10, 0.16, 0.05), m.panel, 0, 0, 0));
    [-0.40, -0.13, 0.13, 0.40].forEach((x) => {
      g.add(part(cyl(0.014, 0.014, 0.11, 6), m.brass, x, -0.02, 0.06, [Math.PI / 2.3, 0, 0]));
      g.add(part(new THREE.SphereGeometry(0.024, 8, 6), m.brass, x, -0.06, 0.10));
    });
    g.add(part(box(0.36, 0.80, 0.14), m.curtainCloth, -0.13, -0.44, 0.10));
    g.userData.hangs = true;
    return g;
  },
  bellBoard(m) {
    const g = group(part(box(1.30, 0.44, 0.05), m.panel, 0, 0, 0));
    for (let i = -3; i <= 3; i += 1) {
      g.add(part(new THREE.SphereGeometry(0.055, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
        m.brass, i * 0.18, 0.12, 0.06, [Math.PI, 0, 0]));
      g.add(part(cyl(0.006, 0.006, 0.14, 4), m.iron, i * 0.18, 0.19, 0.06));
      g.add(part(box(0.13, 0.07, 0.01), m.bone, i * 0.18, -0.10, 0.055));
    }
    g.userData.hangs = true;
    return g;
  },
  umbrellaStand(m) {
    const g = group(
      part(cyl(0.20, 0.22, 0.60, 12), m.copper, 0, 0.30),
      part(new THREE.TorusGeometry(0.20, 0.02, 6, 14), m.copper, 0, 0.58, 0, [Math.PI / 2, 0, 0]),
      part(cyl(0.014, 0.014, 0.78, 6), m.panel, 0.05, 0.55, 0.03, [0.10, 0, 0.08]),
      part(cyl(0.014, 0.014, 0.72, 6), m.panel, -0.04, 0.52, -0.03, [-0.08, 0, -0.10]),
    );
    g.userData.collider = { w: 0.5, d: 0.5, h: 0.7 };
    return g;
  },
  librarySteps(m) {
    const g = new THREE.Group();
    for (let i = 0; i < 4; i += 1) {
      g.add(part(box(0.60, 0.05, 0.34), m.panel, 0, 0.22 + i * 0.22, -i * 0.16));
    }
    [-0.28, 0.28].forEach((x) => {
      g.add(part(box(0.06, 0.94, 0.06), m.panel, x, 0.47, 0.16, [-0.35, 0, 0]));
      g.add(part(box(0.06, 0.72, 0.06), m.panel, x, 0.36, -0.44, [0.30, 0, 0]));
    });
    g.userData.collider = { w: 0.7, d: 0.8, h: 1.0 };
    return g;
  },
  globe(m) {
    const g = group(
      part(new THREE.SphereGeometry(0.26, 16, 12), m.bone, 0, 1.02),
      part(new THREE.TorusGeometry(0.29, 0.018, 6, 20), m.brass, 0, 1.02, 0, [0, 0, 0.35]),
      part(cyl(0.028, 0.032, 0.72, 8), m.panel, 0, 0.40),
      part(cyl(0.20, 0.22, 0.05, 12), m.panel, 0, 0.05),
    );
    g.userData.collider = { w: 0.6, d: 0.6, h: 1.3 };
    return g;
  },
  bookStack(m) {
    const g = new THREE.Group();
    let y = 0;
    for (let i = 0; i < 4; i += 1) {
      const h = 0.05 + (i % 3) * 0.015;
      g.add(part(box(0.26 - i * 0.015, h, 0.19), m.books, 0, y + h / 2, 0, [0, i * 0.25, 0]));
      y += h;
    }
    return g;
  },
  pictureFrame(m, variant = 0) {
    const w = 0.7 + (variant % 3) * 0.22;
    const h = w * [1.30, 0.86, 1.05][variant % 3];
    const g = group(
      part(box(w, h, 0.07), m.gold, 0, 0, 0),
      part(box(w * 0.86, h * 0.86, 0.02), m.canvasArt, 0, 0, 0.04),
      part(box(w * 0.90, h * 0.90, 0.01), m.gold, 0, 0, 0.036),
    );
    g.userData.hangs = true;
    return g;
  },
  mirror(m) {
    const g = group(
      part(box(1.3, 2.1, 0.08), m.trim, 0, 1.1, -0.06),
      part(box(1.16, 1.94, 0.02), m.gold, 0, 1.1, -0.02),
      part(box(1.1, 1.9, 0.03), m.mirror, 0, 1.1, 0),
    );
    g.userData.collider = { w: 1.3, d: 0.3, h: 2.1 };
    return g;
  },
  curtain(m) {
    const g = new THREE.Group();
    // a pole with rings, and two gathered drops
    g.add(part(cyl(0.026, 0.026, 1.9, 8), m.brass, 0, 2.28, 0, [0, 0, Math.PI / 2]));
    [-0.90, 0.90].forEach((x) => g.add(part(new THREE.SphereGeometry(0.055, 10, 8), m.brass, x, 2.28, 0)));
    [-1, 1].forEach((side) => {
      for (let i = 0; i < 4; i += 1) {
        const x = side * (0.32 + i * 0.16);
        const w = 0.17 - i * 0.012;
        g.add(part(box(w, 1.72, 0.10 + i * 0.02), m.curtainCloth, x, 1.38, 0.02, [0, 0, side * 0.02]));
      }
      g.add(part(box(0.68, 0.10, 0.14), m.curtainCloth, side * 0.60, 1.10, 0.04));
    });
    g.userData.hangs = true;
    return g;
  },
  rugMat(m) {
    const w = 3.0;
    const d = 2.1;
    const mesh = new THREE.Mesh(box(w, 0.035, d), m.rug);
    mesh.position.y = 0.018;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    const g = group(mesh);
    // fringe at both ends
    for (let i = 0; i < 22; i += 1) {
      const x = -w / 2 + 0.08 + (i / 21) * (w - 0.16);
      [-1, 1].forEach((side) => {
        g.add(part(box(0.02, 0.012, 0.09), m.rug, x, 0.012, side * (d / 2 + 0.045)));
      });
    }
    g.userData.rug = { w, d };
    return g;
  },
  pillar(m) {
    const g = group(
      part(cyl(0.34, 0.40, 3.4, 14), m.stoneTrim, 0, 1.9),
      part(box(1.0, 0.22, 1.0), m.stoneTrim, 0, 0.11),            // base
      part(box(0.92, 0.16, 0.92), m.stoneTrim, 0, 0.30),
      part(box(1.05, 0.26, 1.05), m.stoneTrim, 0, 3.72),          // capital
      part(box(0.90, 0.20, 0.90), m.stoneTrim, 0, 3.52),
    );
    g.userData.collider = { w: 1.0, d: 1.0, h: 3.9 };
    return g;
  },
  rubble(m) {
    const g = new THREE.Group();
    for (let i = 0; i < 7; i += 1) {
      const a = (i / 7) * Math.PI * 2;
      const r = 0.1 + (i % 4) * 0.16;
      g.add(part(new THREE.DodecahedronGeometry(0.10 + (i % 3) * 0.07, 0), m.stoneTrim,
        Math.cos(a) * r, 0.08 + (i % 3) * 0.06, Math.sin(a) * r, [i, i * 0.7, i * 1.4]));
    }
    return g;
  },

  // ---- light fittings ----
  candle(m) {
    const g = group(
      part(cyl(0.05, 0.06, 0.28, 8), m.wax, 0, 0.14),
      part(cyl(0.09, 0.10, 0.02, 10), m.brass, 0, 0.01),
    );
    const light = new THREE.PointLight(0xffa04a, 16, 8, 1.6);
    light.position.set(0, 0.36, 0);
    light.castShadow = false;
    g.add(light);
    g.userData.light = light;
    g.userData.flicker = true;
    return g;
  },
  chandelier(m) {
    const g = group(
      part(cyl(0.03, 0.03, 1.4, 6), m.brass, 0, -0.7),
      part(new THREE.SphereGeometry(0.10, 10, 8), m.brass, 0, -1.34),
      part(new THREE.TorusGeometry(0.55, 0.05, 6, 18), m.brass, 0, -1.4, 0, [Math.PI / 2, 0, 0]),
    );
    // six arms, each with a candle and a hanging drop
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2;
      const x = Math.cos(a) * 0.55;
      const z = Math.sin(a) * 0.55;
      g.add(part(cyl(0.018, 0.018, 0.34, 6), m.brass, x * 0.55, -1.46, z * 0.55, [0, -a, 0.9]));
      g.add(part(cyl(0.075, 0.05, 0.05, 8), m.brass, x, -1.30, z));
      g.add(part(cyl(0.028, 0.032, 0.16, 8), m.wax, x, -1.20, z));
      g.add(part(new THREE.OctahedronGeometry(0.045, 0), m.glass, x * 0.82, -1.58, z * 0.82));
    }
    const light = new THREE.PointLight(0xffb060, 34, 15, 1.6);
    light.position.set(0, -1.4, 0);
    g.add(light);
    g.userData.light = light;
    g.userData.flicker = true;
    g.userData.hangs = true;
    return g;
  },
  gasolier(m) {
    const g = group(
      part(cyl(0.026, 0.026, 1.1, 6), m.brass, 0, -0.55),
      part(cyl(0.14, 0.10, 0.12, 10), m.brass, 0, -1.14),
    );
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const x = Math.cos(a) * 0.42;
      const z = Math.sin(a) * 0.42;
      g.add(part(cyl(0.014, 0.014, 0.46, 6), m.brass, x * 0.5, -1.20, z * 0.5, [0, -a, 1.15]));
      g.add(part(cyl(0.10, 0.055, 0.16, 10, 1, true), m.glass, x, -1.32, z));
    }
    const light = new THREE.PointLight(0xffb066, 24, 12, 1.6);
    light.position.set(0, -1.3, 0);
    g.add(light);
    g.userData.light = light;
    g.userData.flicker = true;
    g.userData.hangs = true;
    return g;
  },
  oilLamp(m) {
    const g = group(
      part(box(0.16, 0.26, 0.05), m.brass, 0, 0, 0),               // back plate
      part(cyl(0.018, 0.018, 0.16, 6), m.brass, 0, -0.02, 0.09, [Math.PI / 2, 0, 0]),
      part(cyl(0.075, 0.055, 0.09, 10), m.brass, 0, 0.02, 0.18),   // font
      part(cyl(0.055, 0.085, 0.22, 10, 1, true), m.glass, 0, 0.17, 0.18),  // chimney
    );
    const light = new THREE.PointLight(0xffc27a, 15, 9, 1.6);
    light.position.set(0, 0.16, 0.20);
    g.add(light);
    g.userData.light = light;
    g.userData.flicker = true;
    g.userData.hangs = true;
    return g;
  },
  sconce(m) {
    const g = group(
      part(box(0.16, 0.30, 0.05), m.brass, 0, 0, 0),
      part(cyl(0.02, 0.02, 0.22, 6), m.brass, 0, 0.02, 0.11, [Math.PI / 2.6, 0, 0]),
      part(cyl(0.075, 0.045, 0.16, 8, 1, true), m.brass, 0, 0.16, 0.20),
      part(cyl(0.028, 0.032, 0.14, 8), m.wax, 0, 0.26, 0.20),
    );
    const light = new THREE.PointLight(0xffa851, 13, 8.5, 1.6);
    light.position.set(0, 0.36, 0.22);
    g.add(light);
    g.userData.light = light;
    g.userData.flicker = true;
    g.userData.hangs = true;
    return g;
  },
  bareBulb(m) {
    const g = group(
      part(cyl(0.004, 0.004, 0.75, 4), m.iron, 0, -0.38),
      part(cyl(0.030, 0.036, 0.07, 8), m.brass, 0, -0.78),
      part(new THREE.SphereGeometry(0.055, 10, 8), m.glass, 0, -0.86),
    );
    const light = new THREE.PointLight(0xffe2b0, 12, 9, 1.7);
    light.position.set(0, -0.86, 0);
    g.add(light);
    g.userData.light = light;
    g.userData.flicker = true;
    g.userData.hangs = true;
    return g;
  },
  lantern(m) {
    const g = group(
      part(box(0.20, 0.28, 0.20), m.glass, 0, 0.9),
      part(box(0.22, 0.03, 0.22), m.iron, 0, 1.05),
      part(box(0.22, 0.03, 0.22), m.iron, 0, 0.75),
      part(box(0.06, 0.9, 0.06), m.iron, 0, 0.45),
      part(new THREE.TorusGeometry(0.05, 0.008, 5, 10), m.iron, 0, 1.11),
    );
    const light = new THREE.PointLight(0x86c8ff, 20, 11, 1.6);
    light.position.set(0, 0.95, 0);
    g.add(light);
    g.userData.light = light;
    g.userData.flicker = true;
    return g;
  },

  // ---- narrative dressing (unchanged behaviour) ----
  piano(m) {
    const g = group(
      part(box(1.5, 0.9, 0.7), m.panel, 0, 0.6),
      part(box(1.4, 0.06, 0.2), m.bone, 0, 1.02, 0.3),
      part(box(0.12, 0.6, 0.12), m.panel, -0.6, 0.3, 0.25),
      part(box(0.12, 0.6, 0.12), m.panel, 0.6, 0.3, 0.25),
    );
    for (let i = -8; i <= 8; i += 1) {
      if (i % 3 === 0) g.add(part(box(0.035, 0.02, 0.13), m.cloth, i * 0.078, 1.06, 0.27));
    }
    g.userData.collider = { w: 1.7, d: 0.9, h: 1.1 };
    g.userData.interact = { type: 'piano' };
    return g;
  },
  painting(m) {
    return group(
      part(box(1.0, 1.3, 0.08), m.gold, 0, 2.0),
      part(box(0.85, 1.15, 0.02), m.canvasArt, 0, 2.0, 0.05),
    );
  },
  bed(m) {
    const g = group(
      part(box(1.2, 0.35, 2.1), m.panel, 0, 0.35),
      part(box(1.15, 0.18, 2.0), m.cloth, 0, 0.6),
      part(box(1.3, 0.9, 0.1), m.panel, 0, 0.72, -1.05),
    );
    g.userData.collider = { w: 1.4, d: 2.2, h: 0.8 };
    return g;
  },
  corpse(m, variant = 0) {
    const g = group(
      part(box(0.45, 0.22, 1.4), m.cloth, 0, 0.12),
      part(new THREE.SphereGeometry(0.16, 10, 8), m.bone, 0, 0.18, 0.82),
      part(box(0.16, 0.14, 0.7), m.cloth, -0.32, 0.1, 0.1),
      part(box(0.16, 0.14, 0.7), m.cloth, 0.32, 0.1, 0.1),
    );
    g.rotation.y = variant * 2.1;
    return g;
  },
  altar(m) {
    const g = group(
      part(box(2.2, 0.25, 1.3), m.stoneTrim, 0, 0.95),
      part(box(1.9, 0.95, 1.0), m.stoneTrim, 0, 0.48),
      part(box(0.1, 1.6, 0.1), m.panel, 0, 1.8, -0.5),
      part(box(0.8, 0.1, 0.1), m.panel, 0, 2.1, -0.5),
    );
    g.userData.collider = { w: 2.3, d: 1.4, h: 1.2 };
    return g;
  },
  cage(m) {
    const g = new THREE.Group();
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      g.add(part(box(0.06, 2.0, 0.06), m.iron, Math.cos(a) * 0.55, 1.0, Math.sin(a) * 0.55));
    }
    g.add(part(new THREE.TorusGeometry(0.55, 0.05, 6, 16), m.iron, 0, 2.0, 0, [Math.PI / 2, 0, 0]));
    g.userData.collider = { w: 1.2, d: 1.2, h: 2.0 };
    return g;
  },
  hook(m) {
    const g = group(
      part(box(0.04, 2.4, 0.04), m.iron, 0, 2.4),
      part(new THREE.TorusGeometry(0.18, 0.045, 6, 12, Math.PI * 1.4), m.iron, 0, 1.2, 0, [0, 0, Math.PI * 0.2]),
    );
    g.userData.swings = true;
    g.userData.merge = false;
    return g;
  },
  stairs(m) {
    const g = new THREE.Group();
    for (let i = 0; i < 10; i += 1) {
      g.add(part(box(2.2, 0.2, 0.34), m.panel, 0, 0.1 + i * 0.24, -1.6 + i * 0.34));
    }
    return g;
  },
  bloodPool(m, variant = 0) {
    const geo = new THREE.CircleGeometry(0.9 + (variant % 3) * 0.22, 16);
    const mesh = new THREE.Mesh(geo, m.blood);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.012;
    mesh.receiveShadow = true;
    mesh.material.userData.reflectivity = 0.85;
    return group(mesh);
  },
  fuseBox(m) {
    const g = group(
      part(box(0.7, 0.9, 0.25), m.iron, 0, 1.4),
      part(box(0.5, 0.7, 0.05), m.panel, 0, 1.4, 0.15),
    );
    g.userData.collider = { w: 0.8, d: 0.4, h: 2.0 };
    return g;
  },
  car(m) {
    const paint = new THREE.MeshStandardMaterial({ color: 0x2c3742, roughness: 0.35, metalness: 0.85 });
    paint.userData.reflectivity = 0.7;
    const glass = m.glass;
    const tyre = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.95 });
    const wheel = cyl(0.34, 0.34, 0.24, 14);
    const g = group(
      part(box(1.9, 0.55, 4.2), paint, 0, 0.62),
      part(box(1.7, 0.62, 2.0), paint, 0, 1.15, -0.2),
      part(box(1.62, 0.5, 0.06), glass, 0, 1.2, 0.82),
      part(box(0.06, 0.5, 1.9), glass, 0.82, 1.2, -0.2),
      part(box(0.06, 0.5, 1.9), glass, -0.82, 1.2, -0.2),
    );
    [[-0.88, 1.35], [0.88, 1.35], [-0.88, -1.45], [0.88, -1.45]].forEach(([x, z]) => {
      g.add(part(wheel, tyre, x, 0.34, z, [0, 0, Math.PI / 2]));
    });
    const head = new THREE.PointLight(0xfff2cc, 0, 9, 1.6);
    head.position.set(0, 0.7, 2.2);
    g.add(head);
    g.userData.light = head;
    g.userData.collider = { w: 2.2, d: 4.4, h: 1.6 };
    g.rotation.y = 0.22;
    g.userData.merge = false;
    return g;
  },
  valve(m) {
    const g = group(
      part(new THREE.TorusGeometry(0.32, 0.06, 8, 16), m.iron, 0, 1.2),
      part(box(0.22, 0.22, 0.3), m.iron, 0, 1.2, -0.2),
    );
    g.userData.collider = { w: 0.7, d: 0.5, h: 1.6 };
    return g;
  },
};

/**
 * Props that build a few different shapes, so a wall of pictures or a shelf of
 * pots is not the same object stamped out N times. The dresser cycles the
 * variant index; the factory reads it instead of rolling a die, which keeps a
 * level identical between loads.
 */
const VARIED = new Set(['pictureFrame', 'pot', 'crate', 'corpse', 'bookStack', 'rubble', 'clothPile']);

/** Fixtures the room lighting rules may hang. */
const FIXTURES = {
  chandelier: 'chandelier', gasolier: 'gasolier', sconce: 'sconce',
  oilLamp: 'oilLamp', bareBulb: 'bareBulb', candles: 'candle', lantern: 'lantern',
};

// --- level construction -----------------------------------------------------

/** Deterministic per-room RNG, so a level dresses identically every load. */
function rng(seed) {
  let s = (seed * 1103515245 + 12345) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s >>> 8) / 16777216;
  };
}

export class Level {
  constructor(def, textures) {
    this.def = def;
    const blueprint = def.blueprint || def.grid;
    // blueprints now carry a zone map; a bare string grid is still accepted
    if (Array.isArray(blueprint)) {
      this.grid = blueprint;
      this.zones = null;
      this.rooms = [];
    } else {
      this.grid = blueprint.grid;
      this.zones = blueprint.zones;
      this.rooms = blueprint.rooms || [];
    }
    this.rows = this.grid.length;
    this.cols = Math.max(...this.grid.map((r) => r.length));
    this.wallHeight = def.wallHeight ?? 4.2;
    this.materials = createMaterials(textures);
    this.matCache = new Map();
    Object.entries(def.materialOverrides || {}).forEach(([key, patch]) => {
      const material = this.materials[key];
      if (!material) return;
      if (patch.color !== undefined) material.color.setHex(patch.color);
      if (patch.roughness !== undefined) material.roughness = patch.roughness;
      if (patch.reflectivity !== undefined) material.userData.reflectivity = patch.reflectivity;
    });
    this.group = new THREE.Group();
    this.props = [];
    this.lights = [];
    this.doors = [];
    this.markers = {};
    this.propColliders = [];
    this.waterTiles = new Set();
    this.floorKind = new Map();
    this.occupied = new Set();
    this.templates = new Map();
    this.pending = new Map();
    this.dressed = [];
    this.solid = new Uint8Array(this.rows * this.cols);
    this.build();
  }

  charAt(col, row) {
    if (row < 0 || row >= this.rows) return ' ';
    const line = this.grid[row];
    if (col < 0 || col >= line.length) return ' ';
    return line[col];
  }

  /** The room record owning a tile, or null outside any room. */
  roomAt(col, row) {
    if (!this.zones || row < 0 || row >= this.rows || col < 0 || col >= this.cols) return null;
    const id = this.zones[row * this.cols + col];
    return id < 0 ? null : this.rooms[id] || null;
  }

  /** The room type spec governing a tile's look. */
  styleAt(col, row) {
    return roomType(this.roomAt(col, row)?.type);
  }

  toWorld(col, row) {
    return new THREE.Vector3(
      (col - this.cols / 2 + 0.5) * TILE,
      0,
      (row - this.rows / 2 + 0.5) * TILE
    );
  }

  toGrid(x, z) {
    return {
      col: Math.floor(x / TILE + this.cols / 2),
      row: Math.floor(z / TILE + this.rows / 2),
    };
  }

  isSolid(col, row) {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return true;
    return this.solid[row * this.cols + col] === 1;
  }

  isSolidWorld(x, z) {
    const { col, row } = this.toGrid(x, z);
    return this.isSolid(col, row);
  }

  surfaceAt(x, z) {
    const { col, row } = this.toGrid(x, z);
    return this.floorKind.get(`${col},${row}`) || 'wood';
  }

  /** A material variant tinted for one room, cached so draw calls stay low. */
  materialFor(key, tint = 0xffffff) {
    const id = `${key}:${tint}`;
    const hit = this.matCache.get(id);
    if (hit) return hit;
    const base = this.materials[key] || this.materials.wallPaper;
    const material = tint === 0xffffff ? base : base.clone();
    if (tint !== 0xffffff) {
      material.color.setHex(tint);
      material.userData = { ...base.userData };
    }
    this.matCache.set(id, material);
    return material;
  }

  build() {
    const m = this.materials;
    const def = this.def;
    const floorBuckets = new Map();
    const wallBuckets = new Map();
    const ceilingBuckets = new Map();

    for (let row = 0; row < this.rows; row += 1) {
      for (let col = 0; col < this.cols; col += 1) {
        const ch = this.charAt(col, row);
        if (ch === ' ') { this.solid[row * this.cols + col] = 1; continue; }

        if (WALL_CHARS.has(ch)) {
          this.solid[row * this.cols + col] = 1;
          // a wall carcass takes the look of whichever room it borders; the
          // faces the player actually sees are panelled per-room below
          const neighbour = DIRS.map(([dc, dr]) => this.roomAt(col + dc, row + dr)).find(Boolean);
          const style = roomType(neighbour?.type);
          const key = ch === 'X' ? 'panel|16777215' : `${style.wall.field}|${style.wall.tint}`;
          if (!wallBuckets.has(key)) wallBuckets.set(key, []);
          wallBuckets.get(key).push([col, row]);
          continue;
        }

        // walkable
        const behaviour = FLOOR_TYPES[ch];
        const style = this.styleAt(col, row);
        const isWater = behaviour === 'water';
        const material = isWater ? 'water' : (style.floor || def.defaultFloor || 'woodFloor');
        const tint = isWater ? 0xffffff : (style.floorTint ?? 0xffffff);

        this.floorKind.set(`${col},${row}`, STEP_KIND[material] || 'wood');
        const bucketKey = `${material}|${tint}`;
        if (!floorBuckets.has(bucketKey)) floorBuckets.set(bucketKey, []);
        floorBuckets.get(bucketKey).push([col, row]);
        if (isWater) this.waterTiles.add(`${col},${row}`);

        if (style.ceiling && def.ceiling !== false) {
          // A ceiling takes its own tint, never the wall's. Inheriting it made
          // every papered room sit under a ceiling as dark as its walls, which
          // is the fastest way to make an interior read as a cave.
          const ceilTint = style.ceiling.tint ?? 0xe8e4dc;
          const ck = `${style.ceiling.material}|${ceilTint}|${style.ceiling.treatment}`;
          if (!ceilingBuckets.has(ck)) ceilingBuckets.set(ck, []);
          ceilingBuckets.get(ck).push([col, row]);
        }

        if (ch === '+') {
          this.solid[row * this.cols + col] = 1; // doors start closed
          this.doors.push({ col, row, open: false, mesh: null, locked: false, id: null });
        } else if (!FLOOR_TYPES[ch]) {
          this.markers[ch] = this.markers[ch] || [];
          this.markers[ch].push({ col, row, pos: this.toWorld(col, row) });
        }
      }
    }

    this.#buildFloors(floorBuckets);
    this.#buildWalls(wallBuckets);
    this.#buildCeilings(ceilingBuckets);
    this.#buildDoors();
    this.#buildWallFaces();
    this.#buildWindows();
    this.#buildRoomLights();
    this.#dressRooms();

    (def.props || []).forEach((spec) => this.placeProp(spec));
    this.#flushProps();
    void m;
  }

  #instance(geometry, material, cells, yOffset, tint = 1) {
    if (!cells.length) return null;
    const mesh = new THREE.InstancedMesh(geometry, material, cells.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    cells.forEach(([col, row], i) => {
      const p = this.toWorld(col, row);
      dummy.position.set(p.x, yOffset, p.z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const v = 0.82 + ((col * 7 + row * 13) % 11) / 32;
      color.setRGB(v * tint, v * tint, v * tint);
      mesh.setColorAt(i, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);
    return mesh;
  }

  #buildFloors(buckets) {
    const floorGeo = box(TILE, 0.2, TILE);
    buckets.forEach((cells, key) => {
      const [name, tintStr] = key.split('|');
      const tint = Number(tintStr);
      if (name === 'water') {
        this.#instance(box(TILE, 0.1, TILE), this.materials.concrete, cells, -0.16, 0.8);
        const water = this.#instance(box(TILE, 0.28, TILE), this.materials.water, cells, -0.02, 1);
        if (water) {
          water.material.userData.reflectivity = 0.95;
          water.castShadow = false;
          this.waterMesh = water;
        }
        return;
      }
      const inst = this.#instance(floorGeo, this.materialFor(name, tint), cells, -0.1, 1);
      if (inst) inst.castShadow = false;
    });
  }

  #buildWalls(buckets) {
    const wallGeo = box(TILE, this.wallHeight, TILE);
    buckets.forEach((cells, key) => {
      const [name, tintStr] = key.split('|');
      this.#instance(wallGeo, this.materialFor(name, Number(tintStr)), cells, this.wallHeight / 2, 1);
    });
  }

  /**
   * Ceilings vary by room: flat plaster in the service rooms, a moulded rose
   * in the drawing room, exposed beams in the kitchen, a coffer grid in the
   * library, brick vaults in the cellars.
   */
  #buildCeilings(buckets) {
    const H = this.wallHeight;
    buckets.forEach((cells, key) => {
      const [name, tintStr, treatment] = key.split('|');
      const material = this.materialFor(name, Number(tintStr));
      const slab = this.#instance(box(TILE, 0.25, TILE), material, cells, H + 0.1, 0.7);
      if (slab) slab.castShadow = false;

      if (treatment === 'beams') {
        const beam = this.#instance(box(TILE, 0.26, 0.30), this.materials.panel, cells, H - 0.14, 0.75);
        if (beam) beam.castShadow = false;
      } else if (treatment === 'coffer') {
        // a moulded grid: ribs both ways with a recessed panel between
        const rib = box(TILE, 0.16, 0.14);
        const a = this.#instance(rib, this.materials.trim, cells, H - 0.09, 0.8);
        if (a) a.castShadow = false;
        const b = new THREE.InstancedMesh(box(0.14, 0.16, TILE), this.materials.trim, cells.length);
        const dummy = new THREE.Object3D();
        cells.forEach(([col, row], i) => {
          const p = this.toWorld(col, row);
          dummy.position.set(p.x, H - 0.09, p.z);
          dummy.updateMatrix();
          b.setMatrixAt(i, dummy.matrix);
        });
        b.instanceMatrix.needsUpdate = true;
        b.castShadow = false;
        this.group.add(b);
      } else if (treatment === 'rose') {
        // one moulded rose per room, under the centre tile only
        const centres = this.#roomCentres(cells);
        centres.forEach((p) => {
          const rose = group(
            part(cyl(0.62, 0.62, 0.07, 24), this.materials.ceilingPlaster, 0, 0),
            part(cyl(0.44, 0.44, 0.07, 20), this.materials.ceilingPlaster, 0, -0.05),
            part(cyl(0.20, 0.20, 0.09, 16), this.materials.ceilingPlaster, 0, -0.10),
          );
          for (let i = 0; i < 12; i += 1) {
            const a = (i / 12) * Math.PI * 2;
            rose.add(part(box(0.30, 0.05, 0.11), this.materials.ceilingPlaster,
              Math.cos(a) * 0.40, -0.04, Math.sin(a) * 0.40, [0, -a, 0]));
          }
          const merged = mergeGroup(rose);
          merged.position.set(p.x, H - 0.06, p.z);
          merged.children.forEach((c) => { c.castShadow = false; });
          this.group.add(merged);
        });
      } else if (treatment === 'vault') {
        // shallow brick barrel vaults springing off the walls
        const arc = new THREE.CylinderGeometry(TILE * 0.62, TILE * 0.62, TILE, 12, 1, true, 0, Math.PI);
        // a clone: flipping `side` on the cached material would make every
        // wall using this brick double-sided too
        const vaultMaterial = material.clone();
        vaultMaterial.userData = { ...material.userData };
        vaultMaterial.side = THREE.DoubleSide;
        const vault = new THREE.InstancedMesh(arc, vaultMaterial, cells.length);
        const dummy = new THREE.Object3D();
        cells.forEach(([col, row], i) => {
          const p = this.toWorld(col, row);
          dummy.position.set(p.x, H - TILE * 0.34, p.z);
          dummy.rotation.set(Math.PI / 2, 0, 0);
          dummy.updateMatrix();
          vault.setMatrixAt(i, dummy.matrix);
        });
        vault.instanceMatrix.needsUpdate = true;
        vault.castShadow = false;
        vault.receiveShadow = true;
        this.group.add(vault);
      }
    });
  }

  /** One representative world point per room among the given cells. */
  #roomCentres(cells) {
    const byRoom = new Map();
    cells.forEach(([col, row]) => {
      const id = this.zones ? this.zones[row * this.cols + col] : -1;
      if (id < 0) return;
      if (!byRoom.has(id)) byRoom.set(id, []);
      byRoom.get(id).push([col, row]);
    });
    const out = [];
    byRoom.forEach((list) => {
      let sc = 0;
      let sr = 0;
      list.forEach(([c, r]) => { sc += c; sr += r; });
      const cc = Math.round(sc / list.length);
      const rr = Math.round(sr / list.length);
      // snap to an actual tile of the room
      let best = list[0];
      let bestD = 1e9;
      list.forEach(([c, r]) => {
        const d = Math.hypot(c - cc, r - rr);
        if (d < bestD) { bestD = d; best = [c, r]; }
      });
      out.push(this.toWorld(best[0], best[1]));
    });
    return out;
  }

  /**
   * Every wall face a room can see, built up the way Victorian joinery is:
   * skirting, then panelled wainscot, dado rail, the papered field, a picture
   * rail, and the cornice. This is also what solves a one-tile partition
   * having a kitchen on one side and a library on the other — the covering
   * belongs to the face, not to the wall block.
   */
  #buildWallFaces() {
    const H = this.wallHeight;
    const buckets = new Map();
    // a doorway must not get skirted and papered across its opening
    const doorTiles = new Set(this.doors.map((d) => `${d.col},${d.row}`));

    const add = (key, geo, material, edge, y, depth) => {
      if (!buckets.has(key)) buckets.set(key, { geo, material, items: [] });
      buckets.get(key).items.push([edge, y, depth]);
    };

    this.floorKind.forEach((kind, cellKey) => {
      if (doorTiles.has(cellKey)) return;
      const [col, row] = cellKey.split(',').map(Number);
      const style = this.styleAt(col, row);
      const w = style.wall;
      // an outdoor "room" is a garden or a drive: a boundary wall, not joinery
      const outdoor = !style.ceiling || this.def.ceiling === false;
      DIRS.forEach(([dc, dr, yaw]) => {
        if (!this.isSolid(col + dc, row + dr)) return;
        const edge = [col, row, dc, dr, yaw];
        const tint = w.tint ?? 0xffffff;
        const dado = w.wainscot && !outdoor ? w.dado : 0;
        const picture = w.picture && !outdoor ? Math.min(H - 0.42, 2.55) : H - 0.13;

        if (outdoor) {
          add(`outer|${w.field}|${tint}`, box(TILE, H - 0.1, 0.05),
            this.materialFor(w.field, tint), edge, (H - 0.1) / 2, 0.472);
          return;
        }

        // skirting
        add(`skirt|${tint}`, box(TILE, 0.19, 0.09), this.materials.trim, edge, 0.095, 0.455);

        if (w.wainscot && dado > 0.3) {
          const h = dado - 0.19;
          add(`wainscot|${w.wainscot}|${h.toFixed(2)}`, box(TILE, h, 0.06),
            this.materialFor(w.wainscot), edge, 0.19 + h / 2, 0.468);
          add(`dado|${dado.toFixed(2)}`, box(TILE, 0.10, 0.12), this.materials.trim,
            edge, dado + 0.05, 0.452);
        }

        // the papered (or brick, or limewashed) field
        const fieldBottom = dado > 0.3 ? dado + 0.10 : 0.19;
        const fieldH = picture - fieldBottom;
        if (fieldH > 0.2) {
          add(`field|${w.field}|${tint}|${fieldH.toFixed(2)}|${fieldBottom.toFixed(2)}`,
            box(TILE, fieldH, 0.05), this.materialFor(w.field, tint),
            edge, fieldBottom + fieldH / 2, 0.472);
        }

        if (w.picture) {
          add('picrail', box(TILE, 0.07, 0.09), this.materials.trim, edge, picture + 0.035, 0.455);
          const friezeH = H - 0.13 - (picture + 0.07);
          if (friezeH > 0.1) {
            add(`frieze|${friezeH.toFixed(2)}`, box(TILE, friezeH, 0.05),
              this.materialFor('ceilingPlaster', tint), edge, picture + 0.07 + friezeH / 2, 0.472);
          }
        }

        add('cornice', box(TILE, 0.15, 0.15), this.materials.trim, edge, H - 0.075, 0.44);
      });
    });

    const dummy = new THREE.Object3D();
    buckets.forEach(({ geo, material, items }) => {
      const mesh = new THREE.InstancedMesh(geo, material, items.length);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      items.forEach(([[col, row, dc, dr, yaw], y, depth], i) => {
        const p = this.toWorld(col, row);
        dummy.position.set(p.x + dc * TILE * depth, y, p.z + dr * TILE * depth);
        dummy.rotation.set(0, yaw, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
    });
  }

  #buildDoors() {
    const m = this.materials;
    const trim = m[this.def.trimMaterial || 'trim'] || m.trim;
    const doorH = Math.min(this.wallHeight * 0.86, 2.35);
    this.doors.forEach((door) => {
      const p = this.toWorld(door.col, door.row);
      const horizontal = this.isSolid(door.col - 1, door.row) && this.isSolid(door.col + 1, door.row);
      const frame = new THREE.Group();
      frame.position.set(p.x, 0, p.z);
      if (!horizontal) frame.rotation.y = Math.PI / 2;

      const jambT = 0.14;
      const opening = TILE - jambT * 2;
      frame.add(part(box(TILE, this.wallHeight - doorH, 0.34), trim,
        0, doorH + (this.wallHeight - doorH) / 2, 0));
      frame.add(part(box(TILE * 1.02, 0.16, 0.40), trim, 0, doorH, 0));
      [-1, 1].forEach((side) => {
        frame.add(part(box(jambT, doorH, 0.34), trim, side * (TILE - jambT) / 2, doorH / 2, 0));
      });
      frame.add(part(box(opening, 0.05, 0.30), trim, 0, 0.025, 0));
      // the frame is already positioned, and mergeGroup bakes world transforms
      // into the vertices, so the merged result belongs at the origin
      this.group.add(mergeGroup(frame));

      const pivot = new THREE.Group();
      pivot.position.copy(frame.position);
      pivot.rotation.y = frame.rotation.y;
      pivot.translateX(-opening / 2);
      const leafW = opening * 0.98;
      const leaf = new THREE.Group();
      leaf.add(part(box(leafW, doorH * 0.985, 0.055), m.panel, leafW / 2, doorH / 2, 0));
      [0.30, 0.68].forEach((h) => {
        leaf.add(part(box(leafW * 0.66, doorH * 0.26, 0.02), trim, leafW / 2, doorH * h, 0.038));
        leaf.add(part(box(leafW * 0.58, doorH * 0.20, 0.015), m.panel, leafW / 2, doorH * h, 0.048));
      });
      leaf.add(part(box(leafW, 0.09, 0.03), trim, leafW / 2, doorH * 0.49, 0.038));
      leaf.add(part(box(0.10, 0.16, 0.02), m.brass, leafW * 0.88, doorH * 0.46, 0.04));
      leaf.add(part(cyl(0.022, 0.022, 0.09, 8), m.brass,
        leafW * 0.88, doorH * 0.46, 0.085, [Math.PI / 2, 0, 0]));
      leaf.add(part(new THREE.SphereGeometry(0.045, 10, 8), m.brass, leafW * 0.88, doorH * 0.46, 0.125));
      [0.18, 0.82].forEach((h) => {
        leaf.add(part(box(0.04, 0.13, 0.05), m.brass, 0.02, doorH * h, 0.0));
      });
      pivot.add(mergeGroup(leaf));

      door.baseRotation = pivot.rotation.y;
      door.mesh = pivot;
      this.group.add(pivot);
    });
  }

  /**
   * Windows punched into the walls that face outside, with night behind them.
   * Every window in a chapter is identical, so one template is built and the
   * whole set goes down as three instanced meshes rather than eight per window.
   */
  #buildWindows() {
    if (this.def.windows === false) return;
    const m = this.materials;
    this.windows = [];

    // 1. find the openings
    const spots = [];
    const limit = this.def.windowLimit ?? 16;
    this.floorKind.forEach((kind, key) => {
      if (spots.length >= limit) return;
      const [col, row] = key.split(',').map(Number);
      if ((col * 7 + row * 11) % 6 !== 0) return;
      const dir = DIRS.find(([dc, dr]) => {
        if (!this.isSolid(col + dc, row + dr)) return false;
        // there must be open void directly behind the wall for night to show
        return this.charAt(col + dc * 2, row + dr * 2) === ' ';
      });
      if (!dir) return;
      spots.push([col, row, dir]);
      this.windows.push({ col, row, dir });
    });
    if (!spots.length) return;

    // 2. build one window at the origin
    const night = new THREE.MeshStandardMaterial({
      color: 0x0b1220, emissive: 0x25406e, emissiveIntensity: 0.85, roughness: 0.25, metalness: 0.1,
    });
    night.userData.reflectivity = 0.35;
    const sill = Math.min(1.05, this.wallHeight * 0.28);
    const h = Math.min(1.35, this.wallHeight * 0.42);
    const w = TILE * 0.62;
    const template = new THREE.Group();
    template.add(part(box(w, h, 0.05), night, 0, sill + h / 2, 0.03));
    template.add(part(box(w, h, 0.03), m.glass, 0, sill + h / 2, 0.06));
    template.add(part(box(w + 0.18, 0.10, 0.14), m.trim, 0, sill + h + 0.05, 0.07));
    template.add(part(box(w + 0.18, 0.12, 0.22), m.trim, 0, sill - 0.05, 0.09));
    [-1, 1].forEach((side) => {
      template.add(part(box(0.09, h + 0.1, 0.14), m.trim, side * (w / 2 + 0.045), sill + h / 2, 0.07));
    });
    template.add(part(box(0.05, h, 0.10), m.trim, 0, sill + h / 2, 0.08));
    template.add(part(box(w, 0.05, 0.10), m.trim, 0, sill + h * 0.5, 0.08));

    // 3. stamp it out
    const merged = mergeGroup(template);
    const dummy = new THREE.Object3D();
    merged.children.filter((c) => c.isMesh).forEach((child) => {
      const mesh = new THREE.InstancedMesh(child.geometry, child.material, spots.length);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      spots.forEach(([col, row, [dc, dr, yaw]], i) => {
        const p = this.toWorld(col, row);
        dummy.position.set(p.x + dc * TILE * 0.49, 0, p.z + dr * TILE * 0.49);
        dummy.rotation.set(0, yaw, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
    });
  }

  // --- lighting -------------------------------------------------------------

  /**
   * Fixtures follow the room, not a modulo pattern: a chandelier hangs in the
   * middle of the hall, sconces run the walls of a corridor at even spacing,
   * a bare bulb dangles in the scullery.
   */
  #buildRoomLights() {
    const byRoom = this.#roomTileIndex();
    // Real point lights are the most expensive thing in the frame, and the
    // volumetric march integrates over every one of them. The level gets a
    // fixed budget, handed out round-robin: every room is guaranteed its first
    // fixture before any room gets its second, so running out of budget dims
    // the big rooms rather than leaving a small one pitch black.
    const budget = this.def.lightBudget ?? 30;
    const queues = [];

    byRoom.forEach((tiles, id) => {
      const style = roomType(this.rooms[id]?.type);
      const spec = style.light || {};
      if (!spec.fixture || spec.fixture === 'none' || spec.rule === 'none') return;
      const factory = PROPS[FIXTURES[spec.fixture]] || PROPS.sconce;
      const queue = [];

      if (spec.rule === 'centre' || spec.rule === 'both') {
        const centre = this.#centreTile(tiles);
        if (centre) queue.push({ kind: 'centre', factory, spec, at: centre });
      }

      if (spec.rule === 'rhythm' || spec.rule === 'both') {
        // a chandelier is a ceiling fitting and a candlestick stands on the
        // floor; on a wall run both become a sconce
        const hanging = spec.fixture === 'chandelier' || spec.fixture === 'gasolier';
        const wallFactory = hanging || spec.fixture === 'candles' ? PROPS.sconce : factory;
        const edges = this.#wallEdges(tiles).filter(([c, r]) => !this.occupied.has(`${c},${r}`));
        // one fitting per ~14 tiles of floor, never more than five in a room,
        // spread evenly around whatever wall the room actually has
        const wanted = Math.min(5, Math.max(1, Math.round(tiles.length / 14)));
        const spacing = Math.max(1, Math.floor(edges.length / wanted));
        for (let i = 0, hung = 0; i < edges.length && hung < wanted; i += spacing, hung += 1) {
          queue.push({ kind: 'wall', factory: wallFactory, spec, at: edges[i] });
        }
      }
      if (queue.length) queues.push(queue);
    });

    let spent = 0;
    for (let round = 0; spent < budget; round += 1) {
      let placedAny = false;
      for (let q = 0; q < queues.length && spent < budget; q += 1) {
        const item = queues[q][round];
        if (!item) continue;
        placedAny = true;
        this.#hangFixture(item);
        spent += 1;
      }
      if (!placedAny) break;
    }
  }

  #hangFixture({ kind, factory, spec, at }) {
    const node = factory(this.materials);
    if (node.userData.light) {
      if (spec.colour) node.userData.light.color.setHex(spec.colour);
      if (spec.intensity) node.userData.light.intensity = spec.intensity;
    }
    // merge first: mergeGroup bakes transforms, so it must run untouched
    const placed = node.userData.merge === false ? node : mergeGroup(node);

    if (kind === 'centre') {
      const [col, row] = at;
      const p = this.toWorld(col, row);
      placed.position.set(p.x, this.wallHeight, p.z);
      this.occupied.add(`${col},${row}`);
    } else {
      const [col, row, dc, dr, yaw] = at;
      const p = this.toWorld(col, row);
      placed.position.set(
        p.x + dc * TILE * 0.44,
        Math.min(2.15, this.wallHeight * 0.55),
        p.z + dr * TILE * 0.44
      );
      placed.rotation.y = yaw;
    }
    this.group.add(placed);
    this.props.push(placed);
    if (placed.userData.light) this.lights.push(placed.userData.light);
  }

  /** tiles grouped by room id, walkable only. */
  #roomTileIndex() {
    const byRoom = new Map();
    if (!this.zones) return byRoom;
    this.floorKind.forEach((kind, key) => {
      const [col, row] = key.split(',').map(Number);
      const id = this.zones[row * this.cols + col];
      if (id < 0) return;
      if (!byRoom.has(id)) byRoom.set(id, []);
      byRoom.get(id).push([col, row]);
    });
    return byRoom;
  }

  #centreTile(tiles) {
    if (!tiles.length) return null;
    let sc = 0;
    let sr = 0;
    tiles.forEach(([c, r]) => { sc += c; sr += r; });
    const cc = sc / tiles.length;
    const rr = sr / tiles.length;
    let best = null;
    let bestD = 1e9;
    tiles.forEach(([c, r]) => {
      if (this.isSolid(c, r)) return;
      const d = Math.hypot(c - cc, r - rr);
      if (d < bestD) { bestD = d; best = [c, r]; }
    });
    return best;
  }

  /** Wall-adjacent tiles of a room, as [col,row,dc,dr,yaw], in a stable order. */
  #wallEdges(tiles) {
    const edges = [];
    tiles.forEach(([col, row]) => {
      DIRS.forEach(([dc, dr, yaw]) => {
        if (this.isSolid(col + dc, row + dr)) edges.push([col, row, dc, dr, yaw]);
      });
    });
    return edges;
  }

  // --- dressing -------------------------------------------------------------

  /**
   * Furnishes each room from its type. Circulation is protected first: door
   * tiles and a straight run from every doorway to the room centre are
   * reserved before a single stick of furniture goes down, so a dressed room
   * can never seal itself off.
   */
  #dressRooms() {
    const byRoom = this.#roomTileIndex();
    if (!byRoom.size) return;

    // reserve doorways and their approaches
    this.doors.forEach(({ col, row }) => {
      this.occupied.add(`${col},${row}`);
      DIRS.forEach(([dc, dr]) => this.occupied.add(`${col + dc},${row + dr}`));
    });
    this.rugTiles = new Set();

    byRoom.forEach((tiles, id) => {
      const room = this.rooms[id];
      const style = roomType(room?.type);
      const dressing = style.dressing || [];
      if (!dressing.length) return;
      const centre = this.#centreTile(tiles);
      if (!centre) return;

      // an L-shaped lane from each doorway to the room centre stays clear
      const inRoom = new Set(tiles.map(([c, r]) => `${c},${r}`));
      this.doors.forEach(({ col, row }) => {
        DIRS.forEach(([dc, dr]) => {
          const key = `${col + dc},${row + dr}`;
          if (!inRoom.has(key)) return;
          this.#reserveLane(col + dc, row + dr, centre[0], centre[1]);
        });
      });

      const random = rng(id * 977 + 13);
      const free = tiles.filter(([c, r]) => !this.occupied.has(`${c},${r}`));
      const edges = this.#wallEdges(tiles).filter(([c, r]) => !this.occupied.has(`${c},${r}`));
      shuffle(edges, random);
      shuffle(free, random);
      const placedByProp = new Map();

      const ordered = [...dressing].sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0));
      ordered.forEach((entry) => {
        if (!PROPS[entry.prop]) return;
        const count = entry.n ?? 1;
        for (let k = 0; k < count; k += 1) {
          const node = this.#placeDressing(entry, {
            tiles, free, edges, centre, random, placedByProp, style, room,
            variant: VARIED.has(entry.prop) ? (id + k) % 3 : 0,
          });
          if (!node) break;
        }
      });
    });
  }

  /** Marks the L-path between two tiles as reserved circulation. */
  #reserveLane(c0, r0, c1, r1) {
    const step = (a, b) => (a === b ? 0 : (b > a ? 1 : -1));
    let c = c0;
    let r = r0;
    let guard = 0;
    while ((c !== c1 || r !== r1) && guard++ < 80) {
      this.occupied.add(`${c},${r}`);
      if (c !== c1) c += step(c, c1);
      else r += step(r, r1);
    }
    this.occupied.add(`${c1},${r1}`);
  }

  #placeDressing(entry, ctx) {
    const { free, edges, centre, random, placedByProp, variant } = ctx;
    const type = entry.prop;
    const at = entry.at || 'free';

    if (at.startsWith('around:')) {
      const anchor = placedByProp.get(at.slice(7));
      if (!anchor) return null;
      const index = (placedByProp.get(`${at}#count`) || 0);
      placedByProp.set(`${at}#count`, index + 1);
      const ring = [[-1.0, 0.55], [0, 0.75], [1.0, 0.55], [-1.0, -0.55], [0, -0.75], [1.0, -0.55]];
      const [ox, oz] = ring[index % ring.length];
      const node = this.#instantiate(type, {
        x: anchor.x + ox * 1.05, z: anchor.z + oz * 1.15,
        yaw: oz > 0 ? Math.PI : 0, collide: false, variant,
      });
      return node;
    }

    if (at === 'centre') {
      const [c, r] = centre;
      const p = this.toWorld(c, r);
      // A dining table dropped into a box room would wall the player in, so a
      // centre piece only goes down if the room can take it with a walkable
      // margin on every side.
      const fit = this.#template(type, variant).userData.collider;
      const rect = ctx.room?.rect;
      if (fit && rect) {
        const roomW = rect.w * TILE;
        const roomD = rect.h * TILE;
        if (fit.w + TILE * 1.4 > roomW || fit.d + TILE * 1.4 > roomD) return null;
      }
      const node = this.#instantiate(type, { x: p.x, z: p.z, yaw: 0, variant });
      if (node) {
        placedByProp.set(entry.prop, { x: p.x, z: p.z });
        if (node.userData.rug) this.#layRug(node, c, r);
      }
      return node;
    }

    if (at === 'ceiling') {
      const [c, r] = centre;
      const p = this.toWorld(c, r);
      return this.#instantiate(type, { x: p.x, z: p.z, y: this.wallHeight, collide: false, variant });
    }

    if (at === 'wall' || at === 'window' || at === 'corner' || at === 'rhythm') {
      while (edges.length) {
        const [col, row, dc, dr, yaw] = edges.shift();
        if (this.occupied.has(`${col},${row}`)) continue;
        const p = this.toWorld(col, row);
        const hang = entry.hangHeight !== undefined;
        const node = this.#instantiate(type, {
          x: p.x + dc * TILE * (hang ? 0.47 : 0.24),
          z: p.z + dr * TILE * (hang ? 0.47 : 0.24),
          y: entry.hangHeight ?? 0,
          yaw,
          collide: !hang,
          variant,
        });
        if (!node) continue;
        if (!hang) {
          this.occupied.add(`${col},${row}`);
          placedByProp.set(entry.prop, { x: p.x, z: p.z });
        }
        return node;
      }
      return null;
    }

    // 'free'
    while (free.length) {
      const [col, row] = free.shift();
      if (this.occupied.has(`${col},${row}`)) continue;
      const p = this.toWorld(col, row);
      const node = this.#instantiate(type, {
        x: p.x + (random() - 0.5) * TILE * 0.3,
        z: p.z + (random() - 0.5) * TILE * 0.3,
        yaw: random() * Math.PI * 2,
        variant,
      });
      if (!node) continue;
      this.occupied.add(`${col},${row}`);
      placedByProp.set(entry.prop, { x: p.x, z: p.z });
      return node;
    }
    return null;
  }

  /** A rug makes the tiles it covers sound like carpet underfoot. */
  #layRug(node, col, row) {
    const { w, d } = node.userData.rug;
    const rc = Math.ceil(w / TILE / 2);
    const rr = Math.ceil(d / TILE / 2);
    for (let r = row - rr; r <= row + rr; r += 1) {
      for (let c = col - rc; c <= col + rc; c += 1) {
        if (this.floorKind.has(`${c},${r}`)) this.floorKind.set(`${c},${r}`, 'carpet');
      }
    }
  }

  /**
   * A merged, reusable blueprint of one prop. Built once per type; every
   * placement after that reuses the same geometry, which is what keeps a
   * fully furnished house inside a sane draw-call budget.
   */
  #template(type, variant = 0) {
    const key = `${type}#${variant}`;
    const hit = this.templates.get(key);
    if (hit) return hit;
    const node = PROPS[type](this.materials, variant);
    const dynamic = node.userData.merge === false
      || node.userData.swings
      || !!node.userData.light;
    const merged = dynamic ? null : mergeGroup(node);
    const template = {
      type,
      variant,
      dynamic,
      userData: node.userData,
      ownYaw: node.rotation?.y || 0,
      parts: merged
        ? merged.children.filter((c) => c.isMesh).map((c) => ({ geometry: c.geometry, material: c.material }))
        : null,
    };
    this.templates.set(key, template);
    return template;
  }

  /**
   * Records a placement. Static props are queued and flushed into instanced
   * meshes later; anything carrying a light or an animation is built there and
   * then, because it needs its own scene node.
   */
  #instantiate(type, { x, z, y = 0, yaw = 0, collide = true, variant = 0 }) {
    if (!PROPS[type]) return null;
    const template = this.#template(type, variant);

    if (template.dynamic) {
      const node = PROPS[type](this.materials, variant);
      const merge = node.userData.merge !== false;
      const own = merge ? 0 : (node.rotation?.y || 0);
      const placed = merge ? mergeGroup(node) : node;
      placed.position.set(x, y, z);
      placed.rotation.y = yaw + own;
      this.group.add(placed);
      this.props.push(placed);
      if (placed.userData.light) this.lights.push(placed.userData.light);
      this.#addCollider(placed.userData.collider, x, z, collide);
      this.dressed.push({ type, x, y, z });
      return placed;
    }

    const key = `${type}#${variant}`;
    if (!this.pending.has(key)) this.pending.set(key, { template, items: [] });
    this.pending.get(key).items.push({ x, y, z, yaw });
    this.#addCollider(template.userData.collider, x, z, collide);
    // Instanced props never become scene nodes of their own, so record them
    // here — otherwise there is no way to ask "is this room actually dressed?"
    this.dressed.push({ type, x, y, z });
    // a light-weight handle so callers can read userData without a scene node
    return { userData: template.userData, position: new THREE.Vector3(x, y, z) };
  }

  #addCollider(collider, x, z, collide) {
    if (!collide || !collider) return;
    this.propColliders.push({ x, z, w: collider.w, d: collider.d });
  }

  /** Turns every queued placement into one instanced mesh per material part. */
  #flushProps() {
    const dummy = new THREE.Object3D();
    this.pending.forEach(({ template, items }) => {
      template.parts.forEach(({ geometry, material }) => {
        const mesh = new THREE.InstancedMesh(geometry, material, items.length);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        items.forEach((it, i) => {
          dummy.position.set(it.x, it.y, it.z);
          dummy.rotation.set(0, it.yaw, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        this.group.add(mesh);
      });
    });
    this.pending.clear();
  }

  placeProp(spec) {
    const factory = PROPS[spec.type];
    if (!factory) return null;
    const positions = spec.at ? [spec.at] : (this.markers[spec.marker] || []).map((mk) => [mk.col, mk.row]);
    const created = [];
    positions.forEach(([col, row]) => {
      const node = factory(this.materials);
      const merge = node.userData.merge !== false;
      const own = merge ? 0 : (node.rotation?.y || 0);
      const placed = merge ? mergeGroup(node) : node;
      const p = this.toWorld(col, row);
      placed.position.set(
        p.x + (spec.offset?.[0] || 0),
        spec.hang ? this.wallHeight : (spec.y ?? 0),
        p.z + (spec.offset?.[1] || 0)
      );
      placed.rotation.y = spec.rotation !== undefined ? spec.rotation : own;
      this.group.add(placed);
      this.props.push(placed);
      created.push(placed);
      this.occupied.add(`${col},${row}`);
      if (placed.userData.light) this.lights.push(placed.userData.light);
      if (placed.userData.collider) {
        this.propColliders.push({
          x: placed.position.x,
          z: placed.position.z,
          w: placed.userData.collider.w,
          d: placed.userData.collider.d,
        });
      }
    });
    return created;
  }

  markerPositions(ch) {
    return (this.markers[ch] || []).map((mk) => mk.pos.clone());
  }

  firstMarker(ch) {
    const list = this.markers[ch];
    return list && list.length ? list[0].pos.clone() : null;
  }

  setDoorOpen(door, open) {
    door.open = open;
    this.solid[door.row * this.cols + door.col] = open ? 0 : 1;
  }

  doorAt(col, row) {
    return this.doors.find((d) => d.col === col && d.row === row) || null;
  }

  /** Circle-vs-grid collision resolve. Returns the corrected position. */
  resolve(x, z, radius) {
    let px = x;
    let pz = z;
    const { col, row } = this.toGrid(px, pz);
    for (let r = row - 1; r <= row + 1; r += 1) {
      for (let c = col - 1; c <= col + 1; c += 1) {
        if (!this.isSolid(c, r)) continue;
        const center = this.toWorld(c, r);
        const minX = center.x - TILE / 2;
        const maxX = center.x + TILE / 2;
        const minZ = center.z - TILE / 2;
        const maxZ = center.z + TILE / 2;
        const nx = Math.max(minX, Math.min(px, maxX));
        const nz = Math.max(minZ, Math.min(pz, maxZ));
        const dx = px - nx;
        const dz = pz - nz;
        const distSq = dx * dx + dz * dz;
        if (distSq < radius * radius) {
          const dist = Math.sqrt(distSq) || 0.0001;
          const push = (radius - dist) / dist;
          px += dx * push;
          pz += dz * push;
        }
      }
    }
    for (let i = 0; i < this.propColliders.length; i += 1) {
      const p = this.propColliders[i];
      const minX = p.x - p.w / 2;
      const maxX = p.x + p.w / 2;
      const minZ = p.z - p.d / 2;
      const maxZ = p.z + p.d / 2;
      const nx = Math.max(minX, Math.min(px, maxX));
      const nz = Math.max(minZ, Math.min(pz, maxZ));
      const dx = px - nx;
      const dz = pz - nz;
      const distSq = dx * dx + dz * dz;
      if (distSq < radius * radius) {
        const dist = Math.sqrt(distSq) || 0.0001;
        const push = (radius - dist) / dist;
        px += dx * push;
        pz += dz * push;
      }
    }
    return { x: px, z: pz };
  }

  /** Bresenham line of sight across the grid. */
  hasLineOfSight(ax, az, bx, bz) {
    const a = this.toGrid(ax, az);
    const b = this.toGrid(bx, bz);
    let x0 = a.col;
    let y0 = a.row;
    const dx = Math.abs(b.col - x0);
    const dy = Math.abs(b.row - y0);
    const sx = x0 < b.col ? 1 : -1;
    const sy = y0 < b.row ? 1 : -1;
    let err = dx - dy;
    let guard = 0;
    while (guard++ < 256) {
      if (this.isSolid(x0, y0)) return false;
      if (x0 === b.col && y0 === b.row) return true;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
    return false;
  }

  /** A* on the tile grid. Returns a list of world-space waypoints. */
  findPath(from, to, maxNodes = 900) {
    const start = this.toGrid(from.x, from.z);
    const goal = this.toGrid(to.x, to.z);
    if (this.isSolid(goal.col, goal.row)) return null;
    const key = (c, r) => r * this.cols + c;
    const open = [{ c: start.col, r: start.row, g: 0, f: 0, p: null }];
    const seen = new Map([[key(start.col, start.row), open[0]]]);
    const closed = new Set();
    let nodes = 0;

    while (open.length && nodes++ < maxNodes) {
      let bestIdx = 0;
      for (let i = 1; i < open.length; i += 1) if (open[i].f < open[bestIdx].f) bestIdx = i;
      const current = open.splice(bestIdx, 1)[0];
      const ck = key(current.c, current.r);
      if (closed.has(ck)) continue;
      closed.add(ck);

      if (current.c === goal.col && current.r === goal.row) {
        const path = [];
        let node = current;
        while (node) { path.unshift(this.toWorld(node.c, node.r)); node = node.p; }
        return path;
      }

      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          if (dc === 0 && dr === 0) continue;
          const nc = current.c + dc;
          const nr = current.r + dr;
          if (this.isSolid(nc, nr)) continue;
          if (dc !== 0 && dr !== 0 && (this.isSolid(current.c + dc, current.r) || this.isSolid(current.c, current.r + dr))) continue;
          const nk = key(nc, nr);
          if (closed.has(nk)) continue;
          const g = current.g + (dc && dr ? 1.414 : 1);
          const existing = seen.get(nk);
          if (existing && existing.g <= g) continue;
          const h = Math.hypot(goal.col - nc, goal.row - nr);
          const node = { c: nc, r: nr, g, f: g + h * 1.05, p: current };
          seen.set(nk, node);
          open.push(node);
        }
      }
    }
    return null;
  }

  update(dt, time) {
    this.props.forEach((prop) => {
      if (prop.userData.flicker && prop.userData.light) {
        const l = prop.userData.light;
        l.userData.base = l.userData.base ?? l.intensity;
        const n = Math.sin(time * 11 + prop.position.x) * Math.sin(time * 7.3 + prop.position.z);
        l.intensity = l.userData.base * (0.78 + n * 0.22 + Math.random() * 0.06);
      }
      if (prop.userData.swings) {
        prop.rotation.z = Math.sin(time * 0.7 + prop.position.x) * 0.06;
      }
    });
    this.doors.forEach((door) => {
      if (!door.mesh) return;
      const target = door.baseRotation + (door.open ? Math.PI * 0.55 : 0);
      door.mesh.rotation.y += (target - door.mesh.rotation.y) * Math.min(1, dt * 6);
    });
    if (this.waterMesh) {
      this.waterMesh.position.y = Math.sin(time * 1.2) * 0.015;
    }
  }

  dispose() {
    this.group.traverse((obj) => {
      if (obj.isMesh) obj.geometry?.dispose?.();
    });
  }
}

function shuffle(list, random) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
  }
  return list;
}

export function buildLevel(def, textures) {
  return new Level(def, textures);
}
