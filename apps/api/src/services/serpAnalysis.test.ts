import assert from "node:assert/strict";
import test from "node:test";
import { analysePage, analyseSerp, serpContext } from "./serpAnalysis";
import { makeOutlinePrompt } from "./articleOutline";
import type { SafeResponse } from "./safeHttp";

const words = (n: number) => Array.from({ length: n }, (_, i) => `woord${i}`).join(" ");
const page = (h2: string[], n: number) => `<html><head><title>T</title></head><body>
  <nav><h2>Menu</h2><a href="/">Home</a></nav>
  <article><h1>Warmtepomp kopen</h1>${h2.map((h) => `<h2>${h}</h2><p>${words(Math.round(n / h2.length))}</p>`).join("")}<h3>Detail</h3></article>
  <footer><h2>Contact</h2>${words(300)}</footer><div class="cookie-banner">${words(50)}</div></body></html>`;

test("reads headings and counts only the main content", () => {
  const result = analysePage(page(["Kosten", "Soorten", "Subsidie"], 900));
  assert.equal(result.title, "Warmtepomp kopen");
  assert.deepEqual(result.headings.map((h) => `${h.level} ${h.text}`), ["H2 Kosten", "H2 Soorten", "H2 Subsidie", "H3 Detail"]);
  assert.ok(result.words >= 900 && result.words < 950, `words ${result.words}`, );
});

function fakeWeb(pages: Record<string, { status?: number; body?: string; robots?: string }>) {
  return async (url: string): Promise<SafeResponse> => {
    const u = new URL(url);
    const site = pages[u.hostname];
    if (u.pathname === "/robots.txt") return site?.robots ? { url, status: 200, headers: { "content-type": "text/plain" }, body: site.robots } : { url, status: 404, headers: {}, body: "" };
    if (!site || site.status === 500) return { url, status: 500, headers: {}, body: "" };
    return { url, status: 200, headers: { "content-type": "text/html" }, body: site.body ?? "" };
  };
}

test("analyses the top 5, respects robots.txt and reports failures without stopping", async () => {
  const fetcher = fakeWeb({
    "a.nl": { body: page(["Kosten", "Soorten"], 1000) },
    "b.nl": { body: page(["Kosten", "Installatie", "Onderhoud"], 1400) },
    "c.nl": { robots: "User-agent: *\nDisallow: /" },
    "d.nl": { status: 500 },
    "e.nl": { body: page(["Kosten"], 600) },
  });
  const competitors = ["a", "b", "c", "d", "e", "f"].map((d, i) => ({ position: i + 1, domain: `${d}.nl`, url: `https://${d}.nl/warmtepomp` }));
  const result = await analyseSerp(competitors, { fetcher });
  assert.equal(result.pages.length, 5, "only the top 5");
  assert.deepEqual(result.pages.map((p) => p.status), ["ok", "ok", "geblokkeerd", "mislukt", "ok"]);
  assert.equal(result.analysed, 3);
  assert.ok(result.medianWords! >= 1000 && result.medianWords! < 1050, `median ${result.medianWords}`);
  const context = serpContext(result)!;
  assert.match(context, /#2 b\.nl \(\d+ woorden\): Kosten \| Installatie \| Onderhoud/);
  assert.match(context, /kopieer nooit/);
  assert.equal(serpContext(await analyseSerp([], { fetcher })), null);
});

test("the outline prompt uses the competitors' median length", async () => {
  const fetcher = fakeWeb({ "a.nl": { body: page(["Kosten"], 2000) } });
  const serp = await analyseSerp([{ position: 1, domain: "a.nl", url: "https://a.nl/x" }], { fetcher });
  const prompt = makeOutlinePrompt({ partnerName: "P", approvedPartnerProfile: {}, subject: "Warmtepomp", contentGoal: "Uitleg", semrushResearch: {}, serp });
  assert.match(prompt, /Analyse van de top 1 in Google/);
  assert.match(prompt, /samen ongeveer 20\d\d woorden/);
});
