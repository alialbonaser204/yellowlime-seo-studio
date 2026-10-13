import { eq } from "drizzle-orm";
import {
  briefingsTable,
  db,
  semrushResearchTable,
  type Briefing,
  type InsertSemrushResearch,
  type SemrushResearch,
} from "@yellowlime/db";
import {
  runSemrushResearch,
  safeSemrushError,
  type SeoResearchInput,
} from "./semrush";

type SafeLogger = {
  error: (object: unknown, message?: string) => void;
};

export async function getBriefing(briefingId: number): Promise<Briefing | undefined> {
  const [briefing] = await db
    .select()
    .from(briefingsTable)
    .where(eq(briefingsTable.id, briefingId));
  return briefing;
}

export async function getSeoResearch(briefingId: number): Promise<SemrushResearch | undefined> {
  const [research] = await db
    .select()
    .from(semrushResearchTable)
    .where(eq(semrushResearchTable.briefingId, briefingId));
  return research;
}

export async function upsertPendingSeoResearch(
  briefing: Pick<Briefing, "id" | "partnerId" | "subject">,
): Promise<SemrushResearch> {
  const values: InsertSemrushResearch = {
    briefingId: briefing.id,
    partnerId: briefing.partnerId,
    originalSubject: briefing.subject,
    selectedMainKeyword: briefing.subject,
    searchVolume: null,
    keywordDifficulty: null,
    searchIntent: null,
    trend: null,
    secondaryKeywords: [],
    relevantQuestions: [],
    organicCompetitors: [],
    researchedAt: null,
    semrushDatabase: "nl",
    apiStatus: "pending",
    message: null,
  };
  const [research] = await db
    .insert(semrushResearchTable)
    .values(values)
    .onConflictDoUpdate({
      target: semrushResearchTable.briefingId,
      set: {
        partnerId: values.partnerId,
        originalSubject: values.originalSubject,
        selectedMainKeyword: values.selectedMainKeyword,
        searchVolume: values.searchVolume,
        keywordDifficulty: values.keywordDifficulty,
        searchIntent: values.searchIntent,
        trend: values.trend,
        secondaryKeywords: values.secondaryKeywords,
        relevantQuestions: values.relevantQuestions,
        organicCompetitors: values.organicCompetitors,
        researchedAt: values.researchedAt,
        semrushDatabase: values.semrushDatabase,
        apiStatus: values.apiStatus,
        message: values.message,
        updatedAt: new Date(),
      },
    })
    .returning();
  return research;
}

async function storeCompletedResearch(
  briefing: Pick<Briefing, "id" | "partnerId" | "subject" | "contentGoal">,
  result: Awaited<ReturnType<typeof runSemrushResearch>>,
): Promise<void> {
  await db
    .insert(semrushResearchTable)
    .values({
      briefingId: briefing.id,
      partnerId: briefing.partnerId,
      originalSubject: briefing.subject,
      selectedMainKeyword: result.selectedMainKeyword,
      searchVolume: result.searchVolume,
      keywordDifficulty: result.keywordDifficulty,
      searchIntent: result.searchIntent,
      trend: result.trend,
      secondaryKeywords: result.secondaryKeywords,
      relevantQuestions: result.relevantQuestions,
      organicCompetitors: result.organicCompetitors,
      researchedAt: new Date(),
      semrushDatabase: "nl",
      apiStatus: "success",
      message: result.message,
    })
    .onConflictDoUpdate({
      target: semrushResearchTable.briefingId,
      set: {
        partnerId: briefing.partnerId,
        originalSubject: briefing.subject,
        selectedMainKeyword: result.selectedMainKeyword,
        searchVolume: result.searchVolume,
        keywordDifficulty: result.keywordDifficulty,
        searchIntent: result.searchIntent,
        trend: result.trend,
        secondaryKeywords: result.secondaryKeywords,
        relevantQuestions: result.relevantQuestions,
        organicCompetitors: result.organicCompetitors,
        researchedAt: new Date(),
        semrushDatabase: "nl",
        apiStatus: "success",
        message: result.message,
        updatedAt: new Date(),
      },
    });
}

async function storeFailedResearch(
  briefing: Pick<Briefing, "id" | "partnerId" | "subject">,
  message: string,
): Promise<void> {
  await db
    .insert(semrushResearchTable)
    .values({
      briefingId: briefing.id,
      partnerId: briefing.partnerId,
      originalSubject: briefing.subject,
      selectedMainKeyword: briefing.subject,
      searchVolume: null,
      keywordDifficulty: null,
      searchIntent: null,
      trend: null,
      secondaryKeywords: [],
      relevantQuestions: [],
      organicCompetitors: [],
      researchedAt: new Date(),
      semrushDatabase: "nl",
      apiStatus: "failed",
      message,
    })
    .onConflictDoUpdate({
      target: semrushResearchTable.briefingId,
      set: {
        partnerId: briefing.partnerId,
        originalSubject: briefing.subject,
        selectedMainKeyword: briefing.subject,
        searchVolume: null,
        keywordDifficulty: null,
        searchIntent: null,
        trend: null,
        secondaryKeywords: [],
        relevantQuestions: [],
        organicCompetitors: [],
        researchedAt: new Date(),
        semrushDatabase: "nl",
        apiStatus: "failed",
        message,
        updatedAt: new Date(),
      },
    });
}

export function queueSeoResearch(
  briefing: Pick<Briefing, "id" | "partnerId" | "subject" | "contentGoal">,
  log: SafeLogger,
): void {
  void (async () => {
    try {
      const input: SeoResearchInput = {
        originalSubject: briefing.subject,
        contentGoal: briefing.contentGoal,
      };
      const result = await runSemrushResearch(input);
      await storeCompletedResearch(briefing, result);
    } catch (error) {
      const safe = safeSemrushError(error);
      try {
        await storeFailedResearch(briefing, safe.message);
      } catch (storageError) {
        log.error({ code: "research_storage_failed", errorType: typeof storageError }, "SEO-onderzoek opslaan mislukt");
      }
      log.error({ code: safe.code, errorType: error instanceof Error ? error.name : typeof error }, "Semrush-onderzoek mislukt");
    }
  })().catch((error: unknown) => {
    log.error({ code: "research_background_failed", errorType: error instanceof Error ? error.name : typeof error }, "Semrush-achtergrondtaak mislukt");
  });
}