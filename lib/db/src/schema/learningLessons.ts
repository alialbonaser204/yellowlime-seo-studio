import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { articleCorrectionsTable } from "./articleCorrections";
import { partnersTable } from "./partners";
import { usersTable } from "./users";

/**
 * A lesson the AI learned from a human check, confirmed by a Yellowlimer.
 * scope "partner": only for partnerId; scope "algemeen": for every partner.
 * Used in the writing rules of the next articles.
 */
export const learningLessonsTable = pgTable(
  "learning_lessons",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull(),
    /** The partner the lesson came from (and, for scope "partner", applies to). */
    partnerId: integer("partner_id").references(() => partnersTable.id, { onDelete: "cascade" }),
    /** The rule for the AI, in plain Dutch. */
    rule: text("rule").notNull(),
    /** Why: what the reviewer changed. */
    explanation: text("explanation"),
    /** Example: the AI text and what the reviewer made of it. */
    example: jsonb("example").$type<{ before: string | null; after: string | null }>(),
    correctionId: integer("correction_id").references(() => articleCorrectionsTable.id, { onDelete: "set null" }),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    /** "actief" or "uit" (switched off). */
    status: text("status").notNull().default("actief"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("learning_lessons_partner_idx").on(table.partnerId), index("learning_lessons_scope_idx").on(table.scope)],
);
