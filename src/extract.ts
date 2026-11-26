// Local, in-browser extraction. No Gemini call happens here.
// PDF via pdfjs-dist, PPTX via jszip parsing ppt/slides/slideN.xml text runs in
// slide order, plus speaker notes when present.

import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import JSZip from 'jszip';
import type { PageText, SourceDocument, LanguageCode } from './types';
import { wordCount, detectLanguage } from './textutil';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export { wordCount, detectLanguage };

export async function extractPdf(file: File): Promise<PageText[]> {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages: PageText[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    pages.push({ index: i, text, wordCount: wordCount(text) });
  }
  return pages;
}

function xmlText(xml: string): string {
  // Collect text inside <a:t> runs (DrawingML) and <a:t> in notes too.
  const runs: string[] = [];
  const re = /<a:t>([\s\S]*?)<\/a:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    runs.push(m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
  }
  return runs.join(' ').replace(/\s+/g, ' ').trim();
}

function slideParagraphs(xml: string): string[] {
  const paras: string[] = [];
  const pRe = /<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g;
  let m: RegExpExecArray | null;
  while ((m = pRe.exec(xml)) !== null) {
    const t = xmlText(m[1]);
    if (t) paras.push(t);
  }
  return paras;
}

export async function extractPptx(file: File): Promise<PageText[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)\.xml/)![1], 10);
      const nb = parseInt(b.match(/slide(\d+)\.xml/)![1], 10);
      return na - nb;
    });
  const pages: PageText[] = [];
  for (let i = 0; i < slideNames.length; i++) {
    const xml = await zip.file(slideNames[i])!.async('string');
    const paras = slideParagraphs(xml);
    let text = paras.join(' ');
    // Speaker notes, if present: ppt/notesSlides/notesSlideN.xml
    const notesName = `ppt/notesSlides/notesSlide${i + 1}.xml`;
    if (zip.file(notesName)) {
      const notesXml = await zip.file(notesName)!.async('string');
      const notes = xmlText(notesXml);
      if (notes) text = (text + ' ' + notes).trim();
    }
    pages.push({
      index: i + 1,
      text,
      wordCount: wordCount(text),
      title: paras[0],
      bullets: paras.slice(1),
    });
  }
  return pages;
}

export async function extractDocument(file: File): Promise<Omit<SourceDocument, 'id' | 'uploadedAt' | 'scanned' | 'language'> & { scanned: boolean; language: LanguageCode | 'unknown' }> {
  const kind = file.name.toLowerCase().endsWith('.pptx') ? 'pptx' : 'pdf';
  const pages = kind === 'pptx' ? await extractPptx(file) : await extractPdf(file);
  const totalWords = pages.reduce((a, p) => a + p.wordCount, 0);
  // Scanned PDF heuristic: almost no text across the whole document.
  const scanned = totalWords < Math.max(50, pages.length * 10);
  const allText = pages.map((p) => p.text).join(' ');
  return {
    name: file.name,
    kind,
    pages,
    totalWords,
    scanned,
    language: detectLanguage(allText),
  };
}


