import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { briefingsTable } from "./briefings";
import { partnersTable } from "./partners";
import { yellowlimersTable } from "./yellowlimers";

export const articleGenerationStatus = pgEnum("article_generation_status", [
  "Klaar voor generatie",
  "Artikel wordt geschreven",
  "Concept gereed",
  "Generatie mislukt",
  "Wacht op controle",
]);

export interface ArticleGenerationSection {
  heading: string;
  headingLevel: "H2" | "H3";
  content: string;
}

export const articleGenerationsTable = pgTable(
  "article_generations",
  {
    id: serial("id").primaryKey(),
    briefingId: integer("briefing_id")
      .notNull()
      .references(() => briefingsTable.id, { onDelete: "restrict" }),
    partnerId: integer("partner_id")
      .notNull()
      .references(() => partnersTable.id, { onDelete: "restrict" }),
    yellowlimerId: integer("yellowlimer_id")
      .notNull()
      .references(() => yellowlimersTable.id, { onDelete: "restrict" }),
    versionNumber: integer("version_number").notNull(),
    title: text("title").notNull(),
    introduction: text("introduction").notNull(),
    conclusion: text("conclusion").notNull(),
    fullArticle: text("full_article").notNull(),
    metaTitle: text("meta_title").notNull(),
    metaDescription: text("meta_description").notNull(),
    primaryKeyword: text("primary_keyword").notNull(),
    sections: jsonb("sections")
      .$type<ArticleGenerationSection[]>()
      .notNull()
      .default([]),
    secondaryKeywordsUsed: jsonb("secondary_keywords_used")
      .$type<string[]>()
      .notNull()
      .default([]),
    questionsAnswered: jsonb("questions_answered")
      .$type<string[]>()
      .notNull()
      .default([]),
    approvedPartnerProfileSnapshot: jsonb(
      "approved_partner_profile_snapshot",
    )
      .$type<Record<string, unknown>>()
      .notNull(),
    semrushResearchSnapshot: jsonb("semrush_research_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    articleStatus: articleGenerationStatus("article_status")
      .notNull()
      .default("Klaar voor generatie"),
    claudeModelName: text("claude_model_name")
      .notNull()
      .default("claude-sonnet-5"),
    promptVersion: text("prompt_version")
      .notNull()
      .default("article_generation_v1"),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    failureMessage: text("failure_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("article_generations_briefing_version_unique").on(
      table.briefingId,
      table.versionNumber,
    ),
    check(
      "article_generations_model_name_check",
      sql`${table.claudeModelName} = 'claude-sonnet-5'`,
    ),
    check(
      "article_generations_prompt_version_check",
      sql`${table.promptVersion} = 'article_generation_v1'`,
    ),
  ],
);

export const insertArticleGenerationSchema = createInsertSchema(
  articleGenerationsTable,
).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertArticleGeneration = z.infer<
  typeof insertArticleGenerationSchema
>;
export type ArticleGeneration = typeof articleGenerationsTable.$inferSelect;