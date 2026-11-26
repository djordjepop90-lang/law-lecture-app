// Voiceover via the browser Web Speech API (fully local, no API).
// speechSynthesis utterances emit `boundary` events with charIndex, which the
// player uses to sync scene animations and citation highlighting to the REAL
// spoken position. Scene duration is estimated from word count and speech
// rate; there is no network call, so nothing is cached as audio blobs.

import { TIMING } from './config';
import type { Scene } from './types';
import { wordCount } from './textutil';

export interface SystemVoice {
  name: string;
  lang: string;
  voiceURI: string;
  localService: boolean;
  isDefault: boolean;
}

export function getSystemVoices(): SystemVoice[] {
  if (typeof speechSynthesis === 'undefined') return [];
  return speechSynthesis.getVoices().map((v) => ({
    name: v.name,
    lang: v.lang,
    voiceURI: v.voiceURI,
    localService: v.localService,
    isDefault: v.default,
  }));
}

export function defaultVoiceForLang(lang: string): SystemVoice | null {
  const voices = getSystemVoices();
  if (!voices.length) return null;
  const prefix = lang === 'de' ? 'de' : lang === 'fr' ? 'fr' : 'en';
  return voices.find((v) => v.lang.toLowerCase().startsWith(prefix)) ?? voices[0];
}

export function langTag(lang: string): string {
  return lang === 'de' ? 'de-DE' : lang === 'fr' ? 'fr-FR' : 'en-US';
}

// Estimated spoken duration of a scene (seconds) at the given rate.
export function estimateSceneDuration(scene: Scene, rate = 1): number {
  return Math.max(6, wordCount(scene.narration) / TIMING.wordsPerSecond / rate);
}

export interface SpeakHandle {
  utterance: SpeechSynthesisUtterance;
  cancel: () => void;
}

// Speak a scene. onProgress receives 0..1 from real boundary events
// (charIndex / narration length), falling back to a timer if the browser
// does not emit boundary events.
export function speakScene(
  scene: Scene,
  voice: SystemVoice | null,
  lang: string,
  rate: number,
  onProgress: (p: number) => void,
  onEnd: () => void,
): SpeakHandle {
  const u = new SpeechSynthesisUtterance(scene.narration);
  u.lang = langTag(lang);
  u.rate = rate;
  if (voice) u.voice = speechSynthesis.getVoices().find((v) => v.voiceURI === voice.voiceURI) ?? null;
  let gotBoundary = false;
  u.onboundary = (e) => {
    gotBoundary = true;
    onProgress(Math.min(1, (e.charIndex + (e.charLength ?? 0)) / Math.max(1, scene.narration.length)));
  };
  u.onend = () => onEnd();
  u.onerror = () => onEnd();
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
  // fallback timer in case the browser never fires boundary events
  const est = estimateSceneDuration(scene, rate);
  const t0 = performance.now();
  const iv = setInterval(() => {
    if (gotBoundary) { clearInterval(iv); return; }
    onProgress(Math.min(1, ((performance.now() - t0) / 1000) / est));
  }, 120);
  return {
    utterance: u,
    cancel: () => { clearInterval(iv); speechSynthesis.cancel(); },
  };
}

export function pauseSpeech() { speechSynthesis.pause(); }
export function resumeSpeech() { speechSynthesis.resume(); }
export function stopSpeech() { speechSynthesis.cancel(); }
