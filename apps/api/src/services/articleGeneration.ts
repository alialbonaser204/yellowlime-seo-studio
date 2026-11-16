import {
  CLAUDE_MODEL as SHARED_CLAUDE_MODEL,
  defaultClaudeTextRunner,
  type ClaudeTextRunner,
} from "./claudeRunner";
import { outlineInstructions, type ArticleOutline } from "./articleOutline";

export const CLAUDE_MODEL = SHARED_CLAUDE_MODEL;
export const PROMPT_VERSION = "article_generation_v2" as const;
export const ARTICLE_CLAUDE_MODEL = CLAUDE_MODEL;
export const ARTICLE_PROMPT_VERSION = PROMPT_VERSION;
export const ARTICLE_GENERATION_TIMEOUT_MS = 300_000;

export interface ArticleGenerationInput {
  partnerName: string;
  approvedPartnerProfile: Record<string, unknown>;
  subject: string;
  contentGoal: string;
  semrushResearch: Record<string, unknown>;
  yellowlimerName: string;
  /** A piece of the partner's own website text, only as an example of tone and style. */
  styleSample?: string | null;
  /** The outline a Yellowlimer approved; when present the article follows it exactly. */
  outline?: ArticleOutline | null;
}

/** At most this much of the partner's website text is sent as a style example. */
export const STYLE_SAMPLE_CHARS = 1500;

/** Picks a readable stretch of the partner's own website text: whole sentences, no menus. */
export function styleSampleFrom(websiteText: string | null | undefined, maxChars = STYLE_SAMPLE_CHARS): string | null {
  if (!websiteText) return null;
  const paragraphs = websiteText
    .split(/\n{1,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.split(" ").length >= 12 && /[.!?]$/.test(p));
  let out = "";
  for (const p of paragraphs) {
    if (out.length + p.length + 2 > maxChars) break;
    out += (out ? "\n\n" : "") + p;
  }
  return out.length >= 200 ? out : null;
}

export interface ArticleSectionContent {
  heading: string;
  headingLevel: "H2" | "H3";
  content: string;
}

export interface GeneratedArticleContent {
  title: string;
  introduction: string;
  sections: ArticleSectionContent[];
  conclusion: string;
  fullArticle: string;
  metaTitle: string;
  metaDescription: string;
  primaryKeyword: string;
  secondaryKeywordsUsed: string[];
  questionsAnswered: string[];
}

export interface ArticleGenerationPrerequisites {
  partnerExists: boolean;
  partnerProfileStatus: string | null;
  approvedPartnerProfile: unknown;
  reviewerId: number | null;
  reviewerActive: boolean;
  subject: string;
  contentGoal: string;
}

export function articleGenerationPrerequisiteError(
  prerequisites: ArticleGenerationPrerequisites,
): string | null {
  if (
    !prerequisites.partnerExists ||
    prerequisites.partnerProfileStatus !== "Goedgekeurd" ||
    !prerequisites.approvedPartnerProfile ||
    typeof prerequisites.approvedPartnerProfile !== "object" ||
    Array.isArray(prerequisites.approvedPartnerProfile)
  ) {
    return "Keur eerst het partnerprofiel goed.";
  }
  if (!prerequisites.reviewerId || !prerequisites.reviewerActive) {
    return "Wijs eerst een actieve reviewer toe.";
  }
  if (!prerequisites.subject.trim() || !prerequisites.contentGoal.trim()) {
    return "Vul eerst onderwerp en contentdoel in.";
  }
  return null;
}

const outputKeys = [
  "title",
  "introduction",
  "sections",
  "conclusion",
  "meta_title",
  "meta_description",
  "primary_keyword",
  "secondary_keywords_used",
  "questions_answered",
  "full_article",
] as const;

const outputSchema = `{
  "title": "string",
  "introduction": "string",
  "sections": [{"heading": "string", "heading_level": "H2" or "H3", "content": "string"}],
  "conclusion": "string",
  "meta_title": "string",
  "meta_description": "string",
  "primary_keyword": "string",
  "secondary_keywords_used": ["string"],
  "questions_answered": ["string"],
  "full_article": "string"
}`;

function cloneSnapshot(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function suppliedKeywords(research: Record<string, unknown>): string[] {
  const values = research.secondaryKeywords;
  if (!Array.isArray(values)) return [];
  return values.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (item && typeof item === "object" && typeof (item as { keyword?: unknown }).keyword === "string") {
      return [(item as { keyword: string }).keyword];
    }
    return [];
  });
}

function suppliedQuestions(research: Record<string, unknown>): string[] {
  const values = research.relevantQuestions;
  if (!Array.isArray(values)) return [];
  return values.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (item && typeof item === "object" && typeof (item as { question?: unknown }).question === "string") {
      return [(item as { question: string }).question];
    }
    return [];
  });
}

export function makeArticleGenerationPrompt(input: ArticleGenerationInput): string {
  // Clone before serialising so callers can safely reuse the immutable snapshots
  // that are stored with a generation.
  const profile = cloneSnapshot(input.approvedPartnerProfile);
  const research = cloneSnapshot(input.semrushResearch);
  const keywords = suppliedKeywords(research);
  const questions = suppliedQuestions(research);
  const primaryKeyword = nonEmptyString(research.selectedMainKeyword)
    ? research.selectedMainKeyword.trim()
    : input.subject.trim();
  return [
    `Prompt version: ${PROMPT_VERSION}`,
    "Schrijf één volledig Nederlands SEO-artikel en geef uitsluitend geldig JSON terug.",
    "Gebruik exact deze snake_case-velden en geen andere velden:",
    outputKeys.join(", "),
    "Schema:",
    outputSchema,
    `Partnernaam: ${input.partnerName}`,
    `Toegewezen Yellowlimer: ${input.yellowlimerName}`,
    `Onderwerp: ${input.subject}`,
    `Contentdoel: ${input.contentGoal}`,
    `Goedgekeurd partnerprofiel (alleen gebruiken als feitenbasis): ${JSON.stringify(profile)}`,
    `Optioneel SEO-onderzoek (kan ontbreken of mislukt zijn): ${JSON.stringify(research)}`,
    `Te gebruiken hoofdzoekwoord: ${primaryKeyword}`,
    `Toegestane secundaire zoekwoorden: ${JSON.stringify(keywords)}`,
    `Toegestane vragen: ${JSON.stringify(questions)}`,
    input.styleSample
      ? `Voorbeeldtekst van de eigen website van de partner (alleen als voorbeeld van toon, aanspreekvorm en zinsbouw; neem er geen zinnen letterlijk uit over en gebruik er geen feiten uit die niet in het goedgekeurde profiel staan):\n"""\n${input.styleSample}\n"""`
      : "Er is geen voorbeeldtekst van de website; volg de toon en stijl uit het partnerprofiel.",
    ...(input.outline ? [outlineInstructions(input.outline)] : []),
    "Schrijf in de toon en stijl van het partnerprofiel, passend bij doel en zoekintentie.",
    [
      "Opbouw van full_article (markdown):",
      "1. Begin met '# ' + de titel. De titel bevat het hoofdzoekwoord.",
      "2. Inleiding: de eerste één à twee zinnen geven direct antwoord op de zoekvraag achter het onderwerp, zonder aanloop. Het hoofdzoekwoord staat in de eerste 100 woorden. Daarna kort waarom dit belangrijk is voor de lezer en wat hij in het artikel leert.",
      "3. Direct na de inleiding een blok 'In het kort' als blockquote: de regel '> **In het kort**' en daarna 3 tot 5 regels '> - ' met de belangrijkste conclusies van het artikel zelf, elk concreet en op zichzelf te begrijpen. Alleen feiten uit het profiel of het onderzoek.",
      "4. Daarna de H2- en H3-secties ('## ' en '### '), één duidelijk onderwerp per sectie, met het hoofdzoekwoord in ongeveer een derde van de H2-koppen.",
      "5. Daarna '## Veelgestelde vragen' met 3 tot 5 vragen als '### ' kop, geformuleerd zoals mensen ze aan Google of ChatGPT stellen, elk met een antwoord van 2 tot 4 zinnen. Gebruik eerst de toegestane vragen.",
      "6. Sluit af met een conclusie en een passende call-to-action.",
    ].join("\n"),
    "Leesbaarheid: alinea's van hooguit 4 zinnen, gemiddeld niet meer dan 20 woorden per zin, actieve zinnen, gewone woorden.",
    "Vermijd standaardzinnen die als AI-tekst klinken, zoals 'in de wereld van', 'in de huidige digitale wereld', 'het is belangrijk om te weten', 'laten we eens kijken', 'duiken in', 'speelt een cruciale rol', 'het is geen geheim dat', 'naadloos', 'baanbrekend', 'gamechanger' en 'niet alleen … maar ook'.",
    "meta_title is 50 tot 60 tekens en bevat het hoofdzoekwoord. meta_description is 140 tot 160 tekens en geeft zelf al het antwoord in plaats van alleen nieuwsgierig te maken.",
    "Gebruik het hoofdzoekwoord natuurlijk, relevante secundaire zoekwoorden zonder keyword stuffing, en gebruik vragen als H2/H3 of FAQ-kop wanneer dat nuttig is.",
    "Maak een duidelijke titel en introductie, gebruik H2- en H3-secties met korte leesbare alinea's, sluit af met een passende CTA en conclusie.",
    "Verzin nooit feiten, producten, diensten, prijzen of locaties en doe geen onbewezen claims. Gebruik geen generieke AI-tekst.",
    "Noem in het artikel nooit Semrush, Claude, Limey, Yellowlime AI Agent of briefing. Concurrenten en hun URL's zijn uitsluitend context: kopieer nooit hun tekst, structuur of claims.",
    "primary_keyword moet exact het opgegeven hoofdzoekwoord zijn. Als SEO-onderzoek ontbreekt, is dit het briefingonderwerp. secondary_keywords_used en questions_answered mogen uitsluitend waarden uit de toegestane lijsten bevatten.",
  ].join("\n\n");
}

function parseArticleResponse(
  decoded: unknown,
  primaryKeyword: string,
  allowedKeywords: Set<string>,
  allowedQuestions: Set<string>,
): GeneratedArticleContent {
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new Error("invalid_article_shape");
  }
  const input = decoded as Record<string, unknown>;
  if (
    Object.keys(input).length !== outputKeys.length ||
    outputKeys.some((key) => !Object.prototype.hasOwnProperty.call(input, key))
  ) {
    throw new Error("invalid_article_shape");
  }
  if (
    !nonEmptyString(input.title) ||
    !nonEmptyString(input.introduction) ||
    !nonEmptyString(input.conclusion) ||
    !nonEmptyString(input.full_article) ||
    !nonEmptyString(input.meta_title) ||
    !nonEmptyString(input.meta_description) ||
    !nonEmptyString(input.primary_keyword) ||
    !stringArray(input.secondary_keywords_used) ||
    !stringArray(input.questions_answered) ||
    !Array.isArray(input.sections)
  ) {
    throw new Error("empty_article");
  }
  if (input.primary_keyword !== primaryKeyword) {
    throw new Error("wrong_primary_keyword");
  }
  if (
    input.secondary_keywords_used.some((value) => !allowedKeywords.has(value)) ||
    input.questions_answered.some((value) => !allowedQuestions.has(value))
  ) {
    throw new Error("invented_article_reference");
  }
  const sections: ArticleSectionContent[] = [];
  for (const section of input.sections) {
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      throw new Error("invalid_article_shape");
    }
    const item = section as Record<string, unknown>;
    if (
      Object.keys(item).length !== 3 ||
      !nonEmptyString(item.heading) ||
      (item.heading_level !== "H2" && item.heading_level !== "H3") ||
      !nonEmptyString(item.content)
    ) {
      throw new Error("invalid_article_shape");
    }
    sections.push({
      heading: item.heading,
      headingLevel: item.heading_level,
      content: item.content,
    });
  }
  if (sections.length === 0) throw new Error("empty_article");
  return {
    title: input.title,
    introduction: input.introduction,
    sections,
    conclusion: input.conclusion,
    fullArticle: input.full_article,
    metaTitle: input.meta_title,
    metaDescription: input.meta_description,
    primaryKeyword: input.primary_keyword,
    secondaryKeywordsUsed: input.secondary_keywords_used,
    questionsAnswered: input.questions_answered,
  };
}

function repairPrompt(invalidResponse: string): string {
  return [
    "Repareer uitsluitend de onderstaande ongeldige JSON voor een Nederlands SEO-artikel.",
    "Geef alleen JSON terug, zonder markdown. Gebruik exact dit schema en geen extra velden:",
    outputSchema,
    "De vorige uitvoer was:",
    invalidResponse,
    "Vul alle verplichte niet-lege tekstvelden correct in en gebruik alleen H2/H3.",
  ].join("\n\n");
}

export function articleGenerationErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "missing_key") return "De AI-sleutel ontbreekt.";
  if (code === "invalid_key") return "De AI-sleutel is ongeldig.";
  if (code === "claude_timeout") return "De AI-generatie duurde te lang.";
  if (code === "claude_api_error") return "De AI-service is tijdelijk niet beschikbaar.";
  if (code === "invalid_article_json" || code === "invalid_article_shape") {
    return "De AI leverde geen geldig artikel op.";
  }
  if (code === "empty_article") return "De AI leverde een leeg artikel op.";
  if (code === "wrong_primary_keyword" || code === "invented_article_reference") {
    return "De AI leverde geen geldig SEO-artikel op.";
  }
  return "Het artikel kon niet worden gegenereerd.";
}

export async function generateArticle(
  input: ArticleGenerationInput,
  runner: ClaudeTextRunner = defaultClaudeTextRunner,
  timeoutMs = ARTICLE_GENERATION_TIMEOUT_MS,
): Promise<GeneratedArticleContent> {
  const research = cloneSnapshot(input.semrushResearch);
  const primaryKeyword = nonEmptyString(research.selectedMainKeyword)
    ? research.selectedMainKeyword.trim()
    : input.subject.trim();
  if (!nonEmptyString(primaryKeyword)) throw new Error("invalid_article_shape");
  const allowedKeywords = new Set(suppliedKeywords(research));
  const allowedQuestions = new Set(suppliedQuestions(research));
  const prompt = makeArticleGenerationPrompt({
    ...input,
    approvedPartnerProfile: cloneSnapshot(input.approvedPartnerProfile),
    semrushResearch: research,
  });
  let raw = await runner(prompt, timeoutMs);
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      let decoded: unknown;
      try {
        decoded = JSON.parse(raw);
      } catch {
        throw new Error("invalid_article_json");
      }
      return parseArticleResponse(
        decoded,
        primaryKeyword,
        allowedKeywords,
        allowedQuestions,
      );
    } catch (error) {
      lastError = error;
      if (attempt === 1) break;
      raw = await runner(repairPrompt(raw), timeoutMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("invalid_article_json");
}