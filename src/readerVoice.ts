// Sequential read-aloud player on top of the browser Web Speech API.
// A whole document is spoken as a queue of short utterances (see reader.ts);
// `boundary` events report the real spoken position inside each utterance,
// which drives the progress bar / "now reading page X" in the UI.

import type { Utterance } from './reader';

export interface ReaderProgress {
  chunkIndex: number; // 0-based index of the current utterance
  total: number;
  page: number; // 1-based page of the current utterance
  chunkFraction: number; // 0..1 inside the current utterance
  overall: number; // 0..1 across the whole document
}

export interface ReaderEvents {
  onProgress: (p: ReaderProgress) => void;
  onEnd: () => void;
}

export class ReaderVoice {
  private queue: Utterance[] = [];
  private index = 0;
  private generation = 0; // bumped on stop() so stale utterance events are ignored
  private playing = false;
  private paused = false;
  private lang: string;
  private rate: number;
  private voiceURI: string;
  private events: ReaderEvents;

  constructor(opts: { lang: string; rate: number; voiceURI: string; events: ReaderEvents }) {
    this.lang = opts.lang;
    this.rate = opts.rate;
    this.voiceURI = opts.voiceURI;
    this.events = opts.events;
  }

  setQueue(queue: Utterance[]) {
    this.stop();
    this.queue = queue;
  }

  setLang(lang: string) { this.lang = lang; }
  setRate(rate: number) { this.rate = rate; } // applies from the next utterance
  setVoice(voiceURI: string) { this.voiceURI = voiceURI; }
  isPlaying() { return this.playing; }
  isPaused() { return this.paused; }

  play() {
    if (typeof speechSynthesis === 'undefined' || !this.queue.length) return;
    if (this.playing && !this.paused) return;
    this.playing = true;
    this.paused = false;
    this.speakCurrent();
  }

  pause() {
    if (!this.playing || this.paused) return;
    speechSynthesis.pause();
    this.paused = true;
  }

  resume() {
    if (!this.playing || !this.paused) return;
    speechSynthesis.resume();
    this.paused = false;
  }

  stop() {
    this.generation++;
    this.playing = false;
    this.paused = false;
    this.index = 0;
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }

  private emit(chunk: Utterance, chunkFraction: number) {
    const total = this.queue.length;
    this.events.onProgress({
      chunkIndex: this.index,
      total,
      page: chunk.page,
      chunkFraction,
      overall: total ? (this.index + chunkFraction) / total : 1,
    });
  }

  private speakCurrent() {
    const gen = this.generation;
    const chunk = this.queue[this.index];
    if (!chunk) {
      this.playing = false;
      this.events.onEnd();
      return;
    }
    const u = new SpeechSynthesisUtterance(chunk.text);
    u.lang = this.lang;
    u.rate = this.rate;
    if (this.voiceURI) {
      const v = speechSynthesis.getVoices().find((vv) => vv.voiceURI === this.voiceURI);
      if (v) u.voice = v;
    }
    u.onboundary = (e) => {
      if (gen !== this.generation) return;
      const frac = Math.min(1, (e.charIndex + (e.charLength ?? 0)) / Math.max(1, chunk.text.length));
      this.emit(chunk, frac);
    };
    u.onend = () => {
      if (gen !== this.generation) return;
      this.advance();
    };
    u.onerror = (e) => {
      if (gen !== this.generation) return;
      if (e.error === 'canceled' || e.error === 'interrupted') return; // our own cancel()
      this.advance(); // one bad chunk must not stall the whole reading
    };
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    this.emit(chunk, 0);
  }

  private advance() {
    const gen = this.generation;
    this.index++;
    if (this.index >= this.queue.length) {
      this.playing = false;
      this.paused = false;
      this.events.onEnd();
      return;
    }
    // small gap so the next speak() is not dropped right after a cancel()
    setTimeout(() => {
      if (gen === this.generation && this.playing) this.speakCurrent();
    }, 40);
  }
}
