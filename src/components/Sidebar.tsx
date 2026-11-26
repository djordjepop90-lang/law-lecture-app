import React, { useMemo, useState } from 'react';
import type { GlossaryTerm, PageText, Scene } from '../types';
import { answerQuestionLocal } from '../engine';
import * as db from '../db';

interface QAItem { q: string; answer: string; pages: number[]; found: boolean }

interface Props {
  glossary: GlossaryTerm[];
  pages: PageText[];
  lang: string;
  currentScene: Scene | null;
}

// Glossary (from storyboard glossaryTerms) + extractive Q&A answered locally
// from the most relevant pages — no API call at all.
const Sidebar: React.FC<Props> = ({ glossary, pages, lang, currentScene }) => {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<QAItem[]>([]);
  const [error, setError] = useState('');

  const sortedGlossary = useMemo(
    () => [...glossary].sort((a, b) => a.term.localeCompare(b.term)),
    [glossary],
  );

  const ask = async () => {
    if (!q.trim()) return;
    setError('');
    const key = await db.hashString(q.trim().toLowerCase());
    const cached = await db.getQA<QAItem>(`qa:${key}`);
    if (cached) {
      setItems((it) => [cached, ...it]);
      setQ('');
      return;
    }
    try {
      const res = answerQuestionLocal(q, pages, lang, currentScene);
      const item: QAItem = { q, answer: res.answer, pages: res.pageReferences, found: res.foundInMaterial };
      await db.setQA(`qa:${key}`, item);
      setItems((it) => [item, ...it]);
      setQ('');
    } catch (e) {
      setError(`Q&A failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <aside className="sidebar">
      <section className="panel">
        <h2>Glossary</h2>
        {sortedGlossary.length === 0 && <p className="muted">Generate a storyboard to build the glossary.</p>}
        <ul className="glossary">
          {sortedGlossary.map((g, i) => (
            <li key={i}><b>{g.term}</b><span>{g.definition}</span></li>
          ))}
        </ul>
      </section>
      <section className="panel">
        <h2>Q&amp;A (grounded in your document)</h2>
        <div className="row">
          <input
            value={q}
            placeholder="Ask about the uploaded material…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void ask(); }}
          />
          <button className="primary" disabled={!q.trim()} onClick={() => void ask()}>Ask</button>
        </div>
        {error && <p className="error">⚠ {error} <button onClick={() => void ask()}>Retry</button></p>}
        <ul className="qalist">
          {items.map((it, i) => (
            <li key={i}>
              <p className="qq">Q: {it.q}</p>
              <p className="qa">{it.answer}</p>
              <p className="muted small">
                {it.found ? `Sources: pages ${it.pages.join(', ') || '—'}` : 'Not covered in the uploaded material.'}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
};

export default Sidebar;
