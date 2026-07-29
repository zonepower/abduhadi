import * as THREE from 'three';

// ---------------------------------------------------------------------------
// البيئة — weather and air.
//
// Everything here follows the camera so a few thousand particles cover a whole
// level. Rain and dust are Lines/Points, which the G-buffer pass skips, so they
// cost almost nothing in the ray-marching stages.
// ---------------------------------------------------------------------------

const RAIN_RADIUS = 24;
const DUST_RADIUS = 12;

function skyDome(topColor, bottomColor, moonDir) {
  const geometry = new THREE.SphereGeometry(300, 24, 16);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(topColor) },
      uBottom: { value: new THREE.Color(bottomColor) },
      uMoon: { value: new THREE.Vector3(...moonDir).normalize() },
      uFlash: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uTop;
      uniform vec3 uBottom;
      uniform vec3 uMoon;
      uniform float uFlash;
      varying vec3 vDir;

      // cheap hashed value noise for the cloud band
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }

      void main() {
        float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(uBottom, uTop, pow(h, 0.7));
        float clouds = noise(vDir.xz * 3.0 + vDir.y) * 0.5 + noise(vDir.xz * 7.0) * 0.25;
        col = mix(col, col * 0.55, clouds * (1.0 - h) * 0.9);
        float moon = pow(max(dot(normalize(vDir), uMoon), 0.0), 220.0);
        float halo = pow(max(dot(normalize(vDir), uMoon), 0.0), 6.0);
        col += vec3(0.9, 0.95, 1.0) * moon * 2.2;
        col += vec3(0.28, 0.36, 0.55) * halo * 0.32 * (1.0 - clouds * 0.6);
        col += vec3(0.5, 0.58, 0.8) * uFlash;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.userData.noGBuffer = true;
  return mesh;
}

export class Environment {
  constructor(scene, config, audio) {
    this.scene = scene;
    this.config = config || {};
    this.audio = audio;
    this.nodes = [];
    this.rain = null;
    this.dust = null;
    this.embers = null;
    this.sky = null;
    this.lightning = null;
    this.flash = 0;
    this.strikeTimer = 6 + Math.random() * 8;
    this.thunderQueue = [];
    this.wind = new THREE.Vector2(0.6, 0.2);

    if (this.config.sky) this.#buildSky();
    if (this.config.rain) this.#buildRain(this.config.rain);
    if (this.config.dust) this.#buildDust(this.config.dust);
    if (this.config.embers) this.#buildEmbers(this.config.embers);
    if (this.config.lightning) this.#buildLightning();
  }

  #add(node) {
    this.scene.add(node);
    this.nodes.push(node);
    return node;
  }

  #buildSky() {
    this.sky = this.#add(skyDome(
      this.config.skyTop ?? 0x0a1526,
      this.config.skyBottom ?? 0x05070d,
      this.config.moonDir ?? [-0.5, 0.75, 0.4]
    ));
  }

  #buildRain(density) {
    const count = Math.floor(2600 * density);
    const positions = new Float32Array(count * 6);
    this.rainData = new Float32Array(count * 4); // x, y, z, speed
    for (let i = 0; i < count; i += 1) {
      const x = (Math.random() - 0.5) * RAIN_RADIUS * 2;
      const y = Math.random() * 26;
      const z = (Math.random() - 0.5) * RAIN_RADIUS * 2;
      const speed = 22 + Math.random() * 16;
      this.rainData.set([x, y, z, speed], i * 4);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      color: 0xa8c4e8, transparent: true, opacity: 0.34, depthWrite: false,
    });
    this.rain = new THREE.LineSegments(geometry, material);
    this.rain.frustumCulled = false;
    this.rain.userData.noGBuffer = true;
    this.#add(this.rain);
  }

  #buildDust(density) {
    const count = Math.floor(700 * density);
    const positions = new Float32Array(count * 3);
    this.dustData = new Float32Array(count * 4); // x, y, z, phase
    for (let i = 0; i < count; i += 1) {
      const x = (Math.random() - 0.5) * DUST_RADIUS * 2;
      const y = Math.random() * 4.2;
      const z = (Math.random() - 0.5) * DUST_RADIUS * 2;
      this.dustData.set([x, y, z, Math.random() * 100], i * 4);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xbfb49e,
      size: 0.013,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.30,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.dust = new THREE.Points(geometry, material);
    this.dust.frustumCulled = false;
    this.dust.userData.noGBuffer = true;
    this.#add(this.dust);
  }

  #buildEmbers(density) {
    const count = Math.floor(420 * density);
    const positions = new Float32Array(count * 3);
    this.emberData = new Float32Array(count * 4); // x, y, z, rise
    for (let i = 0; i < count; i += 1) {
      this.emberData.set([
        (Math.random() - 0.5) * 36,
        Math.random() * 10,
        (Math.random() - 0.5) * 36,
        0.6 + Math.random() * 1.6,
      ], i * 4);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xff7a2a,
      size: 0.075,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.embers = new THREE.Points(geometry, material);
    this.embers.frustumCulled = false;
    this.embers.userData.noGBuffer = true;
    this.#add(this.embers);
  }

  #buildLightning() {
    this.lightning = new THREE.DirectionalLight(0xcfe0ff, 0);
    this.lightning.position.set(30, 50, -20);
    this.#add(this.lightning);
  }

  /** Fires a multi-flicker strike and schedules the thunder by distance. */
  strike() {
    const distance = 0.25 + Math.random() * 2.4; // km-ish
    this.flashSequence = [
      { at: 0, level: 1 },
      { at: 0.07, level: 0.2 },
      { at: 0.12, level: 0.85 },
      { at: 0.22, level: 0.1 },
      { at: 0.3, level: 0.45 },
      { at: 0.5, level: 0 },
    ];
    this.flashTime = 0;
    this.thunderQueue.push(distance * 1.6);
  }

  update(dt, time, camera) {
    const cam = camera.position;

    if (this.rain) {
      const array = this.rain.geometry.attributes.position.array;
      const data = this.rainData;
      const count = data.length / 4;
      const gust = 1 + Math.sin(time * 0.31) * 0.5;
      for (let i = 0; i < count; i += 1) {
        const o = i * 4;
        data[o + 1] -= data[o + 3] * dt;
        data[o] += this.wind.x * gust * dt * 3;
        data[o + 2] += this.wind.y * gust * dt * 3;
        if (data[o + 1] < -6) {
          data[o] = (Math.random() - 0.5) * RAIN_RADIUS * 2;
          data[o + 1] = 20 + Math.random() * 8;
          data[o + 2] = (Math.random() - 0.5) * RAIN_RADIUS * 2;
        }
        // keep the volume centred on the player without moving each drop twice
        const x = cam.x + ((data[o] % (RAIN_RADIUS * 2)) + RAIN_RADIUS * 2) % (RAIN_RADIUS * 2) - RAIN_RADIUS;
        const z = cam.z + ((data[o + 2] % (RAIN_RADIUS * 2)) + RAIN_RADIUS * 2) % (RAIN_RADIUS * 2) - RAIN_RADIUS;
        const y = data[o + 1];
        const streak = data[o + 3] * 0.016;
        const v = i * 6;
        array[v] = x; array[v + 1] = y; array[v + 2] = z;
        array[v + 3] = x - this.wind.x * gust * 0.12;
        array[v + 4] = y + streak;
        array[v + 5] = z - this.wind.y * gust * 0.12;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }

    if (this.dust) {
      const array = this.dust.geometry.attributes.position.array;
      const data = this.dustData;
      const count = data.length / 4;
      for (let i = 0; i < count; i += 1) {
        const o = i * 4;
        const phase = data[o + 3];
        data[o] += Math.sin(time * 0.25 + phase) * dt * 0.14;
        data[o + 1] += Math.sin(time * 0.17 + phase * 1.7) * dt * 0.06;
        data[o + 2] += Math.cos(time * 0.21 + phase * 0.7) * dt * 0.14;
        const wrap = (v, r) => ((v % (r * 2)) + r * 2) % (r * 2) - r;
        array[i * 3] = cam.x + wrap(data[o], DUST_RADIUS);
        array[i * 3 + 1] = 0.2 + ((data[o + 1] % 4.2) + 4.2) % 4.2;
        array[i * 3 + 2] = cam.z + wrap(data[o + 2], DUST_RADIUS);
      }
      this.dust.geometry.attributes.position.needsUpdate = true;
    }

    if (this.embers) {
      const array = this.embers.geometry.attributes.position.array;
      const data = this.emberData;
      const count = data.length / 4;
      for (let i = 0; i < count; i += 1) {
        const o = i * 4;
        data[o + 1] += data[o + 3] * dt;
        data[o] += Math.sin(time * 1.3 + i) * dt * 0.3;
        if (data[o + 1] > 12) {
          data[o + 1] = -0.5;
          data[o] = (Math.random() - 0.5) * 36;
          data[o + 2] = (Math.random() - 0.5) * 36;
        }
        array[i * 3] = data[o];
        array[i * 3 + 1] = data[o + 1];
        array[i * 3 + 2] = data[o + 2];
      }
      this.embers.geometry.attributes.position.needsUpdate = true;
    }

    // --- lightning ---
    if (this.lightning) {
      this.strikeTimer -= dt;
      if (this.strikeTimer <= 0) {
        this.strikeTimer = 9 + Math.random() * 16;
        this.strike();
      }
      if (this.flashSequence) {
        this.flashTime += dt;
        let level = 0;
        for (let i = 0; i < this.flashSequence.length; i += 1) {
          if (this.flashTime >= this.flashSequence[i].at) level = this.flashSequence[i].level;
        }
        this.flash += (level - this.flash) * Math.min(1, dt * 26);
        if (this.flashTime > 0.65) { this.flashSequence = null; this.flash = 0; }
      } else {
        this.flash *= Math.max(0, 1 - dt * 6);
      }
      this.lightning.intensity = this.flash * 9;
      if (this.sky) this.sky.material.uniforms.uFlash.value = this.flash * 0.7;
    }

    for (let i = this.thunderQueue.length - 1; i >= 0; i -= 1) {
      this.thunderQueue[i] -= dt;
      if (this.thunderQueue[i] <= 0) {
        this.thunderQueue.splice(i, 1);
        this.audio?.thunder();
      }
    }

    if (this.sky) this.sky.position.copy(cam);
  }

  dispose() {
    this.nodes.forEach((node) => {
      this.scene.remove(node);
      node.geometry?.dispose?.();
      if (node.material?.dispose) node.material.dispose();
    });
    this.nodes.length = 0;
  }
}
