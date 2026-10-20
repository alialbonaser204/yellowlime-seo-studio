import assert from "node:assert/strict";
import test from "node:test";

test("topic wizard combines Search Console and Semrush, and reuses the data when refining", { skip: !process.env.DATABASE_URL }, async () => {
  const { db, pool, partnersTable, partnerProfilesTable } = await import("@yellowlime/db");
  const { removePartner } = await import("./partnerRemoval");
  const { topicIdeas, topicThemes, clearTopicIdeasCache } = await import("./topicIdeas");
  clearTopicIdeasCache();

  const [partner] = await db.insert(partnersTable).values({ companyName: "Warmtebouw", websiteUrl: "https://www.warmtebouw.invalid/" }).returning();
  await db.insert(partnerProfilesTable).values({
    partnerId: partner.id,
    profileStatus: "Goedgekeurd",
    approvedProfile: { companyDescription: "Installateur", products: ["Warmtepompen"], services: ["Onderhoud"], targetAudience: ["Gebouwbeheerders"], toneOfVoice: [] },
  });
  const semrushCalls: string[] = [];
  const semrushTransport = async (path: string) => {
    const type = new URL(path, "https://x.invalid").searchParams.get("type")!;
    semrushCalls.push(type);
    if (type === "phrase_these") return new Response("Keyword;Search Volume;Keyword Difficulty Index;Intent;Trends\nwarmtepomp onderhoud;1300;28;1;0.3,0.5,1,0.6,0.4,0.3,0.3,0.3,0.3,0.3,0.3,0.3\n");
    return new Response("ERROR 50 :: NOTHING FOUND");
  };
  const gsc = async () => ({
    property: "sc-domain:warmtebouw.invalid",
    rows: [
      { query: "warmtepomp onderhoud", page: "https://www.warmtebouw.invalid/diensten/onderhoud/", clicks: 9, impressions: 640, ctr: 0.014, position: 8.6 },
      { query: "warmtebouw", page: "https://www.warmtebouw.invalid/", clicks: 300, impressions: 900, ctr: 0.33, position: 1.1 },
    ],
    pagesNow: [],
    pagesBefore: [],
  });
  const prompts: string[] = [];
  const runner = async (input: string) => {
    prompts.push(input);
    return JSON.stringify({ ideas: [{ candidate: "k1", title: "Warmtepomp onderhoud: wat gebeurt er jaarlijks?", type: "nieuw", angle: "Checklist", why: ["Je staat al op positie 8,6 met 640 vertoningen."] }] });
  };
  try {
    const themes = await topicThemes(partner.id, { gsc, semrushTransport });
    assert.deepEqual(themes?.themes.map((t) => t.label), ["Warmtepompen", "Onderhoud", "warmtepomp"].slice(0, themes!.themes.length));
    assert.equal(themes?.available.searchConsole, true);

    const result = await topicIdeas(partner.id, { goal: "kansen" }, { gsc, semrushTransport, runner, now: new Date("2026-10-15") });
    assert.ok(result);
    assert.equal(result.usedSearchConsole, true);
    assert.equal(result.usedSemrush, true);
    assert.equal(result.ideas.length, 1);
    const idea = result.ideas[0];
    assert.equal(idea.keyword, "warmtepomp onderhoud");
    assert.deepEqual(idea.why, ["Je staat al op positie 8,6 met 640 vertoningen."]);
    assert.ok(idea.evidence.includes("1.300 zoekopdrachten per maand (Semrush)"));
    assert.ok(idea.evidence.some((e) => e.startsWith("Nu positie 8,6 in Google, 640 vertoningen")));
    assert.ok(idea.evidence.includes("Zoekvraag piekt in december (over 2 maanden)"));
    assert.match(prompts[0], /Bijna-toppers/);
    assert.doesNotMatch(prompts[0], /"warmtebouw"/, "the brand query at position 1 is not an opportunity");

    // Refining reuses the collected data: no new Semrush calls.
    const before = semrushCalls.length;
    await topicIdeas(partner.id, { goal: "kansen", exclude: ["iets anders"], direction: "specifieker" }, { gsc, semrushTransport, runner });
    assert.equal(semrushCalls.length, before);
    assert.match(prompts[1], /long-tail/);
  } finally {
    await removePartner(partner.id);
    await pool.end();
  }
});
