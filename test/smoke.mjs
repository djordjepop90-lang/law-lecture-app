import { Scheduler, isRetryableError, extractRetryDelaySeconds, RateLimitError } from '../src/scheduler.ts';
import { detectChapters } from '../src/chapters.ts';
import { detectLanguage, wordCount } from '../src/textutil.ts';
import { retrieveRelevantPages } from '../src/retrieve.ts';
import { generateOutlineLocal, generateStoryboardLocal, answerQuestionLocal, splitIntoSegments, extractArticles, extractCases } from '../src/engine.ts';

let failures = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS' : 'FAIL') + ' - ' + msg); if (!cond) failures++; };

// --- scheduler still sequences lanes and retries ---------------------------------
const events = [];
const s = new Scheduler({
  backoffStartSeconds: 0.05, backoffMaxSeconds: 0.2, maxAttempts: 8,
  ttsMinGapSeconds: 0.1, textMinGapSeconds: 0.05, slowModeMultiplier: 2,
});
s.onEvent((e) => events.push(e));
let calls = 0;
const res = await s.enqueue('text', 'test task', async () => {
  calls++;
  if (calls < 3) throw new RateLimitError('429 quota', 0.12);
  return 'ok';
});
ok(res === 'ok' && calls === 3, `scheduler retried then succeeded (calls=${calls})`);
ok(events.some((e) => e.status === 'waiting-retry' && e.retryInSeconds > 0), 'waiting-retry events carried countdown');
let calls2 = 0;
try { await s.enqueue('text', 'bad', async () => { calls2++; throw new Error('400 INVALID'); }); } catch {}
ok(calls2 === 1, 'non-retryable error not retried');
const t1 = Date.now();
await s.enqueue('tts', 'a', async () => 1);
await s.enqueue('tts', 'b', async () => 2);
ok(Date.now() - t1 >= 95, 'lane gap enforced');
ok(isRetryableError({ status: 429 }) && !isRetryableError(new Error('400')), 'retryable detection');
ok(extractRetryDelaySeconds({ details: [{ retryDelay: '17.5s' }] }) === 17.5, 'retryDelay parsed');

// --- chapters ---------------------------------------------------------------------
const pages = [];
for (let i = 1; i <= 20; i++) {
  const heading = [1, 8, 15].includes(i) ? `Chapter ${i === 1 ? 1 : i === 8 ? 2 : 3} Sources of International Law. Some words here` : `Body text page ${i} about treaties and custom and the ICJ.`;
  pages.push({ index: i, text: heading.repeat(30), wordCount: wordCount(heading.repeat(30)) });
}
const chs = detectChapters(pages, 'pdf');
ok(chs.length === 3 && chs[0].pageStart === 1 && chs[2].pageEnd === 20, `heading chapters (${chs.length})`);
const flat = Array.from({ length: 20 }, (_, i) => ({ index: i + 1, text: `ordinary body text page ${i + 1} `.repeat(40), wordCount: 0 }));
ok(detectChapters(flat.map((p) => ({ ...p, wordCount: wordCount(p.text) })), 'pdf').length >= 2, 'fallback chunking');

// --- language ----------------------------------------------------------------------
ok(detectLanguage('The court held that the treaty is binding and the parties must comply with the judgment of the ICJ. This is the law.') === 'en', 'EN detected');
ok(detectLanguage('Der Gerichtshof hat entschieden, dass der Vertrag bindend ist und die Parteien das Urteil befolgen müssen. Das ist das Recht.') === 'de', 'DE detected');
ok(detectLanguage('La cour a décidé que le traité est contraignant et que les parties doivent se conformer à l\'arrêt. C\'est le droit.') === 'fr', 'FR detected');

// --- retrieval ---------------------------------------------------------------------
const rpages = [
  { index: 1, text: 'Art. 2(4) UN Charter prohibits the threat or use of force against the territorial integrity of any state.', wordCount: 0 },
  { index: 2, text: 'The ICJ in Nicaragua v USA discussed attribution of armed attacks and effective control.', wordCount: 0 },
  { index: 3, text: 'VCLT Art. 31 covers general rule of interpretation of treaties in good faith.', wordCount: 0 },
];
ok(retrieveRelevantPages('What does Art. 2(4) of the UN Charter say about use of force?', rpages, 'en', 2)[0]?.page === 1, 'retrieval ranks Art 2(4) first');

// --- local engine: citations ---------------------------------------------------------
const src = `[Page 1] Art. 2(4) UN Charter prohibits the use of force. The ICJ in Nicaragua v. United States (1986) held that effective control is required for attribution. Art. 51 UN Charter preserves the inherent right of self-defence. [Page 2] The principle of non-intervention was confirmed in the Corfu Channel case (1949). pacta sunt servanda means agreements must be kept.`;
ok(extractArticles(src).some((a) => a.includes('2(4)')), 'articles extracted');
ok(extractCases(src).some((c) => c.name.includes('Nicaragua') && c.year === '1986' && c.court === 'ICJ'), 'case extracted with court+year');

// --- segments keep page provenance ----------------------------------------------------
const segs = splitIntoSegments(src + ' '.repeat(1) + 'More text here. '.repeat(120), 60);
ok(segs.length >= 2 && segs.every((g) => g.pages.length > 0), `segments carry page markers (${segs.length} segments)`);

// --- outline ----------------------------------------------------------------------------
const outline = generateOutlineLocal(src, 'en');
ok(outline.articles.length >= 2 && outline.cases.some((c) => c.includes('Nicaragua')), 'outline has articles + cases');
ok(outline.summary.length > 20, 'outline summary');

// --- storyboard ---------------------------------------------------------------------------
const longText = Array.from({ length: 40 }, (_, i) => `[Page ${i + 1}] Sentence ${i + 1}: The legal test has two elements and the ICJ in Nicaragua v. United States (1986) held effective control is required, while Art. 51 UN Charter preserves self-defence and Art. 2(4) UN Charter prohibits force.`).join(' ');
const sb = generateStoryboardLocal('ch-1', 'Use of Force', longText, outline, 'en');
ok(sb.scenes.length >= 4 && sb.scenes.length <= 10, `storyboard has 4-10 scenes (${sb.scenes.length})`);
ok(sb.scenes.every((sc) => sc.narration.split(/\s+/).length >= 100 && sc.narration.split(/\s+/).length <= 280), 'narration word band ok');
ok(sb.scenes.every((sc) => ['LEGAL_TEST', 'CASE_COMPARISON', 'TREATY_DIAGRAM', 'KEY_TAKEAWAYS'].includes(sc.layoutType)), 'layout types valid');
ok(sb.scenes.some((sc) => sc.layoutType === 'LEGAL_TEST' || sc.layoutType === 'CASE_COMPARISON' || sc.layoutType === 'TREATY_DIAGRAM'), 'classification produced structured layouts');
ok(sb.scenes.every((sc) => sc.sourcePages.length > 0 && Array.isArray(sc.citations)), 'scenes carry sourcePages + citations');
const td = sb.scenes.find((sc) => sc.layoutType === 'TREATY_DIAGRAM');
if (td) ok(td.layoutData.nodes.length >= 2, 'treaty diagram has nodes');

// --- Q&A -----------------------------------------------------------------------------------
const qaPages = [
  { index: 1, text: 'Art. 2(4) UN Charter prohibits the threat or use of force against the territorial integrity or political independence of any state.', wordCount: 0 },
  { index: 2, text: 'Art. 51 UN Charter preserves the inherent right of individual or collective self-defence if an armed attack occurs.', wordCount: 0 },
];
const qa = answerQuestionLocal('When is self-defence allowed under the UN Charter?', qaPages, 'en', null);
ok(qa.foundInMaterial && qa.pageReferences.includes(2) && /self-defence/i.test(qa.answer), 'Q&A finds self-defence on page 2');
const qa2 = answerQuestionLocal('What is the capital of France?', qaPages, 'en', null);
ok(!qa2.foundInMaterial, 'Q&A says not-in-material when irrelevant');

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
