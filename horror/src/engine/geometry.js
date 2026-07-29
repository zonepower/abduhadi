import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Geometry welding.
//
// `mergeGeometries` is not part of the vendored three build, and both the level
// props and the character rigs are assembled from dozens of small primitives —
// one draw call each would run to thousands. These helpers weld a built
// hierarchy down to one mesh per material.
// ---------------------------------------------------------------------------

/** Concatenates geometries into a single non-indexed buffer. */
export function mergeBuffers(geometries) {
  const parts = geometries.map((g) => (g.index ? g.toNonIndexed() : g));
  let count = 0;
  parts.forEach((g) => { count += g.attributes.position.count; });
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  let v = 0;
  parts.forEach((g) => {
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const t = g.attributes.uv;
    position.set(p.array.subarray(0, p.count * 3), v * 3);
    if (n) normal.set(n.array.subarray(0, p.count * 3), v * 3);
    if (t) uv.set(t.array.subarray(0, p.count * 2), v * 2);
    v += p.count;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Collapses a whole hierarchy into one mesh per material, keeping its lights
 * and `userData`. Call it while the root still sits at the origin, so the
 * baked matrices stay local and the caller can position the result freely.
 */
export function mergeGroup(root) {
  root.updateMatrixWorld(true);
  const byMaterial = new Map();
  const lights = [];
  root.traverse((o) => {
    if (o.isMesh) {
      const key = o.material.uuid;
      if (!byMaterial.has(key)) byMaterial.set(key, { material: o.material, geos: [] });
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      byMaterial.get(key).geos.push(g);
    } else if (o.isLight) {
      lights.push(o);
    }
  });

  const out = new THREE.Group();
  byMaterial.forEach(({ material, geos }) => {
    const mesh = new THREE.Mesh(mergeBuffers(geos), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    out.add(mesh);
    geos.forEach((g) => g.dispose());
  });
  lights.forEach((light) => {
    light.position.setFromMatrixPosition(light.matrixWorld);
    light.rotation.set(0, 0, 0);
    out.add(light);
  });
  out.userData = root.userData;
  return out;
}

/**
 * Welds only the *direct* mesh children of a node, per material, and leaves
 * child groups alone.
 *
 * This is the form a skeleton needs: every joint is a Group, so collapsing at
 * this granularity turns the thirty-odd primitives that make up a torso or a
 * forearm into one or two meshes without ever welding across a joint that has
 * to keep rotating. Anything in `skip` is left as its own mesh — eyelids, for
 * instance, which animate independently of the face around them.
 */
export function collapse(node, skip = null) {
  const meshes = node.children.filter((c) => c.isMesh && !(skip && skip.has(c)));
  if (meshes.length < 2) return node;

  const byMaterial = new Map();
  meshes.forEach((mesh) => {
    mesh.updateMatrix();
    const key = mesh.material.uuid;
    if (!byMaterial.has(key)) byMaterial.set(key, { material: mesh.material, geos: [] });
    const g = mesh.geometry.clone();
    g.applyMatrix4(mesh.matrix);
    byMaterial.get(key).geos.push(g);
    node.remove(mesh);
  });

  byMaterial.forEach(({ material, geos }) => {
    if (geos.length === 1) {
      // nothing to gain from a merge, but the transform is already baked
      const mesh = new THREE.Mesh(geos[0], material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      node.add(mesh);
      return;
    }
    const mesh = new THREE.Mesh(mergeBuffers(geos), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    node.add(mesh);
    geos.forEach((g) => g.dispose());
  });
  return node;
}
