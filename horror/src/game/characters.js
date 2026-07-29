import * as THREE from 'three';
import { collapse } from '../engine/geometry.js';

// ---------------------------------------------------------------------------
// بناء الشخصيات — character rig builder.
//
// One parametric body used by everyone. What separates a nine-year-old girl
// from a hunched crawler is the proportion table, not different code:
// head-to-body ratio, limb thickness, spine curvature, and the face set.
//
// Limbs are capsules and the torso is a lathed profile, so the silhouette
// tapers the way a body does — boxes were the main reason the cast read as
// shop mannequins. Skin, cloth and hair carry real texture maps, and every
// character takes a seed that shifts its height, build and colouring, so two
// crawlers in the same room are no longer the same object twice.
//
// The rig's shape is a hard contract: enemies.js and boss.js drive
// `root/hips/torso/neck/head/face{jaw,lids,eyeGlow}/arms[].shoulder/.elbow/
// .hand/legs[].hip/.knee` and mutate `materials.skin` directly.
// ---------------------------------------------------------------------------

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const sph = (r, a = 10, b = 8) => new THREE.SphereGeometry(r, a, b);
/** Capsule along Y. Total length is `len + 2 * r`. */
const cap = (r, len, seg = 8) => new THREE.CapsuleGeometry(r, Math.max(0.001, len), 3, seg);

/** Texture library, handed over once at boot so rigs can be built anywhere. */
let TEX = null;
const texCache = new Map();

export function setCharacterTextures(textures) {
  TEX = textures;
  texCache.clear();
}

/**
 * A texture set at a given tiling. Clones share the underlying `source`, so
 * the repeat can differ per use without a second upload to the GPU.
 */
function tex(key, repeat) {
  if (!TEX || !TEX[key]) return null;
  const id = `${key}@${repeat}`;
  const hit = texCache.get(id);
  if (hit) return hit;
  const set = {};
  ['map', 'normalMap', 'roughnessMap'].forEach((slot) => {
    const src = TEX[key][slot];
    if (!src) return;
    const clone = src.clone();
    clone.repeat.set(repeat, repeat);
    clone.needsUpdate = true;
    set[slot] = clone;
  });
  texCache.set(id, set);
  return set;
}

function surfaceMaterial(colour, key, repeat, { roughness = 0.8, normalScale = 1, reflectivity = 0.05 } = {}) {
  const set = tex(key, repeat);
  const material = new THREE.MeshStandardMaterial({
    color: colour,
    map: set?.map || null,
    normalMap: set?.normalMap || null,
    roughnessMap: set?.roughnessMap || null,
    roughness,
    metalness: 0,
  });
  if (material.normalMap) material.normalScale.set(normalScale, normalScale);
  material.userData.reflectivity = reflectivity;
  return material;
}

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

/** Deterministic per-character RNG, so a seed always yields the same body. */
function rng(seed) {
  let s = ((seed | 0) * 1103515245 + 12345) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s >>> 8) / 16777216;
  };
}

/** Nudges a hex colour's hue and lightness — used for per-instance variation. */
function vary(hex, hueShift, lightShift) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(
    (hsl.h + hueShift + 1) % 1,
    Math.max(0, Math.min(1, hsl.s * (1 + hueShift * 2))),
    Math.max(0.02, Math.min(0.96, hsl.l + lightShift))
  );
  return c.getHex();
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
    face: 'adult', beard: true, hairStyle: 'short', garment: 'coat',
  },
  layla: {
    scale: 0.66, head: 0.150, shoulder: 0.135, limb: 0.86, hunch: 0.0,
    skin: 0xb8907a, cloth: 0x5e2b3c, accent: 0x7a3b50, hair: 0x241610,
    face: 'child', beard: false, hairStyle: 'long', dress: true, garment: 'dress',
  },
  crawler: {
    scale: 0.94, head: 0.104, shoulder: 0.165, limb: 1.22, hunch: 0.55,
    skin: 0x8e8071, cloth: 0x23202a, accent: 0x141118, hair: 0x000000,
    face: 'monster', beard: false, hairStyle: 'none', gaunt: true, garment: 'rags',
  },
  stalker: {
    scale: 1.2, head: 0.098, shoulder: 0.215, limb: 1.15, hunch: 0.34,
    skin: 0x6f5f56, cloth: 0x161820, accent: 0x0d0f14, hair: 0x000000,
    face: 'monster', beard: false, hairStyle: 'none', gaunt: true, garment: 'rags',
  },
  shepherd: {
    scale: 1.42, head: 0.105, shoulder: 0.27, limb: 1.06, hunch: 0.10,
    skin: 0x6d5b62, cloth: 0x120d14, accent: 0x090609, hair: 0x000000,
    face: 'masked', beard: false, hairStyle: 'none', garment: 'robe',
  },
};

function makeMaterials(build) {
  const skin = surfaceMaterial(build.skin, 'skin', 2.2, { roughness: 0.74, normalScale: 0.7 });
  const cloth = surfaceMaterial(build.cloth, 'clothTwill', 4, { roughness: 0.94, normalScale: 1.1 });
  const accent = surfaceMaterial(build.accent, 'clothTwill', 5, { roughness: 0.9, normalScale: 1.0 });
  const hair = surfaceMaterial(build.hair, 'hair', 3, { roughness: 0.7, normalScale: 1.3 });
  const sclera = new THREE.MeshStandardMaterial({ color: 0xd8d2c8, roughness: 0.28, metalness: 0 });
  const iris = new THREE.MeshStandardMaterial({ color: 0x2c1c12, roughness: 0.16, metalness: 0 });
  const lips = surfaceMaterial(0x8a5148, 'skin', 3, { roughness: 0.62, normalScale: 0.5 });
  sclera.userData.reflectivity = 0.5;
  iris.userData.reflectivity = 0.7;
  return { skin, cloth, accent, hair, sclera, iris, lips };
}

/**
 * Builds a face into `head`. Returns handles for the parts that animate:
 * eyelids (blinking) and the jaw (speaking, screaming).
 */
function buildFace(head, m, build, r) {
  const face = {};

  // cranium: a squashed sphere, plus a flatter occiput behind it
  put(head, sph(r, 16, 14), m.skin, [0, 0, 0], null, [0.92, 1.06, 0.94]);
  put(head, sph(r * 0.86, 12, 10), m.skin, [0, -r * 0.18, -r * 0.22], null, [0.95, 0.9, 0.9]);

  if (build.face === 'masked') {
    // a leather mask: faceplate, straps, and two burning eye slits
    const leather = surfaceMaterial(0xcdbf9f, 'clothTwill', 3, { roughness: 0.62, reflectivity: 0.12 });
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
    collapse(head);
    return face;
  }

  const child = build.face === 'child';
  const monster = build.face === 'monster';
  // children: eyes lower and wider apart, small nose, round cheeks
  const eyeY = child ? -r * 0.02 : r * 0.10;
  const eyeX = r * (child ? 0.40 : 0.36);
  const eyeR = r * (child ? 0.19 : 0.155);
  const front = r * 0.80;

  // brow ridge — two swells over the eyes rather than a shelf across the face,
  // heavy and shadowed on the monsters, barely there on the child
  const browY = eyeY + r * (child ? 0.30 : 0.34);
  [-1, 1].forEach((side) => {
    put(head, sph(r * 0.30, 10, 8), m.skin,
      [side * eyeX * 0.95, browY, r * 0.74], [monster ? 0.22 : 0.1, 0, 0],
      [1.1, monster ? 0.46 : 0.30, 0.42]);
  });
  // glabella, so the two swells read as one brow
  put(head, sph(r * 0.17, 8, 6), m.skin, [0, browY - r * 0.04, r * 0.76],
    null, [1.0, monster ? 0.48 : 0.34, 0.42]);

  // eye sockets, eyeballs, irises
  const lids = [];
  [-1, 1].forEach((side) => {
    const socket = new THREE.Group();
    socket.position.set(side * eyeX, eyeY, r * 0.80);
    head.add(socket);
    put(socket, sph(eyeR, 12, 10), m.sclera, [0, 0, 0], null, [1, 0.86, 0.7]);
    put(socket, sph(eyeR * 0.52, 10, 8), m.iris, [0, 0, eyeR * 0.62], null, [1, 1, 0.5]);
    put(socket, sph(eyeR * 0.24, 8, 6), m.iris, [0, 0, eyeR * 0.78], null, [1, 1, 0.4]);
    if (monster) {
      put(socket, new THREE.TorusGeometry(eyeR * 1.15, eyeR * 0.3, 6, 12), m.accent,
        [0, 0, -eyeR * 0.2], [0, 0, 0]);
    }
    // upper lid — driven for blinking, so it must stay its own mesh
    const lid = put(socket, sph(eyeR * 1.06, 12, 8), m.skin,
      [0, eyeR * 0.62, 0], null, [1.05, 0.6, 0.9]);
    lids.push(lid);
    collapse(socket, new Set([lid]));
  });
  face.lids = lids;

  // nose: bridge, tip and nostrils
  const noseLen = r * (child ? 0.34 : 0.46);
  put(head, box(r * 0.20, noseLen, r * 0.22), m.skin, [0, eyeY - noseLen * 0.35, front * 0.86], [0.12, 0, 0]);
  put(head, sph(r * (child ? 0.13 : 0.115), 10, 8), m.skin, [0, eyeY - noseLen * 0.78, front * 0.95]);
  [-1, 1].forEach((side) => {
    put(head, sph(r * 0.06, 6, 5), m.accent, [side * r * 0.11, eyeY - noseLen * 0.86, front * 0.88]);
  });

  // cheekbones
  [-1, 1].forEach((side) => {
    put(head, sph(r * (child ? 0.30 : 0.26), 10, 8), m.skin,
      [side * r * 0.52, eyeY - r * 0.30, front * 0.58], null,
      [1, monster ? 0.6 : 0.85, 0.7]);
  });

  // jaw on a hinge so it can open to speak or scream
  const jaw = new THREE.Group();
  jaw.position.set(0, -r * 0.42, -r * 0.10);
  head.add(jaw);
  put(jaw, sph(r * 0.56, 12, 10), m.skin, [0, -r * 0.18, r * 0.42], null,
    [0.95, 0.62, child ? 0.86 : 0.98]);
  put(jaw, box(r * 0.62, r * 0.12, r * 0.14), m.lips, [0, -r * 0.06, r * 0.94]);
  if (monster) {
    for (let i = -3; i <= 3; i += 1) {
      put(jaw, box(r * 0.08, r * 0.16, r * 0.06), m.sclera, [i * r * 0.13, -r * 0.02, r * 0.95]);
    }
  }
  collapse(jaw);
  face.jaw = jaw;

  // ears
  [-1, 1].forEach((side) => {
    put(head, sph(r * 0.16, 8, 6), m.skin, [side * r * 0.92, eyeY - r * 0.05, r * 0.02],
      null, [0.45, 1.1, 0.8]);
  });

  // hair
  if (build.hairStyle === 'short') {
    put(head, sph(r * 1.01, 14, 12), m.hair, [0, r * 0.26, -r * 0.16], null, [0.99, 0.74, 0.96]);
    // a hairline across the temples, kept back off the brow
    put(head, sph(r * 0.86, 12, 10), m.hair, [0, r * 0.58, r * 0.02], null, [1.0, 0.38, 0.66]);
  } else if (build.hairStyle === 'long') {
    put(head, sph(r * 1.05, 14, 12), m.hair, [0, r * 0.26, -r * 0.12], null, [1.0, 0.82, 0.98]);
    put(head, sph(r * 0.88, 12, 10), m.hair, [0, r * 0.56, r * 0.06], null, [1.0, 0.40, 0.66]);
    // a fall of hair down the back, and two braids
    put(head, cap(r * 0.72, r * 1.1, 10), m.hair, [0, -r * 0.5, -r * 0.72], null, [1.05, 1, 0.6]);
    [-1, 1].forEach((side) => {
      put(head, cap(r * 0.20, r * 1.2, 8), m.hair,
        [side * r * 0.72, -r * 0.95, -r * 0.35], [0.12, 0, side * 0.1]);
    });
  }

  if (build.beard) {
    put(head, sph(r * 0.56, 12, 10), m.hair, [0, -r * 0.70, r * 0.55], null, [0.95, 0.62, 0.78]);
  }

  collapse(head);
  return face;
}

/** Clothing built as geometry rather than painted on as a colour. */
function buildGarment(torso, hips, m, build, s) {
  const shoulder = build.shoulder;
  switch (build.garment) {
    case 'coat':
      // lapels, a hem that hangs past the hips, and a buttoned front
      put(torso, box(shoulder * 2.1, 0.46 * s, 0.28 * s), m.cloth, [0, 0.04 * s, 0]);
      [-1, 1].forEach((side) => {
        put(torso, box(shoulder * 0.62, 0.34 * s, 0.05 * s), m.cloth,
          [side * shoulder * 0.62, 0.14 * s, 0.132 * s], [0, 0, side * 0.30]);
      });
      put(hips, new THREE.CylinderGeometry(0.23 * s, 0.30 * s, 0.42 * s, 14, 1, true), m.cloth,
        [0, -0.16 * s, 0]);
      [0.10, -0.02].forEach((y) => {
        put(torso, new THREE.CylinderGeometry(0.014 * s, 0.014 * s, 0.012 * s, 6), m.accent,
          [0.03 * s, y * s, 0.142 * s], [Math.PI / 2, 0, 0]);
      });
      break;
    case 'dress':
      // a gathered waist and a flared skirt
      put(torso, box(0.34 * s, 0.40 * s, 0.22 * s), m.cloth, [0, 0.02 * s, 0]);
      put(hips, new THREE.CylinderGeometry(0.17 * s, 0.34 * s, 0.38 * s, 16), m.cloth, [0, -0.18 * s, 0]);
      put(hips, new THREE.CylinderGeometry(0.34 * s, 0.35 * s, 0.04 * s, 16), m.accent, [0, -0.37 * s, 0]);
      put(torso, new THREE.CylinderGeometry(0.19 * s, 0.19 * s, 0.05 * s, 14), m.accent, [0, -0.16 * s, 0]);
      put(torso, box(0.22 * s, 0.06 * s, 0.03 * s), m.accent, [0, 0.24 * s, 0.11 * s]);   // collar
      break;
    case 'rags': {
      // torn strips hanging off the frame at uneven lengths
      put(torso, box(0.36 * s, 0.36 * s, 0.21 * s), m.cloth, [0, 0.02 * s, 0]);
      for (let i = 0; i < 7; i += 1) {
        const a = (i / 7) * Math.PI * 2;
        const len = 0.22 + ((i * 5) % 4) * 0.11;
        put(hips, box(0.09 * s, len * s, 0.04 * s), m.cloth,
          [Math.cos(a) * 0.15 * s, -len * s * 0.5, Math.sin(a) * 0.12 * s],
          [0, -a, (i % 3 - 1) * 0.14]);
      }
      break;
    }
    case 'robe':
      put(torso, new THREE.CylinderGeometry(shoulder * 1.15, shoulder * 1.4, 0.52 * s, 14), m.cloth,
        [0, 0.02 * s, 0]);
      put(hips, new THREE.CylinderGeometry(shoulder * 1.4, shoulder * 1.85, 0.70 * s, 14, 1, true), m.cloth,
        [0, -0.30 * s, 0]);
      break;
    default:
      put(torso, box(0.40 * s, 0.42 * s, 0.23 * s), m.cloth, [0, 0.02 * s, 0]);
  }
}

/**
 * Assembles a full rig. `seed` varies height, build and colouring so repeated
 * enemies are not clones. Returns the rig contract enemies.js and boss.js
 * depend on: root/hips/torso/neck/head/face/arms/legs/hands.
 */
export function buildCharacter(kind, seed = 0) {
  const preset = BUILDS[kind] || BUILDS.karim;
  const random = rng(seed);
  // one draw of variation per character, applied to the preset
  const build = {
    ...preset,
    scale: preset.scale * (0.93 + random() * 0.14),
    shoulder: preset.shoulder * (0.94 + random() * 0.12),
    limb: preset.limb * (0.96 + random() * 0.09),
    skin: vary(preset.skin, (random() - 0.5) * 0.03, (random() - 0.5) * 0.09),
    cloth: vary(preset.cloth, (random() - 0.5) * 0.06, (random() - 0.5) * 0.07),
  };

  const m = makeMaterials(build);
  const s = build.scale;
  const limb = build.limb;
  const root = new THREE.Group();

  const hips = new THREE.Group();
  hips.position.y = 0.92 * s;
  hips.rotation.x = build.hunch * 0.5;
  root.add(hips);

  put(hips, cap(0.15 * s, 0.06 * s, 12), m.cloth, [0, -0.02 * s, 0], null, [1, 1, 0.75]);

  const torso = new THREE.Group();
  torso.position.y = 0.30 * s;
  hips.add(torso);

  // ribcage: a lathed profile, narrow at the waist and broad at the chest
  const profile = [
    [0.17, -0.22], [0.19, -0.14], [0.205, -0.04], [0.215, 0.06],
    [0.205, 0.16], [0.17, 0.24], [0.10, 0.30],
  ].map(([x, y]) => new THREE.Vector2(x * s * (build.shoulder / 0.20), y * s));
  put(torso, new THREE.LatheGeometry(profile, 16), m.skin, [0, 0, 0], null, [1, 1, 0.72]);

  buildGarment(torso, hips, m, build, s);
  put(torso, cap(build.shoulder * 1.02, 0.06 * s, 12), m.cloth, [0, 0.26 * s, 0], null, [1, 0.55, 0.72]);
  put(torso, box(build.shoulder * 1.5, 0.10 * s, 0.05 * s), m.accent, [0, 0.30 * s, 0.12 * s]);

  if (build.gaunt) {
    // ribs pushing through the skin
    for (let i = 0; i < 4; i += 1) {
      put(torso, box(0.30 * s, 0.025 * s, 0.03 * s), m.skin, [0, (0.16 - i * 0.09) * s, 0.115 * s]);
    }
  }

  const neck = new THREE.Group();
  neck.position.y = 0.36 * s;
  torso.add(neck);
  put(neck, cap(0.058 * s, 0.05 * s, 10), m.skin, [0, 0.02 * s, 0]);

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
    put(shoulder, sph(0.062 * s, 10, 8), m.cloth, [0, 0, 0]);
    put(shoulder, cap(0.050 * s, 0.26 * s * limb, 10), m.cloth, [0, -0.18 * s * limb, 0]);

    const elbow = new THREE.Group();
    elbow.position.y = -0.36 * s * limb;
    shoulder.add(elbow);
    put(elbow, cap(0.042 * s, 0.24 * s * limb, 10), m.skin, [0, -0.16 * s * limb, 0]);

    // hand: palm, thumb and four fingers — on screen in every cutscene where
    // Karim reaches for Layla, so it cannot stay a box
    const hand = new THREE.Group();
    hand.position.y = -0.34 * s * limb;
    elbow.add(hand);
    put(hand, box(0.072 * s, 0.09 * s, 0.040 * s), m.skin, [0, -0.045 * s, 0]);
    put(hand, cap(0.015 * s, 0.035 * s, 6), m.skin,
      [side * 0.044 * s, -0.035 * s, 0.006 * s], [0, 0, side * 0.7]);
    const fingerLen = build.gaunt ? 0.085 : 0.048;
    for (let f = 0; f < 4; f += 1) {
      put(hand, cap(0.0125 * s, fingerLen * s, 6), m.skin,
        [(f - 1.5) * 0.021 * s, -0.10 * s - fingerLen * s * 0.5, 0],
        [0.12, 0, (f - 1.5) * 0.05]);
    }
    collapse(hand);
    collapse(elbow);
    collapse(shoulder);
    hands.push(hand);
    arms.push({ shoulder, elbow, hand, side });

    const hip = new THREE.Group();
    hip.position.set(side * 0.11 * s, -0.06 * s, 0);
    hips.add(hip);
    put(hip, cap(0.068 * s, 0.30 * s * limb, 10), m.cloth, [0, -0.21 * s * limb, 0]);

    const knee = new THREE.Group();
    knee.position.y = -0.42 * s * limb;
    hip.add(knee);
    put(knee, cap(0.057 * s, 0.30 * s * limb, 10), m.cloth, [0, -0.20 * s * limb, 0]);
    // shoe
    put(knee, box(0.11 * s, 0.065 * s, 0.22 * s), m.accent, [0, -0.42 * s * limb, 0.05 * s]);
    put(knee, cap(0.055 * s, 0.02 * s, 8), m.accent,
      [0, -0.42 * s * limb, 0.15 * s], [Math.PI / 2, 0, 0], [1, 1, 0.55]);
    collapse(knee);
    collapse(hip);
    legs.push({ hip, knee, side });
  });

  collapse(torso);
  collapse(hips);
  collapse(neck);

  return {
    root, hips, torso, neck, head, face, arms, legs, hands,
    materials: m,
    build,
  };
}
