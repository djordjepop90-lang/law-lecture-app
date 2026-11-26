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
- **Read aloud — any document, any language** (`src/reader.ts`,
  `src/readerVoice.ts`, `src/components/ReadAloudPanel.tsx`): after upload, the
  whole document can be narrated end to end. Language is auto-detected for
  ~60 languages (Unicode-script ranges + Latin stopword heuristic) or chosen
  manually; the most natural installed voice for that language is pre-selected
  (`rankVoices` puts neural/premium/cloud voices first) and can be switched.
  Text is split into short sentence chunks (`planUtterances`, ≤180 chars) so
  browser utterance limits never cut it off; live progress (page, %, current
  sentence) is driven by real `boundary` events. Play / pause / resume / stop /
  speed 0.5–2×. Preferences persist in IndexedDB.
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

## Cost — is it free? What are the limits?

**Yes — completely free with this app: $0, forever, unlimited.** Reading aloud
uses the browser's Web Speech API (`speechSynthesis`): the voices ship with
your OS/browser, so there is no API key, no account, no cloud call, no
per-character billing and no quota. It even works offline. Limits of the free
path:

- Voice quality and language coverage = the voices installed on your device.
  Chrome/Edge expose Google's neural voices for ~50+ locales, Safari exposes
  Apple's Siri voices, Windows has SAPI5 plus downloadable neural
  "Microsoft …" voices (Settings → Time & language → Speech → Manage voices).
  Linux needs speech-dispatcher voices installed. A language works only if a
  voice for it is installed — the picker lists what is available and
  auto-selects the best one.
- Scanned / image-only PDFs have no text layer; the app detects this and blocks
  them at upload (run OCR first, e.g. in Adobe Acrobat "Recognize text").
- Read-aloud audio plays live only: browsers cannot capture `speechSynthesis`
  into the exported video file, so video export stays without an audio track.
- No rate limits, watermarks or character caps — a 500-page PDF can be read as
  often as you like; the only "cost" is your CPU/battery.

**If you want studio-grade voices (ElevenLabs-level) from a cloud API instead**
(prices checked Nov 2026, USD, billed per character; ~54,000 chars ≈ 1 hour of
narration):

| Service | Free tier | Paid |
| --- | --- | --- |
| ElevenLabs | 10,000 credits/mo (~10 min) — attribution required, **non-commercial only**, no cloning | from $6/mo Starter (~30 min, commercial OK), ~$0.17–0.20 per minute; 90+ languages |
| Google Cloud TTS | permanent monthly free tier (billing must be enabled): 4M chars Standard, 1M WaveNet / Neural2 / Chirp 3 HD, 100K Studio | $4/1M Standard & WaveNet, $16/1M Neural2, $30/1M Chirp 3 HD, $160/1M Studio |
| Azure AI Speech | 500K neural chars/mo free forever (F0 tier, one per subscription) | $15/1M neural PAYG ($22/1M HD); commitment tiers down to $6/1M; 140+ locales |
| AWS Polly | first 12 months only: 5M standard + 1M neural chars/mo | $4/1M standard, $16/1M neural, $30/1M generative, $100/1M long-form |
| OpenAI TTS | none | tts-1 $15/1M, tts-1-hd $30/1M (deprecated, retiring Jan 2027); few voices, English-centric — poor fit for "any language" |

Unofficial free wrappers around Microsoft Edge's online voices (e.g. `edge-tts`)
exist with no official limit, but they are against the terms of service and can
break without notice — not recommended for anything you rely on.

Rule of thumb: a typical 300-page PDF ≈ 150k words ≈ 900k chars ≈ 16 h of
audio → **free locally**; ≈ $3.60 on Google Standard/WaveNet, ≈ $13.50 on Azure
Neural, ≈ $14.40 on Polly Neural, ≈ $190 on ElevenLabs API rates (~$0.20/min).

## Tests

```bash
npx esbuild test/smoke.mjs --bundle --format=esm --platform=node --outfile=/tmp/smoke.mjs && node /tmp/smoke.mjs
```

Covers scheduler lanes/retry, chapter detection, language detection, retrieval,
article/case extraction, storyboard generation (4–10 scenes, layout types,
page provenance), extractive Q&A, and the read-aloud reader (language catalog,
any-language detection incl. non-Latin scripts, voice ranking, utterance
chunking).
