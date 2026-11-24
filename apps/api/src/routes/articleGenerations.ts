import { and, desc, eq, sql } from "drizzle-orm";
import { runInBackground } from "../lib/background";
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
  websiteArticlesTable,
} from "@yellowlime/db";
import {
  articleGenerationPrerequisiteError,
  articleGenerationErrorMessage,
  ARTICLE_CLAUDE_MODEL,
  ARTICLE_PROMPT_VERSION,
  generateArticle,
  styleSampleFrom,
  detectPartnerHabits,
} from "../services/articleGeneration";
import { generateOutline, validateOutline, type ArticleOutline } from "../services/articleOutline";
import { analyseSerp } from "../services/serpAnalysis";
import { articleSearchConsoleContext } from "../services/searchConsole";
import { buildConcept } from "./articlePreview";
import { currentUser } from "../lib/requestUser";
import { lessonsFor } from "../services/learning";

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

/**
 * POST /briefings/:briefingId/article-outline
 * Claude proposes an outline; nothing is stored until the Yellowlimer approves
 * it by generating the article with it.
 */
router.post("/briefings/:briefingId/article-outline", async (req, res): Promise<void> => {
  const parsed = GenerateArticleGenerationParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Ongeldige briefing." });
    return;
  }
  const context = await loadGenerationContext(parsed.data.briefingId);
  if (context.status !== 200) {
    res.status(context.status).json({ error: context.error });
    return;
  }
  try {
    // Which pages rank comes from Semrush; how they are built is read here.
    const serp = await analyseSerp(context.semrushResearchSnapshot.organicCompetitors).catch(() => null);
    const outline = await generateOutline({
      partnerName: context.partner.companyName,
      approvedPartnerProfile: context.approvedProfileSnapshot,
      subject: context.briefing.subject,
      contentGoal: context.briefing.contentGoal,
      semrushResearch: context.semrushResearchSnapshot,
      serp,
    });
    res.json({ ...outline, competitors: serp });
  } catch (error) {
    req.log.error({ code: "article_outline_failed", errorType: error instanceof Error ? error.message : typeof error }, "Opzet maken mislukt");
    res.status(502).json({ error: articleGenerationErrorMessage(error) });
  }
});

/** Loads everything a generation (or an outline) needs, or says why it cannot start. */
async function loadGenerationContext(briefingId: number) {
    const [briefing] = await db
      .select()
      .from(briefingsTable)
      .where(eq(briefingsTable.id, briefingId));
    if (!briefing) return { status: 404 as const, error: "Briefing niet gevonden." };
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
    if (prerequisiteError) return { status: 409 as const, error: prerequisiteError };

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
    return { status: 200 as const, briefing, partner: partner!, profile: profile!, reviewer: reviewer!, research, approvedProfileSnapshot, primaryKeyword, semrushResearchSnapshot };
}

router.post(
  "/briefings/:briefingId/article-generations",
  async (req, res): Promise<void> => {
    const parsed = GenerateArticleGenerationParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "Ongeldige briefing." });
      return;
    }
    const briefingId = parsed.data.briefingId;
    const context = await loadGenerationContext(briefingId);
    if (context.status !== 200) {
      res.status(context.status).json({ error: context.error });
      return;
    }
    const { briefing, partner, profile, reviewer, approvedProfileSnapshot, primaryKeyword, semrushResearchSnapshot } = context;
    let outline: ArticleOutline | null = null;
    if (req.body && typeof req.body === "object" && (req.body as { outline?: unknown }).outline) {
      try {
        outline = validateOutline((req.body as { outline: unknown }).outline);
      } catch {
        res.status(400).json({ error: "De opzet is ongeldig. Maak de opzet opnieuw." });
        return;
      }
    }
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
          // An attempt that is still "being written" after 60 minutes was
          // interrupted (e.g. the page was closed). Mark it failed so a new
          // attempt can start instead of being blocked forever.
          const stale = Date.now() - new Date(latest.createdAt).getTime() > 60 * 60_000;
          if (!stale) throw new Error("article_generation_pending");
          await tx
            .update(articleGenerationsTable)
            .set({ articleStatus: "Generatie mislukt", failureMessage: "Deze poging is onderbroken. Er is een nieuwe poging gestart." })
            .where(eq(articleGenerationsTable.id, latest.id));
        }
        const versionNumber = (latest?.versionNumber ?? 0) + 1;
        const [inserted] = await tx
          .insert(articleGenerationsTable)
          .values({
            briefingId,
            partnerId: briefing.partnerId,
            yellowlimerId: briefing.reviewerId!,
            createdBy: currentUser()?.id ?? null,
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
            outline: outline as unknown as Record<string, unknown> | null,
          })
          .returning();
        return inserted;
      });
    } catch (error) {
      if (error instanceof Error && error.message === "article_generation_pending") {
        res.status(409).json({ error: "Er wordt al een artikel geschreven voor deze briefing. Wacht tot het klaar is." });
        return;
      }
      req.log.error(
        {
          code: "article_generation_storage_failed",
          errorType: error instanceof Error ? error.name : typeof error,
          // Postgres error code and message (no data from the request).
          dbCode: (error as { cause?: { code?: string }; code?: string })?.cause?.code ?? (error as { code?: string })?.code,
          dbMessage: ((error as { cause?: { message?: string } })?.cause?.message ?? (error instanceof Error ? error.message : "")).slice(0, 300),
        },
        "Artikelgeneratie kon niet worden gestart",
      );
      res.status(500).json({ error: "De artikelgeneratie kon niet worden gestart." });
      return;
    }

    // Headings of the partner's own published articles: what do they do themselves?
    const partnerHeadings = (await db
      .select({ headings: websiteArticlesTable.headings })
      .from(websiteArticlesTable)
      .where(eq(websiteArticlesTable.partnerId, partner!.id))
      .catch(() => [] as { headings: string[] }[])).flatMap((r) => r.headings ?? []);
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
        styleSample: styleSampleFrom(profile?.websiteText),
        partnerHabits: detectPartnerHabits([profile?.websiteText ?? ""], partnerHeadings),
        lessons: await lessonsFor(partner!.id).catch(() => null),
        outline,
      },
      req.log,
      // No outline supplied: the AI decides the structure itself first.
      outline ? null : semrushResearchSnapshot.organicCompetitors,
      partner!.id,
    );
  },
);

function queueArticleGeneration(
  generationId: number,
  input: Parameters<typeof generateArticle>[0],
  log: SafeLogger,
  autoOutlineFrom: Parameters<typeof analyseSerp>[0] | null = null,
  partnerIdForGsc: number | null = null,
): void {
  runInBackground(async () => {
    try {
      if (autoOutlineFrom !== null && !input.outline) {
        // The AI makes the outline (based on the top 5 in Google) and then
        // writes with it. If that fails, writing continues without an outline.
        try {
          const serp = await analyseSerp(autoOutlineFrom).catch(() => null);
          const outline = await generateOutline({
            partnerName: input.partnerName,
            approvedPartnerProfile: input.approvedPartnerProfile,
            subject: input.subject,
            contentGoal: input.contentGoal,
            semrushResearch: input.semrushResearch,
            serp,
          });
          input = { ...input, outline };
          await db
            .update(articleGenerationsTable)
            .set({ outline: outline as unknown as Record<string, unknown> })
            .where(eq(articleGenerationsTable.id, generationId));
        } catch (error) {
          log.error({ code: "auto_outline_failed", errorType: error instanceof Error ? error.message : typeof error }, "Automatische opzet mislukt; schrijven zonder opzet");
        }
      }
      if (input.searchConsole === undefined && partnerIdForGsc) {
        const keyword = String(input.semrushResearch.selectedMainKeyword ?? input.subject);
        input = { ...input, searchConsole: await articleSearchConsoleContext(partnerIdForGsc, keyword) };
      }
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
      // Make the concept page right away, for every partner. If it fails the
      // article is still fine; the button then makes the concept on request.
      await buildConcept(generationId).catch((error) => {
        log.error({ code: "auto_concept_failed", errorType: error instanceof Error ? error.message.slice(0, 200) : typeof error }, "Conceptpagina kon niet automatisch worden gemaakt");
      });
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
  }, (error) => {
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