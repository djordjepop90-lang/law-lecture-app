import { Scheduler, isRetryableError, extractRetryDelaySeconds, RateLimitError } from '../src/scheduler.ts';
import { detectChapters } from '../src/chapters.ts';
import { detectLanguage, wordCount } from '../src/textutil.ts';
import { retrieveRelevantPages } from '../src/retrieve.ts';
import { generateOutlineLocal, generateStoryboardLocal, answerQuestionLocal, splitIntoSegments, extractArticles, extractCases } from '../src/engine.ts';
import { LANGUAGES, languageName, detectLanguageWide, rankVoices, planUtterances, MAX_UTTERANCE_CHARS } from '../src/reader.ts';

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

// --- read-aloud: language catalog ----------------------------------------------------
ok(LANGUAGES.length >= 50, `language catalog covers >=50 languages (${LANGUAGES.length})`);
ok(new Set(LANGUAGES.map((l) => l.tag)).size === LANGUAGES.length, 'language tags unique');
ok(['en-US', 'de-DE', 'fr-FR', 'es-ES', 'zh-CN', 'ja-JP', 'ko-KR', 'ru-RU', 'ar-SA', 'hi-IN'].every((t) => LANGUAGES.some((l) => l.tag === t)), 'key BCP-47 tags present');
ok(languageName('de-DE') === 'German' && languageName('de-AT') === 'German' && languageName('xx-XX') === 'xx-XX', 'languageName resolves tag/base/unknown');

// --- read-aloud: any-language detection ------------------------------------------------
ok(detectLanguageWide('The court held that the treaty is binding and the parties must comply with the judgment of the ICJ.') === 'en-US', 'wide detect EN');
ok(detectLanguageWide('Der Gerichtshof hat entschieden, dass der Vertrag bindend ist und die Parteien das Urteil befolgen m\u00fcssen. Das ist das Recht.') === 'de-DE', 'wide detect DE');
ok(detectLanguageWide('La cour a d\u00e9cid\u00e9 que le trait\u00e9 est contraignant et les parties doivent se conformer \u00e0 la d\u00e9cision.') === 'fr-FR', 'wide detect FR');
ok(detectLanguageWide('El tribunal decidi\u00f3 que el tratado es vinculante y las partes deben cumplir la sentencia del tribunal.') === 'es-ES', 'wide detect ES');
ok(detectLanguageWide('\u041f\u0440\u0438\u0432\u0435\u0442 \u043c\u0438\u0440, \u044d\u0442\u043e \u0440\u0443\u0441\u0441\u043a\u0438\u0439 \u0442\u0435\u043a\u0441\u0442 \u043e \u0434\u043e\u0433\u043e\u0440\u0435 \u0438 \u0441\u0443\u0434\u0435.') === 'ru-RU', 'wide detect RU (cyrillic)');
ok(detectLanguageWide('\u0426\u0435 \u0443\u043a\u0440\u0430\u0457\u043d\u0441\u044c\u043a\u0438\u0439 \u0442\u0435\u043a\u0441\u0442 \u043f\u0440\u043e \u0434\u043e\u0433\u043e\u0440 \u0456 \u0441\u0443\u0434.') === 'uk-UA', 'wide detect UK (yi/i)');
ok(detectLanguageWide('\u8fd9\u662f\u4e00\u6bb5\u4e2d\u6587\u6587\u672c\uff0c\u5173\u4e8e\u6761\u7ea6\u4e0e\u56fd\u9645\u6cd5\u9662\u3002') === 'zh-CN', 'wide detect ZH (han, no kana)');
ok(detectLanguageWide('\u3053\u308c\u306f\u65e5\u672c\u8a9e\u306e\u30c6\u30ad\u30b9\u30c8\u3067\u3059\u3002\u6761\u7d04\u306b\u3064\u3044\u3066\u8a71\u3057\u307e\u3059\u3002') === 'ja-JP', 'wide detect JA (kana beats han)');
ok(detectLanguageWide('\u0647\u0630\u0627 \u0646\u0635 \u0639\u0631\u0628\u064a \u0639\u0646 \u0627\u0644\u0645\u0639\u0627\u0647\u062f\u0627\u062a \u0648\u0627\u0644\u0645\u062d\u0643\u0645\u0629 \u0627\u0644\u062f\u0648\u0644\u064a\u0629.') === 'ar-SA', 'wide detect AR');
ok(detectLanguageWide('\u092f\u0939 \u090f\u0915 \u0939\u093f\u0902\u0926\u0940 \u0935\u093e\u0915\u094d\u092f \u0939\u0948 \u091c\u094b \u0938\u0902\u0927\u093f \u0915\u0947 \u092c\u093e\u0930\u0947 \u092e\u0947\u0902 \u0939\u0948\u0964') === 'hi-IN', 'wide detect HI (devanagari)');
ok(detectLanguageWide('Lorem ipsum dolor sit amet 12345 !!!') === 'unknown', 'wide detect unknown on weak signal');

// --- read-aloud: voice ranking ---------------------------------------------------------
const fakeVoices = [
  { name: 'Alex', lang: 'en-US', voiceURI: 'alex', localService: true, isDefault: false },
  { name: 'Google US English', lang: 'en-US', voiceURI: 'gus', localService: false, isDefault: false },
  { name: 'Microsoft Aria Neural - English (United States)', lang: 'en-US', voiceURI: 'aria', localService: true, isDefault: true },
  { name: 'Daniel', lang: 'en-GB', voiceURI: 'daniel', localService: true, isDefault: false },
  { name: 'Google Deutsch', lang: 'de-DE', voiceURI: 'gde', localService: false, isDefault: false },
];
const rEn = rankVoices(fakeVoices, 'en-US');
ok(rEn[0].voiceURI === 'aria', 'neural+default voice ranks first for en-US');
ok(rEn.some((v) => v.voiceURI === 'daniel'), 'en-GB matched via base-language prefix for en-US');
ok(rEn.every((v) => v.lang.toLowerCase().startsWith('en')), 'only en voices returned for en-US');
ok(rEn.find((v) => v.voiceURI === 'aria').badge === 'Neural', 'quality badge extracted (Neural)');
ok(rankVoices(fakeVoices, 'de')[0]?.voiceURI === 'gde', 'base tag de matches de-DE voice');
ok(rankVoices(fakeVoices, 'ja-JP').length === 0, 'no ja voices -> empty list');

// --- read-aloud: utterance chunking ------------------------------------------------------
const readerPages = [
  { index: 1, text: 'First sentence here. Second sentence follows! And a third one?', wordCount: 0 },
  { index: 2, text: '', wordCount: 0 },
  { index: 3, text: 'Page three has ' + 'verylongword '.repeat(40) + 'end.', wordCount: 0 },
  { index: 4, text: 'x'.repeat(300), wordCount: 0 },
];
const utts = planUtterances(readerPages, MAX_UTTERANCE_CHARS);
ok(utts.length >= 4, `document chunked into utterances (${utts.length})`);
ok(utts.every((u) => u.text.length <= MAX_UTTERANCE_CHARS || !u.text.includes(' ')), 'chunks within char limit unless a single long word');
ok(utts.every((u) => u.page === 1 || u.page === 3 || u.page === 4), 'empty page skipped, page provenance kept');
ok(utts.filter((u) => u.page === 1).map((u) => u.text).join(' ').includes('Second sentence follows'), 'sentence order preserved');
ok(utts.map((u) => u.text).join(' ').includes('verylongword'), 'long words not dropped');
ok(utts.some((u) => u.page === 4 && u.text.length === 300), 'single overlong word kept as one chunk');

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
