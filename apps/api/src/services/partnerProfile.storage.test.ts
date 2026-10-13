import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";

const profile = (companyName: string) => ({
  companyName,
  companyDescription: "Beschrijving uit de website",
  products: ["Product"],
  services: ["Dienst"],
  targetAudience: ["Doelgroep"],
  toneOfVoice: ["Warm"],
  writingStyle: ["Helder"],
  importantFacts: ["Feit"],
  locations: ["Nederland"],
  sourceUrls: ["https://example.com/"],
  missingInformation: [],
});

test("persists separate Claude, review, and approved snapshots transactionally", {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const {
    db,
    partnersTable,
    partnerProfilesTable,
    pool,
    yellowlimersTable,
  } = await import("@yellowlime/db");
  const rollback = Symbol("rollback");
  const companyName = `Partner profile storage ${Date.now()}`;
  const reviewerName = `Partner profile reviewer ${Date.now()}`;
  let createdPartnerId: number | undefined;

  try {
    await assert.rejects(
      db.transaction(async (tx) => {
        const [partner] = await tx.insert(partnersTable).values({
          companyName,
          websiteUrl: "https://example.com/",
        }).returning();
        createdPartnerId = partner.id;
        const [reviewer] = await tx.insert(yellowlimersTable).values({
          name: reviewerName,
          avatarType: "icon",
          avatarValue: "UserCircle",
          active: true,
        }).returning();
        const claudeProfile = profile("Claude naam");
        const [saved] = await tx.insert(partnerProfilesTable).values({
          partnerId: partner.id,
          websitePages: [{ url: "https://example.com/", title: "Home", text: "Website tekst" }],
          websiteText: "Website tekst",
          claudeProfile,
          reviewProfile: claudeProfile,
          approvedProfile: null,
          profileStatus: "Wacht op controle",
          claudeModelName: "claude-sonnet-5",
          promptVersion: "partner-profile-v1",
        }).returning();

        const reviewProfile = profile("Bewerkte naam");
        const [reviewed] = await tx.update(partnerProfilesTable).set({
          reviewProfile,
        }).where(eq(partnerProfilesTable.id, saved.id)).returning();
        assert.deepEqual(reviewed.claudeProfile, claudeProfile);
        assert.deepEqual(reviewed.reviewProfile, reviewProfile);

        const [approved] = await tx.update(partnerProfilesTable).set({
          reviewProfile,
          approvedProfile: reviewProfile,
          profileStatus: "Goedgekeurd",
          approvedByYellowlimerId: reviewer.id,
          approvedAt: new Date(),
        }).where(eq(partnerProfilesTable.id, saved.id)).returning();
        assert.deepEqual(approved.claudeProfile, claudeProfile);
        assert.deepEqual(approved.reviewProfile, reviewProfile);
        assert.deepEqual(approved.approvedProfile, reviewProfile);
        assert.notDeepEqual(approved.approvedProfile, approved.claudeProfile);
        throw rollback;
      }),
      (error: unknown) => error === rollback,
    );

    const [partnerAfterRollback] = await db.select({ id: partnersTable.id })
      .from(partnersTable).where(eq(partnersTable.companyName, companyName));
    assert.equal(partnerAfterRollback, undefined);
    const [reviewerAfterRollback] = await db.select({ id: yellowlimersTable.id })
      .from(yellowlimersTable).where(eq(yellowlimersTable.name, reviewerName));
    assert.equal(reviewerAfterRollback, undefined);
    if (createdPartnerId !== undefined) {
      const [profileAfterRollback] = await db.select({ id: partnerProfilesTable.id })
        .from(partnerProfilesTable).where(eq(partnerProfilesTable.partnerId, createdPartnerId));
      assert.equal(profileAfterRollback, undefined);
    }
  } finally {
    await pool.end();
  }
});