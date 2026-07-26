import * as THREE from 'three';

// ---------------------------------------------------------------------------
// View-model weapons. Everything is procedural geometry parented to the camera.
// ---------------------------------------------------------------------------

export const WEAPON_DEFS = {
  hands: { name: 'يدان فارغتان', kind: 'none' },
  axe: {
    name: 'فأس الحطب', kind: 'melee', damage: 55, rate: 0.72, reach: 2.4, arc: 0.8,
  },
  revolver: {
    name: 'مسدس', kind: 'gun', damage: 42, rate: 0.42, clip: 6, reload: 1.9,
    spread: 0.012, pellets: 1, recoil: 0.055, sound: 'revolver',
  },
  shotgun: {
    name: 'بندقية صيد', kind: 'gun', damage: 22, rate: 0.95, clip: 2, reload: 2.6,
    spread: 0.075, pellets: 8, recoil: 0.13, sound: 'shotgun',
  },
};

function metalMat(color, rough = 0.35) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.9 });
  m.userData.reflectivity = 0.5;
  return m;
}

function buildViewModel(id) {
  const g = new THREE.Group();
  const steel = metalMat(0x3d4148, 0.32);
  const dark = metalMat(0x1c1e22, 0.55);
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a3b24, roughness: 0.72 });

  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.noGBuffer = true;
    g.add(mesh);
    return mesh;
  };

  if (id === 'revolver') {
    add(new THREE.BoxGeometry(0.045, 0.045, 0.3), steel, 0, 0.01, -0.2);
    add(new THREE.CylinderGeometry(0.045, 0.045, 0.09, 10), steel, 0, 0.005, -0.11, Math.PI / 2);
    add(new THREE.BoxGeometry(0.04, 0.13, 0.05), wood, 0, -0.08, -0.02, 0.32);
    add(new THREE.BoxGeometry(0.02, 0.03, 0.03), dark, 0, -0.02, -0.06);
  } else if (id === 'shotgun') {
    add(new THREE.CylinderGeometry(0.028, 0.028, 0.62, 10), steel, 0.012, 0.005, -0.3, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.028, 0.028, 0.62, 10), steel, -0.012, 0.005, -0.3, Math.PI / 2);
    add(new THREE.BoxGeometry(0.07, 0.06, 0.26), wood, 0, -0.015, -0.02);
    add(new THREE.BoxGeometry(0.055, 0.11, 0.16), wood, 0, -0.07, 0.09, 0.22);
    add(new THREE.BoxGeometry(0.07, 0.05, 0.14), dark, 0, -0.03, -0.24);
  } else if (id === 'axe') {
    add(new THREE.CylinderGeometry(0.022, 0.026, 0.6, 8), wood, 0, -0.05, -0.18, Math.PI / 2.6);
    add(new THREE.BoxGeometry(0.03, 0.16, 0.2), steel, 0.01, 0.16, -0.42);
    add(new THREE.BoxGeometry(0.035, 0.06, 0.06), dark, 0.01, 0.16, -0.3);
  } else {
    add(new THREE.BoxGeometry(0.05, 0.05, 0.16), dark, 0, -0.01, -0.14);
  }

  g.traverse((o) => { o.frustumCulled = false; });
  return g;
}

export class Weapons {
  constructor(camera, audio) {
    this.camera = camera;
    this.audio = audio;
    this.root = new THREE.Group();
    this.root.position.set(0.19, -0.19, -0.02);
    camera.add(this.root);

    this.models = {};
    Object.keys(WEAPON_DEFS).forEach((id) => {
      const model = buildViewModel(id);
      model.visible = false;
      this.root.add(model);
      this.models[id] = model;
    });

    this.muzzle = new THREE.PointLight(0xffd08a, 0, 9, 2);
    this.muzzle.position.set(0, 0.02, -0.5);
    this.root.add(this.muzzle);

    this.owned = new Set(['hands']);
    this.ammo = { revolver: 0, shotgun: 0 };
    this.reserve = { revolver: 0, shotgun: 0 };
    this.current = 'hands';
    this.cooldown = 0;
    this.reloading = 0;
    this.swayOffset = new THREE.Vector2();
    this.kick = 0;
    this.swingTimer = 0;
    this.onHit = null;
    this.onShoot = null;
    this.setWeapon('hands');
  }

  give(id, ammo = 0) {
    this.owned.add(id);
    if (WEAPON_DEFS[id]?.kind === 'gun') {
      this.reserve[id] = (this.reserve[id] || 0) + ammo;
      if (this.ammo[id] === 0) this.reloadNow(id);
    }
    this.setWeapon(id);
  }

  addAmmo(id, amount) {
    if (!WEAPON_DEFS[id] || WEAPON_DEFS[id].kind !== 'gun') return;
    this.reserve[id] = (this.reserve[id] || 0) + amount;
  }

  reloadNow(id) {
    const def = WEAPON_DEFS[id];
    const need = def.clip - (this.ammo[id] || 0);
    const take = Math.min(need, this.reserve[id] || 0);
    this.ammo[id] = (this.ammo[id] || 0) + take;
    this.reserve[id] -= take;
  }

  setWeapon(id) {
    if (!this.owned.has(id)) return false;
    this.current = id;
    Object.entries(this.models).forEach(([key, model]) => { model.visible = key === id; });
    this.reloading = 0;
    this.cooldown = 0.25;
    return true;
  }

  cycle(dir) {
    const list = Object.keys(WEAPON_DEFS).filter((id) => this.owned.has(id));
    const idx = list.indexOf(this.current);
    const next = list[(idx + dir + list.length) % list.length];
    this.setWeapon(next);
  }

  get def() { return WEAPON_DEFS[this.current]; }

  get ammoText() {
    const def = this.def;
    if (def.kind !== 'gun') return '—';
    return `${this.ammo[this.current] || 0} / ${this.reserve[this.current] || 0}`;
  }

  startReload() {
    const def = this.def;
    if (def.kind !== 'gun') return;
    if (this.reloading > 0) return;
    if ((this.ammo[this.current] || 0) >= def.clip) return;
    if ((this.reserve[this.current] || 0) <= 0) return;
    this.reloading = def.reload;
    this.audio?.reload();
  }

  #hitScan(origin, direction, enemies, level, range = 60) {
    let best = null;
    let bestT = range;
    enemies.forEach((enemy) => {
      if (!enemy.alive) return;
      const toEnemy = new THREE.Vector3().subVectors(enemy.position, origin);
      const t = toEnemy.dot(direction);
      if (t < 0.4 || t > bestT) return;
      const closest = new THREE.Vector3().copy(direction).multiplyScalar(t).add(origin);
      const dy = closest.y - (enemy.position.y + enemy.height * 0.5);
      if (Math.abs(dy) > enemy.height * 0.62) return;
      const planar = Math.hypot(closest.x - enemy.position.x, closest.z - enemy.position.z);
      if (planar > enemy.radius * 1.15) return;
      if (level && !level.hasLineOfSight(origin.x, origin.z, enemy.position.x, enemy.position.z)) return;
      best = { enemy, t, point: closest, headshot: dy > enemy.height * 0.22 };
      bestT = t;
    });
    return best;
  }

  fire(ctx) {
    const def = this.def;
    const { player, enemies, level } = ctx;
    if (def.kind === 'none') return;

    if (def.kind === 'melee') {
      this.cooldown = def.rate;
      this.swingTimer = def.rate;
      this.audio?.swing();
      const dir = player.forward();
      let hits = 0;
      enemies.forEach((enemy) => {
        if (!enemy.alive) return;
        const to = new THREE.Vector3().subVectors(enemy.position, player.position).setY(0);
        const dist = to.length();
        if (dist > def.reach + enemy.radius) return;
        to.normalize();
        if (to.dot(dir) < Math.cos(def.arc)) return;
        enemy.damage(def.damage, player.position);
        hits += 1;
      });
      if (hits) {
        this.audio?.impact(true);
        this.kick = 0.5;
        if (this.onHit) this.onHit(hits);
      }
      return;
    }

    if (this.reloading > 0) return;
    if ((this.ammo[this.current] || 0) <= 0) {
      this.audio?.dryFire();
      this.cooldown = 0.28;
      this.startReload();
      return;
    }

    this.ammo[this.current] -= 1;
    this.cooldown = def.rate;
    this.kick = 1;
    this.audio?.gunshot(def.sound);
    this.muzzle.intensity = 14;
    player.recoil.y += def.recoil;
    player.recoil.x += (Math.random() - 0.5) * def.recoil * 0.6;
    if (this.onShoot) this.onShoot(def);

    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    const base = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()));

    for (let i = 0; i < def.pellets; i += 1) {
      const dir = base.clone();
      dir.x += (Math.random() - 0.5) * def.spread * 2;
      dir.y += (Math.random() - 0.5) * def.spread * 2;
      dir.z += (Math.random() - 0.5) * def.spread * 0.4;
      dir.normalize();
      const hit = this.#hitScan(origin, dir, enemies, level);
      if (hit) {
        const dmg = def.damage * (hit.headshot ? 2.1 : 1) * (1 - Math.min(0.45, hit.t / 90));
        hit.enemy.damage(dmg, player.position);
        if (this.onHit) this.onHit(1, hit.headshot);
      }
    }
    this.audio?.impact(false);
  }

  update(dt, input, ctx) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.swingTimer = Math.max(0, this.swingTimer - dt);
    this.muzzle.intensity *= Math.max(0, 1 - dt * 16);
    this.kick = Math.max(0, this.kick - dt * 5);

    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.reloading = 0;
        this.reloadNow(this.current);
      }
    }

    if (ctx.canAct) {
      if (input.tapped('KeyR')) this.startReload();
      if (input.tapped('Digit1')) this.setWeapon('hands');
      if (input.tapped('Digit2') && this.owned.has('axe')) this.setWeapon('axe');
      if (input.tapped('Digit3') && this.owned.has('revolver')) this.setWeapon('revolver');
      if (input.tapped('Digit4') && this.owned.has('shotgun')) this.setWeapon('shotgun');
      if (input.wheel) this.cycle(input.wheel > 0 ? 1 : -1);
      const trigger = this.def.kind === 'melee' ? input.mouse.leftEdge : input.mouse.left;
      if (trigger && this.cooldown <= 0) this.fire(ctx);
    }

    // sway + aim-down feel
    const targetSway = new THREE.Vector2(
      THREE.MathUtils.clamp(-input.mouse.dx * 0.0012, -0.05, 0.05),
      THREE.MathUtils.clamp(input.mouse.dy * 0.0012, -0.05, 0.05)
    );
    this.swayOffset.lerp(targetSway, Math.min(1, dt * 6));

    const player = ctx.player;
    const bob = Math.sin(player.stepPhase * 2.4) * 0.014;
    const bobY = Math.abs(Math.cos(player.stepPhase * 2.4)) * 0.012;
    const aiming = ctx.canAct && input.mouse.right && this.def.kind === 'gun';
    const restX = aiming ? 0.0 : 0.19;
    const restY = aiming ? -0.115 : -0.19;

    this.root.position.x += (restX + this.swayOffset.x + bob - this.root.position.x) * Math.min(1, dt * 9);
    this.root.position.y += (restY + this.swayOffset.y - bobY - this.root.position.y) * Math.min(1, dt * 9);
    this.root.position.z += ((this.reloading > 0 ? 0.12 : -0.02) + this.kick * 0.08 - this.root.position.z) * Math.min(1, dt * 10);
    this.root.rotation.x = this.kick * -0.28 + (this.reloading > 0 ? 0.5 : 0) + this.swingTimer * 1.6;
    this.root.rotation.z = this.swayOffset.x * 2.5 + (this.reloading > 0 ? 0.4 : 0);
  }
}
