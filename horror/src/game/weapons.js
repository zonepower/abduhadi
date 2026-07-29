import * as THREE from 'three';
import { buildViewModel, buildMuzzleFlash, ShellPool } from './viewmodels.js';

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

export class Weapons {
  constructor(camera, audio) {
    this.camera = camera;
    this.audio = audio;
    this.root = new THREE.Group();
    // Held far enough forward that the whole weapon sits inside the 62° view
    // lens — at the old near-plane distance most of it fell outside the frame.
    this.root.position.set(0.16, -0.14, -0.30);
    this.root.scale.setScalar(0.92);
    camera.add(this.root);

    // Layer 1 is the view-model layer: rendered in a second pass with a
    // narrower lens and a cleared depth buffer, so the gun never distorts at
    // the frame edge and never clips through a wall.
    this.LAYER = 1;

    // Art-directed lighting that belongs to the gun, not to the room — this is
    // why a view model reads the same in every level.
    this.keyLight = new THREE.DirectionalLight(0xfff0dc, 5.5);
    this.keyLight.position.set(-0.6, 1.0, 0.7);
    this.keyLight.layers.set(this.LAYER);
    camera.add(this.keyLight);
    camera.add(this.keyLight.target);
    this.rimLight = new THREE.DirectionalLight(0x8fb4e0, 3.4);
    this.rimLight.position.set(0.9, 0.2, -0.9);
    this.rimLight.layers.set(this.LAYER);
    camera.add(this.rimLight);
    camera.add(this.rimLight.target);
    this.fillLight = new THREE.AmbientLight(0x5d6a80, 2.6);
    this.fillLight.layers.set(this.LAYER);
    camera.add(this.fillLight);

    this.models = {};
    this.rigs = {};
    Object.keys(WEAPON_DEFS).forEach((id) => {
      const rig = buildViewModel(id);
      rig.root.visible = false;
      this.root.add(rig.root);
      this.models[id] = rig.root;
      this.rigs[id] = rig;
    });

    this.muzzle = new THREE.PointLight(0xffd08a, 0, 9, 1.4);
    this.root.add(this.muzzle);
    this.flash = buildMuzzleFlash();
    this.root.add(this.flash.group);
    this.shells = null;          // bound per chapter by the game
    this.root.traverse((o) => o.layers.set(this.LAYER));
    this.muzzle.layers.set(this.LAYER);
    this.flashTimer = 0;
    this.ejectQueue = [];
    this.cylinderSpin = 0;
    this.breakOpen = 0;

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
    this.root.traverse((o) => o.layers.set(this.LAYER));
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

    // muzzle flash: light + geometry, both alive for ~50 ms
    const rig = this.rigs[this.current];
    this.muzzle.position.set(...rig.muzzle);
    this.muzzle.intensity = def.sound === 'shotgun' ? 26 : 16;
    this.flash.group.position.set(...rig.muzzle);
    this.flash.group.rotation.z = Math.random() * Math.PI;
    this.flash.group.scale.setScalar(def.sound === 'shotgun' ? 1.35 : 1);
    this.flash.group.visible = true;
    this.flash.material.opacity = 0.95;
    this.flashTimer = 0.055;
    if (this.current === 'revolver') this.cylinderSpin -= Math.PI / 3;
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

  /**
   * Queues a case to be thrown clear. Timing runs off the game clock, not
   * setTimeout, so it stays in step with slow motion and never fires into a
   * chapter that has already been unloaded.
   */
  #eject(kind, delay = 0) {
    if (!this.shells) return;
    this.ejectQueue.push({ kind, delay, from: this.current });
  }

  #spawnShell(kind, weapon) {
    const rig = this.rigs[weapon] || this.rigs[this.current];
    if (!rig || !this.shells) return;
    const origin = new THREE.Vector3(...rig.eject);
    this.root.localToWorld(origin);
    const quat = this.camera.getWorldQuaternion(new THREE.Quaternion());
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);
    const velocity = right.multiplyScalar(1.7 + Math.random() * 0.9)
      .addScaledVector(new THREE.Vector3(0, 1, 0), 1.4 + Math.random() * 0.8);
    this.shells.spawn(kind, origin, velocity);
  }

  #drainEjectQueue(dt) {
    for (let i = this.ejectQueue.length - 1; i >= 0; i -= 1) {
      const e = this.ejectQueue[i];
      e.delay -= dt;
      if (e.delay <= 0) {
        this.#spawnShell(e.kind, e.from);
        this.ejectQueue.splice(i, 1);
      }
    }
  }

  update(dt, input, ctx) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.swingTimer = Math.max(0, this.swingTimer - dt);
    this.muzzle.intensity *= Math.max(0, 1 - dt * 22);
    this.kick = Math.max(0, this.kick - dt * 5);

    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      this.flash.material.opacity = Math.max(0, this.flashTimer / 0.055) * 0.95;
      if (this.flashTimer <= 0) this.flash.group.visible = false;
    }

    const wasReloading = this.reloading > 0;
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.reloading = 0;
        this.reloadNow(this.current);
      }
    }

    this.#animateMechanism(dt, wasReloading);
    this.#drainEjectQueue(dt);
    this.shells?.update(dt);

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
    const targetSway2 = new THREE.Vector2(
      THREE.MathUtils.clamp(-input.mouse.dx * 0.0012, -0.05, 0.05),
      THREE.MathUtils.clamp(input.mouse.dy * 0.0012, -0.05, 0.05)
    );
    this.swayOffset.lerp(targetSway2, Math.min(1, dt * 6));

    const player = ctx.player;
    const def = this.def;
    const bob = Math.sin(player.stepPhase * 2.4) * 0.014;
    const bobY = Math.abs(Math.cos(player.stepPhase * 2.4)) * 0.012;
    const aiming = ctx.canAct && input.mouse.right && def.kind === 'gun' && this.reloading <= 0;
    this.aiming = aiming;

    // Aiming lines the sights up on the screen centre; the hip pose sits low
    // and to the right the way a held gun actually rides.
    // Aiming puts the sight line dead centre: the revolver's blade and notch
    // both sit at y≈+0.048 local, the shotgun's rib and bead at y≈+0.016.
    const ADS = {
      revolver: { x: 0, y: -0.048, z: -0.26 },
      shotgun: { x: 0, y: -0.018, z: -0.14 },
      axe: { x: 0.10, y: -0.12, z: -0.26 },
    };
    const HIP = {
      revolver: { x: 0.16, y: -0.14, z: -0.30 },
      shotgun: { x: 0.15, y: -0.16, z: -0.20 },
      axe: { x: 0.19, y: -0.17, z: -0.24 },
      hands: { x: 0.17, y: -0.15, z: -0.28 },
    };
    const target = aiming ? (ADS[this.current] || { x: 0, y: -0.05, z: -0.26 })
      : (HIP[this.current] || HIP.hands);
    const speed = aiming ? 13 : 9;

    const reloadDip = this.reloading > 0 ? 0.10 : 0;
    this.root.position.x += (target.x + this.swayOffset.x * (aiming ? 0.3 : 1) + bob * (aiming ? 0.25 : 1) - this.root.position.x) * Math.min(1, dt * speed);
    this.root.position.y += (target.y + this.swayOffset.y * (aiming ? 0.3 : 1) - bobY * (aiming ? 0.3 : 1) - reloadDip - this.root.position.y) * Math.min(1, dt * speed);
    this.root.position.z += (target.z + this.kick * 0.055 - this.root.position.z) * Math.min(1, dt * 11);

    // recoil: a sharp muzzle rise that settles, not a linear fade
    const rise = this.kick * this.kick;
    this.root.rotation.x = -rise * 0.30 + this.swingTimer * 1.7 + (this.reloading > 0 ? 0.35 : 0);
    this.root.rotation.z = this.swayOffset.x * (aiming ? 0.8 : 2.5) + (this.reloading > 0 ? 0.30 : 0);
    this.root.rotation.y = this.swayOffset.y * (aiming ? 0.2 : 0.8);
  }

  /**
   * Drives the moving parts: the revolver's cylinder and hammer, and the
   * shotgun breaking open to dump its shells halfway through a reload.
   */
  #animateMechanism(dt, wasReloading) {
    const rig = this.rigs[this.current];
    if (!rig) return;
    const parts = rig.parts;
    const def = this.def;

    if (this.current === 'revolver') {
      // the cylinder indexes one chamber per shot and free-spins on reload
      if (this.reloading > 0) this.cylinderSpin -= dt * 9;
      // brass hits the floor when the cylinder is swung out, all at once
      if (wasReloading && this.reloading <= def.reload * 0.55 && !this._dumped) {
        this._dumped = true;
        const spent = def.clip - (this.ammo.revolver || 0);
        for (let i = 0; i < spent; i += 1) this.#eject('revolver', i * 0.045);
      }
      if (this.reloading <= 0 && this.cooldown <= 0) this._dumped = false;
      if (parts.cylinder) {
        parts.cylinder.rotation.z += (this.cylinderSpin - parts.cylinder.rotation.z) * Math.min(1, dt * 14);
      }
      if (parts.hammer) {
        // cocked while the trigger is at rest, dropped the instant it fires
        const cocked = this.cooldown > def.rate * 0.55 ? 0 : -0.55;
        parts.hammer.rotation.x += (cocked - parts.hammer.rotation.x) * Math.min(1, dt * 18);
      }
      if (parts.trigger) {
        const pulled = this.cooldown > def.rate * 0.6 ? -0.35 : 0;
        parts.trigger.rotation.x += (pulled - parts.trigger.rotation.x) * Math.min(1, dt * 20);
      }
    }

    if (this.current === 'shotgun') {
      // open for the first 60% of the reload, then snap shut
      const openTarget = this.reloading > def.reload * 0.4 ? 1 : 0;
      this.breakOpen += (openTarget - this.breakOpen) * Math.min(1, dt * 9);
      if (parts.barrels) parts.barrels.rotation.x = this.breakOpen * 0.42;
      if (parts.lever) parts.lever.rotation.y = this.breakOpen * 0.8;
      // eject both hulls right as it swings open
      if (wasReloading && this.breakOpen > 0.75 && !this._dumped) {
        this._dumped = true;
        this.#eject('shotgun');
        this.#eject('shotgun', 0.08);
      }
      if (this.reloading <= 0) this._dumped = false;
    }
  }
}
