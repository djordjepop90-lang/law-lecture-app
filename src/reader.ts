// Read-aloud planning (pure logic, no DOM, unit-tested in Node):
// - LANGUAGES: languages we can target with a BCP-47 tag
// - detectLanguageWide: auto-detect ANY language (script ranges + Latin stopwords)
// - rankVoices: pick the most natural installed voice for a language
// - planUtterances: chunk document pages into short speakable utterances
//   (browsers cut off very long utterances, so chunks stay small; boundary
//   events still give exact progress inside each chunk)
//
// This file is pure ASCII: every non-ASCII code point appears as a \uXXXX
// escape so no editor/encoding can mangle the ranges.

import type { PageText } from './types';

export interface LangOption {
  code: string; // ISO 639-1, e.g. 'de'
  tag: string; // BCP-47, e.g. 'de-DE'
  name: string;
}

export const LANGUAGES: LangOption[] = [
  { code: 'en', tag: 'en-US', name: 'English' },
  { code: 'de', tag: 'de-DE', name: 'German' },
  { code: 'fr', tag: 'fr-FR', name: 'French' },
  { code: 'es', tag: 'es-ES', name: 'Spanish' },
  { code: 'it', tag: 'it-IT', name: 'Italian' },
  { code: 'pt', tag: 'pt-BR', name: 'Portuguese' },
  { code: 'nl', tag: 'nl-NL', name: 'Dutch' },
  { code: 'pl', tag: 'pl-PL', name: 'Polish' },
  { code: 'cs', tag: 'cs-CZ', name: 'Czech' },
  { code: 'sk', tag: 'sk-SK', name: 'Slovak' },
  { code: 'ru', tag: 'ru-RU', name: 'Russian' },
  { code: 'uk', tag: 'uk-UA', name: 'Ukrainian' },
  { code: 'bg', tag: 'bg-BG', name: 'Bulgarian' },
  { code: 'sr', tag: 'sr-RS', name: 'Serbian' },
  { code: 'hr', tag: 'hr-HR', name: 'Croatian' },
  { code: 'sl', tag: 'sl-SI', name: 'Slovenian' },
  { code: 'ro', tag: 'ro-RO', name: 'Romanian' },
  { code: 'hu', tag: 'hu-HU', name: 'Hungarian' },
  { code: 'el', tag: 'el-GR', name: 'Greek' },
  { code: 'tr', tag: 'tr-TR', name: 'Turkish' },
  { code: 'sv', tag: 'sv-SE', name: 'Swedish' },
  { code: 'da', tag: 'da-DK', name: 'Danish' },
  { code: 'no', tag: 'nb-NO', name: 'Norwegian' },
  { code: 'fi', tag: 'fi-FI', name: 'Finnish' },
  { code: 'et', tag: 'et-EE', name: 'Estonian' },
  { code: 'lv', tag: 'lv-LV', name: 'Latvian' },
  { code: 'lt', tag: 'lt-LT', name: 'Lithuanian' },
  { code: 'ga', tag: 'ga-IE', name: 'Irish' },
  { code: 'cy', tag: 'cy-GB', name: 'Welsh' },
  { code: 'is', tag: 'is-IS', name: 'Icelandic' },
  { code: 'mt', tag: 'mt-MT', name: 'Maltese' },
  { code: 'eu', tag: 'eu-ES', name: 'Basque' },
  { code: 'ca', tag: 'ca-ES', name: 'Catalan' },
  { code: 'gl', tag: 'gl-ES', name: 'Galician' },
  { code: 'af', tag: 'af-ZA', name: 'Afrikaans' },
  { code: 'sw', tag: 'sw-KE', name: 'Swahili' },
  { code: 'id', tag: 'id-ID', name: 'Indonesian' },
  { code: 'ms', tag: 'ms-MY', name: 'Malay' },
  { code: 'tl', tag: 'tl-PH', name: 'Filipino' },
  { code: 'vi', tag: 'vi-VN', name: 'Vietnamese' },
  { code: 'th', tag: 'th-TH', name: 'Thai' },
  { code: 'km', tag: 'km-KH', name: 'Khmer' },
  { code: 'lo', tag: 'lo-LA', name: 'Lao' },
  { code: 'my', tag: 'my-MM', name: 'Burmese' },
  { code: 'zh', tag: 'zh-CN', name: 'Chinese (Mandarin)' },
  { code: 'ja', tag: 'ja-JP', name: 'Japanese' },
  { code: 'ko', tag: 'ko-KR', name: 'Korean' },
  { code: 'ar', tag: 'ar-SA', name: 'Arabic' },
  { code: 'fa', tag: 'fa-IR', name: 'Persian' },
  { code: 'ur', tag: 'ur-PK', name: 'Urdu' },
  { code: 'he', tag: 'he-IL', name: 'Hebrew' },
  { code: 'hi', tag: 'hi-IN', name: 'Hindi' },
  { code: 'bn', tag: 'bn-BD', name: 'Bengali' },
  { code: 'ta', tag: 'ta-IN', name: 'Tamil' },
  { code: 'te', tag: 'te-IN', name: 'Telugu' },
  { code: 'kn', tag: 'kn-IN', name: 'Kannada' },
  { code: 'ml', tag: 'ml-IN', name: 'Malayalam' },
  { code: 'mr', tag: 'mr-IN', name: 'Marathi' },
  { code: 'gu', tag: 'gu-IN', name: 'Gujarati' },
  { code: 'pa', tag: 'pa-IN', name: 'Punjabi' },
  { code: 'si', tag: 'si-LK', name: 'Sinhala' },
  { code: 'ne', tag: 'ne-NP', name: 'Nepali' },
  { code: 'ka', tag: 'ka-GE', name: 'Georgian' },
  { code: 'hy', tag: 'hy-AM', name: 'Armenian' },
  { code: 'az', tag: 'az-AZ', name: 'Azerbaijani' },
  { code: 'kk', tag: 'kk-KZ', name: 'Kazakh' },
  { code: 'uz', tag: 'uz-UZ', name: 'Uzbek' },
  { code: 'mn', tag: 'mn-MN', name: 'Mongolian' },
  { code: 'bo', tag: 'bo-CN', name: 'Tibetan' },
];

function tagOf(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.tag ?? code;
}

export function languageName(tag: string): string {
  const t = tag.toLowerCase();
  return (
    LANGUAGES.find((l) => l.tag.toLowerCase() === t)?.name ??
    LANGUAGES.find((l) => l.code === t.split('-')[0])?.name ??
    tag
  );
}

// Unicode script ranges -> likely language. Kana (Japanese) is counted
// separately from Han so Japanese text is not mistaken for Chinese.
const SCRIPT_RANGES: { re: RegExp; code: string }[] = [
  { re: /[\u3040-\u309f\u30a0-\u30ff\u31f0-\u31ff]/g, code: 'ja' }, // hiragana + katakana
  { re: /[\uac00-\ud7af\u1100-\u11ff]/g, code: 'ko' }, // hangul syllables + jamo
  { re: /[\u4e00-\u9fff\u3400-\u4dbf]/g, code: 'zh' }, // CJK unified ideographs + ext-a
  { re: /[\u0400-\u04ff]/g, code: 'ru' }, // cyrillic
  { re: /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/g, code: 'ar' }, // arabic + supplements
  { re: /[\u0900-\u097f]/g, code: 'hi' }, // devanagari
  { re: /[\u0980-\u09ff]/g, code: 'bn' }, // bengali
  { re: /[\u0a00-\u0a7f]/g, code: 'pa' }, // gurmukhi
  { re: /[\u0a80-\u0aff]/g, code: 'gu' }, // gujarati
  { re: /[\u0b80-\u0bff]/g, code: 'ta' }, // tamil
  { re: /[\u0c00-\u0c7f]/g, code: 'te' }, // telugu
  { re: /[\u0c80-\u0cff]/g, code: 'kn' }, // kannada
  { re: /[\u0d00-\u0d7f]/g, code: 'ml' }, // malayalam
  { re: /[\u0d80-\u0dff]/g, code: 'si' }, // sinhala
  { re: /[\u0e00-\u0e7f]/g, code: 'th' }, // thai
  { re: /[\u0e80-\u0eff]/g, code: 'lo' }, // lao
  { re: /[\u1000-\u109f]/g, code: 'my' }, // myanmar
  { re: /[\u1780-\u17ff]/g, code: 'km' }, // khmer
  { re: /[\u0f00-\u0fff]/g, code: 'bo' }, // tibetan
  { re: /[\u0370-\u03ff\u1f00-\u1fff]/g, code: 'el' }, // greek
  { re: /[\u0590-\u05ff]/g, code: 'he' }, // hebrew
  { re: /[\u10a0-\u10ff]/g, code: 'ka' }, // georgian
  { re: /[\u0530-\u058f]/g, code: 'hy' }, // armenian
];

// Stopwords for Latin-script languages (matched with surrounding spaces).
const LATIN_STOP: [string, string[]][] = [
  ['en', [' the ', ' and ', ' of ', ' to ', ' that ', ' with ', ' is ']],
  ['de', [' der ', ' die ', ' und ', ' das ', ' ist ', ' nicht ', ' von ']],
  ['fr', [' le ', ' la ', ' les ', ' des ', ' est ', ' pour ', ' une ', ' dans ']],
  ['es', [' el ', ' la ', ' los ', ' las ', ' que ', ' para ', ' con ', ' est\u00e1 ']],
  ['it', [' il ', ' lo ', ' che ', ' per ', ' non ', ' sono ', ' della ']],
  ['pt', [' n\u00e3o ', ' para ', ' com ', ' uma ', ' dos ', ' das ', ' que ']],
  ['nl', [' het ', ' een ', ' van ', ' niet ', ' met ', ' zijn ', ' de ']],
  ['pl', [' nie ', ' jest ', ' oraz ', ' dla ', ' si\u0119 ', ' \u017ce ']],
  ['cs', [' \u017ee ', ' jsou ', ' nebo ', ' pro ', ' tak\u00e9 ']],
  ['sk', [' \u017ee ', ' alebo ', ' pre ', ' tak\u017ee ']],
  ['ro', [' \u0219i ', ' este ', ' pentru ', ' care ', ' din ']],
  ['hu', [' hogy ', ' \u00e9s ', ' egy ', ' nem ', ' meg ']],
  ['sv', [' och ', ' att ', ' det ', ' \u00e4r ', ' som ']],
  ['da', [' og ', ' at ', ' det ', ' som ', ' ikke ']],
  ['no', [' og ', ' ikke ', ' som ', ' dette ', ' har ']],
  ['fi', [' ja ', ' on ', ' ei ', ' ett\u00e4 ']],
  ['et', [' ja ', ' on ', ' ei ', ' et ']],
  ['lv', [' un ', ' ir ', ' nav ', ' ka ']],
  ['lt', [' ir ', ' kad ', ' bet ', ' yra ']],
  ['tr', [' i\u00e7in ', ' ve ', ' bir ', ' bu ', ' ile ']],
  ['id', [' dan ', ' yang ', ' di ', ' tidak ', ' dengan ']],
  ['ms', [' dan ', ' yang ', ' di ', ' tidak ', ' dengan ']],
  ['vi', [' c\u1ee7a ', ' v\u00e0 ', ' l\u00e0 ', ' \u0111\u01b0\u1ee3c ', ' c\u00e1c ']],
  ['sw', [' na ', ' ya ', ' kwa ', ' wa ', ' ni ']],
  ['hr', [' nije ', ' bio ', ' ili ', ' nego ']],
  ['sl', [' in ', ' je ', ' na ', ' se ', ' za ']],
  ['ga', [' agus ', ' an ', ' ar ', ' leis ']],
  ['cy', [' ac ', ' yr ', ' yn ', ' ei ']],
  ['is', [' og ', ' er ', ' ekki ', ' a\u00f0 ']],
  ['mt', [' li ', ' tal-', ' il-', ' mhux ']],
  ['eu', [' eta ', ' ez ', ' du ', ' bat ']],
  ['ca', [' dels ', ' que ', ' \u00e9s ', ' per ']],
  ['gl', [' que ', ' non ', ' dos ', ' das ']],
  ['af', [' die ', ' en ', ' van ', ' nie ']],
  ['tl', [' ang ', ' ng ', ' sa ', ' na ']],
];

// Detect the language of arbitrary text. Returns a BCP-47 tag from LANGUAGES,
// or 'unknown' when there is not enough signal. Script ranges decide for
// non-Latin scripts; Latin text goes through the stopword heuristic.
export function detectLanguageWide(text: string): string {
  const sample = text.slice(0, 20000);
  const counts = new Map<string, number>();
  for (const s of SCRIPT_RANGES) {
    const m = sample.match(s.re);
    if (m && m.length) counts.set(s.code, m.length);
  }
  const kana = counts.get('ja') ?? 0;
  const han = counts.get('zh') ?? 0;
  let best = '';
  let bestN = 0;
  for (const [code, n] of counts) if (n > bestN) { best = code; bestN = n; }
  if (kana >= 3 && kana >= han) { best = 'ja'; bestN = kana; } // kana present -> Japanese, not Chinese
  if (best && bestN >= 8) {
    if (best === 'ru') {
      if (/[\u0454\u0456\u0457\u0491]/u.test(sample)) return tagOf('uk'); // uk: \u0454 \u0456 \u0457 \u0491
      if (/[\u044a]/u.test(sample)) return tagOf('bg'); // bg: hard sign \u044a
      if (/[\u0452\u0458\u0459\u045a\u045b\u045f]/u.test(sample)) return tagOf('sr');
      return tagOf('ru');
    }
    if (best === 'ar') {
      if (/[\u067e\u06af\u0686\u06cc]/u.test(sample)) return tagOf('fa'); // persian letters
      if (/[\u0679\u0688\u0691\u06d2]/u.test(sample)) return tagOf('ur'); // urdu letters
      return tagOf('ar');
    }
    return tagOf(best);
  }
  const low = ` ${sample.toLowerCase()} `;
  const scores = new Map<string, number>();
  for (const [code, words] of LATIN_STOP) {
    let n = 0;
    for (const w of words) if (low.includes(w)) n++;
    if (n) scores.set(code, n);
  }
  // Stopwords are shared across languages (' que ', ' la ', ...), so a raw
  // share-of-total threshold misfires; require a clear winner instead.
  let top = '';
  let topN = 0;
  let secondN = 0;
  let total = 0;
  for (const [code, n] of scores) {
    total += n;
    if (n > topN) { secondN = topN; top = code; topN = n; } else if (n > secondN) { secondN = n; }
  }
  if (top && total >= 4 && topN >= 3 && topN > secondN) return tagOf(top);
  return 'unknown';
}

export interface VoiceLike {
  name: string;
  lang: string;
  voiceURI: string;
  localService?: boolean;
  isDefault?: boolean;
}

export interface RankedVoice extends VoiceLike {
  score: number;
  badge: string; // e.g. 'Neural' — shown in the UI
}

// Quality signals in voice names across vendors: Microsoft "... Neural", Apple
// "Siri ... (Premium)", Google cloud voices, Amazon Polly, WaveNet/Journey etc.
const QUALITY: [RegExp, number, string][] = [
  [/neural/i, 30, 'Neural'],
  [/premium/i, 25, 'Premium'],
  [/siri/i, 25, 'Siri'],
  [/wavenet/i, 22, 'WaveNet'],
  [/journey/i, 22, 'Journey'],
  [/enhanced/i, 20, 'Enhanced'],
  [/eloquence/i, 20, 'Premium'],
  [/polyglot/i, 16, 'Polyglot'],
  [/multilingual/i, 16, 'Multilingual'],
  [/natural/i, 15, 'Natural'],
  [/\bhd\b/i, 12, 'HD'],
  [/google/i, 8, 'Google'],
  [/microsoft/i, 5, ''],
  [/amazon|polly/i, 5, ''],
];

// All installed voices usable for `tag` (exact locale first, then same base
// language), ranked so the most natural one is picked by default.
export function rankVoices(voices: VoiceLike[], tag: string): RankedVoice[] {
  const base = tag.split('-')[0].toLowerCase();
  const norm = (l: string) => l.toLowerCase().replace('_', '-');
  const out: RankedVoice[] = [];
  for (const v of voices) {
    const vl = norm(v.lang);
    if (vl !== norm(tag) && vl.split('-')[0] !== base) continue;
    let score = vl === norm(tag) ? 100 : 60;
    let badge = '';
    for (const [re, pts, label] of QUALITY) {
      if (re.test(v.name)) {
        score += pts;
        if (!badge && label) badge = label;
      }
    }
    if (v.isDefault) score += 6;
    if (v.localService === false) score += 8; // remote voices on Chromium/Edge are the neural ones
    out.push({ ...v, score, badge });
  }
  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

export interface Utterance {
  text: string;
  page: number; // 1-based source page/slide
}

// Keep utterances short: some browsers silently stop long utterances after
// ~15 s, and short chunks give smooth progress via boundary events.
export const MAX_UTTERANCE_CHARS = 180;

function splitSentences(text: string): string[] {
  const out: string[] = [];
  const re = /[^.!?\u2026\u00a1\u00bf]+[.!?\u2026\u00a1\u00bf]*["'\u2019\u201d)\]]*\s*/g;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(text)) !== null) {
    const s = m[0].trim();
    if (s) out.push(s);
    last = re.lastIndex;
  }
  const rest = text.slice(last).trim();
  if (rest) out.push(rest);
  return out;
}

// Flatten pages into a queue of utterances, splitting at sentence boundaries
// and hard-splitting overlong sentences at word boundaries. Page provenance is
// kept so the UI can show "now reading page X".
export function planUtterances(pages: PageText[], maxChars = MAX_UTTERANCE_CHARS): Utterance[] {
  const out: Utterance[] = [];
  for (const p of pages) {
    const text = p.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    let cur = '';
    const flush = () => {
      const t = cur.trim();
      if (t) out.push({ text: t, page: p.index });
      cur = '';
    };
    for (const sentence of splitSentences(text)) {
      let pieces = [sentence];
      if (sentence.length > maxChars) {
        pieces = [];
        let part = '';
        for (const w of sentence.split(' ')) {
          if (part && part.length + 1 + w.length > maxChars) {
            pieces.push(part);
            part = w;
          } else {
            part = part ? part + ' ' + w : w;
          }
        }
        if (part) pieces.push(part);
      }
      for (const piece of pieces) {
        if (cur && cur.length + 1 + piece.length > maxChars) flush();
        cur = cur ? cur + ' ' + piece : piece;
      }
    }
    flush();
  }
  return out;
}
