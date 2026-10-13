import { boolean, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const yellowlimersTable = pgTable("yellowlimers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  avatarType: text("avatar_type").notNull(),
  avatarValue: text("avatar_value").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  active: boolean("active").notNull().default(true),
});

export const insertYellowlimerSchema = createInsertSchema(yellowlimersTable).omit({
  id: true,
  createdAt: true,
});

export type InsertYellowlimer = z.infer<typeof insertYellowlimerSchema>;
export type Yellowlimer = typeof yellowlimersTable.$inferSelect;