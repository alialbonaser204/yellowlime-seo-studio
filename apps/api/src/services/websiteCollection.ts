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

export async function collectWebsite(
  websiteUrl: string,
  options: SafeHttpOptions & { fetcher?: WebsiteFetcher } = {},
): Promise<WebsiteCollection> {
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

  const pages: ExtractedPage[] = [firstPage];
  const seen = new Set([new URL(firstPage.url).toString()]);
  for (const candidate of candidates) {
    if (pages.length >= MAX_PAGES) break;
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
      }
    } catch {
      // One unavailable secondary page must not discard useful collected pages.
    }
  }
  let remaining = MAX_TOTAL_TEXT;
  const outputPages = pages.map(({ url, title, text }) => {
    const bounded = text.slice(0, Math.min(text.length, remaining));
    remaining -= bounded.length;
    return { url, title, text: bounded };
  }).filter((page) => page.text.length > 0);
  if (!outputPages.length) throw new Error("De website bevat geen leesbare tekst.");
  return { pages: outputPages, text: outputPages.map((page) => `Bron: ${page.url}\n${page.text}`).join("\n\n").slice(0, MAX_TOTAL_TEXT) };
}