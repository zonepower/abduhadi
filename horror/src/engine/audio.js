// ---------------------------------------------------------------------------
// Fully synthesised audio. No sample files: every gunshot, footstep, creak and
// drone is built from oscillators and filtered noise at runtime.
// ---------------------------------------------------------------------------

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.volumes = { master: 0.85, sfx: 1, music: 0.7 };
    this.ambienceNodes = [];
    this.ambienceName = null;
    this.creakTimer = 0;
  }

  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();

    this.master = this.ctx.createGain();
    this.master.gain.value = this.volumes.master;
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -14;
    this.compressor.ratio.value = 6;
    this.master.connect(this.compressor).connect(this.ctx.destination);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.volumes.sfx;
    this.sfxBus.connect(this.master);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.volumes.music;
    this.musicBus.connect(this.master);

    this.ambienceBus = this.ctx.createGain();
    this.ambienceBus.gain.value = 0.8;
    this.ambienceBus.connect(this.master);

    this.noiseBuffer = this.#makeNoise(4, 'white');
    this.brownBuffer = this.#makeNoise(6, 'brown');
    this.ready = true;
  }

  resume() {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(kind, value) {
    this.volumes[kind] = value;
    if (!this.ready) return;
    if (kind === 'master') this.master.gain.value = value;
    if (kind === 'sfx') this.sfxBus.gain.value = value;
    if (kind === 'music') this.musicBus.gain.value = value;
  }

  #makeNoise(seconds, type) {
    const length = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      if (type === 'brown') {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      } else {
        data[i] = white;
      }
    }
    return buffer;
  }

  #noise(buffer, loop = false) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer || this.noiseBuffer;
    src.loop = loop;
    return src;
  }

  #pan(value = 0) {
    const node = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (node) node.pan.value = Math.max(-1, Math.min(1, value));
    return node;
  }

  #chain(nodes, dest) {
    let prev = null;
    nodes.forEach((n) => {
      if (!n) return;
      if (prev) prev.connect(n);
      prev = n;
    });
    if (prev) prev.connect(dest);
    return prev;
  }

  // --- one shots ------------------------------------------------------------

  footstep(surface = 'wood', running = false, pan = 0) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const src = this.#noise(this.noiseBuffer);
    src.playbackRate.value = 0.8 + Math.random() * 0.5;
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    const profiles = {
      wood: { type: 'bandpass', freq: 420, q: 1.2, gain: 0.32, len: 0.13 },
      stone: { type: 'bandpass', freq: 900, q: 2.0, gain: 0.24, len: 0.09 },
      water: { type: 'lowpass', freq: 1800, q: 0.7, gain: 0.42, len: 0.28 },
      carpet: { type: 'lowpass', freq: 300, q: 0.6, gain: 0.2, len: 0.16 },
      metal: { type: 'bandpass', freq: 1600, q: 4.0, gain: 0.26, len: 0.2 },
    };
    const p = profiles[surface] || profiles.wood;
    filter.type = p.type;
    filter.frequency.value = p.freq * (0.85 + Math.random() * 0.3);
    filter.Q.value = p.q;
    const level = p.gain * (running ? 1.35 : 1);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(level, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + p.len);
    this.#chain([src, filter, gain, this.#pan(pan)], this.sfxBus);
    src.start(t);
    src.stop(t + p.len + 0.05);

    if (surface === 'wood' && Math.random() < 0.28) this.creak(0.25, pan);
  }

  creak(volume = 0.4, pan = 0) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    const base = 90 + Math.random() * 160;
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.linearRampToValueAtTime(base * (1.4 + Math.random()), t + 0.6);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 700;
    filter.Q.value = 8;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume * 0.25, t + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    this.#chain([osc, filter, gain, this.#pan(pan)], this.sfxBus);
    osc.start(t);
    osc.stop(t + 0.75);
  }

  gunshot(kind = 'revolver', pan = 0) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const heavy = kind === 'shotgun';

    const body = this.#noise(this.noiseBuffer);
    body.playbackRate.value = heavy ? 0.7 : 1.0;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(heavy ? 2600 : 4200, t);
    lp.frequency.exponentialRampToValueAtTime(280, t + (heavy ? 0.42 : 0.28));
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(heavy ? 0.95 : 0.72, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (heavy ? 0.5 : 0.32));
    this.#chain([body, lp, g, this.#pan(pan)], this.sfxBus);
    body.start(t);
    body.stop(t + 0.6);

    const thump = this.ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(heavy ? 120 : 165, t);
    thump.frequency.exponentialRampToValueAtTime(38, t + 0.22);
    const tg = this.ctx.createGain();
    tg.gain.setValueAtTime(heavy ? 0.75 : 0.5, t);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    this.#chain([thump, tg], this.sfxBus);
    thump.start(t);
    thump.stop(t + 0.35);

    // room tail
    const tail = this.#noise(this.noiseBuffer);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.8;
    const tgain = this.ctx.createGain();
    tgain.gain.setValueAtTime(0.0001, t + 0.04);
    tgain.gain.exponentialRampToValueAtTime(0.16, t + 0.1);
    tgain.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    this.#chain([tail, bp, tgain], this.sfxBus);
    tail.start(t + 0.04);
    tail.stop(t + 1.2);
  }

  dryFire() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const src = this.#noise(this.noiseBuffer);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2200;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    this.#chain([src, hp, g], this.sfxBus);
    src.start(t);
    src.stop(t + 0.1);
  }

  reload() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    [0, 0.14, 0.3].forEach((offset, i) => {
      const src = this.#noise(this.noiseBuffer);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1800 + i * 700;
      bp.Q.value = 6;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + offset);
      g.gain.exponentialRampToValueAtTime(0.3, t + offset + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.09);
      this.#chain([src, bp, g], this.sfxBus);
      src.start(t + offset);
      src.stop(t + offset + 0.12);
    });
  }

  swing() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const src = this.#noise(this.brownBuffer);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(1500, t + 0.18);
    bp.Q.value = 1.4;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    this.#chain([src, bp, g], this.sfxBus);
    src.start(t);
    src.stop(t + 0.3);
  }

  impact(wet = false, pan = 0) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const src = this.#noise(this.noiseBuffer);
    src.playbackRate.value = wet ? 0.6 : 1.1;
    const filter = this.ctx.createBiquadFilter();
    filter.type = wet ? 'lowpass' : 'bandpass';
    filter.frequency.value = wet ? 700 : 2200;
    filter.Q.value = wet ? 0.7 : 3;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(wet ? 0.6 : 0.4, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (wet ? 0.3 : 0.16));
    this.#chain([src, filter, g, this.#pan(pan)], this.sfxBus);
    src.start(t);
    src.stop(t + 0.4);
  }

  hurt() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(210, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.4);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    this.#chain([osc, g], this.sfxBus);
    osc.start(t);
    osc.stop(t + 0.5);
    this.impact(true);
  }

  heartbeat(intensity = 1) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const beat = (offset, level) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(72, t + offset);
      osc.frequency.exponentialRampToValueAtTime(34, t + offset + 0.18);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + offset);
      g.gain.exponentialRampToValueAtTime(level * intensity, t + offset + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.22);
      this.#chain([osc, g], this.sfxBus);
      osc.start(t + offset);
      osc.stop(t + offset + 0.3);
    };
    beat(0, 0.5);
    beat(0.19, 0.34);
  }

  growl(pan = 0, size = 1) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    const base = 62 / size;
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.linearRampToValueAtTime(base * 0.72, t + 1.1);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 11 + Math.random() * 9;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 16;
    lfo.connect(lfoGain).connect(osc.frequency);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.36, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
    this.#chain([osc, filter, g, this.#pan(pan)], this.sfxBus);
    osc.start(t); lfo.start(t);
    osc.stop(t + 1.4); lfo.stop(t + 1.4);
  }

  shriek(pan = 0) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(1900, t + 0.3);
    osc.frequency.exponentialRampToValueAtTime(420, t + 0.9);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1400;
    filter.Q.value = 3;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    this.#chain([osc, filter, g, this.#pan(pan)], this.sfxBus);
    osc.start(t);
    osc.stop(t + 1.1);
  }

  /** The villain's laugh: descending pitched bursts over a low bed. */
  laugh() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const count = 6 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i += 1) {
      const offset = i * (0.16 + Math.random() * 0.05);
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      const base = 128 - i * 6 + Math.random() * 14;
      osc.frequency.setValueAtTime(base, t + offset);
      osc.frequency.exponentialRampToValueAtTime(base * 0.62, t + offset + 0.14);
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 520 + Math.random() * 240;
      filter.Q.value = 3.5;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + offset);
      g.gain.exponentialRampToValueAtTime(0.3, t + offset + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.17);
      this.#chain([osc, filter, g, this.#pan((Math.random() - 0.5) * 0.7)], this.sfxBus);
      osc.start(t + offset);
      osc.stop(t + offset + 0.2);
    }
    this.villainBed(count * 0.19 + 0.6);
  }

  stinger(kind = 'shock') {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    if (kind === 'shock') {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(1400, t);
      osc.frequency.exponentialRampToValueAtTime(60, t + 1.4);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
      this.#chain([osc, g], this.musicBus);
      osc.start(t);
      osc.stop(t + 1.6);
    } else if (kind === 'grief') {
      [110, 138.6, 164.8, 220].forEach((f, i) => {
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = f;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t + i * 0.25);
        g.gain.exponentialRampToValueAtTime(0.16, t + i * 0.25 + 0.9);
        g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.25 + 5.5);
        this.#chain([osc, g], this.musicBus);
        osc.start(t + i * 0.25);
        osc.stop(t + i * 0.25 + 6);
      });
    } else if (kind === 'rage') {
      [55, 82.4, 110].forEach((f, i) => {
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = f;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(200, t);
        filter.frequency.exponentialRampToValueAtTime(2600, t + 2.4);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t + i * 0.08);
        g.gain.exponentialRampToValueAtTime(0.2, t + 0.8);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 4.5);
        this.#chain([osc, filter, g], this.musicBus);
        osc.start(t + i * 0.08);
        osc.stop(t + 5);
      });
    }
  }

  door(open = true) {
    if (!this.ready) return;
    this.creak(0.9);
    const t = this.ctx.currentTime + (open ? 0.55 : 0.05);
    const src = this.#noise(this.noiseBuffer);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    this.#chain([src, lp, g], this.sfxBus);
    src.start(t);
    src.stop(t + 0.3);
  }

  pickup(good = true) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const notes = good ? [523, 784] : [392, 261];
    notes.forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.14, t + i * 0.09 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.4);
      this.#chain([osc, g], this.sfxBus);
      osc.start(t + i * 0.09);
      osc.stop(t + i * 0.09 + 0.45);
    });
  }

  lever() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const src = this.#noise(this.noiseBuffer);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2400, t);
    bp.frequency.exponentialRampToValueAtTime(700, t + 0.3);
    bp.Q.value = 5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    this.#chain([src, bp, g], this.sfxBus);
    src.start(t);
    src.stop(t + 0.4);
  }

  /** A low bed played underneath the villain's voice lines. */
  villainBed(seconds = 3) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 41;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 260;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.5);
    g.gain.setValueAtTime(0.14, t + seconds - 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    this.#chain([osc, filter, g], this.musicBus);
    osc.start(t);
    osc.stop(t + seconds + 0.2);
  }

  // --- looping ambience -----------------------------------------------------

  stopAmbience(fade = 1.2) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.ambienceNodes.forEach(({ gain, sources }) => {
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + fade);
      sources.forEach((s) => { try { s.stop(t + fade + 0.1); } catch (e) { /* already stopped */ } });
    });
    this.ambienceNodes = [];
    this.ambienceName = null;
  }

  setAmbience(name) {
    if (!this.ready || this.ambienceName === name) return;
    this.stopAmbience(1.0);
    this.ambienceName = name;
    const t = this.ctx.currentTime;

    const layer = (buildFn, level, fadeIn = 2.5) => {
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(level, t + fadeIn);
      gain.connect(this.ambienceBus);
      const sources = buildFn(gain);
      this.ambienceNodes.push({ gain, sources });
    };

    const windLayer = (cut, level) => layer((dest) => {
      const src = this.#noise(this.brownBuffer, true);
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cut;
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.07;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = cut * 0.45;
      lfo.connect(lfoGain).connect(filter.frequency);
      src.connect(filter).connect(dest);
      src.start(t); lfo.start(t);
      return [src, lfo];
    }, level);

    const droneLayer = (freq, level, type = 'sine') => layer((dest) => {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      const detune = this.ctx.createOscillator();
      detune.frequency.value = 0.11;
      const dg = this.ctx.createGain();
      dg.gain.value = freq * 0.01;
      detune.connect(dg).connect(osc.frequency);
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 320;
      osc.connect(filter).connect(dest);
      osc.start(t); detune.start(t);
      return [osc, detune];
    }, level);

    switch (name) {
      case 'rain':
        windLayer(1400, 0.24);
        droneLayer(48, 0.05);
        break;
      case 'house':
        windLayer(260, 0.16);
        droneLayer(41, 0.07);
        droneLayer(61.5, 0.035, 'triangle');
        break;
      case 'basement':
        windLayer(150, 0.13);
        droneLayer(32, 0.1);
        layer((dest) => { // dripping water
          const src = this.#noise(this.noiseBuffer, true);
          const filter = this.ctx.createBiquadFilter();
          filter.type = 'bandpass';
          filter.frequency.value = 2600;
          filter.Q.value = 14;
          const shaper = this.ctx.createGain();
          shaper.gain.value = 0.55;
          src.connect(filter).connect(shaper).connect(dest);
          src.start(t);
          return [src];
        }, 0.09);
        break;
      case 'chapel':
        droneLayer(36, 0.11);
        droneLayer(54, 0.05, 'triangle');
        windLayer(180, 0.09);
        break;
      case 'fire':
        layer((dest) => {
          const src = this.#noise(this.noiseBuffer, true);
          const filter = this.ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.value = 900;
          const lfo = this.ctx.createOscillator();
          lfo.frequency.value = 3.4;
          const lg = this.ctx.createGain();
          lg.gain.value = 420;
          lfo.connect(lg).connect(filter.frequency);
          src.connect(filter).connect(dest);
          src.start(t); lfo.start(t);
          return [src, lfo];
        }, 0.3, 1.2);
        droneLayer(44, 0.09, 'sawtooth');
        break;
      default:
        droneLayer(40, 0.05);
    }
  }

  /** Random structural creaks, driven from the game loop. */
  update(dt, tension = 0) {
    if (!this.ready) return;
    this.creakTimer -= dt;
    if (this.creakTimer <= 0) {
      this.creakTimer = 4 + Math.random() * 9 - tension * 2.5;
      if (Math.random() < 0.7) this.creak(0.3 + tension * 0.4, Math.random() * 2 - 1);
    }
  }
}
