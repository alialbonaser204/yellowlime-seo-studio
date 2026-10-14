import { SemrushMcpClient } from "./semrushMcp";

const DATABASE = "nl";
const REQUEST_TIMEOUT_MS = 12_000;
const NO_ALTERNATIVE_MESSAGE = "Er is geen geschikt alternatief zoekwoord gevonden.";

export type SemrushTransport = (
  path: string,
) => Promise<Response>;

export interface SemrushKeyword {
  keyword: string;
  searchVolume: number | null;
  keywordDifficulty: number | null;
  searchIntent: string | null;
  trend: string | null;
}

export interface SemrushQuestion {
  question: string;
  searchVolume: number | null;
  keywordDifficulty: number | null;
  searchIntent: string | null;
}

export interface SemrushCompetitor {
  position: number | null;
  domain: string;
  url: string;
}

export interface SeoResearchInput {
  originalSubject: string;
  contentGoal: string;
}

export interface SeoResearchResult {
  selectedMainKeyword: string;
  searchVolume: number | null;
  keywordDifficulty: number | null;
  searchIntent: string | null;
  trend: string | null;
  secondaryKeywords: SemrushKeyword[];
  relevantQuestions: SemrushQuestion[];
  organicCompetitors: SemrushCompetitor[];
  message: string | null;
}

export type SemrushErrorCode =
  | "connector"
  | "timeout"
  | "invalid_key"
  | "insufficient_units"
  | "disabled"
  | "database"
  | "report_disabled"
  | "rate_limit"
  | "invalid_keyword"
  | "unexpected";

export class SemrushServiceError extends Error {
  readonly code: SemrushErrorCode;

  constructor(code: SemrushErrorCode, message: string) {
    super(message);
    this.name = "SemrushServiceError";
    this.code = code;
  }
}

type FetchTransport = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function normalizeSemrushApiKey(value: string): string {
  let key = value
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, "");
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  try {
    if (/^https?:\/\//i.test(key)) {
      key = new URL(key).searchParams.get("key")?.trim() ?? key;
    } else if (/^(?:api_)?key\s*=/i.test(key)) {
      key = key.replace(/^(?:api_)?key\s*=\s*/i, "").trim();
    }
  } catch {
    // Keep the original value so Semrush can return its canonical safe error.
  }
  return key.replace(/\s+/g, "");
}

export function createDirectSemrushTransport(
  apiKey: string,
  fetchTransport: FetchTransport = fetch,
): SemrushTransport {
  const key = normalizeSemrushApiKey(apiKey);
  return (path) => {
    const url = new URL(path, "https://api.semrush.com");
    url.searchParams.set("key", key);
    return fetchTransport(url, { method: "GET" });
  };
}

export type SemrushMode = "mcp" | "api";

/**
 * Which Semrush route to use. `mcp` (default) goes through the Semrush MCP
 * server and works with the Semrush One Starter / Pro+ and SEO Classic Pro /
 * Guru plans. `api` calls the classic Semrush API, which requires the Business
 * plan with an API-units package.
 */
export function semrushMode(): SemrushMode {
  return process.env.SEMRUSH_MODE?.trim().toLowerCase() === "api" ? "api" : "mcp";
}

let mcpClient: { key: string; client: SemrushMcpClient } | null = null;

function getMcpClient(apiKey: string): SemrushMcpClient {
  const url = process.env.SEMRUSH_MCP_URL?.trim() || undefined;
  const cacheKey = `${url ?? ""}|${apiKey}`;
  if (!mcpClient || mcpClient.key !== cacheKey) {
    void mcpClient?.client.close();
    mcpClient = { key: cacheKey, client: new SemrushMcpClient({ apiKey, url }) };
  }
  return mcpClient.client;
}

export const defaultSemrushTransport: SemrushTransport = (path) => {
  const rawKey = process.env.SEMRUSH_API_KEY;
  if (!rawKey?.trim()) {
    throw new SemrushServiceError("invalid_key", "Semrush API-sleutel ontbreekt.");
  }
  if (semrushMode() === "api") {
    return createDirectSemrushTransport(rawKey)(path);
  }
  return getMcpClient(normalizeSemrushApiKey(rawKey)).request(path);
};

/**
 * Parse Semrush's semicolon-delimited export format. This intentionally does
 * not use split(";"): quoted semicolons, escaped quotes, and CRLF are common
 * in exports.
 */
export function parseSemrushCsv(input: string): string[][] {
  if (input.trim() === "") return [];

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let fieldStarted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && !fieldStarted) {
      quoted = true;
      fieldStarted = true;
    } else if (character === ";") {
      row.push(field);
      field = "";
      fieldStarted = false;
    } else if (character === "\n") {
      row.push(field.endsWith("\r") ? field.slice(0, -1) : field);
      rows.push(row);
      row = [];
      field = "";
      fieldStarted = false;
    } else {
      if (character !== "\r" || input[index + 1] !== "\n") field += character;
      fieldStarted = true;
    }
  }

  if (quoted) {
    throw new SemrushServiceError("unexpected", "Onverwacht antwoord van Semrush.");
  }
  if (field.length > 0 || fieldStarted || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((values) => values.some((value) => value.trim() !== ""));
}

export const parseSemicolonCsv = parseSemrushCsv;

function normaliseHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseMetric(value: string | undefined): number | null {
  if (!value || value.trim() === "" || value.trim() === "-") return null;
  const cleaned = value.trim().replace(/\s/g, "").replace(/,/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function headerAliases(kind: "keyword" | "volume" | "difficulty" | "intent" | "trend" | "position" | "domain" | "url"): string[] {
  switch (kind) {
    case "keyword":
      return ["ph", "keyword", "phrase", "query"];
    case "volume":
      return ["nq", "volume", "searchvolume", "searches"];
    case "difficulty":
      return ["kd", "keyworddifficulty", "keyworddifficultyindex", "difficulty"];
    case "intent":
      return ["in", "intent", "searchintent"];
    case "trend":
      return ["td", "trend", "trends"];
    case "position":
      return ["po", "position", "rank"];
    case "domain":
      return ["dn", "domain"];
    case "url":
      return ["ur", "url"];
  }
}

function findColumn(headers: string[], aliases: string[], fallback: number): number {
  const index = headers.findIndex((header) => aliases.includes(normaliseHeader(header)));
  return index === -1 ? fallback : index;
}

function parseReportRows(input: string, report: "keyword" | "question" | "organic"): string[][] {
  const rows = parseSemrushCsv(input);
  if (rows.length === 0) return [];

  const first = rows[0].map(normaliseHeader);
  const hasKnownHeader =
    first.some((value) => headerAliases("keyword").includes(value)) ||
    first.some((value) => headerAliases(report === "organic" ? "domain" : "volume").includes(value));
  const dataRows = hasKnownHeader ? rows.slice(1) : rows;
  const minimumFields = report === "organic" ? 2 : 2;
  if (dataRows.some((row) => row.length < minimumFields)) {
    throw new SemrushServiceError("unexpected", "Onverwacht antwoord van Semrush.");
  }
  if (!hasKnownHeader && report !== "organic") {
    const metricColumn = dataRows.some((row) => row.length > 1 && row[1].trim() !== "" && parseMetric(row[1]) === null);
    if (metricColumn) throw new SemrushServiceError("unexpected", "Onverwacht antwoord van Semrush.");
  }
  if (!hasKnownHeader && report === "organic") {
    const positionColumn = dataRows.some((row) => row[0].trim() !== "" && parseMetric(row[0]) === null);
    if (positionColumn) throw new SemrushServiceError("unexpected", "Onverwacht antwoord van Semrush.");
  }
  return rows;
}

export function parseKeywordReport(input: string): SemrushKeyword[] {
  const rows = parseReportRows(input, "keyword");
  if (rows.length === 0) return [];
  const first = rows[0].map(normaliseHeader);
  const hasHeader = first.some((value) => headerAliases("keyword").includes(value));
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const keywordIndex = findColumn(rows[0], headerAliases("keyword"), 0);
  const volumeIndex = findColumn(rows[0], headerAliases("volume"), 1);
  const difficultyIndex = findColumn(rows[0], headerAliases("difficulty"), 2);
  const intentIndex = findColumn(rows[0], headerAliases("intent"), 3);
  const trendIndex = findColumn(rows[0], headerAliases("trend"), 4);
  return dataRows.map((row) => ({
    keyword: (row[keywordIndex] ?? "").trim(),
    searchVolume: parseMetric(row[volumeIndex]),
    keywordDifficulty: parseMetric(row[difficultyIndex]),
    searchIntent: row[intentIndex]?.trim() || null,
    trend: row[trendIndex]?.trim() || null,
  })).filter((row) => row.keyword !== "");
}

export function parseQuestionReport(input: string): SemrushQuestion[] {
  const rows = parseReportRows(input, "question");
  if (rows.length === 0) return [];
  const hasHeader = rows[0].some((value) => headerAliases("keyword").includes(normaliseHeader(value)));
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const keywordIndex = findColumn(rows[0], headerAliases("keyword"), 0);
  const volumeIndex = findColumn(rows[0], headerAliases("volume"), 1);
  const difficultyIndex = findColumn(rows[0], headerAliases("difficulty"), 2);
  const intentIndex = findColumn(rows[0], headerAliases("intent"), 3);
  return dataRows.map((row) => ({
    question: (row[keywordIndex] ?? "").trim(),
    searchVolume: parseMetric(row[volumeIndex]),
    keywordDifficulty: parseMetric(row[difficultyIndex]),
    searchIntent: row[intentIndex]?.trim() || null,
  })).filter((row) => row.question !== "");
}

export function parseOrganicReport(input: string): SemrushCompetitor[] {
  const rows = parseReportRows(input, "organic");
  if (rows.length === 0) return [];
  const first = rows[0].map(normaliseHeader);
  const hasHeader =
    first.some((value) => headerAliases("domain").includes(value)) ||
    first.some((value) => headerAliases("position").includes(value));
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const positionIndex = findColumn(rows[0], headerAliases("position"), 0);
  const domainIndex = findColumn(rows[0], headerAliases("domain"), 1);
  const urlIndex = findColumn(rows[0], headerAliases("url"), 2);
  return dataRows.map((row) => ({
    position: parseMetric(row[positionIndex]),
    domain: (row[domainIndex] ?? "").trim(),
    url: (row[urlIndex] ?? "").trim(),
  })).filter((row) => row.domain !== "" || row.url !== "");
}

function semrushMessage(code: string | undefined, status?: number, details?: string): SemrushServiceError {
  if (status === 429) return new SemrushServiceError("rate_limit", "Semrush-aanvraag te vaak uitgevoerd.");
  switch (code) {
    case "120":
    case "122":
      return new SemrushServiceError("invalid_key", "Ongeldige Semrush API-sleutel.");
    case "130":
      return new SemrushServiceError("disabled", "Semrush API is niet ingeschakeld.");
    case "131":
    case "132":
    case "134":
      return new SemrushServiceError("insufficient_units", "Onvoldoende Semrush-eenheden.");
    case "133":
      return new SemrushServiceError("database", "Semrush-database niet beschikbaar.");
    case "135":
      return new SemrushServiceError("report_disabled", "Semrush-rapport is niet beschikbaar.");
    case "10":
    case "11":
    case "12":
    case "13":
    case "400":
    case "402":
      return new SemrushServiceError("invalid_keyword", "Ongeldig zoekwoord.");
    default:
      if (details && /mandatory|invalid\s+(keyword|phrase)|keyword.*invalid/i.test(details)) {
        return new SemrushServiceError("invalid_keyword", "Ongeldig zoekwoord.");
      }
      return new SemrushServiceError("unexpected", "Semrush gaf een technische fout.");
  }
}

async function requestReport(
  path: string,
  transport: SemrushTransport,
  timeoutMs: number,
): Promise<string> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      transport(path),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new SemrushServiceError("timeout", "De Semrush-aanvraag duurde te lang.")), timeoutMs);
      }),
    ]);
    const body = await response.text();
    const errorMatch = body.trim().match(/^ERROR\s+(\d+)\s*::\s*(.*)$/is);
    if (errorMatch) {
      if (errorMatch[1] === "50") return "";
      throw semrushMessage(errorMatch[1], response.status, errorMatch[2]);
    }
    if (response.status === 429) throw semrushMessage(undefined, 429);
    if (!response.ok) throw semrushMessage(String(response.status), response.status);
    return body;
  } catch (error) {
    if (error instanceof SemrushServiceError) throw error;
    throw new SemrushServiceError("connector", "Semrush-verbinding is niet beschikbaar.");
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function reportPath(type: string, phrase: string, columns: string, extras: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    type,
    phrase,
    database: DATABASE,
    export_columns: columns,
    ...extras,
  });
  return `/?${params.toString()}`;
}

function researchTokens(value: string): Set<string> {
  const stopWords = new Set(["de", "het", "een", "en", "van", "voor", "met", "op", "in", "te", "naar", "is", "zijn", "the", "a", "an", "and", "for", "of", "to"]);
  return new Set(
    value.toLocaleLowerCase("nl-NL")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length > 1 && !stopWords.has(token)),
  );
}

export function selectMainKeyword(
  originalSubject: string,
  contentGoal: string,
  overview: SemrushKeyword[],
  broadCandidates: SemrushKeyword[],
): { selected: SemrushKeyword; message: string | null } {
  const direct = overview.find((candidate) => (candidate.searchVolume ?? 0) > 0);
  if (direct) return { selected: direct, message: null };

  const targetTokens = researchTokens(`${originalSubject} ${contentGoal}`);
  const ranked = broadCandidates
    .filter((candidate) => (candidate.searchVolume ?? 0) > 0 && candidate.keyword.trim() !== "")
    .map((candidate) => {
      const overlap = [...researchTokens(candidate.keyword)].filter((token) => targetTokens.has(token)).length;
      return { candidate, overlap };
    })
    .filter((item) => item.overlap > 0)
    .sort((left, right) =>
      right.overlap - left.overlap ||
      (right.candidate.searchVolume ?? 0) - (left.candidate.searchVolume ?? 0),
    );
  if (ranked[0]) return { selected: ranked[0].candidate, message: null };

  return {
    selected: {
      keyword: originalSubject,
      searchVolume: null,
      keywordDifficulty: null,
      searchIntent: null,
      trend: null,
    },
    message: NO_ALTERNATIVE_MESSAGE,
  };
}

export async function runSemrushResearch(
  input: SeoResearchInput,
  transport: SemrushTransport = defaultSemrushTransport,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<SeoResearchResult> {
  const [overviewRaw, broadRaw, questionsRaw, organicRaw] = await Promise.all([
    requestReport(reportPath("phrase_this", input.originalSubject, "Ph,Nq,Kd,In,Td"), transport, timeoutMs),
    requestReport(reportPath("phrase_fullsearch", input.originalSubject, "Ph,Nq,Kd,In,Td", { limit: "10", sort: "nq_desc" }), transport, timeoutMs),
    requestReport(reportPath("phrase_questions", input.originalSubject, "Ph,Nq,Kd,In", { limit: "5", sort: "nq_desc" }), transport, timeoutMs),
    requestReport(reportPath("phrase_organic", input.originalSubject, "Po,Dn,Ur", { limit: "5" }), transport, timeoutMs),
  ]);
  const overview = overviewRaw ? parseKeywordReport(overviewRaw) : [];
  const broad = broadRaw ? parseKeywordReport(broadRaw) : [];
  const questions = questionsRaw ? parseQuestionReport(questionsRaw) : [];
  const organic = organicRaw ? parseOrganicReport(organicRaw) : [];
  const { selected, message } = selectMainKeyword(input.originalSubject, input.contentGoal, overview, broad);

  return {
    selectedMainKeyword: selected.keyword,
    searchVolume: selected.searchVolume,
    keywordDifficulty: selected.keywordDifficulty,
    searchIntent: selected.searchIntent,
    trend: selected.trend,
    secondaryKeywords: broad.filter((candidate) => candidate.keyword !== selected.keyword),
    relevantQuestions: questions,
    organicCompetitors: organic,
    message,
  };
}

export function safeSemrushError(error: unknown): { code: SemrushErrorCode; message: string } {
  if (error instanceof SemrushServiceError) return { code: error.code, message: error.message };
  return { code: "unexpected", message: "Semrush gaf een technische fout." };
}
/**
 * Where (if anywhere) a domain appears in Google's organic top 10 for a phrase.
 * Returns null when the domain is not in the top 10 or Semrush has no data.
 */
export async function findDomainInTopResults(
  phrase: string,
  domain: string,
  transport: SemrushTransport = defaultSemrushTransport,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<{ position: number | null; url: string } | null> {
  const raw = await requestReport(reportPath("phrase_organic", phrase, "Po,Dn,Ur", { limit: "10" }), transport, timeoutMs);
  if (!raw) return null;
  const target = domain.toLowerCase().replace(/^www\./, "");
  const match = parseOrganicReport(raw).find((row) => {
    const host = row.domain.toLowerCase().replace(/^www\./, "");
    return host === target || host.endsWith(`.${target}`);
  });
  return match ? { position: match.position, url: match.url } : null;
}
