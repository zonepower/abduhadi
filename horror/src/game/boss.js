import * as THREE from 'three';
import { Actor } from './enemies.js';

// ---------------------------------------------------------------------------
// الراعي — the final boss. Three phases, each one adding a tool:
//   1) pressure    : charges, forces you to keep moving
//   2) control     : teleports + throws hooks, punishes camping behind a pillar
//   3) desperation : slams, summons, and moves faster than you can walk
// ---------------------------------------------------------------------------

export class Boss extends Actor {
  constructor(level, position, audio) {
    super(level, position, {
      radius: 0.62,
      height: 2.6,
      speed: 2.9,
      health: 900,
      scale: 1.45,
      gaunt: 0.85,
      palette: { skin: 0x74616a, cloth: 0x120d14 },
    });

    this.audio = audio;
    this.phase = 1;
    this.state = 'idle';
    this.timer = 0;
    this.attackTimer = 2.0;
    this.invuln = false;
    this.onSummon = null;
    this.onPhase = null;
    this.projectiles = [];
    this.laughTimer = 6;
    this.damageMul = 1;

    const maskMat = new THREE.MeshStandardMaterial({ color: 0xd9cdb4, roughness: 0.55 });
    maskMat.userData.reflectivity = 0.2;
    const mask = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.36, 0.06), maskMat);
    mask.position.set(0, 0.24, 0.19);
    mask.castShadow = true;
    this.body.neck.add(mask);

    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: 0xff2a1a, emissiveIntensity: 3, roughness: 1,
    });
    [-0.08, 0.08].forEach((x) => {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.03), eyeMat);
      eye.position.set(x, 0.3, 0.23);
      this.body.neck.add(eye);
    });
    this.eyeMat = eyeMat;

    const coatMat = new THREE.MeshStandardMaterial({ color: 0x0d0a10, roughness: 1 });
    const coat = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.5, 0.5), coatMat);
    coat.position.set(0, -0.2, 0);
    coat.castShadow = true;
    this.body.hips.add(coat);

    const steel = new THREE.MeshStandardMaterial({ color: 0x585c63, roughness: 0.3, metalness: 1 });
    steel.userData.reflectivity = 0.65;
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.06, 6, 12, Math.PI * 1.5), steel);
    hook.position.set(0, -0.6, 0.1);
    hook.rotation.z = 0.4;
    hook.castShadow = true;
    this.body.arms[1].elbow.add(hook);

    this.aura = new THREE.PointLight(0xff3018, 6, 12, 2);
    this.aura.position.set(0, 1.6, 0);
    this.mesh.add(this.aura);
  }

  get hipHeight() { return 1.32; }

  get armPose() { return -0.25; }

  get phaseThresholds() { return [0.66, 0.33]; }

  damage(amount, from) {
    if (this.invuln || !this.alive) return;
    super.damage(amount * 1, from);
    this.stagger = Math.min(this.stagger, 0.12); // he barely flinches
    const ratio = this.health / this.maxHealth;
    if (this.phase === 1 && ratio <= this.phaseThresholds[0]) this.enterPhase(2);
    else if (this.phase === 2 && ratio <= this.phaseThresholds[1]) this.enterPhase(3);
  }

  enterPhase(phase) {
    this.phase = phase;
    this.state = 'phase';
    this.timer = 2.2;
    this.invuln = true;
    this.speed = phase === 3 ? 4.4 : phase === 2 ? 3.4 : 2.9;
    this.damageMul = phase === 3 ? 1.5 : phase === 2 ? 1.2 : 1;
    this.aura.intensity = 6 + phase * 4;
    this.eyeMat.emissiveIntensity = 3 + phase * 2;
    this.audio?.stinger('rage');
    if (this.onPhase) this.onPhase(phase);
  }

  #throwHook(target) {
    const dir = new THREE.Vector3().subVectors(target, this.position).setY(0).normalize();
    const geo = new THREE.TorusGeometry(0.2, 0.06, 6, 10, Math.PI * 1.5);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x8a8f97, roughness: 0.25, metalness: 1, emissive: 0x330805, emissiveIntensity: 1.5,
    });
    mat.userData.reflectivity = 0.7;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.position.set(this.position.x, 1.5, this.position.z);
    const light = new THREE.PointLight(0xff5a2a, 4, 6, 2);
    mesh.add(light);
    this.projectiles.push({
      mesh,
      velocity: dir.multiplyScalar(15),
      life: 3.2,
      damage: 18 * this.damageMul,
    });
    return mesh;
  }

  #teleport(player) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 6 + Math.random() * 4;
    for (let i = 0; i < 8; i += 1) {
      const a = angle + (i / 8) * Math.PI * 2;
      const x = player.position.x + Math.cos(a) * dist;
      const z = player.position.z + Math.sin(a) * dist;
      if (!this.level.isSolidWorld(x, z)) {
        this.position.set(x, 0, z);
        this.path = null;
        return true;
      }
    }
    return false;
  }

  update(dt, ctx) {
    const { player, scene } = ctx;
    if (!this.alive) {
      this.updateCorpse(dt);
      this.aura.intensity *= Math.max(0, 1 - dt * 2);
      this.eyeMat.emissiveIntensity *= Math.max(0, 1 - dt * 2);
      this.syncMesh();
      return;
    }

    const dist = this.distanceTo(player.position);
    this.timer -= dt;
    this.attackTimer -= dt;
    this.laughTimer -= dt;

    if (this.laughTimer <= 0) {
      this.laughTimer = 9 + Math.random() * 8;
      if (ctx.onLaugh) ctx.onLaugh();
    }

    switch (this.state) {
      case 'phase':
        this.velocity.multiplyScalar(Math.max(0, 1 - dt * 6));
        this.body.arms.forEach((a) => { a.shoulder.rotation.x = -2.4; });
        this.mesh.position.y = Math.sin(this.timer * 6) * 0.08;
        if (this.timer <= 0) {
          this.invuln = false;
          this.state = 'chase';
          this.mesh.position.y = 0;
          if (this.onSummon) this.onSummon(this.phase === 3 ? 4 : 2);
        }
        break;

      case 'idle':
        this.faceTowards(player.position, dt, 3);
        if (dist < 26) this.state = 'chase';
        this.animate(dt, false);
        break;

      case 'chase': {
        this.followPath(player.position, dt, 1);
        this.faceTowards(player.position, dt, 6);
        this.animate(dt, true);
        if (this.attackTimer <= 0) {
          if (dist < 3.2) { this.state = 'slam'; this.timer = 0.62; }
          else if (this.phase >= 2 && dist > 6) { this.state = 'throw'; this.timer = 0.55; }
          else { this.state = 'charge'; this.timer = 1.1; }
          this.attackTimer = this.phase === 3 ? 1.9 : this.phase === 2 ? 2.6 : 3.2;
        }
        break;
      }

      case 'charge': {
        this.faceTowards(player.position, dt, 2.5);
        this.moveTowards(player.position, dt, 2.3);
        this.animate(dt, true);
        if (dist < this.radius + 1.6) {
          player.damage(20 * this.damageMul, this.position);
          this.audio?.impact(true);
          this.state = 'chase';
        }
        if (this.timer <= 0) this.state = 'chase';
        break;
      }

      case 'slam': {
        this.velocity.multiplyScalar(Math.max(0, 1 - dt * 9));
        this.body.arms.forEach((a) => { a.shoulder.rotation.x = -2.6 + (0.62 - this.timer) * 5; });
        if (this.timer <= 0) {
          this.audio?.impact(true);
          this.audio?.stinger('shock');
          if (dist < 4.2) player.damage(28 * this.damageMul, this.position);
          if (ctx.onShockwave) ctx.onShockwave(this.position.clone());
          this.state = 'chase';
        }
        break;
      }

      case 'throw': {
        this.faceTowards(player.position, dt, 8);
        this.velocity.multiplyScalar(Math.max(0, 1 - dt * 8));
        this.body.arms[1].shoulder.rotation.x = -2.2 + (0.55 - this.timer) * 4;
        if (this.timer <= 0) {
          const mesh = this.#throwHook(player.position.clone().setY(1.4));
          scene.add(mesh);
          this.audio?.swing();
          if (this.phase === 3 && Math.random() < 0.6) {
            this.state = 'blink';
            this.timer = 0.45;
          } else {
            this.state = 'chase';
          }
        }
        break;
      }

      case 'blink': {
        this.mesh.scale.setScalar(Math.max(0.02, this.timer / 0.45));
        if (this.timer <= 0) {
          this.#teleport(player);
          this.mesh.scale.setScalar(1);
          this.state = 'chase';
          this.audio?.stinger('shock');
        }
        break;
      }

      default:
        this.animate(dt, false);
    }

    // projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
      const p = this.projectiles[i];
      p.life -= dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.mesh.rotation.x += dt * 9;
      p.mesh.rotation.y += dt * 6;
      const hitWall = this.level.isSolidWorld(p.mesh.position.x, p.mesh.position.z);
      const hitPlayer = Math.hypot(
        p.mesh.position.x - player.position.x,
        p.mesh.position.z - player.position.z
      ) < 0.8;
      if (hitPlayer) player.damage(p.damage, this.position);
      if (p.life <= 0 || hitWall || hitPlayer) {
        scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        this.projectiles.splice(i, 1);
        if (hitWall || hitPlayer) this.audio?.impact(false);
      }
    }

    this.aura.intensity = (6 + this.phase * 4) * (0.8 + Math.sin(performance.now() * 0.006) * 0.2);
    this.syncMesh();
  }

  clearProjectiles(scene) {
    this.projectiles.forEach((p) => { scene.remove(p.mesh); p.mesh.geometry.dispose(); });
    this.projectiles.length = 0;
  }
}
