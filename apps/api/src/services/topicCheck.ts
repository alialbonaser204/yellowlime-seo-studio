import { eq } from "drizzle-orm";
import { db, partnersTable } from "@yellowlime/db";
import { logger } from "../lib/logger";
import { defaultClaudeTextRunner, type ClaudeTextRunner } from "./claudeRunner";
import { searchConsolePagesForTopic } from "./searchConsole";
import type { TopicPage } from "./searchConsoleData";
import { findDomainInTopResults, type SemrushTransport } from "./semrush";
import { distinctOverlap, lexicalScore, makeTopicCheckPrompt, parseTopicJudgement, selectCandidates, topicTokens } from "./topicMatching";
import { latestScan, listWebsiteArticles } from "./websiteScan";

/**
 * Checks whether a proposed article topic is already covered on the partner's
 * website. Combines the scanned website articles (judged by Claude) with
 * Google's current top 10 (via Semrush).
 */

export type TopicVerdict = "new" | "related" | "duplicate" | "unknown";

export interface TopicMatch {
  url: string;
  title: string;
  relation: "duplicate" | "related";
  reason: string;
}

export interface TopicCheckResult {
  verdict: TopicVerdict;
  explanation: string;
  matches: TopicMatch[];
  alternatives: string[];
  googleRanking: { position: number | null; url: string } | null;
  /** The partner's pages that Google already shows for this topic (Search Console, last 90 days). */
  searchConsole: { property: string; pages: TopicPage[] } | null;
  articlesChecked: number;
  lastScanAt: Date | null;
}

export interface TopicCheckInput {
  partnerId: number;
  subject: string;
  contentGoal?: string;
}

export interface TopicCheckDeps {
  runner?: ClaudeTextRunner;
  semrushTransport?: SemrushTransport;
  /** Skip the Semrush lookup (e.g. when no key is configured). */
  skipGoogle?: boolean;
  /** Replaces the Search Console lookup (tests). */
  searchConsoleLookup?: (websiteUrl: string, subject: string) => Promise<{ property: string; pages: TopicPage[] } | null>;
}

/** A Search Console page counts as covering the topic from this many impressions. */
const SEARCH_CONSOLE_MIN_IMPRESSIONS = 20;

const CLAUDE_TIMEOUT_MS = 90_000;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export async function checkTopic(input: TopicCheckInput, deps: TopicCheckDeps = {}): Promise<TopicCheckResult | null> {
  const [partner] = await db.select().from(partnersTable).where(eq(partnersTable.id, input.partnerId));
  if (!partner) return null;
  const subject = input.subject.trim();
  const articles = await listWebsiteArticles(input.partnerId);
  const scan = await latestScan(input.partnerId);
  const lastScanAt = scan?.status === "completed" ? scan.finishedAt : null;

  // Search Console shows exactly which pages Google already shows for the
  // topic. Semrush (which costs API units) is only asked when Search Console
  // is not available for this website.
  const searchConsolePromise = (deps.searchConsoleLookup ?? searchConsolePagesForTopic)(partner.websiteUrl, subject).catch(() => null);
  const googlePromise: Promise<TopicCheckResult["googleRanking"]> = searchConsolePromise.then((searchConsole) =>
    searchConsole || deps.skipGoogle || (!process.env.SEMRUSH_API_KEY?.trim() && !deps.semrushTransport)
      ? null
      : findDomainInTopResults(subject, hostOf(partner.websiteUrl), deps.semrushTransport).catch((error) => {
          logger.warn({ errorType: error instanceof Error ? error.name : typeof error }, "Topic check: Google lookup failed");
          return null;
        }),
  );

  let result: TopicCheckResult;
  if (articles.length === 0) {
    result = {
      verdict: "unknown",
      explanation: scan
        ? "Er zijn nog geen gepubliceerde artikelen van deze partner bekend. Scan de website opnieuw om te controleren op dubbele onderwerpen."
        : "De website van deze partner is nog niet gescand. Scan eerst de website om te controleren op dubbele onderwerpen.",
      matches: [],
      alternatives: [],
      googleRanking: null,
      searchConsole: null,
      articlesChecked: 0,
      lastScanAt,
    };
  } else {
    const candidates = selectCandidates(`${subject} ${input.contentGoal ?? ""}`, articles);
    try {
      const raw = await (deps.runner ?? defaultClaudeTextRunner)(
        makeTopicCheckPrompt({ companyName: partner.companyName, subject, contentGoal: input.contentGoal }, candidates),
        CLAUDE_TIMEOUT_MS,
      );
      const judgement = parseTopicJudgement(raw, candidates.length);
      result = {
        verdict: judgement.verdict,
        explanation: judgement.explanation,
        matches: judgement.matches.map((match) => ({
          url: candidates[match.index].url,
          title: candidates[match.index].title,
          relation: match.relation,
          reason: match.reason,
        })),
        alternatives: judgement.alternatives,
        googleRanking: null,
        searchConsole: null,
        articlesChecked: candidates.length,
        lastScanAt,
      };
    } catch (error) {
      // Without Claude, fall back to the word-overlap score so the check still helps.
      logger.warn({ errorType: error instanceof Error ? error.message : typeof error }, "Topic check: falling back to word overlap");
      const scored = candidates
        .map((article) => ({ article, score: lexicalScore(subject, article) }))
        .filter((entry) => entry.score >= 4 && distinctOverlap(subject, entry.article) >= Math.min(2, topicTokens(subject).length))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      result = {
        verdict: scored.length ? "related" : "new",
        explanation: scored.length
          ? "De AI-controle was niet beschikbaar. Op basis van overeenkomende woorden lijken deze artikelen op je onderwerp; controleer ze zelf."
          : "De AI-controle was niet beschikbaar. Er zijn geen artikelen met overeenkomende woorden gevonden.",
        matches: scored.map(({ article }) => ({ url: article.url, title: article.title, relation: "related" as const, reason: "Gebruikt dezelfde woorden." })),
        alternatives: [],
        googleRanking: null,
        searchConsole: null,
        articlesChecked: candidates.length,
        lastScanAt,
      };
    }
  }

  const samePage = (a: string, b: string) => {
    try {
      const x = new URL(a);
      const y = new URL(b);
      return hostOf(a) === hostOf(b) && x.pathname.replace(/\/+$/, "") === y.pathname.replace(/\/+$/, "");
    } catch {
      return false;
    }
  };

  const searchConsole = await searchConsolePromise;
  result.searchConsole = searchConsole;
  const coveringPages = (searchConsole?.pages ?? [])
    .filter((page) => page.impressions >= SEARCH_CONSOLE_MIN_IMPRESSIONS && page.position <= 20)
    .slice(0, 3);
  if (coveringPages.length) {
    if (result.verdict === "new" || result.verdict === "unknown") result.verdict = "related";
    const best = coveringPages[0];
    result.explanation = `${result.explanation} Volgens Search Console toont Google ${coveringPages.length === 1 ? "al een pagina" : `al ${coveringPages.length} pagina's`} van de website voor dit onderwerp (beste: gemiddelde positie ${best.position}, ${best.clicks} klikken in 90 dagen). Overweeg die pagina bij te werken of kies een andere invalshoek.`.trim();
    for (const page of [...coveringPages].reverse()) {
      const reason = `Google toont deze pagina al bij zoekopdrachten als ${page.queries.map((q) => `"${q}"`).join(", ")}: ${page.impressions} vertoningen, ${page.clicks} klikken, gemiddelde positie ${page.position} (laatste 90 dagen).`;
      const existing = result.matches.find((match) => samePage(match.url, page.page));
      if (existing) {
        existing.reason = `${existing.reason} ${reason}`;
      } else {
        const known = articles.find((article) => samePage(article.url, page.page));
        result.matches.unshift({ url: page.page, title: known?.title ?? page.page, relation: "related", reason });
      }
    }
  }

  const ranking = await googlePromise;
  if (ranking) {
    result.googleRanking = ranking;
    const sentence = `De website staat in Google al op positie ${ranking.position ?? "?"} voor dit onderwerp. Overweeg die pagina bij te werken.`;
    if (result.verdict === "new" || result.verdict === "unknown") result.verdict = "related";
    result.explanation = `${result.explanation} ${sentence}`.trim();
    const known = articles.find((article) => samePage(article.url, ranking.url));
    if (!result.matches.some((match) => samePage(match.url, ranking.url))) {
      result.matches.unshift({
        url: ranking.url,
        title: known?.title ?? ranking.url,
        relation: "related",
        reason: `Staat in Google op positie ${ranking.position ?? "?"} voor dit onderwerp.`,
      });
    }
  }
  return result;
}
