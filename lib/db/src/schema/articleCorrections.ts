import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { articleGenerationsTable } from "./articleGenerations";
import { partnersTable } from "./partners";
import { usersTable } from "./users";

/**
 * One human check of an AI-written article: the version before and after the
 * check, the reviewer's remarks, and the difference between both versions.
 * Stored per partner, as learning material for later (self-learning).
 */
export const articleCorrectionsTable = pgTable(
  "article_corrections",
  {
    id: serial("id").primaryKey(),
    generationId: integer("generation_id").notNull().references(() => articleGenerationsTable.id, { onDelete: "cascade" }),
    partnerId: integer("partner_id").notNull().references(() => partnersTable.id, { onDelete: "cascade" }),
    /** "goedgekeurd" or "afgekeurd". */
    decision: text("decision").notNull(),
    /** The AI version (before the check). */
    beforeVersion: jsonb("before_version").$type<{ fullArticle: string; metaTitle: string; metaDescription: string }>().notNull(),
    /** The version after the check (with the reviewer's edits). */
    afterVersion: jsonb("after_version").$type<{ fullArticle: string; metaTitle: string; metaDescription: string }>().notNull(),
    /** What changed between both versions (see services/articleDiff.ts). */
    difference: jsonb("difference").$type<Record<string, unknown>>().notNull(),
    /** Extra remarks of the reviewer. */
    note: text("note"),
    reviewedBy: integer("reviewed_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("article_corrections_partner_idx").on(table.partnerId), index("article_corrections_generation_idx").on(table.generationId)],
);
