import { eq } from "drizzle-orm";
import { db, partnersTable } from "@yellowlime/db";
import { logger } from "../lib/logger";
import { currentConnection, getAccessToken, googleConfig, GoogleNotConnectedError, resetGoogleAuthCache } from "./googleAuth";
import {
  findDecliningPages,
  findOpportunities,
  matchProperty,
  pagesForTopic,
  reportPeriod,
  toMetricRows,
  topicQueryRegex,
  type DecliningPage,
  type MetricRow,
  type RawRow,
  type SearchConsoleSite,
  type TopicPage,
} from "./searchConsoleData";

/**
 * Reads Search Console data for partner websites through the connected
 * Google account. Results are cached in memory for a few hours, because the
 * data only changes once a day.
 */

const API_BASE = "https://www.googleapis.com/webmasters/v3";
const OVERVIEW_CACHE_MS = 6 * 60 * 60_000;
const SITES_CACHE_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 20_000;

export type SearchConsoleStatus = "not_configured" | "not_connected" | "no_property" | "ok" | "error";

export interface SearchConsoleOverview {
  status: SearchConsoleStatus;
  account: string | null;
  property: string | null;
  message: string | null;
  period: { startDate: string; endDate: string } | null;
  totals: { clicks: number; impressions: number; ctr: number; position: number } | null;
  topQueries: MetricRow[];
  topPages: MetricRow[];
  opportunities: MetricRow[];
  decliningPages: DecliningPage[];
}

type Fetcher = typeof fetch;

export class SearchConsoleError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SearchConsoleError";
  }
}

async function gscRequest<T>(path: string, body: unknown, fetcher: Fetcher, retried = false): Promise<T> {
  const token = await getAccessToken(fetcher);
  const response = await fetcher(`${API_BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 401 && !retried) {
    resetGoogleAuthCache();
    return gscRequest(path, body, fetcher, true);
  }
  if (!response.ok) throw new SearchConsoleError(`search_console_http_${response.status}`, response.status);
  return (await response.json()) as T;
}

let sitesCache: { at: number; sites: SearchConsoleSite[] } | null = null;

export async function listProperties(fetcher: Fetcher = fetch): Promise<SearchConsoleSite[]> {
  if (sitesCache && Date.now() - sitesCache.at < SITES_CACHE_MS) return sitesCache.sites;
  const data = await gscRequest<{ siteEntry?: SearchConsoleSite[] }>("/sites", undefined, fetcher);
  const sites = (data.siteEntry ?? []).filter((site) => site.permissionLevel !== "siteUnverifiedUser");
  sitesCache = { at: Date.now(), sites };
  return sites;
}

async function query(property: string, body: Record<string, unknown>, fetcher: Fetcher): Promise<RawRow[]> {
  const data = await gscRequest<{ rows?: RawRow[] }>(
    `/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
    { dataState: "final", ...body },
    fetcher,
  );
  return data.rows ?? [];
}

const overviewCache = new Map<string, { at: number; value: SearchConsoleOverview }>();

function emptyOverview(status: SearchConsoleStatus, message: string, extra: Partial<SearchConsoleOverview> = {}): SearchConsoleOverview {
  return {
    status,
    account: null,
    property: null,
    message,
    period: null,
    totals: null,
    topQueries: [],
    topPages: [],
    opportunities: [],
    decliningPages: [],
    ...extra,
  };
}

/** Finds the connection and the Search Console property for a website. */
async function resolveProperty(
  websiteUrl: string,
  fetcher: Fetcher,
): Promise<{ ok: true; account: string; property: string } | { ok: false; overview: SearchConsoleOverview }> {
  if (!googleConfig()) {
    return { ok: false, overview: emptyOverview("not_configured", "De Google-koppeling is nog niet ingesteld (GOOGLE_CLIENT_ID en GOOGLE_CLIENT_SECRET ontbreken).") };
  }
  const connection = await currentConnection();
  if (!connection || connection.lastError) {
    return {
      ok: false,
      overview: emptyOverview(
        "not_connected",
        connection?.lastError
          ? "De verbinding met Google is verlopen. Verbind opnieuw met Google."
          : "Er is nog geen Google-account verbonden.",
        { account: connection?.email ?? null },
      ),
    };
  }
  const sites = await listProperties(fetcher);
  const property = matchProperty(websiteUrl, sites);
  if (!property) {
    return {
      ok: false,
      overview: emptyOverview(
        "no_property",
        `Het account ${connection.email} heeft in Search Console geen toegang tot deze website.`,
        { account: connection.email },
      ),
    };
  }
  return { ok: true, account: connection.email, property };
}

export async function partnerSearchConsole(
  partnerId: number,
  days: number,
  { fetcher = fetch, refresh = false }: { fetcher?: Fetcher; refresh?: boolean } = {},
): Promise<SearchConsoleOverview | null> {
  const [partner] = await db.select().from(partnersTable).where(eq(partnersTable.id, partnerId));
  if (!partner) return null;
  const cacheKey = `${partnerId}:${partner.websiteUrl}:${days}`;
  const cached = overviewCache.get(cacheKey);
  if (!refresh && cached && Date.now() - cached.at < OVERVIEW_CACHE_MS) return cached.value;

  try {
    const resolved = await resolveProperty(partner.websiteUrl, fetcher);
    if (!resolved.ok) return resolved.overview;
    const { property, account } = resolved;
    const period = reportPeriod(days);
    const range = { startDate: period.startDate, endDate: period.endDate };
    const [totalsRows, queryRows, pageRows, previousPageRows] = await Promise.all([
      query(property, { ...range }, fetcher),
      query(property, { ...range, dimensions: ["query"], rowLimit: 500 }, fetcher),
      query(property, { ...range, dimensions: ["page"], rowLimit: 500 }, fetcher),
      query(property, { startDate: period.previousStartDate, endDate: period.previousEndDate, dimensions: ["page"], rowLimit: 500 }, fetcher),
    ]);
    const totals = totalsRows[0];
    const queries = toMetricRows(queryRows);
    const pages = toMetricRows(pageRows);
    const value: SearchConsoleOverview = {
      status: "ok",
      account,
      property,
      message: null,
      period: range,
      totals: totals
        ? {
            clicks: totals.clicks ?? 0,
            impressions: totals.impressions ?? 0,
            ctr: Math.round((totals.ctr ?? 0) * 10_000) / 10_000,
            position: Math.round((totals.position ?? 0) * 10) / 10,
          }
        : { clicks: 0, impressions: 0, ctr: 0, position: 0 },
      topQueries: queries.slice(0, 50),
      topPages: pages.slice(0, 25),
      opportunities: findOpportunities(queries),
      decliningPages: findDecliningPages(pages, toMetricRows(previousPageRows)),
    };
    overviewCache.set(cacheKey, { at: Date.now(), value });
    return value;
  } catch (error) {
    if (error instanceof GoogleNotConnectedError) {
      return emptyOverview("not_connected", "De verbinding met Google is verlopen. Verbind opnieuw met Google.");
    }
    logger.warn({ errorType: error instanceof Error ? error.message : typeof error }, "Search Console request failed");
    return emptyOverview(
      "error",
      error instanceof SearchConsoleError && error.status === 403
        ? "Google weigert de toegang tot deze website. Controleer of het verbonden account nog toegang heeft in Search Console."
        : "Search Console kon niet worden bereikt. Probeer het later opnieuw.",
    );
  }
}

/**
 * The partner's pages that Google already shows for searches about a topic
 * (last 90 days). Returns null when Search Console is not available for this
 * website, so callers can fall back to other sources.
 */
export async function searchConsolePagesForTopic(
  websiteUrl: string,
  subject: string,
  fetcher: Fetcher = fetch,
): Promise<{ property: string; pages: TopicPage[] } | null> {
  try {
    if (!googleConfig()) return null;
    const resolved = await resolveProperty(websiteUrl, fetcher);
    if (!resolved.ok) return null;
    const regex = topicQueryRegex(subject);
    if (!regex) return { property: resolved.property, pages: [] };
    const period = reportPeriod(90);
    const rows = await query(
      resolved.property,
      {
        startDate: period.startDate,
        endDate: period.endDate,
        dimensions: ["query", "page"],
        dimensionFilterGroups: [{ filters: [{ dimension: "query", operator: "includingRegex", expression: regex }] }],
        rowLimit: 1000,
      },
      fetcher,
    );
    return { property: resolved.property, pages: pagesForTopic(subject, rows) };
  } catch (error) {
    logger.warn({ errorType: error instanceof Error ? error.message : typeof error }, "Search Console topic lookup failed");
    return null;
  }
}

/** For tests and after (dis)connecting: forget cached data. */
export function clearSearchConsoleCache(): void {
  overviewCache.clear();
  pageMetricsCache.clear();
  sitesCache = null;
}

export interface QueryPageRow {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/**
 * Query + page rows (last 90 days) and clicks per page now and in the 90 days
 * before, for the topic wizard. Optionally limited to queries matching a
 * regex. Returns null when Search Console is not available for the website.
 */
export async function searchConsoleQueryData(
  websiteUrl: string,
  queryRegex: string | null,
  fetcher: Fetcher = fetch,
): Promise<{ property: string; rows: QueryPageRow[]; pagesNow: MetricRow[]; pagesBefore: MetricRow[] } | null> {
  try {
    if (!googleConfig()) return null;
    const resolved = await resolveProperty(websiteUrl, fetcher);
    if (!resolved.ok) return null;
    const period = reportPeriod(90);
    const filter = queryRegex
      ? { dimensionFilterGroups: [{ filters: [{ dimension: "query", operator: "includingRegex", expression: queryRegex }] }] }
      : {};
    const [rows, pagesNow, pagesBefore] = await Promise.all([
      query(resolved.property, { startDate: period.startDate, endDate: period.endDate, dimensions: ["query", "page"], rowLimit: 2000, ...filter }, fetcher),
      query(resolved.property, { startDate: period.startDate, endDate: period.endDate, dimensions: ["page"], rowLimit: 500 }, fetcher),
      query(resolved.property, { startDate: period.previousStartDate, endDate: period.previousEndDate, dimensions: ["page"], rowLimit: 500 }, fetcher),
    ]);
    return {
      property: resolved.property,
      rows: rows
        .filter((r) => r.keys?.[0] && r.keys?.[1])
        .map((r) => ({
          query: r.keys![0],
          page: r.keys![1],
          clicks: r.clicks ?? 0,
          impressions: r.impressions ?? 0,
          ctr: r.ctr ?? 0,
          position: Math.round((r.position ?? 0) * 10) / 10,
        })),
      pagesNow: toMetricRows(pagesNow),
      pagesBefore: toMetricRows(pagesBefore),
    };
  } catch (error) {
    logger.warn({ errorType: error instanceof Error ? error.message : typeof error }, "Search Console query data failed");
    return null;
  }
}

const pageMetricsCache = new Map<string, { at: number; rows: MetricRow[] | null }>();

/**
 * Clicks, impressions and position per page of a website (last 90 days),
 * cached for a few hours. Returns null when Search Console is not available.
 */
export async function searchConsolePageMetrics(websiteUrl: string, fetcher: Fetcher = fetch): Promise<MetricRow[] | null> {
  const cached = pageMetricsCache.get(websiteUrl);
  if (cached && Date.now() - cached.at < OVERVIEW_CACHE_MS) return cached.rows;
  try {
    if (!googleConfig()) return null;
    const resolved = await resolveProperty(websiteUrl, fetcher);
    if (!resolved.ok) return null;
    const period = reportPeriod(90);
    const rows = toMetricRows(
      await query(resolved.property, { startDate: period.startDate, endDate: period.endDate, dimensions: ["page"], rowLimit: 1000 }, fetcher),
    );
    pageMetricsCache.set(websiteUrl, { at: Date.now(), rows });
    return rows;
  } catch (error) {
    logger.warn({ errorType: error instanceof Error ? error.message : typeof error }, "Search Console page metrics failed");
    return null;
  }
}
