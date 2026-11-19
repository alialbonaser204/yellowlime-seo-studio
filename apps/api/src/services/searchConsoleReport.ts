/**
 * Turns raw Search Console rows into the report for the Search Console page:
 * totals with a comparison, a daily trend, devices, top searches and pages,
 * opportunities, searches with a low click rate, and short observations.
 *
 * The observations are fixed rules on the numbers (no AI): only figures from
 * Search Console are used.
 */
import { isBranded } from "./domainAnalysis";
import { findDecliningPages, findOpportunities, toMetricRows, type DecliningPage, type MetricRow, type RawRow } from "./searchConsoleData";

export interface Totals { clicks: number; impressions: number; ctr: number; position: number }
export interface DailyPoint extends Totals { date: string }
export interface DeviceRow extends Totals { device: "desktop" | "mobiel" | "tablet" | string }
export interface LowCtrRow extends MetricRow { groupCtr: number }

export interface SearchConsoleReport {
  totals: Totals;
  previousTotals: Totals;
  daily: DailyPoint[];
  devices: DeviceRow[];
  topQueries: MetricRow[];
  topPages: MetricRow[];
  opportunities: MetricRow[];
  lowCtr: LowCtrRow[];
  decliningPages: DecliningPage[];
  brand: { clicks: number; share: number } | null;
  insights: { tone: "goed" | "let-op" | "kans"; text: string }[];
}

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

export function toTotals(row: RawRow | undefined): Totals {
  return {
    clicks: row?.clicks ?? 0,
    impressions: row?.impressions ?? 0,
    ctr: round(row?.ctr ?? 0, 4),
    position: round(row?.position ?? 0, 1),
  };
}

const DEVICE_NAMES: Record<string, string> = { DESKTOP: "desktop", MOBILE: "mobiel", TABLET: "tablet" };

function positionGroup(position: number): string {
  if (position < 1.5) return "1";
  if (position < 3.5) return "2-3";
  if (position < 5.5) return "4-5";
  return "6-10";
}

/**
 * Searches in the top 10 with many impressions whose click rate is less than
 * half of this website's own average for the same position group.
 */
export function findLowCtr(queries: MetricRow[], limit = 10): LowCtrRow[] {
  const top10 = queries.filter((q) => q.position <= 10 && q.impressions > 0);
  const groups = new Map<string, { clicks: number; impressions: number }>();
  for (const q of top10) {
    const g = groups.get(positionGroup(q.position)) ?? { clicks: 0, impressions: 0 };
    g.clicks += q.clicks;
    g.impressions += q.impressions;
    groups.set(positionGroup(q.position), g);
  }
  return top10
    .map((q) => {
      const g = groups.get(positionGroup(q.position))!;
      return { ...q, groupCtr: round(g.impressions ? g.clicks / g.impressions : 0, 4) };
    })
    .filter((q) => q.impressions >= 100 && q.groupCtr > 0 && q.ctr < q.groupCtr / 2)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit);
}

const nf = (n: number) => Math.round(n).toLocaleString("nl-NL");
const pct = (n: number) => `${round(n * 100, 1).toLocaleString("nl-NL")}%`;

export function buildSearchConsoleReport(input: {
  domain: string;
  days: number;
  totals: RawRow | undefined;
  previousTotals: RawRow | undefined;
  daily: RawRow[];
  devices: RawRow[];
  queries: RawRow[];
  pages: RawRow[];
  previousPages: RawRow[];
}): SearchConsoleReport {
  const totals = toTotals(input.totals);
  const previousTotals = toTotals(input.previousTotals);
  const queries = toMetricRows(input.queries);
  const pages = toMetricRows(input.pages);
  const daily = input.daily
    .filter((r) => r.keys?.[0])
    .map((r) => ({ date: r.keys![0], ...toTotals(r) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const devices = input.devices
    .filter((r) => r.keys?.[0])
    .map((r) => ({ device: DEVICE_NAMES[r.keys![0]] ?? r.keys![0].toLowerCase(), ...toTotals(r) }))
    .sort((a, b) => b.clicks - a.clicks);

  const queryClicks = queries.reduce((s, q) => s + q.clicks, 0);
  const brandClicks = queries.filter((q) => isBranded(q.key, input.domain)).reduce((s, q) => s + q.clicks, 0);
  const brand = queryClicks > 0 ? { clicks: brandClicks, share: round(brandClicks / queryClicks, 3) } : null;

  const opportunities = findOpportunities(queries);
  const lowCtr = findLowCtr(queries);
  const decliningPages = findDecliningPages(pages, toMetricRows(input.previousPages));

  const insights: SearchConsoleReport["insights"] = [];
  const period = `de afgelopen ${input.days} dagen`;
  if (previousTotals.clicks > 0) {
    const change = Math.round(((totals.clicks - previousTotals.clicks) / previousTotals.clicks) * 100);
    if (change <= -10) insights.push({ tone: "let-op", text: `De website kreeg ${period} ${nf(totals.clicks)} klikken uit Google, ${Math.abs(change)}% minder dan de periode daarvoor (${nf(previousTotals.clicks)}).` });
    else if (change >= 10) insights.push({ tone: "goed", text: `De website kreeg ${period} ${nf(totals.clicks)} klikken uit Google, ${change}% meer dan de periode daarvoor (${nf(previousTotals.clicks)}).` });
    else insights.push({ tone: "goed", text: `Het aantal klikken uit Google is stabiel: ${nf(totals.clicks)} ${period}, tegen ${nf(previousTotals.clicks)} de periode daarvoor.` });
  }
  if (previousTotals.impressions > 0 && totals.impressions > previousTotals.impressions * 1.1 && totals.clicks <= previousTotals.clicks) {
    insights.push({ tone: "kans", text: `De website wordt vaker getoond (${nf(totals.impressions)} keer, was ${nf(previousTotals.impressions)}), maar dat levert niet meer klikken op. Betere titels en beschrijvingen kunnen helpen.` });
  }
  if (brand && brand.share >= 0.5) {
    insights.push({ tone: "let-op", text: `${Math.round(brand.share * 100)}% van de klikken komt van zoekopdrachten op de bedrijfsnaam. Mensen die het bedrijf nog niet kennen, vinden de website weinig.` });
  }
  if (opportunities.length > 0) {
    const best = opportunities[0];
    insights.push({ tone: "kans", text: `${opportunities.length} zoekopdrachten staan op positie 4–20. De grootste: "${best.key}" (positie ${round(best.position, 1).toLocaleString("nl-NL")}, ${nf(best.impressions)} vertoningen, ${nf(best.clicks)} klikken).` });
  }
  if (lowCtr.length > 0) {
    const worst = lowCtr[0];
    insights.push({ tone: "kans", text: `"${worst.key}" staat op positie ${round(worst.position, 1).toLocaleString("nl-NL")} en werd ${nf(worst.impressions)} keer getoond, maar slechts ${pct(worst.ctr)} klikte (gemiddeld op die positie: ${pct(worst.groupCtr)}). Een pakkendere titel kan meer klikken opleveren.` });
  }
  const mobile = devices.find((d) => d.device === "mobiel");
  if (mobile && totals.clicks > 0 && mobile.clicks / totals.clicks >= 0.6) {
    insights.push({ tone: "goed", text: `${Math.round((mobile.clicks / totals.clicks) * 100)}% van de klikken komt van mobiele telefoons. Controleer artikelen dus vooral op mobiel.` });
  }
  if (decliningPages[0] && decliningPages[0].change <= -10) {
    const d = decliningPages[0];
    insights.push({ tone: "let-op", text: `De pagina ${d.page.replace(/^https?:\/\/(www\.)?/, "")} verloor de meeste klikken: ${nf(d.clicks)}, was ${nf(d.previousClicks)}.` });
  }

  return {
    totals,
    previousTotals,
    daily,
    devices,
    topQueries: queries.slice(0, 25),
    topPages: pages.slice(0, 15),
    opportunities,
    lowCtr,
    decliningPages,
    brand,
    insights,
  };
}
