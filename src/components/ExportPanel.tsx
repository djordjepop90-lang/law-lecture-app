import React, { useState } from 'react';
import type { Storyboard } from '../types';
import { estimateSceneDuration } from '../audio';
import { renderScene, W, H } from '../renderer';

interface Props {
  storyboard: Storyboard;
  chapterLabel: string;
  theme: 'dark' | 'light';
}

function pickMime(): string {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4', // only if this browser's MediaRecorder supports mp4
  ];
  return candidates.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? 'video/webm';
}

// Export one chapter: canvas.captureStream(30) recorded with MediaRecorder,
// rendered in real time through every scene at its estimated spoken duration.
// The narration itself is spoken live by the browser (speechSynthesis) during
// playback; browser speech output cannot be captured into a media file, so
// the export contains the fully animated video with burned-in captions.
const ExportPanel: React.FC<Props> = ({ storyboard, chapterLabel, theme }) => {
  const [progress, setProgress] = useState('');
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const exportChapter = async () => {
    setError(''); setLink('');
    try {
      setBusy(true);
      const mime = pickMime();
      const isMp4 = mime.includes('mp4');
      setProgress(`Recording (${isMp4 ? 'mp4' : 'webm'})…`);
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d')!;
      const stream = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5_000_000 });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      const done = new Promise<Blob>((resolve) => { recorder.onstop = () => resolve(new Blob(chunks, { type: mime })); });
      recorder.start(250);

      const durations = storyboard.scenes.map((s) => estimateSceneDuration(s, 1));
      const total = durations.reduce((a, b) => a + b, 0);
      const t0 = performance.now();
      await new Promise<void>((resolve) => {
        // Timer-driven loop (not rAF) so a hidden/throttled tab cannot stall
        // the export; every frame is exception-proof so one bad scene can
        // never freeze the whole export.
        const iv = setInterval(() => {
          void (async () => {
            try {
              const elapsed = (performance.now() - t0) / 1000;
              const p = Math.min(1, elapsed / total);
              let si = 0, acc = 0;
              for (let i = 0; i < durations.length; i++) { if (elapsed >= acc) { si = i; } acc += durations[i]; }
              const sceneStart = durations.slice(0, si).reduce((a, b) => a + b, 0);
              const sceneProgress = Math.min(1, Math.max(0, (elapsed - sceneStart) / Math.max(0.001, durations[si])));
              await renderScene(ctx, storyboard.scenes[si], {
                theme, progress: sceneProgress, showCaptions: true, chapterLabel,
                sceneIndex: si, sceneCount: storyboard.scenes.length, timeSeconds: elapsed,
              });
              setProgress(`Exporting… scene ${si + 1}/${storyboard.scenes.length} · ${Math.round(p * 100)}%`);
              if (elapsed >= total + 0.25) {
                clearInterval(iv);
                resolve();
              }
            } catch (e) {
              // keep exporting even if one frame fails
              console.error('export frame failed', e);
              setProgress((prev) => prev + ' (recovered from a frame error)');
            }
          })();
        }, 33);
      });
      recorder.stop();
      const blob = await done;
      const url = URL.createObjectURL(blob);
      setLink(url);
      setProgress(`Done — ${(blob.size / 1024 / 1024).toFixed(1)} MB`);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${chapterLabel.replace(/[^\w-]+/g, '_')}.${isMp4 ? 'mp4' : 'webm'}`;
      a.click();
    } catch (e) {
      setError(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <h2>4 · Export video</h2>
      <p className="muted small">
        Exports <b>{chapterLabel}</b> as {typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/mp4') ? '.mp4 (supported by this browser)' : '.webm (this browser records webm; mp4 is not supported by its MediaRecorder)'} —
        1280×720 canvas at 30 fps, all scenes animated with burned-in captions.
        Note: the voice is spoken live by the browser during playback; speechSynthesis output cannot be captured into the file, so the export is the animated video track.
      </p>
      <button className="primary" disabled={busy} onClick={() => void exportChapter()}>
        {busy ? 'Exporting…' : 'Export Video (.webm)'}
      </button>
      {progress && <p className="muted">{progress}</p>}
      {error && <p className="error">⚠ {error}</p>}
      {link && <p>✅ Ready: <a href={link} download>Download exported video</a></p>}
    </section>
  );
};

export default ExportPanel;
