import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchConsoleReport, findLowCtr } from "./searchConsoleReport";

const row = (key: string, clicks: number, impressions: number, position: number) => ({ keys: [key], clicks, impressions, ctr: impressions ? clicks / impressions : 0, position });

test("low click rate is measured against the site's own average per position", () => {
  const low = findLowCtr([
    { key: "a", clicks: 50, impressions: 500, ctr: 0.1, position: 2 },
    { key: "b", clicks: 2, impressions: 400, ctr: 0.005, position: 2.4 },
    { key: "c", clicks: 1, impressions: 50, ctr: 0.02, position: 2 }, // too few impressions
    { key: "d", clicks: 0, impressions: 900, ctr: 0, position: 15 },  // not in the top 10
  ]);
  assert.deepEqual(low.map((r) => r.key), ["b"]);
  assert.equal(low[0].groupCtr, Math.round((53 / 950) * 10000) / 10000);
});

test("report compares periods and explains what stands out", () => {
  const report = buildSearchConsoleReport({
    domain: "warmtebouw.nl",
    days: 28,
    totals: { clicks: 600, impressions: 30000, ctr: 0.02, position: 14.2 },
    previousTotals: { clicks: 800, impressions: 25000, ctr: 0.032, position: 15 },
    daily: [row("2026-11-02", 20, 900, 14), row("2026-11-01", 25, 1000, 14)],
    devices: [{ keys: ["MOBILE"], clicks: 420, impressions: 20000, ctr: 0.021, position: 13 }, { keys: ["DESKTOP"], clicks: 180, impressions: 10000, ctr: 0.018, position: 15 }],
    queries: [row("warmtebouw", 380, 900, 1), row("sprinklerinstallatie", 30, 4000, 9.4), row("sprinkler onderhoud", 50, 600, 2), row("brandbeveiliging bedrijf", 5, 800, 6)],
    pages: [row("https://www.warmtebouw.nl/", 400, 5000, 5), row("https://www.warmtebouw.nl/sprinkler/", 40, 6000, 10)],
    previousPages: [row("https://www.warmtebouw.nl/", 420, 5000, 5), row("https://www.warmtebouw.nl/sprinkler/", 90, 6000, 9)],
  });
  assert.deepEqual(report.daily.map((d) => d.date), ["2026-11-01", "2026-11-02"]);
  assert.equal(report.devices[0].device, "mobiel");
  assert.equal(report.brand?.clicks, 380);
  const text = report.insights.map((i) => i.text).join("\n");
  assert.match(text, /600 klikken uit Google, 25% minder dan de periode daarvoor \(800\)/);
  assert.match(text, /vaker getoond \(30\.000 keer, was 25\.000\)/);
  assert.match(text, /82% van de klikken komt van zoekopdrachten op de bedrijfsnaam/);
  assert.match(text, /70% van de klikken komt van mobiele telefoons/);
  assert.match(text, /warmtebouw\.nl\/sprinkler\/ verloor de meeste klikken: 40, was 90/);
});

test("an empty website gives no observations", () => {
  const report = buildSearchConsoleReport({ domain: "leeg.nl", days: 28, totals: undefined, previousTotals: undefined, daily: [], devices: [], queries: [], pages: [], previousPages: [] });
  assert.deepEqual(report.insights, []);
  assert.equal(report.brand, null);
});
