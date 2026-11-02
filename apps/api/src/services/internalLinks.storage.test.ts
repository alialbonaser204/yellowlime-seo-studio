import assert from "node:assert/strict";
import test from "node:test";

test("the internal link check uses the scanned pages and Search Console, and only returns exact matches", { skip: !process.env.DATABASE_URL }, async () => {
  const { db, partnersTable, websiteArticlesTable } = await import("@yellowlime/db");
  const { removePartner } = await import("./partnerRemoval");
  const { suggestInternalLinks } = await import("./internalLinks");

  const [partner] = await db.insert(partnersTable).values({ companyName: "Warmtebouw", websiteUrl: "https://www.warmtebouw.invalid/" }).returning();
  const content = "## Onderhoud\nEen warmtepomp gaat langer mee met onderhoud. Wie twijfelt over de kosten warmtepomp, ziet dat onderhoud loont.\n\nEr is subsidie voor je warmtepomp beschikbaar.";
  try {
    const empty = await suggestInternalLinks(partner.id, { subject: "Warmtepomp onderhoud", content }, { pageMetrics: async () => null });
    assert.equal(empty?.articlesKnown, 0);
    assert.match(empty?.message ?? "", /Scan eerst de website/);

    await db.insert(websiteArticlesTable).values([
      { partnerId: partner.id, url: "https://www.warmtebouw.invalid/blog/kosten-warmtepomp/", title: "Wat kost een warmtepomp?", headings: [] },
      { partnerId: partner.id, url: "https://www.warmtebouw.invalid/blog/subsidie-isde/", title: "ISDE-subsidie aanvragen", headings: [] },
      { partnerId: partner.id, url: "https://www.warmtebouw.invalid/vacatures/", title: "Vacatures", headings: [] },
    ]);
    const result = await suggestInternalLinks(partner.id, { subject: "Warmtepomp onderhoud", content }, {
      pageMetrics: async () => [{ key: "https://www.warmtebouw.invalid/blog/kosten-warmtepomp/", clicks: 3, impressions: 700, position: 11.2 }],
    });
    assert.ok(result);
    assert.equal(result.articlesKnown, 3);
    assert.equal(result.searchConsole, true);
    assert.deepEqual(result.suggestions.map((s) => [s.anchor, s.url]), [["kosten warmtepomp", "https://www.warmtebouw.invalid/blog/kosten-warmtepomp/"]]);
    assert.deepEqual(result.suggestions[0].gsc, { clicks: 3, impressions: 700, position: 11.2 });

    const none = await suggestInternalLinks(partner.id, { subject: "x", content: "Een tekst zonder enige overeenkomst met de pagina's op de website van deze partner." }, { pageMetrics: async () => null });
    assert.equal(none?.suggestions.length, 0);
    assert.match(none?.message ?? "", /Geen exacte matches/);
  } finally {
    await removePartner(partner.id);
  }
});
