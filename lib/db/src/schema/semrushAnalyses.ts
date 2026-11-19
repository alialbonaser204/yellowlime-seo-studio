import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { partnersTable } from "./partners";
import { usersTable } from "./users";

/**
 * Saved Semrush analyses of a partner's website. Kept so that opening the
 * page again costs no Semrush units; a new row is added on refresh.
 */
export const semrushAnalysesTable = pgTable(
  "semrush_analyses",
  {
    id: serial("id").primaryKey(),
    partnerId: integer("partner_id").notNull().references(() => partnersTable.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    data: jsonb("data").notNull(),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("semrush_analyses_partner_idx").on(table.partnerId, table.createdAt)],
);
