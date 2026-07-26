// ---------------------------------------------------------------------------
// Arabic voice-over driven by the Web Speech API, with a timed-subtitle
// fallback for browsers or systems that ship no Arabic voice.
// ---------------------------------------------------------------------------

export const CHARACTERS = {
  karim: { name: 'كريم', color: '#cfe3ff', pitch: 0.72, rate: 0.92 },
  layla: { name: 'ليلى', color: '#ffd9ea', pitch: 1.6, rate: 1.06 },
  shepherd: { name: 'الراعي', color: '#ff5d5d', pitch: 0.32, rate: 0.72 },
  radio: { name: 'اللاسلكي', color: '#9be7a5', pitch: 1.0, rate: 1.1 },
  narrator: { name: '', color: '#c9c9d6', pitch: 0.85, rate: 0.9 },
};

export class VoiceDirector {
  constructor(audio) {
    this.audio = audio;
    this.synth = window.speechSynthesis || null;
    this.voice = null;
    this.enabled = true;
    this.volume = 1;
    this.queue = [];
    this.current = null;
    this.onSubtitle = null;
    this.onLine = null;
    this._timer = null;

    if (this.synth) {
      this.#pickVoice();
      this.synth.addEventListener?.('voiceschanged', () => this.#pickVoice());
    }
  }

  #pickVoice() {
    const voices = this.synth.getVoices?.() || [];
    if (!voices.length) return;
    const arabic = voices.filter((v) => /^ar/i.test(v.lang));
    this.voice = arabic[0] || voices.find((v) => /^en/i.test(v.lang)) || voices[0];
    this.hasArabicVoice = arabic.length > 0;
  }

  get available() {
    return Boolean(this.synth && this.voice);
  }

  /**
   * @param {{who:string, text:string, hold?:number}} line
   */
  say(line) {
    return new Promise((resolve) => {
      this.queue.push({ ...line, resolve });
      if (!this.current) this.#next();
    });
  }

  /** Queue a whole conversation and resolve when the last line ends. */
  async conversation(lines) {
    for (const line of lines) {
      // eslint-disable-next-line no-await-in-loop
      await this.say(line);
    }
  }

  #estimate(text) {
    return Math.max(1.4, text.length * 0.085) * 1000;
  }

  #next() {
    this.current = this.queue.shift() || null;
    if (!this.current) {
      if (this.onSubtitle) this.onSubtitle(null);
      return;
    }
    const line = this.current;
    const character = CHARACTERS[line.who] || CHARACTERS.narrator;
    if (this.onSubtitle) this.onSubtitle({ character, text: line.text });
    if (this.onLine) this.onLine(line);

    if (line.who === 'shepherd' && this.audio) {
      this.audio.villainBed(Math.min(8, this.#estimate(line.text) / 1000 + 0.8));
    }

    const finish = () => {
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      const done = line.resolve;
      this.current = null;
      if (done) done();
      const gap = line.hold ?? 0.25;
      setTimeout(() => { if (!this.current) this.#next(); }, gap * 1000);
    };

    if (!this.enabled || !this.available) {
      this._timer = setTimeout(finish, this.#estimate(line.text));
      return;
    }

    try {
      const utter = new SpeechSynthesisUtterance(line.text);
      utter.voice = this.voice;
      utter.lang = this.hasArabicVoice ? this.voice.lang : 'ar-SA';
      utter.pitch = Math.max(0, Math.min(2, character.pitch));
      utter.rate = Math.max(0.1, Math.min(2, character.rate));
      utter.volume = this.volume;
      utter.onend = finish;
      utter.onerror = finish;
      // Chrome silently drops long utterances; a watchdog keeps the story moving
      this._timer = setTimeout(finish, this.#estimate(line.text) + 4000);
      this.synth.speak(utter);
    } catch (err) {
      this._timer = setTimeout(finish, this.#estimate(line.text));
    }
  }

  skip() {
    if (this.synth) this.synth.cancel();
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    const line = this.current;
    this.current = null;
    if (line?.resolve) line.resolve();
    if (this.queue.length) this.#next();
    else if (this.onSubtitle) this.onSubtitle(null);
  }

  clear() {
    if (this.synth) this.synth.cancel();
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    this.queue.forEach((l) => l.resolve && l.resolve());
    this.queue.length = 0;
    const line = this.current;
    this.current = null;
    if (line?.resolve) line.resolve();
    if (this.onSubtitle) this.onSubtitle(null);
  }
}
