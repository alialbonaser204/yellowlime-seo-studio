import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Google accounts connected for Search Console data, one per Yellowlimer.
 * Someone without an own connection uses a colleague's working connection.
 * The refresh token is stored encrypted (see apps/api/src/services/googleAuth.ts).
 */
export const googleConnectionsTable = pgTable("google_connections", {
  id: serial("id").primaryKey(),
  /** The Yellowlimer who connected this account (null for the old shared connection). */
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
  scope: text("scope").notNull(),
  /** Set when Google rejected the refresh token; the account must reconnect. */
  lastError: text("last_error"),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type GoogleConnection = typeof googleConnectionsTable.$inferSelect;
