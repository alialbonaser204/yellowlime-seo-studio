import assert from "node:assert/strict";
import test from "node:test";
import { extractArticle, isCandidateArticleUrl, parseFeed, parseSitemap, scanWebsiteArticles } from "./articleInventory";
import type { SafeResponse } from "./safeHttp";

const resolver = async () => [{ address: "93.184.216.34", family: 4 as const }];

const words = (n: number, word = "fiets") => Array.from({ length: n }, (_, i) => `${word}${i % 7}`).join(" ");

function articlePage(title: string, opts: { headings?: string[]; date?: string; words?: number; jsonLd?: string; product?: boolean } = {}) {
  const ld = opts.product
    ? `<script type="application/ld+json">{"@type":"Product","name":"${title}"}</script>`
    : opts.jsonLd ?? `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"BlogPosting","datePublished":"${opts.date ?? "2026-03-12T09:00:00Z"}"}]}</script>`;
  return `<!doctype html><html><head><title>${title} | Atlas Fietsen</title>
    <meta name="description" content="Alles over ${title.toLowerCase()}.">${ld}</head>
    <body><header><nav><a href="/">Home</a></nav></header>
    <article><h1>${title}</h1>${(opts.headings ?? []).map((h) => `<h2>${h}</h2><p>${words(40)}</p>`).join("")}
    <p>${words(opts.words ?? 400)}</p></article><footer>© Atlas</footer></body></html>`;
}

type Site = Record<string, { status?: number; body: string; type?: string }>;

function fakeFetcher(site: Site, log: string[] = []) {
  return async (url: string): Promise<SafeResponse> => {
    const key = new URL(url).pathname + new URL(url).search;
    log.push(key);
    const page = site[key];
    if (!page) return { url, status: 404, headers: { "content-type": "text/html" }, body: "" };
    return { url, status: page.status ?? 200, headers: { "content-type": page.type ?? "text/html; charset=utf-8" }, body: page.body };
  };
}

test("classifies article-like URLs", () => {
  const site = new URL("https://www.atlasfietsen.nl");
  const ok = (path: string) => isCandidateArticleUrl(new URL(path, site), site);
  assert.equal(ok("/blog/e-bike-onderhoud-tips"), true);
  assert.equal(ok("/hoe-kies-je-de-juiste-e-bike"), true);
  assert.equal(ok("/blog"), false);
  assert.equal(ok("/product/atlas-e-bike-500"), false);
  assert.equal(ok("/categorie/e-bikes"), false);
  assert.equal(ok("/contact"), false);
  assert.equal(ok("/e-bikes"), false);
  assert.equal(ok("/wp-content/uploads/foto.jpg"), false);
  assert.equal(ok("https://andere-site.nl/blog/iets-over-fietsen"), false);
});

test("parses sitemap indexes, url sets, RSS and Atom", () => {
  const index = parseSitemap(`<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://a.nl/post-sitemap.xml</loc></sitemap></sitemapindex>`);
  assert.deepEqual(index.sitemaps, ["https://a.nl/post-sitemap.xml"]);
  const set = parseSitemap(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://a.nl/x</loc><lastmod>2026-01-02</lastmod></url></urlset>`);
  assert.equal(set.urls[0].url, "https://a.nl/x");
  assert.equal(set.urls[0].lastModified?.toISOString().slice(0, 10), "2026-01-02");
  const rss = parseFeed(`<rss><channel><item><link>https://a.nl/blog/een</link><pubDate>Thu, 12 Mar 2026 09:00:00 GMT</pubDate></item></channel></rss>`);
  assert.equal(rss[0].url, "https://a.nl/blog/een");
  const atom = parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><entry><link rel="alternate" href="https://a.nl/blog/twee"/><published>2026-02-01T00:00:00Z</published></entry></feed>`);
  assert.equal(atom[0].url, "https://a.nl/blog/twee");
});

test("extracts title, headings, date and rejects non-articles", () => {
  const article = extractArticle("https://a.nl/blog/e-bike-onderhoud", articlePage("E-bike onderhoud: 7 tips", { headings: ["De ketting smeren", "Bandenspanning"] }));
  assert.ok(article);
  assert.equal(article.title, "E-bike onderhoud: 7 tips");
  assert.deepEqual(article.headings, ["De ketting smeren", "Bandenspanning"]);
  assert.equal(article.publishedAt?.toISOString().slice(0, 10), "2026-03-12");
  assert.equal(article.description, "Alles over e-bike onderhoud: 7 tips.");
  assert.equal(extractArticle("https://a.nl/blog/kort", articlePage("Kort", { words: 20 })), null, "too short");
  assert.equal(extractArticle("https://a.nl/blog/fiets-x", articlePage("Fiets X", { product: true })), null, "product page");
});

test("scans a WordPress-style site through its sitemaps", async () => {
  const log: string[] = [];
  const site: Site = {
    "/robots.txt": { body: "User-agent: *\nDisallow: /geheim/\nSitemap: https://www.atlasfietsen.nl/sitemap_index.xml", type: "text/plain" },
    "/sitemap_index.xml": { type: "application/xml", body: `<sitemapindex><sitemap><loc>https://www.atlasfietsen.nl/product-sitemap.xml</loc></sitemap><sitemap><loc>https://www.atlasfietsen.nl/post-sitemap.xml</loc></sitemap></sitemapindex>` },
    "/post-sitemap.xml": { type: "application/xml", body: `<urlset>
      <url><loc>https://www.atlasfietsen.nl/e-bike-onderhoud</loc><lastmod>2026-03-12</lastmod></url>
      <url><loc>https://www.atlasfietsen.nl/welke-e-bike-past-bij-mij</loc><lastmod>2026-05-01</lastmod></url>
      <url><loc>https://www.atlasfietsen.nl/geheim/interne-notitie-over-iets</loc></url>
    </urlset>` },
    "/product-sitemap.xml": { type: "application/xml", body: `<urlset><url><loc>https://www.atlasfietsen.nl/product/atlas-500</loc></url></urlset>` },
    "/e-bike-onderhoud": { body: articlePage("E-bike onderhoud", { headings: ["Ketting"], date: "2026-03-12T09:00:00Z" }) },
    "/welke-e-bike-past-bij-mij": { body: articlePage("Welke e-bike past bij mij?", { date: "2026-05-01T09:00:00Z" }) },
    "/geheim/interne-notitie-over-iets": { body: articlePage("Geheim") },
  };
  const result = await scanWebsiteArticles("https://www.atlasfietsen.nl", { resolver, fetcher: fakeFetcher(site, log) });
  assert.equal(result.source, "sitemap");
  assert.deepEqual(result.articles.map((a) => a.title), ["Welke e-bike past bij mij?", "E-bike onderhoud"]);
  assert.ok(!log.includes("/product-sitemap.xml"), "product sitemap is skipped");
  assert.ok(!log.includes("/geheim/interne-notitie-over-iets"), "robots.txt is respected");
});

test("falls back to the RSS feed", async () => {
  const site: Site = {
    "/robots.txt": { body: "User-agent: *\nAllow: /", type: "text/plain" },
    "/feed": { type: "application/rss+xml", body: `<rss><channel><item><link>https://shop.nl/accu-vervangen-zo-doe-je-dat</link></item></channel></rss>` },
    "/accu-vervangen-zo-doe-je-dat": { body: articlePage("Accu vervangen") },
  };
  const result = await scanWebsiteArticles("https://shop.nl", { resolver, fetcher: fakeFetcher(site) });
  assert.equal(result.source, "rss");
  assert.deepEqual(result.articles.map((a) => a.title), ["Accu vervangen"]);
});

test("falls back to crawling the blog overview, following pagination", async () => {
  const site: Site = {
    "/robots.txt": { body: "", type: "text/plain" },
    "/": { body: `<html><body><a href="/blog">Blog</a><a href="/contact">Contact</a></body></html>` },
    "/blog": { body: `<html><body><a href="/blog/fietsen-in-de-winter">Winter</a><a rel="next" href="/blog?pagina=2">Volgende</a></body></html>` },
    "/blog?pagina=2": { body: `<html><body><a href="/blog/zadel-goed-afstellen">Zadel</a></body></html>` },
    "/blog/fietsen-in-de-winter": { body: articlePage("Fietsen in de winter", { jsonLd: "" }) },
    "/blog/zadel-goed-afstellen": { body: articlePage("Zadel goed afstellen", { jsonLd: "" }) },
  };
  const result = await scanWebsiteArticles("https://klein.nl", { resolver, fetcher: fakeFetcher(site) });
  assert.equal(result.source, "crawl");
  assert.deepEqual(result.articles.map((a) => a.title).sort(), ["Fietsen in de winter", "Zadel goed afstellen"]);
});

test("refuses when robots.txt blocks the whole site", async () => {
  const site: Site = { "/robots.txt": { body: "User-agent: *\nDisallow: /", type: "text/plain" } };
  await assert.rejects(scanWebsiteArticles("https://dicht.nl", { resolver, fetcher: fakeFetcher(site) }), /blokkeert/);
});
