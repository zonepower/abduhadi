import * as THREE from 'three';
import { RTRenderer, QUALITY_PRESETS } from '../engine/renderer.js';
import { buildTextureLibrary } from '../engine/textures.js';
import { Input } from '../engine/input.js';
import { AudioEngine } from '../engine/audio.js';
import { VoiceDirector } from '../engine/voice.js';
import { Level, TILE } from './builder.js';
import { LEVELS } from './levels.js';
import { Player } from './player.js';
import { Weapons } from './weapons.js';
import { Enemy, Companion } from './enemies.js';
import { Boss } from './boss.js';
import { HUD } from './hud.js';
import { STORY, ENDING_LINES, LAUGH_LINES } from './story.js';

const SAVE_KEY = 'bayt.almahjur.save';
const SETTINGS_KEY = 'bayt.almahjur.settings';

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.textures = buildTextureLibrary();
    this.rt = new RTRenderer(canvas, this.textures);
    this.audio = new AudioEngine();
    this.voice = new VoiceDirector(this.audio);
    this.input = new Input(canvas);
    this.hud = new HUD();

    this.camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.06, 220);
    this.camera.rotation.order = 'YXZ';
    this.player = new Player(this.camera, this.audio);
    this.weapons = new Weapons(this.camera, this.audio);

    this.scene = null;
    this.level = null;
    this.chapterIndex = 0;
    this.chapter = null;
    this.script = null;

    this.enemies = [];
    this.companion = null;
    this.boss = null;
    this.interactables = [];
    this.triggers = [];
    this.pickups = [];
    this.managedLights = [];
    this.flags = new Set();
    this.pickedFuses = 0;
    this.usedValves = 0;

    this.state = 'menu';
    this.paused = false;
    this.clock = new THREE.Clock();
    this.elapsed = 0;
    this.shakeAmount = 0;
    this.cinematicTarget = null;
    this.cinematicTimer = 0;
    this.playerLocked = false;
    this.exitOpen = true;
    this.griefMode = false;
    this.fadeTarget = 1;
    this.heartTimer = 0;
    this.ambientTimer = 20;
    this.onStateChange = null;

    this.settings = {
      quality: 'high',
      sensitivity: 1,
      invertY: false,
      master: 0.85,
      music: 0.7,
      voice: true,
      subtitles: true,
    };
    this.loadSettings();

    this.voice.onSubtitle = (payload) => {
      this.hud.showSubtitle(this.settings.subtitles ? payload : null);
    };

    this.weapons.onHit = () => { this.shakeAmount = Math.min(1, this.shakeAmount + 0.1); };

    window.addEventListener('resize', () => this.resize());
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this.paused) this.setPaused(true);
    };
    this.resize();
  }

  // --- settings / save ------------------------------------------------------

  loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) Object.assign(this.settings, JSON.parse(raw));
    } catch (e) { /* first run */ }
    this.applySettings();
  }

  applySettings() {
    this.rt.setQuality(this.settings.quality);
    this.input.sensitivity = this.settings.sensitivity;
    this.input.invertY = this.settings.invertY;
    this.audio.setVolume('master', this.settings.master);
    this.audio.setVolume('music', this.settings.music);
    this.voice.enabled = this.settings.voice;
    this.resize();
  }

  saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch (e) { /* ignore */ }
  }

  saveProgress() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ chapter: this.chapterIndex, at: Date.now() }));
    } catch (e) { /* ignore */ }
  }

  loadProgress() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.rt.resize(w, h);
  }

  // --- chapter loading ------------------------------------------------------

  /**
   * Every chapter load bumps this. Async story beats capture it and bail out
   * if it changed, so a cutscene that was mid-`await` when the player died or
   * restarted can never touch the new chapter's actors.
   */
  get token() { return this.loadToken; }

  stale(token) { return this.loadToken !== token; }

  async loadChapter(index) {
    this.loadToken = (this.loadToken || 0) + 1;
    this.state = 'loading';
    this.voice.clear();
    this.disposeChapter();

    this.chapterIndex = Math.max(0, Math.min(LEVELS.length - 1, index));
    this.chapter = LEVELS[this.chapterIndex];
    this.script = STORY[this.chapter.id];
    this.flags = new Set();
    this.pickedFuses = 0;
    this.usedValves = 0;
    this.exitOpen = this.chapter.id === 'road';
    this.griefMode = false;
    this.playerLocked = false;
    this.cinematicTarget = null;

    const scene = new THREE.Scene();
    this.scene = scene;
    scene.add(this.camera);

    this.level = new Level(this.chapter, this.textures);
    scene.add(this.level.group);

    const amb = this.chapter.ambientLight || { color: 0x1a2030, intensity: 0.2 };
    this.ambient = new THREE.AmbientLight(amb.color, amb.intensity);
    scene.add(this.ambient);
    this.ambientBase = amb.intensity;

    if (this.chapter.moon) {
      const moon = new THREE.DirectionalLight(this.chapter.moon.color, this.chapter.moon.intensity);
      moon.position.set(...this.chapter.moon.position);
      moon.castShadow = this.rt.preset.shadows;
      const shadowSize = this.rt.preset.shadowMap;
      moon.shadow.mapSize.set(shadowSize, shadowSize);
      moon.shadow.camera.left = -60;
      moon.shadow.camera.right = 60;
      moon.shadow.camera.top = 60;
      moon.shadow.camera.bottom = -60;
      moon.shadow.camera.far = 200;
      moon.shadow.bias = -0.0004;
      moon.shadow.normalBias = 0.08;
      scene.add(moon);
      this.moon = moon;
    }

    this.player.attachTo(scene);
    // every chapter after the prologue assumes you found the torch
    if (this.chapterIndex > 0 && !this.player.hasFlashlight) {
      this.player.hasFlashlight = true;
      this.player.flashlightOn = true;
      this.player.battery = 1;
    }
    const shadowSize = this.rt.preset.shadowMap;
    this.player.flashlight.shadow.mapSize.set(shadowSize, shadowSize);
    this.player.flashlight.castShadow = this.rt.preset.shadows;
    const spawn = this.level.firstMarker('P') || new THREE.Vector3();
    this.player.spawn(spawn, this.chapter.spawnYaw ?? 0);
    this.player.reset();

    this.rt.setFlashlight(this.player.flashlight);
    this.rt.grade.fogColor.setHex(this.chapter.fog?.color ?? 0x0a0c12);
    this.rt.grade.fogDensity = this.chapter.fog?.density ?? 0.03;
    this.rt.grade.exposure = this.chapter.exposure ?? 1.15;
    this.rt.grade.sanity = 1;
    this.rt.grade.damage = 0;
    this.rt.grade.fade = 0;
    this.fadeTarget = 1;

    this.#buildActors();
    this.#buildInteractables();
    this.#collectLights();

    this.audio.resume();
    this.audio.setAmbience(this.chapter.ambience);

    this.hud.setVisible(true);
    this.hud.showBoss(null, null);
    this.hud.updateWeapon(this.weapons);
    this.saveProgress();

    this.state = 'playing';
    this.clock.getDelta();

    this.hud.showChapterCard(this.chapter.title, this.chapter.subtitle);
    if (this.script?.start) this.script.start(this.storyCtx());
  }

  #buildActors() {
    this.enemies = [];
    this.boss = null;
    this.companion = null;

    (this.chapter.enemies || []).forEach((spec) => {
      this.level.markerPositions(spec.marker).forEach((pos) => {
        const enemy = new Enemy(this.level, pos, spec.type, this.audio);
        enemy.dormant = true;
        enemy.state = 'idle';
        enemy.mesh.visible = false;
        enemy.addTo(this.scene);
        this.enemies.push(enemy);
      });
    });

    const laylaSpot = this.level.firstMarker('L');
    if (laylaSpot) {
      this.companion = new Companion(this.level, laylaSpot);
      this.companion.addTo(this.scene);
      if (this.chapter.id === 'chapel') {
        this.companion.mode = 'hide';
        this.companion.mesh.rotation.y = Math.PI;
      }
    }
  }

  #buildInteractables() {
    this.interactables = [];
    this.triggers = [];
    this.pickups = [];

    // pickups
    Object.entries(this.chapter.items || {}).forEach(([ch, item]) => {
      this.level.markerPositions(ch).forEach((pos) => {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(0.22, 0.22, 0.22),
          new THREE.MeshStandardMaterial({
            color: 0xd8c27a, emissive: 0x6a4a12, emissiveIntensity: 1.6, roughness: 0.35, metalness: 0.8,
          })
        );
        mesh.material.userData.reflectivity = 0.6;
        mesh.position.set(pos.x, 0.9, pos.z);
        mesh.castShadow = true;
        const light = new THREE.PointLight(0xffcf80, 7, 5.5, 1.6);
        mesh.add(light);
        this.scene.add(mesh);
        const entry = {
          kind: 'item', item, mesh, light, position: mesh.position,
          label: item.name, range: TILE * 1.4,
        };
        this.pickups.push(entry);
        this.interactables.push(entry);
      });
    });

    // fuse box
    this.level.markerPositions('F').forEach((pos) => {
      this.interactables.push({
        kind: 'fuseBox', position: pos.clone().setY(1.2), label: 'لوحة الكهرباء', range: TILE * 1.5,
      });
    });

    // valves
    this.level.markerPositions('V').forEach((pos) => {
      this.interactables.push({
        kind: 'valve', position: pos.clone().setY(1.1), label: 'صمام التصريف', range: TILE * 1.5, used: false,
      });
    });

    // doors
    this.level.doors.forEach((door) => {
      this.interactables.push({
        kind: 'door', door, position: this.level.toWorld(door.col, door.row), label: 'باب', range: TILE * 1.3,
      });
    });

    // scripted triggers
    ['!', '?', '*', '$', '&', '@', '^'].forEach((ch) => {
      this.level.markerPositions(ch).forEach((pos) => {
        this.triggers.push({ ch, position: pos, radius: TILE * 1.5, fired: false });
      });
    });

    // exit
    this.level.markerPositions('E').forEach((pos) => {
      this.triggers.push({ ch: 'E', position: pos, radius: TILE * 1.2, fired: false });
    });
  }

  #collectLights() {
    this.managedLights = [];
    this.scene.traverse((obj) => {
      if (obj.isPointLight) this.managedLights.push(obj);
    });
    this.managedLights.forEach((l) => { l.userData.base = l.intensity; });
  }

  disposeChapter() {
    if (!this.scene) return;
    this.boss?.clearProjectiles(this.scene);
    this.scene.remove(this.camera);
    this.level?.dispose();
    this.scene.traverse((obj) => {
      if (obj.isMesh && obj.geometry) obj.geometry.dispose?.();
    });
    this.scene = null;
    this.level = null;
    this.enemies = [];
    this.companion = null;
    this.boss = null;
  }

  // --- story context --------------------------------------------------------

  storyCtx() {
    const game = this;
    // A chapter's script keeps running while it awaits dialogue. If the player
    // dies, restarts, or moves on in the meantime, every mutator below turns
    // into a no-op instead of writing into the next chapter.
    const token = this.token;
    const live = (fn) => (...args) => (this.stale(token) ? undefined : fn(...args));
    return {
      game,
      get player() { return game.player; },
      get level() { return game.level; },
      get companion() { return game.companion; },
      get flags() { return game.flags; },
      get pickedFuses() { return game.pickedFuses; },
      get usedValves() { return game.usedValves; },
      audio: this.audio,
      voice: this.voice,
      hud: this.hud,
      say: live((lines) => this.voice.conversation(lines)) ,
      hint: live((text) => this.hud.showToast(text, 5)),
      setObjective: live((text) => this.hud.setObjective(text)),
      wait: (sec) => new Promise((r) => setTimeout(r, sec * 1000)),
      wakeEnemies: live((n) => this.wakeEnemies(n)),
      giveWeapon: live((id, ammo) => this.giveWeapon(id, ammo)),
      powerOn: live(() => this.powerOn()),
      drainWater: live(() => this.drainWater()),
      openExit: live(() => { this.exitOpen = true; }),
      sealDoors: live(() => this.level.doors.forEach((d) => this.level.setDoorOpen(d, false))),
      unsealDoors: live(() => this.level.doors.forEach((d) => this.level.setDoorOpen(d, true))),
      lockPlayer: live((v) => { this.playerLocked = v; if (!v) this.cinematicTarget = null; }),
      focusOn: live((object, seconds) => { this.cinematicTarget = object; this.cinematicTimer = seconds; }),
      shake: live((amount) => { this.shakeAmount = Math.min(2, this.shakeAmount + amount); }),
      spawnBoss: () => this.spawnBoss(),
      vanishBoss: live(() => this.vanishBoss()),
      killCompanion: live(() => this.killCompanion()),
      grief: live((on) => this.setGrief(on)),
      rage: live(() => this.rage()),
      laugh: live(() => this.laugh()),
      abduction: () => this.abduction(),
      ending: () => this.ending(),
    };
  }

  // --- story actions --------------------------------------------------------

  wakeEnemies(count) {
    const dormant = this.enemies
      .filter((e) => e.dormant && e.alive)
      .sort((a, b) => a.distanceTo(this.player.position) - b.distanceTo(this.player.position));
    dormant.slice(0, count).forEach((enemy) => {
      enemy.mesh.visible = true;
      enemy.spawnAnim = 1;
      enemy.wake();
    });
  }

  giveWeapon(id, ammo = 0) {
    this.weapons.give(id, ammo);
    this.hud.updateWeapon(this.weapons);
    this.hud.showToast(`حصلت على: ${this.weapons.def.name}`);
    this.audio.pickup(true);
  }

  powerOn() {
    this.ambient.intensity = this.ambientBase * 3.2;
    this.managedLights.forEach((l) => { l.userData.base = (l.userData.base || l.intensity) * 1.8; });
    this.rt.grade.fogDensity *= 0.7;
    this.audio.stinger('shock');
  }

  drainWater() {
    if (this.level.waterMesh) this.level.waterMesh.visible = false;
    this.level.waterTiles.forEach((key) => this.level.floorKind.set(key, 'concrete'));
    this.level.waterTiles.clear();
    this.audio.setAmbience('house');
  }

  spawnBoss() {
    const spot = this.level.firstMarker('Y') || this.player.position.clone();
    this.boss = new Boss(this.level, spot, this.audio);
    this.boss.addTo(this.scene);
    this.boss.onPhase = (phase) => {
      if (this.script?.onBossPhase) this.script.onBossPhase(phase, this.storyCtx());
    };
    this.boss.onSummon = (n) => {
      for (let i = 0; i < n; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 7 + Math.random() * 5;
        const x = this.player.position.x + Math.cos(angle) * dist;
        const z = this.player.position.z + Math.sin(angle) * dist;
        if (this.level.isSolidWorld(x, z)) continue;
        const enemy = new Enemy(this.level, new THREE.Vector3(x, 0, z), 'crawler', this.audio);
        enemy.addTo(this.scene);
        enemy.wake();
        enemy.state = 'chase';
        this.enemies.push(enemy);
        this.managedLights = this.managedLights.filter(Boolean);
      }
    };
    this.#collectLights();
    return this.boss;
  }

  vanishBoss() {
    if (!this.boss) return;
    this.boss.removeFrom(this.scene);
    this.boss.clearProjectiles(this.scene);
    this.boss = null;
    this.audio.stinger('shock');
  }

  killCompanion() {
    if (!this.companion) return;
    this.companion.alive = false;
    this.companion.mode = 'dead';
    this.companion.glow.color.setHex(0x5a1a20);
    this.companion.glow.intensity = 0.6;
    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(1.4, 20),
      new THREE.MeshStandardMaterial({ color: 0x3d0a0a, roughness: 0.2, transparent: true, opacity: 0.95 })
    );
    pool.material.userData.reflectivity = 0.85;
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(this.companion.position.x, 0.02, this.companion.position.z);
    this.scene.add(pool);
    this.flags.add('laylaDead');
  }

  setGrief(on) {
    this.griefMode = on;
    if (on) {
      this.rt.grade.sanity = 0.25;
      this.rt.grade.exposure = 0.78;
      this.rt.grade.heartbeat = 1;
    } else {
      this.rt.grade.sanity = 1;
      this.rt.grade.exposure = this.chapter.exposure ?? 1.15;
      this.rt.grade.heartbeat = 0;
    }
  }

  rage() {
    this.rt.grade.damage = 1;
    this.rt.grade.exposure = (this.chapter.exposure ?? 1.15) * 1.25;
    this.shakeAmount = 1.6;
    this.audio.stinger('rage');
  }

  laugh() {
    this.audio.laugh();
    const line = LAUGH_LINES[Math.floor(Math.random() * LAUGH_LINES.length)];
    this.hud.showSubtitle({ character: { name: 'الراعي', color: '#ff5d5d' }, text: line });
    setTimeout(() => {
      if (!this.voice.current) this.hud.showSubtitle(null);
    }, 2200);
  }

  async abduction() {
    const token = this.token;
    const companion = this.companion;
    this.playerLocked = true;
    this.audio.stinger('shock');
    this.shakeAmount = 1.2;
    if (companion) {
      this.cinematicTarget = companion.mesh;
      this.cinematicTimer = 2.5;
      this.audio.shriek();
      await new Promise((r) => setTimeout(r, 900));
      if (this.stale(token)) return;
      companion.mesh.visible = false;
      companion.mode = 'gone';
    }
    await this.voice.conversation([
      { who: 'layla', text: 'باباااا!' },
      { who: 'karim', text: 'ليلى؟! ليلى!! لا!' },
      { who: 'shepherd', text: 'قلتُ لك أن تخرج وحدك. الآن ستخرج وحدك فعلاً.' },
      { who: 'karim', text: 'سآتي إليك. أقسم بالله سآتي إليك.' },
    ]);
    if (this.stale(token)) return;
    this.playerLocked = false;
    this.cinematicTarget = null;
    this.exitOpen = true;
    this.hud.setObjective('اصعد وراءه');
    this.flags.add('abducted');
  }

  async ending() {
    const token = this.token;
    this.flags.add('ending');
    this.playerLocked = true;
    this.fadeTarget = 0;
    await new Promise((r) => setTimeout(r, 2400));
    if (this.stale(token)) return;
    this.state = 'ending';
    this.hud.setVisible(false);
    this.audio.stopAmbience(2);
    await this.voice.conversation(ENDING_LINES);
    if (this.onStateChange) this.onStateChange('ending');
  }

  // --- interaction ----------------------------------------------------------

  async handleInteract(target) {
    const ctx = this.storyCtx();
    if (target.kind === 'item') {
      this.scene.remove(target.mesh);
      target.disabled = true;
      this.pickups = this.pickups.filter((p) => p !== target);
      this.interactables = this.interactables.filter((i) => i !== target);
      this.audio.pickup(true);
      if (target.item.kind === 'fuse') this.pickedFuses += 1;
      this.hud.showToast(`حصلت على: ${target.item.name}`);
      if (this.script?.onPickup) await this.script.onPickup(target.item, ctx);
      return;
    }
    if (target.kind === 'door') {
      const door = target.door;
      if (door.sealed) { this.hud.showToast('الباب مغلق بإحكام'); return; }
      this.level.setDoorOpen(door, !door.open);
      this.audio.door(door.open);
      return;
    }
    if (target.kind === 'valve') {
      if (target.used) return;
      this.usedValves += 1;
      if (this.script?.onInteract) await this.script.onInteract(target, ctx);
      return;
    }
    if (this.script?.onInteract) await this.script.onInteract(target, ctx);
  }

  // --- loop -----------------------------------------------------------------

  setPaused(paused) {
    this.paused = paused;
    if (paused) {
      this.input.releaseLock();
      if (this.audio.ctx) this.audio.ctx.suspend?.();
    } else {
      this.input.requestLock();
      this.audio.resume();
      this.clock.getDelta();
    }
    if (this.onStateChange) this.onStateChange(paused ? 'paused' : 'playing');
  }

  update(dt) {
    const player = this.player;
    const level = this.level;
    if (!level) return;

    const canAct = !this.playerLocked && player.alive && this.state === 'playing';
    this.input.enabled = canAct || this.state === 'playing';

    // cinematic camera override
    if (this.cinematicTarget && this.cinematicTimer > 0) {
      this.cinematicTimer -= dt;
      const target = new THREE.Vector3();
      this.cinematicTarget.getWorldPosition(target);
      target.y += 1.1;
      const dx = target.x - player.position.x;
      const dz = target.z - player.position.z;
      const desiredYaw = Math.atan2(dx, dz) + Math.PI;
      const dist = Math.hypot(dx, dz);
      const desiredPitch = Math.atan2(target.y - (player.position.y + player.eye), dist);
      let diff = desiredYaw - player.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      player.yaw += diff * Math.min(1, dt * 3.2);
      player.pitch += (desiredPitch - player.pitch) * Math.min(1, dt * 3.2);
    }

    const controlInput = canAct ? this.input : { ...this.input, axis: () => ({ x: 0, z: 0 }) };
    if (canAct) {
      player.update(dt, this.input, level, {
        speedScale: this.griefMode ? 0.45 : 1,
        sanityDrain: this.chapter.id === 'road' ? 0.004 : 0.014,
      });
    } else {
      // frozen: still run the camera/flashlight side of the controller
      const frozen = {
        consumeLook: () => ({ dx: 0, dy: 0 }),
        axis: () => ({ x: 0, z: 0 }),
        down: () => false,
        tapped: () => false,
      };
      player.update(dt, frozen, level, { speedScale: 0 });
    }
    void controlInput;

    this.weapons.update(dt, this.input, {
      player, enemies: this.allHostiles(), level, canAct: canAct && !this.griefMode,
    });

    if (canAct) {
      if (this.input.tapped('KeyF')) {
        if (player.toggleFlashlight()) this.audio.lever();
        else this.audio.dryFire();
      }
      const target = player.findInteractable(this.interactables);
      if (target) {
        this.hud.showPrompt(`<b>E</b> ${target.label}`);
        if (this.input.tapped('KeyE')) this.handleInteract(target);
      } else {
        this.hud.showPrompt(null);
      }
    } else {
      this.hud.showPrompt(null);
    }

    if (this.input.tapped('Space') && this.voice.current) this.voice.skip();

    // actors
    const ctxActors = { player, listener: player, scene: this.scene };
    this.enemies.forEach((e) => e.update(dt, ctxActors));
    let threat = false;
    this.enemies.forEach((e) => {
      if (e.alive && !e.dormant && e.distanceTo(player.position) < 12) threat = true;
    });

    if (this.companion && this.companion.mode !== 'gone') {
      if (this.companion.alive === false) {
        this.companion.updateCorpse(dt);
        this.companion.syncMesh();
      } else {
        this.companion.update(dt, { player, threat });
      }
    }

    if (this.boss) {
      this.boss.update(dt, {
        player,
        scene: this.scene,
        onLaugh: () => this.laugh(),
        onShockwave: () => { this.shakeAmount = Math.min(2, this.shakeAmount + 0.8); },
      });
      this.hud.showBoss('الراعي', this.boss.alive ? this.boss.health / this.boss.maxHealth : 0);
      if (!this.boss.alive && !this.flags.has('bossDead')) {
        this.flags.add('bossDead');
        this.enemies.forEach((e) => { if (e.alive) e.die(); });
        if (this.script?.onBossDeath) this.script.onBossDeath(this.storyCtx());
      }
    }

    // triggers
    this.triggers.forEach((trigger) => {
      if (trigger.fired) return;
      const dist = Math.hypot(
        trigger.position.x - player.position.x,
        trigger.position.z - player.position.z
      );
      if (dist > trigger.radius) return;
      if (trigger.ch === 'E') {
        if (!this.exitOpen) {
          this.hud.showToast('لا يمكن المرور بعد');
          return;
        }
        trigger.fired = true;
        this.flags.add('reachedExit');
        this.advanceChapter();
        return;
      }
      trigger.fired = true;
      const handler = this.script?.triggers?.[trigger.ch];
      if (handler) handler(this.storyCtx());
    });

    // pickups bob
    this.pickups.forEach((p) => {
      p.mesh.rotation.y += dt * 1.6;
      p.mesh.position.y = 0.9 + Math.sin(this.elapsed * 2.2 + p.mesh.position.x) * 0.07;
    });

    level.update(dt, this.elapsed);
    this.audio.update(dt, threat ? 1 : 0);

    // idle chatter
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0 && !this.voice.current && this.script?.ambient?.length) {
      this.ambientTimer = 34 + Math.random() * 26;
      if (Math.random() < 0.6 && !this.playerLocked) {
        const pool = this.script.ambient;
        this.voice.say(pool[Math.floor(Math.random() * pool.length)]);
      }
    }

    // heartbeat when hurt or hunted
    const stress = Math.max(1 - player.health / player.maxHealth, threat ? 0.55 : 0, this.griefMode ? 0.8 : 0);
    this.heartTimer -= dt;
    if (stress > 0.35 && this.heartTimer <= 0) {
      this.heartTimer = 1.35 - stress * 0.6;
      this.audio.heartbeat(Math.min(1, stress));
    }

    this.#updateLightBudget();
    this.#updateGrade(dt, stress, threat);

    if (!player.alive && this.state === 'playing') this.onDeath();
  }

  allHostiles() {
    return this.boss ? [...this.enemies, this.boss] : this.enemies;
  }

  #updateLightBudget() {
    const budget = 9;
    const cam = this.camera.position;
    const scored = this.managedLights
      .filter((l) => l.parent)
      .map((l) => {
        const p = l.getWorldPosition(new THREE.Vector3());
        return { light: l, dist: p.distanceTo(cam) };
      })
      .sort((a, b) => a.dist - b.dist);
    scored.forEach((entry, i) => {
      entry.light.visible = i < budget && entry.dist < 34;
    });
    this.rt.setVolumetricLights(scored.slice(0, budget).map((s) => s.light));
  }

  #updateGrade(dt, stress, threat) {
    const grade = this.rt.grade;
    const player = this.player;
    grade.fade += (this.fadeTarget - grade.fade) * Math.min(1, dt * 1.4);
    grade.damage = Math.max(player.damageFlash, grade.damage - dt * 1.2);
    if (!this.griefMode) {
      grade.sanity += (player.sanity - grade.sanity) * Math.min(1, dt * 1.5);
      grade.heartbeat += ((stress > 0.5 ? 1 : 0) - grade.heartbeat) * Math.min(1, dt * 2);
    }
    grade.grain = 0.026 + (1 - grade.sanity) * 0.06;
    grade.aberration = 0.5 + (1 - grade.sanity) * 0.8;
    this.rt.temporalBlend = threat ? this.rt.preset.temporal * 0.85 : this.rt.preset.temporal;

    if (this.shakeAmount > 0) {
      this.shakeAmount = Math.max(0, this.shakeAmount - dt * 1.8);
      const s = this.shakeAmount * 0.035;
      this.camera.rotation.x += (Math.random() - 0.5) * s;
      this.camera.rotation.y += (Math.random() - 0.5) * s;
      this.camera.rotation.z += (Math.random() - 0.5) * s * 0.6;
    }
  }

  onDeath() {
    this.state = 'dead';
    this.voice.clear();
    this.input.releaseLock();
    this.audio.stinger('grief');
    const messages = {
      road: 'ابتلعك الطريق.',
      foyer: 'لم تخرج من البهو.',
      basement: 'ابتلعك الماء.',
      chapel: 'مات الأب قبل أن يصل.',
      revenge: 'ما زال يضحك.',
    };
    this.hud.showDeath(true, messages[this.chapter.id] || '');
    if (this.onStateChange) this.onStateChange('dead');
  }

  async retry() {
    this.hud.showDeath(false);
    await this.loadChapter(this.chapterIndex);
    this.input.requestLock();
  }

  async advanceChapter() {
    if (this.chapterIndex >= LEVELS.length - 1) return;
    if (this.transitioning) return;
    const token = this.token;
    const next = this.chapterIndex + 1;
    this.transitioning = true;
    this.fadeTarget = 0;
    this.state = 'transition';
    await new Promise((r) => setTimeout(r, 1500));
    this.transitioning = false;
    if (this.stale(token)) return;
    await this.loadChapter(next);
    this.input.requestLock();
  }

  frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.elapsed += dt;
    if (this.state === 'playing' && !this.paused) {
      this.update(dt);
    } else if (this.level) {
      this.level.update(dt * 0.2, this.elapsed);
    }
    this.hud.update(dt);
    if (this.state === 'playing' || this.state === 'dead' || this.state === 'transition') {
      this.hud.updateVitals(this.player);
      this.hud.updateWeapon(this.weapons);
    }
    if (this.scene) this.rt.render(this.scene, this.camera, this.elapsed, dt);
    this.input.endFrame();
  }

  start() {
    const loop = () => {
      requestAnimationFrame(loop);
      try {
        this.frame();
      } catch (err) {
        console.error(err);
      }
    };
    loop();
  }
}

export { QUALITY_PRESETS };
