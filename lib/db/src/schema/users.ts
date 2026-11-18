import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/** People who may log in to the studio (Yellowlime e-mail addresses only). */
export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  /** PBKDF2-SHA256: "pbkdf2$<iterations>$<salt b64>$<hash b64>". */
  passwordHash: text("password_hash").notNull(),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  /** Set once the person has entered the code that was e-mailed to them. */
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  /** SHA-256 of the current 6-digit code; never the code itself. */
  verifyCodeHash: text("verify_code_hash"),
  verifyCodeExpiresAt: timestamp("verify_code_expires_at", { withTimezone: true }),
  verifyCodeSentAt: timestamp("verify_code_sent_at", { withTimezone: true }),
  verifyCodeAttempts: integer("verify_code_attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

/** Login sessions. Only a SHA-256 hash of the cookie token is stored. */
export const sessionsTable = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export type User = typeof usersTable.$inferSelect;
