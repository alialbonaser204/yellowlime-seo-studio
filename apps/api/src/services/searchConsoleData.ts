import { topicTokens } from "./topicMatching";

/**
 * Pure helpers for Search Console data: matching a partner website to a Search
 * Console property, report periods and turning raw rows into the overviews
 * the app shows. No network or database access.
 */

export interface SearchConsoleSite {
  siteUrl: string;
  permissionLevel: string;
}

export interface MetricRow {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface DecliningPage {
  page: string;
  clicks: number;
  previousClicks: number;
  change: number;
}

export interface TopicPage {
  page: string;
  clicks: number;
  impressions: number;
  position: number;
  queries: string[];
}

/** Google's raw row shape from searchAnalytics.query. */
export interface RawRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

/** Search Console data is complete after about three days. */
export const DATA_DELAY_DAYS = 3;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const bare = (host: string) => host.replace(/^www\./, "");

/**
 * Picks the Search Console property for a website. A domain property
 * (sc-domain:) is preferred because it covers every subdomain and protocol;
 * otherwise a URL-prefix property for the same host (with or without www).
 */
export function matchProperty(websiteUrl: string, sites: SearchConsoleSite[]): string | null {
  const host = hostOf(websiteUrl);
  if (!host) return null;
  const usable = sites.filter((site) => site.permissionLevel !== "siteUnverifiedUser");

  const domainMatches = usable
    .filter((site) => site.siteUrl.startsWith("sc-domain:"))
    .map((site) => ({ site, domain: site.siteUrl.slice("sc-domain:".length).toLowerCase() }))
    .filter(({ domain }) => host === domain || host.endsWith(`.${domain}`))
    .sort((a, b) => b.domain.length - a.domain.length);
  if (domainMatches[0]) return domainMatches[0].site.siteUrl;

  let path = "/";
  try {
    path = new URL(websiteUrl).pathname || "/";
  } catch {
    // keep "/"
  }
  const prefixMatches = usable
    .filter((site) => !site.siteUrl.startsWith("sc-domain:"))
    .map((site) => {
      const siteHost = hostOf(site.siteUrl);
      let sitePath = "/";
      try {
        sitePath = new URL(site.siteUrl).pathname || "/";
      } catch {
        // keep "/"
      }
      return { site, siteHost, sitePath };
    })
    .filter(({ siteHost, sitePath }) => siteHost && bare(siteHost) === bare(host) && path.startsWith(sitePath))
    .sort((a, b) => {
      // Same host first (www vs. no www), then https, then the longest path.
      const exact = Number(b.siteHost === host) - Number(a.siteHost === host);
      if (exact) return exact;
      const https = Number(b.site.siteUrl.startsWith("https:")) - Number(a.site.siteUrl.startsWith("https:"));
      if (https) return https;
      return b.sitePath.length - a.sitePath.length;
    });
  return prefixMatches[0]?.site.siteUrl ?? null;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

/** The last `days` days with complete data, and the period before that. */
export function reportPeriod(days: number, today = new Date()) {
  const end = addDays(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())), -DATA_DELAY_DAYS);
  const start = addDays(end, -(days - 1));
  const previousEnd = addDays(start, -1);
  const previousStart = addDays(previousEnd, -(days - 1));
  return {
    startDate: isoDate(start),
    endDate: isoDate(end),
    previousStartDate: isoDate(previousStart),
    previousEndDate: isoDate(previousEnd),
  };
}

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

export function toMetricRows(rows: RawRow[] | undefined): MetricRow[] {
  return (rows ?? [])
    .filter((row) => row.keys?.[0])
    .map((row) => ({
      key: row.keys![0],
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      ctr: round(row.ctr ?? 0, 4),
      position: round(row.position ?? 0, 1),
    }));
}

/**
 * Queries that already get impressions but rank just below the top results
 * (positions 4 to 20). Improving or writing for these has the best chance of
 * quick extra traffic.
 */
export function findOpportunities(queries: MetricRow[], limit = 15): MetricRow[] {
  return queries
    .filter((row) => row.position >= 4 && row.position <= 20 && row.impressions >= 10)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit);
}

/** Pages that lost the most clicks compared with the previous period. */
export function findDecliningPages(current: MetricRow[], previous: MetricRow[], limit = 10): DecliningPage[] {
  const now = new Map(current.map((row) => [row.key, row.clicks]));
  return previous
    .map((row) => {
      const clicks = now.get(row.key) ?? 0;
      return { page: row.key, clicks, previousClicks: row.clicks, change: clicks - row.clicks };
    })
    .filter((row) => row.previousClicks >= 5 && row.change <= -Math.max(3, row.previousClicks * 0.2))
    .sort((a, b) => a.change - b.change)
    .slice(0, limit);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A Search Console regex filter (RE2) that matches queries containing any of
 * the topic's meaningful words. Returns null when the topic has none.
 */
export function topicQueryRegex(subject: string): string | null {
  const tokens = [...new Set(topicTokens(subject).filter((token) => token.length >= 3))].slice(0, 8);
  if (tokens.length === 0) return null;
  return `(?i)(${tokens.map(escapeRegex).join("|")})`;
}

/**
 * Groups query+page rows into the partner's pages that Google already shows
 * for searches about the topic. A query counts when it shares enough
 * meaningful words with the topic (two, or one for one-word topics).
 */
export function pagesForTopic(subject: string, rows: RawRow[] | undefined, limit = 5): TopicPage[] {
  const wanted = new Set(topicTokens(subject));
  const needed = Math.min(2, wanted.size);
  if (needed === 0) return [];
  const pages = new Map<string, { clicks: number; impressions: number; weightedPosition: number; queries: Map<string, number> }>();
  for (const row of rows ?? []) {
    const [query, page] = row.keys ?? [];
    if (!query || !page) continue;
    const overlap = new Set(topicTokens(query).filter((token) => wanted.has(token))).size;
    if (overlap < needed) continue;
    const impressions = row.impressions ?? 0;
    const entry = pages.get(page) ?? { clicks: 0, impressions: 0, weightedPosition: 0, queries: new Map() };
    entry.clicks += row.clicks ?? 0;
    entry.impressions += impressions;
    entry.weightedPosition += (row.position ?? 0) * impressions;
    entry.queries.set(query, (entry.queries.get(query) ?? 0) + impressions);
    pages.set(page, entry);
  }
  return [...pages.entries()]
    .map(([page, entry]) => ({
      page,
      clicks: entry.clicks,
      impressions: entry.impressions,
      position: entry.impressions ? round(entry.weightedPosition / entry.impressions, 1) : 0,
      queries: [...entry.queries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([query]) => query),
    }))
    .filter((page) => page.impressions >= 10)
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, limit);
}
