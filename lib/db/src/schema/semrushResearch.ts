import {
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { briefingsTable } from "./briefings";
import { partnersTable } from "./partners";

export const semrushResearchTable = pgTable(
  "semrush_research",
  {
    id: serial("id").primaryKey(),
    briefingId: integer("briefing_id")
      .notNull()
      .references(() => briefingsTable.id, { onDelete: "restrict" }),
    partnerId: integer("partner_id")
      .notNull()
      .references(() => partnersTable.id, { onDelete: "restrict" }),
    originalSubject: text("original_subject").notNull(),
    selectedMainKeyword: text("selected_main_keyword").notNull(),
    searchVolume: integer("search_volume"),
    keywordDifficulty: real("keyword_difficulty"),
    searchIntent: text("search_intent"),
    trend: text("trend"),
    secondaryKeywords: jsonb("secondary_keywords")
      .$type<SeoKeyword[]>()
      .notNull()
      .default([]),
    relevantQuestions: jsonb("relevant_questions")
      .$type<SeoQuestion[]>()
      .notNull()
      .default([]),
    organicCompetitors: jsonb("organic_competitors")
      .$type<OrganicCompetitor[]>()
      .notNull()
      .default([]),
    researchedAt: timestamp("researched_at", { withTimezone: true }),
    semrushDatabase: text("semrush_database").notNull().default("nl"),
    apiStatus: text("api_status").notNull().default("pending"),
    message: text("message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [unique("semrush_research_briefing_id_unique").on(table.briefingId)],
);

export interface SeoKeyword {
  keyword: string;
  searchVolume: number | null;
  keywordDifficulty: number | null;
  searchIntent: string | null;
  trend: string | null;
}

export interface SeoQuestion {
  question: string;
  searchVolume: number | null;
  keywordDifficulty: number | null;
  searchIntent: string | null;
}

export interface OrganicCompetitor {
  position: number | null;
  domain: string;
  url: string;
}

export const insertSemrushResearchSchema = createInsertSchema(
  semrushResearchTable,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSemrushResearch = z.infer<typeof insertSemrushResearchSchema>;
export type SemrushResearch = typeof semrushResearchTable.$inferSelect;