import { asc, desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateArticleBody,
  CreateArticleResponse,
  GetArticleByBriefingParams,
  GetArticleByBriefingResponse,
  ListArticleReviewsResponse,
  CreateArticleReviewBody,
  CreateArticleReviewResponse,
} from "@yellowlime/api-zod";
import {
  articleReviewsTable,
  articlesTable,
  briefingsTable,
  db,
  partnersTable,
  yellowlimersTable,
} from "@yellowlime/db";

const router: IRouter = Router();

router.post("/articles", async (req, res): Promise<void> => {
  const parsed = CreateArticleBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid article");
    res.status(400).json({ error: "Ongeldige artikelgegevens." });
    return;
  }

  const [briefing] = await db
    .select()
    .from(briefingsTable)
    .where(eq(briefingsTable.id, parsed.data.briefingId));
  const [partner] = await db
    .select({ id: partnersTable.id })
    .from(partnersTable)
    .where(eq(partnersTable.id, parsed.data.partnerId));
  const [yellowlimer] = await db
    .select({ id: yellowlimersTable.id })
    .from(yellowlimersTable)
    .where(eq(yellowlimersTable.id, parsed.data.yellowlimerId));

  if (
    !briefing ||
    !partner ||
    !yellowlimer ||
    briefing.partnerId !== parsed.data.partnerId ||
    briefing.reviewerId !== parsed.data.yellowlimerId
  ) {
    res.status(400).json({ error: "Partner, briefing en reviewer komen niet overeen." });
    return;
  }

  const [existing] = await db
    .select()
    .from(articlesTable)
    .where(eq(articlesTable.briefingId, parsed.data.briefingId));
  if (existing) {
    res.status(201).json(CreateArticleResponse.parse(existing));
    return;
  }

  const [article] = await db
    .insert(articlesTable)
    .values({
      partnerId: parsed.data.partnerId,
      briefingId: parsed.data.briefingId,
      yellowlimerId: parsed.data.yellowlimerId,
      title: parsed.data.title,
      content: parsed.data.content,
      metaTitle: parsed.data.metaTitle,
      metaDescription: parsed.data.metaDescription,
      modelName: parsed.data.modelName,
      promptVersion: parsed.data.promptVersion,
    })
    .returning();
  res.status(201).json(CreateArticleResponse.parse(article));
});

router.get("/articles/by-briefing/:briefingId", async (req, res): Promise<void> => {
  const parsed = GetArticleByBriefingParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Ongeldige briefing." });
    return;
  }
  const [article] = await db
    .select()
    .from(articlesTable)
    .where(eq(articlesTable.briefingId, parsed.data.briefingId));
  res.json(GetArticleByBriefingResponse.parse(article ?? null));
});

router.get("/article-reviews", async (_req, res): Promise<void> => {
  const reviews = await db
    .select()
    .from(articleReviewsTable)
    .orderBy(desc(articleReviewsTable.humanVersionCreatedAt), asc(articleReviewsTable.id));
  res.json(ListArticleReviewsResponse.parse(reviews));
});

router.post("/article-reviews", async (req, res): Promise<void> => {
  const parsed = CreateArticleReviewBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid article review");
    res.status(400).json({ error: "Ongeldige reviewgegevens." });
    return;
  }

  const [article] = await db
    .select()
    .from(articlesTable)
    .where(eq(articlesTable.id, parsed.data.articleId));
  if (!article) {
    res.status(400).json({ error: "Artikel niet gevonden." });
    return;
  }

  const [review] = await db
    .insert(articleReviewsTable)
    .values({
      partnerId: article.partnerId,
      briefingId: article.briefingId,
      articleId: article.id,
      yellowlimerId: article.yellowlimerId,
      originalTitle: article.title,
      originalContent: article.content,
      originalMetaTitle: article.metaTitle,
      originalMetaDescription: article.metaDescription,
      correctedTitle: parsed.data.correctedTitle,
      correctedContent: parsed.data.correctedContent,
      correctedMetaTitle: parsed.data.correctedMetaTitle,
      correctedMetaDescription: parsed.data.correctedMetaDescription,
      reviewerExplanation: parsed.data.reviewerExplanation ?? null,
      reviewStatus: parsed.data.reviewStatus,
      aiVersionCreatedAt: article.createdAt,
      humanVersionCreatedAt: new Date(),
      claudeModelName: article.modelName,
      promptVersion: article.promptVersion,
    })
    .returning();
  res.status(201).json(CreateArticleReviewResponse.parse(review));
});

export default router;