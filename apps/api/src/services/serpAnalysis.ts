import { load } from "cheerio";
import { fetchRobots, fetchSafe, type SafeHttpOptions, type SafeResponse } from "./safeHttp";
import { normalizeText } from "./htmlExtraction";

/**
 * Analysis of the pages that rank in Google's top 5 for the main keyword.
 * Semrush says WHICH pages rank (phrase_organic, already part of the SEO
 * research); this module reads those pages to see HOW they are built: their
 * headings and length. The result is context for the outline only: nothing
 * of the competitors' text is copied. robots.txt is respected.
 * Inspired by the SERP analysis step of SEO Machine
 * (github.com/TheCraigHewitt/seomachine, MIT).
 */

export const MAX_COMPETITORS = 5;
const PAGE_TIMEOUT_MS = 8_000;
const MAX_HEADINGS = 25;

export interface CompetitorHeading {
  level: "H2" | "H3";
  text: string;
}

export interface CompetitorPage {
  position: number | null;
  domain: string;
  url: string;
  status: "ok" | "geblokkeerd" | "mislukt";
  title: string | null;
  words: number | null;
  headings: CompetitorHeading[];
}

export interface SerpAnalysis {
  pages: CompetitorPage[];
  analysed: number;
  averageWords: number | null;
  medianWords: number | null;
}

interface CompetitorRef {
  position?: number | null;
  domain?: string;
  url?: string;
}

/** Main content of a page: headings and word count, without menus, footers and cookie banners. */
export function analysePage(html: string): { title: string; words: number; headings: CompetitorHeading[] } {
  const $ = load(html);
  const title = normalizeText($("h1").first().text() || $("title").first().text(), 300);
  const root = $("article").first().length ? $("article").first() : $("main").first().length ? $("main").first() : $("body").first();
  root.find("script, style, noscript, svg, nav, header, footer, aside, form, iframe, template, button").remove();
  root.find('[class*="cookie" i], [id*="cookie" i], [class*="comment" i], [id*="comment" i], [class*="related" i], [class*="share" i], [class*="newsletter" i]').remove();
  const headings: CompetitorHeading[] = [];
  root.find("h2, h3").each((_i, el) => {
    const text = normalizeText($(el).text(), 200);
    if (text && headings.length < MAX_HEADINGS) headings.push({ level: el.tagName.toLowerCase() === "h3" ? "H3" : "H2", text });
  });
  const text = (root.html() ?? "").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ");
  const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
  return { title, words, headings };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return Math.round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
}

export async function analyseSerp(
  competitors: unknown,
  options: SafeHttpOptions & { fetcher?: (url: string, options?: SafeHttpOptions) => Promise<SafeResponse> } = {},
): Promise<SerpAnalysis> {
  const refs = (Array.isArray(competitors) ? competitors : [])
    .filter((c): c is CompetitorRef => Boolean(c) && typeof c === "object" && typeof (c as CompetitorRef).url === "string")
    .slice(0, MAX_COMPETITORS);
  const fetcher = options.fetcher ?? fetchSafe;

  const pages = await Promise.all(refs.map(async (ref): Promise<CompetitorPage> => {
    const base: CompetitorPage = {
      position: typeof ref.position === "number" ? ref.position : null,
      domain: ref.domain ?? "",
      url: ref.url!,
      status: "mislukt",
      title: null,
      words: null,
      headings: [],
    };
    try {
      const url = new URL(ref.url!);
      if (!base.domain) base.domain = url.hostname.replace(/^www\./, "");
      const robots = await fetchRobots(new URL(url.origin), { ...options, fetcher, timeoutMs: PAGE_TIMEOUT_MS });
      if (!robots.allowed(url.toString())) return { ...base, status: "geblokkeerd" };
      const response = await fetcher(url.toString(), { ...options, timeoutMs: PAGE_TIMEOUT_MS });
      if (response.status < 200 || response.status >= 300) return base;
      if (!/html/i.test(response.headers["content-type"] ?? "text/html")) return base;
      const page = analysePage(response.body);
      return { ...base, status: "ok", title: page.title || null, words: page.words, headings: page.headings };
    } catch {
      return base;
    }
  }));

  const counts = pages.filter((p) => p.status === "ok" && (p.words ?? 0) >= 150).map((p) => p.words!);
  return {
    pages,
    analysed: pages.filter((p) => p.status === "ok").length,
    averageWords: counts.length ? Math.round(counts.reduce((a, b) => a + b, 0) / counts.length) : null,
    medianWords: median(counts),
  };
}

/** The analysis as context for the outline prompt. */
export function serpContext(analysis: SerpAnalysis | null): string | null {
  if (!analysis || analysis.analysed === 0) return null;
  const lines = analysis.pages
    .filter((p) => p.status === "ok")
    .map((p) => `- #${p.position ?? "?"} ${p.domain} (${p.words ?? "?"} woorden): ${p.headings.filter((h) => h.level === "H2").map((h) => h.text).join(" | ") || "geen tussenkoppen"}`);
  return [
    `Analyse van de top ${analysis.pages.length} in Google (${analysis.analysed} pagina's gelezen; mediaan ${analysis.medianWords ?? "onbekend"} woorden):`,
    ...lines,
    "Gebruik dit alleen als context: behandel de onderwerpen die de meeste toppagina's behandelen, voeg toe wat ze missen of oppervlakkig behandelen, en kopieer nooit hun koppen, tekst of claims. Stem de totale lengte af op de mediaan (tussen 800 en 2500 woorden).",
  ].join("\n");
}
