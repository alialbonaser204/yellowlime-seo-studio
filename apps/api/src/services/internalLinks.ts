import { eq } from "drizzle-orm";
import { db, partnersTable } from "@yellowlime/db";
import { logger } from "../lib/logger";
import { defaultClaudeTextRunner, type ClaudeTextRunner } from "./claudeRunner";
import {
  chooseLinkCandidates,
  makeInternalLinksPrompt,
  normalizeUrl,
  parseInternalLinks,
  type InternalLinkSuggestion,
  type PageMetrics,
} from "./internalLinksData";
import { searchConsolePageMetrics } from "./searchConsole";
import { latestScan, listWebsiteArticles } from "./websiteScan";

/**
 * Suggests internal links for a new article: pages on the partner's own
 * website (found by the website scan) that fit the article, with the exact
 * words in the text that can become the link.
 */

const CLAUDE_TIMEOUT_MS = 120_000;
const CLAUDE_IDLE_MS = 110_000;

export interface InternalLinksResult {
  suggestions: InternalLinkSuggestion[];
  articlesKnown: number;
  candidatesConsidered: number;
  searchConsole: boolean;
  message: string | null;
}

export interface InternalLinksDeps {
  runner?: ClaudeTextRunner;
  pageMetrics?: (websiteUrl: string) => Promise<Array<{ key: string } & PageMetrics> | null>;
}

export async function suggestInternalLinks(
  partnerId: number,
  input: { subject: string; content: string },
  deps: InternalLinksDeps = {},
): Promise<InternalLinksResult | null> {
  const [partner] = await db.select().from(partnersTable).where(eq(partnersTable.id, partnerId));
  if (!partner) return null;

  const pages = await listWebsiteArticles(partnerId);
  if (pages.length === 0) {
    const scan = await latestScan(partnerId);
    return {
      suggestions: [],
      articlesKnown: 0,
      candidatesConsidered: 0,
      searchConsole: false,
      message: scan
        ? "Bij de websitescan zijn geen artikelen gevonden om naar te linken."
        : "Scan eerst de website van deze partner (op de partnerpagina), zodat de Yellowlime AI Agent weet naar welke pagina's hij kan linken.",
    };
  }

  const rows = await (deps.pageMetrics ?? ((url: string) => searchConsolePageMetrics(url)))(partner.websiteUrl);
  const metrics = rows ? new Map(rows.map((row) => [normalizeUrl(row.key), { clicks: row.clicks, impressions: row.impressions, position: row.position }])) : null;
  const candidates = chooseLinkCandidates(input.subject, input.content, pages, metrics);
  if (candidates.length === 0) {
    return {
      suggestions: [],
      articlesKnown: pages.length,
      candidatesConsidered: 0,
      searchConsole: Boolean(metrics),
      message: "Er staan nog geen artikelen op de website die over een verwant onderwerp gaan.",
    };
  }

  const prompt = makeInternalLinksPrompt({ companyName: partner.companyName, subject: input.subject, content: input.content, candidates });
  const runner = deps.runner ?? ((text: string, timeout: number) => defaultClaudeTextRunner(text, timeout, CLAUDE_IDLE_MS));
  const raw = await runner(prompt, CLAUDE_TIMEOUT_MS);
  const suggestions = parseInternalLinks(raw, candidates, input.content);
  logger.info({ partnerId, articlesKnown: pages.length, candidates: candidates.length, suggestions: suggestions.length }, "Internal links suggested");
  return {
    suggestions,
    articlesKnown: pages.length,
    candidatesConsidered: candidates.length,
    searchConsole: Boolean(metrics),
    message: suggestions.length === 0 ? "De Yellowlime AI Agent vond geen plekken in de tekst waar een interne link echt past." : null,
  };
}
