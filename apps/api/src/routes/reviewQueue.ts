/**
 * Human check of AI-written articles: a list of every article the AI wrote,
 * who started it, who checks it, and whether it is still waiting.
 */
import { alias } from "drizzle-orm/pg-core";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { articleCorrectionsTable, articleGenerationsTable, briefingsTable, db, partnersTable, usersTable, yellowlimersTable } from "@yellowlime/db";
import { compareArticles } from "../services/articleDiff";
import { currentUser } from "../lib/requestUser";

const router: IRouter = Router();

/** Only the newest version per briefing counts; older ones are replaced. */
const latestPerBriefing = sql`${articleGenerationsTable.versionNumber} = (select max(g2.version_number) from article_generations g2 where g2.briefing_id = ${articleGenerationsTable.briefingId} and g2.article_status = 'Wacht op controle')`;
const waitingWhere = and(eq(articleGenerationsTable.articleStatus, "Wacht op controle"), isNull(articleGenerationsTable.reviewDecision), latestPerBriefing);

router.get("/review-queue/count", async (_req, res): Promise<void> => {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(articleGenerationsTable).where(waitingWhere);
  res.json({ waiting: row?.n ?? 0 });
});

router.get("/review-queue", async (_req, res): Promise<void> => {
  const creator = alias(usersTable, "creator");
  const checker = alias(usersTable, "checker");
  const rows = await db
    .select({
      id: articleGenerationsTable.id,
      title: articleGenerationsTable.title,
      subject: briefingsTable.subject,
      versionNumber: articleGenerationsTable.versionNumber,
      partnerName: partnersTable.companyName,
      createdByName: creator.name,
      reviewerName: yellowlimersTable.name,
      generatedAt: articleGenerationsTable.generatedAt,
      reviewDecision: articleGenerationsTable.reviewDecision,
      reviewedByName: checker.name,
      reviewedAt: articleGenerationsTable.reviewedAt,
      isLatest: sql<boolean>`(${latestPerBriefing})`,
    })
    .from(articleGenerationsTable)
    .innerJoin(partnersTable, eq(partnersTable.id, articleGenerationsTable.partnerId))
    .innerJoin(briefingsTable, eq(briefingsTable.id, articleGenerationsTable.briefingId))
    .leftJoin(yellowlimersTable, eq(yellowlimersTable.id, articleGenerationsTable.yellowlimerId))
    .leftJoin(creator, eq(creator.id, articleGenerationsTable.createdBy))
    .leftJoin(checker, eq(checker.id, articleGenerationsTable.reviewedBy))
    .where(eq(articleGenerationsTable.articleStatus, "Wacht op controle"))
    .orderBy(desc(articleGenerationsTable.generatedAt))
    .limit(300);
  res.json(rows.map((r) => ({
    ...r,
    status: r.reviewDecision ?? (r.isLatest ? "wacht" : "vervangen"),
  })));
});

router.get("/review-queue/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Ongeldig artikel." }); return; }
  const creator = alias(usersTable, "creator");
  const [row] = await db
    .select({
      id: articleGenerationsTable.id,
      title: articleGenerationsTable.title,
      fullArticle: articleGenerationsTable.fullArticle,
      metaTitle: articleGenerationsTable.metaTitle,
      metaDescription: articleGenerationsTable.metaDescription,
      primaryKeyword: articleGenerationsTable.primaryKeyword,
      versionNumber: articleGenerationsTable.versionNumber,
      partnerName: partnersTable.companyName,
      createdByName: creator.name,
      reviewerName: yellowlimersTable.name,
      generatedAt: articleGenerationsTable.generatedAt,
      reviewDecision: articleGenerationsTable.reviewDecision,
      reviewNote: articleGenerationsTable.reviewNote,
      reviewedAt: articleGenerationsTable.reviewedAt,
    })
    .from(articleGenerationsTable)
    .innerJoin(partnersTable, eq(partnersTable.id, articleGenerationsTable.partnerId))
    .leftJoin(yellowlimersTable, eq(yellowlimersTable.id, articleGenerationsTable.yellowlimerId))
    .leftJoin(creator, eq(creator.id, articleGenerationsTable.createdBy))
    .where(eq(articleGenerationsTable.id, id));
  if (!row || !row.fullArticle) { res.status(404).json({ error: "Artikel niet gevonden." }); return; }
  const [correction] = await db
    .select({ afterVersion: articleCorrectionsTable.afterVersion, difference: articleCorrectionsTable.difference, note: articleCorrectionsTable.note })
    .from(articleCorrectionsTable)
    .where(eq(articleCorrectionsTable.generationId, id))
    .orderBy(desc(articleCorrectionsTable.createdAt))
    .limit(1);
  res.json({ ...row, corrected: row.reviewDecision ? correction ?? null : null });
});

router.post("/review-queue/:id/decision", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const decision = req.body?.decision;
  const note = typeof req.body?.note === "string" && req.body.note.trim() ? req.body.note.trim().slice(0, 4000) : null;
  if (!Number.isInteger(id) || id <= 0 || (decision !== "goedgekeurd" && decision !== "afgekeurd" && decision !== null)) {
    res.status(400).json({ error: "Kies goedkeuren of afkeuren." });
    return;
  }
  const [gen] = await db.select().from(articleGenerationsTable).where(and(eq(articleGenerationsTable.id, id), eq(articleGenerationsTable.articleStatus, "Wacht op controle")));
  if (!gen) { res.status(404).json({ error: "Artikel niet gevonden." }); return; }
  const user = currentUser();

  if (decision === null) {
    // Undo: the check is open again; the stored correction is removed.
    await db.delete(articleCorrectionsTable).where(eq(articleCorrectionsTable.generationId, id));
    await db.update(articleGenerationsTable).set({ reviewDecision: null, reviewNote: null, reviewedBy: null, reviewedAt: null }).where(eq(articleGenerationsTable.id, id));
    res.json({ ok: true });
    return;
  }

  // Before = the AI version, after = what the reviewer made of it.
  const before = { fullArticle: gen.fullArticle, metaTitle: gen.metaTitle, metaDescription: gen.metaDescription };
  const edited = req.body?.edited ?? {};
  const str = (v: unknown, fallback: string, max: number) => (typeof v === "string" ? v.slice(0, max) : fallback);
  const after = {
    fullArticle: str(edited.fullArticle, before.fullArticle, 200_000),
    metaTitle: str(edited.metaTitle, before.metaTitle, 300),
    metaDescription: str(edited.metaDescription, before.metaDescription, 1000),
  };
  const difference = compareArticles(before, after);

  await db.delete(articleCorrectionsTable).where(eq(articleCorrectionsTable.generationId, id));
  await db.insert(articleCorrectionsTable).values({
    generationId: id,
    partnerId: gen.partnerId,
    decision,
    beforeVersion: before,
    afterVersion: after,
    difference: difference as unknown as Record<string, unknown>,
    note,
    noteScope: req.body?.noteScope === "partner" || req.body?.noteScope === "algemeen" ? req.body.noteScope : null,
    reviewedBy: user?.id ?? null,
  });
  await db
    .update(articleGenerationsTable)
    .set({ reviewDecision: decision, reviewNote: note, reviewedBy: user?.id ?? null, reviewedAt: new Date() })
    .where(eq(articleGenerationsTable.id, id));
  res.json({ ok: true, difference: difference.stats });
});

export default router;
