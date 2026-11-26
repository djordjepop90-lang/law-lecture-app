// Chapter detection from headings / numbering patterns / slide titles.
// Falls back to fixed-size chunks (~6-8 pages or ~6000 words).

import type { Chapter, PageText } from './types';
import { wordCount } from './textutil';

const HEADING_PATTERNS = [
  /^\s*(chapter|kapitel|chapitre)\s+[0-9ivxlcdm]+\b/i,
  /^\s*§\s*\d+[a-z]?\b/,
  /^\s*\d+(\.\d+)*\s+[A-ZÀ-Þ][\wÀ-ÿ'’\- ]{3,60}\s*$/,
  /^\s*[IVXLC]+\.\s+\S/,
  /^\s*[A-Z]\.\s+\S/,
  /^\s*part\s+[0-9ivxlcdm]+\b/i,
  /^\s*teil\s+[0-9ivxlcdm]+\b/i,
  /^\s*titre\s+[0-9ivxlcdm]+\b/i,
];

export function looksLikeHeading(text: string): boolean {
  const t = text.trim();
  if (t.length < 3 || t.length > 90) return false;
  if (wordCount(t) > 12) return false;
  return HEADING_PATTERNS.some((re) => re.test(t));
}

export function detectChapters(pages: PageText[], kind: 'pdf' | 'pptx'): Chapter[] {
  const chapters: Chapter[] = [];
  const headingPages: { index: number; title: string }[] = [];
  for (const p of pages) {
    const firstLine = p.text.split(/[.!?]\s/)[0]?.slice(0, 90) ?? '';
    if (looksLikeHeading(firstLine)) {
      headingPages.push({ index: p.index, title: firstLine.trim().replace(/\s+/g, ' ') });
    }
  }
  // For PPTX, treat every slide with a short first line as a potential chapter start too.
  if (kind === 'pptx' && headingPages.length < 2) {
    for (const p of pages) {
      const firstLine = p.text.split(/[.!?]\s/)[0]?.slice(0, 90) ?? '';
      if (firstLine.trim().length >= 3 && firstLine.trim().length <= 60 && wordCount(firstLine) <= 8) {
        if (!headingPages.some((h) => h.index === p.index)) {
          headingPages.push({ index: p.index, title: firstLine.trim() });
        }
      }
    }
    headingPages.sort((a, b) => a.index - b.index);
  }

  if (headingPages.length >= 2) {
    for (let i = 0; i < headingPages.length; i++) {
      const start = headingPages[i].index;
      const end = i + 1 < headingPages.length ? headingPages[i + 1].index - 1 : pages[pages.length - 1].index;
      const text = pages.filter((p) => p.index >= start && p.index <= end).map((p) => p.text).join(' ');
      chapters.push({
        id: `ch-${start}`,
        title: headingPages[i].title,
        pageStart: start,
        pageEnd: end,
        wordCount: wordCount(text),
      });
    }
  } else {
    // Fallback chunking: ~6-8 pages or ~6000 words per chunk, whichever first.
    const targetPages = 7;
    const targetWords = 6000;
    let i = 0;
    let chunkIdx = 1;
    while (i < pages.length) {
      let end = Math.min(i + targetPages, pages.length - 1);
      let words = 0;
      for (let j = i; j <= end; j++) {
        words += pages[j].wordCount;
        if (words >= targetWords) { end = j; break; }
      }
      const text = pages.slice(i, end + 1).map((p) => p.text).join(' ');
      const firstLine = pages[i].text.split(/[.!?]\s/)[0]?.slice(0, 80).trim() || `Pages ${pages[i].index}-${pages[end].index}`;
      chapters.push({
        id: `ch-${pages[i].index}`,
        title: `Chunk ${chunkIdx}: ${firstLine.slice(0, 50)}`,
        pageStart: pages[i].index,
        pageEnd: pages[end].index,
        wordCount: wordCount(text),
      });
      i = end + 1;
      chunkIdx++;
    }
  }
  return chapters;
}

export function pagesText(pages: PageText[], start: number, end: number): string {
  return pages
    .filter((p) => p.index >= start && p.index <= end)
    .map((p) => `[Page ${p.index}] ${p.text}`)
    .join('\n\n');
}

export interface Estimate {
  chapters: number;
  apiCalls: number; // outlines + storyboards + approx scenes for TTS
  scenes: number; // rough estimate: 7 per chapter
  estimatedMinutes: number;
}

export function estimateSelection(chapterCount: number): Estimate {
  const scenes = chapterCount * 7;
  // 1 outline + 1 storyboard + scenes(TTS, lazy) per chapter
  const apiCalls = chapterCount * 2 + scenes;
  // Rough: text call ~20s, TTS ~25s incl. 5s gap; slow-mode risk noted in UI.
  const estimatedMinutes = Math.ceil((chapterCount * 2 * 20 + scenes * 25) / 60);
  return { chapters: chapterCount, apiCalls, scenes, estimatedMinutes };
}
