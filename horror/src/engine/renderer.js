import * as THREE from 'three';
import {
  FULLSCREEN_VERT,
  GBUFFER_VERT,
  GBUFFER_FRAG,
  COMPOSITE_FRAG,
  TEMPORAL_FRAG,
  BRIGHT_FRAG,
  BLUR_FRAG,
  FINAL_FRAG,
} from './shaders.js';

export const QUALITY_PRESETS = {
  ultra: {
    label: 'RT فائق',
    scale: 1.0,
    ssrSteps: 48,
    aoSamples: 16,
    volSteps: 40,
    volLights: 8,
    shadowMap: 2048,
    shadows: true,
    ssr: 1.0,
    ao: 0.68,
    volumetric: 0.85,
    temporal: 0.82,
  },
  high: {
    label: 'RT عالي',
    scale: 0.9,
    ssrSteps: 32,
    aoSamples: 12,
    volSteps: 28,
    volLights: 6,
    shadowMap: 1536,
    shadows: true,
    ssr: 0.9,
    ao: 0.62,
    volumetric: 0.75,
    temporal: 0.8,
  },
  medium: {
    label: 'متوازن',
    scale: 0.8,
    ssrSteps: 20,
    aoSamples: 8,
    volSteps: 18,
    volLights: 4,
    shadowMap: 1024,
    shadows: true,
    ssr: 0.65,
    ao: 0.55,
    volumetric: 0.6,
    temporal: 0.78,
  },
  low: {
    label: 'أداء',
    scale: 0.66,
    ssrSteps: 10,
    aoSamples: 6,
    volSteps: 10,
    volLights: 3,
    shadowMap: 512,
    shadows: false,
    ssr: 0.0,
    ao: 0.42,
    volumetric: 0.35,
    temporal: 0.7,
  },
};

const quad = new THREE.PlaneGeometry(2, 2);

class Pass {
  constructor(material) {
    this.material = material;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.mesh = new THREE.Mesh(quad, material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  render(renderer, target) {
    renderer.setRenderTarget(target || null);
    renderer.render(this.scene, this.camera);
  }
}

export class RTRenderer {
  constructor(canvas, textures) {
    this.textures = textures;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.autoClear = true;

    const gl = this.renderer.getContext();
    this.hdrType = gl.getExtension('EXT_color_buffer_float')
      ? THREE.HalfFloatType
      : THREE.UnsignedByteType;

    this.gbufferCache = new Map();
    this.presetName = 'high';
    this.preset = QUALITY_PRESETS.high;
    this.size = new THREE.Vector2(1, 1);
    this.frame = 0;

    this.grade = {
      exposure: 1.15,
      bloom: 0.75,
      vignette: 0.85,
      grain: 0.075,
      aberration: 0.6,
      sanity: 1,
      damage: 0,
      fade: 1,
      heartbeat: 0,
      focus: 0,
      aperture: 0.6,
      desaturate: 0,
      fogColor: new THREE.Color(0x0a0c12),
      fogDensity: 0.028,
    };

    this.volLights = [];
    this.flashlight = null;

    // Narrower lens for held weapons: less edge distortion than the 74° world
    // camera, and a tiny depth range so nothing can intersect the level.
    this.viewModelCamera = new THREE.PerspectiveCamera(62, 1, 0.008, 6);
    this.viewModelCamera.layers.set(1);

    this.#buildTargets(window.innerWidth, window.innerHeight);
    this.#buildPasses();
  }

  // -------------------------------------------------------------------------

  #buildTargets(width, height) {
    const scale = this.preset.scale;
    const w = Math.max(2, Math.floor(width * scale));
    const h = Math.max(2, Math.floor(height * scale));
    this.size.set(w, h);
    this.displaySize = { width, height };

    this.#dispose();

    const depthTexture = new THREE.DepthTexture(w, h);
    depthTexture.type = THREE.UnsignedIntType;
    depthTexture.format = THREE.DepthFormat;
    depthTexture.minFilter = THREE.NearestFilter;
    depthTexture.magFilter = THREE.NearestFilter;

    const common = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: this.hdrType,
      depthBuffer: true,
      stencilBuffer: false,
    };

    this.sceneRT = new THREE.WebGLRenderTarget(w, h, { ...common, depthTexture });
    this.gbufferRT = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.UnsignedByteType,
    });
    this.compositeRT = new THREE.WebGLRenderTarget(w, h, common);
    this.historyRT = [
      new THREE.WebGLRenderTarget(w, h, common),
      new THREE.WebGLRenderTarget(w, h, common),
    ];

    // half-res pair used for cutscene depth of field
    this.dofRT = [
      new THREE.WebGLRenderTarget(Math.max(2, w >> 1), Math.max(2, h >> 1), common),
      new THREE.WebGLRenderTarget(Math.max(2, w >> 1), Math.max(2, h >> 1), common),
    ];

    this.bloomRT = [];
    for (let i = 0; i < 3; i += 1) {
      const div = 2 ** (i + 1);
      const bw = Math.max(2, Math.floor(w / div));
      const bh = Math.max(2, Math.floor(h / div));
      this.bloomRT.push({
        a: new THREE.WebGLRenderTarget(bw, bh, common),
        b: new THREE.WebGLRenderTarget(bw, bh, common),
      });
    }

    this.renderer.setSize(width, height, false);
  }

  #dispose() {
    const kill = (rt) => rt && rt.dispose();
    kill(this.sceneRT);
    kill(this.gbufferRT);
    kill(this.compositeRT);
    (this.historyRT || []).forEach(kill);
    (this.dofRT || []).forEach(kill);
    (this.bloomRT || []).forEach((pair) => { kill(pair.a); kill(pair.b); });
  }

  #buildPasses() {
    const p = this.preset;
    const maxLights = p.volLights;

    this.composite = new Pass(new THREE.ShaderMaterial({
      defines: {
        SSR_STEPS: String(p.ssrSteps),
        AO_SAMPLES: String(p.aoSamples),
        VOL_STEPS: String(p.volSteps),
        MAX_VOL_LIGHTS: String(maxLights),
      },
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        tNormal: { value: null },
        tNoise: { value: this.textures.noise },
        tDust: { value: this.textures.dust },
        uProj: { value: new THREE.Matrix4() },
        uInvProj: { value: new THREE.Matrix4() },
        uResolution: { value: new THREE.Vector2() },
        uNear: { value: 0.1 },
        uFar: { value: 200 },
        uTime: { value: 0 },
        uSSRIntensity: { value: p.ssr },
        uSSRMaxDistance: { value: 16 },
        uSSRThickness: { value: 0.5 },
        uAOIntensity: { value: p.ao },
        uAORadius: { value: 0.62 },
        uFogDensity: { value: 0.028 },
        uFogColor: { value: new THREE.Color(0x0a0c12) },
        uVolumetricStrength: { value: p.volumetric },
        uFlashPos: { value: new THREE.Vector3() },
        uFlashDir: { value: new THREE.Vector3(0, 0, -1) },
        uFlashCosInner: { value: Math.cos(0.28) },
        uFlashCosOuter: { value: Math.cos(0.46) },
        uFlashRange: { value: 22 },
        uFlashColor: { value: new THREE.Color(0xfff0d0) },
        uFlashIntensity: { value: 0 },
        uLightPos: { value: Array.from({ length: maxLights }, () => new THREE.Vector4()) },
        uLightColor: { value: Array.from({ length: maxLights }, () => new THREE.Vector4()) },
        uLightCount: { value: 0 },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false,
      depthWrite: false,
    }));

    this.temporal = new Pass(new THREE.ShaderMaterial({
      uniforms: {
        tCurrent: { value: null },
        tHistory: { value: null },
        uBlend: { value: p.temporal },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: TEMPORAL_FRAG,
      depthTest: false,
      depthWrite: false,
    }));

    this.bright = new Pass(new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uThreshold: { value: 0.72 } },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: BRIGHT_FRAG,
      depthTest: false,
      depthWrite: false,
    }));

    this.blur = new Pass(new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uDirection: { value: new THREE.Vector2() } },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: BLUR_FRAG,
      depthTest: false,
      depthWrite: false,
    }));

    this.final = new Pass(new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tBloomA: { value: null },
        tBloomB: { value: null },
        tBloomC: { value: null },
        tNoise: { value: this.textures.noise },
        tBlur: { value: null },
        tDepth: { value: null },
        uFocus: { value: 0 },
        uAperture: { value: 0.6 },
        uNear: { value: 0.1 },
        uFar: { value: 220 },
        uDesaturate: { value: 0 },
        uTime: { value: 0 },
        uBloomStrength: { value: 0.75 },
        uExposure: { value: 1.15 },
        uVignette: { value: 0.85 },
        uGrain: { value: 0.075 },
        uAberration: { value: 0.6 },
        uSanity: { value: 1 },
        uDamage: { value: 0 },
        uFade: { value: 1 },
        uHeartbeat: { value: 0 },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: FINAL_FRAG,
      depthTest: false,
      depthWrite: false,
    }));
  }

  /**
   * Bakes a small irradiance/specular probe from a sky gradient.
   *
   * Without this every `metalness: 1` surface renders black: a metal has no
   * diffuse term, so with nothing to reflect there is nothing to see. One
   * cheap probe per chapter gives every gun, hinge and hook something to
   * catch, and gives the whole level a little indirect bounce.
   */
  buildEnvironment(topColor, bottomColor, horizonColor) {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color(topColor) },
        uBottom: { value: new THREE.Color(bottomColor) },
        uHorizon: { value: new THREE.Color(horizonColor ?? topColor) },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uTop; uniform vec3 uBottom; uniform vec3 uHorizon;
        varying vec3 vDir;
        void main() {
          float h = vDir.y * 0.5 + 0.5;
          vec3 c = mix(uBottom, uHorizon, smoothstep(0.0, 0.5, h));
          c = mix(c, uTop, smoothstep(0.45, 1.0, h));
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 16, 12), material);
    envScene.add(mesh);
    const target = pmrem.fromScene(envScene, 0.06);
    pmrem.dispose();
    mesh.geometry.dispose();
    material.dispose();
    if (this.envRT) this.envRT.dispose();
    this.envRT = target;
    return target.texture;
  }

  setQuality(name) {
    if (!QUALITY_PRESETS[name]) return;
    this.presetName = name;
    this.preset = QUALITY_PRESETS[name];
    this.renderer.shadowMap.enabled = this.preset.shadows;
    this.#buildTargets(this.displaySize.width, this.displaySize.height);
    this.#buildPasses();
  }

  resize(width, height) {
    this.#buildTargets(width, height);
  }

  /** Registers point lights that should contribute to the volumetric march. */
  setVolumetricLights(lights) {
    this.volLights = lights;
  }

  setFlashlight(spot) {
    this.flashlight = spot;
  }

  // -------------------------------------------------------------------------

  #gbufferMaterial(material) {
    let gmat = this.gbufferCache.get(material.uuid);
    if (!gmat) {
      const reflectivity = material.userData?.reflectivity ?? 0;
      gmat = new THREE.ShaderMaterial({
        uniforms: { uReflectivity: { value: reflectivity } },
        vertexShader: GBUFFER_VERT,
        fragmentShader: GBUFFER_FRAG,
        side: material.side,
      });
      this.gbufferCache.set(material.uuid, gmat);
    }
    return gmat;
  }

  #renderGBuffer(scene, camera) {
    const swapped = [];
    const hidden = [];
    scene.traverse((obj) => {
      if (!obj.isMesh || !obj.visible) return;
      if (obj.userData.noGBuffer || obj.material.transparent) {
        hidden.push(obj);
        obj.visible = false;
        return;
      }
      swapped.push([obj, obj.material]);
      obj.material = this.#gbufferMaterial(obj.material);
    });

    const prevBg = scene.background;
    scene.background = null;
    this.renderer.setRenderTarget(this.gbufferRT);
    this.renderer.setClearColor(0x808080, 1);
    this.renderer.clear();
    this.renderer.render(scene, camera);
    scene.background = prevBg;

    swapped.forEach(([obj, mat]) => { obj.material = mat; });
    hidden.forEach((obj) => { obj.visible = true; });
  }

  render(scene, camera, elapsed, dt) {
    this.frame += 1;
    const { width, height } = this.size;

    // 1. beauty pass ---------------------------------------------------------
    this.renderer.setRenderTarget(this.sceneRT);
    this.renderer.setClearColor(this.grade.fogColor, 1);
    this.renderer.clear();
    this.renderer.render(scene, camera);

    // 1b. view-model pass: same eye, different lens, fresh depth
    const vm = this.viewModelCamera;
    vm.position.copy(camera.position);
    vm.quaternion.copy(camera.quaternion);
    if (vm.aspect !== camera.aspect) {
      vm.aspect = camera.aspect;
      vm.updateProjectionMatrix();
    }
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(scene, vm);
    this.renderer.autoClear = true;

    // 2. G-buffer (view normals + reflectivity mask) --------------------------
    this.#renderGBuffer(scene, camera);

    // 3. ray marched composite ----------------------------------------------
    const cu = this.composite.material.uniforms;
    cu.tColor.value = this.sceneRT.texture;
    cu.tDepth.value = this.sceneRT.depthTexture;
    cu.tNormal.value = this.gbufferRT.texture;
    cu.uProj.value.copy(camera.projectionMatrix);
    cu.uInvProj.value.copy(camera.projectionMatrixInverse);
    cu.uResolution.value.set(width, height);
    cu.uNear.value = camera.near;
    cu.uFar.value = camera.far;
    cu.uTime.value = elapsed;
    cu.uFogDensity.value = this.grade.fogDensity;
    cu.uFogColor.value.copy(this.grade.fogColor);

    if (this.flashlight && this.flashlight.visible && this.flashlight.intensity > 0) {
      const pos = this.flashlight.getWorldPosition(new THREE.Vector3());
      const target = this.flashlight.target.getWorldPosition(new THREE.Vector3());
      pos.applyMatrix4(camera.matrixWorldInverse);
      target.applyMatrix4(camera.matrixWorldInverse);
      cu.uFlashPos.value.copy(pos);
      cu.uFlashDir.value.copy(target.sub(pos).normalize());
      cu.uFlashCosInner.value = Math.cos(this.flashlight.angle * (1 - this.flashlight.penumbra * 0.85));
      cu.uFlashCosOuter.value = Math.cos(this.flashlight.angle);
      cu.uFlashRange.value = this.flashlight.distance || 22;
      cu.uFlashColor.value.copy(this.flashlight.color);
      // the volumetric march integrates over metres, so this is a density, not a brightness
      cu.uFlashIntensity.value = Math.min(this.flashlight.intensity * 0.0011, 0.022);
    } else {
      cu.uFlashIntensity.value = 0;
    }

    const maxLights = this.preset.volLights;
    let count = 0;
    const tmp = new THREE.Vector3();
    for (let i = 0; i < this.volLights.length && count < maxLights; i += 1) {
      const light = this.volLights[i];
      if (!light.visible || light.intensity <= 0.001) continue;
      light.getWorldPosition(tmp);
      // only feed the shader lights that are actually near the camera
      if (tmp.distanceTo(camera.position) > (light.distance || 12) + 26) continue;
      tmp.applyMatrix4(camera.matrixWorldInverse);
      cu.uLightPos.value[count].set(tmp.x, tmp.y, tmp.z, light.distance || 12);
      cu.uLightColor.value[count].set(
        light.color.r, light.color.g, light.color.b,
        Math.min(light.intensity * 0.0022, 0.028)
      );
      count += 1;
    }
    cu.uLightCount.value = count;
    this.composite.render(this.renderer, this.compositeRT);

    // 4. temporal denoise ----------------------------------------------------
    const readIdx = this.frame % 2;
    const writeIdx = 1 - readIdx;
    const tu = this.temporal.material.uniforms;
    tu.tCurrent.value = this.compositeRT.texture;
    tu.tHistory.value = this.historyRT[readIdx].texture;
    tu.uBlend.value = this.temporalBlend ?? this.preset.temporal;
    this.temporal.render(this.renderer, this.historyRT[writeIdx]);
    const resolved = this.historyRT[writeIdx].texture;

    // 5. bloom chain ---------------------------------------------------------
    this.bright.material.uniforms.tDiffuse.value = resolved;
    this.bright.render(this.renderer, this.bloomRT[0].a);
    let source = this.bloomRT[0].a;
    for (let i = 0; i < this.bloomRT.length; i += 1) {
      const level = this.bloomRT[i];
      if (i > 0) {
        this.blur.material.uniforms.tDiffuse.value = source.texture;
        this.blur.material.uniforms.uDirection.value.set(1 / level.a.width, 0);
        this.blur.render(this.renderer, level.a);
      }
      this.blur.material.uniforms.tDiffuse.value = level.a.texture;
      this.blur.material.uniforms.uDirection.value.set(1 / level.a.width, 0);
      this.blur.render(this.renderer, level.b);
      this.blur.material.uniforms.tDiffuse.value = level.b.texture;
      this.blur.material.uniforms.uDirection.value.set(0, 1 / level.a.height);
      this.blur.render(this.renderer, level.a);
      source = level.a;
    }

    // 6. depth of field (cutscenes only) --------------------------------------
    if (this.grade.focus > 0.001) {
      this.blur.material.uniforms.tDiffuse.value = resolved;
      this.blur.material.uniforms.uDirection.value.set(1.6 / this.dofRT[0].width, 0);
      this.blur.render(this.renderer, this.dofRT[0]);
      this.blur.material.uniforms.tDiffuse.value = this.dofRT[0].texture;
      this.blur.material.uniforms.uDirection.value.set(0, 1.6 / this.dofRT[0].height);
      this.blur.render(this.renderer, this.dofRT[1]);
    }

    // 7. grade + output ------------------------------------------------------
    const fu = this.final.material.uniforms;
    fu.tDiffuse.value = resolved;
    fu.tBlur.value = this.dofRT[1].texture;
    fu.tDepth.value = this.sceneRT.depthTexture;
    fu.uFocus.value = this.grade.focus;
    fu.uAperture.value = this.grade.aperture;
    fu.uNear.value = camera.near;
    fu.uFar.value = camera.far;
    fu.uDesaturate.value = this.grade.desaturate;
    fu.tBloomA.value = this.bloomRT[0].a.texture;
    fu.tBloomB.value = this.bloomRT[1].a.texture;
    fu.tBloomC.value = this.bloomRT[2].a.texture;
    fu.uTime.value = elapsed;
    fu.uBloomStrength.value = this.grade.bloom;
    fu.uExposure.value = this.grade.exposure;
    fu.uVignette.value = this.grade.vignette;
    fu.uGrain.value = this.grade.grain;
    fu.uAberration.value = this.grade.aberration;
    fu.uSanity.value = this.grade.sanity;
    fu.uDamage.value = this.grade.damage;
    fu.uFade.value = this.grade.fade;
    fu.uHeartbeat.value = this.grade.heartbeat;
    this.final.render(this.renderer, null);

    void dt;
  }
}
