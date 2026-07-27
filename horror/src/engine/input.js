// ---------------------------------------------------------------------------
// Pointer-lock FPS input.
// ---------------------------------------------------------------------------

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftEdge: false, rightEdge: false };
    this.wheel = 0;
    this.sensitivity = 1;
    this.invertY = false;
    this.locked = false;
    this.enabled = true;
    this.onLockChange = null;

    // Embedded contexts (an iframe without allow="pointer-lock") silently
    // refuse the lock. We detect that and steer with the cursor's offset from
    // the centre of the screen instead, so the game stays playable.
    this.lockUnavailable = false;
    this.edgeLook = { x: 0, y: 0, active: false };
    this._lockProbe = null;

    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      const code = e.code;
      if (!this.keys.has(code)) this.pressed.add(code);
      this.keys.add(code);
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) {
        e.preventDefault();
      }
    };
    this._onKeyUp = (e) => { this.keys.delete(e.code); };
    this._onMouseMove = (e) => {
      if (!this.enabled) return;
      // movementX/Y is reported with or without pointer lock, so raw mouse
      // motion always steers 1:1 — the only thing lock adds is an infinite
      // desk, which the edge assist below stands in for.
      this.mouse.dx += e.movementX || 0;
      this.mouse.dy += e.movementY || 0;
      if (this.locked) return;
      const rect = this.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      this.edgeLook.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.edgeLook.y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      this.edgeLook.active = true;
    };
    this._onMouseDown = (e) => {
      if (!this.enabled) return;
      if (!this.locked && !this.lockUnavailable) return;
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftEdge = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightEdge = true; }
    };
    this._onMouseUp = (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    };
    this._onWheel = (e) => {
      if (this.locked || this.lockUnavailable) this.wheel += Math.sign(e.deltaY);
    };
    this._onContext = (e) => e.preventDefault();
    this._onLock = () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.locked) {
        this.lockUnavailable = false;
        if (this._lockProbe) { clearTimeout(this._lockProbe); this._lockProbe = null; }
      } else {
        this.keys.clear();
        this.mouse.left = false;
        this.mouse.right = false;
      }
      if (this.onLockChange) this.onLockChange(this.locked);
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('wheel', this._onWheel, { passive: true });
    window.addEventListener('contextmenu', this._onContext);
    document.addEventListener('pointerlockchange', this._onLock);
  }

  requestLock() {
    if (this.locked) return;
    try {
      const result = this.canvas.requestPointerLock();
      if (result && typeof result.catch === 'function') {
        result.catch(() => { this.lockUnavailable = true; });
      }
    } catch (err) {
      this.lockUnavailable = true;
    }
    // No pointerlockchange means the request was refused outright.
    if (this._lockProbe) clearTimeout(this._lockProbe);
    this._lockProbe = setTimeout(() => {
      this._lockProbe = null;
      if (!this.locked) this.lockUnavailable = true;
    }, 900);
  }

  releaseLock() {
    if (this.locked) document.exitPointerLock();
  }

  down(code) { return this.keys.has(code); }

  /** True only on the frame the key went down. */
  tapped(code) { return this.pressed.has(code); }

  /** Arrow keys move when the mouse is captured, and steer when it isn't. */
  get arrowsSteer() {
    return !this.locked && this.lockUnavailable;
  }

  axis() {
    let x = 0;
    let z = 0;
    const arrows = !this.arrowsSteer;
    if (this.down('KeyW') || (arrows && this.down('ArrowUp'))) z -= 1;
    if (this.down('KeyS') || (arrows && this.down('ArrowDown'))) z += 1;
    if (this.down('KeyA') || (arrows && this.down('ArrowLeft'))) x -= 1;
    if (this.down('KeyD') || (arrows && this.down('ArrowRight'))) x += 1;
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    return { x, z };
  }

  /**
   * @param {number} dt seconds since the last frame — the edge assist and the
   *   keyboard turn are rates, so they must not depend on frame rate.
   */
  consumeLook(dt = 1 / 60) {
    const gain = 0.0034 * this.sensitivity;
    let dx = this.mouse.dx * gain;
    let dy = this.mouse.dy * gain;
    this.mouse.dx = 0;
    this.mouse.dy = 0;

    if (!this.locked) {
      // Push toward a screen edge to keep turning past where the desk ends.
      // Linear past a small dead zone, in radians per second.
      if (this.edgeLook.active) {
        const assist = (value, radPerSec) => {
          const dead = 0.55;
          const magnitude = Math.abs(value);
          if (magnitude < dead) return 0;
          const t = Math.min(1, (magnitude - dead) / (1 - dead));
          return Math.sign(value) * t * radPerSec * dt * this.sensitivity;
        };
        dx += assist(this.edgeLook.x, 2.2);
        dy += assist(this.edgeLook.y, 1.3);
      }
      // and the keyboard is always there as an exact fallback
      if (this.arrowsSteer) {
        const turn = 1.9 * dt * this.sensitivity;
        if (this.down('ArrowLeft')) dx -= turn;
        if (this.down('ArrowRight')) dx += turn;
        if (this.down('ArrowUp')) dy -= turn * 0.7;
        if (this.down('ArrowDown')) dy += turn * 0.7;
      }
    }

    return { dx, dy: dy * (this.invertY ? -1 : 1) };
  }

  endFrame() {
    this.pressed.clear();
    this.mouse.leftEdge = false;
    this.mouse.rightEdge = false;
    this.wheel = 0;
  }
}
