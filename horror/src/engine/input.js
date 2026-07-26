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
      if (this.locked) {
        if (!this.enabled) return;
        this.mouse.dx += e.movementX || 0;
        this.mouse.dy += e.movementY || 0;
        return;
      }
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

  axis() {
    let x = 0;
    let z = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) z -= 1;
    if (this.down('KeyS') || this.down('ArrowDown')) z += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    return { x, z };
  }

  consumeLook() {
    if (!this.locked && this.lockUnavailable && this.edgeLook.active) {
      const rate = (value, scale) => {
        const dead = 0.16;
        const magnitude = Math.abs(value);
        if (magnitude < dead) return 0;
        const t = (magnitude - dead) / (1 - dead);
        return Math.sign(value) * t * t * scale * this.sensitivity;
      };
      return {
        dx: rate(this.edgeLook.x, 0.055),
        dy: rate(this.edgeLook.y, 0.032) * (this.invertY ? -1 : 1),
      };
    }
    const dx = this.mouse.dx * 0.0022 * this.sensitivity;
    const dy = this.mouse.dy * 0.0022 * this.sensitivity * (this.invertY ? -1 : 1);
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    return { dx, dy };
  }

  endFrame() {
    this.pressed.clear();
    this.mouse.leftEdge = false;
    this.mouse.rightEdge = false;
    this.wheel = 0;
  }
}
