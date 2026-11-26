# International Law Video Lecture Generator — fully local edition

Turns dense international law documents (PDF / PPTX) into narrated, animated
lecture videos. React + TypeScript + Vite. **No API key, no cloud calls, no
`@google/genai`** — everything runs in your browser.

## Run

```bash
npm install
npm run dev      # open the shown URL — no API key needed
npm run build    # production build
```

## How it works without an API

- **Extraction** (`src/extract.ts`, `src/textutil.ts`): PDF via `pdfjs-dist`,
  PPTX via `jszip` (`ppt/slides/slideN.xml` in slide order + speaker notes).
  Scanned PDFs are detected and blocked with a warning. Language (EN/DE/FR) is
  detected locally via stopwords and confirmed by you. Page/slide preview with
  word counts.
- **Chapters** (`src/chapters.ts`): heading / `§` / numbering / slide-title
  detection, fallback chunks of ~6–8 pages or ~6000 words. Default selection:
  first chapter. Estimate of work shown before generating.
- **Lecture engine** (`src/engine.ts`): deterministic extraction from your text —
  treaty articles (`Art. 2(4) UN Charter`, VCLT…), cases (name + court + year,
  e.g. ICJ Nicaragua v. United States 1986), legal-test steps, glossary
  ("X means …"). Pass 1 outline per chapter; Pass 2 storyboard of 4–10 scenes
  (LEGAL_TEST / CASE_COMPARISON / TREATY_DIAGRAM / KEY_TAKEAWAYS layouts) with
  lecture-style narration in the document's language, citations and
  sourcePages. Only content from the uploaded document is used.
- **Voice** (`src/audio.ts`): browser Web Speech API (`speechSynthesis`).
  Pick a system voice in Settings. Utterance `boundary` events give the real
  spoken position, which drives scene animations, citation highlighting and
  captions — so the visuals stay in sync with the narration. Scene durations
  are estimated from word count / speech rate.
- **Player** (`src/components/Player.tsx`, `src/renderer.ts`): 1280×720 canvas,
  dark/light theme, own SVG layout for treaty diagrams. Play/pause, scene
  scrubber, 1–1.75× speed, captions, Space/←/→ shortcuts, chapter switcher.
- **Q&A** (`src/components/Sidebar.tsx`, `src/retrieve.ts`): local BM25-style
  retrieval picks the most relevant pages, then an extractive answer is
  assembled from the best-matching sentences with page references; if the
  material doesn't cover it, it says so.
- **Export** (`src/components/ExportPanel.tsx`): per chapter,
  `canvas.captureStream(30)` + MediaRecorder → `.webm` (or `.mp4` only if your
  browser supports it), all scenes animated with burned-in captions. Browser
  speech cannot be captured into a media file, so the export is the animated
  video track.
- **Scheduler + persistence** (`src/scheduler.ts`, `src/db.ts`): all
  generation goes through one sequential queue with a live status bar; outlines,
  storyboards, Q&A and the document are cached in IndexedDB, so reloading loses
  nothing and an interrupted job resumes where it stopped (Resume / Clear
  cache in Settings).

## Tests

```bash
npx esbuild test/smoke.mjs --bundle --format=esm --platform=node --outfile=/tmp/smoke.mjs && node /tmp/smoke.mjs
```

Covers scheduler lanes/retry, chapter detection, language detection, retrieval,
article/case extraction, storyboard generation (4–10 scenes, layout types,
page provenance) and extractive Q&A.
