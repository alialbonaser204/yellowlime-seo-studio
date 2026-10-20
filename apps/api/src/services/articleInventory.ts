import { load, type CheerioAPI } from "cheerio";
import { normalizeText } from "./htmlExtraction";
import { fetchRobots, fetchSafe, type SafeHttpOptions, type SafeResponse } from "./safeHttp";
import { registrableDomain, validateWebsiteUrl } from "./websiteUrlPolicy";

/**
 * Finds the articles that are published on a website.
 *
 * Discovery tries, in order: the sitemaps (from robots.txt and the usual
 * locations), RSS/Atom feeds, and finally the blog overview pages. Every
 * candidate page is then fetched and only kept when it looks like an article.
 */

export const MAX_ARTICLES = 250;
const MAX_SITEMAP_FILES = 20;
const MAX_SITEMAP_URLS = 5_000;
const MAX_INDEX_PAGES = 8;
const MAX_HEADINGS = 20;
const MIN_ARTICLE_WORDS = 250;
const FETCH_CONCURRENCY = 4;
const XML_ACCEPT = "application/xml,text/xml,application/rss+xml,application/atom+xml;q=0.9,*/*;q=0.5";
const SITEMAP_MAX_BYTES = 10 * 1024 * 1024;

export type WebsiteFetcher = (url: string, options?: SafeHttpOptions) => Promise<SafeResponse>;
export type DiscoverySource = "sitemap" | "rss" | "crawl";

export interface Candidate {
  url: string;
  lastModified: Date | null;
  /** True when the source says this is a post (post sitemap, feed item). */
  fromPostSource: boolean;
}

export interface ScannedArticle {
  url: string;
  title: string;
  description: string | null;
  headings: string[];
  publishedAt: Date | null;
  wordCount: number;
}

export interface InventoryResult {
  source: DiscoverySource | null;
  pagesChecked: number;
  articles: ScannedArticle[];
}

export class InventoryError extends Error {}

// ---------------------------------------------------------------------------
// URL classification
// ---------------------------------------------------------------------------

const ARTICLE_SECTIONS = [
  "blog", "blogs", "nieuws", "news", "artikel", "artikelen", "articles", "article", "kennisbank",
  "kennis", "magazine", "inspiratie", "tips", "advies", "gids", "gidsen", "weetjes", "journal",
  "stories", "verhalen", "insights", "updates", "posts", "post", "vraag-en-antwoord", "faq-artikelen",
];

const EXCLUDED_SEGMENTS = new Set([
  "product", "producten", "products", "shop", "winkel", "webshop", "categorie", "category", "categories",
  "tag", "tags", "author", "auteur", "authors", "cart", "winkelwagen", "winkelmand", "checkout", "afrekenen",
  "account", "mijn-account", "login", "inloggen", "register", "contact", "privacy", "privacybeleid",
  "cookie", "cookies", "cookiebeleid", "voorwaarden", "algemene-voorwaarden", "terms", "disclaimer",
  "wp-admin", "wp-json", "wp-content", "wp-includes", "feed", "search", "zoeken", "page", "pagina",
  "vacatures", "jobs", "careers", "over-ons", "about", "about-us", "team", "attachment", "media",
]);

const ASSET_EXTENSION = /\.(?:jpe?g|png|gif|webp|svg|pdf|zip|docx?|xlsx?|pptx?|mp4|mp3|css|js|json|xml|gz|ico|woff2?)$/i;
const POST_SITEMAP = /(?:post|blog|article|artikel|nieuws|news|kennisbank|magazine)/i;
const SKIP_SITEMAP = /(?:product|category|categorie|tag|author|auteur|attachment|image|video|page-sitemap|taxonomy|shop|brand)/i;

function pathSegments(url: URL): string[] {
  return url.pathname.toLowerCase().split("/").filter(Boolean);
}

export function isInArticleSection(url: URL): boolean {
  return pathSegments(url).some((segment) => ARTICLE_SECTIONS.includes(segment));
}

/** Cheap URL-level filter; the page itself is checked later. */
export function isCandidateArticleUrl(url: URL, site: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (registrableDomain(url.hostname) !== registrableDomain(site.hostname)) return false;
  if (url.username || url.password) return false;
  if (ASSET_EXTENSION.test(url.pathname)) return false;
  const segments = pathSegments(url);
  if (segments.length === 0) return false;
  if (segments.some((segment) => EXCLUDED_SEGMENTS.has(segment))) return false;
  if (url.search && /(?:^|[?&])(?:p|page|s|add-to-cart|replytocom)=/i.test(url.search)) return false;
  // An overview page such as /blog itself is not an article.
  if (segments.length === 1 && ARTICLE_SECTIONS.includes(segments[0])) return false;
  // Without an article section, require a descriptive slug (e.g. /hoe-kies-je-een-e-bike).
  if (!isInArticleSection(url)) {
    const slug = segments[segments.length - 1];
    if (slug.split("-").filter(Boolean).length < 3) return false;
  }
  return true;
}

function canonicalKey(url: URL): string {
  const copy = new URL(url.toString());
  copy.hash = "";
  copy.search = "";
  copy.hostname = copy.hostname.replace(/^www\./, "");
  copy.protocol = "https:";
  return copy.toString().replace(/\/+$/, "");
}

function parseDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const date = new Date(value.trim());
  if (Number.isNaN(date.getTime())) return null;
  // Ignore obviously wrong dates (far future or before the web).
  if (date.getTime() > Date.now() + 2 * 24 * 3600 * 1000 || date.getUTCFullYear() < 1995) return null;
  return date;
}

// ---------------------------------------------------------------------------
// Sitemaps and feeds
// ---------------------------------------------------------------------------

export interface SitemapParseResult {
  sitemaps: string[];
  urls: Array<{ url: string; lastModified: Date | null }>;
}

export function parseSitemap(xml: string): SitemapParseResult {
  const $ = load(xml, { xml: true });
  const sitemaps = $("sitemapindex > sitemap > loc")
    .map((_i, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  const urls = $("urlset > url")
    .map((_i, el) => ({
      url: $(el).children("loc").first().text().trim(),
      lastModified: parseDate($(el).children("lastmod").first().text()),
    }))
    .get()
    .filter((entry) => entry.url)
    .slice(0, MAX_SITEMAP_URLS);
  return { sitemaps, urls };
}

export function parseFeed(xml: string): Array<{ url: string; lastModified: Date | null }> {
  const $ = load(xml, { xml: true });
  const rss = $("rss channel > item")
    .map((_i, el) => ({
      url: $(el).children("link").first().text().trim(),
      lastModified: parseDate($(el).children("pubDate").first().text()),
    }))
    .get();
  const atom = $("feed > entry")
    .map((_i, el) => {
      const link = $(el).children('link[rel="alternate"]').first().attr("href") ?? $(el).children("link").first().attr("href") ?? "";
      return {
        url: link.trim(),
        lastModified: parseDate($(el).children("published").first().text() || $(el).children("updated").first().text()),
      };
    })
    .get();
  return [...rss, ...atom].filter((entry) => entry.url);
}

// ---------------------------------------------------------------------------
// Article pages
// ---------------------------------------------------------------------------

function jsonLdObjects($: CheerioAPI): Array<Record<string, unknown>> {
  const objects: Array<Record<string, unknown>> = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") {
      objects.push(value as Record<string, unknown>);
      const graph = (value as Record<string, unknown>)["@graph"];
      if (graph) visit(graph);
    }
  };
  $('script[type="application/ld+json"]').each((_i, el) => {
    try {
      visit(JSON.parse($(el).text()));
    } catch {
      // Ignore invalid structured data.
    }
  });
  return objects;
}

function schemaTypes(objects: Array<Record<string, unknown>>): string[] {
  return objects.flatMap((object) => {
    const type = object["@type"];
    return (Array.isArray(type) ? type : [type]).filter((t): t is string => typeof t === "string");
  });
}

const ARTICLE_TYPES = new Set(["Article", "BlogPosting", "NewsArticle", "TechArticle", "Report", "HowTo", "FAQPage"]);

function cleanTitle(value: string): string {
  return normalizeText(value, 300).replace(/\s+[|–—-]\s+[^|–—-]{2,60}$/, "").trim();
}

/** Extract article details from an HTML page, or null when it is not an article. */
export function extractArticle(url: string, html: string, options: { fromPostSource?: boolean } = {}): ScannedArticle | null {
  const $ = load(html);
  const robots = ($('meta[name="robots"]').attr("content") ?? "").toLowerCase();
  if (robots.includes("noindex") && !options.fromPostSource) return null;

  const objects = jsonLdObjects($);
  const types = schemaTypes(objects);
  if (types.includes("Product")) return null;
  const ogType = ($('meta[property="og:type"]').attr("content") ?? "").toLowerCase();
  const markedAsArticle = ogType === "article" || types.some((type) => ARTICLE_TYPES.has(type));

  const container = $("article").first().length ? $("article").first() : $("main").first().length ? $("main").first() : $("body").first();
  const content = container.clone();
  content.find("script, style, noscript, nav, header, footer, aside, form, figure, iframe, svg").remove();
  const text = normalizeText(content.text(), 200_000);
  const wordCount = text ? text.split(/\s+/).length : 0;

  const urlObject = new URL(url);
  const inSection = isInArticleSection(urlObject);
  const isArticle =
    wordCount >= MIN_ARTICLE_WORDS &&
    (markedAsArticle || options.fromPostSource || inSection || $("article").length > 0);
  if (!isArticle) return null;

  const title = cleanTitle(
    $("h1").first().text() ||
      $('meta[property="og:title"]').attr("content") ||
      $("title").first().text(),
  );
  if (!title) return null;

  const description =
    normalizeText($('meta[name="description"]').attr("content") ?? $('meta[property="og:description"]').attr("content") ?? "", 400) || null;

  const seen = new Set<string>();
  const headings: string[] = [];
  content.find("h2, h3").each((_i, el) => {
    const heading = normalizeText($(el).text(), 160);
    const key = heading.toLocaleLowerCase("nl-NL");
    if (heading.length >= 3 && !seen.has(key) && headings.length < MAX_HEADINGS) {
      seen.add(key);
      headings.push(heading);
    }
  });

  const jsonLdDate = objects
    .map((object) => object.datePublished)
    .find((value): value is string => typeof value === "string");
  const publishedAt =
    parseDate($('meta[property="article:published_time"]').attr("content")) ??
    parseDate(jsonLdDate) ??
    parseDate($('meta[name="date"]').attr("content")) ??
    parseDate(container.find("time[datetime]").first().attr("datetime")) ??
    null;

  const canonical = $('link[rel="canonical"]').attr("href");
  let finalUrl = url;
  if (canonical) {
    try {
      const resolved = new URL(canonical, url);
      if (registrableDomain(resolved.hostname) === registrableDomain(urlObject.hostname)) finalUrl = resolved.toString();
    } catch {
      // Keep the fetched URL.
    }
  }

  return { url: finalUrl, title, description, headings, publishedAt, wordCount };
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface ScanOptions extends SafeHttpOptions {
  fetcher?: WebsiteFetcher;
  maxArticles?: number;
}

export async function scanWebsiteArticles(websiteUrl: string, options: ScanOptions = {}): Promise<InventoryResult> {
  const site = await validateWebsiteUrl(websiteUrl, options.resolver);
  const fetcher = options.fetcher ?? fetchSafe;
  const robots = await fetchRobots(site, { ...options, fetcher });
  if (robots.unavailable) throw new InventoryError("De website kon niet worden bereikt vanaf onze server. Mogelijk blokkeert een beveiliging van de website automatische bezoekers.");
  if (!robots.allowed(site.toString())) throw new InventoryError("De website blokkeert scanners via robots.txt.");

  const fetchOk = async (url: string, extra: SafeHttpOptions = {}): Promise<SafeResponse | null> => {
    try {
      if (!robots.allowed(url)) return null;
      const response = await fetcher(url, { ...options, ...extra });
      return response.status >= 200 && response.status < 300 ? response : null;
    } catch {
      return null;
    }
  };

  const candidates = new Map<string, Candidate>();
  const addCandidate = (raw: string, lastModified: Date | null, fromPostSource: boolean, base: string = site.toString()) => {
    let url: URL;
    try {
      url = new URL(raw, base);
    } catch {
      return;
    }
    if (!robots.allowed(url.toString())) return;
    if (!fromPostSource && !isCandidateArticleUrl(url, site)) return;
    if (fromPostSource && registrableDomain(url.hostname) !== registrableDomain(site.hostname)) return;
    const key = canonicalKey(url);
    const existing = candidates.get(key);
    if (!existing) candidates.set(key, { url: url.toString(), lastModified, fromPostSource });
    else if (fromPostSource) existing.fromPostSource = true;
  };

  // 1. Sitemaps
  let source: DiscoverySource | null = null;
  const queue = [
    ...robots.sitemaps,
    new URL("/sitemap.xml", site).toString(),
    new URL("/sitemap_index.xml", site).toString(),
    new URL("/wp-sitemap.xml", site).toString(),
  ];
  const visited = new Set<string>();
  while (queue.length && visited.size < MAX_SITEMAP_FILES) {
    const sitemapUrl = queue.shift()!;
    if (visited.has(sitemapUrl) || sitemapUrl.endsWith(".gz")) continue;
    visited.add(sitemapUrl);
    const response = await fetchOk(sitemapUrl, { accept: XML_ACCEPT, maxBytes: SITEMAP_MAX_BYTES });
    if (!response) continue;
    const parsed = parseSitemap(response.body);
    // Post sitemaps first, skip product/category/tag sitemaps.
    const children = parsed.sitemaps.filter((child) => !SKIP_SITEMAP.test(child) || POST_SITEMAP.test(child));
    children.sort((a, b) => Number(POST_SITEMAP.test(b)) - Number(POST_SITEMAP.test(a)));
    queue.unshift(...children);
    const isPostSitemap = POST_SITEMAP.test(sitemapUrl);
    for (const entry of parsed.urls) addCandidate(entry.url, entry.lastModified, isPostSitemap, sitemapUrl);
  }
  if (candidates.size) source = "sitemap";

  // 2. Feeds
  if (!candidates.size) {
    for (const path of ["/feed", "/rss.xml", "/feed.xml", "/blog/feed", "/atom.xml", "/blog/rss.xml"]) {
      const response = await fetchOk(new URL(path, site).toString(), { accept: XML_ACCEPT });
      if (!response) continue;
      for (const entry of parseFeed(response.body)) addCandidate(entry.url, entry.lastModified, true);
    }
    if (candidates.size) source = "rss";
  }

  // 3. Blog overview pages
  if (!candidates.size) {
    const homepage = await fetchOk(site.toString());
    const indexPages = new Set<string>();
    if (homepage) {
      const $ = load(homepage.body);
      $("a[href]").each((_i, el) => {
        try {
          const href = new URL($(el).attr("href") ?? "", homepage.url);
          const segments = pathSegments(href);
          if (registrableDomain(href.hostname) === registrableDomain(site.hostname) &&
            segments.length === 1 && ARTICLE_SECTIONS.includes(segments[0])) indexPages.add(href.toString());
          addCandidate(href.toString(), null, false, homepage.url);
        } catch {
          // Ignore malformed links.
        }
      });
    }
    for (const path of ["/blog", "/nieuws", "/artikelen", "/kennisbank", "/magazine", "/inspiratie", "/tips"]) {
      indexPages.add(new URL(path, site).toString());
    }
    const pending = [...indexPages];
    let fetched = 0;
    const seenIndex = new Set<string>();
    while (pending.length && fetched < MAX_INDEX_PAGES) {
      const pageUrl = pending.shift()!;
      if (seenIndex.has(pageUrl)) continue;
      seenIndex.add(pageUrl);
      const response = await fetchOk(pageUrl);
      fetched++;
      if (!response) continue;
      const $ = load(response.body);
      $("a[href]").each((_i, el) => addCandidate($(el).attr("href") ?? "", null, false, response.url));
      const nextPage = $('a[rel="next"]').attr("href");
      if (nextPage) {
        try {
          pending.unshift(new URL(nextPage, response.url).toString());
        } catch {
          // Ignore.
        }
      }
    }
    if (candidates.size) source = "crawl";
  }

  // Newest first, then fetch and verify each page.
  const ordered = [...candidates.values()]
    .sort((a, b) =>
      Number(b.fromPostSource) - Number(a.fromPostSource) ||
      Number(isInArticleSection(new URL(b.url))) - Number(isInArticleSection(new URL(a.url))) ||
      (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0))
    .slice(0, Math.max(1, (options.maxArticles ?? MAX_ARTICLES) * 2));

  const limit = options.maxArticles ?? MAX_ARTICLES;
  let pagesChecked = 0;
  const found = new Map<string, ScannedArticle>();
  await mapLimit(ordered, FETCH_CONCURRENCY, async (candidate) => {
    if (found.size >= limit) return;
    const response = await fetchOk(candidate.url);
    pagesChecked++;
    if (!response) return;
    const type = (response.headers["content-type"] ?? "").toLowerCase();
    if (type && !type.includes("html")) return;
    const article = extractArticle(response.url, response.body, { fromPostSource: candidate.fromPostSource });
    if (!article) return;
    if (!article.publishedAt && candidate.lastModified) article.publishedAt = candidate.lastModified;
    const key = canonicalKey(new URL(article.url));
    if (!found.has(key) && found.size < limit) found.set(key, article);
  });

  const articles = [...found.values()].sort(
    (a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
  );
  return { source, pagesChecked, articles };
}
