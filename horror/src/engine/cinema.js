import * as THREE from 'three';

// ---------------------------------------------------------------------------
// المخرج السينمائي — a shot-based camera director.
//
// A cutscene is authored the way previz is: you set a shot, play dialogue over
// it, then cut to the next shot. Each shot animates its move over `dur` and
// then holds, so timing never has to be guessed against the voice track.
// ---------------------------------------------------------------------------

const EASES = {
  linear: (t) => t,
  in: (t) => t * t,
  out: (t) => 1 - (1 - t) ** 3,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2),
  // a slow creep that never quite settles — good for dread
  creep: (t) => 1 - (1 - t) ** 1.35,
};

/** Cheap smooth noise for handheld camera drift. */
function drift(t, seed) {
  return Math.sin(t * 1.7 + seed) * 0.55
       + Math.sin(t * 0.63 + seed * 2.3) * 0.32
       + Math.sin(t * 3.1 + seed * 4.1) * 0.13;
}

export class Cinema {
  constructor(camera) {
    this.camera = camera;
    this.active = false;
    this.shotState = null;
    this.timeScale = 1;
    this.letterbox = 0;        // 0..1, drives the DOM bars
    this.letterboxTarget = 0;
    this.time = 0;
    this.baseFov = camera.fov;
    this.focus = 0;            // 0 disables depth of field
    this.aperture = 0;
    this._tmpA = new THREE.Vector3();
    this._tmpB = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this.onLetterbox = null;
  }

  /** Resolves [x,y,z] | Object3D | {anchor, offset} into a world position. */
  #resolve(spec, out) {
    if (!spec) return out.set(0, 0, 0);
    if (Array.isArray(spec)) return out.set(spec[0], spec[1], spec[2]);
    if (spec.isObject3D) return spec.getWorldPosition(out);
    if (spec.anchor) {
      spec.anchor.getWorldPosition(out);
      const o = spec.offset || [0, 0, 0];
      return out.add(this._tmpB.set(o[0], o[1], o[2]));
    }
    return out.set(0, 0, 0);
  }

  begin() {
    this.active = true;
    this.letterboxTarget = 1;
    this.time = 0;
  }

  /**
   * Sets the current shot. Movement plays over `dur`, then the shot holds
   * until it is replaced. Returns immediately — dialogue runs over the top.
   */
  shot(spec) {
    if (!this.active) this.begin();
    const state = {
      spec,
      t: 0,
      dur: spec.dur ?? 3,
      ease: EASES[spec.ease || 'inOut'] || EASES.inOut,
      from: new THREE.Vector3(),
      to: new THREE.Vector3(),
      lookFrom: new THREE.Vector3(),
      lookTo: new THREE.Vector3(),
      blend: spec.blend ?? 0,
      seed: Math.random() * 100,
      prevPos: this.camera.position.clone(),
      prevQuat: this.camera.quaternion.clone(),
    };
    this.#resolve(spec.pos, state.from);
    this.#resolve(spec.posTo || spec.pos, state.to);
    this.#resolve(spec.look, state.lookFrom);
    this.#resolve(spec.lookTo || spec.look, state.lookTo);
    this.shotState = state;
    this.focus = spec.focus ?? 0;
    this.aperture = spec.aperture ?? (spec.focus ? 0.6 : 0);
    this.timeScale = spec.slowmo ?? 1;
    if (spec.onEnter) spec.onEnter();
    return state;
  }

  /** Ends the cutscene and hands the camera back to the player controller. */
  end() {
    this.active = false;
    this.shotState = null;
    this.letterboxTarget = 0;
    this.timeScale = 1;
    this.focus = 0;
    this.aperture = 0;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
  }

  update(dt) {
    // letterbox animates even after the scene ends, so the bars slide away
    this.letterbox += (this.letterboxTarget - this.letterbox) * Math.min(1, dt * 3.4);
    if (this.onLetterbox) this.onLetterbox(this.letterbox);
    if (!this.active || !this.shotState) return;

    const state = this.shotState;
    const spec = state.spec;
    state.t += dt;
    this.time += dt;

    // live anchors let a shot track a moving actor
    if (spec.follow) {
      this.#resolve(spec.pos, state.from);
      this.#resolve(spec.posTo || spec.pos, state.to);
      this.#resolve(spec.look, state.lookFrom);
      this.#resolve(spec.lookTo || spec.look, state.lookTo);
    }

    const k = state.dur > 0 ? Math.min(1, state.t / state.dur) : 1;
    const e = state.ease(k);

    const pos = this._tmpA.copy(state.from).lerp(state.to, e);
    if (spec.orbit) {
      const angle = spec.orbit.from + (spec.orbit.to - spec.orbit.from) * e;
      const radius = spec.orbit.radius ?? 4;
      const centre = this._look.copy(state.lookFrom);
      pos.set(
        centre.x + Math.sin(angle) * radius,
        pos.y,
        centre.z + Math.cos(angle) * radius
      );
    }

    const handheld = spec.handheld ?? 0.25;
    if (handheld > 0) {
      const t = this.time;
      pos.x += drift(t, state.seed) * 0.03 * handheld;
      pos.y += drift(t * 1.3, state.seed + 7) * 0.024 * handheld;
      pos.z += drift(t * 0.8, state.seed + 13) * 0.03 * handheld;
    }

    const look = this._look.copy(state.lookFrom).lerp(state.lookTo, e);
    if (handheld > 0) {
      look.x += drift(this.time * 0.7, state.seed + 21) * 0.05 * handheld;
      look.y += drift(this.time * 0.9, state.seed + 31) * 0.04 * handheld;
    }

    // blend in from wherever the camera was, so a soft cut is possible
    if (state.blend > 0 && state.t < state.blend) {
      const b = state.t / state.blend;
      pos.lerpVectors(state.prevPos, pos, EASES.inOut(b));
    }

    this.camera.position.copy(pos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(look);
    if (spec.roll) {
      const roll = spec.roll * (spec.rollTo !== undefined ? (1 - e) + (spec.rollTo / spec.roll) * e : 1);
      this.camera.rotateZ(roll);
    }

    const fov = (spec.fov ?? 42) + ((spec.fovTo ?? spec.fov ?? 42) - (spec.fov ?? 42)) * e;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    if (spec.focusTo !== undefined) {
      this.focus = (spec.focus ?? 3) + (spec.focusTo - (spec.focus ?? 3)) * e;
    }
  }
}
