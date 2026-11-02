import type { WebsiteArticle } from "@yellowlime/db";

/**
 * Pure helpers for the internal link check that runs after an article has been
 * approved. It only looks for words that are literally in the article and are
 * exactly the same as the main keyword of an existing page on the partner's
 * website (from the page's URL or title). The article text itself is never
 * rewritten: a link only wraps words that are already there.
 */

export const MAX_SUGGESTIONS = 10;

export type LinkPage = Pick<WebsiteArticle, "url" | "title">;

export interface PageMetrics {
  clicks: number;
  impressions: number;
  position: number;
}

export type PhraseSource = "url" | "titel";

export interface PagePhrase {
  phrase: string;
  source: PhraseSource;
}

export interface InternalLinkSuggestion {
  url: string;
  title: string;
  anchor: string;
  reason: string;
  context: string;
  gsc: PageMetrics | null;
}

/** Same page regardless of protocol, "www.", trailing slash, query or hash. */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return url.trim().replace(/[#?].*$/, "").replace(/\/+$/, "").toLowerCase();
  }
}

/** URLs that the text already links to with markdown links. */
export function linkedUrls(content: string): Set<string> {
  const found = new Set<string>();
  for (const match of content.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)) found.add(normalizeUrl(match[1]));
  return found;
}

const FILLER = new Set([
  "de", "het", "een", "en", "of", "van", "voor", "met", "op", "in", "te", "naar", "is", "je", "jouw", "uw", "u", "wat",
  "hoe", "welke", "waarom", "wanneer", "bij", "om", "aan", "als", "ook", "over", "ons", "onze", "wij", "we", "alles",
  "contact", "home", "blog", "nieuws", "vacatures", "vacature", "pagina", "page", "artikel", "tips", "the", "a", "and",
]);

function cleanPhrase(value: string): string {
  return value
    .toLocaleLowerCase("nl-NL")
    .replace(/[‘’`]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A phrase is worth linking when it has 2–8 words and at least one real content word. */
function usable(phrase: string): boolean {
  const words = phrase.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 8) return false;
  return words.some((w) => w.length >= 4 && !FILLER.has(w) && !/^\d+$/.test(w));
}

/** "https://w.nl/blog/subsidie-warmtepomp-2026/" → "subsidie warmtepomp" */
export function slugPhrase(url: string): string | null {
  let path = "";
  try {
    path = new URL(url).pathname;
  } catch {
    path = url;
  }
  const segment = decodeURIComponent(path.split("/").filter(Boolean).pop() ?? "").replace(/\.(html?|php|aspx?)$/i, "");
  const words = cleanPhrase(segment.replace(/[-_+]+/g, " ")).split(" ").filter(Boolean);
  while (words.length && /^\d+$/.test(words[words.length - 1])) words.pop();
  while (words.length && /^\d+$/.test(words[0])) words.shift();
  const phrase = words.join(" ");
  return usable(phrase) ? phrase : null;
}

/** "Wat kost een warmtepomp? | Warmtebouw" → ["wat kost een warmtepomp"]; also the part before a colon. */
export function titlePhrases(title: string): string[] {
  const withoutSite = title.split(/\s[|–—]\s|\s-\s/)[0] ?? title;
  const out = new Set<string>();
  const whole = cleanPhrase(withoutSite);
  if (usable(whole)) out.add(whole);
  const beforeColon = withoutSite.includes(":") ? cleanPhrase(withoutSite.split(":")[0]) : "";
  if (beforeColon && usable(beforeColon)) out.add(beforeColon);
  return [...out];
}

export function pagePhrases(page: LinkPage): PagePhrase[] {
  const out: PagePhrase[] = [];
  const seen = new Set<string>();
  const slug = slugPhrase(page.url);
  if (slug) {
    out.push({ phrase: slug, source: "url" });
    seen.add(slug);
  }
  for (const phrase of titlePhrases(page.title)) {
    if (!seen.has(phrase)) {
      out.push({ phrase, source: "titel" });
      seen.add(phrase);
    }
  }
  return out;
}

/** True when a link may start here: a normal paragraph, not a heading, not inside an existing link. */
export function linkablePosition(content: string, index: number): boolean {
  const lineStart = content.lastIndexOf("\n", index - 1) + 1;
  const before = content.slice(lineStart, index);
  if (/^\s*#/.test(content.slice(lineStart, index + 1)) || /^\s*#/.test(before)) return false;
  const opened = (before.match(/\[/g) ?? []).length > (before.match(/\]/g) ?? []).length;
  const inLinkTarget = /\]\([^)]*$/.test(before);
  return !opened && !inLinkTarget;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every place where the phrase occurs exactly (ignoring capitals) as whole
 * words in a paragraph. Returns the offsets and the text as written there.
 */
export function exactOccurrences(content: string, phrase: string): Array<{ index: number; text: string }> {
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${phrase.split(" ").map(escapeRegex).join(" ")}(?![\\p{L}\\p{N}])`, "giu");
  const out: Array<{ index: number; text: string }> = [];
  for (const match of content.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (linkablePosition(content, index)) out.push({ index, text: match[0] });
  }
  return out;
}

/** The sentence around the anchor, shortened, so the editor sees where the link goes. */
export function contextAround(content: string, index: number, anchor: string): string {
  const lineStart = content.lastIndexOf("\n", index - 1) + 1;
  const lineEndRaw = content.indexOf("\n", index);
  const lineEnd = lineEndRaw < 0 ? content.length : lineEndRaw;
  let start = Math.max(lineStart, index - 90);
  let end = Math.min(lineEnd, index + anchor.length + 90);
  let cleanStart = start === lineStart;
  let cleanEnd = end === lineEnd;
  const sentenceStart = content.slice(lineStart, index).search(/[.!?]\s[^.!?]*$/);
  if (sentenceStart >= 0 && lineStart + sentenceStart + 2 >= start) {
    start = lineStart + sentenceStart + 2;
    cleanStart = true;
  }
  const after = content.slice(index + anchor.length, lineEnd).search(/[.!?](\s|$)/);
  if (after >= 0 && index + anchor.length + after + 1 <= end) {
    end = index + anchor.length + after + 1;
    cleanEnd = true;
  }
  return `${cleanStart ? "" : "…"}${content.slice(start, end).trim()}${cleanEnd ? "" : "…"}`;
}

/**
 * Finds the exact matches between the article and the partner's pages.
 * Longer phrases win over shorter ones, every page gets at most one link
 * (the first place it occurs), links never overlap, and pages the article
 * already links to are skipped.
 */
export function findExactInternalLinks(
  content: string,
  pages: LinkPage[],
  metrics: Map<string, PageMetrics> | null = null,
  max = MAX_SUGGESTIONS,
): { suggestions: InternalLinkSuggestion[]; pagesWithKeyword: number } {
  const already = linkedUrls(content);
  const seenPages = new Set<string>();
  const entries: Array<{ page: LinkPage; key: string } & PagePhrase> = [];
  let pagesWithKeyword = 0;
  for (const page of pages) {
    const key = normalizeUrl(page.url);
    if (seenPages.has(key)) continue;
    seenPages.add(key);
    const phrases = pagePhrases(page);
    if (phrases.length) pagesWithKeyword++;
    if (already.has(key)) continue;
    for (const p of phrases) entries.push({ page, key, ...p });
  }
  entries.sort((a, b) => b.phrase.length - a.phrase.length || (a.source === "url" ? -1 : 1));

  const used: Array<[number, number]> = [];
  const linkedPages = new Set<string>();
  const found: Array<InternalLinkSuggestion & { index: number }> = [];
  for (const entry of entries) {
    if (linkedPages.has(entry.key)) continue;
    const hit = exactOccurrences(content, entry.phrase).find(
      (o) => !used.some(([s, e]) => o.index < e && o.index + o.text.length > s),
    );
    if (!hit) continue;
    linkedPages.add(entry.key);
    used.push([hit.index, hit.index + hit.text.length]);
    found.push({
      index: hit.index,
      url: entry.page.url,
      title: entry.page.title,
      anchor: hit.text,
      reason: entry.source === "url"
        ? `Staat letterlijk in de tekst en is precies het hoofdzoekwoord uit de URL van deze pagina.`
        : `Staat letterlijk in de tekst en is precies de titel van deze pagina.`,
      context: contextAround(content, hit.index, hit.text),
      gsc: metrics?.get(entry.key) ?? null,
    });
  }
  const suggestions = found
    .sort((a, b) => a.index - b.index)
    .slice(0, max)
    .map(({ index: _index, ...rest }) => rest);
  return { suggestions, pagesWithKeyword };
}

/** Puts a markdown link around the first linkable occurrence of the anchor (exact text). */
export function applyInternalLink(content: string, anchor: string, url: string): string {
  let index = content.indexOf(anchor);
  while (index >= 0) {
    const okStart = index === 0 || !/[\p{L}\p{N}]/u.test(content[index - 1]);
    const end = content[index + anchor.length];
    const okEnd = end === undefined || !/[\p{L}\p{N}]/u.test(end);
    if (okStart && okEnd && linkablePosition(content, index)) {
      return `${content.slice(0, index)}[${anchor}](${url})${content.slice(index + anchor.length)}`;
    }
    index = content.indexOf(anchor, index + 1);
  }
  return content;
}
