import assert from "node:assert/strict";
import test from "node:test";
import {
  applyInternalLink,
  contextAround,
  exactOccurrences,
  findExactInternalLinks,
  linkedUrls,
  normalizeUrl,
  pagePhrases,
  slugPhrase,
  titlePhrases,
  type LinkPage,
} from "./internalLinksData";

const article = [
  "## Subsidie warmtepomp",
  "Een warmtepomp gaat langer mee als je hem goed onderhoudt. Wie twijfelt over de Kosten van een warmtepomp, ziet dat onderhoud loont.",
  "",
  "## Wat je moet weten",
  "Je kunt subsidie warmtepomp aanvragen bij RVO. Lees ook [ons stuk over isolatie](https://w.nl/blog/isolatie-woning/).",
  "Een hybride warmtepomp is een goede eerste stap; de warmtepompen van vandaag zijn stil.",
].join("\n");

const pages: LinkPage[] = [
  { url: "https://www.w.nl/blog/kosten-van-een-warmtepomp/", title: "Wat kost een warmtepomp? | Warmtebouw" },
  { url: "https://w.nl/blog/subsidie-warmtepomp-2026", title: "Alles over subsidie voor je warmtepomp in 2026" },
  { url: "https://w.nl/blog/isolatie-woning", title: "Isolatie woning" },
  { url: "https://w.nl/blog/hybride-warmtepomp", title: "Hybride warmtepomp: zo werkt het" },
  { url: "https://w.nl/blog/warmtepomp", title: "Warmtepomp" },
  { url: "https://w.nl/over-ons", title: "Over ons" },
];

test("reads the main keyword from the URL and the title", () => {
  assert.equal(slugPhrase("https://w.nl/blog/subsidie-warmtepomp-2026/"), "subsidie warmtepomp");
  assert.equal(slugPhrase("https://w.nl/blog/warmtepomp"), null, "one word is too general");
  assert.equal(slugPhrase("https://w.nl/over-ons"), null, "no real content word");
  assert.deepEqual(titlePhrases("Wat kost een warmtepomp? | Warmtebouw"), ["wat kost een warmtepomp"]);
  assert.deepEqual(titlePhrases("Hybride warmtepomp: zo werkt het"), ["hybride warmtepomp zo werkt het", "hybride warmtepomp"]);
  assert.deepEqual(pagePhrases(pages[3]).map((p) => [p.phrase, p.source]), [["hybride warmtepomp", "url"], ["hybride warmtepomp zo werkt het", "titel"]]);
});

test("only exact whole-word matches in paragraphs count, capitals do not matter", () => {
  assert.deepEqual(exactOccurrences(article, "subsidie warmtepomp").map((o) => o.text), ["subsidie warmtepomp"], "the heading is skipped");
  assert.deepEqual(exactOccurrences(article, "kosten van een warmtepomp").map((o) => o.text), ["Kosten van een warmtepomp"]);
  assert.equal(exactOccurrences(article, "isolatie").length, 0, "inside an existing link");
  assert.equal(exactOccurrences(article, "hybride warmtepompen").length, 0, "no partial words");
});

test("finds one link per page, in text order, without changing words and skipping pages already linked", () => {
  const metrics = new Map([[normalizeUrl("https://w.nl/blog/subsidie-warmtepomp-2026/"), { clicks: 4, impressions: 900, position: 9.3 }]]);
  const { suggestions, pagesWithKeyword } = findExactInternalLinks(article, pages, metrics);
  assert.equal(pagesWithKeyword, 4, "warmtepomp and over ons have no usable keyword");
  assert.deepEqual(suggestions.map((s) => [s.anchor, s.url]), [
    ["Kosten van een warmtepomp", "https://www.w.nl/blog/kosten-van-een-warmtepomp/"],
    ["subsidie warmtepomp", "https://w.nl/blog/subsidie-warmtepomp-2026"],
    ["hybride warmtepomp", "https://w.nl/blog/hybride-warmtepomp"],
  ]);
  assert.deepEqual(suggestions[1].gsc, { clicks: 4, impressions: 900, position: 9.3 });
  assert.match(suggestions[0].reason, /URL/);
  assert.ok(!suggestions.some((s) => s.url.includes("isolatie")), "already linked");
});

test("longer matches win and links never overlap", () => {
  const text = "Een hybride warmtepomp zo werkt het eenvoudig, zeker een hybride warmtepomp.";
  const { suggestions } = findExactInternalLinks(text, [
    { url: "https://w.nl/blog/hybride-warmtepomp", title: "Hybride warmtepomp: zo werkt het" },
    { url: "https://w.nl/blog/warmtepomp-zo", title: "Warmtepomp zo" },
  ]);
  assert.equal(suggestions[0].anchor, "hybride warmtepomp zo werkt het");
  assert.equal(suggestions.length, 1, "\"warmtepomp zo\" only occurs inside the longer match");
});

test("shows the sentence around the match and applies the link without changing the words", () => {
  const index = article.indexOf("Kosten van een warmtepomp");
  assert.equal(contextAround(article, index, "Kosten van een warmtepomp"), "Wie twijfelt over de Kosten van een warmtepomp, ziet dat onderhoud loont.");
  const out = applyInternalLink(article, "subsidie warmtepomp", "https://w.nl/blog/subsidie-warmtepomp-2026");
  assert.match(out, /Je kunt \[subsidie warmtepomp\]\(https:\/\/w\.nl\/blog\/subsidie-warmtepomp-2026\) aanvragen/);
  assert.match(out, /^## Subsidie warmtepomp$/m, "the heading stays as it is");
  const strip = (t: string) => t.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  assert.equal(strip(out), strip(article), "only a link was added, no words changed");
  assert.deepEqual([...linkedUrls(out)].sort(), ["w.nl/blog/isolatie-woning", "w.nl/blog/subsidie-warmtepomp-2026"]);
});
