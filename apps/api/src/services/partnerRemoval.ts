import { eq, inArray, or, type AnyColumn } from "drizzle-orm";
import {
  articleGenerationsTable,
  articleReviewsTable,
  articlesTable,
  briefingsTable,
  db,
  partnerProfilesTable,
  partnersTable,
  semrushResearchTable,
  websiteArticlesTable,
  websiteScansTable,
} from "@yellowlime/db";

export interface PartnerRemoval {
  id: number;
  deleted: boolean;
  removed: { briefings: number; articles: number; websiteArticles: number };
}

/**
 * Deletes a partner and everything that belongs to it, in one transaction:
 * reviews, articles, article generations, Semrush research, briefings, the
 * partner profile, scanned website articles and the partner itself. Rows are
 * matched both on the partner and on the partner's briefings, so nothing that
 * still points at the partner is left behind.
 */
export async function removePartner(partnerId: number): Promise<PartnerRemoval | null> {
  return db.transaction(async (tx) => {
    const [partner] = await tx.select({ id: partnersTable.id }).from(partnersTable).where(eq(partnersTable.id, partnerId)).for("update");
    if (!partner) return null;

    const briefingIds = (await tx.select({ id: briefingsTable.id }).from(briefingsTable).where(eq(briefingsTable.partnerId, partnerId))).map((b) => b.id);
    const ofPartner = (partnerColumn: AnyColumn, briefingColumn: AnyColumn) =>
      briefingIds.length ? or(eq(partnerColumn, partnerId), inArray(briefingColumn, briefingIds)) : eq(partnerColumn, partnerId);

    const articleIds = (await tx.select({ id: articlesTable.id }).from(articlesTable)
      .where(ofPartner(articlesTable.partnerId, articlesTable.briefingId))).map((a) => a.id);

    const reviewsOfPartner = ofPartner(articleReviewsTable.partnerId, articleReviewsTable.briefingId);
    await tx.delete(articleReviewsTable).where(
      articleIds.length ? or(reviewsOfPartner, inArray(articleReviewsTable.articleId, articleIds)) : reviewsOfPartner,
    );
    await tx.delete(articlesTable).where(ofPartner(articlesTable.partnerId, articlesTable.briefingId));
    await tx.delete(articleGenerationsTable).where(ofPartner(articleGenerationsTable.partnerId, articleGenerationsTable.briefingId));
    await tx.delete(semrushResearchTable).where(ofPartner(semrushResearchTable.partnerId, semrushResearchTable.briefingId));
    await tx.delete(briefingsTable).where(eq(briefingsTable.partnerId, partnerId));
    await tx.delete(partnerProfilesTable).where(eq(partnerProfilesTable.partnerId, partnerId));
    const websiteArticles = await tx.delete(websiteArticlesTable).where(eq(websiteArticlesTable.partnerId, partnerId)).returning({ id: websiteArticlesTable.id });
    await tx.delete(websiteScansTable).where(eq(websiteScansTable.partnerId, partnerId));
    await tx.delete(partnersTable).where(eq(partnersTable.id, partnerId));

    return {
      id: partnerId,
      deleted: true,
      removed: { briefings: briefingIds.length, articles: articleIds.length, websiteArticles: websiteArticles.length },
    };
  });
}
