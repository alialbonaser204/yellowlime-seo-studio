CREATE TYPE "public"."article_review_status" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."partner_profile_status" AS ENUM('Nog niet opgebouwd', 'Wordt opgebouwd', 'Wacht op controle', 'Goedgekeurd', 'Afgekeurd', 'Analyse mislukt');--> statement-breakpoint
CREATE TYPE "public"."article_generation_status" AS ENUM('Klaar voor generatie', 'Artikel wordt geschreven', 'Concept gereed', 'Generatie mislukt', 'Wacht op controle');--> statement-breakpoint
CREATE TABLE "partners" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_name" text NOT NULL,
	"website_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "briefings" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_id" integer NOT NULL,
	"reviewer_id" integer,
	"subject" text NOT NULL,
	"content_goal" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "yellowlimers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"avatar_type" text NOT NULL,
	"avatar_value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_id" integer NOT NULL,
	"briefing_id" integer NOT NULL,
	"yellowlimer_id" integer NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"meta_title" text NOT NULL,
	"meta_description" text NOT NULL,
	"model_name" text NOT NULL,
	"prompt_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "articles_briefing_id_unique" UNIQUE("briefing_id")
);
--> statement-breakpoint
CREATE TABLE "article_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_id" integer NOT NULL,
	"briefing_id" integer NOT NULL,
	"article_id" integer NOT NULL,
	"yellowlimer_id" integer NOT NULL,
	"original_title" text NOT NULL,
	"original_content" text NOT NULL,
	"original_meta_title" text NOT NULL,
	"original_meta_description" text NOT NULL,
	"corrected_title" text NOT NULL,
	"corrected_content" text NOT NULL,
	"corrected_meta_title" text NOT NULL,
	"corrected_meta_description" text NOT NULL,
	"reviewer_explanation" text,
	"review_status" "article_review_status" NOT NULL,
	"ai_version_created_at" timestamp with time zone NOT NULL,
	"human_version_created_at" timestamp with time zone NOT NULL,
	"claude_model_name" text NOT NULL,
	"prompt_version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "semrush_research" (
	"id" serial PRIMARY KEY NOT NULL,
	"briefing_id" integer NOT NULL,
	"partner_id" integer NOT NULL,
	"original_subject" text NOT NULL,
	"selected_main_keyword" text NOT NULL,
	"search_volume" integer,
	"keyword_difficulty" real,
	"search_intent" text,
	"trend" text,
	"secondary_keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"relevant_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"organic_competitors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"researched_at" timestamp with time zone,
	"semrush_database" text DEFAULT 'nl' NOT NULL,
	"api_status" text DEFAULT 'pending' NOT NULL,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "semrush_research_briefing_id_unique" UNIQUE("briefing_id")
);
--> statement-breakpoint
CREATE TABLE "partner_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_id" integer NOT NULL,
	"website_pages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"website_text" text DEFAULT '' NOT NULL,
	"claude_profile" jsonb,
	"review_profile" jsonb,
	"approved_profile" jsonb,
	"profile_status" "partner_profile_status" DEFAULT 'Nog niet opgebouwd' NOT NULL,
	"claude_model_name" text DEFAULT 'claude-sonnet-5' NOT NULL,
	"prompt_version" text DEFAULT 'partner-profile-v1' NOT NULL,
	"failure_message" text,
	"approved_by_yellowlimer_id" integer,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_generations" (
	"id" serial PRIMARY KEY NOT NULL,
	"briefing_id" integer NOT NULL,
	"partner_id" integer NOT NULL,
	"yellowlimer_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"title" text NOT NULL,
	"introduction" text NOT NULL,
	"conclusion" text NOT NULL,
	"full_article" text NOT NULL,
	"meta_title" text NOT NULL,
	"meta_description" text NOT NULL,
	"primary_keyword" text NOT NULL,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"secondary_keywords_used" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"questions_answered" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved_partner_profile_snapshot" jsonb NOT NULL,
	"semrush_research_snapshot" jsonb NOT NULL,
	"article_status" "article_generation_status" DEFAULT 'Klaar voor generatie' NOT NULL,
	"claude_model_name" text DEFAULT 'claude-sonnet-5' NOT NULL,
	"prompt_version" text DEFAULT 'article_generation_v1' NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_generations_briefing_version_unique" UNIQUE("briefing_id","version_number"),
	CONSTRAINT "article_generations_model_name_check" CHECK ("article_generations"."claude_model_name" = 'claude-sonnet-5'),
	CONSTRAINT "article_generations_prompt_version_check" CHECK ("article_generations"."prompt_version" = 'article_generation_v1')
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"data" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "briefings" ADD CONSTRAINT "briefings_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefings" ADD CONSTRAINT "briefings_reviewer_id_yellowlimers_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."yellowlimers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_briefing_id_briefings_id_fk" FOREIGN KEY ("briefing_id") REFERENCES "public"."briefings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_yellowlimer_id_yellowlimers_id_fk" FOREIGN KEY ("yellowlimer_id") REFERENCES "public"."yellowlimers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_reviews" ADD CONSTRAINT "article_reviews_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_reviews" ADD CONSTRAINT "article_reviews_briefing_id_briefings_id_fk" FOREIGN KEY ("briefing_id") REFERENCES "public"."briefings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_reviews" ADD CONSTRAINT "article_reviews_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_reviews" ADD CONSTRAINT "article_reviews_yellowlimer_id_yellowlimers_id_fk" FOREIGN KEY ("yellowlimer_id") REFERENCES "public"."yellowlimers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semrush_research" ADD CONSTRAINT "semrush_research_briefing_id_briefings_id_fk" FOREIGN KEY ("briefing_id") REFERENCES "public"."briefings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semrush_research" ADD CONSTRAINT "semrush_research_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_profiles" ADD CONSTRAINT "partner_profiles_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_profiles" ADD CONSTRAINT "partner_profiles_approved_by_yellowlimer_id_yellowlimers_id_fk" FOREIGN KEY ("approved_by_yellowlimer_id") REFERENCES "public"."yellowlimers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_generations" ADD CONSTRAINT "article_generations_briefing_id_briefings_id_fk" FOREIGN KEY ("briefing_id") REFERENCES "public"."briefings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_generations" ADD CONSTRAINT "article_generations_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_generations" ADD CONSTRAINT "article_generations_yellowlimer_id_yellowlimers_id_fk" FOREIGN KEY ("yellowlimer_id") REFERENCES "public"."yellowlimers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_profiles_partner_id_unique" ON "partner_profiles" USING btree ("partner_id");