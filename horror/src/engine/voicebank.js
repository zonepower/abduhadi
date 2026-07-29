// ---------------------------------------------------------------------------
// بنك الأصوات — plays the pre-recorded neural-TTS dialogue clips.
//
// Clips are stored base64 in voicebank-data.js and decoded lazily on first
// use, then cached as AudioBuffers. Playback runs through the dialogue bus
// (so sfx ducking applies) plus the room's convolution reverb, with a heavier
// send for the villain so he always sounds like the building itself.
// ---------------------------------------------------------------------------

export class VoiceBank {
  constructor(audio, data) {
    this.audio = audio;
    this.data = data || {};
    this.buffers = new Map();
    this.count = Object.keys(this.data).length;
  }

  has(who, text) {
    return Boolean(this.data[`${who}|${text}`]);
  }

  async #buffer(key) {
    if (this.buffers.has(key)) return this.buffers.get(key);
    const b64 = this.data[key];
    if (!b64 || !this.audio.ready) return null;
    try {
      const raw = atob(b64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
      const buffer = await this.audio.ctx.decodeAudioData(bytes.buffer);
      this.buffers.set(key, buffer);
      return buffer;
    } catch (err) {
      // corrupt / undecodable clip: remember the miss so we fall back to TTS
      this.buffers.set(key, null);
      return null;
    }
  }

  /**
   * Plays one clause. Resolves `true` when the clip finished, `false` when it
   * could not be played (caller falls back to TTS / murmur).
   */
  async play(who, text, { rate = 1 } = {}) {
    if (!this.audio.ready) return false;
    const key = `${who}|${text}`;
    const buffer = await this.#buffer(key);
    if (!buffer) return false;

    const ctx = this.audio.ctx;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;

    const gain = ctx.createGain();
    gain.gain.value = (this.audio.volumes.voice ?? 1) * (who === 'narrator' ? 0.9 : 1);
    source.connect(gain).connect(this.audio.voiceBus || this.audio.master);

    if (this.audio.reverbSend) {
      const send = ctx.createGain();
      send.gain.value = who === 'shepherd' ? 0.85 : 0.3;
      gain.connect(send).connect(this.audio.reverbSend);
    }

    this.current = source;
    return new Promise((resolvePlay) => {
      let settled = false;
      const finish = (played) => {
        if (settled) return;
        settled = true;
        if (this.current === source) this.current = null;
        resolvePlay(played);
      };
      source.onended = () => finish(true);
      // watchdog in case onended never fires (context suspended mid-clip)
      setTimeout(() => finish(true), (buffer.duration / rate) * 1000 + 1500);
      try {
        source.start();
      } catch (err) {
        finish(false);
      }
    });
  }

  stop() {
    if (this.current) {
      try { this.current.stop(); } catch (err) { /* already stopped */ }
      this.current = null;
    }
  }
}
