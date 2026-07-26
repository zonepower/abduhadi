// ---------------------------------------------------------------------------
// مخرج الحوار — dialogue director.
//
// Two layers make up a spoken line:
//   1. the WORDS  — system text-to-speech, chosen and tuned per character
//   2. the ACTING — breaths, sobs, gasps, screams and laughs from our own
//                   formant synth (vocals.js), placed around and between the
//                   words according to the line's emotion
//
// Layer 2 is what carries the performance, and it works identically whether or
// not the machine has an Arabic voice installed — if TTS is missing we voice
// the line as a murmur in the character's own timbre instead of going silent.
// ---------------------------------------------------------------------------

export const CHARACTERS = {
  karim: { name: 'كريم', color: '#cfe3ff', pitch: 0.58, rate: 0.9, gender: 'male' },
  layla: { name: 'ليلى', color: '#ffd9ea', pitch: 1.88, rate: 1.14, gender: 'female' },
  shepherd: { name: 'الراعي', color: '#ff5d5d', pitch: 0.16, rate: 0.66, gender: 'male' },
  radio: { name: 'اللاسلكي', color: '#9be7a5', pitch: 1.0, rate: 1.1, gender: 'male' },
  narrator: { name: '', color: '#c9c9d6', pitch: 0.8, rate: 0.86, gender: 'male' },
};

/**
 * Emotions bend prosody and decide which non-verbal gestures wrap the line.
 * `between` fires between clauses, which is what makes a crying line sound
 * like crying rather than a sad sentence.
 */
export const EMOTIONS = {
  calm: { pitch: 0, rate: 0, volume: 1 },
  soft: { pitch: -0.06, rate: -0.08, volume: 0.85, post: 'breath' },
  tense: { pitch: 0.1, rate: 0.12, volume: 1 },
  afraid: { pitch: 0.2, rate: 0.15, volume: 0.95, pre: 'gasp', post: 'breath' },
  plead: { pitch: 0.14, rate: -0.04, volume: 1, pre: 'inhale', between: 'breath' },
  cry: { pitch: 0.12, rate: -0.18, volume: 0.9, pre: 'sob', between: 'sob', post: 'breath' },
  scream: { pitch: 0.34, rate: 0.26, volume: 1, pre: 'scream' },
  angry: { pitch: -0.12, rate: 0.14, volume: 1, pre: 'inhale' },
  mock: { pitch: 0.06, rate: -0.06, volume: 1, post: 'laugh' },
  cold: { pitch: -0.14, rate: -0.12, volume: 0.95 },
  whisper: { pitch: 0.04, rate: -0.12, volume: 0.5, pre: 'inhale' },
  hurt: { pitch: -0.05, rate: -0.1, volume: 0.9, pre: 'groan' },
};

const FEMALE_HINTS = /hoda|laila|layla|salma|amira|amina|noura|nora|maryam|zeina|sana|fatima|female|woman|أنثى|هدى|ليلى/i;
const MALE_HINTS = /majed|maged|naayf|nayef|tarik|tariq|hamed|omar|khalid|male|man|ذكر|ماجد/i;

export class VoiceDirector {
  constructor(audio, vocals) {
    this.audio = audio;
    this.vocals = vocals;
    this.synth = window.speechSynthesis || null;
    this.voices = {};
    this.enabled = true;
    this.volume = 1;
    this.queue = [];
    this.current = null;
    this.onSubtitle = null;
    this.hasArabicVoice = false;
    this.voiceCount = 0;
    this._timer = null;
    this._cancelled = false;

    if (this.synth) {
      this.#pickVoices();
      if (this.synth.addEventListener) {
        this.synth.addEventListener('voiceschanged', () => this.#pickVoices());
      }
    }
  }

  /**
   * Assigns a system voice per character. When the machine has more than one
   * Arabic voice we deliberately hand different ones to the father and the
   * daughter so they don't sound like the same person at two pitches.
   */
  #pickVoices() {
    const all = this.synth.getVoices?.() || [];
    if (!all.length) return;
    this.voiceCount = all.length;
    const arabic = all.filter((v) => /^ar/i.test(v.lang));
    this.hasArabicVoice = arabic.length > 0;
    const pool = arabic.length ? arabic : all;

    const score = (voice, wantFemale) => {
      let s = 0;
      if (/^ar/i.test(voice.lang)) s += 100;
      if (voice.localService) s += 8;
      const female = FEMALE_HINTS.test(voice.name);
      const male = MALE_HINTS.test(voice.name);
      if (wantFemale && female) s += 40;
      if (!wantFemale && male) s += 40;
      if (wantFemale && male) s -= 25;
      if (!wantFemale && female) s -= 25;
      return s;
    };

    const best = (wantFemale, exclude) => {
      const ranked = pool
        .filter((v) => !exclude || v.name !== exclude.name)
        .sort((a, b) => score(b, wantFemale) - score(a, wantFemale));
      return ranked[0] || pool[0];
    };

    const male = best(false);
    const female = best(true, pool.length > 1 ? male : null);
    this.voices = {
      karim: male,
      shepherd: male,
      narrator: male,
      radio: female,
      layla: female,
    };
    this.voice = male;
  }

  get available() {
    return Boolean(this.synth && this.voices.karim);
  }

  get voiceReport() {
    if (!this.synth) return 'المتصفح لا يدعم النطق';
    if (!this.voices.karim) return 'لا توجد أصوات مثبّتة';
    const names = new Set(Object.values(this.voices).map((v) => v && v.name).filter(Boolean));
    if (!this.hasArabicVoice) return `لا يوجد صوت عربي — تُستخدم النبرات المُخلَّقة (${names.size} صوت متاح)`;
    return [...names].join(' · ');
  }

  say(line) {
    return new Promise((resolve) => {
      this.queue.push({ ...line, resolve });
      if (!this.current) this.#next();
    });
  }

  async conversation(lines) {
    for (const line of lines) {
      // eslint-disable-next-line no-await-in-loop
      await this.say(line);
    }
  }

  #estimate(text, rate) {
    return Math.max(1.1, (text.length * 0.082) / Math.max(0.5, rate));
  }

  /** Splits a line into clauses so prosody and sobs can land between them. */
  #clauses(text) {
    const parts = text
      .split(/(?<=[.!؟?…،:])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length ? parts : [text];
  }

  #gesture(name, who, at = 0) {
    const v = this.vocals;
    if (!v || !v.ready) return 0;
    switch (name) {
      case 'sob': return v.sob(who, { t0: at });
      case 'gasp': return v.gasp(who, { t0: at });
      case 'scream': return v.scream(who, { t0: at, dur: who === 'layla' ? 1.2 : 1.6 });
      case 'laugh': return v.laugh(who, { t0: at });
      case 'groan': return v.groan(who, { t0: at });
      case 'whimper': return v.whimper(who, { t0: at });
      case 'breath': return v.breath(who, { t0: at, intensity: 0.6 });
      case 'inhale': return v.breath(who, { t0: at, inhale: true, intensity: 0.75 });
      default: return 0;
    }
  }

  /** Voices a clause in the character's own timbre when TTS is unavailable. */
  #murmur(who, text, profile) {
    const v = this.vocals;
    if (!v || !v.ready) return this.#estimate(text, profile.rate);
    const syllables = Math.max(2, Math.min(14, Math.round(text.length / 3.2)));
    const step = 0.135 / profile.rate;
    const vowels = ['a', 'e', 'i', 'o', 'u'];
    for (let i = 0; i < syllables; i += 1) {
      const drift = 1 + Math.sin(i * 1.7) * 0.16 - (i / syllables) * 0.18;
      v.gesture({
        who,
        t0: i * step,
        dur: step * 0.85,
        pitch: profile.pitchMul * drift,
        bend: [drift, drift * 0.93],
        vowel: [vowels[i % 5], vowels[(i + 2) % 5]],
        noise: 0.22,
        gain: 0.3 * profile.volume,
        attack: 0.02,
        release: step * 0.4,
      });
    }
    return syllables * step + 0.15;
  }

  #speakClause(who, text, profile) {
    return new Promise((resolve) => {
      if (!this.enabled || !this.available) {
        const seconds = this.#murmur(who, text, profile);
        this._timer = setTimeout(resolve, seconds * 1000);
        return;
      }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (this._timer) { clearTimeout(this._timer); this._timer = null; }
        resolve();
      };
      try {
        const utter = new SpeechSynthesisUtterance(text);
        const voice = this.voices[who] || this.voices.karim;
        utter.voice = voice;
        utter.lang = this.hasArabicVoice ? voice.lang : 'ar-SA';
        utter.pitch = Math.max(0, Math.min(2, profile.pitch));
        utter.rate = Math.max(0.1, Math.min(2, profile.rate));
        utter.volume = Math.max(0, Math.min(1, profile.volume * this.volume));
        utter.onend = finish;
        utter.onerror = finish;
        // Chrome drops long utterances silently; the watchdog keeps the scene moving
        this._timer = setTimeout(finish, (this.#estimate(text, profile.rate) + 3.5) * 1000);
        this.synth.speak(utter);
      } catch (err) {
        this._timer = setTimeout(finish, this.#estimate(text, profile.rate) * 1000);
      }
    });
  }

  async #next() {
    this.current = this.queue.shift() || null;
    if (!this.current) {
      if (this.onSubtitle) this.onSubtitle(null);
      this.audio?.unduck();
      return;
    }
    const line = this.current;
    const character = CHARACTERS[line.who] || CHARACTERS.narrator;
    const emotion = EMOTIONS[line.emo] || EMOTIONS.calm;
    const who = CHARACTERS[line.who] ? line.who : 'narrator';

    const profile = {
      pitch: Math.max(0, Math.min(2, character.pitch + emotion.pitch)),
      pitchMul: 1 + emotion.pitch * 0.8,
      rate: Math.max(0.4, character.rate + emotion.rate),
      volume: emotion.volume,
    };

    if (this.onSubtitle) this.onSubtitle({ character, text: line.text, emo: line.emo });
    this.audio?.duck(0.45);
    if (who === 'shepherd') this.vocals?.drone('shepherd', Math.min(9, this.#estimate(line.text, profile.rate) + 1));

    const wait = (seconds) => new Promise((r) => { this._timer = setTimeout(r, seconds * 1000); });

    if (emotion.pre) await wait(this.#gesture(emotion.pre, who) * 0.85);
    if (this._cancelled) return this.#finish(line);

    const clauses = this.#clauses(line.text);
    for (let i = 0; i < clauses.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await this.#speakClause(who, clauses[i], profile);
      if (this._cancelled) return this.#finish(line);
      if (emotion.between && i < clauses.length - 1) {
        // eslint-disable-next-line no-await-in-loop
        await wait(this.#gesture(emotion.between, who) * 0.7);
        if (this._cancelled) return this.#finish(line);
      }
    }

    if (emotion.post) this.#gesture(emotion.post, who);
    return this.#finish(line);
  }

  #finish(line) {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    this.current = null;
    this._cancelled = false;
    if (line.resolve) line.resolve();
    const gap = line.hold ?? 0.3;
    setTimeout(() => { if (!this.current) this.#next(); }, gap * 1000);
    return undefined;
  }

  skip() {
    if (this.synth) this.synth.cancel();
    this._cancelled = true;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    const line = this.current;
    this.current = null;
    if (line?.resolve) line.resolve();
    if (this.queue.length) this.#next();
    else if (this.onSubtitle) this.onSubtitle(null);
  }

  clear() {
    if (this.synth) this.synth.cancel();
    this._cancelled = true;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    this.queue.forEach((l) => l.resolve && l.resolve());
    this.queue.length = 0;
    const line = this.current;
    this.current = null;
    if (line?.resolve) line.resolve();
    this.audio?.unduck();
    if (this.onSubtitle) this.onSubtitle(null);
  }
}
