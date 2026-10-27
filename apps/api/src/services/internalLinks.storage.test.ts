import assert from "node:assert/strict";
import test from "node:test";

test("internal links use the scanned website articles and Search Console, and only return links that fit the text", { skip: !process.env.DATABASE_URL }, async () => {
  const { db, partnersTable, websiteArticlesTable } = await import("@yellowlime/db");
  const { removePartner } = await import("./partnerRemoval");
  const { suggestInternalLinks } = await import("./internalLinks");

  const [partner] = await db.insert(partnersTable).values({ companyName: "Warmtebouw", websiteUrl: "https://www.warmtebouw.invalid/" }).returning();
  const content = "## Onderhoud\nEen warmtepomp gaat langer mee met onderhoud. Wie twijfelt over de kosten van een warmtepomp, ziet dat onderhoud loont.\n\n## Subsidie\nEr is subsidie voor een warmtepomp beschikbaar.";
  try {
    const empty = await suggestInternalLinks(partner.id, { subject: "Warmtepomp onderhoud", content }, { runner: async () => "{}", pageMetrics: async () => null });
    assert.equal(empty?.articlesKnown, 0);
    assert.match(empty?.message ?? "", /Scan eerst de website/);

    await db.insert(websiteArticlesTable).values([
      { partnerId: partner.id, url: "https://www.warmtebouw.invalid/blog/kosten-warmtepomp/", title: "Wat kost een warmtepomp?", headings: ["Kosten"] },
      { partnerId: partner.id, url: "https://www.warmtebouw.invalid/blog/subsidie-warmtepomp/", title: "Subsidie voor je warmtepomp", headings: [] },
      { partnerId: partner.id, url: "https://www.warmtebouw.invalid/vacatures/", title: "Vacatures", headings: [] },
    ]);
    let prompt = "";
    const result = await suggestInternalLinks(
      partner.id,
      { subject: "Warmtepomp onderhoud", content },
      {
        pageMetrics: async () => [{ key: "https://www.warmtebouw.invalid/blog/subsidie-warmtepomp/", clicks: 3, impressions: 700, position: 11.2 }],
        runner: async (input) => {
          prompt = input;
          return JSON.stringify({ links: [
            { page: "p1", anchor: "subsidie voor een warmtepomp", reason: "Lezers willen weten welke subsidie er is." },
            { page: "p2", anchor: "kosten van een warmtepomp", reason: "Uitleg over de kosten." },
            { page: "p2", anchor: "staat niet in de tekst", reason: "" },
          ] });
        },
      },
    );
    assert.ok(result);
    assert.equal(result.articlesKnown, 3);
    assert.equal(result.candidatesConsidered, 2, "vacatures is not related");
    assert.equal(result.searchConsole, true);
    assert.match(prompt, /\[p1\] Subsidie voor je warmtepomp .*positie 11\.2/);
    assert.deepEqual(result.suggestions.map((s) => s.anchor), ["subsidie voor een warmtepomp", "kosten van een warmtepomp"]);
    assert.deepEqual(result.suggestions[0].gsc, { clicks: 3, impressions: 700, position: 11.2 });
    assert.equal(result.message, null);
  } finally {
    await removePartner(partner.id);
  }
});
