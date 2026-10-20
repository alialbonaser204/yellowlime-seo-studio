import { eq } from "drizzle-orm";
import { db, partnerProfilesTable, partnersTable } from "@yellowlime/db";
import { logger } from "../lib/logger";
import { defaultClaudeTextRunner, type ClaudeTextRunner } from "./claudeRunner";
import { searchConsoleQueryData, type QueryPageRow } from "./searchConsole";
import { findDecliningPages, topicQueryRegex } from "./searchConsoleData";
import { keywordMetrics, questionKeywords, relatedKeywords, safeSemrushError, type SemrushKeyword, type SemrushTransport } from "./semrush";
import {
  covering,
  GOALS,
  isUnsuitableKeyword,
  makeIdeasPrompt,
  parseIdeas,
  parseTrend,
  queryThemes,
  scoreCandidate,
  trendPeak,
  type Candidate,
  type GscData,
  type TopicGoal,
  type TopicIdea,
} from "./topicIdeasData";
import { listWebsiteArticles } from "./websiteScan";

/**
 * The topic wizard: collects Search Console and Semrush data for a partner,
 * turns it into scored keyword candidates and lets Claude pick and frame the
 * best topics. Collected data is cached for a few hours, so "more like this"
 * or "another direction" only costs a Claude call, not Semrush units.
 */

const CACHE_MS = 6 * 60 * 60_000;
const IDEA_COUNT = 6;
const MAX_CANDIDATES = 25;

interface Collected {
  at: number;
  candidates: Candidate[];
  notes: string[];
  usedSearchConsole: boolean;
  usedSemrush: boolean;
}
const cache = new Map<string, Collected>();

export interface TopicIdeasInput {
  goal: TopicGoal;
  theme?: string | null;
  exclude?: string[];
  like?: string | null;
  direction?: "specifieker" | "breder" | null;
}

export interface TopicIdeasResult {
  ideas: TopicIdea[];
  goal: TopicGoal;
  theme: string | null;
  usedSearchConsole: boolean;
  usedSemrush: boolean;
  candidatesConsidered: number;
  notes: string[];
}

export interface TopicIdeasDeps {
  runner?: ClaudeTextRunner;
  semrushTransport?: SemrushTransport;
  gsc?: typeof searchConsoleQueryData;
  now?: Date;
}

function profileOf(row: { approvedProfile: unknown; reviewProfile: unknown } | undefined) {
  const p = (row?.approvedProfile ?? row?.reviewProfile ?? null) as Record<string, unknown> | null;
  if (!p) return null;
  const list = (key: string) => (Array.isArray(p[key]) ? (p[key] as unknown[]).filter((v): v is string => typeof v === "string") : []);
  return {
    description: typeof p.companyDescription === "string" ? p.companyDescription : null,
    audience: list("targetAudience"),
    products: list("products"),
    services: list("services"),
    tone: list("toneOfVoice"),
  };
}

async function loadPartner(partnerId: number) {
  const [partner] = await db.select().from(partnersTable).where(eq(partnersTable.id, partnerId));
  if (!partner) return null;
  const [profileRow] = await db.select().from(partnerProfilesTable).where(eq(partnerProfilesTable.partnerId, partnerId));
  return { partner, profile: profileOf(profileRow) };
}

function semrushConfigured(deps: TopicIdeasDeps): boolean {
  return Boolean(deps.semrushTransport || process.env.SEMRUSH_API_KEY?.trim());
}

/** Themes to choose from (partner products/services and Search Console topics) and which sources are available. */
export async function topicThemes(partnerId: number, deps: TopicIdeasDeps = {}) {
  const loaded = await loadPartner(partnerId);
  if (!loaded) return null;
  const { partner, profile } = loaded;
  const [gsc, articles] = await Promise.all([
    (deps.gsc ?? searchConsoleQueryData)(partner.websiteUrl, null),
    listWebsiteArticles(partnerId),
  ]);
  const themes: Array<{ label: string; source: "profiel" | "search-console" }> = [];
  for (const label of [...(profile?.products ?? []), ...(profile?.services ?? [])].slice(0, 10)) {
    if (!themes.some((t) => t.label.toLowerCase() === label.toLowerCase())) themes.push({ label, source: "profiel" });
  }
  if (gsc) {
    const byQuery = new Map<string, number>();
    for (const row of gsc.rows) byQuery.set(row.query, (byQuery.get(row.query) ?? 0) + row.impressions);
    const brand = [partner.companyName, new URL(partner.websiteUrl).hostname.replace(/^www\./, "").split(".")[0]];
    for (const label of queryThemes([...byQuery.entries()].map(([query, impressions]) => ({ query, impressions })), brand)) {
      if (!themes.some((t) => t.label.toLowerCase().includes(label))) themes.push({ label, source: "search-console" });
    }
  }
  return {
    themes,
    available: {
      searchConsole: Boolean(gsc),
      semrush: semrushConfigured(deps),
      profile: Boolean(profile),
      websiteArticles: articles.length,
    },
  };
}

function aggregateQueries(rows: QueryPageRow[]): Map<string, GscData> {
  const acc = new Map<string, { clicks: number; impressions: number; weighted: number; page: string; pageImpressions: number }>();
  for (const row of rows) {
    const key = row.query.toLowerCase();
    const entry = acc.get(key) ?? { clicks: 0, impressions: 0, weighted: 0, page: row.page, pageImpressions: 0 };
    entry.clicks += row.clicks;
    entry.impressions += row.impressions;
    entry.weighted += row.position * row.impressions;
    if (row.impressions > entry.pageImpressions) {
      entry.page = row.page;
      entry.pageImpressions = row.impressions;
    }
    acc.set(key, entry);
  }
  const out = new Map<string, GscData>();
  for (const [query, e] of acc) {
    out.set(query, {
      clicks: e.clicks,
      impressions: e.impressions,
      ctr: e.impressions ? e.clicks / e.impressions : 0,
      position: e.impressions ? Math.round((e.weighted / e.impressions) * 10) / 10 : 0,
      page: e.page,
    });
  }
  return out;
}

async function collect(
  partner: { id: number; companyName: string; websiteUrl: string },
  profile: ReturnType<typeof profileOf>,
  goal: TopicGoal,
  theme: string | null,
  deps: TopicIdeasDeps,
): Promise<Collected> {
  const notes: string[] = [];
  const now = deps.now ?? new Date();
  const articles = await listWebsiteArticles(partner.id);
  const regex = theme ? topicQueryRegex(theme) : null;
  const gsc = await (deps.gsc ?? searchConsoleQueryData)(partner.websiteUrl, regex);
  if (!gsc) notes.push("Search Console is niet gekoppeld voor deze website; ideeën zijn alleen op Semrush gebaseerd.");
  const gscByQuery = gsc ? aggregateQueries(gsc.rows) : new Map<string, GscData>();

  // 1. Keywords to consider, depending on the goal.
  const pool = new Map<string, { sources: Set<string>; declining?: Candidate["declining"] }>();
  const add = (keyword: string, source: string, declining?: Candidate["declining"]) => {
    const key = keyword.trim().toLowerCase();
    if (key.length < 3) return;
    const entry = pool.get(key) ?? { sources: new Set<string>() };
    entry.sources.add(source);
    if (declining) entry.declining = declining;
    pool.set(key, entry);
  };
  const byImpressions = [...gscByQuery.entries()].sort((a, b) => b[1].impressions - a[1].impressions);
  if (goal === "kansen") {
    for (const [query, d] of byImpressions) if (d.position >= 4 && d.position <= 20 && d.impressions >= 10) add(query, "Search Console");
  } else if (goal === "opfrissen" && gsc) {
    for (const page of findDecliningPages(gsc.pagesNow, gsc.pagesBefore, 10)) {
      const top = gsc.rows.filter((r) => r.page === page.page).sort((a, b) => b.impressions - a.impressions).slice(0, 2);
      for (const row of top) add(row.query, "Search Console", { page: page.page, clicks: page.clicks, previousClicks: page.previousClicks });
    }
  } else {
    for (const [query] of byImpressions.slice(0, 12)) add(query, "Search Console");
  }

  // 2. Semrush: related keywords and questions around the theme (not needed for the Search Console goals).
  const semrush = new Map<string, SemrushKeyword>();
  let usedSemrush = false;
  if (semrushConfigured(deps)) {
    try {
      if (goal === "verkeer" || goal === "product" || goal === "seizoen") {
        const seed = theme ?? profile?.products[0] ?? profile?.services[0] ?? null;
        if (seed) {
          const [related, questions] = await Promise.all([
            relatedKeywords(seed, 12, deps.semrushTransport),
            questionKeywords(seed, 8, deps.semrushTransport),
          ]);
          for (const k of related) { semrush.set(k.keyword.toLowerCase(), k); add(k.keyword, "Semrush (gerelateerd)"); }
          for (const k of questions) { semrush.set(k.keyword.toLowerCase(), k); add(k.keyword, "Semrush (vraag)"); }
          usedSemrush = true;
        } else {
          notes.push("Kies een thema, of vul het partnerprofiel in, zodat Limey weet waar hij in Semrush moet zoeken.");
        }
      }
      const missing = [...pool.keys()].filter((k) => !semrush.has(k)).slice(0, 25);
      if (missing.length) {
        for (const k of await keywordMetrics(missing, deps.semrushTransport)) semrush.set(k.keyword.toLowerCase(), k);
        usedSemrush = true;
      }
    } catch (error) {
      notes.push(`Semrush was niet beschikbaar (${safeSemrushError(error).message}); ideeën zijn alleen op Search Console gebaseerd.`);
    }
  } else {
    notes.push("Semrush is niet ingesteld; zoekvolumes ontbreken.");
  }

  // 3. Candidates with all data, scored per goal. Searches for the partner's own
  // name, or navigation-only searches (a client, a venue), are left out.
  let host = "";
  try { host = new URL(partner.websiteUrl).hostname.replace(/^www\./, "").split(".")[0]; } catch { /* ignore */ }
  const brandWords = [partner.companyName, host].filter(Boolean);
  const candidates: Candidate[] = [...pool.entries()].map(([keyword, entry]) => {
    const s = semrush.get(keyword);
    const trend = parseTrend(s?.trend);
    const base = {
      keyword,
      sources: [...entry.sources, ...(s && !entry.sources.has("Semrush (gerelateerd)") && !entry.sources.has("Semrush (vraag)") ? ["Semrush"] : [])],
      semrush: s ? { volume: s.searchVolume, difficulty: s.keywordDifficulty, intent: s.searchIntent, trend } : null,
      gsc: gscByQuery.get(keyword) ?? null,
      declining: entry.declining ?? null,
      covered: covering(keyword, articles),
      peak: trendPeak(trend, now),
    };
    return { ...base, id: "", score: scoreCandidate(base, goal) };
  })
    .filter((c) => c.semrush || c.gsc)
    .filter((c) => !isUnsuitableKeyword(c.keyword, brandWords, c.semrush?.intent))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES)
    .map((c, i) => ({ ...c, id: `k${i + 1}` }));

  if (goal === "seizoen" && !candidates.some((c) => c.peak && c.peak.monthsUntil >= 1 && c.peak.monthsUntil <= 3)) {
    notes.push("Voor dit thema vond Limey geen duidelijke seizoenspiek in de komende maanden.");
  }
  return { at: Date.now(), candidates, notes, usedSearchConsole: Boolean(gsc), usedSemrush };
}

export async function topicIdeas(partnerId: number, input: TopicIdeasInput, deps: TopicIdeasDeps = {}): Promise<TopicIdeasResult | null> {
  const loaded = await loadPartner(partnerId);
  if (!loaded) return null;
  const { partner, profile } = loaded;
  const theme = input.theme?.trim() || null;
  const key = `${partner.id}|${partner.websiteUrl}|${input.goal}|${(theme ?? "").toLowerCase()}`;
  let collected = cache.get(key);
  if (!collected || Date.now() - collected.at > CACHE_MS) {
    collected = await collect(partner, profile, input.goal, theme, deps);
    if (collected.candidates.length) cache.set(key, collected);
  }
  const exclude = (input.exclude ?? []).map((e) => e.trim()).filter(Boolean).slice(0, 40);
  const excluded = new Set(exclude.map((e) => e.toLowerCase()));
  const candidates = collected.candidates.filter((c) => !excluded.has(c.keyword));
  const base = { goal: input.goal, theme, usedSearchConsole: collected.usedSearchConsole, usedSemrush: collected.usedSemrush, candidatesConsidered: candidates.length };
  if (candidates.length === 0) {
    return {
      ...base,
      ideas: [],
      notes: [...collected.notes, `Geen bruikbare zoekwoorden gevonden voor "${GOALS[input.goal].label}"${theme ? ` binnen het thema ${theme}` : ""}. Probeer een ander doel of thema.`],
    };
  }
  const articles = await listWebsiteArticles(partner.id);
  const knownUrls = new Set<string>([
    ...articles.map((a) => a.url),
    ...candidates.flatMap((c) => [c.gsc?.page, c.declining?.page, c.covered?.url].filter((u): u is string => Boolean(u))),
  ]);
  // Choosing between many candidates can take Claude a while before the first
  // token, so the usual 60-second silence limit is raised for this call.
  const runner = deps.runner ?? ((text: string, timeoutMs: number) => defaultClaudeTextRunner(text, timeoutMs, 170_000));
  const raw = await runner(
    makeIdeasPrompt({
      companyName: partner.companyName,
      goal: input.goal,
      theme,
      profile,
      candidates,
      articles,
      exclude,
      like: input.like?.trim() || null,
      direction: input.direction ?? null,
      count: IDEA_COUNT,
    }),
    180_000,
  );
  let ideas: TopicIdea[];
  try {
    ideas = parseIdeas(raw, candidates, knownUrls, IDEA_COUNT, articles.length > 0);
  } catch (error) {
    logger.warn({ rawLength: raw.length, head: raw.slice(0, 160), tail: raw.slice(-160) }, "Topic ideas: Claude answer could not be read");
    throw error;
  }
  logger.info({ partnerId, goal: input.goal, candidates: candidates.length, ideas: ideas.length }, "Topic ideas generated");
  return { ...base, ideas, notes: collected.notes };
}

/** For tests. */
export function clearTopicIdeasCache(): void {
  cache.clear();
}
