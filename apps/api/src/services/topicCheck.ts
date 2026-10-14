import { eq } from "drizzle-orm";
import { db, partnersTable } from "@yellowlime/db";
import { logger } from "../lib/logger";
import { defaultClaudeTextRunner, type ClaudeTextRunner } from "./claudeRunner";
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
}

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

  const googlePromise: Promise<TopicCheckResult["googleRanking"]> =
    deps.skipGoogle || !process.env.SEMRUSH_API_KEY?.trim() && !deps.semrushTransport
      ? Promise.resolve(null)
      : findDomainInTopResults(subject, hostOf(partner.websiteUrl), deps.semrushTransport).catch((error) => {
          logger.warn({ errorType: error instanceof Error ? error.name : typeof error }, "Topic check: Google lookup failed");
          return null;
        });

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
        articlesChecked: candidates.length,
        lastScanAt,
      };
    }
  }

  const ranking = await googlePromise;
  if (ranking) {
    result.googleRanking = ranking;
    const sentence = `De website staat in Google al op positie ${ranking.position ?? "?"} voor dit onderwerp. Overweeg die pagina bij te werken.`;
    if (result.verdict === "new" || result.verdict === "unknown") result.verdict = "related";
    result.explanation = `${result.explanation} ${sentence}`.trim();
    const samePage = (a: string, b: string) => {
      try {
        const x = new URL(a);
        const y = new URL(b);
        return hostOf(a) === hostOf(b) && x.pathname.replace(/\/+$/, "") === y.pathname.replace(/\/+$/, "");
      } catch {
        return false;
      }
    };
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
