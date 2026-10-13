import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { briefingsTable } from "./briefings";
import { partnersTable } from "./partners";
import { yellowlimersTable } from "./yellowlimers";

export const articlesTable = pgTable(
  "articles",
  {
    id: serial("id").primaryKey(),
    partnerId: integer("partner_id")
      .notNull()
      .references(() => partnersTable.id, { onDelete: "restrict" }),
    briefingId: integer("briefing_id")
      .notNull()
      .references(() => briefingsTable.id, { onDelete: "restrict" }),
    yellowlimerId: integer("yellowlimer_id")
      .notNull()
      .references(() => yellowlimersTable.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    content: text("content").notNull(),
    metaTitle: text("meta_title").notNull(),
    metaDescription: text("meta_description").notNull(),
    modelName: text("model_name").notNull(),
    promptVersion: text("prompt_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique("articles_briefing_id_unique").on(table.briefingId)],
);

export const insertArticleSchema = createInsertSchema(articlesTable).omit({
  id: true,
  createdAt: true,
});

export type InsertArticle = z.infer<typeof insertArticleSchema>;
export type Article = typeof articlesTable.$inferSelect;