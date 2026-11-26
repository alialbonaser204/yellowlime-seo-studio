import test from "node:test";
import assert from "node:assert/strict";
import { pageToArticle, rankUnderperformers } from "./underperformers";
import { parseOptimization } from "./articleOptimizer";

const site = "https://www.voorbeeld.nl";
const m = (key: string, clicks: number, impressions: number, position: number) => ({ key, clicks, impressions, ctr: impressions ? clicks / impressions : 0, position });

test("ranks articles with the most to win first, with real reasons", () => {
  const pagesNow = [
    m(`${site}/blog/a`, 10, 4000, 4.2),   // low CTR vs site avg at 4-5
    m(`${site}/blog/b`, 40, 900, 14.5),   // page 2
    m(`${site}/blog/c`, 200, 2000, 2),    // fine
    m(`${site}/blog/d`, 20, 400, 3.0),    // dropped
    m(`${site}/diensten/x`, 300, 3000, 4.5), // not an article, but counts for the average
  ];
  const pagesBefore = [m(`${site}/blog/d`, 120, 600, 3)];
  const out = rankUnderperformers({
    siteUrl: site, pagesNow, pagesBefore,
    rows: [{ query: "fiets kopen", page: `${site}/blog/a`, clicks: 5, impressions: 3000, ctr: 0.002, position: 4 }],
    inventory: [{ url: `${site}/blog/e`, title: "Oud artikel", wordCount: 250, publishedAt: new Date("2021-01-01") }],
    now: new Date("2026-11-26"),
  });
  const urls = out.map((u) => u.url);
  assert.ok(!urls.includes(`${site}/blog/c`));
  assert.ok(!urls.includes(`${site}/diensten/x`));
  assert.ok(out.find((u) => u.url.endsWith("/a"))!.reasons.some((r) => r.code === "lage_ctr"));
  assert.ok(out.find((u) => u.url.endsWith("/b"))!.reasons.some((r) => r.code === "pagina2"));
  assert.ok(out.find((u) => u.url.endsWith("/d"))!.reasons.some((r) => r.code === "daling"));
  const e = out.find((u) => u.url.endsWith("/e"))!;
  assert.deepEqual(e.reasons.map((r) => r.code).sort(), ["dun", "onzichtbaar", "verouderd"]);
  assert.equal(out.find((u) => u.url.endsWith("/a"))!.topQueries[0].query, "fiets kopen");
  assert.ok(out.length <= 5);
});

test("reads an article page as markdown", () => {
  const html = `<html><head><title>Meta T</title><meta name="description" content="Meta D"></head><body><nav><p>Menu</p></nav><article><h1>Titel</h1><p>Intro <b>vet</b>.</p><h2>Kop</h2><ul><li>een</li><li>twee</li></ul><h3>Sub</h3><p>Tekst</p></article><footer><p>Voet</p></footer></body></html>`;
  const a = pageToArticle(html);
  assert.equal(a.metaTitle, "Meta T");
  assert.equal(a.metaDescription, "Meta D");
  assert.equal(a.fullArticle, "# Titel\n\nIntro vet.\n\n## Kop\n\n- een\n- twee\n\n### Sub\n\nTekst");
});

test("parses the optimisation answer", () => {
  const o = parseOptimization(JSON.stringify({ result: { title: "T", metaTitle: "M", metaDescription: "D", fullArticle: "# T\n\nx" }, overview: { diagnosis: "d", mainKeyword: "k", changes: [{ type: "raar", section: null, before: "a", after: "b", reason: "r" }, { type: "titel" }], expectedEffect: "e", checkBeforePublishing: ["c"] } }));
  assert.equal(o.overview.changes.length, 1);
  assert.equal(o.overview.changes[0].type, "overig");
  assert.throws(() => parseOptimization('{"result":{}}'));
});
