import type { PartnerProfileContent } from "./claudePartnerProfile";

/**
 * Builds (parts of) a partner profile from the partner's own website.
 *
 * Every field gets its own instructions so Claude reasons from concrete
 * signals on the website instead of guessing. Each answer has to come with
 * short verbatim quotes from the pages; quotes that cannot be found in the
 * pages are dropped, facts that do not appear on the website are removed, and
 * a field without evidence is left empty instead of being filled in.
 */

export const PROFILE_GENERATION_PROMPT_VERSION = "partner-profile-fields-v1";

export type GeneratableField =
  | "companyName"
  | "companyDescription"
  | "products"
  | "services"
  | "targetAudience"
  | "toneOfVoice"
  | "writingStyle"
  | "importantFacts"
  | "locations";

export type FieldKind = "fact" | "insight";

interface FieldSpec {
  label: string;
  kind: FieldKind;
  scalar: boolean;
  maxItems?: number;
  guide: string;
}

export const FIELD_SPECS: Record<GeneratableField, FieldSpec> = {
  companyName: {
    label: "Bedrijfsnaam",
    kind: "fact",
    scalar: true,
    guide:
      "De naam waarmee het bedrijf zichzelf op de website noemt (titel, over-ons-tekst, contactgegevens). Geen slogan, geen domeinnaam tenzij dat echt de merknaam is.",
  },
  companyDescription: {
    label: "Bedrijfsomschrijving",
    kind: "fact",
    scalar: true,
    guide:
      "Twee tot drie zinnen: wat het bedrijf doet, voor wie, en wat het volgens de eigen website onderscheidt. Alleen wat de website zelf zegt, geen eigen superlatieven.",
  },
  products: {
    label: "Producten",
    kind: "fact",
    scalar: false,
    maxItems: 12,
    guide:
      "Concrete producten of productcategorieën die op de website worden verkocht of aangeboden, zoals ze daar genoemd worden. Bij een dienstverlener of installateur: de concrete systemen, installaties, oplossingen of vaste pakketten die worden geleverd (bijv. warmtepompen, sprinklerinstallaties, een energiescan). Algemene diensten zoals advies of onderhoud horen bij Diensten.",
  },
  services: {
    label: "Diensten",
    kind: "fact",
    scalar: false,
    maxItems: 12,
    guide:
      "Diensten die het bedrijf uitvoert (bijv. advies, installatie, onderhoud, reparatie, bezorging, workshops), zoals op de website genoemd.",
  },
  targetAudience: {
    label: "Doelgroep",
    kind: "insight",
    scalar: false,
    maxItems: 5,
    guide: [
      "Leid de doelgroep af uit concrete signalen en schrijf 2 tot 5 korte, specifieke punten die een schrijver direct kan gebruiken.",
      "Kijk naar: zakelijk (B2B) of particulier (B2C); levensfase, leeftijd of beroep; regio; kennisniveau (beginner of expert, hoeveel uitleg en jargon);",
      "prijsniveau; behoeften, problemen en vragen die de website beantwoordt; letterlijke 'voor wie'-teksten, klantverhalen en reviews; aanspreekvorm.",
      "Niet: algemene zinnen als 'mensen die interesse hebben in X'. Wel bijvoorbeeld: 'Particulieren (40+) die een e-bike zoeken voor woon-werkverkeer en veel uitleg willen over actieradius'.",
    ].join(" "),
  },
  toneOfVoice: {
    label: "Tone of voice",
    kind: "insight",
    scalar: false,
    maxItems: 6,
    guide: [
      "Beschrijf in 3 tot 6 punten HOE het merk klinkt, telkens met een concrete observatie.",
      "Kijk naar: aanspreekvorm (je/jij of u; zie de tekstsignalen), formeel of informeel, zakelijk of persoonlijk, enthousiast of rustig,",
      "humor, uitroeptekens en emoji, wij-perspectief ('wij', 'ons team'), hoe stellig het merk is, hoe de call-to-actions klinken.",
      "Niet: lege woorden als 'professioneel en vriendelijk'. Wel: 'Spreekt de lezer consequent aan met je, informeel maar zonder spreektaal'.",
    ].join(" "),
  },
  writingStyle: {
    label: "Schrijfstijl",
    kind: "insight",
    scalar: false,
    maxItems: 6,
    guide: [
      "Beschrijf in 3 tot 6 punten hoe de teksten zijn opgebouwd, zodat een schrijver dit kan nadoen. Gebruik bij voorkeur de blog- of artikelpagina's.",
      "Kijk naar: zinslengte en alinealengte (zie de tekstsignalen), gebruik van tussenkoppen, opsommingen en vragen, vakjargon of juist uitleg,",
      "actief of passief schrijven, opbouw van artikelen (intro, tips, conclusie, call-to-action), gebruik van getallen en voorbeelden.",
      "Zeg erbij als er geen blogpagina's waren en je de stijl afleidt van gewone pagina's.",
    ].join(" "),
  },
  importantFacts: {
    label: "Belangrijke feiten",
    kind: "fact",
    scalar: false,
    maxItems: 10,
    guide:
      "Controleerbare feiten die een schrijver juist moet vermelden: oprichtingsjaar, aantal winkels of medewerkers, keurmerken, garanties, levertijden, vaste USP's (bijv. gratis verzending vanaf een bedrag). Geen tijdelijke acties of prijzen die snel verlopen.",
  },
  locations: {
    label: "Locaties",
    kind: "fact",
    scalar: false,
    maxItems: 10,
    guide: "Vestigingen, winkels, plaatsen of het werkgebied, alleen zoals letterlijk op de website genoemd.",
  },
};

export const GENERATABLE_FIELDS = Object.keys(FIELD_SPECS) as GeneratableField[];

export interface SourcePage {
  url: string;
  title: string;
  text: string;
}

export interface Evidence {
  quote: string;
  url: string;
}

export interface GeneratedField {
  field: GeneratableField;
  text: string | null;
  items: string[];
  evidence: Evidence[];
  confidence: "hoog" | "middel" | "laag";
  note: string | null;
}

export interface GeneratedProfile {
  fields: GeneratedField[];
  sourceUrls: string[];
  missingInformation: string[];
}

// ---------------------------------------------------------------- text signals

const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-ZÀ-Ý0-9"'“])/u;

/** Simple, objective style signals per page that help Claude judge tone and style. */
export function textSignals(text: string) {
  const words = text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  const count = (set: string[]) => words.filter((w) => set.includes(w)).length;
  const sentences = text.split(SENTENCE_SPLIT).filter((s) => s.trim().split(/\s+/).length >= 3);
  const avgSentence = sentences.length
    ? Math.round(sentences.reduce((sum, s) => sum + s.trim().split(/\s+/).length, 0) / sentences.length)
    : 0;
  return {
    words: words.length,
    jeJij: count(["je", "jij", "jou", "jouw", "jullie"]),
    uUw: count(["u", "uw"]),
    wijOns: count(["wij", "we", "ons", "onze"]),
    exclamations: (text.match(/!/g) ?? []).length,
    questions: (text.match(/\?/g) ?? []).length,
    avgSentenceWords: avgSentence,
  };
}

export function isArticlePage(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return /\/(blog|nieuws|news|artikel|artikelen|kennisbank|tips|magazine|inspiratie|verhalen)\//.test(`${path}/`) &&
      path.split("/").filter(Boolean).length >= 2;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------- prompt

const MAX_PROMPT_TEXT = 60_000;

function pagesBlock(pages: SourcePage[]): string {
  let remaining = MAX_PROMPT_TEXT;
  return pages
    .map((page) => {
      const text = page.text.slice(0, Math.max(0, Math.min(page.text.length, remaining, 14_000)));
      remaining -= text.length;
      const s = textSignals(page.text);
      const kind = isArticlePage(page.url) ? "blog/artikel" : "pagina";
      return [
        `BRON: ${page.url} (${kind})`,
        `TITEL: ${page.title}`,
        `TEKSTSIGNALEN: ${s.words} woorden; je/jij/jouw ${s.jeJij}x; u/uw ${s.uUw}x; wij/ons ${s.wijOns}x; ` +
          `uitroeptekens ${s.exclamations}; vragen ${s.questions}; gemiddelde zinslengte ${s.avgSentenceWords} woorden`,
        `TEKST:\n${text}`,
      ].join("\n");
    })
    .filter((block) => !block.endsWith("TEKST:\n"))
    .join("\n\n---\n\n");
}

export function makeProfileFieldsPrompt(
  companyName: string,
  websiteUrl: string,
  fields: GeneratableField[],
  pages: SourcePage[],
): string {
  const fieldLines = fields.map((field) => {
    const spec = FIELD_SPECS[field];
    const shape = spec.scalar ? '"text": string of null' : `"items": lijst van maximaal ${spec.maxItems} korte strings`;
    const kind = spec.kind === "fact" ? "FEIT (alleen wat letterlijk op de website staat)" : "INZICHT (afleiden uit concrete signalen)";
    return `- ${field} (${spec.label}) — ${kind}; ${shape}.\n  ${spec.guide}`;
  });
  return [
    `Prompt version: ${PROFILE_GENERATION_PROMPT_VERSION}`,
    "Je bent een ervaren contentstrateeg bij een Nederlands SEO-bureau. Je analyseert de website van een partner zodat schrijvers artikelen kunnen maken die klinken alsof de partner ze zelf schreef.",
    `Partner: ${companyName}. Website: ${websiteUrl}.`,
    "Regels:",
    "1. Gebruik alleen de pagina's hieronder. Verzin niets en vul niets aan met algemene kennis over de branche.",
    "2. Onderbouw elk veld met 1 tot 3 LETTERLIJKE citaten (maximaal 20 woorden, precies zoals in de tekst) en de bron-URL waar het citaat staat.",
    "3. Probeer elk gevraagd veld in te vullen; zoek daarvoor over alle pagina's heen. Alleen als er echt niets over op de website staat: geef een lege waarde (null of []), lege evidence, confidence \"laag\" en leg in note kort uit wat er ontbreekt.",
    "4. Schrijf in het Nederlands. Wees specifiek en bruikbaar voor een schrijver; vermijd vage marketingtaal.",
    "5. confidence: \"hoog\" als het letterlijk of duidelijk op meerdere plekken staat, \"middel\" als het een redelijke afleiding is, \"laag\" als het onzeker is.",
    "Velden:",
    ...fieldLines,
    "Antwoord met alleen JSON in deze vorm:",
    '{"fields": {"<veldnaam>": {"text": null, "items": [], "evidence": [{"quote": "...", "url": "..."}], "confidence": "hoog", "note": null}}, "missing_information": ["..."]}',
    "Gebruik voor elk gevraagd veld precies één entry. missing_information: korte Nederlandse punten over belangrijke informatie die niet op de website te vinden was.",
    "PAGINA'S:",
    pagesBlock(pages),
  ].join("\n\n");
}

// ------------------------------------------------------------------ validation

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("nl-NL")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’“”"'`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** True when the quote (or a run of at least five of its words) appears in the text. */
export function quoteAppears(quote: string, normalizedText: string): boolean {
  const q = normalize(quote);
  if (!q) return false;
  if (normalizedText.includes(q)) return true;
  const words = q.split(" ");
  if (words.length < 5) return false;
  for (let i = 0; i + 5 <= words.length; i++) {
    if (normalizedText.includes(words.slice(i, i + 5).join(" "))) return true;
  }
  return false;
}

const STOP = new Set(["de", "het", "een", "en", "of", "van", "voor", "met", "in", "op", "te", "aan", "bij", "naar", "door", "tot", "om", "als", "is", "zijn", "wordt", "the", "and", "for", "of"]);

/** A fact item counts as found when most of its meaningful words occur on the website. */
export function factAppears(item: string, normalizedText: string, textWords: Set<string>): boolean {
  const n = normalize(item);
  if (!n) return false;
  if (normalizedText.includes(n)) return true;
  const words = n.split(" ").filter((w) => w.length > 2 && !STOP.has(w));
  if (words.length === 0) return false;
  const found = words.filter((w) => textWords.has(w) || [...textWords].some((t) => t.length > 4 && (t.startsWith(w) || w.startsWith(t))));
  return found.length / words.length >= 0.6;
}

function parseJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/i);
  const body = fenced ? fenced[1] : trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1);
  return JSON.parse(body);
}

const asString = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim()) : [];

export function parseGeneratedProfile(raw: string, fields: GeneratableField[], pages: SourcePage[]): GeneratedProfile {
  let decoded: unknown;
  try {
    decoded = parseJson(raw);
  } catch {
    throw new Error("invalid_claude_json");
  }
  if (!decoded || typeof decoded !== "object") throw new Error("invalid_claude_json");
  const root = decoded as Record<string, unknown>;
  const rawFields = (root.fields && typeof root.fields === "object" ? root.fields : {}) as Record<string, unknown>;

  const byUrl = new Map(pages.map((page) => [page.url, normalize(`${page.title} ${page.text}`)]));
  const allText = [...byUrl.values()].join(" ");
  const allWords = new Set(allText.split(" "));

  const result: GeneratedField[] = fields.map((field) => {
    const spec = FIELD_SPECS[field];
    const entry = (rawFields[field] && typeof rawFields[field] === "object" ? rawFields[field] : {}) as Record<string, unknown>;
    const evidence: Evidence[] = (Array.isArray(entry.evidence) ? entry.evidence : [])
      .map((e) => (e && typeof e === "object" ? (e as Record<string, unknown>) : {}))
      .map((e) => ({ quote: asString(e.quote) ?? "", url: asString(e.url) ?? "" }))
      .filter((e) => e.quote && byUrl.has(e.url) && quoteAppears(e.quote, byUrl.get(e.url)!))
      .slice(0, 3);
    let confidence = (["hoog", "middel", "laag"].includes(String(entry.confidence)) ? entry.confidence : "laag") as GeneratedField["confidence"];
    let note = asString(entry.note);
    let text = spec.scalar ? asString(entry.text) : null;
    let items = spec.scalar ? [] : asStrings(entry.items).slice(0, spec.maxItems);

    if (spec.kind === "fact" && !spec.scalar) {
      const kept = items.filter((item) => factAppears(item, allText, allWords));
      if (kept.length < items.length) {
        note = [note, `${items.length - kept.length} punt(en) weggelaten omdat ze niet op de website staan.`].filter(Boolean).join(" ");
      }
      items = kept;
    }
    if (field === "companyName" && text && !factAppears(text, allText, allWords)) {
      text = null;
      note = "De bedrijfsnaam is niet letterlijk op de website gevonden.";
    }
    const hasValue = spec.scalar ? Boolean(text) : items.length > 0;
    if (hasValue && evidence.length === 0) {
      // Without any verifiable quote the answer is not grounded in the website.
      text = null;
      items = [];
      confidence = "laag";
      note = "Te weinig onderbouwing op de website gevonden; vul dit zelf aan.";
    }
    if (!hasValue && !note) note = "Niet op de website gevonden.";
    if (!(spec.scalar ? text : items.length)) confidence = "laag";
    return { field, text, items, evidence, confidence, note };
  });

  const sourceUrls = [...new Set(result.flatMap((f) => f.evidence.map((e) => e.url)))];
  const missing = asStrings(root.missing_information).slice(0, 10);
  for (const f of result) {
    const empty = FIELD_SPECS[f.field].scalar ? !f.text : f.items.length === 0;
    if (empty) {
      const line = `${FIELD_SPECS[f.field].label}: niet op de website gevonden.`;
      if (!missing.some((m) => m.toLowerCase().startsWith(FIELD_SPECS[f.field].label.toLowerCase()))) missing.push(line);
    }
  }
  return { fields: result, sourceUrls, missingInformation: missing };
}

export type TextRunner = (input: string, timeoutMs: number) => Promise<string>;

export async function generateProfileFields(
  input: { companyName: string; websiteUrl: string; fields: GeneratableField[]; pages: SourcePage[] },
  runner: TextRunner,
  timeoutMs = 150_000,
): Promise<GeneratedProfile> {
  const raw = await runner(makeProfileFieldsPrompt(input.companyName, input.websiteUrl, input.fields, input.pages), timeoutMs);
  return parseGeneratedProfile(raw, input.fields, input.pages);
}

export function isEmptyField(field: GeneratedField): boolean {
  return FIELD_SPECS[field.field].scalar ? !field.text : field.items.length === 0;
}

/**
 * Filling all fields in one go makes Claude more cautious than asking about a
 * single field. Fields that stay empty are therefore asked again, each on its
 * own (in parallel), and the answers are merged into the first result.
 */
export function mergeRetries(first: GeneratedProfile, retries: GeneratedProfile[]): GeneratedProfile {
  const better = new Map<GeneratableField, GeneratedField>();
  for (const retry of retries) {
    for (const field of retry.fields) if (!isEmptyField(field)) better.set(field.field, field);
  }
  const fields = first.fields.map((field) => (isEmptyField(field) && better.has(field.field) ? better.get(field.field)! : field));
  const filledLabels = [...better.keys()].map((key) => FIELD_SPECS[key].label.toLowerCase());
  return {
    fields,
    sourceUrls: [...new Set([...first.sourceUrls, ...[...better.values()].flatMap((f) => f.evidence.map((e) => e.url))])],
    missingInformation: first.missingInformation.filter((line) => !filledLabels.some((label) => line.toLowerCase().startsWith(label))),
  };
}

export async function generateAllProfileFields(
  input: { companyName: string; websiteUrl: string; pages: SourcePage[] },
  runner: TextRunner,
): Promise<GeneratedProfile> {
  const first = await generateProfileFields({ ...input, fields: GENERATABLE_FIELDS }, runner);
  const empty = first.fields.filter(isEmptyField).map((f) => f.field);
  if (empty.length === 0) return first;
  const retries = await Promise.all(
    empty.map((field) => generateProfileFields({ ...input, fields: [field] }, runner, 120_000).catch(() => null)),
  );
  return mergeRetries(first, retries.filter((r): r is GeneratedProfile => r !== null));
}

/** Turns a full generation into the stored profile shape. */
export function toProfileContent(generated: GeneratedProfile, fallbackName: string, websiteUrl: string): PartnerProfileContent {
  const get = (field: GeneratableField) => generated.fields.find((f) => f.field === field);
  return {
    companyName: get("companyName")?.text ?? fallbackName,
    companyDescription: get("companyDescription")?.text ?? null,
    products: get("products")?.items ?? [],
    services: get("services")?.items ?? [],
    targetAudience: get("targetAudience")?.items ?? [],
    toneOfVoice: get("toneOfVoice")?.items ?? [],
    writingStyle: get("writingStyle")?.items ?? [],
    importantFacts: get("importantFacts")?.items ?? [],
    locations: get("locations")?.items ?? [],
    sourceUrls: generated.sourceUrls.length ? generated.sourceUrls : [websiteUrl],
    missingInformation: generated.missingInformation,
  };
}
