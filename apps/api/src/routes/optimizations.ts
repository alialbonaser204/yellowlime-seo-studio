/**
 * Optimising existing articles: the five worst performing articles of a
 * partner (with reasons), and a background job that rewrites a chosen one.
 */
import { desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { articleOptimizationsTable, db, partnerProfilesTable, partnersTable, websiteArticlesTable } from "@yellowlime/db";
import { runInBackground } from "../lib/background";
import { currentUser } from "../lib/requestUser";
import { logger } from "../lib/logger";
import { searchConsoleQueryData } from "../services/searchConsole";
import { pageToArticle, rankUnderperformers, type Underperformer } from "../services/underperformers";
import { fetchSafe } from "../services/safeHttp";
import { runSemrushResearch } from "../services/semrush";
import { analyseSerp, serpContext } from "../services/serpAnalysis";
import { lessonsFor } from "../services/learning";
import { optimizeArticle } from "../services/articleOptimizer";

const router: IRouter = Router();

const sameSite = (url: string, site: string) => {
  try {
    const strip = (h: string) => h.replace(/^www\./, "");
    return strip(new URL(url).hostname) === strip(new URL(site).hostname) && /^https?:$/.test(new URL(url).protocol);
  } catch { return false; }
};

router.get("/partners/:partnerId/optimize/candidates", async (req, res): Promise<void> => {
  const partnerId = Number(req.params.partnerId);
  const [partner] = await db.select().from(partnersTable).where(eq(partnersTable.id, partnerId));
  if (!partner) { res.status(404).json({ error: "Partner niet gevonden." }); return; }
  const data = await searchConsoleQueryData(partner.websiteUrl, null);
  if (!data) {
    res.json({ status: "no_gsc", message: "Voor deze partner zijn geen Search Console-gegevens beschikbaar. Verbind Google (menu, onderaan) met een account dat toegang heeft tot deze website.", candidates: [] });
    return;
  }
  const inventory = await db
    .select({ url: websiteArticlesTable.url, title: websiteArticlesTable.title, wordCount: websiteArticlesTable.wordCount, publishedAt: websiteArticlesTable.publishedAt })
    .from(websiteArticlesTable)
    .where(eq(websiteArticlesTable.partnerId, partnerId));
  const candidates = rankUnderperformers({ siteUrl: partner.websiteUrl, pagesNow: data.pagesNow, pagesBefore: data.pagesBefore, rows: data.rows, inventory });
  res.json({
    status: "ok",
    message: candidates.length ? null : "Er zijn geen artikelen gevonden die duidelijk slecht presteren. Laat eventueel eerst de gepubliceerde artikelen scannen bij de partner.",
    scannedArticles: inventory.length,
    candidates,
  });
});

router.get("/partners/:partnerId/optimizations", async (req, res): Promise<void> => {
  const partnerId = Number(req.params.partnerId);
  const rows = await db
    .select({ id: articleOptimizationsTable.id, url: articleOptimizationsTable.url, status: articleOptimizationsTable.status, createdAt: articleOptimizationsTable.createdAt })
    .from(articleOptimizationsTable)
    .where(eq(articleOptimizationsTable.partnerId, partnerId))
    .orderBy(desc(articleOptimizationsTable.createdAt))
    .limit(20);
  res.json(rows);
});

router.get("/optimizations/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db
    .select({ o: articleOptimizationsTable, partnerName: partnersTable.companyName })
    .from(articleOptimizationsTable)
    .innerJoin(partnersTable, eq(partnersTable.id, articleOptimizationsTable.partnerId))
    .where(eq(articleOptimizationsTable.id, id));
  if (!row) { res.status(404).json({ error: "Niet gevonden." }); return; }
  // A job that has been "busy" for over an hour has stopped without a result.
  if (row.o.status === "bezig" && Date.now() - new Date(row.o.createdAt).getTime() > 60 * 60_000) {
    await db.update(articleOptimizationsTable).set({ status: "mislukt", error: "De optimalisatie is onderbroken. Probeer het opnieuw." }).where(eq(articleOptimizationsTable.id, id));
    row.o.status = "mislukt"; row.o.error = "De optimalisatie is onderbroken. Probeer het opnieuw.";
  }
  res.json({ ...row.o, partnerName: row.partnerName });
});

router.post("/partners/:partnerId/optimize", async (req, res): Promise<void> => {
  const partnerId = Number(req.params.partnerId);
  const analysis = req.body?.analysis as Underperformer | undefined;
  const [partner] = await db.select().from(partnersTable).where(eq(partnersTable.id, partnerId));
  if (!partner) { res.status(404).json({ error: "Partner niet gevonden." }); return; }
  if (!analysis || typeof analysis.url !== "string" || !sameSite(analysis.url, partner.websiteUrl)) {
    res.status(400).json({ error: "Kies een artikel van de website van deze partner." });
    return;
  }
  const [profile] = await db.select().from(partnerProfilesTable).where(eq(partnerProfilesTable.partnerId, partnerId));
  if (!profile?.approvedProfile) { res.status(409).json({ error: "Keur eerst het partnerprofiel goed." }); return; }

  const [row] = await db
    .insert(articleOptimizationsTable)
    .values({ partnerId, url: analysis.url, analysis: analysis as unknown as Record<string, unknown>, createdBy: currentUser()?.id ?? null })
    .returning({ id: articleOptimizationsTable.id });
  const id = row.id;

  runInBackground(async () => {
    try {
      const page = await fetchSafe(analysis.url, { timeoutMs: 20_000 });
      if (page.status >= 400) throw new Error(`De pagina gaf een foutmelding (${page.status}).`);
      const original = pageToArticle(page.body);
      if (original.wordCount < 50) throw new Error("De tekst van de pagina kon niet worden gelezen.");
      await db.update(articleOptimizationsTable).set({ original }).where(eq(articleOptimizationsTable.id, id));

      const keyword = analysis.topQueries?.[0]?.query ?? original.title;
      let research: { keyword: string; volume: number | null; related: string[]; questions: string[] } | null = null;
      let serp: string | null = null;
      try {
        const r = await runSemrushResearch({ originalSubject: original.title, contentGoal: "Bestaand artikel optimaliseren", keyword });
        research = {
          keyword: r.selectedMainKeyword,
          volume: r.searchVolume,
          related: r.secondaryKeywords.slice(0, 10).map((k) => k.keyword),
          questions: r.relevantQuestions.slice(0, 8).map((q) => q.question),
        };
        // Compare with the top 5, leaving out the partner's own page.
        const others = r.organicCompetitors.filter((c) => !sameSite(c.url, partner.websiteUrl));
        serp = serpContext(await analyseSerp(others));
      } catch (error) {
        logger.warn({ code: "optimize_research_failed", errorType: error instanceof Error ? error.message : typeof error }, "Semrush-onderzoek voor optimalisatie mislukt");
      }

      const output = await optimizeArticle({
        partnerName: partner.companyName,
        profile: profile.approvedProfile!,
        analysis,
        original,
        serp,
        research,
        lessons: await lessonsFor(partnerId).catch(() => null),
      });
      await db.update(articleOptimizationsTable)
        .set({ status: "klaar", result: output.result, overview: output.overview as unknown as Record<string, unknown>, finishedAt: new Date() })
        .where(eq(articleOptimizationsTable.id, id));
    } catch (error) {
      const message = error instanceof Error && /^[A-Z]/.test(error.message) ? error.message : "Het optimaliseren is mislukt. Probeer het opnieuw.";
      logger.error({ code: "optimize_failed", errorType: error instanceof Error ? error.message.slice(0, 200) : typeof error }, "Optimalisatie mislukt");
      await db.update(articleOptimizationsTable).set({ status: "mislukt", error: message, finishedAt: new Date() }).where(eq(articleOptimizationsTable.id, id));
    }
  });

  res.status(202).json({ id });
});

export default router;
