import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * The Google account that is connected for Search Console data. The app uses
 * one connection for the whole workspace; the refresh token is stored
 * encrypted (see apps/api/src/services/googleAuth.ts).
 */
export const googleConnectionsTable = pgTable("google_connections", {
  id: serial("id").primaryKey(),
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
