import * as THREE from 'three';
import { TILE } from './builder.js';

const EYE_HEIGHT = 1.68;
const RADIUS = 0.42;

export class Player {
  constructor(camera, audio) {
    this.camera = camera;
    this.audio = audio;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.bob = 0;
    this.stepPhase = 0;
    this.crouch = 0;

    this.health = 100;
    this.maxHealth = 100;
    this.sanity = 1;
    this.stamina = 1;
    this.alive = true;
    this.invuln = 0;
    this.damageFlash = 0;
    this.recoil = new THREE.Vector2();

    this.hasFlashlight = false;
    this.flashlightOn = false;
    this.battery = 1;

    // physically-decaying spot: intensity is candela, so keep it modest
    this.flashlight = new THREE.SpotLight(0xfff0d2, 0, 26, 0.46, 0.72, 1.05);
    this.flashlight.castShadow = true;
    this.flashlight.shadow.mapSize.set(1024, 1024);
    this.flashlight.shadow.camera.near = 0.2;
    this.flashlight.shadow.camera.far = 30;
    this.flashlight.shadow.bias = -0.0018;
    this.flashlightTarget = new THREE.Object3D();
    this.flashlight.target = this.flashlightTarget;

    this.inventory = new Set();
    this.keys = new Set();
    this.interactTarget = null;
    this.footTimer = 0;
    this.lastSurface = 'wood';
  }

  attachTo(scene) {
    scene.add(this.flashlight);
    scene.add(this.flashlightTarget);
  }

  spawn(position, yaw = 0) {
    this.position.copy(position);
    this.position.y = 0;
    this.yaw = yaw;
    this.pitch = 0;
    this.velocity.set(0, 0, 0);
    this.alive = true;
    this.invuln = 1.0;
  }

  reset() {
    this.health = this.maxHealth;
    this.sanity = 1;
    this.stamina = 1;
    this.alive = true;
    this.damageFlash = 0;
  }

  get eye() {
    return EYE_HEIGHT - this.crouch * 0.55;
  }

  forward() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  right() {
    return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  damage(amount, source) {
    if (!this.alive || this.invuln > 0) return false;
    this.health -= amount;
    this.invuln = 0.55;
    this.damageFlash = 1;
    this.sanity = Math.max(0, this.sanity - amount * 0.004);
    this.audio?.hurt();
    if (source) {
      const dir = new THREE.Vector3().subVectors(this.position, source).setY(0).normalize();
      this.velocity.addScaledVector(dir, 4.5);
    }
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
    }
    return true;
  }

  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  toggleFlashlight() {
    if (!this.hasFlashlight || this.battery <= 0) return false;
    this.flashlightOn = !this.flashlightOn;
    return this.flashlightOn;
  }

  update(dt, input, level, opts = {}) {
    const look = input.consumeLook(dt);
    this.yaw -= look.dx;
    this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch - look.dy));

    // recoil decays back to centre
    this.recoil.multiplyScalar(Math.max(0, 1 - dt * 7));

    const axis = input.axis();
    const wantsRun = input.down('ShiftLeft') || input.down('ShiftRight');
    const wantsCrouch = input.down('ControlLeft') || input.down('KeyC');
    this.crouch += ((wantsCrouch ? 1 : 0) - this.crouch) * Math.min(1, dt * 9);

    const surface = level ? level.surfaceAt(this.position.x, this.position.z) : 'wood';
    this.lastSurface = surface;
    const inWater = surface === 'water';

    let speed = 3.05;
    if (wantsRun && this.stamina > 0.05 && !wantsCrouch) speed = 5.4;
    if (wantsCrouch) speed = 1.5;
    if (inWater) speed *= 0.55;
    if (opts.speedScale) speed *= opts.speedScale;
    if (this.health < 35) speed *= 0.86;

    const running = speed > 4 && (axis.x || axis.z);
    this.stamina = THREE.MathUtils.clamp(
      this.stamina + (running ? -dt * 0.26 : dt * 0.2), 0, 1
    );

    const fwd = this.forward().multiplyScalar(-axis.z);
    const rgt = this.right().multiplyScalar(axis.x);
    const wish = fwd.add(rgt);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);

    const accel = inWater ? 8 : 14;
    this.velocity.x += (wish.x - this.velocity.x) * Math.min(1, dt * accel);
    this.velocity.z += (wish.z - this.velocity.z) * Math.min(1, dt * accel);

    let nx = this.position.x + this.velocity.x * dt;
    let nz = this.position.z + this.velocity.z * dt;
    if (level) {
      const fixed = level.resolve(nx, nz, RADIUS);
      nx = fixed.x;
      nz = fixed.z;
    }
    this.position.x = nx;
    this.position.z = nz;

    // head bob + footsteps
    const planarSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    this.stepPhase += planarSpeed * dt * (running ? 2.1 : 1.7);
    this.bob = Math.sin(this.stepPhase * 2.4) * 0.035 * Math.min(1, planarSpeed / 3);
    this.footTimer -= dt;
    if (planarSpeed > 0.9 && this.footTimer <= 0) {
      this.footTimer = running ? 0.34 : 0.52;
      this.audio?.footstep(inWater ? 'water' : surface === 'carpet' ? 'carpet' : surface === 'tile' ? 'stone' : surface === 'concrete' ? 'stone' : 'wood', running);
    }

    // flashlight battery
    if (this.flashlightOn) {
      this.battery = Math.max(0, this.battery - dt * 0.0085);
      if (this.battery <= 0) this.flashlightOn = false;
    } else if (this.hasFlashlight) {
      this.battery = Math.min(1, this.battery + dt * 0.002);
    }
    const targetIntensity = this.flashlightOn ? 34 * (0.45 + this.battery * 0.55) : 0;
    this.flashlight.intensity += (targetIntensity - this.flashlight.intensity) * Math.min(1, dt * 10);
    this.flashlight.visible = this.flashlight.intensity > 0.05;
    if (this.battery < 0.22 && this.flashlightOn && Math.random() < dt * 3) {
      this.flashlight.intensity *= 0.25;
    }

    // sanity: darkness and proximity eat at it, light restores it
    const lit = this.flashlightOn ? 0.6 : 0;
    const ambient = opts.ambientComfort ?? 0;
    const drain = opts.sanityDrain ?? 0.012;
    this.sanity = THREE.MathUtils.clamp(
      this.sanity + (lit + ambient - drain) * dt * 0.55, 0, 1
    );

    if (this.invuln > 0) this.invuln -= dt;
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.6);

    // apply to camera
    const eyeY = this.eye + this.bob;
    this.camera.position.set(this.position.x, eyeY, this.position.z);
    const swayX = Math.sin(this.stepPhase * 1.2) * 0.012 * Math.min(1, planarSpeed / 4);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw + this.recoil.x;
    this.camera.rotation.x = this.pitch + this.recoil.y;
    this.camera.rotation.z = swayX + (1 - this.sanity) * Math.sin(performance.now() * 0.0011) * 0.03;

    // flashlight rides slightly behind the camera for a handheld feel
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(this.camera.rotation);
    this.flashlight.position.copy(this.camera.position)
      .addScaledVector(this.right(), 0.18)
      .addScaledVector(new THREE.Vector3(0, 1, 0), -0.12);
    this.flashlightTarget.position.copy(this.camera.position).addScaledVector(dir, 12);
  }

  /** Finds the closest interactable within reach and in front of the player. */
  findInteractable(candidates, maxDist = TILE * 1.35) {
    const dir = this.forward();
    let best = null;
    let bestScore = -Infinity;
    candidates.forEach((c) => {
      if (c.disabled) return;
      const to = new THREE.Vector3(c.position.x - this.position.x, 0, c.position.z - this.position.z);
      const dist = to.length();
      if (dist > (c.range || maxDist)) return;
      to.normalize();
      const facing = to.dot(dir);
      if (facing < 0.35) return;
      const score = facing * 2 - dist * 0.2;
      if (score > bestScore) { bestScore = score; best = c; }
    });
    this.interactTarget = best;
    return best;
  }
}
