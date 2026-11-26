import React, { useEffect, useMemo, useState } from 'react';
import { Scheduler, type QueueEvent } from './scheduler';
import { TIMING, ENGINE } from './config';
import * as db from './db';
import type { Chapter, GlossaryTerm, Outline, SourceDocument, Storyboard, LanguageCode } from './types';
import { detectChapters, pagesText } from './chapters';
import { generateOutlineLocal, generateStoryboardLocal } from './engine';
import { getSystemVoices, defaultVoiceForLang, type SystemVoice } from './audio';
import { StatusBar } from './components/StatusBar';
import SettingsPanel from './components/SettingsPanel';
import UploadPanel from './components/UploadPanel';
import ChapterPanel from './components/ChapterPanel';
import Player from './components/Player';
import Sidebar from './components/Sidebar';
import ExportPanel from './components/ExportPanel';

// One sequential queue for all generation work (outlines, storyboards, Q&A).
// Local engine calls are fast, but running them through the queue keeps the
// status bar informative and the UI never blocks.
const scheduler = new Scheduler({
  backoffStartSeconds: 0.2,
  backoffMaxSeconds: 1,
  maxAttempts: 3,
  ttsMinGapSeconds: TIMING.voiceMinGapSeconds,
  textMinGapSeconds: TIMING.textMinGapSeconds,
  slowModeMultiplier: TIMING.slowModeMultiplier,
});

const App: React.FC = () => {
  const [voices, setVoices] = useState<SystemVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState('');
  const [slowMode, setSlowMode] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [doc, setDoc] = useState<SourceDocument | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [storyboards, setStoryboards] = useState<Record<string, Storyboard>>({});
  const [events, setEvents] = useState<QueueEvent[]>([]);
  const [generating, setGenerating] = useState<null | { label: string; done: number; total: number; chapterLabel: string }>(null);
  const [genError, setGenError] = useState<null | { label: string; chapterId: string }>(null);
  const [watchChapter, setWatchChapter] = useState<string>('');

  useEffect(() => {
    const load = () => setVoices(getSystemVoices());
    load();
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.onvoiceschanged = load;
  }, []);

  useEffect(() => {
    if (doc && !voiceURI) {
      const v = defaultVoiceForLang(doc.language);
      if (v) setVoiceURI(v.voiceURI);
    }
  }, [doc, voiceURI]);

  const voice = useMemo(() => voices.find((v) => v.voiceURI === voiceURI) ?? null, [voices, voiceURI]);

  useEffect(() => { scheduler.setSlowMode(slowMode); }, [slowMode]);

  useEffect(() => {
    const off = scheduler.onEvent((e) => {
      setEvents((prev) => {
        const rest = prev.filter((p) => p.taskId !== e.taskId || p.status === 'done' || p.status === 'failed');
        return [...rest, e].slice(-30);
      });
    });
    return off;
  }, []);

  // Restore everything from IndexedDB on reload — nothing is lost.
  useEffect(() => {
    (async () => {
      const savedDoc = await db.getMeta<SourceDocument>('document');
      const savedChapters = await db.getMeta<Chapter[]>('chapters');
      const savedSelected = await db.getMeta<string[]>('selected');
      const savedWatch = await db.getMeta<string>('watchChapter');
      if (savedDoc) {
        setDoc(savedDoc);
        setChapters(savedChapters ?? detectChapters(savedDoc.pages, savedDoc.kind));
        setSelected(savedSelected ?? []);
        setWatchChapter(savedWatch ?? '');
        const sbs: Record<string, Storyboard> = {};
        for (const ch of savedChapters ?? []) {
          const sb = await db.getStoryboard<Storyboard>(ch.id);
          if (sb) sbs[ch.id] = sb;
        }
        setStoryboards(sbs);
      }
    })();
  }, []);

  const handleDocument = async (d: SourceDocument, language: LanguageCode | 'unknown') => {
    const docWithLang = { ...d, language };
    setDoc(docWithLang);
    const chs = detectChapters(d.pages, d.kind);
    setChapters(chs);
    setSelected(chs.length ? [chs[0].id] : []); // default: first chapter only
    setWatchChapter(chs.length ? chs[0].id : '');
    await db.setMeta('document', docWithLang);
    await db.setMeta('chapters', chs);
    await db.setMeta('selected', chs.length ? [chs[0].id] : []);
    await db.setMeta('watchChapter', chs.length ? chs[0].id : '');
  };

  const toggleChapter = (id: string) => {
    setSelected((s) => {
      const n = s.includes(id) ? s.filter((x) => x !== id) : [...s, id];
      void db.setMeta('selected', n);
      return n;
    });
  };

  // Pass 1 (outline) + Pass 2 (storyboard) per selected chapter, sequentially
  // through the queue and fully resumable: cached items are skipped, so an
  // interrupted job resumes exactly where it stopped.
  const generate = async () => {
    if (!doc) return;
    setGenError(null);
    const targets = selected;
    setGenerating({ label: 'Outlines + storyboards', done: 0, total: targets.length, chapterLabel: '' });
    const newSbs: Record<string, Storyboard> = { ...storyboards };
    let done = 0;
    for (const cid of targets) {
      const ch = chapters.find((c) => c.id === cid);
      if (!ch) continue;
      setGenerating({ label: 'Outlines + storyboards', done, total: targets.length, chapterLabel: ch.title });
      const text = pagesText(doc.pages, ch.pageStart, ch.pageEnd);
      try {
        let outline = await db.getOutline<Outline>(cid);
        if (!outline) {
          outline = await scheduler.enqueue('text', `Outline · ${ch.title}`, async () => ({
            ...generateOutlineLocal(text, doc.language),
            chapterId: cid,
          }));
          await db.setOutline(cid, outline);
        }
        let sb = await db.getStoryboard<Storyboard>(cid);
        if (!sb) {
          sb = await scheduler.enqueue('text', `Storyboard · ${ch.title}`, async () =>
            generateStoryboardLocal(cid, ch.title, text, outline!, doc.language),
          );
          await db.setStoryboard(cid, sb);
        }
        newSbs[cid] = sb;
        setStoryboards(newSbs);
        done++;
        setGenerating({ label: 'Outlines + storyboards', done, total: targets.length, chapterLabel: ch.title });
        if (!watchChapter) { setWatchChapter(cid); void db.setMeta('watchChapter', cid); }
      } catch (e) {
        setGenError({ label: `Chapter "${ch.title}" (${cid}) — ${e instanceof Error ? e.message : String(e)}`, chapterId: cid });
        setGenerating(null);
        return;
      }
    }
    setGenerating(null);
  };

  const resume = async () => {
    if (doc && selected.length) await generate();
  };

  const clearCache = async () => {
    if (!confirm('Delete ALL cached data (document, storyboards, Q&A) from IndexedDB?')) return;
    await db.clearAll();
    setDoc(null); setChapters([]); setSelected([]); setStoryboards({}); setWatchChapter('');
  };

  const watchStoryboard = storyboards[watchChapter];
  const glossary: GlossaryTerm[] = useMemo(() => {
    const sb = watchStoryboard;
    if (!sb) return [];
    const seen = new Map<string, GlossaryTerm>();
    for (const s of sb.scenes) for (const g of s.glossaryTerms) if (!seen.has(g.term.toLowerCase())) seen.set(g.term.toLowerCase(), g);
    return [...seen.values()];
  }, [watchStoryboard]);

  const chapterOptions = chapters.filter((c) => storyboards[c.id]);

  return (
    <div className={`app ${theme}`}>
      <header>
        <h1>International Law Video Lecture Generator</h1>
        <SettingsPanel
          voices={voices} voiceURI={voiceURI} onVoice={setVoiceURI}
          slowMode={slowMode} onSlowMode={setSlowMode}
          theme={theme} onTheme={setTheme}
          onClearCache={() => void clearCache()}
          onResume={() => void resume()}
          hasDoc={!!doc}
        />
      </header>
      <StatusBar events={events} slowMode={slowMode} onToggleSlow={() => setSlowMode((s) => !s)} />

      {!doc ? (
        <UploadPanel onDocument={(d, lang) => void handleDocument(d, lang)} busy={false} />
      ) : (
        <>
          <p className="muted">Loaded: <b>{doc.name}</b> · {doc.pages.length} pages · {doc.totalWords.toLocaleString()} words · language: {doc.language} · engine: {ENGINE.name}</p>
          <UploadPanel onDocument={(d, lang) => void handleDocument(d, lang)} busy={false} />
          <ChapterPanel
            chapters={chapters}
            selected={selected}
            onToggle={toggleChapter}
            onSelectAll={() => { const all = chapters.map((c) => c.id); setSelected(all); void db.setMeta('selected', all); }}
            onSelectNone={() => { setSelected([]); void db.setMeta('selected', []); }}
            storyboards={storyboards}
            generating={generating}
            onGenerate={() => void generate()}
            disabled={false}
          />
          {genError && (
            <p className="error">
              ⚠ Failed task: {genError.label}
              <button onClick={() => void generate()}>Retry</button>
            </p>
          )}
          {watchStoryboard && (
            <>
              <div className="row gap">
                <label>Watch chapter:
                  <select value={watchChapter} onChange={(e) => { setWatchChapter(e.target.value); void db.setMeta('watchChapter', e.target.value); }}>
                    {chapterOptions.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </select>
                </label>
              </div>
              <div className="maincols">
                <Player
                  storyboard={watchStoryboard}
                  chapterLabel={chapters.find((c) => c.id === watchChapter)?.title ?? watchChapter}
                  voice={voice}
                  lang={doc.language}
                  theme={theme}
                />
                <Sidebar
                  glossary={glossary}
                  pages={doc.pages}
                  lang={doc.language}
                  currentScene={watchStoryboard.scenes[0] ?? null}
                />
              </div>
              <ExportPanel
                storyboard={watchStoryboard}
                chapterLabel={chapters.find((c) => c.id === watchChapter)?.title ?? watchChapter}
                theme={theme}
              />
            </>
          )}
        </>
      )}
      <footer className="muted small">
        Fully local: {ENGINE.name} · outlines/storyboards/Q&amp;A extracted from your document · voice via browser speechSynthesis · state persisted in IndexedDB — reload loses nothing.
      </footer>
    </div>
  );
};

export default App;
