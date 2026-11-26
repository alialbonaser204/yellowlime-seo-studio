import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { partnersTable } from "./partners";
import { usersTable } from "./users";

/**
 * Optimising an existing article on a partner's website: the original text,
 * why it performs badly, the improved version and an overview of all changes.
 */
export const articleOptimizationsTable = pgTable(
  "article_optimizations",
  {
    id: serial("id").primaryKey(),
    partnerId: integer("partner_id").notNull().references(() => partnersTable.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    /** bezig | klaar | mislukt */
    status: text("status").notNull().default("bezig"),
    /** The performance analysis shown when the article was chosen. */
    analysis: jsonb("analysis").$type<Record<string, unknown>>().notNull(),
    /** The article as it is now on the website. */
    original: jsonb("original").$type<{ title: string; metaTitle: string; metaDescription: string; fullArticle: string; wordCount: number } | null>(),
    /** The improved version. */
    result: jsonb("result").$type<{ title: string; metaTitle: string; metaDescription: string; fullArticle: string } | null>(),
    /** Overview: diagnosis, every change with its reason, expected effect. */
    overview: jsonb("overview").$type<Record<string, unknown> | null>(),
    error: text("error"),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [index("article_optimizations_partner_idx").on(table.partnerId)],
);
