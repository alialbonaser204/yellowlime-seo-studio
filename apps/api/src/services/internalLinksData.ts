import type { WebsiteArticle } from "@yellowlime/db";
import { lexicalScore } from "./topicMatching";

/**
 * Pure helpers for internal link suggestions: choosing which of the partner's
 * published pages fit a new article, the Claude prompt, and checking Claude's
 * answer. No database or network access, so everything here is unit-tested.
 */

export const MAX_CANDIDATES = 12;
export const MAX_SUGGESTIONS = 5;

export type LinkPage = Pick<WebsiteArticle, "url" | "title" | "headings" | "description">;

export interface PageMetrics {
  clicks: number;
  impressions: number;
  position: number;
}

export interface LinkCandidate {
  id: string;
  url: string;
  title: string;
  headings: string[];
  description: string | null;
  relevance: number;
  gsc: PageMetrics | null;
  score: number;
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

/** The text that matters for matching: the subject, the headings and the opening. */
export function articleTopicText(subject: string, content: string): string {
  const lines = content.split("\n");
  const headings = lines.filter((line) => /^#{1,3}\s/.test(line.trim())).join(" ");
  const opening = lines.filter((line) => line.trim() && !/^#/.test(line.trim())).slice(0, 3).join(" ");
  return [subject, subject, headings, opening].join(" ");
}

/**
 * Picks the published pages that are worth linking to: related to the article
 * (word overlap with the title, slug, headings and description) and, when
 * Search Console is available, a bonus for pages that already get impressions
 * and sit just outside the top of Google (position 4–20).
 */
export function chooseLinkCandidates(
  subject: string,
  content: string,
  pages: LinkPage[],
  metrics: Map<string, PageMetrics> | null,
  limit = MAX_CANDIDATES,
): LinkCandidate[] {
  const topic = articleTopicText(subject, content);
  const already = linkedUrls(content);
  const seen = new Set<string>();
  const scored: LinkCandidate[] = [];
  for (const page of pages) {
    const key = normalizeUrl(page.url);
    if (seen.has(key) || already.has(key)) continue;
    seen.add(key);
    const relevance = lexicalScore(topic, page);
    if (relevance <= 0) continue;
    const gsc = metrics?.get(key) ?? null;
    let bonus = 0;
    if (gsc) {
      if (gsc.position >= 4 && gsc.position <= 20) bonus += 4;
      bonus += Math.min(3, Math.log10(1 + gsc.impressions));
    }
    scored.push({
      id: "",
      url: page.url,
      title: page.title,
      headings: page.headings,
      description: page.description,
      relevance,
      gsc,
      score: Math.round((relevance + bonus) * 10) / 10,
    });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit)
    .map((candidate, index) => ({ ...candidate, id: `p${index + 1}` }));
}

export function makeInternalLinksPrompt(input: {
  companyName: string;
  subject: string;
  content: string;
  candidates: LinkCandidate[];
  count?: number;
}): string {
  const count = input.count ?? MAX_SUGGESTIONS;
  const list = input.candidates
    .map((c) => {
      const extra = [
        c.headings.length ? `tussenkoppen: ${c.headings.slice(0, 6).join("; ")}` : "",
        c.description ? `omschrijving: ${c.description.slice(0, 200)}` : "",
        c.gsc ? `Google: positie ${c.gsc.position}, ${c.gsc.impressions} vertoningen, ${c.gsc.clicks} klikken (90 dagen)` : "",
      ].filter(Boolean);
      return `[${c.id}] ${c.title} | ${c.url}${extra.length ? ` | ${extra.join(" | ")}` : ""}`;
    })
    .join("\n");
  return [
    `Je bent een SEO-redacteur bij ${input.companyName}. Kies interne links voor een nieuw artikel naar bestaande pagina's op dezelfde website.`,
    "",
    `Onderwerp van het nieuwe artikel: ${input.subject}`,
    "",
    "Bestaande pagina's waar naartoe gelinkt mag worden:",
    list,
    "",
    "Het nieuwe artikel:",
    "<<<ARTIKEL",
    input.content,
    "ARTIKEL>>>",
    "",
    "Regels:",
    `- Kies maximaal ${count} links, alleen naar pagina's uit de lijst die echt iets toevoegen voor de lezer van dít artikel. Liever 2 goede dan 5 matige.`,
    "- De ankertekst moet LETTERLIJK (exact dezelfde tekens) in een alinea van het artikel staan, niet in een kop. Kies 2 tot 6 woorden die beschrijven waar de gelinkte pagina over gaat.",
    "- Geen ankerteksten als 'klik hier', 'lees meer' of 'deze pagina'.",
    "- Elke pagina maximaal één keer, elke ankertekst maar één keer. Verspreid de links over het artikel.",
    "- Geef de voorkeur aan pagina's die net buiten de top van Google staan (positie 4–20): een interne link helpt die het meest.",
    "- reason: één korte zin in het Nederlands waarom deze link de lezer helpt. Verzin geen cijfers.",
    "",
    "Denk niet hardop na. Begin je antwoord direct met { en geef alleen deze JSON:",
    '{"links": [{"page": "p1", "anchor": "letterlijke woorden uit het artikel", "reason": "..."}]}',
  ].join("\n");
}

function extractJson(raw: string): unknown {
  const start = raw.indexOf("{");
  if (start < 0) throw new Error("invalid_claude_json");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        return JSON.parse(raw.slice(start, i + 1));
      } catch {
        throw new Error("invalid_claude_json");
      }
    }
  }
  throw new Error("invalid_claude_json");
}

/**
 * Where an anchor can be linked: the first place it occurs in a normal
 * paragraph (not a heading) and not inside an existing markdown link.
 * Returns the character offset, or -1.
 */
export function findAnchor(content: string, anchor: string, from = 0): number {
  let index = content.indexOf(anchor, from);
  while (index >= 0) {
    const lineStart = content.lastIndexOf("\n", index - 1) + 1;
    const lineEnd = content.indexOf("\n", index);
    const line = content.slice(lineStart, lineEnd < 0 ? content.length : lineEnd);
    const before = content.slice(lineStart, index);
    const inHeading = /^\s*#/.test(line);
    const opened = (before.match(/\[/g) ?? []).length > (before.match(/\]/g) ?? []).length;
    const inLinkTarget = /\]\([^)]*$/.test(before);
    const wordStart = index === 0 || !/[\p{L}\p{N}]/u.test(content[index - 1]);
    const endChar = content[index + anchor.length];
    const wordEnd = endChar === undefined || !/[\p{L}\p{N}]/u.test(endChar);
    if (!inHeading && !opened && !inLinkTarget && wordStart && wordEnd) return index;
    index = content.indexOf(anchor, index + 1);
  }
  return -1;
}

const VAGUE_ANCHORS = /^(klik hier|lees meer|lees hier|hier|deze pagina|dit artikel|meer informatie|bekijk)$/i;

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
 * Turns Claude's answer into suggestions the editor can apply. A suggestion is
 * dropped when the page is not one of the candidates, when the anchor text is
 * not literally in a paragraph of the article, when it is too short, too long
 * or vague, or when the page or anchor was already used.
 */
export function parseInternalLinks(
  raw: string,
  candidates: LinkCandidate[],
  content: string,
  max = MAX_SUGGESTIONS,
): InternalLinkSuggestion[] {
  const data = extractJson(raw) as { links?: unknown };
  if (!data || !Array.isArray(data.links)) throw new Error("invalid_claude_json");
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const usedPages = new Set<string>();
  const usedAnchors = new Set<string>();
  const usedOffsets: Array<[number, number]> = [];
  const out: InternalLinkSuggestion[] = [];
  for (const item of data.links as Array<Record<string, unknown>>) {
    if (out.length >= max) break;
    const candidate = typeof item?.page === "string" ? byId.get(item.page.trim()) : undefined;
    const anchor = typeof item?.anchor === "string" ? item.anchor.trim().replace(/^["'“”‘’]+|["'“”‘’.,;:]+$/g, "") : "";
    const reason = typeof item?.reason === "string" ? item.reason.trim() : "";
    if (!candidate || !anchor) continue;
    const words = anchor.split(/\s+/).length;
    if (words < 1 || words > 8 || anchor.length < 4 || VAGUE_ANCHORS.test(anchor)) continue;
    const pageKey = normalizeUrl(candidate.url);
    const anchorKey = anchor.toLowerCase();
    if (usedPages.has(pageKey) || usedAnchors.has(anchorKey)) continue;
    let index = findAnchor(content, anchor);
    while (index >= 0 && usedOffsets.some(([s, e]) => index < e && index + anchor.length > s)) {
      index = findAnchor(content, anchor, index + 1);
    }
    if (index < 0) continue;
    usedPages.add(pageKey);
    usedAnchors.add(anchorKey);
    usedOffsets.push([index, index + anchor.length]);
    out.push({
      url: candidate.url,
      title: candidate.title,
      anchor,
      reason: reason.slice(0, 300),
      context: contextAround(content, index, anchor),
      gsc: candidate.gsc,
    });
  }
  return out;
}

/** Puts a markdown link around the first linkable occurrence of the anchor. */
export function applyInternalLink(content: string, anchor: string, url: string): string {
  const index = findAnchor(content, anchor);
  if (index < 0) return content;
  return `${content.slice(0, index)}[${anchor}](${url})${content.slice(index + anchor.length)}`;
}
