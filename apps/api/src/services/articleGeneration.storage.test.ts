import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";

test("stores separate immutable article versions and snapshots transactionally", { skip: !process.env.DATABASE_URL }, async () => {
  const {
    articleGenerationsTable,
    briefingsTable,
    db,
    partnerProfilesTable,
    partnersTable,
    semrushResearchTable,
    yellowlimersTable,
    pool,
  } = await import("@yellowlime/db");
  const rollback = Symbol("rollback");
  try {
    await assert.rejects(
      db.transaction(async (tx) => {
        const [partner] = await tx.insert(partnersTable).values({
          companyName: "Article generation storage test",
          websiteUrl: "https://article-generation.invalid",
        }).returning();
        const [reviewer] = await tx.insert(yellowlimersTable).values({
          name: "Article storage reviewer",
          avatarType: "icon",
          avatarValue: "test",
          active: true,
        }).returning();
        const [briefing] = await tx.insert(briefingsTable).values({
          partnerId: partner.id,
          reviewerId: reviewer.id,
          subject: "Duurzame tuin",
          contentGoal: "Praktisch advies",
        }).returning();
        await tx.insert(partnerProfilesTable).values({
          partnerId: partner.id,
          websitePages: [],
          websiteText: "",
          approvedProfile: { toneOfVoice: ["praktisch"] },
          profileStatus: "Goedgekeurd",
          approvedByYellowlimerId: reviewer.id,
          approvedAt: new Date(),
        });
        await tx.insert(semrushResearchTable).values({
          briefingId: briefing.id,
          partnerId: partner.id,
          originalSubject: briefing.subject,
          selectedMainKeyword: "duurzame tuin ideeën",
          searchVolume: 2400,
          keywordDifficulty: 31.5,
          searchIntent: "I",
          trend: "up",
          secondaryKeywords: [{
            keyword: "groene tuin",
            searchVolume: 900,
            keywordDifficulty: 22,
            searchIntent: "I",
            trend: "flat",
          }],
          relevantQuestions: [{
            question: "Hoe maak ik een duurzame tuin?",
            searchVolume: 120,
            keywordDifficulty: 12,
            searchIntent: "I",
          }],
          organicCompetitors: [{ position: 1, domain: "example.nl", url: "https://example.nl/tuin" }],
          researchedAt: new Date(),
          semrushDatabase: "nl",
          apiStatus: "success",
          message: null,
        });
        const base = {
          briefingId: briefing.id,
          partnerId: partner.id,
          yellowlimerId: reviewer.id,
          title: "Titel",
          introduction: "Intro",
          sections: [{ heading: "Hoofd", headingLevel: "H2" as const, content: "Tekst" }],
          conclusion: "Conclusie",
          fullArticle: "Volledig artikel",
          metaTitle: "Meta titel",
          metaDescription: "Meta beschrijving",
          primaryKeyword: "duurzame tuin ideeën",
          secondaryKeywordsUsed: ["groene tuin"],
          questionsAnswered: ["Hoe maak ik een duurzame tuin?"],
          approvedPartnerProfileSnapshot: { tone: "praktisch" },
          semrushResearchSnapshot: { selectedMainKeyword: "duurzame tuin ideeën" },
          articleStatus: "Wacht op controle" as const,
          claudeModelName: "claude-sonnet-5",
          promptVersion: "article_generation_v1",
          failureMessage: null,
        };
        const [first] = await tx.insert(articleGenerationsTable).values({
          ...base,
          versionNumber: 1,
        }).returning();
        const [second] = await tx.insert(articleGenerationsTable).values({
          ...base,
          versionNumber: 2,
          title: "Titel twee",
        }).returning();
        assert.notEqual(first.id, second.id);
        assert.equal(first.versionNumber, 1);
        assert.equal(second.versionNumber, 2);
        assert.deepEqual(first.approvedPartnerProfileSnapshot, { tone: "praktisch" });
        assert.deepEqual(second.semrushResearchSnapshot, { selectedMainKeyword: "duurzame tuin ideeën" });
        const saved = await tx.select().from(articleGenerationsTable).where(
          eq(articleGenerationsTable.briefingId, briefing.id),
        );
        assert.equal(saved.length, 2);
        throw rollback;
      }),
      (error: unknown) => error === rollback,
    );
  } finally {
    await pool.end();
  }
});