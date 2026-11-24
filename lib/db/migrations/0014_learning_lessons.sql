CREATE TABLE "learning_lessons" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"partner_id" integer,
	"rule" text NOT NULL,
	"explanation" text,
	"example" jsonb,
	"correction_id" integer,
	"created_by" integer,
	"status" text DEFAULT 'actief' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "article_corrections" ADD COLUMN "ai_lessons" jsonb;--> statement-breakpoint
ALTER TABLE "learning_lessons" ADD CONSTRAINT "learning_lessons_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_lessons" ADD CONSTRAINT "learning_lessons_correction_id_article_corrections_id_fk" FOREIGN KEY ("correction_id") REFERENCES "public"."article_corrections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_lessons" ADD CONSTRAINT "learning_lessons_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learning_lessons_partner_idx" ON "learning_lessons" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "learning_lessons_scope_idx" ON "learning_lessons" USING btree ("scope");