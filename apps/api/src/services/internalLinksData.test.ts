import assert from "node:assert/strict";
import test from "node:test";
import {
  applyInternalLink,
  chooseLinkCandidates,
  contextAround,
  findAnchor,
  linkedUrls,
  makeInternalLinksPrompt,
  normalizeUrl,
  parseInternalLinks,
  type LinkPage,
} from "./internalLinksData";

const article = [
  "## Waarom onderhoud belangrijk is",
  "Een warmtepomp gaat langer mee als je hem goed onderhoudt. Wie twijfelt over de kosten van een warmtepomp, ziet dat onderhoud zich terugverdient.",
  "",
  "## Subsidie",
  "Er is subsidie voor een warmtepomp beschikbaar. Lees ook [ons stuk over isolatie](https://w.nl/blog/isolatie/).",
].join("\n");

const pages: LinkPage[] = [
  { url: "https://www.w.nl/blog/kosten-warmtepomp/", title: "Wat kost een warmtepomp?", headings: ["Aanschaf", "Kosten per jaar"], description: null },
  { url: "https://w.nl/blog/subsidie-warmtepomp", title: "Subsidie voor je warmtepomp", headings: [], description: "ISDE uitgelegd" },
  { url: "https://w.nl/blog/isolatie", title: "Isolatie en warmtepomp", headings: [], description: null },
  { url: "https://w.nl/vacatures", title: "Vacatures", headings: [], description: null },
];

test("normalizes URLs so the same page is recognised", () => {
  assert.equal(normalizeUrl("https://www.W.nl/blog/x/?utm=1#top"), "w.nl/blog/x");
  assert.equal(normalizeUrl("http://w.nl/blog/x"), "w.nl/blog/x");
  assert.deepEqual([...linkedUrls(article)], ["w.nl/blog/isolatie"]);
});

test("chooses related pages, skips pages already linked and unrelated pages, and favours near-top pages", () => {
  const plain = chooseLinkCandidates("Warmtepomp onderhoud", article, pages, null);
  const urls = plain.map((c) => c.url);
  assert.ok(urls.includes("https://www.w.nl/blog/kosten-warmtepomp/"));
  assert.ok(!urls.includes("https://w.nl/blog/isolatie"), "already linked in the text");
  assert.ok(!urls.includes("https://w.nl/vacatures"), "not related");
  assert.deepEqual(plain.map((c) => c.id), ["p1", "p2"]);

  const metrics = new Map([["w.nl/blog/subsidie-warmtepomp", { clicks: 4, impressions: 900, position: 9.3 }]]);
  const boosted = chooseLinkCandidates("Warmtepomp onderhoud", article, pages, metrics);
  assert.equal(boosted[0].url, "https://w.nl/blog/subsidie-warmtepomp");
  assert.deepEqual(boosted[0].gsc, { clicks: 4, impressions: 900, position: 9.3 });
});

test("only links anchors in paragraphs, on whole words, outside existing links", () => {
  assert.equal(findAnchor(article, "Subsidie"), -1, "only in a heading (case-sensitive)");
  assert.ok(findAnchor(article, "kosten van een warmtepomp") > 0);
  assert.equal(findAnchor(article, "isolatie"), -1, "inside an existing link");
  assert.equal(findAnchor(article, "warmtepom"), -1, "not part of a word");
  assert.equal(
    contextAround(article, findAnchor(article, "kosten van een warmtepomp"), "kosten van een warmtepomp"),
    "Wie twijfelt over de kosten van een warmtepomp, ziet dat onderhoud zich terugverdient.",
  );
});

test("parses Claude's answer and drops invented pages, missing or vague anchors and duplicates", () => {
  const candidates = chooseLinkCandidates("Warmtepomp onderhoud", article, pages, null);
  const kosten = candidates.find((c) => c.url.includes("kosten"))!;
  const subsidie = candidates.find((c) => c.url.includes("subsidie"))!;
  const raw = `Hier: ${JSON.stringify({
    links: [
      { page: kosten.id, anchor: "kosten van een warmtepomp", reason: "Lezers willen weten wat het kost." },
      { page: subsidie.id, anchor: "klik hier", reason: "" },
      { page: subsidie.id, anchor: "subsidie voor een warmtepomp", reason: "Uitleg over subsidie." },
      { page: kosten.id, anchor: "onderhoud", reason: "dubbel" },
      { page: "p9", anchor: "warmtepomp", reason: "verzonnen pagina" },
      { page: subsidie.id, anchor: "staat niet in de tekst", reason: "" },
    ],
  })}`;
  const out = parseInternalLinks(raw, candidates, article);
  assert.deepEqual(out.map((s) => [s.url, s.anchor]), [
    [kosten.url, "kosten van een warmtepomp"],
    [subsidie.url, "subsidie voor een warmtepomp"],
  ]);
  assert.throws(() => parseInternalLinks("geen json", candidates, article), /invalid_claude_json/);
});

test("applies a link once, in the right place", () => {
  const out = applyInternalLink(article, "kosten van een warmtepomp", "https://w.nl/blog/kosten-warmtepomp/");
  assert.match(out, /over de \[kosten van een warmtepomp\]\(https:\/\/w\.nl\/blog\/kosten-warmtepomp\/\), ziet/);
  assert.equal(applyInternalLink(out, "kosten van een warmtepomp", "https://x"), out, "not linked twice");
});

test("the prompt lists the pages with their Google data and the rules", () => {
  const metrics = new Map([["w.nl/blog/subsidie-warmtepomp", { clicks: 4, impressions: 900, position: 9.3 }]]);
  const candidates = chooseLinkCandidates("Warmtepomp onderhoud", article, pages, metrics);
  const prompt = makeInternalLinksPrompt({ companyName: "Warmtebouw", subject: "Warmtepomp onderhoud", content: article, candidates });
  assert.match(prompt, /\[p1\] Subsidie voor je warmtepomp \| https:\/\/w\.nl\/blog\/subsidie-warmtepomp .*positie 9\.3, 900 vertoningen/);
  assert.match(prompt, /LETTERLIJK/);
  assert.match(prompt, /<<<ARTIKEL\n## Waarom onderhoud/);
});
