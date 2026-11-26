// Local rule-based lecture engine. Replaces any cloud LLM: outlines,
// storyboards and Q&A are extracted directly from the uploaded document with
// deterministic NLP heuristics (citations, cases, legal tests, glossary).
// Everything runs through the scheduler's text lane so the UI/status bar
// behave exactly as before.

import type { LanguageCode, Outline, Scene, Storyboard, LayoutType, PageText } from './types';
import { LANGUAGE_NAMES } from './types';
import { wordCount } from './textutil';
import { retrieveRelevantPages } from './retrieve';

// --- sentence / segment utilities -------------------------------------------

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .match(/[^.!?]+[.!?]+["'”’)]?\s*|[^.!?]+$/g)
    ?.map((s) => s.trim())
    .filter((s) => s.length > 1) ?? [];
}

function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

// Split text (with [Page N] markers) into segments of roughly targetWords,
// keeping page provenance per segment.
export function splitIntoSegments(text: string, targetWords: number): { text: string; pages: number[] }[] {
  const sentences = splitSentences(text.replace(/\[Page (\d+)\]/g, ' ¶PAGE$1¶ '));
  const segments: { text: string; pages: number[] }[] = [];
  let cur = '';
  let curPages: number[] = [];
  let lastPage = 0; // page provenance carries forward across sentences
  const push = () => {
    if (cur.trim()) segments.push({ text: cur.trim(), pages: [...new Set(curPages)].sort((a, b) => a - b) });
    cur = '';
    curPages = [];
  };
  for (const s of sentences) {
    const pageMarks = [...s.matchAll(/¶PAGE(\d+)¶/g)].map((m) => parseInt(m[1], 10));
    if (pageMarks.length) lastPage = pageMarks[pageMarks.length - 1];
    const effective = pageMarks.length ? pageMarks : (lastPage ? [lastPage] : []);
    for (const p of effective) if (!curPages.includes(p)) curPages.push(p);
    const clean = s.replace(/¶PAGE\d+¶/g, '').trim();
    cur += (cur ? ' ' : '') + clean;
    if (wordCount(cur) >= targetWords) push();
  }
  push();
  return segments;
}

// --- citation extraction ------------------------------------------------------

const ARTICLE_RE = /(?:Art\.?|Article|Artikel|Articolo|Article)\s*\d+[a-z]?(?:\s*\(\d+[a-z]?\))?(?:\s*(?:UN Charter|ICJ Statute|VCLT|Geneva Convention|Rome Statute|ECHR|ICESCR|ICCPR))?/gi;
const CASE_RE = /\b([A-Z][\wÀ-ÿ'’.-]+(?:\s+(?:v\.?|vs\.?|c\.?|gegen|contre)\s+)?[A-Z][\wÀ-ÿ'’.-]*(?:\s+[A-Z][\wÀ-ÿ'’.-]+){0,3}?)\s*[\(\[]?(\d{4})[\)\]]?/g;
const COURT_RE = /\b(ICJ|ICC|PCIJ|CJEU|ECtHR|IACtHR|ITLOS|WTO Appellate Body|UN Human Rights Committee)\b/g;

export function extractArticles(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(ARTICLE_RE)) found.add(m[0].replace(/\s+/g, ' ').trim());
  return [...found];
}

export function extractCases(text: string): { name: string; year: string; court: string }[] {
  const cases: { name: string; year: string; court: string }[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(CASE_RE)) {
    const name = m[1].replace(/\s+/g, ' ').trim();
    const year = m[2];
    if (seen.has(name + year)) continue;
    seen.add(name + year);
    // court: nearest court keyword within 120 chars around the match
    const around = text.slice(Math.max(0, m.index! - 120), m.index! + name.length + 40);
    const cm = around.match(COURT_RE); // global regex: match() returns whole matches
    cases.push({ name, year, court: cm ? cm[0] : '' });
  }
  return cases;
}

// --- glossary ---------------------------------------------------------------

export function extractGlossaryTerms(text: string, limit = 8): { term: string; definition: string }[] {
  const terms: { term: string; definition: string }[] = [];
  const seen = new Set<string>();
  // "X means ..." / "X is ..." / "X bezeichnet ..." / "X est ..."
  const defRe = /([A-Z][\wÀ-ÿ'’-]*(?:\s+[a-zà-ÿ][\wÀ-ÿ'’-]+){0,3}?)\s+(?:means|is defined as|refers to|bezeichnet|ist definiert als|désigne|est défini comme)\s+([^.!?]+[.!?])/gi;
  for (const m of text.matchAll(defRe)) {
    const term = m[1].trim();
    if (term.length < 3 || term.length > 40 || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    terms.push({ term, definition: m[2].trim() });
    if (terms.length >= limit) break;
  }
  return terms;
}

// --- outline (Pass 1) ----------------------------------------------------------

export function generateOutlineLocal(chapterText: string, language: LanguageCode | 'unknown'): Outline {
  const articles = extractArticles(chapterText);
  const cases = extractCases(chapterText).map((c) => `${c.court ? c.court + ', ' : ''}${c.name}, ${c.year}`);
  // key concepts: frequent capitalized non-stopword terms
  const freq = new Map<string, number>();
  for (const w of splitWords(chapterText)) {
    if (/^[A-ZÀ-Þ][a-zà-ÿ]{4,}$/.test(w) && !STOP_EN.has(w.toLowerCase())) {
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }
  const keyConcepts = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w]) => w);
  const sentences = splitSentences(chapterText);
  const summary = sentences.slice(0, 3).join(' ');
  return {
    chapterId: '',
    keyConcepts,
    articles,
    cases,
    summary: summary || chapterText.slice(0, 400),
  };
}

const STOP_EN = new Set(('the a an and or of to in on for with is are was were be by at as it its this that these those under article court treaty chapter section part shall may must state states law legal right rights obligation obligations case judgment judgment'.split(' ')));

// --- storyboard (Pass 2) --------------------------------------------------------

const T = {
  en: {
    open: (title: string) => `Let's turn to ${title}. `,
    ask: (title: string) => `But what exactly is ${title.replace(/[.:]$/, '')}? `,
    mid: 'Notice in particular that ',
    close: 'Keep this in mind — it will matter for the exam. ',
    unclear: 'The source material is not entirely clear on this point, so we state it exactly as given. ',
  },
  de: {
    open: (title: string) => `Wenden wir uns ${title}. `,
    ask: (title: string) => `Aber was genau bedeutet ${title.replace(/[.:]$/, '')}? `,
    mid: 'Beachten Sie insbesondere, dass ',
    close: 'Merken Sie sich das — das ist prüfungsrelevant. ',
    unclear: 'Die Vorlage ist zu diesem Punkt nicht ganz eindeutig, daher geben wir sie exakt so wieder. ',
  },
  fr: {
    open: (title: string) => `Examinons maintenant : ${title}. `,
    ask: (title: string) => `Mais que signifie exactement ${title.replace(/[.:]$/, '')} ? `,
    mid: 'Notez en particulier que ',
    close: 'Retenez ceci — ce sera pertinent pour l\'examen. ',
    unclear: 'Le document source n\'est pas tout à fait clair sur ce point ; nous le restituons tel quel. ',
  },
} as const;

function classifyLayout(segText: string, outline: Outline): LayoutType {
  const t = segText.toLowerCase();
  if (/\b(test|elements?|criterion|criteria|effective control|zwei-?element|doppelte? kontrolle|contrôle effectif)\b/.test(t) && splitSentences(segText).length >= 3) return 'LEGAL_TEST';
  if (extractCases(segText).length >= 1 && /\b(facts|holding|ratio|issue|judgment|held|found)\b/i.test(t)) return 'CASE_COMPARISON';
  if (extractArticles(segText).length >= 2) return 'TREATY_DIAGRAM';
  return 'KEY_TAKEAWAYS';
}

function buildLayoutData(layout: LayoutType, segText: string): Scene['layoutData'] {
  const sentences = splitSentences(segText);
  if (layout === 'LEGAL_TEST') {
    // steps from enumerated markers: "First/Second/...", "(a) (b)", "1. 2.", "firstly"
    const steps: { label: string; criterion: string; authority?: string }[] = [];
    const enumRe = /(?:^|\s)(?:first(?:ly)?|second(?:ly)?|third(?:ly)?|fourth(?:ly)?|fifth(?:ly)?|erstens|zweitens|drittens|premièrement|deuxièmement|troisièmement|\(?[a-e]\)|\d+\.)\s*([^.!?]*(?:[.!?]))/gi;
    for (const m of segText.matchAll(enumRe)) {
      const label = m[0].trim().replace(/[.!?]+\s*$/, '');
      steps.push({ label, criterion: m[1].trim(), authority: extractArticles(m[1])[0] });
    }
    if (steps.length < 2) {
      // fall back: split sentences into steps
      sentences.slice(0, 5).forEach((s, i) => steps.push({ label: `Step ${i + 1}`, criterion: s, authority: extractArticles(s)[0] }));
    }
    return { steps };
  }
  if (layout === 'CASE_COMPARISON') {
    const cases = extractCases(segText).map((c) => {
      const idx = segText.indexOf(c.name);
      const around = segText.slice(Math.max(0, idx - 200), idx + 400);
      const ss = splitSentences(around);
      return {
        name: c.name, court: c.court || 'international court', year: c.year,
        parties: c.name,
        facts: ss[0] ?? '',
        issue: ss.find((s) => /\b(issue|question|whether|problem)\b/i.test(s)) ?? ss[1] ?? '',
        holding: ss.find((s) => /\b(held|found|decided|ruled|concluded)\b/i.test(s)) ?? ss[2] ?? '',
        ratio: ss[ss.length - 1] ?? '',
      };
    });
    return { cases };
  }
  if (layout === 'TREATY_DIAGRAM') {
    const articles = extractArticles(segText);
    const nodes = articles.slice(0, 8).map((a, i) => ({
      id: `n${i + 1}`,
      label: a,
      kind: (/except|unless|notwithstanding|abweichend|sauf|à moins que/i.test(segText.slice(segText.indexOf(a), segText.indexOf(a) + 120)) ? 'exception' : /shall|must|obligation|verpflichtet|obligation/i.test(segText.slice(segText.indexOf(a), segText.indexOf(a) + 120)) ? 'obligation' : 'norm') as 'norm' | 'exception' | 'obligation',
    }));
    const edges = nodes.slice(1).map((n, i) => ({
      from: nodes[i].id, to: n.id,
      label: (segText.match(/in accordance with|subject to| pursuant to|gemäß|conformément|à moins que| vorbehaltlich/i) || ['relates to'])[0],
    }));
    return { nodes, edges };
  }
  // KEY_TAKEAWAYS
  const takeaways = sentences.slice(0, 5);
  const examTraps = sentences
    .filter((s) => /\b(not|however|but|never|only|exception|missconception|do not|nicht|jedoch|mais|cependant)\b/i.test(s))
    .slice(0, 4)
    .map((s) => {
      const parts = s.split(/\b(but|however|jedoch|mais|cependant)\b/i);
      return parts.length > 1
        ? { trap: parts[0].trim(), correction: parts.slice(1).join(' but ').trim() }
        : { trap: s.slice(0, Math.floor(s.length / 2)), correction: s.slice(Math.floor(s.length / 2)) };
    });
  return { takeaways, examTraps };
}

function buildNarration(layout: LayoutType, title: string, segText: string, lang: LanguageCode | 'unknown'): string {
  const L = T[lang as LanguageCode] ?? T.en;
  const sentences = splitSentences(segText);
  const body = sentences.slice(0, 14).join(' ');
  let narration = L.open(title) + L.ask(title) + body + ' ';
  if (layout === 'LEGAL_TEST') narration += L.mid + 'the elements must be examined step by step. ';
  if (layout === 'CASE_COMPARISON') narration += L.mid + 'the holding and the ratio decidendi are decisive. ';
  if (layout === 'TREATY_DIAGRAM') narration += L.mid + 'the relationship between the provisions matters. ';
  narration += L.close;
  // clamp into the 180-260 word band when possible
  const words = splitWords(narration);
  if (words.length > 260) narration = words.slice(0, 260).join(' ');
  if (words.length < 180 && sentences.length > 14) narration = (L.open(title) + body + ' ' + sentences.slice(14, 24).join(' ') + ' ' + L.close);
  return narration.replace(/\s+/g, ' ').trim();
}

export function generateStoryboardLocal(
  chapterId: string,
  chapterLabel: string,
  chapterText: string,
  outline: Outline,
  language: LanguageCode | 'unknown',
): Storyboard {
  const totalWords = wordCount(chapterText);
  // aim for 4-10 scenes of ~200 words narration
  const target = Math.max(140, Math.min(240, Math.floor(totalWords / 7)));
  const segments = splitIntoSegments(chapterText, target);
  const sceneCount = Math.max(1, Math.min(10, segments.length));
  const scenes: Scene[] = segments.slice(0, sceneCount).map((seg, i) => {
    const layout = classifyLayout(seg.text, outline);
    const firstSentence = splitSentences(seg.text)[0] ?? `Scene ${i + 1}`;
    const title = firstSentence.length <= 80 ? firstSentence.replace(/[.!?]+$/, '') : `${chapterLabel} — part ${i + 1}`;
    const citations = [
      ...extractArticles(seg.text),
      ...extractCases(seg.text).map((c) => `${c.court ? c.court + ', ' : ''}${c.name} (${c.year})`),
    ];
    return {
      id: `${chapterId}-scene-${i + 1}`,
      title,
      layoutType: layout,
      narration: buildNarration(layout, title, seg.text, language),
      citations,
      sourcePages: seg.pages,
      layoutData: buildLayoutData(layout, seg.text),
      glossaryTerms: extractGlossaryTerms(seg.text, 5),
    };
  });
  return { chapterId, scenes, generatedAt: Date.now() };
}

// --- Q&A (extractive, local) -----------------------------------------------------

export interface LocalAnswer {
  answer: string;
  pageReferences: number[];
  foundInMaterial: boolean;
}

export function answerQuestionLocal(
  question: string,
  pages: PageText[],
  lang: string,
  currentScene?: { title: string; narration: string } | null,
): LocalAnswer {
  const hits = retrieveRelevantPages(question, pages, lang, 4);
  if (hits.length === 0) {
    return { answer: notFound(lang), pageReferences: [], foundInMaterial: false };
  }
  // rank individual sentences by keyword overlap with the question
  const qTokens = new Set(question.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 3));
  const scored: { s: string; page: number; score: number }[] = [];
  for (const h of hits) {
    for (const s of splitSentences(h.text)) {
      const st = s.toLowerCase();
      let score = 0;
      for (const t of qTokens) if (st.includes(t)) score++;
      if (score > 0) scored.push({ s, page: h.page, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 4);
  if (top.length === 0 || top[0].score < 2) {
    return { answer: notFound(lang), pageReferences: [], foundInMaterial: false };
  }
  const pages_ = [...new Set(top.map((t) => t.page))].sort((a, b) => a - b);
  const answer = top.map((t) => t.s).join(' ') + (currentScene ? ` (Related scene: "${currentScene.title}".)` : '');
  return { answer, pageReferences: pages_, foundInMaterial: true };
}

function notFound(lang: string): string {
  if (lang === 'de') return 'Dazu finde ich in den hochgeladenen Unterlagen keine Passage. Bitte prüfen Sie, ob das Thema im Dokument behandelt wird.';
  if (lang === 'fr') return 'Je ne trouve aucun passage à ce sujet dans le document téléchargé. Veuillez vérifier si le sujet y est traité.';
  return 'I could not find any passage in the uploaded material that answers this. Please check whether the topic is covered in the document.';
}

export { LANGUAGE_NAMES };
