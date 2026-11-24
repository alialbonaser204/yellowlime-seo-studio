import {
  CLAUDE_MODEL as SHARED_CLAUDE_MODEL,
  defaultClaudeTextRunner,
  type ClaudeTextRunner,
} from "./claudeRunner";
import { outlineInstructions, type ArticleOutline } from "./articleOutline";

export const CLAUDE_MODEL = SHARED_CLAUDE_MODEL;
export const PROMPT_VERSION = "article_generation_v3" as const;
export const ARTICLE_CLAUDE_MODEL = CLAUDE_MODEL;
export const ARTICLE_PROMPT_VERSION = PROMPT_VERSION;
export const ARTICLE_GENERATION_TIMEOUT_MS = 0; // 0 = geen tijdslimiet

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
  /** What Google Search Console shows for the partner's own website (may be missing). */
  searchConsole?: SearchConsoleContext | null;
  /** What the partner itself does in its own texts (null = unknown, so: don't). */
  partnerHabits?: PartnerHabits | null;
}

export interface PartnerHabits {
  /** The partner has a summary block ("In het kort", "Samenvatting", ...) somewhere. */
  summary: { used: boolean; label: string | null };
  /** The partner has a questions section ("Veelgestelde vragen", "FAQ", ...). */
  faq: { used: boolean; label: string | null };
  /** The partner ends texts with a closing section ("Conclusie", "Tot slot", ...). */
  closing: { used: boolean; label: string | null };
}

const FAQ_LABELS = ["veelgestelde vragen", "veel gestelde vragen", "faq", "vragen en antwoorden", "vraag en antwoord", "veelgestelde vragen over"];
const CLOSING_LABELS = ["conclusie", "tot slot", "ten slotte", "afsluitend", "tot besluit", "samenvattend", "concluderend"];

const SUMMARY_LABELS = ["in het kort", "kort samengevat", "samengevat", "samenvatting", "in een notendop", "de belangrijkste punten", "belangrijkste punten", "tl;dr", "tldr", "key takeaways", "het belangrijkste op een rij", "snel overzicht"];

/**
 * Looks in the partner's own texts (website text and headings of their
 * published articles) whether they ever use a summary block, and with which
 * words. Only then does the article get one.
 */
export function detectPartnerHabits(texts: string[], headings: string[]): PartnerHabits {
  const lines = [
    ...headings,
    ...texts.flatMap((t) => t.split(/\n+/)).filter((l) => l.trim().length > 0 && l.trim().length <= 60),
  ].map((l) => l.trim().toLowerCase().replace(/[:.!?]+$/, ""));
  const find = (labels: string[]) => {
    for (const label of labels) {
      const hit = lines.find((l) => l === label || (l.startsWith(`${label} `) && l.length <= label.length + 40));
      if (hit) {
        const name = label === "tldr" ? "TL;DR" : label === "faq" ? "FAQ" : label.charAt(0).toUpperCase() + label.slice(1);
        return { used: true, label: name.replace(/ over$/i, "") };
      }
    }
    return { used: false, label: null };
  };
  return { summary: find(SUMMARY_LABELS), faq: find(FAQ_LABELS), closing: find(CLOSING_LABELS) };
}

export interface SearchConsoleContext {
  /** Searches the website already appears for that share words with the main keyword. */
  relatedQueries: { query: string; clicks: number; impressions: number; position: number }[];
  /** The website's own pages that get clicks from Google: candidates for internal links. */
  pages: { url: string; clicks: number }[];
  /** A page that already ranks for the main keyword itself, if any. */
  existingPageForKeyword?: { url: string; position: number } | null;
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
  "conclusion": "string (de korte afsluiter; leeg als het artikel geen afsluiter nodig heeft)",
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
    partnerStyleRules(profile),
    searchConsoleBlock(input.searchConsole ?? null, primaryKeyword),
    [
      "Opbouw van full_article (markdown):",
      "1. Begin met '# ' + de titel. De titel bevat het hoofdzoekwoord.",
      "2. Inleiding: de eerste één à twee zinnen geven direct antwoord op de zoekvraag achter het onderwerp, zonder aanloop. Het hoofdzoekwoord staat in de eerste 100 woorden. Daarna kort waarom dit belangrijk is voor de lezer en wat hij in het artikel leert.",
      summaryInstruction(input.partnerHabits ?? null),
      "4. Daarna de H2- en H3-secties ('## ' en '### '), één duidelijk onderwerp per sectie, met het hoofdzoekwoord in ongeveer een derde van de H2-koppen.",
      faqInstruction(input.partnerHabits ?? null),
      closingInstruction(input.partnerHabits ?? null),
    ].join("\n"),
    "Leesbaarheid: alinea's van hooguit 4 zinnen, gemiddeld niet meer dan 20 woorden per zin, actieve zinnen, gewone woorden.",
    "Vermijd standaardzinnen die als AI-tekst klinken, zoals 'in de wereld van', 'in de huidige digitale wereld', 'het is belangrijk om te weten', 'laten we eens kijken', 'duiken in', 'speelt een cruciale rol', 'het is geen geheim dat', 'naadloos', 'baanbrekend', 'gamechanger' en 'niet alleen … maar ook'.",
    "meta_title is 50 tot 60 tekens en bevat het hoofdzoekwoord. meta_description is 140 tot 160 tekens en geeft zelf al het antwoord in plaats van alleen nieuwsgierig te maken.",
    "Gebruik het hoofdzoekwoord natuurlijk, relevante secundaire zoekwoorden zonder keyword stuffing, en gebruik de vragen van zoekers als H2/H3-kop of in de tekst wanneer dat nuttig is.",
    "Geen herhaling: leg elk feit (prijs, garantie, locaties, levering) één keer uit, op de plek waar het hoort. Alleen een samenvattingsblok (als dat er mag zijn) mag samenvatten. Een FAQ-antwoord herhaalt een sectie niet, maar verwijst kort of voegt iets toe.",
    "Zoekwoorden alleen in natuurlijk, correct Nederlands. Schrijf nooit omgedraaide of losse zoekwoordvarianten letterlijk uit (dus 'een Gazelle e-bike voor heren', niet 'e bike gazelle heren'). Liever een variant overslaan dan een rare zin.",
    "Gebruik geen verzonnen personen, voorbeelden of anekdotes ('Toen Sarah…'). Concreet maken doe je met echte details uit het profiel.",
    "Zet één passende call-to-action halverwege het artikel (bijvoorbeeld bij de sectie over de dienst zelf), niet alleen aan het eind.",
    "Verzin nooit feiten, producten, diensten, prijzen of locaties en doe geen onbewezen claims. Gebruik geen generieke AI-tekst.",
    "Noem in het artikel nooit Semrush, Claude, Limey, Yellowlime AI Agent of briefing. Concurrenten en hun URL's zijn uitsluitend context: kopieer nooit hun tekst, structuur of claims.",
    "primary_keyword moet exact het opgegeven hoofdzoekwoord zijn. Als SEO-onderzoek ontbreekt, is dit het briefingonderwerp. secondary_keywords_used en questions_answered mogen uitsluitend waarden uit de toegestane lijsten bevatten.",
  ].join("\n\n");
}

/** A questions section only when the partner has one itself. */
function faqInstruction(habits: PartnerHabits | null): string {
  if (habits?.faq.used) {
    const label = habits.faq.label ?? "Veelgestelde vragen";
    return `5. De partner gebruikt zelf een vragenblok ('${label}'). Zet daarom na de secties '## ${label}' met 3 tot 5 vragen als '### ' kop, geformuleerd zoals mensen ze aan Google stellen, elk met een antwoord van 2 tot 4 zinnen. Gebruik eerst de toegestane vragen.`;
  }
  return "5. GEEN vragenblok: de partner gebruikt in zijn eigen teksten nooit een kop als 'Veelgestelde vragen' of 'FAQ'. Schrijf dat blok dus niet. Beantwoord de belangrijkste vragen van zoekers in de gewone secties, bijvoorbeeld als H2- of H3-kop in de vorm van een vraag, waar dat natuurlijk past.";
}

/** A closing section only when the partner ends texts like that itself. */
function closingInstruction(habits: PartnerHabits | null): string {
  if (habits?.closing.used) {
    const label = habits.closing.label ?? "Tot slot";
    return `6. De partner sluit zijn teksten af met een kop '${label}'. Sluit daarom af met '## ${label}' en hooguit 3 zinnen die iets toevoegen: een concrete volgende stap bij de partner, geen herhaling van wat er al staat. Zet die tekst ook in conclusion.`;
  }
  return "6. GEEN afsluitende kop: de partner gebruikt geen 'Conclusie', 'Tot slot' of iets vergelijkbaars. Het artikel stopt als de vraag beantwoord is. Hooguit 2 of 3 zinnen aan het eind van de laatste sectie met een concrete volgende stap bij de partner (zet die ook in conclusion), of niets; dan blijft conclusion leeg.";
}

/** A summary block only when the partner uses one itself, with their own words. */
function summaryInstruction(habits: PartnerHabits | null): string {
  if (habits?.summary.used) {
    const label = habits.summary.label ?? "In het kort";
    return `3. De partner gebruikt in zijn eigen teksten een samenvattingsblok ('${label}'). Zet daarom direct na de inleiding zo'n blok als blockquote: de regel '> **${label}**' en daarna 3 tot 5 regels '> - ' met de belangrijkste punten van het artikel, elk concreet en op zichzelf te begrijpen. Alleen feiten uit het profiel of het onderzoek.`;
  }
  return "3. GEEN samenvattingsblok: de partner gebruikt in zijn eigen teksten nooit een blok als 'In het kort', 'Samenvatting' of 'Key takeaways'. Schrijf het dus ook niet, ook niet onder een andere naam. Ga na de inleiding direct door naar de eerste sectie.";
}

/** Turns the partner's own writing rules from the approved profile into instructions. */
function partnerStyleRules(profile: Record<string, unknown>): string {
  const pick = (...keys: string[]) => keys
    .map((k) => profile[k])
    .map((v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").join(", ") : typeof v === "string" ? v : ""))
    .filter((v) => v.trim())
    .join(" · ");
  const lines = [
    ["Toon", pick("tone", "toneOfVoice", "toon")],
    ["Schrijfstijl", pick("writingStyle", "schrijfstijl", "style")],
    ["Doelgroep", pick("targetAudience", "audience", "doelgroep")],
    ["Aanspreekvorm", pick("formOfAddress", "aanspreekvorm")],
    ["Wel doen", pick("dos", "do", "welDoen")],
    ["Niet doen", pick("donts", "dont", "nietDoen", "avoid")],
  ].filter(([, v]) => v);
  return [
    "SCHRIJFREGELS VAN DEZE PARTNER (deze gaan vóór de algemene regels hieronder; elke partner schrijft anders):",
    ...(lines.length ? lines.map(([k, v]) => `- ${k}: ${v}`) : ["- Leid toon, aanspreekvorm (je of u), doelgroep en stijl af uit het partnerprofiel en de voorbeeldtekst."]),
    "- Neem de aanspreekvorm, zinslengte en woordkeus van de voorbeeldtekst over. Klinkt de partner zakelijk, schrijf dan zakelijk; klinkt hij informeel, schrijf dan informeel.",
    "- Schrijf zoals een vakman van deze partner het een klant zou uitleggen, niet als een algemene SEO-tekst.",
  ].join("\n");
}

/** What Search Console shows about the partner's own website, as instructions. */
export function searchConsoleBlock(gsc: SearchConsoleContext | null, primaryKeyword: string): string {
  if (!gsc || (!gsc.relatedQueries.length && !gsc.pages.length)) {
    return "Er zijn geen Search Console-gegevens van de website beschikbaar.";
  }
  const out = ["GEGEVENS UIT GOOGLE SEARCH CONSOLE VAN DE EIGEN WEBSITE VAN DE PARTNER:"];
  if (gsc.relatedQueries.length) {
    out.push(
      "Zoekopdrachten waarop de website nu al in Google verschijnt (zoekopdracht · klikken · vertoningen · positie). Gebruik deze bewoordingen waar ze natuurlijk passen: zo zoeken de klanten van deze partner echt.",
      ...gsc.relatedQueries.map((q) => `- ${q.query} · ${q.clicks} · ${q.impressions} · ${q.position.toFixed(1)}`),
    );
  }
  if (gsc.pages.length) {
    out.push(
      "Bestaande pagina's van de website die bezoekers uit Google krijgen. Zet 2 tot 4 interne links in het artikel (markdown [tekst](url)) naar pagina's uit deze lijst die echt aansluiten. Link nooit naar een URL die niet in deze lijst staat.",
      ...gsc.pages.map((p) => `- ${p.url}`),
    );
  }
  if (gsc.existingPageForKeyword) {
    out.push(`Let op: de pagina ${gsc.existingPageForKeyword.url} staat al op positie ${gsc.existingPageForKeyword.position.toFixed(1)} voor "${primaryKeyword}". Schrijf een andere invalshoek die die pagina aanvult in plaats van ermee te concurreren, en link er één keer naar.`);
  }
  return out.join("\n");
}

/** Second pass, like an editor: same JSON back, tighter and more human. */
export function makeEditorPrompt(articleJson: string, input: ArticleGenerationInput): string {
  return [
    "Je bent eindredacteur van een Nederlands webbureau. Hieronder staat een conceptartikel als JSON. Verbeter het en geef UITSLUITEND hetzelfde JSON-schema terug, zonder markdown eromheen.",
    "Controleer en herstel:",
    "1. Herhaling: komt een feit (prijs, garantie, locatie, levering, werkwijze) vaker dan één keer voor buiten het samenvattingsblok (als dat er is), schrap dan de herhalingen.",
    "2. Afsluiting: een samenvatting aan het eind die alleen herhaalt, schrap je.",
    "3. Zoekwoorden: herschrijf elke zin waarin een zoekwoord onnatuurlijk of grammaticaal fout staat (zoals 'e bike gazelle heren').",
    "4. AI-taal: schrap vage openers, holle overgangen ('Daarnaast', 'Bovendien', 'Kortom'), opvulzinnen en alles wat zo in elk ander artikel kan staan.",
    "5. Toon: het moet klinken als de partner zelf. Volg de schrijfregels van de partner hieronder en de voorbeeldtekst.",
    "6. Feiten: voeg geen nieuwe feiten, cijfers, personen of links toe. Laat bestaande interne links staan.",
    input.partnerHabits?.summary.used ? "Laat het samenvattingsblok staan." : "Deze partner gebruikt nooit een samenvattingsblok: staat er toch een blok als 'In het kort' of 'Samenvatting', schrap het dan helemaal.",
    input.partnerHabits?.faq.used ? "Laat het vragenblok staan." : "Deze partner gebruikt nooit een vragenblok: staat er toch een kop als 'Veelgestelde vragen' of 'FAQ', verwerk de belangrijkste vragen dan in de secties en schrap het blok.",
    input.partnerHabits?.closing.used ? "" : "Deze partner gebruikt geen afsluitende kop: schrap een kop als 'Conclusie' of 'Tot slot' en laat hooguit 2 of 3 zinnen met een volgende stap over.",
    "Houd de titel, het hoofdzoekwoord en de koppen in principe zoals ze zijn; verander alleen wat beter moet. Werk full_article, sections, introduction en conclusion consequent bij, zodat ze dezelfde tekst bevatten.",
    partnerStyleRules(cloneSnapshot(input.approvedPartnerProfile)),
    input.styleSample ? `Voorbeeldtekst van de partner:\n"""\n${input.styleSample}\n"""` : "",
    "Conceptartikel:",
    articleJson,
  ].filter(Boolean).join("\n\n");
}

/** The JSON object in Claude's answer, without ```json fences or text around it. */
export function extractJson(raw: string): string {
  const text = raw.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
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
  // Be forgiving about small slips (extra fields, a missing full text or
  // keyword lists): only a missing title, text or meta fails the attempt.
  if (!stringArray(input.secondary_keywords_used)) input.secondary_keywords_used = [];
  if (!stringArray(input.questions_answered)) input.questions_answered = [];
  if (!nonEmptyString(input.primary_keyword) || input.primary_keyword.trim().toLowerCase() === primaryKeyword.toLowerCase()) {
    input.primary_keyword = primaryKeyword;
  }
  if (!nonEmptyString(input.full_article) && Array.isArray(input.sections)) {
    input.full_article = [
      input.introduction,
      ...input.sections.map((sec) => {
        const x = (sec ?? {}) as Record<string, unknown>;
        return `${x.heading_level === "H3" ? "###" : "##"} ${String(x.heading ?? "")}\n\n${String(x.content ?? "")}`;
      }),
      input.conclusion,
    ].filter((v) => typeof v === "string" && v.trim()).join("\n\n");
  }
  if (
    !nonEmptyString(input.title) ||
    !nonEmptyString(input.introduction) ||
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
  // Keep only keywords and questions that were really supplied.
  const keywordsUsed = input.secondary_keywords_used.filter((value) => allowedKeywords.has(value));
  const questionsUsed = input.questions_answered.filter((value) => allowedQuestions.has(value));
  if (typeof input.conclusion !== "string") input.conclusion = "";
  const sections: ArticleSectionContent[] = [];
  for (const section of input.sections) {
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      throw new Error("invalid_article_shape");
    }
    const item = section as Record<string, unknown>;
    if (
      !nonEmptyString(item.heading) ||
      !nonEmptyString(item.content)
    ) {
      throw new Error("invalid_article_shape");
    }
    sections.push({
      heading: item.heading,
      headingLevel: item.heading_level === "H3" ? "H3" : "H2",
      content: item.content,
    });
  }
  if (sections.length === 0) throw new Error("empty_article");
  return {
    title: input.title,
    introduction: input.introduction,
    sections,
    conclusion: String(input.conclusion ?? ""),
    fullArticle: input.full_article,
    metaTitle: input.meta_title,
    metaDescription: input.meta_description,
    primaryKeyword: input.primary_keyword,
    secondaryKeywordsUsed: keywordsUsed,
    questionsAnswered: questionsUsed,
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
        decoded = JSON.parse(extractJson(raw));
      } catch {
        throw new Error("invalid_article_json");
      }
      const draft = parseArticleResponse(decoded, primaryKeyword, allowedKeywords, allowedQuestions);
      // Editor pass: if it fails or returns something unusable, keep the draft.
      try {
        const edited = await runner(makeEditorPrompt(extractJson(raw), input), timeoutMs);
        return parseArticleResponse(JSON.parse(extractJson(edited)), primaryKeyword, allowedKeywords, allowedQuestions);
      } catch {
        return draft;
      }
    } catch (error) {
      lastError = error;
      if (attempt === 1) break;
      raw = await runner(repairPrompt(raw), timeoutMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("invalid_article_json");
}