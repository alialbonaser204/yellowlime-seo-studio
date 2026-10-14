import assert from "node:assert/strict";
import test from "node:test";
import { findDecliningPages, findOpportunities, matchProperty, pagesForTopic, reportPeriod, toMetricRows, topicQueryRegex } from "./searchConsoleData";

const site = (siteUrl: string, permissionLevel = "siteFullUser") => ({ siteUrl, permissionLevel });

test("prefers a domain property, also for subdomains", () => {
  const sites = [site("https://www.atlas.nl/"), site("sc-domain:atlas.nl"), site("sc-domain:other.nl")];
  assert.equal(matchProperty("https://www.atlas.nl/", sites), "sc-domain:atlas.nl");
  assert.equal(matchProperty("https://shop.atlas.nl/fietsen", sites), "sc-domain:atlas.nl");
  assert.equal(matchProperty("https://notatlas.nl/", sites), null);
});

test("falls back to a URL-prefix property, with or without www", () => {
  const sites = [site("http://atlas.nl/"), site("https://www.atlas.nl/"), site("https://www.atlas.nl/blog/")];
  assert.equal(matchProperty("https://www.atlas.nl/", sites), "https://www.atlas.nl/");
  assert.equal(matchProperty("https://www.atlas.nl/blog/", sites), "https://www.atlas.nl/blog/");
  assert.equal(matchProperty("https://atlas.nl", [site("https://www.atlas.nl/")]), "https://www.atlas.nl/");
  assert.equal(matchProperty("https://atlas.nl", [site("https://www.atlas.nl/", "siteUnverifiedUser")]), null);
});

test("report periods end three days ago and are followed by the previous period", () => {
  const period = reportPeriod(28, new Date("2026-10-14T10:00:00Z"));
  assert.deepEqual(period, {
    startDate: "2026-09-14",
    endDate: "2026-10-11",
    previousStartDate: "2026-08-17",
    previousEndDate: "2026-09-13",
  });
});

test("finds queries just below the top results and pages that lost clicks", () => {
  const queries = toMetricRows([
    { keys: ["e-bike kopen"], clicks: 10, impressions: 800, ctr: 0.0125, position: 7.3 },
    { keys: ["atlas fietsen"], clicks: 300, impressions: 900, ctr: 0.33, position: 1.2 },
    { keys: ["fiets lease"], clicks: 0, impressions: 5, ctr: 0, position: 12 },
    { keys: ["e-bike accu"], clicks: 2, impressions: 300, ctr: 0.0066, position: 14 },
  ]);
  assert.deepEqual(findOpportunities(queries).map((row) => row.key), ["e-bike kopen", "e-bike accu"]);

  const now = toMetricRows([{ keys: ["/a"], clicks: 10 }, { keys: ["/b"], clicks: 48 }]);
  const before = toMetricRows([{ keys: ["/a"], clicks: 40 }, { keys: ["/b"], clicks: 50 }, { keys: ["/c"], clicks: 12 }]);
  assert.deepEqual(findDecliningPages(now, before), [
    { page: "/a", clicks: 10, previousClicks: 40, change: -30 },
    { page: "/c", clicks: 0, previousClicks: 12, change: -12 },
  ]);
});

test("builds a query filter from the topic's meaningful words", () => {
  assert.equal(topicQueryRegex("Hoe onderhoud je een e-bike?"), "(?i)(onderhoud|bike)");
  assert.equal(topicQueryRegex("de en het"), null);
});

test("groups query rows into the pages Google shows for a topic", () => {
  const rows = [
    { keys: ["e-bike onderhoud", "https://a.nl/onderhoud"], clicks: 20, impressions: 400, position: 5 },
    { keys: ["onderhoud e-bike kosten", "https://a.nl/onderhoud"], clicks: 5, impressions: 100, position: 10 },
    { keys: ["e-bike kopen", "https://a.nl/kopen"], clicks: 50, impressions: 900, position: 3 },
    { keys: ["onderhoud bike", "https://a.nl/klein"], clicks: 0, impressions: 4, position: 30 },
  ];
  const pages = pagesForTopic("Onderhoud van je e-bike", rows);
  assert.deepEqual(pages, [
    { page: "https://a.nl/onderhoud", clicks: 25, impressions: 500, position: 6, queries: ["e-bike onderhoud", "onderhoud e-bike kosten"] },
  ]);
});
