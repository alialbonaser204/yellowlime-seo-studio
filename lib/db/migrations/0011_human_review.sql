ALTER TABLE "article_generations" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "article_generations" ADD COLUMN "review_decision" text;--> statement-breakpoint
ALTER TABLE "article_generations" ADD COLUMN "reviewed_by" integer;--> statement-breakpoint
ALTER TABLE "article_generations" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "article_generations" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "article_generations" ADD CONSTRAINT "article_generations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_generations" ADD CONSTRAINT "article_generations_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;