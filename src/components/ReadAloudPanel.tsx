import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { SourceDocument } from '../types';
import type { SystemVoice } from '../audio';
import {
  LANGUAGES,
  languageName,
  detectLanguageWide,
  rankVoices,
  planUtterances,
  MAX_UTTERANCE_CHARS,
} from '../reader';
import { ReaderVoice, type ReaderProgress } from '../readerVoice';
import { wordCount } from '../textutil';
import { TIMING } from '../config';
import * as db from '../db';

interface Props {
  doc: SourceDocument;
  voices: SystemVoice[];
}

interface ReaderPrefs {
  langChoice: string; // 'auto' or a BCP-47 tag
  voiceURI: string;
  rate: number;
}

// Whole-document read-aloud in any language, using only the browser's built-in
// voices (Web Speech API): free, unlimited, offline, no API key.
const ReadAloudPanel: React.FC<Props> = ({ doc, voices }) => {
  const allText = useMemo(() => doc.pages.map((p) => p.text).join(' '), [doc]);
  const detected = useMemo(() => detectLanguageWide(allText), [allText]);
  const utterances = useMemo(() => planUtterances(doc.pages, MAX_UTTERANCE_CHARS), [doc]);

  const [langChoice, setLangChoice] = useState('auto');
  const [voiceURI, setVoiceURI] = useState('');
  const [rate, setRate] = useState(1);
  const [progress, setProgress] = useState<ReaderProgress | null>(null);
  const [currentText, setCurrentText] = useState('');
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);

  const lang = langChoice === 'auto' ? (detected === 'unknown' ? 'en-US' : detected) : langChoice;
  const ranked = useMemo(() => rankVoices(voices, lang), [voices, lang]);
  const activeVoice = ranked.find((v) => v.voiceURI === voiceURI) ?? null;
  const totalWords = useMemo(() => utterances.reduce((a, u) => a + wordCount(u.text), 0), [utterances]);
  const estMinutes = totalWords / TIMING.wordsPerSecond / rate / 60;

  // Restore reader preferences from IndexedDB.
  useEffect(() => {
    (async () => {
      const p = await db.getMeta<ReaderPrefs>('readerPrefs');
      if (p) {
        setLangChoice(p.langChoice || 'auto');
        setVoiceURI(p.voiceURI || '');
        setRate(p.rate || 1);
      }
    })();
  }, []);

  useEffect(() => {
    void db.setMeta('readerPrefs', { langChoice, voiceURI, rate } satisfies ReaderPrefs);
  }, [langChoice, voiceURI, rate]);

  // Default voice = best-ranked (most natural) installed voice for the language.
  useEffect(() => {
    if (ranked.length && (!voiceURI || !ranked.some((v) => v.voiceURI === voiceURI))) {
      setVoiceURI(ranked[0].voiceURI);
    }
  }, [ranked, voiceURI]);

  const ctxRef = useRef({ utterances });
  ctxRef.current = { utterances };
  const readerRef = useRef<ReaderVoice | null>(null);
  if (!readerRef.current) {
    readerRef.current = new ReaderVoice({
      lang: 'en-US',
      rate: 1,
      voiceURI: '',
      events: {
        onProgress: (p) => {
          setProgress(p);
          const q = ctxRef.current.utterances;
          setCurrentText(q[Math.min(p.chunkIndex, q.length - 1)]?.text ?? '');
        },
        onEnd: () => {
          setPlaying(false);
          setPaused(false);
        },
      },
    });
  }

  useEffect(() => { readerRef.current?.setQueue(utterances); }, [utterances]);
  useEffect(() => {
    const r = readerRef.current;
    if (r) { r.setLang(lang); r.setVoice(voiceURI); }
  }, [lang, voiceURI]);
  useEffect(() => { readerRef.current?.setRate(rate); }, [rate]);
  useEffect(() => () => readerRef.current?.stop(), []);

  const play = () => { setPlaying(true); setPaused(false); readerRef.current?.play(); };
  const pause = () => { readerRef.current?.pause(); setPaused(true); };
  const resume = () => { readerRef.current?.resume(); setPaused(false); };
  const stop = () => {
    readerRef.current?.stop();
    setPlaying(false);
    setPaused(false);
    setProgress(null);
    setCurrentText('');
  };

  return (
    <section className="panel">
      <h2>2 · Read the whole document aloud</h2>
      <p className="muted">
        Free &amp; unlimited: your browser&apos;s built-in voices (Web Speech API) read the entire document locally —
        no API key, no cloud call, no character limit, works offline. The language is auto-detected (or pick any of{' '}
        {LANGUAGES.length}), and the most natural installed voice for it is pre-selected.
      </p>
      <div className="row gap">
        <label>
          Language
          <select value={langChoice} onChange={(e) => setLangChoice(e.target.value)}>
            <option value="auto">Auto-detect{detected === 'unknown' ? '' : `: ${languageName(detected)}`}</option>
            {LANGUAGES.map((l) => (
              <option key={l.tag} value={l.tag}>{l.name} ({l.tag})</option>
            ))}
          </select>
        </label>
        <label>
          Voice{activeVoice?.badge ? <span className="badge">{activeVoice.badge}</span> : null}
          <select value={voiceURI} onChange={(e) => setVoiceURI(e.target.value)} disabled={!ranked.length}>
            {voices.length === 0 && <option value="">(no speech voices available in this browser/OS)</option>}
            {ranked.length === 0 && voices.length > 0 && (
              <option value="">(no installed voice for {languageName(lang)} — try another language)</option>
            )}
            {ranked.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} ({v.lang}){v.badge ? ` · ${v.badge}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="row">
          Speed
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={rate}
            onChange={(e) => setRate(parseFloat(e.target.value))}
          />
          {rate.toFixed(2)}×
        </label>
      </div>
      <div className="row gap">
        {!playing && (
          <button className="primary" onClick={play} disabled={!ranked.length || !utterances.length}>
            ▶ Read aloud
          </button>
        )}
        {playing && !paused && <button onClick={pause}>⏸ Pause</button>}
        {playing && paused && <button className="primary" onClick={resume}>▶ Resume</button>}
        {playing && <button className="danger" onClick={stop}>⏹ Stop</button>}
      </div>
      <p className="muted small">
        {doc.pages.length} pages · {totalWords.toLocaleString()} words · ~{Math.max(1, Math.round(estMinutes))} min at{' '}
        {rate.toFixed(2)}×
        {progress && <> · now on page {progress.page} · sentence {progress.chunkIndex + 1}/{progress.total}</>}
      </p>
      {progress && (
        <>
          <div className="progress">
            <div className="bar" style={{ width: `${Math.round(progress.overall * 100)}%` }} />
            <span>{Math.round(progress.overall * 100)}%</span>
          </div>
          <p className="nowreading">
            “{currentText.slice(0, 220)}{currentText.length > 220 ? '…' : ''}”
          </p>
        </>
      )}
    </section>
  );
};

export default ReadAloudPanel;
