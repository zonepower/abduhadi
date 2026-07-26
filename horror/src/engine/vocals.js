// ---------------------------------------------------------------------------
// مُخلِّق الأصوات البشرية — formant vocal synthesis.
//
// Browser text-to-speech gives us intelligible words but almost no acting: one
// system voice, no breath, no grief. So the *performance* is synthesised here
// instead — a glottal source driven through a per-character formant bank.
//
// Each character gets a different vocal tract:
//   * an adult man   -> low F0, low formants, long tract
//   * a nine-year-old-> high F0, formants shifted up ~30%, short tract
//   * the villain    -> sub-bass F0, ring modulation, a growl an octave down
//
// From that one instrument we build sobs, gasps, screams, whimpers and laughs.
// ---------------------------------------------------------------------------

export const TIMBRES = {
  karim: {
    f0: 104,
    jitter: 0.026,
    // [frequency, gain, bandwidth]
    formants: [[560, 1.0, 80], [1080, 0.5, 100], [2480, 0.22, 160], [3300, 0.09, 220]],
    breath: 0.22,
    tilt: 1.55,
  },
  layla: {
    f0: 298,
    jitter: 0.042,
    formants: [[760, 1.0, 110], [1780, 0.62, 130], [3120, 0.34, 190], [4100, 0.14, 250]],
    breath: 0.34,
    tilt: 1.35,
  },
  shepherd: {
    f0: 61,
    jitter: 0.07,
    formants: [[360, 1.0, 65], [860, 0.62, 95], [1820, 0.3, 150]],
    breath: 0.4,
    tilt: 1.85,
    ring: 33,
    growl: true,
  },
  narrator: {
    f0: 118,
    jitter: 0.018,
    formants: [[540, 1.0, 90], [1150, 0.45, 110], [2400, 0.18, 170]],
    breath: 0.2,
    tilt: 1.6,
  },
};

// vowel targets the formant bank glides between, so an utterance moves instead
// of sitting on one dead tone
const VOWELS = {
  a: [1.0, 1.0, 1.0],
  e: [0.72, 1.5, 1.05],
  i: [0.45, 1.9, 1.15],
  o: [0.78, 0.68, 0.92],
  u: [0.55, 0.52, 0.88],
};

export class Vocals {
  constructor(engine) {
    this.engine = engine; // AudioEngine
    this.wave = null;
  }

  get ctx() { return this.engine.ctx; }

  get ready() { return Boolean(this.engine.ready); }

  /** Glottal pulse: harmonics rolling off ~1/n^tilt, like a real vocal fold. */
  #glottalWave(tilt) {
    const key = `w${tilt.toFixed(2)}`;
    this._waves = this._waves || {};
    if (this._waves[key]) return this._waves[key];
    const n = 40;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let i = 1; i < n; i += 1) imag[i] = 1 / (i ** tilt);
    const wave = this.ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    this._waves[key] = wave;
    return wave;
  }

  #bus() {
    return this.engine.voiceBus || this.engine.sfxBus;
  }

  /**
   * One vocal gesture.
   * @param {object} opts
   *   who      character key
   *   t0       start time offset (seconds from now)
   *   dur      length in seconds
   *   pitch    multiplier on the character's base F0
   *   bend     [start, end] multipliers applied across the gesture
   *   vowel    'a' | 'e' | 'i' | 'o' | 'u' or [from, to]
   *   vibrato  [rateHz, depthCents]
   *   tremble  0..1 amplitude wobble (crying)
   *   noise    0..1 breathiness on top of the voiced source
   *   gain     0..1 loudness
   *   attack / release shaping
   */
  gesture(opts) {
    if (!this.ready) return 0;
    const timbre = TIMBRES[opts.who] || TIMBRES.karim;
    const ctx = this.ctx;
    const t = ctx.currentTime + (opts.t0 || 0);
    const dur = Math.max(0.05, opts.dur ?? 0.4);
    const gain = (opts.gain ?? 0.5) * (this.engine.volumes.voice ?? 1);
    const bend = opts.bend || [1, 1];
    const baseF0 = timbre.f0 * (opts.pitch ?? 1);

    const out = ctx.createGain();
    out.gain.value = 0;
    // the formant bandpasses eat a lot of level; make it up after the sum
    const makeup = ctx.createGain();
    makeup.gain.value = 3.4;
    out.connect(makeup).connect(this.#bus());
    if (this.engine.reverbSend) {
      const send = ctx.createGain();
      send.gain.value = 0.5;
      makeup.connect(send).connect(this.engine.reverbSend);
    }

    // --- glottal source ---
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(this.#glottalWave(timbre.tilt));
    osc.frequency.setValueAtTime(baseF0 * bend[0], t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, baseF0 * bend[1]), t + dur);

    // jitter: micro pitch instability, the difference between a voice and a beep
    const jitter = ctx.createOscillator();
    jitter.type = 'triangle';
    jitter.frequency.value = 7 + Math.random() * 9;
    const jitterGain = ctx.createGain();
    jitterGain.gain.value = baseF0 * timbre.jitter;
    jitter.connect(jitterGain).connect(osc.frequency);

    let vibrato = null;
    let vibratoGain = null;
    if (opts.vibrato) {
      vibrato = ctx.createOscillator();
      vibrato.type = 'sine';
      vibrato.frequency.value = opts.vibrato[0];
      vibratoGain = ctx.createGain();
      vibratoGain.gain.value = baseF0 * (opts.vibrato[1] / 1200) * 4;
      vibrato.connect(vibratoGain).connect(osc.frequency);
    }

    // --- optional monster layers ---
    let ring = null;
    let growl = null;
    const sourceGain = ctx.createGain();
    sourceGain.gain.value = 1;
    osc.connect(sourceGain);

    if (timbre.ring) {
      const modulated = ctx.createGain();
      modulated.gain.value = 0;
      ring = ctx.createOscillator();
      ring.type = 'sine';
      ring.frequency.value = timbre.ring;
      ring.connect(modulated.gain);
      sourceGain.connect(modulated);
      modulated.connect(sourceGain);
    }
    if (timbre.growl) {
      growl = ctx.createOscillator();
      growl.type = 'sawtooth';
      growl.frequency.setValueAtTime(baseF0 * 0.5 * bend[0], t);
      growl.frequency.exponentialRampToValueAtTime(Math.max(18, baseF0 * 0.5 * bend[1]), t + dur);
      const growlGain = ctx.createGain();
      growlGain.gain.value = 0.45;
      const growlLp = ctx.createBiquadFilter();
      growlLp.type = 'lowpass';
      growlLp.frequency.value = 300;
      growl.connect(growlLp).connect(growlGain).connect(sourceGain);
    }

    // --- formant bank ---
    const vowelPair = Array.isArray(opts.vowel) ? opts.vowel : [opts.vowel || 'a', opts.vowel || 'a'];
    const from = VOWELS[vowelPair[0]] || VOWELS.a;
    const to = VOWELS[vowelPair[1]] || from;
    timbre.formants.forEach((f, i) => {
      const [freq, level, bw] = f;
      const shiftA = from[i] ?? 1;
      const shiftB = to[i] ?? shiftA;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(freq * shiftA, t);
      filter.frequency.linearRampToValueAtTime(freq * shiftB, t + dur);
      filter.Q.value = Math.max(1.2, (freq * shiftA) / bw);
      const fg = ctx.createGain();
      fg.gain.value = level;
      sourceGain.connect(filter).connect(fg).connect(out);
    });

    // --- breath ---
    let breathSrc = null;
    const breathiness = (opts.noise ?? 0) + timbre.breath * 0.35;
    if (breathiness > 0.01) {
      breathSrc = ctx.createBufferSource();
      breathSrc.buffer = this.engine.noiseBuffer;
      breathSrc.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1400 + Math.random() * 900;
      bp.Q.value = 0.7;
      const bg = ctx.createGain();
      bg.gain.value = breathiness * 0.32;
      breathSrc.connect(bp).connect(bg).connect(out);
    }

    // --- envelope (+ tremble for crying) ---
    const attack = opts.attack ?? Math.min(0.08, dur * 0.25);
    const release = opts.release ?? Math.min(0.3, dur * 0.5);
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    if (opts.tremble) {
      const steps = Math.max(2, Math.floor(dur * 11));
      for (let i = 0; i < steps; i += 1) {
        const at = t + attack + (dur - attack - release) * (i / steps);
        const wobble = 1 - opts.tremble * (i % 2 === 0 ? 0.55 : 0.05) * (0.6 + Math.random() * 0.6);
        out.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * wobble), at);
      }
    }
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    const stop = t + dur + 0.08;
    osc.start(t); osc.stop(stop);
    jitter.start(t); jitter.stop(stop);
    if (vibrato) { vibrato.start(t); vibrato.stop(stop); }
    if (ring) { ring.start(t); ring.stop(stop); }
    if (growl) { growl.start(t); growl.stop(stop); }
    if (breathSrc) { breathSrc.start(t); breathSrc.stop(stop); }
    void vibratoGain;
    return dur;
  }

  /** Air only — an exhale, a shaky inhale before a hard sentence. */
  breath(who = 'karim', { inhale = false, intensity = 0.5, t0 = 0 } = {}) {
    if (!this.ready) return 0;
    const ctx = this.ctx;
    const t = ctx.currentTime + t0;
    const dur = inhale ? 0.42 : 0.6;
    const src = ctx.createBufferSource();
    src.buffer = this.engine.noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    const base = who === 'layla' ? 1500 : who === 'shepherd' ? 520 : 950;
    bp.frequency.setValueAtTime(inhale ? base * 0.7 : base * 1.25, t);
    bp.frequency.linearRampToValueAtTime(inhale ? base * 1.5 : base * 0.6, t + dur);
    bp.Q.value = 1.1;
    const g = ctx.createGain();
    const peak = 0.16 * intensity * (this.engine.volumes.voice ?? 1);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + (inhale ? dur * 0.7 : 0.08));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(this.#bus());
    if (this.engine.reverbSend) g.connect(this.engine.reverbSend);
    src.start(t);
    src.stop(t + dur + 0.05);
    return dur;
  }

  /** A single sob: caught breath, voiced break, falling pitch. */
  sob(who = 'karim', { t0 = 0, intensity = 1 } = {}) {
    if (!this.ready) return 0;
    this.breath(who, { inhale: true, intensity: 0.55 * intensity, t0 });
    let cursor = t0 + 0.24;
    const beats = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < beats; i += 1) {
      this.gesture({
        who,
        t0: cursor,
        dur: 0.2 + Math.random() * 0.12,
        pitch: (1.15 - i * 0.12) * (0.95 + Math.random() * 0.12),
        bend: [1.12, 0.72],
        vowel: ['e', 'o'],
        tremble: 0.75,
        noise: 0.4,
        gain: 0.42 * intensity,
        attack: 0.012,
      });
      cursor += 0.26 + Math.random() * 0.1;
    }
    this.breath(who, { inhale: false, intensity: 0.45 * intensity, t0: cursor });
    return cursor + 0.5;
  }

  /** Sharp intake — fear, shock. */
  gasp(who = 'karim', { t0 = 0, intensity = 1 } = {}) {
    if (!this.ready) return 0;
    this.breath(who, { inhale: true, intensity: 1.1 * intensity, t0 });
    this.gesture({
      who,
      t0: t0 + 0.16,
      dur: 0.16,
      pitch: 1.5,
      bend: [1.0, 1.35],
      vowel: 'a',
      noise: 0.55,
      gain: 0.3 * intensity,
      attack: 0.01,
    });
    return 0.42;
  }

  /** The scream. Rises, cracks, falls apart. */
  scream(who = 'karim', { t0 = 0, dur = 1.5, intensity = 1 } = {}) {
    if (!this.ready) return 0;
    this.gesture({
      who,
      t0,
      dur: dur * 0.62,
      pitch: who === 'layla' ? 2.0 : 2.35,
      bend: [0.85, 1.25],
      vowel: ['a', 'a'],
      vibrato: [6.5, 55],
      noise: 0.75,
      gain: 0.72 * intensity,
      attack: 0.05,
    });
    // the voice breaking at the top
    this.gesture({
      who,
      t0: t0 + dur * 0.58,
      dur: dur * 0.46,
      pitch: who === 'layla' ? 2.3 : 2.75,
      bend: [1.3, 0.55],
      vowel: ['a', 'e'],
      vibrato: [11, 90],
      tremble: 0.5,
      noise: 1.0,
      gain: 0.6 * intensity,
      attack: 0.02,
    });
    this.breath(who, { inhale: false, intensity: 0.8, t0: t0 + dur });
    return dur + 0.5;
  }

  /** Small, high, frightened. */
  whimper(who = 'layla', { t0 = 0, intensity = 1 } = {}) {
    if (!this.ready) return 0;
    let cursor = t0;
    for (let i = 0; i < 3; i += 1) {
      this.gesture({
        who,
        t0: cursor,
        dur: 0.16,
        pitch: 1.35 - i * 0.08,
        bend: [1.1, 0.85],
        vowel: ['i', 'e'],
        tremble: 0.6,
        noise: 0.45,
        gain: 0.24 * intensity,
      });
      cursor += 0.22;
    }
    return cursor - t0;
  }

  /** Low, pained. */
  groan(who = 'karim', { t0 = 0, intensity = 1 } = {}) {
    if (!this.ready) return 0;
    this.gesture({
      who,
      t0,
      dur: 0.9,
      pitch: 0.82,
      bend: [1.0, 0.7],
      vowel: ['o', 'u'],
      tremble: 0.3,
      noise: 0.35,
      gain: 0.4 * intensity,
    });
    return 1.0;
  }

  /** The villain's laugh, built from the same vocal tract as his speech. */
  laugh(who = 'shepherd', { t0 = 0, intensity = 1 } = {}) {
    if (!this.ready) return 0;
    let cursor = t0;
    const beats = 6 + Math.floor(Math.random() * 4);
    for (let i = 0; i < beats; i += 1) {
      const decay = 1 - i / (beats * 1.6);
      this.gesture({
        who,
        t0: cursor,
        dur: 0.17,
        pitch: (1.32 - i * 0.055) * (0.96 + Math.random() * 0.09),
        bend: [1.25, 0.82],
        vowel: i % 2 === 0 ? ['a', 'o'] : ['o', 'a'],
        noise: 0.28,
        gain: 0.5 * intensity * decay,
        attack: 0.008,
        release: 0.06,
      });
      cursor += 0.185 + Math.random() * 0.05;
    }
    this.breath(who, { inhale: true, intensity: 0.7, t0: cursor });
    return cursor - t0 + 0.4;
  }

  /** Wordless dread — used for the villain speaking through the walls. */
  drone(who = 'shepherd', seconds = 3, { t0 = 0 } = {}) {
    if (!this.ready) return 0;
    this.gesture({
      who,
      t0,
      dur: seconds,
      pitch: 0.62,
      bend: [1, 0.88],
      vowel: ['u', 'o'],
      vibrato: [0.7, 25],
      noise: 0.2,
      gain: 0.16,
      attack: 0.6,
      release: 0.8,
    });
    return seconds;
  }
}
