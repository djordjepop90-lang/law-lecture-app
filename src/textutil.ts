// Pure text helpers (no DOM / no pdfjs) so they can be unit-tested in Node.

import type { LanguageCode } from './types';

export function wordCount(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

// Simple stopword heuristic for English / German / French.
export function detectLanguage(text: string): LanguageCode | 'unknown' {
  const sample = text.toLowerCase().slice(0, 20000);
  const scores: Record<LanguageCode, number> = { en: 0, de: 0, fr: 0 };
  const stop: Record<LanguageCode, string[]> = {
    en: [' the ', ' and ', ' of ', ' to ', ' in ', ' is ', ' that ', ' for ', ' with ', ' article ', ' court '],
    de: [' der ', ' die ', ' und ', ' das ', ' ist ', ' von ', ' zu ', ' mit ', ' artikel ', ' gerichtshof ', ' auf '],
    fr: [' le ', ' la ', ' les ', ' et ', ' des ', ' est ', ' pour ', ' dans ', ' une ', ' article ', ' cour '],
  };
  for (const lang of Object.keys(stop) as LanguageCode[]) {
    for (const w of stop[lang]) if (sample.includes(w)) scores[lang]++;
  }
  const best = (Object.keys(scores) as LanguageCode[]).reduce((a, b) => (scores[a] >= scores[b] ? a : b));
  const total = scores.en + scores.de + scores.fr;
  if (total < 5) return 'unknown';
  return scores[best] >= total * 0.5 ? best : 'unknown';
}
