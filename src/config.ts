// Single place for all engine/timing constants.
// The app runs fully locally: a rule-based lecture engine (src/engine.ts)
// for outlines/storyboards/Q&A and the browser Web Speech API for voice.
// No external API, no API key.

export const ENGINE = {
  name: 'Local rule-based engine + Web Speech API',
  text: 'local-extractive',
  voice: 'speechSynthesis',
} as const;

export const TIMING = {
  // Queue lanes keep generation sequential and the UI responsive.
  textMinGapSeconds: 0.2,
  voiceMinGapSeconds: 0.2,
  // Slow mode multiplies all pacing delays.
  slowModeMultiplier: 2,
  // Estimated speech pace used for scene durations / timeline (words per second at rate 1).
  wordsPerSecond: 2.6,
} as const;

export const DEFAULT_SPEECH_RATE = 1;

export const APP_NAME = 'International Law Video Lecture Generator';
