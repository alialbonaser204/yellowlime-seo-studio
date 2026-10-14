CREATE TABLE "google_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"refresh_token_encrypted" text NOT NULL,
	"scope" text NOT NULL,
	"last_error" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
