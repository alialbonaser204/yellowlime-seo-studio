CREATE TABLE "article_corrections" (
	"id" serial PRIMARY KEY NOT NULL,
	"generation_id" integer NOT NULL,
	"partner_id" integer NOT NULL,
	"decision" text NOT NULL,
	"before_version" jsonb NOT NULL,
	"after_version" jsonb NOT NULL,
	"difference" jsonb NOT NULL,
	"note" text,
	"reviewed_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "article_corrections" ADD CONSTRAINT "article_corrections_generation_id_article_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."article_generations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_corrections" ADD CONSTRAINT "article_corrections_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_corrections" ADD CONSTRAINT "article_corrections_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_corrections_partner_idx" ON "article_corrections" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "article_corrections_generation_idx" ON "article_corrections" USING btree ("generation_id");