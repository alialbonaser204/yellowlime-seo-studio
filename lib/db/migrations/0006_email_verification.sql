ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "verify_code_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "verify_code_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "verify_code_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "verify_code_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Accounts made before e-mail verification existed must verify first: end their sessions.
DELETE FROM "sessions";