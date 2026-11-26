// Local retrieval for Q&A: keyword/BM25-ish scoring over document chunks.
// No API call — the top 3-5 chunks are scored locally.

import type { PageText } from './types';

const STOP: Record<string, string[]> = {
  en: 'the a an and or of to in on for with is are was were be by at as it its this that these those under article court treaty'.split(' '),
  de: 'der die das und oder von zu in an auf mit ist sind war für artikel gerichtshof völkerrecht'.split(' '),
  fr: 'le la les et ou de à dans pour avec est sont article cour traité'.split(' '),
};

function tokens(text: string, lang: string): string[] {
  const stop = new Set(STOP[lang] ?? STOP.en);
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !stop.has(t));
}

export function retrieveRelevantPages(
  question: string,
  pages: PageText[],
  lang: string,
  topK = 4,
): { page: number; text: string; score: number }[] {
  const qTokens = tokens(question, lang);
  if (qTokens.length === 0) return [];
  const qSet = new Map<string, number>();
  for (const t of qTokens) qSet.set(t, (qSet.get(t) ?? 0) + 1);
  const scored = pages
    .map((p) => {
      const pTokens = tokens(p.text, lang);
      const tf = new Map<string, number>();
      for (const t of pTokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      let score = 0;
      for (const [term, qf] of qSet) {
        const f = tf.get(term);
        if (f) score += qf * f * (1 + Math.log(tf.size || 1)) / (1 + Math.log(pTokens.length || 1));
      }
      // small boost for pages containing question bigrams
      const ql = question.toLowerCase();
      for (let i = 0; i < qTokens.length - 1; i++) {
        const bigram = `${qTokens[i]} ${qTokens[i + 1]}`;
        if (ql.includes(bigram)) score += 2;
      }
      return { page: p.index, text: p.text, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
  return scored;
}
