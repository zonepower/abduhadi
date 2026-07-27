import * as THREE from 'three';
import { buildCharacter } from './characters.js';

// ---------------------------------------------------------------------------
// Actors: the player's daughter and the things that live in the house.
// All bodies are built from boxes and animated procedurally.
// ---------------------------------------------------------------------------

// Bodies come from characters.js; Actor only drives them.

export class Actor {
  constructor(level, position, opts = {}) {
    this.level = level;
    this.position = position.clone();
    this.position.y = 0;
    this.velocity = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.radius = opts.radius ?? 0.4;
    this.height = opts.height ?? 1.8;
    this.speed = opts.speed ?? 2.4;
    this.health = opts.health ?? 60;
    this.maxHealth = this.health;
    this.alive = true;
    this.state = opts.state || 'idle';
    this.path = null;
    this.pathIndex = 0;
    this.repathTimer = 0;
    this.animTime = Math.random() * 10;
    this.stagger = 0;
    this.deadTimer = 0;

    this.body = buildCharacter(opts.kind || 'karim');
    this.body.materials.skinRef = this.body.materials.skin;
    this.mesh = this.body.root;
    this.mesh.position.copy(this.position);
    this.blinkTimer = 1 + Math.random() * 4;
    this.blink = 0;
    this.jawOpen = 0;
  }

  addTo(scene) { scene.add(this.mesh); }

  removeFrom(scene) { scene.remove(this.mesh); }

  distanceTo(target) {
    return Math.hypot(target.x - this.position.x, target.z - this.position.z);
  }

  faceTowards(target, dt, rate = 6) {
    const desired = Math.atan2(target.x - this.position.x, target.z - this.position.z);
    let diff = desired - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * Math.min(1, dt * rate);
  }

  moveTowards(point, dt, speedScale = 1) {
    const dx = point.x - this.position.x;
    const dz = point.z - this.position.z;
    const dist = Math.hypot(dx, dz) || 0.0001;
    const speed = this.speed * speedScale;
    this.velocity.x += ((dx / dist) * speed - this.velocity.x) * Math.min(1, dt * 8);
    this.velocity.z += ((dz / dist) * speed - this.velocity.z) * Math.min(1, dt * 8);
    const nx = this.position.x + this.velocity.x * dt;
    const nz = this.position.z + this.velocity.z * dt;
    const fixed = this.level.resolve(nx, nz, this.radius);
    this.position.x = fixed.x;
    this.position.z = fixed.z;
    return dist;
  }

  followPath(target, dt, speedScale = 1) {
    this.repathTimer -= dt;
    if (this.repathTimer <= 0 || !this.path) {
      this.repathTimer = 0.45 + Math.random() * 0.3;
      if (this.level.hasLineOfSight(this.position.x, this.position.z, target.x, target.z)) {
        this.path = [target.clone()];
        this.pathIndex = 0;
      } else {
        const path = this.level.findPath(this.position, target);
        if (path && path.length) {
          this.path = path;
          this.pathIndex = Math.min(1, path.length - 1);
        }
      }
    }
    if (!this.path || !this.path.length) return this.distanceTo(target);
    const waypoint = this.path[this.pathIndex];
    const d = this.moveTowards(waypoint, dt, speedScale);
    if (d < 0.6 && this.pathIndex < this.path.length - 1) this.pathIndex += 1;
    return this.distanceTo(target);
  }

  /** Blinks, and lets the jaw hang open while something is being said. */
  animateFace(dt) {
    const face = this.body.face;
    if (!face) return;
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinkTimer = 2.2 + Math.random() * 4.5;
      this.blink = 1;
    }
    this.blink = Math.max(0, this.blink - dt * 7);
    if (face.lids) {
      const closed = Math.sin(Math.min(1, this.blink) * Math.PI);
      face.lids.forEach((lid) => { lid.position.y = lid.userData.rest ??= lid.position.y; });
      face.lids.forEach((lid) => {
        lid.scale.y = 0.6 + closed * 1.6;
        lid.position.y = (lid.userData.rest || 0) * (1 - closed * 0.9);
      });
    }
    if (face.jaw) {
      face.jaw.rotation.x += (this.jawOpen * 0.42 - face.jaw.rotation.x) * Math.min(1, dt * 12);
    }
    this.jawOpen = Math.max(0, this.jawOpen - dt * 2.2);
  }

  animate(dt, moving) {
    this.animateFace(dt);
    this.animTime += dt * (moving ? 8 : 1.4);
    const swing = Math.sin(this.animTime) * (moving ? 0.9 : 0.09);
    const counter = Math.sin(this.animTime + Math.PI) * (moving ? 0.9 : 0.09);
    this.body.legs[0].hip.rotation.x = swing * 0.6;
    this.body.legs[1].hip.rotation.x = counter * 0.6;
    this.body.legs[0].knee.rotation.x = Math.max(0, -swing) * 0.7;
    this.body.legs[1].knee.rotation.x = Math.max(0, -counter) * 0.7;
    this.body.arms[0].shoulder.rotation.x = counter * 0.5 + this.armPose;
    this.body.arms[1].shoulder.rotation.x = swing * 0.5 + this.armPose;
    this.body.arms[0].elbow.rotation.x = -Math.abs(counter) * 0.35 - 0.12;
    this.body.arms[1].elbow.rotation.x = -Math.abs(swing) * 0.35 - 0.12;
    this.body.hips.position.y = this.hipHeight + Math.abs(Math.sin(this.animTime)) * (moving ? 0.05 : 0.01);
    this.body.neck.rotation.z = Math.sin(this.animTime * 0.4) * 0.06;
  }

  get armPose() { return 0; }

  get hipHeight() { return 0.92; }

  damage(amount, from) {
    if (!this.alive) return;
    this.health -= amount;
    this.stagger = Math.min(0.45, amount * 0.006);
    if (from) {
      const dir = new THREE.Vector3().subVectors(this.position, from).setY(0).normalize();
      this.position.addScaledVector(dir, 0.14);
    }
    if (this.health <= 0) this.die();
  }

  die() {
    this.alive = false;
    this.state = 'dead';
    this.deadTimer = 0;
  }

  updateCorpse(dt) {
    this.deadTimer += dt;
    const t = Math.min(1, this.deadTimer * 2.2);
    this.mesh.rotation.x = -t * Math.PI * 0.48;
    this.mesh.position.y = -t * 0.35;
    this.body.materials.skin.color.lerp(new THREE.Color(0x3a3033), Math.min(1, dt * 1.4));
  }

  syncMesh() {
    this.mesh.position.x = this.position.x;
    this.mesh.position.z = this.position.z;
    this.mesh.rotation.y = this.yaw;
  }
}

// --- hostile ---------------------------------------------------------------

export class Enemy extends Actor {
  constructor(level, position, type, audio) {
    const presets = {
      crawler: {
        radius: 0.38, height: 1.6, speed: 3.35, health: 58, kind: 'crawler',
        damage: 14, attackRate: 1.05, sight: 22,
      },
      stalker: {
        radius: 0.46, height: 2.1, speed: 2.5, health: 135, kind: 'stalker',
        damage: 26, attackRate: 1.6, sight: 26,
      },
    };
    const preset = presets[type] || presets.crawler;
    super(level, position, preset);
    this.type = type;
    this.audio = audio;
    this.damageAmount = preset.damage;
    this.attackRate = preset.attackRate;
    this.sight = preset.sight;
    this.attackTimer = 0;
    this.noticeTimer = 0;
    this.growlTimer = Math.random() * 6;
    this.dormant = false;
    this.lungeTimer = 0;
    this.spawnAnim = 1;

    // gaunt silhouette: long arms, hunched neck
    this.body.arms.forEach((a) => { a.shoulder.rotation.x = -0.35; });
    this.body.neck.rotation.x = 0.35;
    this.body.materials.skin.emissive = new THREE.Color(0x120608);
  }

  get armPose() { return -0.55; }

  get hipHeight() { return this.type === 'crawler' ? 0.82 : 0.98; }

  wake() {
    this.dormant = false;
    this.state = 'alert';
    this.noticeTimer = 0.5;
    this.audio?.growl(0, this.type === 'stalker' ? 1.4 : 1);
  }

  update(dt, ctx) {
    if (!this.alive) {
      this.updateCorpse(dt);
      this.syncMesh();
      return;
    }

    const { player, listener } = ctx;
    if (this.spawnAnim > 0) {
      this.spawnAnim = Math.max(0, this.spawnAnim - dt * 1.4);
      this.mesh.position.y = -this.spawnAnim * 1.6;
      this.mesh.scale.setScalar(1 - this.spawnAnim * 0.15);
    }

    if (this.dormant) {
      this.animate(dt, false);
      this.syncMesh();
      return;
    }

    const dist = this.distanceTo(player.position);
    const sees = dist < this.sight
      && this.level.hasLineOfSight(this.position.x, this.position.z, player.position.x, player.position.z);
    const heard = dist < 7.5;

    if (this.stagger > 0) {
      this.stagger -= dt;
      this.animate(dt, false);
      this.syncMesh();
      return;
    }

    switch (this.state) {
      case 'idle':
        if (sees || heard) { this.state = 'alert'; this.noticeTimer = 0.65; this.audio?.growl(this.panOf(listener)); }
        this.animate(dt, false);
        break;
      case 'alert':
        this.noticeTimer -= dt;
        this.faceTowards(player.position, dt, 4);
        if (this.noticeTimer <= 0) this.state = 'chase';
        this.animate(dt, false);
        break;
      case 'chase': {
        this.followPath(player.position, dt, this.lungeTimer > 0 ? 1.55 : 1);
        this.faceTowards(player.position, dt, 7);
        if (dist < this.radius + 1.35) this.state = 'attack';
        if (!sees && dist > this.sight * 1.4) this.state = 'idle';
        this.lungeTimer -= dt;
        if (this.lungeTimer < -3 && dist < 9 && sees) this.lungeTimer = 0.9;
        this.animate(dt, true);
        break;
      }
      case 'attack': {
        this.faceTowards(player.position, dt, 9);
        this.attackTimer -= dt;
        if (dist > this.radius + 2.0) { this.state = 'chase'; break; }
        if (this.attackTimer <= 0) {
          this.attackTimer = this.attackRate;
          this.swingAnim = 0.35;
          if (player.damage(this.damageAmount, this.position)) {
            this.audio?.impact(true, this.panOf(listener));
          }
        }
        this.animate(dt, false);
        break;
      }
      default:
        this.animate(dt, false);
    }

    if (this.swingAnim > 0) {
      this.swingAnim -= dt;
      this.body.arms.forEach((a) => { a.shoulder.rotation.x = -1.9 + this.swingAnim * 3; });
    }

    this.growlTimer -= dt;
    if (this.growlTimer <= 0 && this.state !== 'idle' && dist < 18) {
      this.growlTimer = 3 + Math.random() * 5;
      this.audio?.growl(this.panOf(listener), this.type === 'stalker' ? 1.5 : 1);
    }

    this.syncMesh();
  }

  panOf(listener) {
    if (!listener) return 0;
    const dx = this.position.x - listener.position.x;
    const dz = this.position.z - listener.position.z;
    const right = Math.cos(listener.yaw) * dx - Math.sin(listener.yaw) * dz;
    const dist = Math.hypot(dx, dz) || 1;
    return THREE.MathUtils.clamp(right / dist, -1, 1);
  }
}

// --- the player's own body, used only by the camera during cutscenes --------

export class PlayerAvatar extends Actor {
  constructor(level, position) {
    super(level, position, {
      radius: 0.4, height: 1.78, speed: 3, health: 9999, kind: 'karim',
    });
    this.mesh.visible = false;
    this.pose = 'stand';
    this.poseTime = 0;
  }

  show(position, yaw) {
    this.position.copy(position);
    this.position.y = 0;
    if (yaw !== undefined) this.yaw = yaw;
    this.mesh.visible = true;
    this.syncMesh();
  }

  hide() { this.mesh.visible = false; }

  setPose(pose) {
    if (this.pose === pose) return;
    this.pose = pose;
    this.poseTime = 0;
  }

  update(dt) {
    if (!this.mesh.visible) return;
    this.poseTime += dt;
    const ease = Math.min(1, this.poseTime * 1.6);
    const body = this.body;
    const lerp = (obj, prop, target, rate = 6) => {
      obj[prop] += (target - obj[prop]) * Math.min(1, dt * rate);
    };

    if (this.pose === 'plead') {
      // both arms out, palms up, leaning forward
      body.arms.forEach((a) => {
        lerp(a.shoulder.rotation, 'x', -1.15);
        lerp(a.elbow.rotation, 'x', -0.35);
      });
      lerp(body.hips.rotation, 'x', 0.12);
      lerp(body.neck.rotation, 'x', -0.08);
      lerp(body.hips.position, 'y', 0.9);
    } else if (this.pose === 'kneel') {
      // dropped to his knees, head down, arms hanging
      lerp(body.hips.position, 'y', 0.5, 3);
      lerp(body.hips.rotation, 'x', 0.42, 3);
      lerp(body.neck.rotation, 'x', 0.65, 3);
      body.legs.forEach((l) => { lerp(l.hip.rotation, 'x', -1.35, 3); lerp(l.knee.rotation, 'x', 1.6, 3); });
      body.arms.forEach((a) => { lerp(a.shoulder.rotation, 'x', 0.25); lerp(a.elbow.rotation, 'x', -0.2); });
      // shoulders shaking with the crying
      body.hips.rotation.z = Math.sin(this.poseTime * 9) * 0.02 * ease;
    } else if (this.pose === 'rise') {
      lerp(body.hips.position, 'y', 0.92, 2.2);
      lerp(body.hips.rotation, 'x', -0.06, 2.2);
      lerp(body.neck.rotation, 'x', -0.14, 2.2);
      body.legs.forEach((l) => { lerp(l.hip.rotation, 'x', 0, 2.2); lerp(l.knee.rotation, 'x', 0, 2.2); });
      body.arms.forEach((a) => { lerp(a.shoulder.rotation, 'x', -0.2); lerp(a.elbow.rotation, 'x', -0.5); });
      body.hips.rotation.z *= 0.9;
    } else {
      this.animate(dt, false);
    }
    this.syncMesh();
  }
}

// --- companion --------------------------------------------------------------

export class Companion extends Actor {
  constructor(level, position) {
    super(level, position, {
      radius: 0.3, height: 1.25, speed: 3.1, health: 9999, kind: 'layla',
    });
    this.followDistance = 2.4;
    this.mode = 'follow';
    this.scared = 0;
    this.glow = new THREE.PointLight(0xffc0a0, 4.5, 4.2, 1.7);
    this.glow.position.set(0, 1.1, 0);
    this.mesh.add(this.glow);
  }

  get hipHeight() { return 0.62; }

  update(dt, ctx) {
    const { player, threat } = ctx;
    const dist = this.distanceTo(player.position);
    let moving = false;

    if (this.mode === 'follow') {
      if (dist > this.followDistance) {
        this.followPath(player.position, dt, dist > 8 ? 1.35 : 1);
        this.faceTowards(player.position, dt, 8);
        moving = true;
      } else {
        this.velocity.multiplyScalar(Math.max(0, 1 - dt * 8));
        this.faceTowards(player.position, dt, 4);
      }
    } else if (this.mode === 'hide') {
      this.velocity.multiplyScalar(Math.max(0, 1 - dt * 10));
      this.body.hips.position.y = 0.42;
    } else if (this.mode === 'flee' && this.fleeTarget) {
      this.followPath(this.fleeTarget, dt, 1.4);
      moving = true;
    }

    this.scared = THREE.MathUtils.clamp(this.scared + ((threat ? 1 : -0.5) * dt), 0, 1);
    this.glow.intensity = 4.0 + Math.sin(performance.now() * 0.004) * 0.6;
    this.animate(dt, moving);
    if (this.scared > 0.3) {
      this.body.arms.forEach((a) => { a.shoulder.rotation.x = -1.1; a.elbow.rotation.x = -1.2; });
    }
    this.syncMesh();
  }
}
