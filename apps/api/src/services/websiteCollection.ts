import { extractHtmlPage, type ExtractedPage, priorityForPath } from "./htmlExtraction";
import { fetchRobots, fetchSafe, type SafeHttpOptions, type SafeResponse } from "./safeHttp";
import { registrableDomain, sameRegistrableDomain, validateWebsiteUrl } from "./websiteUrlPolicy";

export const MAX_PAGES = 5;
export const MAX_TOTAL_TEXT = 100_000;

export type WebsiteFetcher = (url: string, options?: SafeHttpOptions) => Promise<SafeResponse>;

export interface WebsiteCollection {
  pages: Array<{ url: string; title: string; text: string }>;
  text: string;
}

function isHtml(response: SafeResponse): boolean {
  const type = (response.headers["content-type"] ?? "").toLowerCase();
  return type.includes("text/html") || type.includes("application/xhtml+xml");
}

export interface CollectOptions extends SafeHttpOptions {
  fetcher?: WebsiteFetcher;
  /** Maximum number of pages including the homepage (default 5). */
  maxPages?: number;
  /** Also read up to this many blog/article pages (for writing style). */
  articlePages?: number;
  /** Article URLs that are already known (e.g. from the website scan). */
  knownArticleUrls?: string[];
  maxTotalText?: number;
}

const ARTICLE_PATH = /\/(blog|nieuws|news|artikel|artikelen|kennisbank|tips|magazine|inspiratie|verhalen)\//;

export async function collectWebsite(
  websiteUrl: string,
  options: CollectOptions = {},
): Promise<WebsiteCollection> {
  const maxPages = options.maxPages ?? MAX_PAGES;
  const articleSlots = Math.min(options.articlePages ?? 0, Math.max(0, maxPages - 1));
  const origin = await validateWebsiteUrl(websiteUrl, options.resolver);
  const fetcher = options.fetcher ?? fetchSafe;
  const robots = await fetchRobots(origin, { ...options, fetcher });
  if (robots.unavailable) {
    throw new Error("robots.txt kon niet veilig worden gelezen.");
  }
  const homepage = origin.toString();
  if (!robots.allowed(homepage)) throw new Error("De website blokkeert deze analyse via robots.txt.");
  const responses = new Map<string, SafeResponse>();
  const first = await fetcher(homepage, options);
  const firstUrl = await validateWebsiteUrl(first.url, options.resolver);
  if (!sameRegistrableDomain(origin, firstUrl)) throw new Error("Doorverwijzing naar een ander domein is geblokkeerd.");
  if (!isHtml(first)) throw new Error("De website levert geen publieke HTML-pagina.");
  responses.set(first.url, first);
  const firstPage = extractHtmlPage(first.url, first.body);
  if (!firstPage.text) throw new Error("De website bevat geen leesbare tekst.");

  const candidates = firstPage.links
    .map((href) => {
      try {
        return new URL(href, first.url);
      } catch {
        return null;
      }
    })
    .filter((url): url is URL => Boolean(url))
    .filter((url) => (url.protocol === "http:" || url.protocol === "https:") &&
      registrableDomain(url.hostname) === registrableDomain(origin.hostname) &&
      !url.username && !url.password && robots.allowed(url.toString()))
    .sort((a, b) => priorityForPath(a.pathname) - priorityForPath(b.pathname));

  const isArticle = (url: URL) => ARTICLE_PATH.test(`${url.pathname.toLowerCase()}/`) && url.pathname.split("/").filter(Boolean).length >= 2;
  const articleCandidates = [
    ...(options.knownArticleUrls ?? []).map((href) => { try { return new URL(href); } catch { return null; } })
      .filter((url): url is URL => Boolean(url) && registrableDomain(url!.hostname) === registrableDomain(origin.hostname) && robots.allowed(url!.toString())),
    ...candidates.filter(isArticle),
  ].slice(0, articleSlots * 3);
  const regular = candidates.filter((url) => !isArticle(url));
  const regularSlots = maxPages - 1 - articleSlots;
  // Without article slots the original priority order is kept unchanged.
  const ordered = articleSlots === 0
    ? candidates
    : [...regular.slice(0, regularSlots), ...articleCandidates, ...regular.slice(regularSlots)];

  const pages: ExtractedPage[] = [firstPage];
  const seen = new Set([new URL(firstPage.url).toString()]);
  let articlesRead = 0;
  for (const candidate of ordered) {
    if (pages.length >= maxPages) break;
    if (articleSlots > 0 && isArticle(candidate) && articlesRead >= articleSlots) continue;
    const canonical = candidate.toString();
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    try {
      const response = await fetcher(canonical, options);
      const responseUrl = await validateWebsiteUrl(response.url, options.resolver);
      if (!sameRegistrableDomain(origin, responseUrl)) throw new Error("Doorverwijzing naar een ander domein is geblokkeerd.");
      if (!isHtml(response)) continue;
      const page = extractHtmlPage(response.url, response.body);
      if (page.text) {
        responses.set(response.url, response);
        pages.push(page);
        if (isArticle(candidate)) articlesRead++;
      }
    } catch {
      // One unavailable secondary page must not discard useful collected pages.
    }
  }
  let remaining = options.maxTotalText ?? MAX_TOTAL_TEXT;
  const outputPages = pages.map(({ url, title, text }) => {
    const bounded = text.slice(0, Math.min(text.length, remaining));
    remaining -= bounded.length;
    return { url, title, text: bounded };
  }).filter((page) => page.text.length > 0);
  if (!outputPages.length) throw new Error("De website bevat geen leesbare tekst.");
  return { pages: outputPages, text: outputPages.map((page) => `Bron: ${page.url}\n${page.text}`).join("\n\n").slice(0, MAX_TOTAL_TEXT) };
}