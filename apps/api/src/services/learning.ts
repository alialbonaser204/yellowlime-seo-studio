/**
 * Self-learning: after a human check the AI compares its own version with the
 * reviewer's version and turns the changes into lessons. The reviewer decides
 * per lesson whether it applies to this partner only or to all partners.
 * Confirmed lessons go into the writing rules of the next articles.
 */
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db, learningLessonsTable } from "@yellowlime/db";
import { defaultClaudeTextRunner, NO_TIME_LIMIT, type ClaudeTextRunner } from "./claudeRunner";
import type { ArticleDifference } from "./articleDiff";

export interface ProposedLesson {
  rule: string;
  explanation: string;
  before: string | null;
  after: string | null;
  suggestedScope: "partner" | "algemeen" | "eenmalig";
  reason: string;
}

const cut = (s: string | null | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : null);

export function makeLessonPrompt(input: {
  partnerName: string;
  before: { fullArticle: string; metaTitle: string; metaDescription: string };
  after: { fullArticle: string; metaTitle: string; metaDescription: string };
  difference: ArticleDifference;
  note: string | null;
  noteScope: string | null;
  knownLessons: { rule: string; scope: string; partnerName: string | null }[];
}): string {
  return [
    "Je bent de leercoach van een AI-schrijfassistent bij het webbureau Yellowlime. Een Yellowlimer heeft een artikel van de AI gecontroleerd en aangepast. Vergelijk heel zorgvuldig de AI-versie met de versie na de controle, en leid af wat de AI hiervan moet leren voor volgende artikelen.",
    `Partner: ${input.partnerName}`,
    "Werkwijze:",
    "1. Lees beide volledige versies. Gebruik de lijst met verschillen als hulp, maar kijk zelf naar het patroon achter de wijzigingen (waarom zou de Yellowlimer dit veranderd hebben?).",
    "2. Bundel wijzigingen met dezelfde reden tot één les. Een les is een algemene schrijfregel, geen eenmalige correctie van dit ene artikel.",
    "3. Een feitelijke correctie die alleen over dit onderwerp gaat (een tikfout, een verkeerd jaartal) is geen les, tenzij er een patroon achter zit (bijvoorbeeld: 'noem geen prijzen').",
    "4. Neem de opmerking van de Yellowlimer zwaar mee; elke duidelijke wens daarin wordt een les.",
    "5. Stel per les voor voor wie hij geldt: 'partner' (smaak of feit van deze partner), 'algemeen' (goed schrijven, geldt overal) of 'eenmalig' (twijfel: waarschijnlijk alleen dit artikel). Kijk naar de al bekende lessen: komt dezelfde les al voor bij andere partners, dan is 'algemeen' waarschijnlijk. Geef een korte reden.",
    "6. Formuleer de regel als korte opdracht aan de AI (hooguit 12 woorden, bijvoorbeeld 'Noem geen prijzen'). De uitleg begint met 'Je' en zegt in één zin wat de Yellowlimer veranderde. Geef een kort voorbeeld: before = stukje AI-tekst, after = wat ervan gemaakt is (of null bij verwijderd/toegevoegd), elk hooguit 160 tekens.",
    "7. Hooguit 6 lessen, de belangrijkste eerst. Geen wijzigingen en geen opmerking: geef een lege lijst.",
    input.note ? `Opmerking van de Yellowlimer: """${input.note}"""${input.noteScope ? ` (de Yellowlimer gaf aan: geldt voor ${input.noteScope === "partner" ? "alleen deze partner" : "alle partners"})` : ""}` : "De Yellowlimer gaf geen opmerking.",
    `Al bekende lessen: ${JSON.stringify(input.knownLessons.slice(0, 60))}`,
    `Statistiek: ${JSON.stringify(input.difference.stats)}`,
    `Metatitel: ${JSON.stringify(input.difference.meta)}`,
    `Verschillen per blok: ${JSON.stringify(input.difference.changes.slice(0, 60).map((c) => ({ type: c.type, kind: c.kind, section: c.section, before: cut(c.before, 600), after: cut(c.after, 600) })))}`,
    `AI-versie:\n"""\n${input.before.fullArticle}\n"""`,
    `Versie na controle:\n"""\n${input.after.fullArticle}\n"""`,
    'Geef UITSLUITEND JSON terug: {"lessons":[{"rule":"","explanation":"","before":"of null","after":"of null","suggestedScope":"partner|algemeen|eenmalig","reason":""}]}',
  ].join("\n\n");
}

export function parseLessons(raw: string): ProposedLesson[] {
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  try {
    const data = JSON.parse(raw.slice(start, end + 1)) as { lessons?: Record<string, unknown>[] };
    const str = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
    return (data.lessons ?? [])
      .map((l) => ({
        rule: str(l.rule, 140) ?? "",
        explanation: str(l.explanation, 400) ?? "",
        before: str(l.before, 300),
        after: str(l.after, 300),
        suggestedScope: (l.suggestedScope === "algemeen" || l.suggestedScope === "eenmalig" ? l.suggestedScope : "partner") as ProposedLesson["suggestedScope"],
        reason: str(l.reason, 300) ?? "",
      }))
      .filter((l) => l.rule)
      .slice(0, 6);
  } catch {
    return [];
  }
}

export async function proposeLessons(
  input: Parameters<typeof makeLessonPrompt>[0],
  runner: ClaudeTextRunner = defaultClaudeTextRunner,
): Promise<ProposedLesson[]> {
  if (!input.difference.changed && !input.note) return [];
  // No time limit: a careful comparison of two long articles may take a while.
  return parseLessons(await runner(makeLessonPrompt(input), NO_TIME_LIMIT));
}

/** Active lessons for writing an article for this partner: its own first, then the general ones. */
export async function lessonsFor(partnerId: number): Promise<{ partner: string[]; general: string[] }> {
  const rows = await db
    .select({ rule: learningLessonsTable.rule, scope: learningLessonsTable.scope, partnerId: learningLessonsTable.partnerId })
    .from(learningLessonsTable)
    .where(and(eq(learningLessonsTable.status, "actief"), or(eq(learningLessonsTable.scope, "algemeen"), and(eq(learningLessonsTable.scope, "partner"), eq(learningLessonsTable.partnerId, partnerId)))))
    .orderBy(desc(learningLessonsTable.createdAt))
    .limit(80);
  const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()))];
  return {
    partner: uniq(rows.filter((r) => r.scope === "partner").map((r) => r.rule)).slice(0, 30),
    general: uniq(rows.filter((r) => r.scope === "algemeen").map((r) => r.rule)).slice(0, 30),
  };
}

export function lessonsBlock(lessons: { partner: string[]; general: string[] } | null | undefined): string {
  if (!lessons || (!lessons.partner.length && !lessons.general.length)) return "";
  return [
    "GELEERDE LESSEN uit eerdere controles door Yellowlimers (volg deze altijd; een partnerles gaat voor een algemene les, het partnerprofiel gaat voor allebei):",
    ...(lessons.partner.length ? ["Voor deze partner:", ...lessons.partner.map((r) => `- ${r}`)] : []),
    ...(lessons.general.length ? ["Voor alle partners:", ...lessons.general.map((r) => `- ${r}`)] : []),
  ].join("\n");
}

void isNull;
