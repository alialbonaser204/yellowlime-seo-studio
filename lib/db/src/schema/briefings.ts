import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { partnersTable } from "./partners";
import { yellowlimersTable } from "./yellowlimers";

export const briefingsTable = pgTable("briefings", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id")
    .notNull()
    .references(() => partnersTable.id, { onDelete: "restrict" }),
  reviewerId: integer("reviewer_id").references(() => yellowlimersTable.id, {
    onDelete: "restrict",
  }),
  subject: text("subject").notNull(),
  contentGoal: text("content_goal").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertBriefingSchema = createInsertSchema(briefingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertBriefing = z.infer<typeof insertBriefingSchema>;
export type Briefing = typeof briefingsTable.$inferSelect;