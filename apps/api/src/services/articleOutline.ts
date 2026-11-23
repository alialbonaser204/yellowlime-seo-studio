import { defaultClaudeTextRunner, type ClaudeTextRunner } from "./claudeRunner";
import { serpContext, type SerpAnalysis } from "./serpAnalysis";

/**
 * Step before writing: Claude proposes an outline (per section: heading,
 * level, type, number of words, angle, keywords and questions). A Yellowlimer
 * edits and approves it; the article is then written exactly along it.
 * Inspired by the article planner of SEO Machine
 * (github.com/TheCraigHewitt/seomachine, MIT).
 */

export const OUTLINE_PROMPT_VERSION = "article_outline_v1" as const;
export const OUTLINE_TIMEOUT_MS = 0; // 0 = geen tijdslimiet

export const SECTION_TYPES = ["uitleg", "stappenplan", "vergelijking", "lijst", "voorbeeld"] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export interface OutlineSection {
  heading: string;
  level: "H2" | "H3";
  type: SectionType;
  words: number;
  angle: string;
  keywords: string[];
  questions: string[];
}

export interface ArticleOutline {
  title: string;
  sections: OutlineSection[];
}

export interface OutlineInput {
  partnerName: string;
  approvedPartnerProfile: Record<string, unknown>;
  subject: string;
  contentGoal: string;
  semrushResearch: Record<string, unknown>;
  /** What the top 5 in Google look like (headings, length); optional. */
  serp?: SerpAnalysis | null;
}

function strings(value: unknown, key: "keyword" | "question"): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (item && typeof item === "object" && typeof (item as Record<string, unknown>)[key] === "string") {
      return [(item as Record<string, string>)[key]];
    }
    return [];
  });
}

export function outlineContext(research: Record<string, unknown>, subject: string) {
  const main = typeof research.selectedMainKeyword === "string" && research.selectedMainKeyword.trim()
    ? research.selectedMainKeyword.trim()
    : subject.trim();
  return {
    primaryKeyword: main,
    keywords: strings(research.secondaryKeywords, "keyword"),
    questions: strings(research.relevantQuestions, "question"),
  };
}

export function makeOutlinePrompt(input: OutlineInput): string {
  const { primaryKeyword, keywords, questions } = outlineContext(input.semrushResearch, input.subject);
  return [
    `Prompt version: ${OUTLINE_PROMPT_VERSION}`,
    "Maak een opzet voor één Nederlands SEO-artikel en geef uitsluitend geldig JSON terug, zonder markdown.",
    'Schema: {"title": "string", "sections": [{"heading": "string", "level": "H2" of "H3", "type": "uitleg" | "stappenplan" | "vergelijking" | "lijst" | "voorbeeld", "words": getal, "angle": "string", "keywords": ["string"], "questions": ["string"]}]}',
    `Partnernaam: ${input.partnerName}`,
    `Onderwerp: ${input.subject}`,
    `Contentdoel: ${input.contentGoal}`,
    `Goedgekeurd partnerprofiel (feitenbasis): ${JSON.stringify(input.approvedPartnerProfile)}`,
    `SEO-onderzoek (kan ontbreken): ${JSON.stringify(input.semrushResearch)}`,
    `Hoofdzoekwoord: ${primaryKeyword}`,
    `Toegestane secundaire zoekwoorden: ${JSON.stringify(keywords)}`,
    `Toegestane vragen: ${JSON.stringify(questions)}`,
    serpContext(input.serp ?? null) ?? "Er is geen analyse van de toppagina's in Google beschikbaar.",
    "Regels:",
    [
      "- title bevat het hoofdzoekwoord.",
      "- sections zijn alleen de inhoudelijke secties. Inleiding, het blok 'In het kort', 'Veelgestelde vragen' en de conclusie komen er later vast bij: zet ze niet in de opzet.",
      "- 4 tot 7 H2-secties; een H3 alleen direct onder een H2 als een sectie echt uit delen bestaat. Eén duidelijk onderwerp per sectie, in een logische volgorde voor de lezer.",
      "- Het hoofdzoekwoord staat in ongeveer een derde van de H2-koppen, natuurlijk geformuleerd.",
      input.serp?.medianWords
        ? `- words: 120 tot 400 per sectie; samen ongeveer ${Math.min(2500, Math.max(800, input.serp.medianWords))} woorden (de mediaan van de toppagina's, begrensd tot 800–2500).`
        : "- words: 120 tot 400 per sectie; samen 800 tot 1500.",
      "- angle: één zin over wat de sectie de lezer oplevert en welke informatie uit het profiel of onderzoek erin komt.",
      "- keywords en questions bevatten uitsluitend waarden uit de toegestane lijsten (mag leeg zijn). Verdeel ze over de secties.",
      "- Verzin geen feiten, producten, prijzen of locaties; alles moet uit het profiel of het onderzoek kunnen komen.",
      "- Noem nooit Semrush, Claude of Yellowlime AI Agent.",
    ].join("\n"),
  ].join("\n\n");
}

/** Checks an outline (from Claude or edited by a person) and returns a clean copy, or throws. */
export function validateOutline(
  value: unknown,
  allowed: { keywords: string[]; questions: string[] } | null = null,
): ArticleOutline {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_outline");
  const raw = value as Record<string, unknown>;
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title || title.length > 200) throw new Error("invalid_outline");
  if (!Array.isArray(raw.sections) || raw.sections.length < 1 || raw.sections.length > 15) throw new Error("invalid_outline");
  const allowedKeywords = allowed ? new Set(allowed.keywords) : null;
  const allowedQuestions = allowed ? new Set(allowed.questions) : null;
  const sections = raw.sections.map((item): OutlineSection => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("invalid_outline");
    const s = item as Record<string, unknown>;
    const heading = typeof s.heading === "string" ? s.heading.trim() : "";
    if (!heading || heading.length > 200) throw new Error("invalid_outline");
    const level = s.level === "H3" ? "H3" : "H2";
    const type = SECTION_TYPES.includes(s.type as SectionType) ? (s.type as SectionType) : "uitleg";
    const words = Math.min(800, Math.max(60, Math.round(Number(s.words) || 200)));
    const angle = typeof s.angle === "string" ? s.angle.trim().slice(0, 400) : "";
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : []);
    const keywords = list(s.keywords).filter((k) => !allowedKeywords || allowedKeywords.has(k));
    const questions = list(s.questions).filter((q) => !allowedQuestions || allowedQuestions.has(q));
    return { heading, level, type, words, angle, keywords, questions };
  });
  if (sections[0].level !== "H2") sections[0] = { ...sections[0], level: "H2" };
  return { title, sections };
}

export async function generateOutline(
  input: OutlineInput,
  runner: ClaudeTextRunner = defaultClaudeTextRunner,
): Promise<ArticleOutline> {
  const allowed = outlineContext(input.semrushResearch, input.subject);
  let raw = await runner(makeOutlinePrompt(input), OUTLINE_TIMEOUT_MS);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
      return validateOutline(JSON.parse(cleaned), allowed);
    } catch {
      if (attempt === 1) break;
      raw = await runner(`Geef de onderstaande opzet opnieuw als geldig JSON volgens dit schema, zonder markdown: {"title": "string", "sections": [{"heading": "string", "level": "H2" of "H3", "type": "uitleg" | "stappenplan" | "vergelijking" | "lijst" | "voorbeeld", "words": getal, "angle": "string", "keywords": ["string"], "questions": ["string"]}]}\n\n${raw}`, OUTLINE_TIMEOUT_MS);
    }
  }
  throw new Error("invalid_outline");
}

/** The approved outline as binding instructions for the article prompt. */
export function outlineInstructions(outline: ArticleOutline): string {
  const lines = outline.sections.map((s, i) =>
    `${i + 1}. ${s.level === "H2" ? "##" : "###"} ${s.heading} (${s.type}, ongeveer ${s.words} woorden)${s.angle ? ` – ${s.angle}` : ""}${s.keywords.length ? ` | zoekwoorden: ${s.keywords.join(", ")}` : ""}${s.questions.length ? ` | beantwoordt: ${s.questions.join(" / ")}` : ""}`);
  return [
    "Goedgekeurde opzet (bindend, door een Yellowlimer goedgekeurd):",
    `Titel: ${outline.title}`,
    ...lines,
    "Gebruik deze titel en precies deze koppen, in deze volgorde en op dit niveau; voeg geen andere inhoudelijke secties toe. Houd ongeveer het aangegeven aantal woorden aan. Inleiding, 'In het kort', 'Veelgestelde vragen' en de conclusie komen er volgens de vaste opbouw bij.",
  ].join("\n");
}

