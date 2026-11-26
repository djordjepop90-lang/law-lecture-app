import React from 'react';
import type { Chapter, Storyboard } from '../types';
import { estimateSelection } from '../chapters';

interface Props {
  chapters: Chapter[];
  selected: string[];
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  storyboards: Record<string, Storyboard>;
  generating: null | { label: string; done: number; total: number; chapterLabel: string };
  onGenerate: () => void;
  disabled: boolean;
}

const ChapterPanel: React.FC<Props> = ({ chapters, selected, onToggle, onSelectAll, onSelectNone, storyboards, generating, onGenerate, disabled }) => {
  const est = estimateSelection(selected.length);
  const allDone = selected.length > 0 && selected.every((id) => storyboards[id]);
  return (
    <section className="panel">
      <h2>3 · Select chapters & generate storyboards</h2>
      <div className="row gap">
        <button onClick={onSelectAll}>All</button>
        <button onClick={onSelectNone}>None</button>
        <span className="muted small">Default: first chapter only. Generated storyboards are cached in IndexedDB and never re-generated.</span>
      </div>
      <ul className="chapterlist">
        {chapters.map((c) => (
          <li key={c.id}>
            <label>
              <input type="checkbox" checked={selected.includes(c.id)} onChange={() => onToggle(c.id)} />
              <span className="chtitle">{c.title}</span>
              <span className="muted small">
                pages {c.pageStart}–{c.pageEnd} · {c.wordCount.toLocaleString()} words
                {storyboards[c.id] ? ` · ✅ ${storyboards[c.id].scenes.length} scenes` : ''}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {selected.length > 0 && (
        <p className="estimate">
          Estimate for {est.chapters} chapter(s): ~{est.apiCalls} API calls ({est.chapters} outlines + {est.chapters} storyboards + ~{est.scenes} TTS, generated lazily),
          roughly <b>{est.estimatedMinutes} min</b> of API time. Large selections take longer because of rate limits — the queue retries automatically and you can pause/resume anytime.
        </p>
      )}
      {generating && (
        <div className="progress">
          <div className="bar" style={{ width: `${(generating.done / Math.max(1, generating.total)) * 100}%` }} />
          <span>{generating.label} — chapter {generating.done}/{generating.total}: {generating.chapterLabel}</span>
        </div>
      )}
      <button className="primary" disabled={disabled || selected.length === 0 || !!generating} onClick={onGenerate}>
        {generating ? 'Generating… (see status bar)' : allDone ? 'Re-run only missing (cached are skipped)' : 'Generate outlines + storyboards'}
      </button>
    </section>
  );
};

export default ChapterPanel;
