import test from "node:test";
import assert from "node:assert/strict";
import { analyseDomain, buildInsights, isBranded, parsePages, rootDomain, type ReportRunner } from "./domainAnalysis";

// Rows as Semrush returned them for warmtebouw.nl (header removed).
const SAMPLE: Record<string, string[][]> = {
  domain_rank: [["warmtebouw.nl", "143728", "363", "898", "1248", "12", "24", "51", "49", "40", "40", "30", "30", "30", "30", "27"]],
  resource_rank_history: [
    ["20261015", "385", "899"], ["20260915", "389", "882"], ["20260815", "380", "1300"], ["20260715", "370", "1250"],
  ],
  resource_organic: [
    ["warmtebouw", "1", "1", "720", "https://www.warmtebouw.nl/", "64.14", "20.00", "2"],
    ["warmtebouw utrecht", "1", "1", "170", "https://www.warmtebouw.nl/", "15.14", "24.00", "2"],
  ],
  resource_organic_unique: [
    ["https://www.warmtebouw.nl/", "19", "712", "79.28"],
    ["http://www.warmtebouw.nl/", "8", "38", "4.23"],
  ],
  domain_organic_organic: [["firestopholland.nl", "0.17", "12", "187", "215"]],
};
const OPPORTUNITIES = [
  ["sprinklerinstallatie", "18", "2900", "https://www.warmtebouw.nl/hoe-werkt-een-sprinklerinstallatie/", "22.00"],
  ["vindenberg", "20", "1000", "https://www.warmtebouw.nl/project/bedrijvenpark-berg-en-bosch/", "30.00"],
];

const runner: ReportRunner = async (report, params) =>
  report === "resource_organic" && params.display_filter ? OPPORTUNITIES : SAMPLE[report] ?? [];

test("root domain strips protocol, www and path", () => {
  assert.equal(rootDomain("https://www.warmtebouw.nl/over-ons"), "warmtebouw.nl");
  assert.equal(rootDomain("atlasfietsen.nl"), "atlasfietsen.nl");
});

test("brand keywords are recognised", () => {
  assert.ok(isBranded("warmtebouw utrecht", "warmtebouw.nl"));
  assert.ok(!isBranded("sprinklerinstallatie", "warmtebouw.nl"));
});

test("http and https versions of a page are merged", () => {
  const pages = parsePages(SAMPLE.resource_organic_unique);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].traffic, 750);
});

test("analysis combines all reports with the right numbers", async () => {
  const a = await analyseDomain("warmtebouw.nl", runner);
  assert.equal(a.overview.keywords, 363);
  assert.equal(a.overview.traffic, 898);
  assert.deepEqual(a.overview.positions, { top3: 12, top10: 24, top20: 51, top100: 276 });
  assert.deepEqual(a.history.map((h) => h.month), ["2026-07", "2026-08", "2026-09", "2026-10"]);
  assert.equal(a.keywords[0].intent, "navigatie");
  assert.equal(a.opportunities[0].keyword, "sprinklerinstallatie");
  assert.equal(a.competitors[0].domain, "firestopholland.nl");
  assert.ok(a.unitsEstimate > 0);
});

test("insights only use numbers from the data", async () => {
  const a = await analyseDomain("warmtebouw.nl", runner);
  const text = a.insights.map((i) => i.text).join("\n");
  assert.match(text, /daalde in drie maanden met 28%/);        // 1250 → 899
  assert.match(text, /79% van het verkeer komt van zoekopdrachten op de bedrijfsnaam/);
  assert.match(text, /2 zoekwoorden staan op pagina 2 .* 3\.900 zoekopdrachten/);
  assert.match(text, /"sprinklerinstallatie" op positie 18/);
  // Competitor has less traffic, so no competitor warning.
  assert.doesNotMatch(text, /Concurrent/);
});

test("no insights crash on an empty domain", () => {
  const insights = buildInsights({
    domain: "leeg.nl", database: "nl",
    overview: { rank: null, keywords: 0, traffic: 0, trafficValue: 0, positions: { top3: 0, top10: 0, top20: 0, top100: 0 } },
    history: [], keywords: [], opportunities: [], pages: [], competitors: [],
  });
  assert.deepEqual(insights, []);
});
