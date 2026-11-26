import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Storyboard, Scene } from '../types';
import { speakScene, pauseSpeech, resumeSpeech, stopSpeech, estimateSceneDuration, type SystemVoice, type SpeakHandle } from '../audio';
import { renderScene, W, H } from '../renderer';

interface Props {
  storyboard: Storyboard;
  chapterLabel: string;
  voice: SystemVoice | null;
  lang: string;
  theme: 'dark' | 'light';
}

// Player driven by the browser's speechSynthesis: utterance boundary events
// give the real spoken position, which drives scene progress, reveals,
// citation highlighting and captions.
const Player: React.FC<Props> = ({ storyboard, chapterLabel, voice, lang, theme }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showCaptions, setShowCaptions] = useState(true);
  const [progress, setProgress] = useState(0);
  const handleRef = useRef<SpeakHandle | null>(null);
  const sceneRef = useRef(0);
  const playingRef = useRef(false);
  const speedRef = useRef(1);
  sceneRef.current = sceneIndex;
  playingRef.current = playing && !paused;
  speedRef.current = speed;

  const scene: Scene = storyboard.scenes[sceneIndex];
  const durations = useMemo(
    () => storyboard.scenes.map((s) => estimateSceneDuration(s, 1)),
    [storyboard],
  );
  const totalDuration = useMemo(() => durations.reduce((a, b) => a + b, 0), [durations]);

  const stop = useCallback(() => {
    handleRef.current?.cancel();
    handleRef.current = null;
    stopSpeech();
  }, []);

  const playScene = useCallback((idx: number) => {
    stop();
    setProgress(0);
    const sc = storyboard.scenes[idx];
    if (!sc) return;
    setPlaying(true);
    setPaused(false);
    handleRef.current = speakScene(
      sc, voice, lang, speedRef.current,
      (p) => setProgress(p),
      () => {
        if (sceneRef.current < storyboard.scenes.length - 1) {
          setSceneIndex(sceneRef.current + 1);
          playScene(sceneRef.current + 1);
        } else {
          setPlaying(false);
        }
      },
    );
  }, [storyboard, voice, lang, stop]);

  const togglePlay = () => {
    if (playing && !paused) {
      pauseSpeech();
      setPaused(true);
    } else if (playing && paused) {
      resumeSpeech();
      setPaused(false);
    } else {
      playScene(sceneIndex);
    }
  };

  const goScene = (idx: number) => {
    setSceneIndex(idx);
    setProgress(0);
    if (playingRef.current) playScene(idx); else stop();
  };

  useEffect(() => { stop(); setSceneIndex(0); setProgress(0); setPlaying(false); setPaused(false); }, [storyboard.chapterId, stop]);

  // re-speak at new speed when speed changes mid-scene
  useEffect(() => {
    if (playingRef.current && !paused) playScene(sceneRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speed]);

  // render loop
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    let alive = true;
    let raf = 0;
    const loop = async () => {
      if (!alive) return;
      try {
        await renderScene(ctx, scene, {
          theme, progress, showCaptions, chapterLabel,
          sceneIndex, sceneCount: storyboard.scenes.length, timeSeconds: progress * durations[sceneIndex],
        });
      } catch (e) {
        console.error('render failed', e); // keep the loop alive on a bad frame
      }
      raf = requestAnimationFrame(() => { void loop(); });
    };
    void loop();
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [scene, theme, progress, showCaptions, chapterLabel, sceneIndex, storyboard.scenes.length, durations]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if (e.key === 'ArrowRight') goScene(Math.min(storyboard.scenes.length - 1, sceneIndex + 1));
      if (e.key === 'ArrowLeft') goScene(Math.max(0, sceneIndex - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneIndex, playing, paused, storyboard.scenes.length]);

  useEffect(() => () => stop(), [stop]);

  let elapsed = 0;
  for (let i = 0; i < sceneIndex; i++) elapsed += durations[i];

  return (
    <section className="panel playerpanel">
      <h2>3 · Lecture player</h2>
      <div className="canvaswrap">
        <canvas ref={canvasRef} width={W} height={H} />
        {playing && paused && <div className="overlay">Paused</div>}
      </div>
      <div className="controls">
        <button className="primary" onClick={togglePlay}>{playing && !paused ? '⏸ Pause' : '▶ Play'}</button>
        <button onClick={() => goScene(Math.max(0, sceneIndex - 1))}>⏮ Prev</button>
        <button onClick={() => goScene(Math.min(storyboard.scenes.length - 1, sceneIndex + 1))}>⏭ Next</button>
        <label>Speed
          <select value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))}>
            {[1, 1.25, 1.5, 1.75].map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </label>
        <label><input type="checkbox" checked={showCaptions} onChange={(e) => setShowCaptions(e.target.checked)} /> Captions</label>
        <span className="muted small">Space = play/pause · ←/→ = scene · voice: browser speechSynthesis</span>
      </div>
      <div className="timeline">
        {storyboard.scenes.map((s, i) => (
          <button
            key={s.id}
            className={`tlscene ${i === sceneIndex ? 'active' : ''}`}
            style={{ left: `${(durations.slice(0, i).reduce((a, b) => a + b, 0) / Math.max(1, totalDuration)) * 100}%`, width: `${(durations[i] / Math.max(1, totalDuration)) * 100}%` }}
            title={`${s.title} (~${durations[i].toFixed(0)}s)`}
            onClick={() => goScene(i)}
          >
            {i + 1}
          </button>
        ))}
        <div className="tlprogress" style={{ width: `${((elapsed + progress * durations[sceneIndex]) / Math.max(1, totalDuration)) * 100}%` }} />
      </div>
      <ul className="scenelist">
        {storyboard.scenes.map((s, i) => (
          <li key={s.id} className={i === sceneIndex ? 'active' : ''}>
            <button onClick={() => goScene(i)}>{i + 1}. {s.title}</button>
            <span className="muted small">~{durations[i].toFixed(0)}s · {s.layoutType}</span>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default Player;
