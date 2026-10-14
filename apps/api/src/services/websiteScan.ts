import { and, desc, eq, lt, notInArray } from "drizzle-orm";
import { db, partnersTable, websiteArticlesTable, websiteScansTable, type WebsiteScan } from "@yellowlime/db";
import { logger } from "../lib/logger";
import { InventoryError, scanWebsiteArticles, type ScanOptions } from "./articleInventory";
import { WebsitePolicyError } from "./websiteUrlPolicy";

/** A scan that has been "running" longer than this was interrupted (e.g. by a restart). */
const STALE_SCAN_MS = 20 * 60 * 1000;

export async function latestScan(partnerId: number): Promise<WebsiteScan | null> {
  const [scan] = await db
    .select()
    .from(websiteScansTable)
    .where(eq(websiteScansTable.partnerId, partnerId))
    .orderBy(desc(websiteScansTable.startedAt))
    .limit(1);
  if (scan && scan.status === "running" && Date.now() - scan.startedAt.getTime() > STALE_SCAN_MS) {
    const [failed] = await db
      .update(websiteScansTable)
      .set({ status: "failed", message: "De scan is onderbroken. Start een nieuwe scan.", finishedAt: new Date() })
      .where(eq(websiteScansTable.id, scan.id))
      .returning();
    return failed;
  }
  return scan ?? null;
}

export async function listWebsiteArticles(partnerId: number) {
  return db
    .select()
    .from(websiteArticlesTable)
    .where(eq(websiteArticlesTable.partnerId, partnerId))
    .orderBy(desc(websiteArticlesTable.publishedAt), desc(websiteArticlesTable.firstSeenAt));
}

function safeMessage(error: unknown): string {
  if (error instanceof InventoryError || error instanceof WebsitePolicyError) return error.message;
  return "De website kon niet worden gescand.";
}

/**
 * Start a scan for a partner's website in the background. Returns the running
 * scan; when one is already running, that scan is returned instead.
 */
export async function startWebsiteScan(partnerId: number, options: ScanOptions = {}): Promise<WebsiteScan | null> {
  const [partner] = await db.select().from(partnersTable).where(eq(partnersTable.id, partnerId));
  if (!partner) return null;

  const current = await latestScan(partnerId);
  if (current?.status === "running") return current;

  const [scan] = await db.insert(websiteScansTable).values({ partnerId, status: "running" }).returning();
  void runScan(scan.id, partnerId, partner.websiteUrl, options);
  return scan;
}

export async function runScan(scanId: number, partnerId: number, websiteUrl: string, options: ScanOptions = {}): Promise<void> {
  const startedAt = Date.now();
  try {
    const result = await scanWebsiteArticles(websiteUrl, options);
    const now = new Date();

    if (result.articles.length === 0) {
      // Keep the previous list: an empty result usually means the site was unreachable.
      await db
        .update(websiteScansTable)
        .set({
          status: "failed",
          source: result.source,
          pagesChecked: result.pagesChecked,
          articlesFound: 0,
          message: "Er zijn geen artikelen gevonden op de website.",
          finishedAt: now,
        })
        .where(eq(websiteScansTable.id, scanId));
      return;
    }

    await db.transaction(async (tx) => {
      for (const article of result.articles) {
        await tx
          .insert(websiteArticlesTable)
          .values({ partnerId, ...article, firstSeenAt: now, lastSeenAt: now })
          .onConflictDoUpdate({
            target: [websiteArticlesTable.partnerId, websiteArticlesTable.url],
            set: {
              title: article.title,
              description: article.description,
              headings: article.headings,
              publishedAt: article.publishedAt,
              wordCount: article.wordCount,
              lastSeenAt: now,
            },
          });
      }
      // Articles that are no longer on the website are removed from the list.
      await tx
        .delete(websiteArticlesTable)
        .where(
          and(
            eq(websiteArticlesTable.partnerId, partnerId),
            notInArray(websiteArticlesTable.url, result.articles.map((a) => a.url)),
            lt(websiteArticlesTable.lastSeenAt, now),
          ),
        );
      await tx
        .update(websiteScansTable)
        .set({
          status: "completed",
          source: result.source,
          pagesChecked: result.pagesChecked,
          articlesFound: result.articles.length,
          message: null,
          finishedAt: now,
        })
        .where(eq(websiteScansTable.id, scanId));
    });
    logger.info(
      { partnerId, articles: result.articles.length, pagesChecked: result.pagesChecked, source: result.source, durationMs: Date.now() - startedAt },
      "Website scan completed",
    );
  } catch (error) {
    logger.warn(
      { partnerId, errorType: error instanceof Error ? error.constructor.name : typeof error, durationMs: Date.now() - startedAt },
      "Website scan failed",
    );
    await db
      .update(websiteScansTable)
      .set({ status: "failed", message: safeMessage(error), finishedAt: new Date() })
      .where(eq(websiteScansTable.id, scanId))
      .catch(() => undefined);
  }
}
