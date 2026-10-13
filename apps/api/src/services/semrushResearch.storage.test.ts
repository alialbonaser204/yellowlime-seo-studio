import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";

test("round-trips structured Semrush research data transactionally", { skip: !process.env.DATABASE_URL }, async () => {
  const {
    briefingsTable,
    db,
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
          companyName: "Semrush storage test",
          websiteUrl: "https://storage-test.invalid",
        }).returning();
        const [yellowlimer] = await tx.insert(yellowlimersTable).values({
          name: "Storage test reviewer",
          avatarType: "icon",
          avatarValue: "test",
          active: true,
        }).returning();
        const [briefing] = await tx.insert(briefingsTable).values({
          partnerId: partner.id,
          reviewerId: yellowlimer.id,
          subject: "Duurzame tuin",
          contentGoal: "Praktisch advies",
        }).returning();
        const [research] = await tx.insert(semrushResearchTable).values({
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
          organicCompetitors: [{
            position: 1,
            domain: "example.nl",
            url: "https://example.nl/tuin",
          }],
          semrushDatabase: "nl",
          apiStatus: "success",
          message: null,
        }).returning();
        const [saved] = await tx.select().from(semrushResearchTable).where(
          eq(semrushResearchTable.id, research.id),
        );
        assert.deepEqual(saved.secondaryKeywords, research.secondaryKeywords);
        assert.deepEqual(saved.relevantQuestions, research.relevantQuestions);
        assert.deepEqual(saved.organicCompetitors, research.organicCompetitors);
        assert.equal(saved.selectedMainKeyword, "duurzame tuin ideeën");
        assert.equal(saved.keywordDifficulty, 31.5);
        throw rollback;
      }),
      (error: unknown) => error === rollback,
    );
  } finally {
    await pool.end();
  }
});