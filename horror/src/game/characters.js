import * as THREE from 'three';

// ---------------------------------------------------------------------------
// بناء الشخصيات — character rig builder.
//
// One parametric body used by everyone. What separates a nine-year-old girl
// from a hunched crawler is the proportion table, not different code:
// head-to-body ratio, limb thickness, spine curvature, and the face set.
//
// Faces are built from primitives — brow, nose, cheeks, jaw, lips, eyes with
// real sclera and iris — so they read at conversation distance in a cutscene.
// ---------------------------------------------------------------------------

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const sph = (r, a = 10, b = 8) => new THREE.SphereGeometry(r, a, b);

function put(parent, geometry, material, pos, rot, scale) {
  const mesh = new THREE.Mesh(geometry, material);
  if (pos) mesh.position.set(pos[0], pos[1], pos[2]);
  if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
  if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/**
 * Presets. `head` is the head radius as a fraction of body height — children
 * have proportionally much larger heads, which is most of what makes a small
 * figure read as a child rather than a shrunken adult.
 */
export const BUILDS = {
  karim: {
    scale: 1.0, head: 0.118, shoulder: 0.20, limb: 1.0, hunch: 0.04,
    skin: 0x9a7355, cloth: 0x2f3742, accent: 0x1d232b, hair: 0x171412,
    face: 'adult', beard: true, hairStyle: 'short',
  },
  layla: {
    scale: 0.66, head: 0.150, shoulder: 0.135, limb: 0.86, hunch: 0.0,
    skin: 0xb8907a, cloth: 0x5e2b3c, accent: 0x7a3b50, hair: 0x241610,
    face: 'child', beard: false, hairStyle: 'long', dress: true,
  },
  crawler: {
    scale: 0.94, head: 0.104, shoulder: 0.165, limb: 1.22, hunch: 0.55,
    skin: 0x8e8071, cloth: 0x23202a, accent: 0x141118, hair: 0x000000,
    face: 'monster', beard: false, hairStyle: 'none', gaunt: true,
  },
  stalker: {
    scale: 1.2, head: 0.098, shoulder: 0.215, limb: 1.15, hunch: 0.34,
    skin: 0x6f5f56, cloth: 0x161820, accent: 0x0d0f14, hair: 0x000000,
    face: 'monster', beard: false, hairStyle: 'none', gaunt: true,
  },
  shepherd: {
    scale: 1.42, head: 0.105, shoulder: 0.27, limb: 1.06, hunch: 0.10,
    skin: 0x6d5b62, cloth: 0x120d14, accent: 0x090609, hair: 0x000000,
    face: 'masked', beard: false, hairStyle: 'none',
  },
};

function makeMaterials(build) {
  const skin = new THREE.MeshStandardMaterial({ color: build.skin, roughness: 0.78, metalness: 0 });
  const cloth = new THREE.MeshStandardMaterial({ color: build.cloth, roughness: 0.94, metalness: 0 });
  const accent = new THREE.MeshStandardMaterial({ color: build.accent, roughness: 0.88, metalness: 0 });
  const hair = new THREE.MeshStandardMaterial({ color: build.hair, roughness: 0.82, metalness: 0 });
  const sclera = new THREE.MeshStandardMaterial({ color: 0xd8d2c8, roughness: 0.35, metalness: 0 });
  const iris = new THREE.MeshStandardMaterial({ color: 0x2c1c12, roughness: 0.25, metalness: 0 });
  const lips = new THREE.MeshStandardMaterial({ color: 0x8a5148, roughness: 0.7, metalness: 0 });
  [skin, cloth, accent, hair, lips].forEach((m) => { m.userData.reflectivity = 0.05; });
  sclera.userData.reflectivity = 0.4;
  iris.userData.reflectivity = 0.6;
  return { skin, cloth, accent, hair, sclera, iris, lips };
}

/**
 * Builds a face into `head`. Returns handles for the parts that animate:
 * eyelids (blinking) and the jaw (speaking, screaming).
 */
function buildFace(head, m, build, r) {
  const face = {};

  // cranium: a sphere squashed front-to-back, plus a flatter back plate
  put(head, sph(r, 14, 12), m.skin, [0, 0, 0], null, [0.92, 1.06, 0.98]);
  put(head, sph(r * 0.86, 10, 8), m.skin, [0, -r * 0.18, -r * 0.22], null, [0.95, 0.9, 0.9]);

  if (build.face === 'masked') {
    // a leather mask: faceplate, straps, and two burning eye slits
    const leather = new THREE.MeshStandardMaterial({ color: 0xcdbf9f, roughness: 0.62, metalness: 0 });
    leather.userData.reflectivity = 0.12;
    put(head, box(r * 1.62, r * 1.95, r * 0.22), leather, [0, -r * 0.05, r * 0.80]);
    put(head, box(r * 1.30, r * 0.30, r * 0.20), leather, [0, r * 0.62, r * 0.86]);
    put(head, box(r * 0.26, r * 1.9, r * 0.14), m.accent, [-r * 0.86, 0, r * 0.5]);
    put(head, box(r * 0.26, r * 1.9, r * 0.14), m.accent, [r * 0.86, 0, r * 0.5]);
    const glow = new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: 0xff2a12, emissiveIntensity: 4, roughness: 1,
    });
    face.eyeGlow = glow;
    [-1, 1].forEach((side) => {
      put(head, box(r * 0.44, r * 0.13, r * 0.08), glow, [side * r * 0.38, r * 0.22, r * 0.92]);
    });
    // stitched mouth
    for (let i = -2; i <= 2; i += 1) {
      put(head, box(r * 0.04, r * 0.22, r * 0.06), m.accent, [i * r * 0.16, -r * 0.55, r * 0.92]);
    }
    return face;
  }

  const child = build.face === 'child';
  const monster = build.face === 'monster';
  // children: eyes lower and wider apart, small nose, round cheeks
  const eyeY = child ? -r * 0.02 : r * 0.10;
  const eyeX = r * (child ? 0.40 : 0.36);
  const eyeR = r * (child ? 0.19 : 0.155);
  const front = r * 0.80;

  // brow ridge — heavy on the monsters, soft on the child
  put(head, box(r * 1.34, r * (monster ? 0.30 : 0.16), r * 0.30), m.skin,
    [0, eyeY + r * (child ? 0.30 : 0.34), front * 0.88], [monster ? 0.22 : 0.1, 0, 0]);

  // eye sockets, eyeballs, irises
  const eyes = [];
  [-1, 1].forEach((side) => {
    const socket = new THREE.Group();
    socket.position.set(side * eyeX, eyeY, front * 0.72);
    head.add(socket);
    put(socket, sph(eyeR, 10, 8), m.sclera, [0, 0, 0], null, [1, 0.86, 0.7]);
    put(socket, sph(eyeR * 0.52, 8, 6), m.iris, [0, 0, eyeR * 0.62], null, [1, 1, 0.5]);
    put(socket, sph(eyeR * 0.24, 6, 5), new THREE.MeshStandardMaterial({
      color: 0x050505, roughness: 0.1,
    }), [0, 0, eyeR * 0.78], null, [1, 1, 0.4]);
    // upper lid — driven for blinking
    const lid = put(socket, sph(eyeR * 1.06, 10, 6), m.skin,
      [0, eyeR * 0.62, 0], null, [1.05, 0.6, 0.9]);
    eyes.push(lid);
    if (monster) {
      // sunken, shadowed sockets
      put(socket, new THREE.TorusGeometry(eyeR * 1.15, eyeR * 0.3, 6, 12), m.accent,
        [0, 0, -eyeR * 0.2], [0, 0, 0]);
    }
  });
  face.lids = eyes;

  // nose: bridge + tip + nostrils
  const noseLen = r * (child ? 0.34 : 0.46);
  put(head, box(r * 0.20, noseLen, r * 0.22), m.skin, [0, eyeY - noseLen * 0.35, front * 0.86], [0.12, 0, 0]);
  put(head, sph(r * (child ? 0.13 : 0.115), 8, 6), m.skin, [0, eyeY - noseLen * 0.78, front * 0.95]);
  [-1, 1].forEach((side) => {
    put(head, sph(r * 0.06, 6, 5), m.accent, [side * r * 0.11, eyeY - noseLen * 0.86, front * 0.88]);
  });

  // cheekbones
  [-1, 1].forEach((side) => {
    put(head, sph(r * (child ? 0.30 : 0.26), 8, 6), m.skin,
      [side * r * 0.52, eyeY - r * 0.30, front * 0.58], null,
      [1, monster ? 0.6 : 0.85, 0.7]);
  });

  // jaw on a hinge so it can open when they speak or scream
  const jaw = new THREE.Group();
  jaw.position.set(0, -r * 0.42, -r * 0.10);
  head.add(jaw);
  put(jaw, box(r * 1.06, r * 0.52, r * 1.12), m.skin, [0, -r * 0.18, r * 0.42], null,
    [1, 1, child ? 0.9 : 1]);
  put(jaw, box(r * 0.62, r * 0.12, r * 0.14), m.lips, [0, -r * 0.06, r * 0.94]);
  if (monster) {
    // a broken row of teeth
    for (let i = -3; i <= 3; i += 1) {
      put(jaw, box(r * 0.08, r * 0.16, r * 0.06), m.sclera,
        [i * r * 0.13, -r * 0.02, r * 0.95]);
    }
  }
  face.jaw = jaw;

  // ears
  [-1, 1].forEach((side) => {
    put(head, box(r * 0.10, r * 0.34, r * 0.20), m.skin, [side * r * 0.92, eyeY - r * 0.05, r * 0.02]);
  });

  // hair
  if (build.hairStyle === 'short') {
    put(head, sph(r * 1.02, 12, 10), m.hair, [0, r * 0.18, -r * 0.06], null, [1, 0.78, 1]);
    put(head, box(r * 1.5, r * 0.5, r * 0.2), m.hair, [0, r * 0.5, r * 0.7]);
  } else if (build.hairStyle === 'long') {
    put(head, sph(r * 1.06, 12, 10), m.hair, [0, r * 0.20, -r * 0.04], null, [1, 0.85, 1]);
    // two braids down the back
    put(head, box(r * 1.5, r * 1.7, r * 0.5), m.hair, [0, -r * 0.5, -r * 0.75]);
    [-1, 1].forEach((side) => {
      put(head, box(r * 0.42, r * 1.5, r * 0.42), m.hair, [side * r * 0.72, -r * 0.95, -r * 0.35], [0.12, 0, side * 0.1]);
    });
  }

  if (build.beard) {
    put(head, box(r * 1.0, r * 0.55, r * 0.35), m.hair, [0, -r * 0.72, r * 0.62], [0.1, 0, 0]);
  }

  return face;
}

/**
 * Assembles a full rig. Returns the same shape the old builder returned
 * (root/hips/neck/head/arms/legs) plus `face` and `hands`.
 */
export function buildCharacter(kind) {
  const build = BUILDS[kind] || BUILDS.karim;
  const m = makeMaterials(build);
  const s = build.scale;
  const limb = build.limb;
  const root = new THREE.Group();

  const hips = new THREE.Group();
  hips.position.y = 0.92 * s;
  hips.rotation.x = build.hunch * 0.5;
  root.add(hips);

  // pelvis + torso: tapered, with a chest that is wider than the waist
  put(hips, box(0.30 * s, 0.20 * s, 0.20 * s), m.cloth, [0, -0.02 * s, 0]);
  const torso = new THREE.Group();
  torso.position.y = 0.30 * s;
  hips.add(torso);
  put(torso, box(0.40 * s, 0.42 * s, 0.23 * s), m.cloth, [0, 0.02 * s, 0]);
  put(torso, box(build.shoulder * 2.15, 0.20 * s, 0.25 * s), m.cloth, [0, 0.26 * s, 0]);
  // collar / lapels
  put(torso, box(build.shoulder * 1.5, 0.10 * s, 0.05 * s), m.accent, [0, 0.30 * s, 0.12 * s]);
  if (build.gaunt) {
    // ribs pushing through the skin
    for (let i = 0; i < 4; i += 1) {
      put(torso, box(0.30 * s, 0.025 * s, 0.03 * s), m.skin, [0, (0.16 - i * 0.09) * s, 0.115 * s]);
    }
  }
  if (build.dress) {
    put(hips, new THREE.CylinderGeometry(0.16 * s, 0.30 * s, 0.34 * s, 12), m.cloth, [0, -0.16 * s, 0]);
    put(hips, new THREE.CylinderGeometry(0.30 * s, 0.31 * s, 0.04 * s, 12), m.accent, [0, -0.33 * s, 0]);
  }

  const neck = new THREE.Group();
  neck.position.y = 0.36 * s;
  torso.add(neck);
  put(neck, new THREE.CylinderGeometry(0.055 * s, 0.07 * s, 0.10 * s, 8), m.skin, [0, 0.02 * s, 0]);

  const headRadius = build.head * s * 2.0;
  const head = new THREE.Group();
  head.position.y = 0.08 * s + headRadius * 0.9;
  neck.add(head);
  const face = buildFace(head, m, build, headRadius);

  // --- limbs ---
  const arms = [];
  const legs = [];
  const hands = [];
  [-1, 1].forEach((side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * build.shoulder * s, 0.24 * s, 0);
    torso.add(shoulder);
    put(shoulder, sph(0.062 * s, 8, 6), m.cloth, [0, 0, 0]);
    put(shoulder, box(0.10 * s, 0.34 * s * limb, 0.10 * s), m.cloth, [0, -0.18 * s * limb, 0]);

    const elbow = new THREE.Group();
    elbow.position.y = -0.36 * s * limb;
    shoulder.add(elbow);
    put(elbow, box(0.085 * s, 0.32 * s * limb, 0.085 * s), m.skin, [0, -0.16 * s * limb, 0]);

    // hand: palm plus a thumb, enough to read as a hand in a close-up
    const hand = new THREE.Group();
    hand.position.y = -0.34 * s * limb;
    elbow.add(hand);
    put(hand, box(0.075 * s, 0.10 * s, 0.045 * s), m.skin, [0, -0.05 * s, 0]);
    put(hand, box(0.028 * s, 0.06 * s, 0.032 * s), m.skin, [side * 0.045 * s, -0.03 * s, 0], [0, 0, side * 0.5]);
    if (build.gaunt) {
      // long fingers/claws
      for (let f = -1; f <= 1; f += 1) {
        put(hand, box(0.018 * s, 0.11 * s, 0.018 * s), m.skin, [f * 0.024 * s, -0.14 * s, 0]);
      }
    }
    hands.push(hand);
    arms.push({ shoulder, elbow, hand, side });

    const hip = new THREE.Group();
    hip.position.set(side * 0.11 * s, -0.06 * s, 0);
    hips.add(hip);
    put(hip, box(0.135 * s, 0.42 * s * limb, 0.135 * s), m.cloth, [0, -0.21 * s * limb, 0]);

    const knee = new THREE.Group();
    knee.position.y = -0.42 * s * limb;
    hip.add(knee);
    put(knee, box(0.115 * s, 0.40 * s * limb, 0.115 * s), m.cloth, [0, -0.20 * s * limb, 0]);
    // shoe
    put(knee, box(0.12 * s, 0.075 * s, 0.24 * s), m.accent, [0, -0.42 * s * limb, 0.05 * s]);
    legs.push({ hip, knee, side });
  });

  return {
    root, hips, torso, neck, head, face, arms, legs, hands,
    materials: m,
    build,
  };
}
