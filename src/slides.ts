// Renders the ORIGINAL document pages/slides to canvases, used as the
// animated background of each scene in the player and in the exported video.
// PDF: real page raster via pdfjs-dist. PPTX: faithful replica built from the
// slide's own paragraphs (title + bullets) with our own drawing code.

import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PageText, Scene, SourceDocument } from './types';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export const SLIDE_W = 1280;
export const SLIDE_H = 720;

let pdfBytes: ArrayBuffer | null = null;
let pdfDoc: Promise<pdfjsLib.PDFDocumentProxy> | null = null;

export async function initSource(doc: SourceDocument, blob: Blob): Promise<void> {
  if (doc.kind === 'pdf') {
    pdfBytes = await blob.arrayBuffer();
    pdfDoc = pdfjsLib.getDocument({ data: pdfBytes }).promise;
  }
}

export async function renderPdfPage(pageIndex: number): Promise<HTMLCanvasElement | null> {
  if (!pdfDoc) return null;
  try {
    const pdf = await pdfDoc;
    const page = await pdf.getPage(Math.min(Math.max(1, pageIndex), pdf.numPages));
    const base = page.getViewport({ scale: 1 });
    const scale = Math.max(SLIDE_W / base.width, SLIDE_H / base.height);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = SLIDE_W; canvas.height = SLIDE_H;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);
    await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: ctx, viewport }).promise;
    // center-crop into 1280x720
    const out = document.createElement('canvas');
    out.width = SLIDE_W; out.height = SLIDE_H;
    const octx = out.getContext('2d')!;
    octx.drawImage(canvas, 0, 0);
    return out;
  } catch {
    return null;
  }
}

// PPTX replica: white slide, accent title bar, bullets — from the slide's own text.
export function renderSlideReplica(page: PageText): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SLIDE_W; canvas.height = SLIDE_H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fbfaf7';
  ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);
  ctx.fillStyle = '#1d3a6e';
  ctx.fillRect(0, 0, SLIDE_W, 110);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 44px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  wrap(ctx, page.title ?? `Slide ${page.index}`, 64, 55, SLIDE_W - 128, 52).slice(0, 2)
    .forEach((l, i) => ctx.fillText(l, 64, 55 + (i - 0.5) * 52));
  ctx.fillStyle = '#232a38';
  ctx.font = '400 28px "Segoe UI", Arial, sans-serif';
  let y = 170;
  for (const b of (page.bullets ?? []).slice(0, 12)) {
    ctx.fillStyle = '#1d3a6e';
    ctx.beginPath(); ctx.arc(70, y + 10, 7, 0, Math.PI * 2); ctx.fill();
    const lines = wrap(ctx, b, 100, y, SLIDE_W - 160, 38);
    lines.slice(0, 3).forEach((l, i) => { ctx.fillStyle = '#232a38'; ctx.fillText(l, 100, y + i * 38); });
    y += Math.min(3, lines.length) * 38 + 18;
    if (y > SLIDE_H - 40) break;
  }
  ctx.fillStyle = '#8a8f9c';
  ctx.font = '400 20px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`Slide ${page.index}`, SLIDE_W - 40, SLIDE_H - 28);
  return canvas;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

// Background for a scene: the first source page of the scene.
export async function getSceneBackground(doc: SourceDocument, scene: Scene): Promise<HTMLCanvasElement | null> {
  const pageIndex = scene.sourcePages[0] ?? doc.pages[0]?.index ?? 1;
  if (doc.kind === 'pdf') return renderPdfPage(pageIndex);
  const page = doc.pages.find((p) => p.index === pageIndex) ?? doc.pages[0];
  return page ? renderSlideReplica(page) : null;
}
