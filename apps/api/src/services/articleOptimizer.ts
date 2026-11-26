/**
 * Optimising an existing article: the AI reads the article as it is on the
 * website, its Search Console figures and the top 5 in Google for its main
 * search, and rewrites it. It returns the improved article plus an overview
 * of every change and why. Facts come only from the article itself and the
 * partner profile; nothing is invented.
 */
import { extractJson, partnerStyleRules } from "./articleGeneration";
import { lessonsBlock } from "./learning";
import { defaultClaudeTextRunner, NO_TIME_LIMIT, type ClaudeTextRunner } from "./claudeRunner";
import type { Underperformer } from "./underperformers";

export interface OptimizationChange {
  type: "titel" | "meta" | "inleiding" | "structuur" | "inhoud" | "zoekwoorden" | "verwijderd" | "toegevoegd" | "actualiteit" | "leesbaarheid" | "overig";
  section: string | null;
  before: string | null;
  after: string | null;
  reason: string;
}

export interface OptimizationOverview {
  diagnosis: string;
  mainKeyword: string;
  changes: OptimizationChange[];
  expectedEffect: string;
  checkBeforePublishing: string[];
}

export interface OptimizationOutput {
  result: { title: string; metaTitle: string; metaDescription: string; fullArticle: string };
  overview: OptimizationOverview;
}

export function makeOptimizationPrompt(input: {
  partnerName: string;
  profile: Record<string, unknown>;
  analysis: Underperformer;
  original: { title: string; metaTitle: string; metaDescription: string; fullArticle: string; wordCount: number };
  serp: string | null;
  research: { keyword: string; volume: number | null; related: string[]; questions: string[] } | null;
  lessons: { partner: string[]; general: string[] } | null;
}): string {
  const a = input.analysis;
  return [
    `Je bent een ervaren SEO-redacteur bij Yellowlime. Je optimaliseert een BESTAAND artikel op de website van ${input.partnerName} dat slecht presteert in Google. Het blijft hetzelfde artikel op dezelfde URL: verbeter het, schrijf geen nieuw artikel over een ander onderwerp.`,
    "WERKWIJZE",
    "1. Stel eerst vast waarom het artikel slecht presteert. Gebruik de cijfers uit Search Console, de zoekopdrachten waarop het verschijnt, en vergelijk met de top 5 in Google (opbouw, onderwerpen, lengte).",
    "2. Bepaal het hoofdzoekwoord: meestal de zoekopdracht met de meeste vertoningen voor deze pagina, tenzij een andere beter past bij het onderwerp.",
    "3. Herschrijf waar nodig: titel en metatekst als mensen weinig klikken; inleiding met direct antwoord; ontbrekende onderwerpen die de top 5 wel behandelt; verouderde of vage stukken; structuur en koppen; zoekwoorden natuurlijk verwerken.",
    "4. Behoud wat goed is. Verander niets zonder reden. Laat bestaande feiten, prijzen, namen en links staan tenzij ze aantoonbaar onjuist of verouderd zijn; markeer twijfel dan in checkBeforePublishing in plaats van zelf iets te verzinnen.",
    "5. Voeg alleen feiten toe die in het partnerprofiel of in het artikel zelf staan. Verzin geen cijfers, prijzen, jaartallen, klanten of ervaringen.",
    "6. Leg ELKE wijziging vast in changes: wat (type), waar (sectie), het stukje ervoor en erna (elk hooguit 200 tekens, null als iets nieuw is of weg is) en waarom, in één zin die een Yellowlimer begrijpt. Groepeer kleine taalaanpassingen in één change.",
    "7. Volg de vaste opbouw van de partner: neem alleen een samenvatting, vragenblok of afsluitende kop op als het originele artikel of de partner die gebruikt. Geen typische AI-zinnen.",
    partnerStyleRules(input.profile),
    lessonsBlock(input.lessons),
    `PARTNERPROFIEL (enige bron voor nieuwe feiten):\n${JSON.stringify(input.profile).slice(0, 12_000)}`,
    `SEARCH CONSOLE (afgelopen 90 dagen) voor ${a.url}:\nklikken ${a.clicks} (90 dagen daarvoor: ${a.previousClicks}), vertoningen ${a.impressions}, CTR ${(a.ctr * 100).toFixed(1)}%, gemiddelde positie ${a.position}\nGevonden problemen:\n${a.reasons.map((r) => `- ${r.text}`).join("\n")}\nZoekopdrachten waarop dit artikel verschijnt (zoekopdracht · klikken · vertoningen · positie):\n${a.topQueries.map((q) => `- ${q.query} · ${q.clicks} · ${q.impressions} · ${q.position}`).join("\n") || "- geen"}`,
    input.research ? `SEMRUSH voor "${input.research.keyword}": ${input.research.volume ?? "?"} zoekopdrachten per maand.\nVerwante zoekwoorden: ${input.research.related.join(", ") || "geen"}\nVragen van zoekers: ${input.research.questions.join(" | ") || "geen"}` : "Geen Semrush-gegevens beschikbaar.",
    input.serp ? `TOP 5 IN GOOGLE voor het hoofdzoekwoord:\n${input.serp}` : "De top 5 in Google kon niet worden bekeken.",
    `HUIDIGE METATITEL: ${input.original.metaTitle}\nHUIDIGE METABESCHRIJVING: ${input.original.metaDescription}`,
    `HUIDIG ARTIKEL (${input.original.wordCount} woorden):\n"""\n${input.original.fullArticle.slice(0, 60_000)}\n"""`,
    "Geef UITSLUITEND dit JSON-object terug (fullArticle in markdown met # titel, ## en ### koppen, alinea's met een lege regel ertussen, lijsten met '- '):",
    JSON.stringify({
      result: { title: "", metaTitle: "50-60 tekens", metaDescription: "140-160 tekens", fullArticle: "" },
      overview: {
        diagnosis: "2-4 zinnen: waarom presteerde het artikel slecht",
        mainKeyword: "",
        changes: [{ type: "titel|meta|inleiding|structuur|inhoud|zoekwoorden|verwijderd|toegevoegd|actualiteit|leesbaarheid|overig", section: "kop of null", before: "of null", after: "of null", reason: "" }],
        expectedEffect: "1-2 zinnen, zonder beloftes of verzonnen cijfers",
        checkBeforePublishing: ["punten die een mens moet nakijken, zoals een feit dat mogelijk verouderd is"],
      },
    }),
  ].filter(Boolean).join("\n\n");
}

const TYPES = new Set(["titel", "meta", "inleiding", "structuur", "inhoud", "zoekwoorden", "verwijderd", "toegevoegd", "actualiteit", "leesbaarheid", "overig"]);

export function parseOptimization(raw: string): OptimizationOutput {
  const data = JSON.parse(extractJson(raw)) as { result?: Record<string, unknown>; overview?: Record<string, unknown> };
  const s = (v: unknown, n = 200_000) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const r = data.result ?? {};
  const result = { title: s(r.title, 300), metaTitle: s(r.metaTitle, 300), metaDescription: s(r.metaDescription, 1000), fullArticle: s(r.fullArticle) };
  if (!result.fullArticle || !result.title) throw new Error("invalid_optimization");
  const o = data.overview ?? {};
  const changes = (Array.isArray(o.changes) ? o.changes : []).map((c: Record<string, unknown>) => ({
    type: (TYPES.has(String(c.type)) ? c.type : "overig") as OptimizationChange["type"],
    section: s(c.section, 200) || null,
    before: s(c.before, 400) || null,
    after: s(c.after, 400) || null,
    reason: s(c.reason, 500),
  })).filter((c: OptimizationChange) => c.reason).slice(0, 40);
  return {
    result,
    overview: {
      diagnosis: s(o.diagnosis, 1500),
      mainKeyword: s(o.mainKeyword, 120),
      changes,
      expectedEffect: s(o.expectedEffect, 600),
      checkBeforePublishing: (Array.isArray(o.checkBeforePublishing) ? o.checkBeforePublishing : []).map((x: unknown) => s(x, 300)).filter(Boolean).slice(0, 12),
    },
  };
}

export async function optimizeArticle(input: Parameters<typeof makeOptimizationPrompt>[0], runner: ClaudeTextRunner = defaultClaudeTextRunner): Promise<OptimizationOutput> {
  const prompt = makeOptimizationPrompt(input);
  const raw = await runner(prompt, NO_TIME_LIMIT);
  try {
    return parseOptimization(raw);
  } catch {
    // One repair attempt when the JSON was broken.
    const repaired = await runner(`${prompt}\n\nJe vorige antwoord was geen geldig JSON-object. Geef nu uitsluitend het JSON-object volgens het schema.`, NO_TIME_LIMIT);
    return parseOptimization(repaired);
  }
}
