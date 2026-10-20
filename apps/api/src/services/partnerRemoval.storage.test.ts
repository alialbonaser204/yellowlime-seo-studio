import assert from "node:assert/strict";
import test from "node:test";

test("deleting a partner removes everything that belongs to it, and nothing else", { skip: !process.env.DATABASE_URL }, async () => {
  const db_ = await import("@yellowlime/db");
  const { db, pool, partnersTable, yellowlimersTable, briefingsTable, partnerProfilesTable, articlesTable, articleReviewsTable, websiteArticlesTable, websiteScansTable } = db_;
  const { eq } = await import("drizzle-orm");
  const { removePartner } = await import("./partnerRemoval");

  const [partner] = await db.insert(partnersTable).values({ companyName: "Weg ermee", websiteUrl: "https://weg.invalid" }).returning();
  const [other] = await db.insert(partnersTable).values({ companyName: "Blijft staan", websiteUrl: "https://blijft.invalid" }).returning();
  const [reviewer] = await db.insert(yellowlimersTable).values({ name: "Reviewer removal test", avatarType: "icon", avatarValue: "x", active: true }).returning();
  try {
    for (const p of [partner, other]) {
      const [briefing] = await db.insert(briefingsTable).values({ partnerId: p.id, reviewerId: reviewer.id, subject: "Onderwerp", contentGoal: "Doel" }).returning();
      await db.insert(partnerProfilesTable).values({ partnerId: p.id, profileStatus: "Wacht op controle" });
      const [article] = await db.insert(articlesTable).values({
        partnerId: p.id, briefingId: briefing.id, yellowlimerId: reviewer.id, title: "T", content: "C",
        metaTitle: "M", metaDescription: "D", modelName: "m", promptVersion: "v",
      }).returning();
      await db.insert(articleReviewsTable).values({
        partnerId: p.id, briefingId: briefing.id, articleId: article.id, yellowlimerId: reviewer.id,
        originalTitle: "T", originalContent: "C", originalMetaTitle: "M", originalMetaDescription: "D",
        correctedTitle: "T", correctedContent: "C", correctedMetaTitle: "M", correctedMetaDescription: "D",
        reviewStatus: "approved", aiVersionCreatedAt: new Date(), humanVersionCreatedAt: new Date(), claudeModelName: "m", promptVersion: "v",
      });
      await db.insert(websiteArticlesTable).values({ partnerId: p.id, url: `https://x.invalid/${p.id}`, title: "A" });
      await db.insert(websiteScansTable).values({ partnerId: p.id, status: "completed" });
    }

    const result = await removePartner(partner.id);
    assert.deepEqual(result, { id: partner.id, deleted: true, removed: { briefings: 1, articles: 1, websiteArticles: 1 } });
    for (const [table, column] of [
      [briefingsTable, briefingsTable.partnerId], [partnerProfilesTable, partnerProfilesTable.partnerId],
      [articlesTable, articlesTable.partnerId], [articleReviewsTable, articleReviewsTable.partnerId],
      [websiteArticlesTable, websiteArticlesTable.partnerId], [websiteScansTable, websiteScansTable.partnerId],
    ] as const) {
      assert.equal((await db.select().from(table as never).where(eq(column, partner.id))).length, 0);
      assert.equal((await db.select().from(table as never).where(eq(column, other.id))).length, 1, "other partner untouched");
    }
    assert.equal((await db.select().from(partnersTable).where(eq(partnersTable.id, partner.id))).length, 0);
    assert.equal((await db.select().from(yellowlimersTable).where(eq(yellowlimersTable.id, reviewer.id))).length, 1);
    assert.equal(await removePartner(partner.id), null);
  } finally {
    await removePartner(other.id);
    await removePartner(partner.id);
    await db.delete(yellowlimersTable).where(eq(yellowlimersTable.id, reviewer.id));
    await pool.end();
  }
});
