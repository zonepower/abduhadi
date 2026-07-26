import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Actors: the player's daughter and the things that live in the house.
// All bodies are built from boxes and animated procedurally.
// ---------------------------------------------------------------------------

function limb(w, h, d, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildBody(palette, scale = 1, gaunt = 1) {
  const root = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: palette.skin, roughness: 0.82 });
  const cloth = new THREE.MeshStandardMaterial({ color: palette.cloth, roughness: 0.95 });
  skin.userData.reflectivity = 0.08;
  cloth.userData.reflectivity = 0.03;

  const hips = new THREE.Group();
  hips.position.y = 0.92 * scale;
  root.add(hips);

  const torso = limb(0.46 * scale / gaunt, 0.68 * scale, 0.26 * scale / gaunt, cloth);
  torso.position.y = 0.3 * scale;
  hips.add(torso);

  const neck = new THREE.Group();
  neck.position.y = 0.66 * scale;
  hips.add(neck);
  const head = limb(0.24 * scale, 0.3 * scale, 0.24 * scale, skin);
  head.position.y = 0.16 * scale;
  neck.add(head);

  const arms = [];
  const legs = [];
  [-1, 1].forEach((side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.28 * scale / gaunt, 0.56 * scale, 0);
    hips.add(shoulder);
    const upper = limb(0.12 * scale, 0.36 * scale, 0.12 * scale, skin);
    upper.position.y = -0.18 * scale;
    shoulder.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -0.36 * scale;
    shoulder.add(elbow);
    const lower = limb(0.1 * scale, 0.34 * scale, 0.1 * scale, skin);
    lower.position.y = -0.17 * scale;
    elbow.add(lower);
    arms.push({ shoulder, elbow, side });

    const hip = new THREE.Group();
    hip.position.set(side * 0.14 * scale, 0, 0);
    hips.add(hip);
    const thigh = limb(0.15 * scale, 0.44 * scale, 0.15 * scale, cloth);
    thigh.position.y = -0.22 * scale;
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -0.44 * scale;
    hip.add(knee);
    const shin = limb(0.13 * scale, 0.42 * scale, 0.13 * scale, cloth);
    shin.position.y = -0.21 * scale;
    knee.add(shin);
    legs.push({ hip, knee, side });
  });

  return { root, hips, neck, head, arms, legs, materials: { skin, cloth } };
}

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

    this.body = buildBody(opts.palette || { skin: 0x8f7f70, cloth: 0x2b2b31 }, opts.scale ?? 1, opts.gaunt ?? 1);
    this.mesh = this.body.root;
    this.mesh.position.copy(this.position);
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

  animate(dt, moving) {
    this.animTime += dt * (moving ? 8 : 1.4);
    const swing = Math.sin(this.animTime) * (moving ? 0.9 : 0.09);
    const counter = Math.sin(this.animTime + Math.PI) * (moving ? 0.9 : 0.09);
    this.body.legs[0].hip.rotation.x = swing * 0.6;
    this.body.legs[1].hip.rotation.x = counter * 0.6;
    this.body.legs[0].knee.rotation.x = Math.max(0, -swing) * 0.7;
    this.body.legs[1].knee.rotation.x = Math.max(0, -counter) * 0.7;
    this.body.arms[0].shoulder.rotation.x = counter * 0.5 + this.armPose;
    this.body.arms[1].shoulder.rotation.x = swing * 0.5 + this.armPose;
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
        radius: 0.38, height: 1.6, speed: 3.35, health: 58, scale: 0.92, gaunt: 1.35,
        palette: { skin: 0x9a8a7c, cloth: 0x23202a }, damage: 14, attackRate: 1.05, sight: 22,
      },
      stalker: {
        radius: 0.46, height: 2.1, speed: 2.5, health: 135, scale: 1.18, gaunt: 1.1,
        palette: { skin: 0x6f5f56, cloth: 0x161820 }, damage: 26, attackRate: 1.6, sight: 26,
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
      radius: 0.4, height: 1.78, speed: 3, health: 9999, scale: 1.02,
      palette: { skin: 0xb08a6a, cloth: 0x2f3742 },
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
      radius: 0.3, height: 1.25, speed: 3.1, health: 9999, scale: 0.66,
      palette: { skin: 0xd8b49a, cloth: 0x7a3550 },
    });
    this.followDistance = 2.4;
    this.mode = 'follow';
    this.scared = 0;
    this.glow = new THREE.PointLight(0xffc9a8, 2.2, 5.5, 2);
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
    this.glow.intensity = 1.4 + Math.sin(performance.now() * 0.004) * 0.3;
    this.animate(dt, moving);
    if (this.scared > 0.3) {
      this.body.arms.forEach((a) => { a.shoulder.rotation.x = -1.1; a.elbow.rotation.x = -1.2; });
    }
    this.syncMesh();
  }
}
