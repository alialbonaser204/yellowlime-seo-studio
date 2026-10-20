import assert from "node:assert/strict";
import test from "node:test";
import {
  covering,
  evidenceLines,
  intentLabel,
  makeIdeasPrompt,
  numbersGrounded,
  parseIdeas,
  parseTrend,
  queryThemes,
  scoreCandidate,
  trendPeak,
  type Candidate,
} from "./topicIdeasData";

const cand = (over: Partial<Candidate>): Candidate => ({
  id: "k1",
  keyword: "warmtepomp onderhoud",
  sources: ["Semrush"],
  semrush: { volume: 1300, difficulty: 28, intent: "1", trend: null },
  gsc: null,
  declining: null,
  covered: null,
  peak: null,
  score: 60,
  ...over,
});

test("reads intent codes and Semrush trends", () => {
  assert.equal(intentLabel("1"), "informatief");
  assert.equal(intentLabel("0,3"), "commercieel / transactioneel");
  assert.equal(parseTrend("0.5,0.6,x"), null);
  assert.equal(parseTrend("0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1,0.5,0.4")?.length, 12);
});

test("finds the month in which search interest peaks", () => {
  // October 2026: index 11 = September, index 0 = October 2025 … the peak at index 2 is December.
  const trend = [0.3, 0.5, 1, 0.6, 0.4, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3];
  assert.deepEqual(trendPeak(trend, new Date("2026-10-15")), { month: "december", monthsUntil: 2 });
  assert.equal(trendPeak([0.9, 1, 0.95, 0.9, 1, 0.92, 0.95, 0.9, 1, 0.9, 0.95, 1], new Date("2026-10-15")), null, "no clear season");
});

test("scores candidates per goal from the data", () => {
  const nearTop = cand({ gsc: { position: 7, impressions: 900, clicks: 12, ctr: 0.013, page: "https://w.nl/a" } });
  const unseen = cand({});
  assert.ok(scoreCandidate(nearTop, "kansen") > scoreCandidate(unseen, "kansen"));
  const covered = cand({ covered: { url: "https://w.nl/b", title: "Onderhoud" } });
  assert.ok(scoreCandidate(covered, "verkeer") < scoreCandidate(unseen, "verkeer"));
  const seasonal = cand({ peak: { month: "december", monthsUntil: 2 } });
  assert.ok(scoreCandidate(seasonal, "seizoen") > scoreCandidate(unseen, "seizoen"));
});

test("evidence lines only use the data", () => {
  const lines = evidenceLines(cand({ gsc: { position: 12.4, impressions: 340, clicks: 3, ctr: 0.009, page: "https://w.nl/diensten/onderhoud/" }, peak: { month: "maart", monthsUntil: 5 } }));
  assert.deepEqual(lines, [
    "1.300 zoekopdrachten per maand (Semrush)",
    "Moeilijkheid 28/100 (makkelijk)",
    "Zoekintentie: informatief",
    "Nu positie 12,4 in Google, 340 vertoningen en 3 klikken in 90 dagen (Search Console) met /diensten/onderhoud/",
    "Zoekvraag piekt in maart (over 5 maanden)",
    "Nog niet behandeld op de website",
  ]);
});

test("recognises when a keyword is already covered on the website", () => {
  const articles = [{ url: "https://w.nl/blog/onderhoud-warmtepomp", title: "Onderhoud van je warmtepomp: zo doe je dat", headings: [], description: null }];
  assert.equal(covering("warmtepomp onderhoud", articles)?.url, "https://w.nl/blog/onderhoud-warmtepomp");
  assert.equal(covering("sprinkler keuring", articles), null);
});

test("only accepts numbers that are in the data", () => {
  const cs = [cand({ gsc: { position: 12.4, impressions: 340, clicks: 3, ctr: 0.009, page: null } })];
  assert.ok(numbersGrounded("Met 1.300 zoekopdrachten en positie 12,4 ligt de top 10 binnen bereik.", cs));
  assert.ok(numbersGrounded("Er zijn 3 klikken en 340 vertoningen.", cs));
  assert.ok(!numbersGrounded("Dit levert al snel 5.000 extra bezoekers op.", cs));
});

test("parses Claude's ideas, drops unknown candidates and ungrounded reasons, never suggests writing a covered topic again", () => {
  const candidates = [
    cand({ id: "k1", keyword: "warmtepomp onderhoud", score: 70 }),
    cand({ id: "k2", keyword: "sprinkler keuring", semrush: { volume: 480, difficulty: 22, intent: "1", trend: null }, covered: { url: "https://w.nl/blog/sprinkler", title: "Sprinkler" }, score: 55 }),
  ];
  const raw = JSON.stringify({
    ideas: [
      { candidate: "k1", supporting: ["k2", "k9"], title: "Warmtepomp onderhoud: wat moet er jaarlijks gebeuren?", type: "nieuw", angle: "Checklist voor gebouwbeheerders.", why: ["1.300 mensen zoeken hier maandelijks naar.", "Dit verdubbelt je verkeer naar 10.000 bezoekers."] },
      { candidate: "k2", title: "Sprinkler keuring in 5 stappen", type: "nieuw", angle: "Uitleg", why: ["Moeilijkheid 22 maakt het haalbaar."] },
      { candidate: "k7", title: "Verzonnen kandidaat", type: "nieuw", angle: "", why: [] },
      { candidate: "k1", title: "Dubbel zoekwoord", type: "nieuw", angle: "", why: [] },
    ],
  });
  const ideas = parseIdeas(raw, candidates, new Set(["https://w.nl/blog/sprinkler"]), 6);
  assert.equal(ideas.length, 2);
  assert.equal(ideas[0].keyword, "warmtepomp onderhoud");
  assert.deepEqual(ideas[0].why, ["1.300 mensen zoeken hier maandelijks naar."], "the invented number is dropped");
  assert.deepEqual(ideas[0].supportingKeywords, ["sprinkler keuring"]);
  assert.equal(ideas[1].type, "update");
  assert.equal(ideas[1].updateUrl, "https://w.nl/blog/sprinkler");
  assert.throws(() => parseIdeas("geen json", candidates, new Set(), 6), /invalid_claude_json/);
});

test("the prompt contains the goal, the data per candidate and the rules", () => {
  const prompt = makeIdeasPrompt({
    companyName: "Warmtebouw", goal: "kansen", theme: "warmtepompen",
    profile: { description: "Installateur", audience: ["Gebouwbeheerders"], products: ["Warmtepompen"], services: ["Onderhoud"], tone: [] },
    candidates: [cand({ gsc: { position: 8, impressions: 500, clicks: 9, ctr: 0.018, page: null } })],
    articles: [{ title: "Bestaand artikel", url: "https://w.nl/blog/x" }],
    exclude: ["oud idee"], like: null, direction: "specifieker", count: 6,
  });
  assert.match(prompt, /Bijna-toppers naar de top/);
  assert.match(prompt, /\[k1\] "warmtepomp onderhoud" — score 60 — 1\.300 zoekopdrachten per maand/);
  assert.match(prompt, /Nu positie 8 in Google/);
  assert.match(prompt, /ALLEEN getallen die letterlijk in de kandidaten staan/);
  assert.match(prompt, /long-tail/);
  assert.match(prompt, /"oud idee"/);
  assert.match(prompt, /Bestaand artikel \(\/blog\/x\)/);
});

test("finds themes in Search Console queries, without the brand", () => {
  const rows = [
    { query: "warmtebouw", impressions: 5000 },
    { query: "warmtepomp onderhoud", impressions: 800 },
    { query: "warmtepomp kosten", impressions: 600 },
    { query: "sprinkler installatie", impressions: 300 },
  ];
  assert.deepEqual(queryThemes(rows, ["Warmtebouw"], 3), ["warmtepomp", "onderhoud", "kosten"]);
});

test("reads the ideas JSON also with text, fences or trailing remarks around it", async () => {
  const { extractIdeasJson } = await import("./topicIdeasData");
  const json = '{"ideas": [{"candidate": "k1", "title": "Titel met {haakjes}"}]}';
  assert.deepEqual(extractIdeasJson(`Hier zijn de ideeën:\n${json}\nSucces!`), JSON.parse(json));
  assert.deepEqual(extractIdeasJson("```json\n" + json + "\n```\nToelichting {x}"), JSON.parse(json));
  assert.throws(() => extractIdeasJson('{"ideas": [{"candidate": "k1"'), /invalid_claude_json/);
});
