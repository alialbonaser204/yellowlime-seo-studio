import { eq } from "drizzle-orm";
import { db, partnersTable } from "@yellowlime/db";
import { logger } from "../lib/logger";
import { findExactInternalLinks, normalizeUrl, type InternalLinkSuggestion, type PageMetrics } from "./internalLinksData";
import { searchConsolePageMetrics } from "./searchConsole";
import { latestScan, listWebsiteArticles } from "./websiteScan";

/**
 * The internal link check after approval: words in the approved article that
 * are exactly the same as the main keyword of an existing page on the
 * partner's website (found by the website scan). No AI is involved and the
 * text is not rewritten.
 */

export interface InternalLinksResult {
  suggestions: InternalLinkSuggestion[];
  articlesKnown: number;
  candidatesConsidered: number;
  searchConsole: boolean;
  message: string | null;
}

export interface InternalLinksDeps {
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
        : "Scan eerst de website van deze partner (op de partnerpagina), zodat de Yellowlime AI Agent weet welke pagina's er bestaan.",
    };
  }

  const rows = await (deps.pageMetrics ?? ((url: string) => searchConsolePageMetrics(url)))(partner.websiteUrl);
  const metrics = rows ? new Map(rows.map((row) => [normalizeUrl(row.key), { clicks: row.clicks, impressions: row.impressions, position: row.position }])) : null;
  const { suggestions, pagesWithKeyword } = findExactInternalLinks(input.content, pages, metrics);
  logger.info({ partnerId, articlesKnown: pages.length, pagesWithKeyword, suggestions: suggestions.length }, "Internal link check done");
  return {
    suggestions,
    articlesKnown: pages.length,
    candidatesConsidered: pagesWithKeyword,
    searchConsole: Boolean(metrics),
    message: suggestions.length === 0
      ? "Geen exacte matches: er staan in dit artikel geen woorden die precies hetzelfde zijn als het hoofdzoekwoord of de titel van een bestaande pagina."
      : null,
  };
}
