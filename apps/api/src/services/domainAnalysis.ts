/**
 * Semrush analysis of a partner's website: how visible it is in Google,
 * how that changes, which keywords and pages bring visitors, where the
 * quick wins are and who the competitors are.
 *
 * All numbers come straight from Semrush. The "insights" are fixed rules on
 * those numbers (no AI), so nothing is invented.
 */

export const ANALYSIS_DATABASE = "nl";

export interface DomainOverview {
  rank: number | null;
  keywords: number;
  traffic: number;
  trafficValue: number;
  /** Number of keywords per position group. */
  positions: { top3: number; top10: number; top20: number; top100: number };
}

export interface HistoryPoint {
  /** YYYY-MM */
  month: string;
  keywords: number;
  traffic: number;
}

export interface RankingKeyword {
  keyword: string;
  position: number;
  previousPosition: number | null;
  volume: number;
  url: string;
  trafficShare: number;
  difficulty: number | null;
  intent: string | null;
  branded: boolean;
}

export interface Opportunity {
  keyword: string;
  position: number;
  volume: number;
  url: string;
  difficulty: number | null;
}

export interface TopPage {
  url: string;
  keywords: number;
  traffic: number;
  trafficShare: number;
}

export interface Competitor {
  domain: string;
  relevance: number;
  commonKeywords: number;
  keywords: number;
  traffic: number;
}

export interface Insight {
  tone: "goed" | "let-op" | "kans";
  text: string;
}

export interface DomainAnalysis {
  domain: string;
  database: string;
  overview: DomainOverview;
  history: HistoryPoint[];
  keywords: RankingKeyword[];
  opportunities: Opportunity[];
  pages: TopPage[];
  competitors: Competitor[];
  insights: Insight[];
  /** Semrush units this analysis cost (estimate from the row counts). */
  unitsEstimate: number;
}

export type ReportRunner = (report: string, params: Record<string, unknown>) => Promise<string[][]>;

const num = (value: string | undefined): number => {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (value: string | undefined): number | null => {
  if (value === undefined || value.trim() === "") return null;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const INTENTS: Record<string, string> = { "0": "commercieel", "1": "informatief", "2": "navigatie", "3": "transactie" };

/** "https://www.warmtebouw.nl/x" → "warmtebouw.nl" */
export function rootDomain(websiteUrl: string): string {
  const host = new URL(/^https?:\/\//i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`).hostname.toLowerCase();
  return host.replace(/^www\./, "");
}

/** The brand part of a domain: "warmtebouw.nl" → "warmtebouw". */
function brandOf(domain: string): string {
  return domain.split(".")[0].replace(/-/g, " ");
}

export function isBranded(keyword: string, domain: string): boolean {
  const brand = brandOf(domain).toLowerCase();
  const k = keyword.toLowerCase();
  return brand.length >= 3 && (k.includes(brand) || k.replace(/\s+/g, "").includes(brand.replace(/\s+/g, "")));
}

export function parseOverview(rows: string[][]): DomainOverview {
  const r = rows[0] ?? [];
  // Columns as requested in OVERVIEW_COLUMNS.
  const groups = r.slice(5).map(num);
  return {
    rank: numOrNull(r[1]) || null,
    keywords: num(r[2]),
    traffic: num(r[3]),
    trafficValue: num(r[4]),
    positions: {
      top3: groups[0] ?? 0,
      top10: groups[1] ?? 0,
      top20: groups[2] ?? 0,
      top100: groups.slice(3).reduce((a, b) => a + b, 0),
    },
  };
}

export function parseHistory(rows: string[][]): HistoryPoint[] {
  return rows
    .map((r) => ({ month: `${r[0].slice(0, 4)}-${r[0].slice(4, 6)}`, keywords: num(r[1]), traffic: num(r[2]) }))
    .filter((p) => /^\d{4}-\d{2}$/.test(p.month))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export function parseKeywords(rows: string[][], domain: string): RankingKeyword[] {
  return rows.map((r) => ({
    keyword: r[0],
    position: num(r[1]),
    previousPosition: numOrNull(r[2]) || null,
    volume: num(r[3]),
    url: r[4] ?? "",
    trafficShare: num(r[5]),
    difficulty: numOrNull(r[6]),
    intent: (r[7] ?? "").split(",").map((c) => INTENTS[c.trim()]).filter(Boolean)[0] ?? null,
    branded: isBranded(r[0], domain),
  }));
}

export function parseOpportunities(rows: string[][]): Opportunity[] {
  return rows.map((r) => ({ keyword: r[0], position: num(r[1]), volume: num(r[2]), url: r[3] ?? "", difficulty: numOrNull(r[4]) }));
}

export function parsePages(rows: string[][]): TopPage[] {
  // http:// and https:// versions of one page are merged.
  const merged = new Map<string, TopPage>();
  for (const r of rows) {
    const url = (r[0] ?? "").replace(/^http:\/\//, "https://");
    const prev = merged.get(url);
    const page = { url, keywords: num(r[1]), traffic: num(r[2]), trafficShare: num(r[3]) };
    merged.set(url, prev
      ? { url, keywords: prev.keywords + page.keywords, traffic: prev.traffic + page.traffic, trafficShare: Math.round((prev.trafficShare + page.trafficShare) * 100) / 100 }
      : page);
  }
  return [...merged.values()].sort((a, b) => b.traffic - a.traffic);
}

export function parseCompetitors(rows: string[][]): Competitor[] {
  return rows.map((r) => ({ domain: r[0], relevance: num(r[1]), commonKeywords: num(r[2]), keywords: num(r[3]), traffic: num(r[4]) }));
}

const fmt = (n: number) => Math.round(n).toLocaleString("nl-NL");

/** Fixed rules that turn the numbers into short, checkable observations. */
export function buildInsights(a: Omit<DomainAnalysis, "insights" | "unitsEstimate">): Insight[] {
  const out: Insight[] = [];
  const { overview, history, keywords, opportunities, pages, competitors } = a;

  // Trend: last month vs. three months earlier.
  if (history.length >= 4) {
    const last = history[history.length - 1];
    const before = history[history.length - 4];
    if (before.traffic > 0) {
      const change = Math.round(((last.traffic - before.traffic) / before.traffic) * 100);
      if (change <= -15) out.push({ tone: "let-op", text: `Het geschatte verkeer uit Google daalde in drie maanden met ${Math.abs(change)}% (van ${fmt(before.traffic)} naar ${fmt(last.traffic)} per maand).` });
      else if (change >= 15) out.push({ tone: "goed", text: `Het geschatte verkeer uit Google steeg in drie maanden met ${change}% (van ${fmt(before.traffic)} naar ${fmt(last.traffic)} per maand).` });
      else out.push({ tone: "goed", text: `Het verkeer uit Google is de afgelopen drie maanden stabiel (${fmt(last.traffic)} bezoekers per maand).` });
    }
  }

  // Brand dependency.
  const brandShare = keywords.filter((k) => k.branded).reduce((s, k) => s + k.trafficShare, 0);
  if (brandShare >= 50) {
    out.push({ tone: "let-op", text: `${Math.round(brandShare)}% van het verkeer komt van zoekopdrachten op de bedrijfsnaam. Mensen die het bedrijf nog niet kennen, vinden de website weinig: daar liggen kansen voor content.` });
  }

  // Quick wins: positions 11–20.
  if (opportunities.length > 0) {
    const volume = opportunities.reduce((s, o) => s + o.volume, 0);
    const best = opportunities[0];
    out.push({ tone: "kans", text: `${opportunities.length} zoekwoorden staan op pagina 2 van Google (positie 11–20), samen goed voor ${fmt(volume)} zoekopdrachten per maand. De grootste: "${best.keyword}" op positie ${best.position} (${fmt(best.volume)} per maand).` });
  }

  // Top-3 share.
  if (overview.keywords > 0) {
    const share = Math.round((overview.positions.top3 / overview.keywords) * 100);
    if (share < 10) out.push({ tone: "kans", text: `Maar ${overview.positions.top3} van de ${fmt(overview.keywords)} zoekwoorden (${share}%) staan in de top 3, waar de meeste klikken naartoe gaan.` });
  }

  // Dependency on one page.
  if (pages[0] && pages[0].trafficShare >= 60) {
    out.push({ tone: "let-op", text: `${Math.round(pages[0].trafficShare)}% van het verkeer gaat naar één pagina (${pages[0].url.replace(/^https?:\/\/(www\.)?/, "")}). Andere pagina's trekken nog weinig bezoekers.` });
  }

  // Strongest competitor.
  const rival = [...competitors].sort((x, y) => y.traffic - x.traffic)[0];
  if (rival && rival.traffic > overview.traffic) {
    out.push({ tone: "let-op", text: `Concurrent ${rival.domain} heeft ongeveer ${fmt(rival.traffic)} bezoekers per maand uit Google, tegen ${fmt(overview.traffic)} voor ${a.domain}. Ze delen ${fmt(rival.commonKeywords)} zoekwoorden.` });
  }
  return out;
}

const OVERVIEW_COLUMNS = [
  "domain", "rank", "organic_keywords", "organic_traffic", "organic_traffic_cost",
  "positions_1_3", "positions_4_10", "positions_11_20", "positions_21_30", "positions_31_40",
  "positions_41_50", "positions_51_60", "positions_61_70", "positions_71_80", "positions_81_90", "positions_91_100",
];

/** Runs the six Semrush reports (about 800 units) and combines them. */
export async function analyseDomain(domain: string, run: ReportRunner): Promise<DomainAnalysis> {
  const base = { target: domain, database: ANALYSIS_DATABASE };
  const [overviewRows, historyRows, keywordRows, opportunityRows, pageRows, competitorRows] = await Promise.all([
    run("domain_rank", { ...base, export_columns: OVERVIEW_COLUMNS }),
    run("resource_rank_history", { ...base, display_limit: 12, display_sort: "date_desc", export_columns: ["date", "organic_keywords", "organic_traffic"] }),
    run("resource_organic", { ...base, display_limit: 20, display_sort: "traffic_desc", export_columns: ["keyword", "position", "previous_position", "volume", "url", "traffic_share", "keyword_difficulty", "intent"] }),
    run("resource_organic", {
      ...base,
      display_limit: 10,
      display_sort: "volume_desc",
      display_filter: [
        { field: "position", operation: "greater_than", sign: "+", value: 10 },
        { field: "position", operation: "less_than", sign: "+", value: 21 },
      ],
      export_columns: ["keyword", "position", "volume", "url", "keyword_difficulty"],
    }).catch(() => []),
    run("resource_organic_unique", { ...base, display_limit: 10, display_sort: "traffic_desc", export_columns: ["url", "keywords_count", "traffic", "traffic_share"] }).catch(() => []),
    run("domain_organic_organic", { ...base, display_limit: 6, export_columns: ["domain", "competition_level", "common_keywords", "organic_keywords", "organic_traffic"] }).catch(() => []),
  ]);
  const partial = {
    domain,
    database: ANALYSIS_DATABASE,
    overview: parseOverview(overviewRows),
    history: parseHistory(historyRows),
    keywords: parseKeywords(keywordRows, domain),
    opportunities: parseOpportunities(opportunityRows),
    pages: parsePages(pageRows),
    competitors: parseCompetitors(competitorRows).filter((c) => c.domain && c.domain !== domain),
  };
  const unitsEstimate = 10 * (overviewRows.length + historyRows.length + keywordRows.length + opportunityRows.length + pageRows.length) + 40 * competitorRows.length;
  return { ...partial, insights: buildInsights(partial), unitsEstimate };
}
