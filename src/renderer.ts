// Scene renderer: draws a 1280x720 academic slide on a 2D canvas.
// Animations are driven by `progress` (0..1), which the player derives from
// the REAL audio time, so reveals stay in sync with the narration. The
// TREATY_DIAGRAM layout is built as an SVG string with our own layered layout
// code (no external libraries) and rasterized onto the canvas.

import type { Scene, LayoutType } from './types';

export const W = 1280;
export const H = 720;

export interface Theme {
  bg: string;
  panel: string;
  panelBorder: string;
  text: string;
  muted: string;
  accent: string;
  accent2: string;
  good: string;
  warn: string;
  captionBg: string;
}

export const THEMES: Record<'dark' | 'light', Theme> = {
  dark: {
    bg: '#0f1420', panel: '#182034', panelBorder: '#2c3a5c', text: '#e8ecf6',
    muted: '#9aa7c4', accent: '#7aa2ff', accent2: '#e0b34f', good: '#5fd39a', warn: '#ff8f6b',
    captionBg: 'rgba(10,14,24,0.82)',
  },
  light: {
    bg: '#f7f5ef', panel: '#ffffff', panelBorder: '#d8d2c2', text: '#1d2433',
    muted: '#5c6577', accent: '#2b5bd7', accent2: '#a06a00', good: '#0d8a52', warn: '#c2410c',
    captionBg: 'rgba(255,255,255,0.85)',
  },
};

const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function drawText(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number,
  font: string, color: string, lineHeight: number, maxLines = 99,
): number {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const lines = wrapText(ctx, text, maxWidth).slice(0, maxLines);
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
  return y + lines.length * lineHeight;
}

function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Map citations to proportional word positions in the narration so they
// highlight at approximately the moment they are spoken.
export function citationPositions(scene: Scene): { citation: string; pos: number }[] {
  const words = scene.narration.toLowerCase().split(/\s+/);
  const total = Math.max(1, words.length);
  return scene.citations.map((c) => {
    const keys = c.toLowerCase().split(/[^\p{L}\p{N}(]+/u).filter((k) => k.length >= 4);
    let best = 1; // default: highlight near the end
    for (const k of keys) {
      const idx = words.findIndex((w) => w.includes(k.slice(0, Math.min(6, k.length))));
      if (idx >= 0) { best = (idx + 1) / total; break; }
    }
    return { citation: c, pos: best };
  });
}

export function currentCaption(scene: Scene, progress: number): string {
  const words = scene.narration.split(/\s+/);
  const idx = Math.min(words.length - 1, Math.floor(progress * words.length));
  // walk back to sentence start
  let start = 0;
  const joined = words.slice(0, idx + 1).join(' ');
  const lastBreak = Math.max(joined.lastIndexOf('. '), joined.lastIndexOf('! '), joined.lastIndexOf('? '), joined.lastIndexOf('; '));
  if (lastBreak > 0) start = lastBreak + 2;
  return words.slice(start, idx + 1).join(' ');
}

// --- TREATY_DIAGRAM: own SVG layered layout ----------------------------------

function treatySvg(scene: Scene, t: Theme, progress: number): string {
  const d = scene.layoutData as { nodes: { id: string; label: string; kind: string }[]; edges: { from: string; to: string; label: string }[] };
  const nodes = d.nodes ?? [];
  const edges = d.edges ?? [];
  const layers: Record<string, typeof nodes> = { norm: [], obligation: [], exception: [] };
  for (const n of nodes) (layers[n.kind] ?? layers.norm).push(n);
  const layerOrder = ['norm', 'obligation', 'exception'];
  const layerY: Record<string, number> = { norm: 90, obligation: 300, exception: 510 };
  const pos = new Map<string, { x: number; y: number }>();
  const layerW = 1080;
  layerOrder.forEach((k) => {
    const arr = layers[k];
    arr.forEach((n, i) => {
      pos.set(n.id, { x: 120 + (layerW / Math.max(1, arr.length - 1 || 1)) * i + (arr.length === 1 ? layerW / 2 : 0), y: layerY[k] });
    });
  });
  const nodeR = 78;
  const fillFor = (kind: string) => kind === 'norm' ? t.accent : kind === 'obligation' ? t.accent2 : t.warn;
  const visibleNodes = Math.floor(progress * (nodes.length + 1));
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="1160" height="620" viewBox="0 0 1160 620" font-family="${SANS}">`;
  s += `<rect width="1160" height="620" fill="none"/>`;
  edges.forEach((e, i) => {
    const a = pos.get(e.from); const b = pos.get(e.to);
    if (!a || !b) return;
    if (i >= visibleNodes) return;
    s += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${t.muted}" stroke-width="2" marker-end="url(#arr)"/>`;
    if (e.label) s += `<text x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 - 8}" fill="${t.muted}" font-size="15" text-anchor="middle">${esc(e.label)}</text>`;
  });
  s += `<defs><marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="${t.muted}"/></marker></defs>`;
  nodes.forEach((n, i) => {
    if (i >= visibleNodes) return;
    const p = pos.get(n.id)!;
    s += `<circle cx="${p.x}" cy="${p.y}" r="${nodeR}" fill="${alpha(fillFor(n.kind), 0.18)}" stroke="${fillFor(n.kind)}" stroke-width="2.5"/>`;
    const words = n.label.split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (test.length > 16 && line) { lines.push(line); line = w; } else line = test;
    }
    if (line) lines.push(line);
    lines.slice(0, 4).forEach((l, li) => {
      s += `<text x="${p.x}" y="${p.y - (lines.length - 1) * 9 + li * 18}" fill="${t.text}" font-size="16" font-weight="600" text-anchor="middle">${esc(l)}</text>`;
    });
  });
  s += '</svg>';
  return s;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function drawSvgOnCanvas(ctx: CanvasRenderingContext2D, svg: string, x: number, y: number, w: number, h: number): Promise<void> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => resolve(null); // never let a bad SVG kill the render loop
      im.src = url;
    });
    if (img) ctx.drawImage(img, x, y, w, h);
    else {
      ctx.fillStyle = '#888';
      ctx.font = '20px sans-serif';
      ctx.fillText('(diagram could not be rendered)', x + 20, y + 40);
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

// --- main entry ---------------------------------------------------------------

export interface RenderOptions {
  theme: 'dark' | 'light';
  progress: number; // 0..1 within the scene, from real audio time
  showCaptions: boolean;
  chapterLabel: string;
  sceneIndex: number;
  sceneCount: number;
  timeSeconds: number; // absolute time in scene, for subtle motion
}

export async function renderScene(ctx: CanvasRenderingContext2D, scene: Scene, o: RenderOptions): Promise<void> {
  const t = THEMES[o.theme];
  const p = Math.min(1, Math.max(0, o.progress));
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, W, H);

  // header
  ctx.fillStyle = t.muted;
  ctx.font = `600 20px ${SANS}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(o.chapterLabel.toUpperCase(), 48, 30);
  ctx.textAlign = 'right';
  ctx.fillText(`Scene ${o.sceneIndex + 1} / ${o.sceneCount}`, W - 48, 30);
  ctx.textAlign = 'left';
  ctx.fillStyle = t.text;
  ctx.font = `700 40px ${SERIF}`;
  drawText(ctx, scene.title, 48, 62, W - 96, `700 40px ${SERIF}`, t.text, 46, 2);
  ctx.strokeStyle = t.accent;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(48, 128); ctx.lineTo(148, 128); ctx.stroke();

  const bodyTop = 150;
  const bodyH = H - bodyTop - 120;
  const reveal = (i: number, n: number) => Math.min(1, Math.max(0, p * (n + 0.6) - i));

  if (scene.layoutType === 'LEGAL_TEST') {
    const d = scene.layoutData as { steps: { label: string; criterion: string; burdenOfProof?: string; authority?: string }[] };
    const steps = d.steps ?? [];
    const cardH = Math.min(120, (bodyH - 16) / Math.max(1, steps.length) - 12);
    steps.forEach((s, i) => {
      const a = reveal(i, steps.length);
      if (a <= 0) return;
      const y = bodyTop + i * (cardH + 12);
      ctx.globalAlpha = a;
      ctx.fillStyle = t.panel;
      ctx.strokeStyle = t.panelBorder;
      roundRect(ctx, 48, y, W - 96, cardH, 10);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = t.accent;
      ctx.beginPath(); ctx.arc(88, y + cardH / 2, 22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = t.bg;
      ctx.font = `700 22px ${SANS}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), 88, y + cardH / 2 + 1);
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillStyle = t.text;
      ctx.font = `700 24px ${SANS}`;
      ctx.fillText(s.label, 128, y + 12);
      let yy = drawText(ctx, s.criterion, 128, y + 44, W - 260, `400 20px ${SANS}`, t.muted, 26, 2);
      const extra = [s.burdenOfProof ? `Burden of proof: ${s.burdenOfProof}` : '', s.authority ? `Authority: ${s.authority}` : ''].filter(Boolean).join('  ·  ');
      if (extra) drawText(ctx, extra, 128, Math.min(yy, y + cardH - 26), W - 260, `italic 600 17px ${SANS}`, t.accent2, 22, 1);
      ctx.globalAlpha = 1;
    });
  } else if (scene.layoutType === 'CASE_COMPARISON') {
    const d = scene.layoutData as { cases: { name: string; court: string; year: string; parties: string; facts: string; issue: string; holding: string; ratio: string }[] };
    const cases = d.cases ?? [];
    const cw = (W - 96 - (cases.length - 1) * 20) / Math.max(1, cases.length);
    cases.forEach((c, i) => {
      const a = reveal(i, cases.length);
      if (a <= 0) return;
      const x = 48 + i * (cw + 20);
      ctx.globalAlpha = a;
      ctx.fillStyle = t.panel;
      ctx.strokeStyle = t.panelBorder;
      roundRect(ctx, x, bodyTop, cw, bodyH, 12);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = t.accent;
      ctx.fillRect(x, bodyTop, cw, 6);
      let yy = bodyTop + 18;
      ctx.fillStyle = t.text;
      ctx.font = `700 24px ${SERIF}`;
      yy = drawText(ctx, c.name, x + 20, yy, cw - 40, `700 24px ${SERIF}`, t.text, 30, 2);
      yy = drawText(ctx, `${c.court} · ${c.year}`, x + 20, yy + 2, cw - 40, `600 18px ${SANS}`, t.accent2, 24, 1);
      const fields: [string, string][] = [
        ['Parties', c.parties], ['Facts', c.facts], ['Issue', c.issue], ['Holding', c.holding], ['Ratio', c.ratio],
      ];
      for (const [k, v] of fields) {
        if (!v) continue;
        ctx.fillStyle = t.muted;
        ctx.font = `700 15px ${SANS}`;
        ctx.fillText(k.toUpperCase(), x + 20, yy + 6);
        yy = drawText(ctx, v, x + 20, yy + 26, cw - 40, `400 17px ${SANS}`, t.text, 22, 3) + 8;
        if (yy > bodyTop + bodyH - 30) break;
      }
      ctx.globalAlpha = 1;
    });
  } else if (scene.layoutType === 'TREATY_DIAGRAM') {
    await drawSvgOnCanvas(ctx, treatySvg(scene, t, p), 60, bodyTop - 10, W - 120, bodyH + 20);
  } else {
    // KEY_TAKEAWAYS
    const d = scene.layoutData as { takeaways: string[]; examTraps: { trap: string; correction: string }[] };
    const takeaways = d.takeaways ?? [];
    const traps = d.examTraps ?? [];
    const leftW = (W - 96) * 0.55 - 10;
    const rightX = 48 + leftW + 20;
    const rightW = W - 48 - rightX;
    ctx.fillStyle = t.text;
    ctx.font = `700 24px ${SANS}`;
    ctx.fillText('KEY TAKEAWAYS', 48, bodyTop);
    let yy = bodyTop + 40;
    takeaways.forEach((tk, i) => {
      const a = reveal(i, takeaways.length);
      if (a <= 0) return;
      ctx.globalAlpha = a;
      ctx.fillStyle = t.good;
      ctx.beginPath(); ctx.arc(62, yy + 12, 8, 0, Math.PI * 2); ctx.fill();
      yy = drawText(ctx, tk, 82, yy, leftW - 40, `500 21px ${SANS}`, t.text, 28, 3) + 12;
      ctx.globalAlpha = 1;
    });
    ctx.fillStyle = t.warn;
    ctx.font = `700 24px ${SANS}`;
    ctx.fillText('EXAM TRAPS', rightX, bodyTop);
    yy = bodyTop + 40;
    traps.forEach((tr, i) => {
      const a = reveal(i + takeaways.length, traps.length + takeaways.length);
      if (a <= 0) return;
      ctx.globalAlpha = a;
      ctx.fillStyle = t.panel;
      ctx.strokeStyle = t.panelBorder;
      const lines = wrapText(ctx, `✗ ${tr.trap}`, rightW - 32).length + wrapText(ctx, `✓ ${tr.correction}`, rightW - 32).length;
      const hh = 34 + lines * 24;
      roundRect(ctx, rightX, yy, rightW, hh, 10);
      ctx.fill(); ctx.stroke();
      ctx.font = `600 18px ${SANS}`;
      let ty = drawText(ctx, `✗ ${tr.trap}`, rightX + 16, yy + 12, rightW - 32, `600 18px ${SANS}`, t.warn, 24, 2);
      drawText(ctx, `✓ ${tr.correction}`, rightX + 16, ty + 2, rightW - 32, `400 18px ${SANS}`, t.good, 24, 2);
      yy += hh + 12;
      ctx.globalAlpha = 1;
    });
  }

  // citations bar: highlight the citation whose proportional word position
  // has been reached in the narration
  const cites = citationPositions(scene);
  const activeIdx = cites.reduce((acc, c, i) => (c.pos <= p + 0.02 ? i : acc), -1);
  const barY = H - 92;
  ctx.fillStyle = t.panel;
  roundRect(ctx, 48, barY, W - 96, 52, 10);
  ctx.fill();
  ctx.font = `600 17px ${SANS}`;
  let cx = 64;
  const cy = barY + 26;
  cites.forEach((c, i) => {
    const label = `⚖ ${c.citation}`;
    const w = ctx.measureText(label).width + 28;
    if (cx + w > W - 60) return;
    if (i === activeIdx) {
      ctx.fillStyle = alpha(t.accent, 0.25);
      roundRect(ctx, cx - 10, barY + 8, w, 36, 8);
      ctx.fill();
      ctx.fillStyle = t.accent;
    } else ctx.fillStyle = t.muted;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy);
    cx += w + 8;
  });

  // captions
  if (o.showCaptions) {
    const cap = currentCaption(scene, p);
    ctx.font = `500 22px ${SANS}`;
    const lines = wrapText(ctx, cap, W - 160).slice(0, 2);
    const ch = lines.length * 30 + 20;
    ctx.fillStyle = t.captionBg;
    roundRect(ctx, 60, H - 40 - ch, W - 120, ch, 10);
    ctx.fill();
    ctx.fillStyle = t.text;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, W / 2, H - 40 - ch / 2 + (i - (lines.length - 1) / 2) * 30));
    ctx.textAlign = 'left';
  }

  // progress bar
  ctx.fillStyle = t.panelBorder;
  ctx.fillRect(48, H - 18, W - 96, 4);
  ctx.fillStyle = t.accent;
  ctx.fillRect(48, H - 18, (W - 96) * p, 4);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export type { LayoutType };
