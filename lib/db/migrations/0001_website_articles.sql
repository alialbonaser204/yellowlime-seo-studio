CREATE TABLE "website_articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_id" integer NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"headings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"word_count" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "website_articles_partner_url_unique" UNIQUE("partner_id","url")
);
--> statement-breakpoint
CREATE TABLE "website_scans" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_id" integer NOT NULL,
	"status" text NOT NULL,
	"source" text,
	"pages_checked" integer DEFAULT 0 NOT NULL,
	"articles_found" integer DEFAULT 0 NOT NULL,
	"message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "website_articles" ADD CONSTRAINT "website_articles_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_scans" ADD CONSTRAINT "website_scans_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "website_articles_partner_idx" ON "website_articles" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "website_scans_partner_idx" ON "website_scans" USING btree ("partner_id");