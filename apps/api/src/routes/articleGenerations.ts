import { and, desc, eq, sql } from "drizzle-orm";
import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import {
  GenerateArticleGenerationParams,
  GenerateArticleGenerationResponse,
  ListArticleGenerationsParams,
  ListArticleGenerationsResponse,
} from "@yellowlime/api-zod";
import {
  articleGenerationsTable,
  briefingsTable,
  db,
  partnerProfilesTable,
  partnersTable,
  semrushResearchTable,
  yellowlimersTable,
} from "@yellowlime/db";
import {
  articleGenerationPrerequisiteError,
  articleGenerationErrorMessage,
  ARTICLE_CLAUDE_MODEL,
  ARTICLE_PROMPT_VERSION,
  generateArticle,
} from "../services/articleGeneration";

const router: IRouter = Router();

type SafeLogger = {
  error: (object: unknown, message?: string) => void;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function snapshot(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

router.get(
  "/briefings/:briefingId/article-generations",
  async (req, res): Promise<void> => {
    const parsed = ListArticleGenerationsParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "Ongeldige briefing." });
      return;
    }
    const [briefing] = await db
      .select({ id: briefingsTable.id })
      .from(briefingsTable)
      .where(eq(briefingsTable.id, parsed.data.briefingId));
    if (!briefing) {
      res.status(404).json({ error: "Briefing niet gevonden." });
      return;
    }
    const rows = await db
      .select()
      .from(articleGenerationsTable)
      .where(eq(articleGenerationsTable.briefingId, briefing.id))
      .orderBy(desc(articleGenerationsTable.versionNumber));
    res.json(ListArticleGenerationsResponse.parse(rows));
  },
);

router.post(
  "/briefings/:briefingId/article-generations",
  async (req, res): Promise<void> => {
    const parsed = GenerateArticleGenerationParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "Ongeldige briefing." });
      return;
    }
    const briefingId = parsed.data.briefingId;
    const [briefing] = await db
      .select()
      .from(briefingsTable)
      .where(eq(briefingsTable.id, briefingId));
    if (!briefing) {
      res.status(404).json({ error: "Briefing niet gevonden." });
      return;
    }
    const [partner] = await db
      .select()
      .from(partnersTable)
      .where(eq(partnersTable.id, briefing.partnerId));
    const [profile] = await db
      .select()
      .from(partnerProfilesTable)
      .where(eq(partnerProfilesTable.partnerId, briefing.partnerId));
    const [research] = await db
      .select()
      .from(semrushResearchTable)
      .where(eq(semrushResearchTable.briefingId, briefingId));
    const [reviewer] = briefing.reviewerId
      ? await db
          .select()
          .from(yellowlimersTable)
          .where(eq(yellowlimersTable.id, briefing.reviewerId))
      : [undefined];
    const prerequisiteError = articleGenerationPrerequisiteError({
      partnerExists: Boolean(partner),
      partnerProfileStatus: profile?.profileStatus ?? null,
      approvedPartnerProfile: profile?.approvedProfile ?? null,
      reviewerId: briefing.reviewerId,
      reviewerActive: Boolean(reviewer?.active),
      subject: briefing.subject,
      contentGoal: briefing.contentGoal,
    });
    if (prerequisiteError) {
      res.status(409).json({ error: prerequisiteError });
      return;
    }

    const approvedProfileSnapshot = snapshot(profile!.approvedProfile as Record<string, unknown>);
    const primaryKeyword = research?.selectedMainKeyword?.trim() || briefing.subject;
    const semrushResearchSnapshot = snapshot({
      ...(research as unknown as Record<string, unknown> | undefined),
      apiStatus: research?.apiStatus ?? "not_available",
      originalSubject: research?.originalSubject ?? briefing.subject,
      selectedMainKeyword: primaryKeyword,
      searchVolume: research?.searchVolume ?? null,
      keywordDifficulty: research?.keywordDifficulty ?? null,
      searchIntent: research?.searchIntent ?? null,
      trend: research?.trend ?? null,
      secondaryKeywords: research?.secondaryKeywords ?? [],
      relevantQuestions: research?.relevantQuestions ?? [],
      organicCompetitors: research?.organicCompetitors ?? [],
      message: research?.message ?? "SEO-onderzoek niet beschikbaar; het briefingonderwerp wordt gebruikt.",
    });
    let pending: typeof articleGenerationsTable.$inferSelect;
    try {
      // Advisory locks serialize version allocation without changing any
      // existing article, review, profile, or SEO rows.
      pending = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${briefingId})`);
        const [latest] = await tx
          .select()
          .from(articleGenerationsTable)
          .where(eq(articleGenerationsTable.briefingId, briefingId))
          .orderBy(desc(articleGenerationsTable.versionNumber))
          .limit(1);
        if (latest?.articleStatus === "Artikel wordt geschreven") {
          throw new Error("article_generation_pending");
        }
        const versionNumber = (latest?.versionNumber ?? 0) + 1;
        const [inserted] = await tx
          .insert(articleGenerationsTable)
          .values({
            briefingId,
            partnerId: briefing.partnerId,
            yellowlimerId: briefing.reviewerId!,
            versionNumber,
            title: "",
            introduction: "",
            sections: [],
            conclusion: "",
            fullArticle: "",
            metaTitle: "",
            metaDescription: "",
            primaryKeyword,
            secondaryKeywordsUsed: [],
            questionsAnswered: [],
            approvedPartnerProfileSnapshot: approvedProfileSnapshot,
            semrushResearchSnapshot,
            articleStatus: "Artikel wordt geschreven",
            claudeModelName: ARTICLE_CLAUDE_MODEL,
            promptVersion: ARTICLE_PROMPT_VERSION,
            failureMessage: null,
          })
          .returning();
        return inserted;
      });
    } catch (error) {
      if (error instanceof Error && error.message === "article_generation_pending") {
        res.status(409).json({ error: "Er wordt al een artikel gegenereerd." });
        return;
      }
      req.log.error(
        { code: "article_generation_storage_failed", errorType: error instanceof Error ? error.name : typeof error },
        "Artikelgeneratie kon niet worden gestart",
      );
      res.status(500).json({ error: "De artikelgeneratie kon niet worden gestart." });
      return;
    }

    res.status(202).json(GenerateArticleGenerationResponse.parse(pending));
    queueArticleGeneration(
      pending.id,
      {
        partnerName: partner!.companyName,
        approvedPartnerProfile: approvedProfileSnapshot,
        subject: briefing.subject,
        contentGoal: briefing.contentGoal,
        semrushResearch: semrushResearchSnapshot,
        yellowlimerName: reviewer!.name,
      },
      req.log,
    );
  },
);

function queueArticleGeneration(
  generationId: number,
  input: Parameters<typeof generateArticle>[0],
  log: SafeLogger,
): void {
  void (async () => {
    try {
      const generated = await generateArticle(input);
      await db
        .update(articleGenerationsTable)
        .set({
          title: generated.title,
          introduction: generated.introduction,
          sections: generated.sections,
          conclusion: generated.conclusion,
          fullArticle: generated.fullArticle,
          metaTitle: generated.metaTitle,
          metaDescription: generated.metaDescription,
          primaryKeyword: generated.primaryKeyword,
          secondaryKeywordsUsed: generated.secondaryKeywordsUsed,
          questionsAnswered: generated.questionsAnswered,
          articleStatus: "Wacht op controle",
          failureMessage: null,
        })
        .where(
          and(
            eq(articleGenerationsTable.id, generationId),
            eq(articleGenerationsTable.articleStatus, "Artikel wordt geschreven"),
          ),
        );
    } catch (error) {
      const message = articleGenerationErrorMessage(error);
      try {
        await db
          .update(articleGenerationsTable)
          .set({ articleStatus: "Generatie mislukt", failureMessage: message })
          .where(
            and(
              eq(articleGenerationsTable.id, generationId),
              eq(articleGenerationsTable.articleStatus, "Artikel wordt geschreven"),
            ),
          );
      } catch (storageError) {
        log.error(
          { code: "article_generation_failure_storage_failed", errorType: storageError instanceof Error ? storageError.name : typeof storageError },
          "Foutstatus artikelgeneratie kon niet worden opgeslagen",
        );
      }
      log.error(
        { code: "article_generation_failed", errorType: error instanceof Error ? error.name : typeof error },
        "Artikelgeneratie mislukt",
      );
    }
  })().catch((error) => {
    log.error(
      { code: "article_generation_background_failed", errorType: error instanceof Error ? error.name : typeof error },
      "Artikelgeneratie op achtergrond mislukt",
    );
  });
}

router.use((
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  req.log.error(
    { code: "article_generation_route_failed", errorType: error instanceof Error ? error.name : typeof error },
    "Artikelgeneratieverzoek mislukt",
  );
  if (!res.headersSent) {
    res.status(500).json({ error: "De artikelgeneratie kon niet worden verwerkt." });
  }
});

export default router;