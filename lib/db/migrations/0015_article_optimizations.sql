CREATE TABLE "article_optimizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_id" integer NOT NULL,
	"url" text NOT NULL,
	"status" text DEFAULT 'bezig' NOT NULL,
	"analysis" jsonb NOT NULL,
	"original" jsonb,
	"result" jsonb,
	"overview" jsonb,
	"error" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "article_optimizations" ADD CONSTRAINT "article_optimizations_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_optimizations" ADD CONSTRAINT "article_optimizations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_optimizations_partner_idx" ON "article_optimizations" USING btree ("partner_id");