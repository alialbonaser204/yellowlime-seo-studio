/**
 * Finds a partner's existing articles that perform worst in Google, with the
 * reasons in plain Dutch. Only real Search Console figures are used; the
 * comparison point for the click rate is the website's own average at the
 * same position, never an invented benchmark.
 */
import { load } from "cheerio";
import type { MetricRow } from "./searchConsoleData";
import type { QueryPageRow } from "./searchConsole";
import { isCandidateArticleUrl } from "./articleInventory";

export interface Reason {
  code: "daling" | "pagina2" | "lage_ctr" | "onzichtbaar" | "verouderd" | "dun";
  text: string;
}

export interface Underperformer {
  url: string;
  title: string | null;
  clicks: number;
  previousClicks: number;
  impressions: number;
  ctr: number;
  position: number;
  wordCount: number | null;
  publishedAt: string | null;
  topQueries: { query: string; clicks: number; impressions: number; position: number }[];
  reasons: Reason[];
  /** Missed clicks, roughly: how much there is to win. Used for sorting. */
  potential: number;
}

const nf = (n: number) => Math.round(n).toLocaleString("nl-NL");
const pct = (n: number) => `${(Math.round(n * 1000) / 10).toLocaleString("nl-NL")}%`;
const norm = (u: string) => u.replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();

function group(position: number): string {
  if (position < 1.5) return "1";
  if (position < 3.5) return "2-3";
  if (position < 5.5) return "4-5";
  if (position < 10.5) return "6-10";
  if (position < 20.5) return "11-20";
  return "21+";
}

export function rankUnderperformers(input: {
  siteUrl: string;
  pagesNow: MetricRow[];
  pagesBefore: MetricRow[];
  rows: QueryPageRow[];
  inventory: { url: string; title: string; wordCount: number; publishedAt: Date | null }[];
  now?: Date;
  limit?: number;
}): Underperformer[] {
  const site = new URL(input.siteUrl);
  const now = input.now ?? new Date();
  const inv = new Map(input.inventory.map((a) => [norm(a.url), a]));
  const before = new Map(input.pagesBefore.map((p) => [norm(p.key), p]));

  // Which pages are articles: scanned articles, or URLs that look like one.
  const isArticle = (url: string) => {
    if (inv.has(norm(url))) return true;
    try { return isCandidateArticleUrl(new URL(url), site); } catch { return false; }
  };
  const pages = new Map<string, MetricRow>();
  for (const p of input.pagesNow) if (isArticle(p.key)) pages.set(norm(p.key), p);
  // Scanned articles Google (almost) never shows.
  for (const a of input.inventory) if (!pages.has(norm(a.url))) pages.set(norm(a.url), { key: a.url, clicks: 0, impressions: 0, ctr: 0, position: 0 });

  // The site's own average click rate per position group.
  const groups = new Map<string, { c: number; i: number }>();
  for (const p of input.pagesNow) {
    if (!p.impressions || !p.position) continue;
    const g = groups.get(group(p.position)) ?? { c: 0, i: 0 };
    g.c += p.clicks; g.i += p.impressions; groups.set(group(p.position), g);
  }
  const avgCtr = (pos: number) => { const g = groups.get(group(pos)); return g && g.i >= 200 ? g.c / g.i : null; };

  const out: Underperformer[] = [];
  for (const [key, p] of pages) {
    const a = inv.get(key);
    const prev = before.get(key);
    const previousClicks = prev?.clicks ?? 0;
    const reasons: Reason[] = [];
    let potential = 0;

    if (p.impressions < 20) {
      reasons.push({ code: "onzichtbaar", text: `Google toonde dit artikel de afgelopen 90 dagen bijna niet (${nf(p.impressions)} keer). Het scoort op geen enkele zoekopdracht goed.` });
      potential += 3;
    }
    if (previousClicks >= 10 && p.clicks < previousClicks * 0.75) {
      const drop = Math.round((1 - p.clicks / previousClicks) * 100);
      reasons.push({ code: "daling", text: `Het aantal klikken daalde met ${drop}%: ${nf(p.clicks)} in de afgelopen 90 dagen, tegen ${nf(previousClicks)} in de 90 dagen daarvoor.` });
      potential += previousClicks - p.clicks;
    }
    if (p.position >= 8 && p.position <= 30 && p.impressions >= 50) {
      reasons.push({ code: "pagina2", text: `Het staat gemiddeld op positie ${p.position.toLocaleString("nl-NL")}: ${p.position > 10.5 ? "op pagina 2 of verder, waar bijna niemand kijkt" : "onderaan pagina 1"}. Het werd ${nf(p.impressions)} keer getoond.` });
      potential += p.impressions * 0.04;
    }
    const expected = p.position > 0 && p.position <= 10.5 ? avgCtr(p.position) : null;
    if (expected && p.impressions >= 100 && p.ctr < expected / 2) {
      reasons.push({ code: "lage_ctr", text: `Slechts ${pct(p.ctr)} van de mensen die het zagen klikte. Andere pagina's van deze website op dezelfde positie halen gemiddeld ${pct(expected)}. De titel en beschrijving trekken weinig aan.` });
      potential += p.impressions * (expected - p.ctr);
    }
    if (a?.publishedAt) {
      const years = (now.getTime() - a.publishedAt.getTime()) / (365.25 * 86400000);
      if (years >= 2) reasons.push({ code: "verouderd", text: `Gepubliceerd ${a.publishedAt.toLocaleDateString("nl-NL", { month: "long", year: "numeric" })}: ruim ${Math.floor(years)} jaar oud. Mogelijk is de informatie verouderd.` });
    }
    if (a && a.wordCount > 0 && a.wordCount < 400) {
      reasons.push({ code: "dun", text: `Het artikel is kort (${nf(a.wordCount)} woorden). Korte artikelen beantwoorden de vraag van de zoeker vaak niet volledig.` });
      potential += 2;
    }
    if (!reasons.length) continue;

    const topQueries = input.rows
      .filter((r) => norm(r.page) === key)
      .sort((x, y) => y.impressions - x.impressions)
      .slice(0, 8)
      .map((r) => ({ query: r.query, clicks: r.clicks, impressions: r.impressions, position: r.position }));

    out.push({
      url: p.key, title: a?.title ?? null,
      clicks: p.clicks, previousClicks, impressions: p.impressions, ctr: p.ctr, position: p.position,
      wordCount: a?.wordCount ?? null, publishedAt: a?.publishedAt ? a.publishedAt.toISOString() : null,
      topQueries, reasons, potential: Math.round(potential * 10) / 10,
    });
  }
  // Most to win first; with equal potential, the one with more problems.
  return out.sort((x, y) => y.potential - x.potential || y.reasons.length - x.reasons.length).slice(0, input.limit ?? 5);
}

/**
 * The article on a page as markdown-like text (# title, ## and ### headings,
 * paragraphs, list items), plus its meta title and description.
 */
export function pageToArticle(html: string): { title: string; metaTitle: string; metaDescription: string; fullArticle: string; wordCount: number } {
  const $ = load(html);
  const metaTitle = $("title").first().text().trim();
  const metaDescription = ($('meta[name="description"]').attr("content") ?? "").trim();
  const container = $("article").first().length ? $("article").first() : $("main").first().length ? $("main").first() : $("body").first();
  const c = container.clone();
  c.find("script, style, noscript, nav, header, footer, aside, form, iframe, svg, button, [role=navigation], .share, .related, .comments, #comments").remove();
  const lines: string[] = [];
  c.find("h1, h2, h3, h4, p, li, blockquote").each((_i, el) => {
    const tag = (el as { tagName?: string }).tagName?.toLowerCase() ?? "p";
    // Skip blocks nested in another block we already take (p inside li etc.).
    if ($(el).parents("li, blockquote").length && tag !== "li") return;
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!text) return;
    if (tag === "h1") lines.push(`# ${text}`);
    else if (tag === "h2") lines.push(`## ${text}`);
    else if (tag === "h3" || tag === "h4") lines.push(`### ${text}`);
    else if (tag === "li") lines.push(`- ${text}`);
    else lines.push(text);
  });
  // Group list items; blank line between other blocks.
  const md = lines.reduce((acc, line, i) => acc + (i === 0 ? "" : line.startsWith("- ") && lines[i - 1].startsWith("- ") ? "\n" : "\n\n") + line, "");
  const title = $("h1").first().text().replace(/\s+/g, " ").trim() || metaTitle;
  const fullArticle = md.startsWith("# ") ? md : `# ${title}\n\n${md}`;
  return { title, metaTitle, metaDescription, fullArticle, wordCount: fullArticle.split(/\s+/).filter(Boolean).length };
}
