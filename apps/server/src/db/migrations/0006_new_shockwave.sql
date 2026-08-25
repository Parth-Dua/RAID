CREATE TABLE IF NOT EXISTS "generated_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scenario_id" varchar(60) NOT NULL,
	"title" varchar(100) NOT NULL,
	"severity" varchar(10) NOT NULL,
	"briefing" text NOT NULL,
	"tagline" varchar(150) NOT NULL,
	"definition" jsonb NOT NULL,
	"requested_description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generated_scenarios_scenario_id_unique" UNIQUE("scenario_id")
);
