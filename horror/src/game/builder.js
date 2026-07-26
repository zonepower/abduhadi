import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Turns an ASCII level definition into geometry, collision and a nav grid.
// ---------------------------------------------------------------------------

export const TILE = 2.6;

const WALL_CHARS = new Set(['#', 'X']);
const FLOOR_TYPES = {
  '.': 'wood',
  ',': 'carpet',
  '=': 'tile',
  '%': 'concrete',
  '~': 'water',
  ';': 'grass',
};

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
  return material;
}

export function createMaterials(textures) {
  return {
    wood: mat(textures, 'woodFloor', { reflectivity: 0.28, roughness: 0.85 }),
    carpet: mat(textures, 'darkWood', { color: 0x6b2f38, reflectivity: 0.04, roughness: 1 }),
    tile: mat(textures, 'tileFloor', { reflectivity: 0.55, roughness: 0.45 }),
    concrete: mat(textures, 'concrete', { reflectivity: 0.12, roughness: 0.95 }),
    grass: mat(textures, 'concrete', { color: 0x33422a, reflectivity: 0.08, roughness: 1 }),
    water: new THREE.MeshStandardMaterial({
      color: 0x25454f, roughness: 0.07, metalness: 0.2, transparent: true, opacity: 0.82,
    }),
    wallPaper: mat(textures, 'wallPaper', { reflectivity: 0.06, roughness: 0.95 }),
    wallStone: mat(textures, 'wallStone', { color: 0x8f8f96, reflectivity: 0.1, roughness: 0.9 }),
    panel: mat(textures, 'darkWood', { reflectivity: 0.2, roughness: 0.75 }),
    metal: mat(textures, 'metal', { reflectivity: 0.7, roughness: 0.4, metalness: 1 }),
    mirror: new THREE.MeshStandardMaterial({ color: 0x9fb0c0, roughness: 0.02, metalness: 1 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x88aabb, roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.35,
    }),
    cloth: new THREE.MeshStandardMaterial({ color: 0x2a2028, roughness: 1 }),
    flesh: new THREE.MeshStandardMaterial({ color: 0x6d2b2b, roughness: 0.75 }),
    bone: new THREE.MeshStandardMaterial({ color: 0xc9bfa4, roughness: 0.6 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xb08a3a, roughness: 0.28, metalness: 1 }),
    blood: new THREE.MeshStandardMaterial({
      color: 0x4a0d0d, roughness: 0.25, metalness: 0, transparent: true, opacity: 0.92,
    }),
  };
}

// --- procedural props -------------------------------------------------------

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

function group(...children) {
  const g = new THREE.Group();
  children.forEach((c) => c && g.add(c));
  return g;
}

function part(geometry, material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export const PROPS = {
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
  chair(m) {
    const g = group(
      part(box(0.5, 0.08, 0.5), m.panel, 0, 0.48),
      part(box(0.5, 0.7, 0.08), m.panel, 0, 0.85, -0.21),
      part(box(0.06, 0.48, 0.06), m.panel, -0.2, 0.24, -0.2),
      part(box(0.06, 0.48, 0.06), m.panel, 0.2, 0.24, -0.2),
      part(box(0.06, 0.48, 0.06), m.panel, -0.2, 0.24, 0.2),
      part(box(0.06, 0.48, 0.06), m.panel, 0.2, 0.24, 0.2),
    );
    g.rotation.y = Math.random() * Math.PI * 2;
    g.userData.collider = { w: 0.6, d: 0.6, h: 1.2 };
    return g;
  },
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
  crate(m) {
    const g = group(part(box(0.9, 0.9, 0.9), m.panel, 0, 0.45));
    g.rotation.y = Math.random() * Math.PI;
    g.userData.collider = { w: 1.0, d: 1.0, h: 0.9 };
    return g;
  },
  barrel(m) {
    const geo = new THREE.CylinderGeometry(0.42, 0.42, 1.05, 14);
    const g = group(part(geo, m.metal, 0, 0.53));
    g.userData.collider = { w: 0.9, d: 0.9, h: 1.05 };
    return g;
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
  piano(m) {
    const g = group(
      part(box(1.5, 0.9, 0.7), m.panel, 0, 0.6),
      part(box(1.4, 0.06, 0.2), m.bone, 0, 1.02, 0.3),
      part(box(0.12, 0.6, 0.12), m.panel, -0.6, 0.3, 0.25),
      part(box(0.12, 0.6, 0.12), m.panel, 0.6, 0.3, 0.25),
    );
    g.userData.collider = { w: 1.7, d: 0.9, h: 1.1 };
    g.userData.interact = { type: 'piano' };
    return g;
  },
  mirror(m) {
    const g = group(
      part(box(1.3, 2.1, 0.08), m.panel, 0, 1.1, -0.06),
      part(box(1.1, 1.9, 0.03), m.mirror, 0, 1.1, 0),
    );
    g.children[1].material = m.mirror;
    g.children[1].material.userData.reflectivity = 1.0;
    g.userData.collider = { w: 1.3, d: 0.3, h: 2.1 };
    return g;
  },
  painting(m) {
    const canvasMat = m.cloth.clone();
    canvasMat.color.setHex(0x3a2a22);
    const g = group(
      part(box(1.0, 1.3, 0.08), m.gold, 0, 2.0),
      part(box(0.85, 1.15, 0.02), canvasMat, 0, 2.0, 0.05),
    );
    return g;
  },
  candle(m) {
    const geo = new THREE.CylinderGeometry(0.05, 0.06, 0.28, 8);
    const wax = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.8 });
    const g = group(part(geo, wax, 0, 0.14));
    const light = new THREE.PointLight(0xffa04a, 16, 8, 1.6);
    light.position.set(0, 0.36, 0);
    light.castShadow = false;
    g.add(light);
    g.userData.light = light;
    g.userData.flicker = true;
    void m;
    return g;
  },
  chandelier(m) {
    const g = group(
      part(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6), m.metal, 0, -0.7),
      part(new THREE.TorusGeometry(0.55, 0.05, 6, 18), m.metal, 0, -1.4),
    );
    g.children[1].rotation.x = Math.PI / 2;
    const light = new THREE.PointLight(0xffb060, 34, 15, 1.6);
    light.position.set(0, -1.4, 0);
    g.add(light);
    g.userData.light = light;
    g.userData.flicker = true;
    g.userData.hangs = true;
    return g;
  },
  lantern(m) {
    const g = group(part(box(0.22, 0.3, 0.22), m.metal, 0, 0.9), part(box(0.06, 0.9, 0.06), m.metal, 0, 0.45));
    const light = new THREE.PointLight(0x86c8ff, 20, 11, 1.6);
    light.position.set(0, 0.95, 0);
    g.add(light);
    g.userData.light = light;
    g.userData.flicker = true;
    return g;
  },
  corpse(m) {
    const g = group(
      part(box(0.45, 0.22, 1.4), m.cloth, 0, 0.12),
      part(new THREE.SphereGeometry(0.16, 10, 8), m.bone, 0, 0.18, 0.82),
      part(box(0.16, 0.14, 0.7), m.cloth, -0.32, 0.1, 0.1),
      part(box(0.16, 0.14, 0.7), m.cloth, 0.32, 0.1, 0.1),
    );
    g.rotation.y = Math.random() * Math.PI * 2;
    return g;
  },
  altar(m) {
    const g = group(
      part(box(2.2, 0.25, 1.3), m.wallStone, 0, 0.95),
      part(box(1.9, 0.95, 1.0), m.wallStone, 0, 0.48),
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
      g.add(part(box(0.06, 2.0, 0.06), m.metal, Math.cos(a) * 0.55, 1.0, Math.sin(a) * 0.55));
    }
    g.add(part(new THREE.TorusGeometry(0.55, 0.05, 6, 16), m.metal, 0, 2.0));
    g.children[g.children.length - 1].rotation.x = Math.PI / 2;
    g.userData.collider = { w: 1.2, d: 1.2, h: 2.0 };
    return g;
  },
  hook(m) {
    const g = group(
      part(box(0.04, 2.4, 0.04), m.metal, 0, 2.4),
      part(new THREE.TorusGeometry(0.18, 0.045, 6, 12, Math.PI * 1.4), m.metal, 0, 1.2),
    );
    g.children[1].rotation.z = Math.PI * 0.2;
    g.userData.swings = true;
    return g;
  },
  stairs(m) {
    const g = new THREE.Group();
    for (let i = 0; i < 10; i += 1) {
      g.add(part(box(2.2, 0.2, 0.34), m.panel, 0, 0.1 + i * 0.24, -1.6 + i * 0.34));
    }
    return g;
  },
  bloodPool(m) {
    const geo = new THREE.CircleGeometry(0.9 + Math.random() * 0.6, 16);
    const mesh = new THREE.Mesh(geo, m.blood);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.012;
    mesh.receiveShadow = true;
    mesh.material.userData.reflectivity = 0.85;
    return group(mesh);
  },
  fuseBox(m) {
    const g = group(part(box(0.7, 0.9, 0.25), m.metal, 0, 1.4), part(box(0.5, 0.7, 0.05), m.panel, 0, 1.4, 0.15));
    g.userData.collider = { w: 0.8, d: 0.4, h: 2.0 };
    return g;
  },
  car(m) {
    const paint = new THREE.MeshStandardMaterial({ color: 0x2c3742, roughness: 0.35, metalness: 0.85 });
    paint.userData.reflectivity = 0.7;
    const glass = m.glass;
    const tyre = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.95 });
    const wheel = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14);
    const g = group(
      part(box(1.9, 0.55, 4.2), paint, 0, 0.62),
      part(box(1.7, 0.62, 2.0), paint, 0, 1.15, -0.2),
      part(box(1.62, 0.5, 0.06), glass, 0, 1.2, 0.82),
      part(box(0.06, 0.5, 1.9), glass, 0.82, 1.2, -0.2),
      part(box(0.06, 0.5, 1.9), glass, -0.82, 1.2, -0.2),
    );
    [[-0.88, 1.35], [0.88, 1.35], [-0.88, -1.45], [0.88, -1.45]].forEach(([x, z]) => {
      const w = part(wheel, tyre, x, 0.34, z);
      w.rotation.z = Math.PI / 2;
      g.add(w);
    });
    const head = new THREE.PointLight(0xfff2cc, 0, 9, 1.6);
    head.position.set(0, 0.7, 2.2);
    g.add(head);
    g.userData.light = head;
    g.userData.collider = { w: 2.2, d: 4.4, h: 1.6 };
    g.rotation.y = 0.22;
    return g;
  },
  valve(m) {
    const g = group(
      part(new THREE.TorusGeometry(0.32, 0.06, 8, 16), m.metal, 0, 1.2),
      part(box(0.22, 0.22, 0.3), m.metal, 0, 1.2, -0.2),
    );
    g.userData.collider = { w: 0.7, d: 0.5, h: 1.6 };
    return g;
  },
};

// --- level construction -----------------------------------------------------

export class Level {
  constructor(def, textures) {
    this.def = def;
    this.grid = def.blueprint || def.grid;
    this.rows = this.grid.length;
    this.cols = Math.max(...this.grid.map((r) => r.length));
    this.wallHeight = def.wallHeight ?? 4.2;
    this.materials = createMaterials(textures);
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
    this.solid = new Uint8Array(this.rows * this.cols);
    this.build();
  }

  charAt(col, row) {
    if (row < 0 || row >= this.rows) return ' ';
    const line = this.grid[row];
    if (col < 0 || col >= line.length) return ' ';
    return line[col];
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

  build() {
    const m = this.materials;
    const def = this.def;
    const floorBuckets = new Map();
    const wallBuckets = new Map();
    const ceilingTiles = [];

    for (let row = 0; row < this.rows; row += 1) {
      for (let col = 0; col < this.cols; col += 1) {
        const ch = this.charAt(col, row);
        if (ch === ' ') { this.solid[row * this.cols + col] = 1; continue; }

        if (WALL_CHARS.has(ch)) {
          this.solid[row * this.cols + col] = 1;
          const key = ch === 'X' ? 'panel' : (def.wallMaterial || 'wallPaper');
          if (!wallBuckets.has(key)) wallBuckets.set(key, []);
          wallBuckets.get(key).push([col, row]);
          continue;
        }

        // walkable
        let kind = FLOOR_TYPES[ch] || def.defaultFloor || 'wood';
        if (ch === '+') kind = def.defaultFloor || 'wood';
        this.floorKind.set(`${col},${row}`, kind);
        const bucketKey = kind === 'water' ? 'water' : kind;
        if (!floorBuckets.has(bucketKey)) floorBuckets.set(bucketKey, []);
        floorBuckets.get(bucketKey).push([col, row]);
        if (kind === 'water') this.waterTiles.add(`${col},${row}`);
        if (def.ceiling !== false) ceilingTiles.push([col, row]);

        if (ch === '+') {
          this.solid[row * this.cols + col] = 1; // doors start closed
          this.doors.push({ col, row, open: false, mesh: null, locked: false, id: null });
        } else if (!FLOOR_TYPES[ch]) {
          this.markers[ch] = this.markers[ch] || [];
          this.markers[ch].push({ col, row, pos: this.toWorld(col, row) });
        }
      }
    }

    const addInstanced = (geometry, material, cells, yOffset, tint) => {
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
    };

    const floorGeo = box(TILE, 0.2, TILE);
    floorBuckets.forEach((cells, key) => {
      const material = m[key] || m.wood;
      if (key === 'water') {
        addInstanced(box(TILE, 0.1, TILE), m.concrete, cells, -0.16, 0.8);
        const water = addInstanced(box(TILE, 0.28, TILE), material, cells, -0.02, 1);
        if (water) {
          water.material.userData.reflectivity = 0.95;
          water.castShadow = false;
          water.userData.noGBuffer = false;
          this.waterMesh = water;
        }
      } else {
        const inst = addInstanced(floorGeo, material, cells, -0.1, 1);
        if (inst) inst.castShadow = false;
      }
    });

    const wallGeo = box(TILE, this.wallHeight, TILE);
    wallBuckets.forEach((cells, key) => {
      addInstanced(wallGeo, m[key] || m.wallPaper, cells, this.wallHeight / 2, 1);
    });

    if (ceilingTiles.length) {
      const ceil = addInstanced(box(TILE, 0.25, TILE), m[def.ceilingMaterial || 'panel'], ceilingTiles, this.wallHeight + 0.1, 0.7);
      if (ceil) ceil.castShadow = false;
    }

    // doors get their own swinging mesh
    this.doors.forEach((door) => {
      const pivot = new THREE.Group();
      const p = this.toWorld(door.col, door.row);
      const horizontal = this.isSolid(door.col - 1, door.row) && this.isSolid(door.col + 1, door.row);
      pivot.position.set(p.x, 0, p.z);
      const leaf = part(box(TILE * 0.95, this.wallHeight * 0.92, 0.14), m.panel, TILE * 0.47, this.wallHeight * 0.46, 0);
      const handle = part(new THREE.SphereGeometry(0.08, 8, 6), m.metal, TILE * 0.85, this.wallHeight * 0.45, 0.12);
      pivot.add(leaf, handle);
      if (!horizontal) pivot.rotation.y = Math.PI / 2;
      pivot.position.x -= horizontal ? TILE * 0.5 : 0;
      pivot.position.z -= horizontal ? 0 : TILE * 0.5;
      door.baseRotation = pivot.rotation.y;
      door.mesh = pivot;
      this.group.add(pivot);
    });

    (def.props || []).forEach((spec) => this.placeProp(spec));
  }

  placeProp(spec) {
    const factory = PROPS[spec.type];
    if (!factory) return null;
    const positions = spec.at ? [spec.at] : (this.markers[spec.marker] || []).map((mk) => [mk.col, mk.row]);
    const created = [];
    positions.forEach(([col, row]) => {
      const node = factory(this.materials);
      const p = this.toWorld(col, row);
      node.position.set(p.x + (spec.offset?.[0] || 0), spec.y ?? 0, p.z + (spec.offset?.[1] || 0));
      if (spec.rotation !== undefined) node.rotation.y = spec.rotation;
      if (spec.hang) node.position.y = this.wallHeight;
      this.group.add(node);
      this.props.push(node);
      created.push(node);
      if (node.userData.light) this.lights.push(node.userData.light);
      if (node.userData.collider) {
        this.propColliders.push({
          x: node.position.x,
          z: node.position.z,
          w: node.userData.collider.w,
          d: node.userData.collider.d,
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
          // no cutting corners diagonally
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
      if (obj.isMesh) {
        obj.geometry?.dispose?.();
      }
    });
  }
}

export function buildLevel(def, textures) {
  return new Level(def, textures);
}
