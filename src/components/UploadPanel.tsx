import React, { useRef, useState } from 'react';
import type { SourceDocument, LanguageCode } from '../types';
import { LANGUAGE_NAMES } from '../types';
import { extractDocument } from '../extract';

interface Props {
  onDocument: (doc: SourceDocument, language: LanguageCode | 'unknown', file: File) => void;
  busy: boolean;
}

// Upload + local extraction + scanned-PDF warning + language confirmation.
const UploadPanel: React.FC<Props> = ({ onDocument, busy }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<(Omit<SourceDocument, 'id' | 'uploadedAt'> & { language: LanguageCode | 'unknown' }) | null>(null);
  const [langChoice, setLangChoice] = useState<LanguageCode | 'unknown'>('unknown');

  const fileRef = useRef<File | null>(null);
  const handleFile = async (f: File) => {
    setError('');
    fileRef.current = f;
    try {
      const extracted = await extractDocument(f);
      setPending({ ...extracted });
      setLangChoice(extracted.language);
    } catch (e) {
      setError(`Extraction failed for "${f.name}": ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <section className="panel">
      <h2>1 · Upload document</h2>
      <p className="muted">PDF or PPTX. Text is extracted locally in your browser — no API call is used for extraction.</p>
      <div
        className="dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void handleFile(f); }}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? 'Extracting…' : 'Drop a .pdf / .pptx here, or click to choose'}
        <input ref={inputRef} type="file" accept=".pdf,.pptx" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }} />
      </div>
      {error && <p className="error">⚠ {error}</p>}
      {pending && (
        <div className="preview">
          <h3>{pending.name} — {pending.kind.toUpperCase()}, {pending.pages.length} {pending.kind === 'pdf' ? 'pages' : 'slides'}, {pending.totalWords.toLocaleString()} words</h3>
          {pending.scanned && (
            <p className="error">
              ⚠ This looks like a SCANNED document (almost no extractable text). OCR is not run automatically —
              please upload a text-based PDF/PPTX, or export an OCR'd copy first. Continuing would produce an empty lecture.
            </p>
          )}
          <label>
            Document language (detected locally: <b>{pending.language === 'unknown' ? 'unclear' : LANGUAGE_NAMES[pending.language as LanguageCode]}</b>).
            Please confirm — this decides the narration language without spending an API call:
            <select value={langChoice} onChange={(e) => setLangChoice(e.target.value as LanguageCode | 'unknown')}>
              <option value="en">English</option>
              <option value="de">German (Deutsch)</option>
              <option value="fr">French (Français)</option>
              <option value="unknown">Other / unclear</option>
            </select>
          </label>
          <details>
            <summary>Page/slide preview ({pending.pages.length})</summary>
            <ul className="pagelist">
              {pending.pages.map((p) => (
                <li key={p.index}><b>{pending.kind === 'pdf' ? `Page ${p.index}` : `Slide ${p.index}`}</b> · {p.wordCount} words — {p.text.slice(0, 90) || '(no text)'}</li>
              ))}
            </ul>
          </details>
          <button
            className="primary"
            disabled={pending.scanned}
            onClick={() => onDocument({ ...pending, id: `doc-${Date.now()}`, uploadedAt: Date.now() } as SourceDocument, langChoice, fileRef.current!)}
          >
            Use this document →
          </button>
          {pending.scanned && <p className="muted small">The button is disabled because the document appears scanned.</p>}
        </div>
      )}
    </section>
  );
};

export default UploadPanel;
