import assert from "node:assert/strict";
import test from "node:test";
import type { SafeResponse } from "./safeHttp";

const resolver = async () => [{ address: "93.184.216.34", family: 4 as const }];
const words = (n: number) => Array.from({ length: n }, (_, i) => `woord${i % 9}`).join(" ");
const page = (title: string, headings: string[] = []) =>
  `<html><head><meta property="og:type" content="article"></head><body><article><h1>${title}</h1>${headings.map((h) => `<h2>${h}</h2>`).join("")}<p>${words(400)}</p></article></body></html>`;

function siteFetcher(paths: string[]) {
  const pages: Record<string, string> = {
    "/blog/e-bike-onderhoud": page("E-bike onderhoud: 7 tips", ["Ketting smeren", "Bandenspanning"]),
    "/blog/welke-e-bike-past-bij-mij": page("Welke e-bike past bij mij?"),
    "/blog/fietsen-in-de-winter": page("Fietsen in de winter"),
  };
  return async (url: string): Promise<SafeResponse> => {
    const path = new URL(url).pathname;
    if (path === "/robots.txt") return { url, status: 200, headers: { "content-type": "text/plain" }, body: "" };
    if (path === "/sitemap.xml") {
      const body = `<urlset>${paths.map((p) => `<url><loc>https://www.atlas-test.nl${p}</loc></url>`).join("")}</urlset>`;
      return { url, status: 200, headers: { "content-type": "application/xml" }, body };
    }
    if (pages[path] && paths.includes(path)) return { url, status: 200, headers: { "content-type": "text/html" }, body: pages[path] };
    return { url, status: 404, headers: {}, body: "" };
  };
}

test("scans a website into the database, updates it, and checks topics against it", { skip: !process.env.DATABASE_URL }, async () => {
  const { db, partnersTable, websiteArticlesTable, pool } = await import("@yellowlime/db");
  const { eq } = await import("drizzle-orm");
  const { startWebsiteScan, runScan, listWebsiteArticles, latestScan } = await import("./websiteScan");
  const { checkTopic } = await import("./topicCheck");

  const [partner] = await db.insert(partnersTable).values({ companyName: "Atlas test", websiteUrl: "https://www.atlas-test.nl" }).returning();
  try {
    // First scan: three articles.
    const all = ["/blog/e-bike-onderhoud", "/blog/welke-e-bike-past-bij-mij", "/blog/fietsen-in-de-winter"];
    const scan = await startWebsiteScan(partner.id, { resolver, fetcher: siteFetcher([]) });
    assert.ok(scan);
    // The background scan above sees an empty site; run a real one explicitly and wait for it.
    await new Promise((r) => setTimeout(r, 200));
    await runScan(scan.id, partner.id, partner.websiteUrl, { resolver, fetcher: siteFetcher(all) });
    let articles = await listWebsiteArticles(partner.id);
    assert.deepEqual(articles.map((a) => a.title).sort(), ["E-bike onderhoud: 7 tips", "Fietsen in de winter", "Welke e-bike past bij mij?"]);
    assert.deepEqual(articles.find((a) => a.title.startsWith("E-bike"))?.headings, ["Ketting smeren", "Bandenspanning"]);
    const done = await latestScan(partner.id);
    assert.equal(done?.status, "completed");
    assert.equal(done?.articlesFound, 3);

    // Second scan: one article was removed from the website.
    await new Promise((r) => setTimeout(r, 20));
    await runScan(scan.id, partner.id, partner.websiteUrl, { resolver, fetcher: siteFetcher(all.slice(0, 2)) });
    articles = await listWebsiteArticles(partner.id);
    assert.equal(articles.length, 2);
    assert.ok(!articles.some((a) => a.title === "Fietsen in de winter"));

    // An empty scan keeps the existing list.
    await runScan(scan.id, partner.id, partner.websiteUrl, { resolver, fetcher: siteFetcher([]) });
    assert.equal((await listWebsiteArticles(partner.id)).length, 2);
    assert.equal((await latestScan(partner.id))?.status, "failed");

    // Topic check: Claude says duplicate; Google shows the partner on position 4.
    let prompt = "";
    const result = await checkTopic(
      { partnerId: partner.id, subject: "Onderhoud van je e-bike" },
      {
        runner: async (input) => {
          prompt = input;
          const n = input.match(/\[(\d)\] E-bike onderhoud/)?.[1];
          return JSON.stringify({ verdict: "duplicate", explanation: "Er staat al een artikel over e-bike onderhoud.", matches: [{ id: Number(n), relation: "duplicate", reason: "Zelfde vraag" }], alternatives: ["Winteronderhoud van je e-bike", "Wat kost onderhoud per jaar?", "E-bike accu bewaren"] });
        },
        semrushTransport: async () => new Response("Po;Dn;Ur\n1;nibud.nl;https://nibud.nl/x\n4;www.atlas-test.nl;https://www.atlas-test.nl/blog/e-bike-onderhoud\n"),
      },
    );
    assert.ok(result);
    assert.match(prompt, /E-bike onderhoud: 7 tips \| tussenkoppen: Ketting smeren; Bandenspanning/);
    assert.equal(result.verdict, "duplicate");
    assert.equal(result.matches[0].title, "E-bike onderhoud: 7 tips");
    assert.equal(result.matches.length, 1, "Google result for the same page is not listed twice");
    assert.deepEqual(result.googleRanking, { position: 4, url: "https://www.atlas-test.nl/blog/e-bike-onderhoud" });
    assert.match(result.explanation, /positie 4/);
    assert.equal(result.alternatives.length, 3);

    // A new topic that Google also doesn't show the partner for.
    const fresh = await checkTopic(
      { partnerId: partner.id, subject: "Fietsverzekering" },
      { runner: async () => '{"verdict":"new","explanation":"Nieuw onderwerp.","matches":[],"alternatives":["a","b","c"]}', semrushTransport: async () => new Response("ERROR 50 :: NOTHING FOUND") },
    );
    assert.equal(fresh?.verdict, "new");
    assert.equal(fresh?.googleRanking, null);

    // When Claude is unavailable the word-overlap fallback still flags the similar article.
    const fallback = await checkTopic(
      { partnerId: partner.id, subject: "e-bike onderhoud ketting" },
      { runner: async () => { throw new Error("claude_timeout"); }, skipGoogle: true },
    );
    assert.equal(fallback?.verdict, "related");
    assert.equal(fallback?.matches[0].title, "E-bike onderhoud: 7 tips");
  } finally {
    await db.delete(partnersTable).where(eq(partnersTable.id, partner.id));
    const left = await db.select().from(websiteArticlesTable).where(eq(websiteArticlesTable.partnerId, partner.id));
    assert.equal(left.length, 0, "articles are removed with the partner");
    await pool.end();
  }
});
