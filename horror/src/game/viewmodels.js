import * as THREE from 'three';

// ---------------------------------------------------------------------------
// نماذج الأسلحة — first-person view models.
//
// Built part by part from primitives with real proportions: a Python-pattern
// revolver, a side-by-side break-action shotgun, and a felling axe. Every part
// is named so the animation code can drive the cylinder, the break lever, the
// hammer and the shell ejector individually.
// ---------------------------------------------------------------------------

function pbr(color, roughness, metalness, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  m.userData.reflectivity = metalness > 0.5 ? 0.55 : 0.15;
  // metals live or die by what they reflect, so lean on the environment probe
  m.envMapIntensity = metalness > 0.5 ? 2.4 : 1.1;
  return m;
}

/** Walnut with a visible grain, generated once and shared by every gun. */
function walnutTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // stretched rings plus fine fibre
      const ring = Math.sin((x * 0.09) + Math.sin(y * 0.035) * 2.6) * 0.5 + 0.5;
      const fibre = Math.sin(x * 1.7 + y * 0.11) * 0.5 + 0.5;
      const blotch = Math.sin(x * 0.021 + 3) * Math.cos(y * 0.017) * 0.5 + 0.5;
      const shade = 0.42 + ring * 0.3 + fibre * 0.07 + blotch * 0.16;
      const i = (y * size + x) * 4;
      image.data[i] = Math.min(255, shade * 132);
      image.data[i + 1] = Math.min(255, shade * 76);
      image.data[i + 2] = Math.min(255, shade * 42);
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

let SHARED = null;
function materials() {
  if (SHARED) return SHARED;
  const wood = pbr(0xffffff, 0.58, 0.05, { map: walnutTexture() });
  wood.userData.reflectivity = 0.2;
  // Held metal is kept a touch under full metalness and a good deal lighter
  // than a physical sample would be: a real blued revolver photographs almost
  // black indoors, and a black silhouette is unreadable as a view model.
  SHARED = {
    blued: pbr(0x555b66, 0.30, 0.88),     // blued steel, read up for the screen
    steel: pbr(0x9aa3ae, 0.22, 0.9),      // bright machined steel
    dark: pbr(0x2b2f36, 0.55, 0.6),       // matte furniture
    wood,
    brass: pbr(0xc79a45, 0.28, 0.85),
    rubber: pbr(0x2a2b30, 0.92, 0.05),
    bone: pbr(0xd9cdb2, 0.65, 0.05),
    sight: pbr(0xd8e0a0, 0.4, 0.4, { emissive: 0x2a3010, emissiveIntensity: 0.6 }),
  };
  return SHARED;
}

const cyl = (rt, rb, h, seg = 16, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

function piece(group, geometry, material, pos, rot, scale) {
  const mesh = new THREE.Mesh(geometry, material);
  if (pos) mesh.position.set(pos[0], pos[1], pos[2]);
  if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
  if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.userData.noGBuffer = true;
  group.add(mesh);
  return mesh;
}

// --- revolver ---------------------------------------------------------------

function buildRevolver() {
  const m = materials();
  const root = new THREE.Group();
  const parts = {};

  // barrel with a vented top rib and an underlug
  piece(root, cyl(0.026, 0.026, 0.30, 18), m.blued, [0, 0.012, -0.20], [Math.PI / 2, 0, 0]);
  piece(root, box(0.030, 0.016, 0.30), m.blued, [0, 0.036, -0.20]);
  piece(root, box(0.036, 0.026, 0.20), m.blued, [0, -0.014, -0.17]);
  // ejector rod inside the underlug
  piece(root, cyl(0.007, 0.007, 0.17, 8), m.steel, [0, -0.014, -0.17], [Math.PI / 2, 0, 0]);
  // front sight blade + rear notch
  piece(root, box(0.005, 0.016, 0.014), m.dark, [0, 0.050, -0.335]);
  piece(root, box(0.030, 0.010, 0.014), m.dark, [0, 0.046, -0.062]);
  piece(root, box(0.007, 0.011, 0.015), m.blued, [0, 0.047, -0.062]);

  // frame
  piece(root, box(0.036, 0.060, 0.11), m.blued, [0, 0.006, -0.030]);
  piece(root, box(0.032, 0.040, 0.055), m.blued, [0, -0.010, 0.030]);

  // fluted six-shot cylinder — spins on reload
  const cylinder = new THREE.Group();
  cylinder.position.set(0, 0.004, -0.055);
  root.add(cylinder);
  piece(cylinder, cyl(0.030, 0.030, 0.062, 6), m.steel, [0, 0, 0], [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    piece(cylinder, cyl(0.0065, 0.0065, 0.064, 8), m.dark,
      [Math.cos(a) * 0.019, Math.sin(a) * 0.019, 0], [Math.PI / 2, 0, 0]);
  }
  parts.cylinder = cylinder;

  // hammer on its own pivot so it can cock and fall
  const hammer = new THREE.Group();
  hammer.position.set(0, 0.028, 0.012);
  root.add(hammer);
  piece(hammer, box(0.010, 0.030, 0.014), m.steel, [0, 0.012, 0.004]);
  piece(hammer, box(0.014, 0.008, 0.018), m.dark, [0, 0.026, 0.012], [0.4, 0, 0]);
  parts.hammer = hammer;

  // trigger guard (half torus) and trigger
  piece(root, new THREE.TorusGeometry(0.023, 0.005, 6, 14, Math.PI), m.blued,
    [0, -0.030, -0.004], [Math.PI / 2, 0, Math.PI]);
  const trigger = new THREE.Group();
  trigger.position.set(0, -0.016, -0.004);
  root.add(trigger);
  piece(trigger, box(0.007, 0.024, 0.008), m.steel, [0, -0.010, 0], [0.25, 0, 0]);
  parts.trigger = trigger;

  // grip: checkered walnut panels around a steel backstrap
  piece(root, box(0.026, 0.10, 0.045), m.blued, [0, -0.070, 0.048], [0.30, 0, 0]);
  piece(root, box(0.032, 0.095, 0.040), m.wood, [0, -0.070, 0.046], [0.30, 0, 0]);
  piece(root, box(0.034, 0.020, 0.030), m.dark, [0, -0.118, 0.062], [0.30, 0, 0]);

  return { root, parts, muzzle: [0, 0.012, -0.36], eject: [0.03, 0.0, -0.05] };
}

// --- shotgun ----------------------------------------------------------------

function buildShotgun() {
  const m = materials();
  const root = new THREE.Group();
  const parts = {};

  // the barrels break open on reload, so they live on a hinge group
  const barrels = new THREE.Group();
  barrels.position.set(0, 0.01, -0.06);
  root.add(barrels);
  [-0.017, 0.017].forEach((x) => {
    piece(barrels, cyl(0.0165, 0.0175, 0.54, 16), m.blued, [x, 0, -0.27], [Math.PI / 2, 0, 0]);
  });
  piece(barrels, box(0.010, 0.008, 0.52), m.blued, [0, 0.012, -0.27]);   // top rib
  piece(barrels, box(0.034, 0.006, 0.50), m.dark, [0, -0.012, -0.26]);   // bottom rib
  piece(barrels, new THREE.SphereGeometry(0.0055, 8, 6), m.brass, [0, 0.020, -0.535]); // bead
  // chambers, visible when it breaks open
  [-0.017, 0.017].forEach((x) => {
    piece(barrels, cyl(0.0125, 0.0125, 0.06, 12), m.brass, [x, 0, 0.012], [Math.PI / 2, 0, 0]);
  });
  parts.barrels = barrels;

  // receiver with a scroll-engraved side plate
  piece(root, box(0.052, 0.055, 0.16), m.steel, [0, 0.002, 0.045]);
  piece(root, box(0.055, 0.030, 0.10), m.blued, [0, 0.006, 0.035]);
  // top break lever
  const lever = new THREE.Group();
  lever.position.set(0, 0.030, 0.0);
  root.add(lever);
  piece(lever, box(0.012, 0.007, 0.05), m.steel, [0, 0, 0.018]);
  parts.lever = lever;

  // trigger guard + two triggers
  piece(root, new THREE.TorusGeometry(0.026, 0.005, 6, 14, Math.PI), m.blued,
    [0, -0.030, 0.050], [Math.PI / 2, 0, Math.PI]);
  piece(root, box(0.006, 0.022, 0.008), m.steel, [-0.007, -0.020, 0.040], [0.2, 0, 0]);
  piece(root, box(0.006, 0.022, 0.008), m.steel, [0.007, -0.020, 0.056], [0.2, 0, 0]);

  // walnut forend under the barrels, checkered top and bottom
  piece(root, box(0.052, 0.040, 0.17), m.wood, [0, -0.022, -0.17]);
  piece(root, box(0.054, 0.008, 0.11), m.dark, [0, -0.040, -0.17]);

  // stock: wrist, comb, butt plate
  piece(root, box(0.040, 0.055, 0.10), m.wood, [0, -0.020, 0.135], [0.16, 0, 0]);
  piece(root, box(0.046, 0.085, 0.16), m.wood, [0, -0.045, 0.245], [0.10, 0, 0]);
  piece(root, box(0.048, 0.098, 0.014), m.rubber, [0, -0.058, 0.322], [0.10, 0, 0]);

  return { root, parts, muzzle: [0, 0.01, -0.60], eject: [0, 0.01, -0.02] };
}

// --- axe --------------------------------------------------------------------

function buildAxe() {
  const m = materials();
  const root = new THREE.Group();
  const parts = {};

  // haft, slightly swelled at the grip
  piece(root, cyl(0.017, 0.021, 0.62, 10), m.wood, [0, -0.02, -0.16], [Math.PI / 2.35, 0, 0]);
  piece(root, cyl(0.023, 0.019, 0.10, 10), m.rubber, [0.005, 0.09, 0.06], [Math.PI / 2.35, 0, 0]);
  piece(root, cyl(0.020, 0.024, 0.03, 10), m.dark, [-0.008, -0.145, -0.34], [Math.PI / 2.35, 0, 0]);

  // head: eye, poll, and a bit that tapers to the edge
  const head = new THREE.Group();
  head.position.set(-0.006, -0.115, -0.31);
  root.add(head);
  piece(head, box(0.036, 0.062, 0.052), m.steel, [0, 0, 0]);                    // eye
  piece(head, box(0.034, 0.050, 0.040), m.dark, [0, 0.004, 0.046]);             // poll
  piece(head, box(0.030, 0.115, 0.080), m.steel, [0, 0.010, -0.058]);           // bit
  // the cutting edge — a thin wedge, brighter where it has been ground
  piece(head, box(0.006, 0.140, 0.020), m.bone, [0, 0.014, -0.102]);
  piece(head, box(0.010, 0.128, 0.030), m.steel, [0, 0.013, -0.092]);
  parts.head = head;

  return { root, parts, muzzle: [0, 0, 0], eject: [0, 0, 0] };
}

const BUILDERS = { revolver: buildRevolver, shotgun: buildShotgun, axe: buildAxe };

/** Bare hands, holding the torch. */
function buildHands() {
  const m = materials();
  const root = new THREE.Group();
  piece(root, cyl(0.024, 0.026, 0.15, 12), m.dark, [0, -0.01, -0.11], [Math.PI / 2, 0, 0]);
  piece(root, cyl(0.027, 0.027, 0.03, 12), m.steel, [0, -0.01, -0.185], [Math.PI / 2, 0, 0]);
  piece(root, new THREE.SphereGeometry(0.021, 10, 8), m.sight, [0, -0.01, -0.196]);
  piece(root, cyl(0.020, 0.022, 0.05, 10), m.rubber, [0, -0.01, -0.02], [Math.PI / 2, 0, 0]);
  return { root, parts: {}, muzzle: [0, -0.01, -0.2], eject: [0, 0, 0] };
}

export function buildViewModel(id) {
  const build = BUILDERS[id] || buildHands;
  const model = build();
  model.root.traverse((o) => { o.frustumCulled = false; });
  return model;
}

// --- muzzle flash -----------------------------------------------------------

export function buildMuzzleFlash() {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({
    color: 0xffd9a0,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  // a short cone of burning gas plus a cross-shaped star
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 10, 1, true), material);
  cone.rotation.x = -Math.PI / 2;
  cone.position.z = -0.07;
  group.add(cone);
  for (let i = 0; i < 2; i += 1) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), material);
    plane.rotation.z = i * Math.PI * 0.5;
    group.add(plane);
  }
  group.traverse((o) => { o.frustumCulled = false; o.userData.noGBuffer = true; });
  group.visible = false;
  return { group, material };
}

// --- ejected shells ---------------------------------------------------------

export class ShellPool {
  constructor(scene) {
    this.scene = scene;
    this.live = [];
    const m = materials();
    this.geometry = new THREE.CylinderGeometry(0.009, 0.009, 0.032, 8);
    this.brass = m.brass;
    this.red = pbr(0x7a1c14, 0.55, 0.1);
  }

  /** @param {'revolver'|'shotgun'} kind */
  spawn(kind, position, velocity) {
    const mesh = new THREE.Mesh(this.geometry, kind === 'shotgun' ? this.red : this.brass);
    mesh.position.copy(position);
    mesh.scale.set(1, kind === 'shotgun' ? 2.0 : 1, 1);
    mesh.userData.noGBuffer = true;
    mesh.castShadow = false;
    this.scene.add(mesh);
    this.live.push({
      mesh,
      velocity: velocity.clone(),
      spin: new THREE.Vector3(
        (Math.random() - 0.5) * 22,
        (Math.random() - 0.5) * 22,
        (Math.random() - 0.5) * 22
      ),
      life: 3.2,
      bounced: 0,
    });
    if (this.live.length > 24) this.#retire(0);
  }

  #retire(index) {
    const shell = this.live[index];
    this.scene.remove(shell.mesh);
    this.live.splice(index, 1);
  }

  update(dt, floorY = 0.02) {
    for (let i = this.live.length - 1; i >= 0; i -= 1) {
      const s = this.live[i];
      s.life -= dt;
      s.velocity.y -= 9.8 * dt;
      s.mesh.position.addScaledVector(s.velocity, dt);
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      s.mesh.rotation.z += s.spin.z * dt;
      if (s.mesh.position.y < floorY && s.velocity.y < 0) {
        s.mesh.position.y = floorY;
        s.velocity.y *= -0.32;
        s.velocity.x *= 0.6;
        s.velocity.z *= 0.6;
        s.spin.multiplyScalar(0.5);
        s.bounced += 1;
        if (s.bounced > 3) s.velocity.set(0, 0, 0);
      }
      if (s.life <= 0) this.#retire(i);
    }
  }

  clear() {
    while (this.live.length) this.#retire(0);
  }
}
