import { distinctOverlap, lexicalScore, topicTokens } from "./topicMatching";

/**
 * Pure helpers for the topic wizard: turning Semrush and Search Console data
 * into scored keyword candidates, the Claude prompt, and checking Claude's
 * answer. Every number shown to the user comes from the data, never from
 * Claude; reasons that mention numbers that are not in the data are dropped.
 */

export type TopicGoal = "verkeer" | "kansen" | "opfrissen" | "product" | "seizoen";

export const GOALS: Record<TopicGoal, { label: string; brief: string }> = {
  verkeer: {
    label: "Meer bezoekers met nieuwe onderwerpen",
    brief: "Nieuwe artikelen over onderwerpen waar veel op gezocht wordt en die nog niet op de website staan.",
  },
  kansen: {
    label: "Bijna-toppers naar de top",
    brief: "Zoekwoorden waarop de website al op positie 4 tot 20 staat. Een (beter) artikel hierover levert het snelst extra bezoekers op.",
  },
  opfrissen: {
    label: "Dalende pagina's opfrissen",
    brief: "Bestaande pagina's die klikken verliezen. Een update met de zoekwoorden waarop ze gevonden worden.",
  },
  product: {
    label: "Een product of dienst onder de aandacht",
    brief: "Informatieve artikelen rond een product of dienst van de partner, die lezers richting die pagina helpen.",
  },
  seizoen: {
    label: "Inspelen op het seizoen",
    brief: "Onderwerpen waarvan de zoekvraag in de komende 1 tot 3 maanden piekt, zodat het artikel op tijd online staat.",
  },
};

export interface SemrushData {
  volume: number | null;
  difficulty: number | null;
  intent: string | null;
  trend: number[] | null;
}

export interface GscData {
  position: number;
  impressions: number;
  clicks: number;
  ctr: number;
  page: string | null;
}

export interface Candidate {
  id: string;
  keyword: string;
  sources: string[];
  semrush: SemrushData | null;
  gsc: GscData | null;
  declining: { page: string; clicks: number; previousClicks: number } | null;
  covered: { url: string; title: string } | null;
  peak: { month: string; monthsUntil: number } | null;
  score: number;
}

const MONTHS = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];

const INTENTS: Record<string, string> = {
  "0": "commercieel",
  "1": "informatief",
  "2": "navigatie",
  "3": "transactioneel",
  commercial: "commercieel",
  informational: "informatief",
  navigational: "navigatie",
  transactional: "transactioneel",
};

export function intentLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const labels = raw
    .split(/[,;\s]+/)
    .map((part) => INTENTS[part.trim().toLowerCase()])
    .filter(Boolean);
  return labels.length ? [...new Set(labels)].join(" / ") : null;
}

export function parseTrend(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  const values = raw.split(",").map((v) => Number(v.trim()));
  return values.length >= 6 && values.every((v) => Number.isFinite(v)) ? values : null;
}

/**
 * Semrush trends are 12 monthly values ending with last month. Returns the
 * month in which interest peaks and how many months from now that is.
 */
export function trendPeak(trend: number[] | null, now = new Date()): { month: string; monthsUntil: number } | null {
  if (!trend || trend.length < 12) return null;
  const last12 = trend.slice(-12);
  const max = Math.max(...last12);
  const min = Math.min(...last12);
  if (max <= 0 || max - min < 0.25) return null; // no clear season
  const index = last12.indexOf(max);
  const month = (now.getMonth() + index) % 12; // index 11 = last month
  const monthsUntil = (month - now.getMonth() + 12) % 12;
  return { month: MONTHS[month], monthsUntil };
}

export function covering(keyword: string, articles: Array<{ url: string; title: string; headings: string[]; description: string | null }>) {
  let best: { url: string; title: string; score: number } | null = null;
  const needed = Math.min(2, topicTokens(keyword).length);
  for (const article of articles) {
    const score = lexicalScore(keyword, article);
    if (score >= 5 && distinctOverlap(keyword, article) >= needed && (!best || score > best.score)) {
      best = { url: article.url, title: article.title, score };
    }
  }
  return best ? { url: best.url, title: best.title } : null;
}

/** Opportunity score 0–100 from the data, weighted per goal. */
export function scoreCandidate(c: Omit<Candidate, "score" | "id">, goal: TopicGoal): number {
  const volume = c.semrush?.volume ?? null;
  const difficulty = c.semrush?.difficulty ?? null;
  let score = 0;
  // Search demand: 10 → 10, 100 → 20, 1.000 → 30, 10.000 → 40
  if (volume !== null) score += Math.min(40, 10 * Math.log10(volume + 1));
  else if (c.gsc) score += Math.min(30, 8 * Math.log10(c.gsc.impressions + 1));
  // How hard it is to rank
  score += difficulty === null ? 10 : Math.max(0, (100 - difficulty) / 4);
  // Search Console: already visible just below the top
  if (c.gsc) {
    const p = c.gsc.position;
    score += p >= 4 && p <= 10 ? 25 : p > 10 && p <= 20 ? 18 : p > 20 && p <= 30 ? 8 : p < 4 ? 4 : 0;
  }
  if (goal === "opfrissen" && c.declining) score += Math.min(25, Math.abs(c.declining.clicks - c.declining.previousClicks) / 2);
  if (goal === "seizoen" && c.peak) score += c.peak.monthsUntil >= 1 && c.peak.monthsUntil <= 3 ? 20 : -10;
  if (goal === "verkeer" && c.covered) score -= 25;
  if (goal === "kansen" && !c.gsc) score -= 20;
  return Math.max(0, Math.min(100, Math.round(score)));
}

const nf = new Intl.NumberFormat("nl-NL");

function pathOf(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}

/** Short, factual evidence lines for a candidate (shown to the user and to Claude). */
export function evidenceLines(c: Candidate): string[] {
  const lines: string[] = [];
  if (c.semrush?.volume !== null && c.semrush?.volume !== undefined) {
    lines.push(`${nf.format(c.semrush.volume)} zoekopdrachten per maand (Semrush)`);
  }
  if (c.semrush?.difficulty !== null && c.semrush?.difficulty !== undefined) {
    const d = Math.round(c.semrush.difficulty);
    lines.push(`Moeilijkheid ${d}/100 (${d < 30 ? "makkelijk" : d < 50 ? "haalbaar" : d < 70 ? "lastig" : "zeer lastig"})`);
  }
  if (c.semrush?.intent) lines.push(`Zoekintentie: ${intentLabel(c.semrush.intent) ?? c.semrush.intent}`);
  if (c.gsc) {
    lines.push(
      `Nu positie ${c.gsc.position.toLocaleString("nl-NL", { maximumFractionDigits: 1 })} in Google, ${nf.format(c.gsc.impressions)} vertoningen en ${nf.format(c.gsc.clicks)} klikken in 90 dagen (Search Console)` +
        (c.gsc.page ? ` met ${pathOf(c.gsc.page)}` : ""),
    );
  }
  if (c.declining) {
    lines.push(`${pathOf(c.declining.page)} ging van ${nf.format(c.declining.previousClicks)} naar ${nf.format(c.declining.clicks)} klikken (Search Console)`);
  }
  if (c.peak) {
    lines.push(c.peak.monthsUntil === 0 ? `Zoekvraag piekt nu, in ${c.peak.month}` : `Zoekvraag piekt in ${c.peak.month} (over ${c.peak.monthsUntil} ${c.peak.monthsUntil === 1 ? "maand" : "maanden"})`);
  }
  lines.push(c.covered ? `Lijkt op bestaand artikel "${c.covered.title}"` : "Nog niet behandeld op de website");
  return lines;
}

// ---------------------------------------------------------------- the prompt

export function makeIdeasPrompt(input: {
  companyName: string;
  goal: TopicGoal;
  theme: string | null;
  profile: { description: string | null; audience: string[]; products: string[]; services: string[]; tone: string[] } | null;
  candidates: Candidate[];
  articles: Array<{ title: string; url: string }>;
  exclude: string[];
  like: string | null;
  direction: "specifieker" | "breder" | null;
  count: number;
}): string {
  const g = GOALS[input.goal];
  const lines = input.candidates.map((c) => `[${c.id}] "${c.keyword}" — score ${c.score} — ${evidenceLines(c).join("; ")}`);
  return [
    "Je bent een ervaren SEO-contentstrateeg bij een Nederlands bureau. Je helpt een collega een onderwerp kiezen voor een artikel voor een partner.",
    `Partner: ${input.companyName}.`,
    input.profile
      ? [
          input.profile.description ? `Omschrijving: ${input.profile.description}` : "",
          input.profile.audience.length ? `Doelgroep: ${input.profile.audience.join("; ")}` : "",
          input.profile.products.length ? `Producten: ${input.profile.products.join(", ")}` : "",
          input.profile.services.length ? `Diensten: ${input.profile.services.join(", ")}` : "",
        ].filter(Boolean).join("\n")
      : "Er is nog geen partnerprofiel.",
    `Doel van de collega: ${g.label}. ${g.brief}`,
    input.theme ? `Thema: ${input.theme}.` : "Thema: vrij.",
    input.like ? `De collega vond dit idee goed; geef ideeën in dezelfde richting: "${input.like}".` : "",
    input.direction === "specifieker" ? "Maak de ideeën specifieker: long-tail zoekwoorden, concrete vragen, een duidelijke situatie of doelgroep." : "",
    input.direction === "breder" ? "Maak de ideeën breder: overzichtsartikelen en gidsen rond grotere zoekwoorden." : "",
    input.exclude.length ? `Deze ideeën zijn al getoond; kies andere zoekwoorden en invalshoeken: ${input.exclude.map((e) => `"${e}"`).join(", ")}.` : "",
    "KANDIDATEN (alle cijfers komen uit Semrush en Google Search Console):",
    lines.join("\n"),
    input.articles.length
      ? `ARTIKELEN DIE AL OP DE WEBSITE STAAN (niet nog eens schrijven, wel eventueel bijwerken):\n${input.articles.slice(0, 80).map((a) => `- ${a.title} (${pathOf(a.url)})`).join("\n")}`
      : "Er is geen lijst met bestaande artikelen.",
    `Kies de ${input.count} beste onderwerpen. Regels:`,
    "1. Elk idee is gebaseerd op precies één hoofdkandidaat (candidate) en eventueel maximaal 3 ondersteunende kandidaten (supporting), via hun id.",
    "2. Kies onderwerpen die passen bij de producten, diensten en doelgroep van de partner. Sla kandidaten over die niets met de partner te maken hebben.",
    "3. Geen twee ideeën met dezelfde zoekintentie of hetzelfde hoofdzoekwoord. Zorg voor variatie.",
    "4. type is \"update\" als een bestaande pagina beter bijgewerkt kan worden (geef dan update_url, alleen een URL uit de kandidaten of artikelen hierboven); anders \"nieuw\". Een kandidaat die al op de website staat wordt nooit \"nieuw\".",
    "5. title: een concrete werktitel in het Nederlands die het hoofdzoekwoord bevat, geen clickbait.",
    "6. angle: één zin met de invalshoek en wat de lezer leert of kan doen.",
    "7. why: 2 korte zinnen waarom dit nu een slimme keuze is voor deze partner. Gebruik ALLEEN getallen die letterlijk in de kandidaten staan; verzin geen cijfers.",
    "Antwoord met alleen JSON:",
    '{"ideas": [{"candidate": "k1", "supporting": ["k4"], "title": "...", "type": "nieuw", "update_url": null, "angle": "...", "why": ["...", "..."]}]}',
  ].filter(Boolean).join("\n\n");
}

// ----------------------------------------------------------- checking answers

export interface TopicIdea {
  title: string;
  keyword: string;
  type: "nieuw" | "update";
  updateUrl: string | null;
  angle: string;
  why: string[];
  evidence: string[];
  supportingKeywords: string[];
  score: number;
  sources: string[];
}

function numbersIn(text: string): number[] {
  return (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => {
    // "1.300" (thousands) → 1300, "12,4" (decimal) → 12.4
    if (/^\d{1,3}(\.\d{3})+$/.test(n)) return Number(n.replace(/\./g, ""));
    return Number(n.replace(",", "."));
  });
}

function allowedNumbers(cs: Candidate[]): Set<number> {
  const allowed = new Set<number>();
  const add = (n: number | null | undefined) => {
    if (n === null || n === undefined || !Number.isFinite(n)) return;
    allowed.add(n);
    allowed.add(Math.round(n));
    allowed.add(Math.round(n * 10) / 10);
  };
  for (const c of cs) {
    add(c.semrush?.volume);
    add(c.semrush?.difficulty);
    add(c.gsc?.position);
    add(c.gsc?.impressions);
    add(c.gsc?.clicks);
    if (c.gsc) add(Math.round(c.gsc.ctr * 1000) / 10);
    add(c.declining?.clicks);
    add(c.declining?.previousClicks);
    if (c.declining) add(Math.abs(c.declining.previousClicks - c.declining.clicks));
    add(c.peak?.monthsUntil);
    add(c.score);
  }
  return allowed;
}

/** True when every number of 13 or more in the sentence comes from the data. */
export function numbersGrounded(sentence: string, cs: Candidate[]): boolean {
  const allowed = allowedNumbers(cs);
  return numbersIn(sentence).every((n) => n <= 12 || (n >= 2000 && n <= 2100) || allowed.has(n) || allowed.has(Math.round(n)));
}

export function parseIdeas(raw: string, candidates: Candidate[], knownUrls: Set<string>, count: number): TopicIdea[] {
  let decoded: unknown;
  try {
    const trimmed = raw.trim();
    const fenced = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/i);
    decoded = JSON.parse(fenced ? fenced[1] : trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1));
  } catch {
    throw new Error("invalid_claude_json");
  }
  const list = (decoded as { ideas?: unknown })?.ideas;
  if (!Array.isArray(list)) throw new Error("invalid_claude_json");
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const usedKeywords = new Set<string>();
  const ideas: TopicIdea[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const main = byId.get(String(entry.candidate ?? ""));
    if (!main || usedKeywords.has(main.keyword)) continue;
    const title = typeof entry.title === "string" ? entry.title.trim() : "";
    if (title.length < 5) continue;
    const supporting = (Array.isArray(entry.supporting) ? entry.supporting : [])
      .map((id) => byId.get(String(id)))
      .filter((c): c is Candidate => Boolean(c) && c!.id !== main.id)
      .slice(0, 3);
    const related = [main, ...supporting];
    let type: TopicIdea["type"] = entry.type === "update" ? "update" : "nieuw";
    let updateUrl = typeof entry.update_url === "string" && knownUrls.has(entry.update_url) ? entry.update_url : null;
    if (type === "update" && !updateUrl) updateUrl = main.declining?.page ?? main.covered?.url ?? main.gsc?.page ?? null;
    if (type === "update" && !updateUrl) type = "nieuw";
    if (type === "nieuw" && main.covered) {
      // Already on the website: suggest updating that article instead of writing it twice.
      type = "update";
      updateUrl = main.covered.url;
    }
    const why = (Array.isArray(entry.why) ? entry.why : [])
      .filter((w): w is string => typeof w === "string" && w.trim().length > 0)
      .map((w) => w.trim())
      .filter((w) => numbersGrounded(w, related))
      .slice(0, 3);
    usedKeywords.add(main.keyword);
    ideas.push({
      title,
      keyword: main.keyword,
      type,
      updateUrl,
      angle: typeof entry.angle === "string" ? entry.angle.trim() : "",
      why,
      evidence: evidenceLines(main),
      supportingKeywords: supporting.map((c) => c.keyword),
      score: main.score,
      sources: main.sources,
    });
    if (ideas.length >= count) break;
  }
  return ideas.sort((a, b) => b.score - a.score);
}

/** Main themes in a set of Search Console queries, weighted by impressions. */
export function queryThemes(rows: Array<{ query: string; impressions: number }>, exclude: string[], limit = 6): string[] {
  const skip = new Set(exclude.flatMap((e) => topicTokens(e)));
  const weight = new Map<string, number>();
  const spelling = new Map<string, Map<string, number>>(); // stem → original words, to show "kosten" instead of "kost"
  for (const row of rows) {
    for (const word of new Set(row.query.toLowerCase().split(/[^\p{L}\p{N}-]+/u).filter(Boolean))) {
      const [token] = topicTokens(word);
      if (!token || token.length < 4 || skip.has(token) || /^\d+$/.test(token)) continue;
      weight.set(token, (weight.get(token) ?? 0) + row.impressions);
      const forms = spelling.get(token) ?? new Map<string, number>();
      forms.set(word, (forms.get(word) ?? 0) + row.impressions);
      spelling.set(token, forms);
    }
  }
  return [...weight.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([token]) => [...spelling.get(token)!.entries()].sort((a, b) => b[1] - a[1])[0][0]);
}
