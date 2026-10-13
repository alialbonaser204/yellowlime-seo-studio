import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { partnersTable } from "./partners";
import { yellowlimersTable } from "./yellowlimers";

export const partnerProfileStatus = pgEnum("partner_profile_status", [
  "Nog niet opgebouwd",
  "Wordt opgebouwd",
  "Wacht op controle",
  "Goedgekeurd",
  "Afgekeurd",
  "Analyse mislukt",
]);

export const partnerProfilesTable = pgTable(
  "partner_profiles",
  {
    id: serial("id").primaryKey(),
    partnerId: integer("partner_id")
      .notNull()
      .references(() => partnersTable.id, { onDelete: "restrict" }),
    websitePages: jsonb("website_pages").$type<
      Array<{ url: string; title: string; text: string }>
    >().notNull().default([]),
    websiteText: text("website_text").notNull().default(""),
    claudeProfile: jsonb("claude_profile").$type<Record<string, unknown> | null>(),
    reviewProfile: jsonb("review_profile").$type<Record<string, unknown> | null>(),
    approvedProfile: jsonb("approved_profile").$type<Record<string, unknown> | null>(),
    profileStatus: partnerProfileStatus("profile_status")
      .notNull()
      .default("Nog niet opgebouwd"),
    claudeModelName: text("claude_model_name").notNull().default("claude-sonnet-5"),
    promptVersion: text("prompt_version").notNull().default("partner-profile-v1"),
    failureMessage: text("failure_message"),
    approvedByYellowlimerId: integer("approved_by_yellowlimer_id").references(
      () => yellowlimersTable.id,
      { onDelete: "restrict" },
    ),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    partnerUnique: uniqueIndex("partner_profiles_partner_id_unique").on(
      table.partnerId,
    ),
  }),
);

export const insertPartnerProfileSchema = createInsertSchema(
  partnerProfilesTable,
).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertPartnerProfile = z.infer<typeof insertPartnerProfileSchema>;
export type PartnerProfile = typeof partnerProfilesTable.$inferSelect;