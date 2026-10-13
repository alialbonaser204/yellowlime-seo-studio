import {
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { articlesTable } from "./articles";
import { briefingsTable } from "./briefings";
import { partnersTable } from "./partners";
import { yellowlimersTable } from "./yellowlimers";

export const articleReviewStatus = pgEnum("article_review_status", [
  "approved",
  "rejected",
]);

export const articleReviewsTable = pgTable("article_reviews", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id")
    .notNull()
    .references(() => partnersTable.id, { onDelete: "restrict" }),
  briefingId: integer("briefing_id")
    .notNull()
    .references(() => briefingsTable.id, { onDelete: "restrict" }),
  articleId: integer("article_id")
    .notNull()
    .references(() => articlesTable.id, { onDelete: "restrict" }),
  yellowlimerId: integer("yellowlimer_id")
    .notNull()
    .references(() => yellowlimersTable.id, { onDelete: "restrict" }),
  originalTitle: text("original_title").notNull(),
  originalContent: text("original_content").notNull(),
  originalMetaTitle: text("original_meta_title").notNull(),
  originalMetaDescription: text("original_meta_description").notNull(),
  correctedTitle: text("corrected_title").notNull(),
  correctedContent: text("corrected_content").notNull(),
  correctedMetaTitle: text("corrected_meta_title").notNull(),
  correctedMetaDescription: text("corrected_meta_description").notNull(),
  reviewerExplanation: text("reviewer_explanation"),
  reviewStatus: articleReviewStatus("review_status").notNull(),
  aiVersionCreatedAt: timestamp("ai_version_created_at", {
    withTimezone: true,
  }).notNull(),
  humanVersionCreatedAt: timestamp("human_version_created_at", {
    withTimezone: true,
  }).notNull(),
  claudeModelName: text("claude_model_name").notNull(),
  promptVersion: text("prompt_version").notNull(),
});

export const insertArticleReviewSchema = createInsertSchema(
  articleReviewsTable,
).omit({ id: true });

export type InsertArticleReview = z.infer<typeof insertArticleReviewSchema>;
export type ArticleReview = typeof articleReviewsTable.$inferSelect;