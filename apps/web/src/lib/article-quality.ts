/**
 * Article quality score (0–100) shown on the review page.
 *
 * A fixed checklist, no AI involved, so the same text always gets the same
 * score. Inspired by the content scorer and SEO quality rater of SEO Machine
 * (github.com/TheCraigHewitt/seomachine, MIT), adapted to Dutch and to this
 * app: keyword placement, meta lengths, structure, paragraph and sentence
 * length, Dutch readability (Flesch-Douma) and typical AI phrases.
 * The score helps the reviewer; the decision stays with the reviewer.
 */

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface QualityCheck {
  id: string;
  label: string;
  status: CheckStatus;
  points: number;
  max: number;
  detail: string;
}

export interface QualityInput {
  content: string;
  primaryKeyword: string;
  metaTitle?: string;
  metaDescription?: string;
}

export interface QualityResult {
  score: number;
  grade: 'Uitstekend' | 'Goed' | 'Voldoende' | 'Onvoldoende';
  checks: QualityCheck[];
  stats: { words: number; sentences: number; paragraphs: number; h2: number; avgSentenceWords: number; readability: number | null };
}

/** Phrases that make Dutch text sound machine-written. */
export const AI_PHRASES: Array<[RegExp, string]> = [
  [/\bin de (?:huidige |moderne |snelle |digitale )*wereld van\b/gi, 'in de wereld van'],
  [/\bin (?:de|het) huidige (?:digitale|snelle|moderne)\b/gi, 'in de huidige digitale/snelle…'],
  [/\bhet is (?:belangrijk|essentieel|cruciaal) om (?:te )?(?:weten|onthouden|begrijpen|benadrukken|op te merken)\b/gi, 'het is belangrijk om te…'],
  [/\blaten we (?:eens )?(?:kijken|duiken|beginnen)\b/gi, 'laten we eens kijken'],
  [/\b(?:duik|duiken) (?:we )?(?:dieper )?in\b/gi, 'duiken in'],
  [/\bspee?lt\b[^.!?]{0,40}?\been (?:cruciale|essenti[eë]le|belangrijke|sleutel)rol\b|\bspee?lt\b[^.!?]{0,40}?\been (?:cruciale|essenti[eë]le|belangrijke) rol\b/gi, 'speelt een cruciale rol'],
  [/\bhet is geen geheim dat\b/gi, 'het is geen geheim dat'],
  [/\bin een notendop\b/gi, 'in een notendop'],
  [/\bnaadloo?s(?:e)?\b/gi, 'naadloos'],
  [/\b(?:baanbrekend|revolutionair)(?:e)?\b/gi, 'baanbrekend/revolutionair'],
  [/\bgame[- ]?changer\b/gi, 'gamechanger'],
  [/\been wereld van verschil\b/gi, 'een wereld van verschil'],
  [/\bof je nu\b[^.!?]{0,60}\bof\b/gi, 'of je nu … of …'],
  [/\bontdek (?:hoe|waarom|alles)\b/gi, 'ontdek hoe/waarom'],
  [/\bin deze (?:blog|blogpost|gids)(?: gaan we| ontdek je| lees je)\b/gi, 'in deze blog gaan we…'],
  [/\bniet alleen\b[^.!?]{0,80}\bmaar ook\b/gi, 'niet alleen … maar ook'],
];

const VOWEL_GROUP = /(?:ij|[aeiouyàáâäèéêëìíîïòóôöùúûü]+)/gi;

function normalize(value: string): string {
  return value.toLocaleLowerCase('nl-NL').replace(/[‘’`]/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function containsPhrase(text: string, phrase: string): boolean {
  const p = normalize(phrase);
  if (!p) return false;
  return ` ${normalize(text)} `.includes(` ${p} `);
}

function countPhrase(text: string, phrase: string): number {
  const p = normalize(phrase);
  if (!p) return 0;
  const hay = ` ${normalize(text)} `;
  let count = 0;
  let index = hay.indexOf(` ${p} `);
  while (index >= 0) {
    count++;
    index = hay.indexOf(` ${p} `, index + p.length + 1);
  }
  return count;
}

function words(text: string): string[] {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
}

function sentences(text: string): string[] {
  return text
    .replace(/\b(?:bijv|bv|o\.a|m\.a\.w|d\.w\.z|ca|nr|incl|excl|enz)\./gi, (m) => m.replace(/\./g, ''))
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => words(s).length >= 2);
}

function syllables(word: string): number {
  return Math.max(1, (word.toLowerCase().match(VOWEL_GROUP) ?? []).length);
}

/** Splits markdown into headings and plain paragraphs (links reduced to their text). */
export function parseArticle(markdown: string) {
  const text = markdown.replace(/\r/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  const lines = text.split('\n');
  const h1: string[] = [];
  const h2: string[] = [];
  const h3: string[] = [];
  const paragraphs: string[] = [];
  const blocks: Array<{ heading: boolean; text: string }> = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length) {
      const para = current.join(' ').replace(/[*_>#`]+/g, '').trim();
      if (para) { paragraphs.push(para); blocks.push({ heading: false, text: para }); }
      current = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      const value = heading[2].replace(/[*_`]+/g, '').trim();
      (level === 1 ? h1 : level === 2 ? h2 : h3).push(value);
      blocks.push({ heading: true, text: value });
    } else if (!line) {
      flush();
    } else if (/^([-*+]|\d+[.)])\s+/.test(line)) {
      flush();
      const item = line.replace(/^([-*+]|\d+[.)])\s+/, '').replace(/[*_`]+/g, '').trim();
      if (item) blocks.push({ heading: false, text: item });
    } else {
      current.push(line);
    }
  }
  flush();
  const body = blocks.filter((b) => !b.heading).map((b) => b.text).join('\n');
  return { h1, h2, h3, paragraphs, blocks, body };
}

/** Flesch-Douma: the Dutch version of Flesch Reading Ease (higher = easier). */
export function fleschDouma(text: string): number | null {
  const w = words(text);
  const s = sentences(text);
  if (w.length < 30 || s.length === 0) return null;
  const syl = w.reduce((sum, word) => sum + syllables(word), 0);
  return Math.round(206.835 - 0.93 * (w.length / s.length) - 77 * (syl / w.length));
}

export function findAiPhrases(text: string): Array<{ phrase: string; count: number }> {
  const found: Array<{ phrase: string; count: number }> = [];
  for (const [pattern, label] of AI_PHRASES) {
    const count = (text.match(pattern) ?? []).length;
    if (count) found.push({ phrase: label, count });
  }
  return found;
}

function check(id: string, label: string, max: number, status: CheckStatus, detail: string, partial = 0.5): QualityCheck {
  const points = status === 'pass' ? max : status === 'warn' ? Math.round(max * partial) : 0;
  return { id, label, status, points, max, detail };
}

export function rateArticle(input: QualityInput): QualityResult {
  const parsed = parseArticle(input.content);
  const keyword = input.primaryKeyword.trim();
  const allWords = words(parsed.body);
  const wordCount = allWords.length;
  const sents = sentences(parsed.body);
  const avgSentence = sents.length ? Math.round((sents.reduce((n, s) => n + words(s).length, 0) / sents.length) * 10) / 10 : 0;
  const readability = fleschDouma(parsed.body);
  const checks: QualityCheck[] = [];

  // 1. Keyword in the title
  const title = parsed.h1[0] ?? '';
  const inTitle = containsPhrase(title, keyword);
  const inMetaTitle = containsPhrase(input.metaTitle ?? '', keyword);
  checks.push(check('keyword-title', 'Hoofdzoekwoord in de titel', 10,
    inTitle ? 'pass' : inMetaTitle ? 'warn' : 'fail',
    inTitle ? `"${keyword}" staat in de H1.` : inMetaTitle ? 'Alleen in de metatitel, niet in de H1.' : title ? `"${keyword}" staat niet in de titel.` : 'Het artikel heeft geen H1-titel (# Titel).'));

  // 2. Keyword early
  const first100 = allWords.slice(0, 100).join(' ');
  const early = containsPhrase(first100, keyword);
  checks.push(check('keyword-intro', 'Hoofdzoekwoord in de eerste 100 woorden', 10, early ? 'pass' : 'fail',
    early ? 'De lezer (en Google) ziet meteen waar het over gaat.' : 'Noem het hoofdzoekwoord al in de inleiding.'));

  // 3. Keyword in H2s
  const h2With = parsed.h2.filter((h) => containsPhrase(h, keyword)).length;
  const h2Needed = Math.max(1, Math.ceil(parsed.h2.length / 3));
  checks.push(check('keyword-h2', 'Hoofdzoekwoord in tussenkoppen', 8,
    h2With >= h2Needed ? 'pass' : h2With > 0 ? 'warn' : 'fail',
    parsed.h2.length ? `${h2With} van ${parsed.h2.length} H2-koppen bevatten het zoekwoord (doel: ${h2Needed}).` : 'Er zijn geen H2-koppen.'));

  // 4. Keyword density (a warning only: natural language comes first)
  const keywordWords = Math.max(1, words(keyword).length);
  const occurrences = countPhrase(parsed.body, keyword);
  const density = wordCount ? Math.round(((occurrences * keywordWords) / wordCount) * 1000) / 10 : 0;
  checks.push(check('keyword-density', 'Zoekwoorddichtheid', 6,
    density >= 0.5 && density <= 2.5 ? 'pass' : density > 3.5 || density === 0 ? 'fail' : 'warn',
    `${occurrences}× gebruikt, ${density}% van de tekst (richtlijn 0,5–2,5%; hoger leest als keyword stuffing).`));

  // 5–6. Meta lengths
  const mt = (input.metaTitle ?? '').trim().length;
  checks.push(check('meta-title', 'Lengte metatitel', 8,
    mt >= 50 && mt <= 60 ? 'pass' : mt >= 30 && mt <= 65 ? 'warn' : 'fail',
    mt ? `${mt} tekens (doel 50–60, anders wordt hij in Google afgekapt of te kort).` : 'Er is geen metatitel.'));
  const md = (input.metaDescription ?? '').trim().length;
  checks.push(check('meta-description', 'Lengte metabeschrijving', 8,
    md >= 140 && md <= 160 ? 'pass' : md >= 110 && md <= 170 ? 'warn' : 'fail',
    md ? `${md} tekens (doel 140–160).` : 'Er is geen metabeschrijving.'));

  // 7. Structure
  let longestRun = 0;
  let run = 0;
  for (const block of parsed.blocks) {
    if (block.heading) { longestRun = Math.max(longestRun, run); run = 0; } else run += words(block.text).length;
  }
  longestRun = Math.max(longestRun, run);
  const structureOk = parsed.h2.length >= 3 && longestRun <= 350;
  checks.push(check('structure', 'Structuur met tussenkoppen', 10,
    structureOk ? 'pass' : parsed.h2.length >= 2 ? 'warn' : 'fail',
    `${parsed.h2.length} H2- en ${parsed.h3.length} H3-koppen; langste stuk zonder kop: ${longestRun} woorden (doel: ≥ 3 H2, ≤ 350 woorden per stuk).`));

  // 8. Paragraph length
  const longParas = parsed.paragraphs.filter((p) => sentences(p).length > 4).length;
  const veryLong = parsed.paragraphs.some((p) => sentences(p).length > 8);
  checks.push(check('paragraphs', 'Korte alinea\'s', 8,
    longParas === 0 ? 'pass' : longParas <= 2 && !veryLong ? 'warn' : 'fail',
    longParas ? `${longParas} alinea('s) met meer dan 4 zinnen.` : 'Alle alinea\'s hebben hooguit 4 zinnen.'));

  // 9. Sentence length
  const longSentences = sents.filter((s) => words(s).length > 25).length;
  const longShare = sents.length ? longSentences / sents.length : 0;
  checks.push(check('sentences', 'Zinslengte', 8,
    avgSentence <= 20 && longShare <= 0.15 ? 'pass' : avgSentence <= 24 && longShare <= 0.3 ? 'warn' : 'fail',
    `Gemiddeld ${avgSentence} woorden per zin; ${longSentences} zin(nen) langer dan 25 woorden.`));

  // 10. Readability
  checks.push(check('readability', 'Leesbaarheid (Flesch-Douma)', 8,
    readability === null ? 'warn' : readability >= 50 ? 'pass' : readability >= 35 ? 'warn' : 'fail',
    readability === null ? 'Te weinig tekst om te meten.' : `Score ${readability} (≥ 50 = goed leesbaar voor een breed publiek; 35–50 = vrij moeilijk).`));

  // 11. Typical AI phrases
  const ai = findAiPhrases(parsed.body);
  const aiCount = ai.reduce((n, f) => n + f.count, 0);
  checks.push(check('ai-phrases', 'Geen typische AI-zinnen', 8,
    aiCount === 0 ? 'pass' : aiCount <= 2 ? 'warn' : 'fail',
    aiCount ? `Gevonden: ${ai.map((f) => `"${f.phrase}"${f.count > 1 ? ` (${f.count}×)` : ''}`).join(', ')}.` : 'Geen standaardzinnen gevonden die als AI-tekst klinken.'));

  // 12. Length
  checks.push(check('length', 'Lengte', 8,
    wordCount >= 700 ? 'pass' : wordCount >= 400 ? 'warn' : 'fail',
    `${wordCount} woorden (richtlijn ≥ 700 voor een volwaardig SEO-artikel; de concurrentie bepaalt uiteindelijk wat nodig is).`));

  const max = checks.reduce((n, c) => n + c.max, 0);
  const score = Math.round((checks.reduce((n, c) => n + c.points, 0) / max) * 100);
  const grade = score >= 85 ? 'Uitstekend' : score >= 70 ? 'Goed' : score >= 55 ? 'Voldoende' : 'Onvoldoende';
  return {
    score,
    grade,
    checks,
    stats: { words: wordCount, sentences: sents.length, paragraphs: parsed.paragraphs.length, h2: parsed.h2.length, avgSentenceWords: avgSentence, readability },
  };
}
