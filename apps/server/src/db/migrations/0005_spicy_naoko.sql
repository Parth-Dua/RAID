CREATE TABLE IF NOT EXISTS "game_interventions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"classification" varchar(30) NOT NULL,
	"kind" varchar(30) NOT NULL,
	"message" text NOT NULL,
	"target_role" varchar(30),
	"confidence_pct" integer NOT NULL,
	"elapsed_seconds" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ALTER COLUMN "kind" SET DATA TYPE varchar(20);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "game_interventions" ADD CONSTRAINT "game_interventions_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
