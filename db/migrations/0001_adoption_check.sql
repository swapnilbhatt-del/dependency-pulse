CREATE TABLE "adoption_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value_json" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_candidates" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"full_name" text NOT NULL,
	"slug" text NOT NULL,
	"package_ecosystem" text,
	"package_name" text,
	"intended_use" text DEFAULT '' NOT NULL,
	"sponsorship_or_backing" text DEFAULT 'unknown' NOT NULL,
	"team_notes" text DEFAULT '' NOT NULL,
	"notes_public" boolean DEFAULT false NOT NULL,
	"adoption_status" text DEFAULT 'evaluating' NOT NULL,
	"adoption_reason" text DEFAULT '' NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	"archived_from_watchlist" boolean DEFAULT false NOT NULL,
	"is_example" boolean DEFAULT false NOT NULL,
	"last_refresh_note" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evaluation_candidates_eco_ck" CHECK ("evaluation_candidates"."package_ecosystem" is null or "evaluation_candidates"."package_ecosystem" in ('npm','pypi')),
	CONSTRAINT "evaluation_candidates_status_ck" CHECK ("evaluation_candidates"."adoption_status" in ('evaluating','adopted','rejected','parked')),
	CONSTRAINT "evaluation_candidates_backing_ck" CHECK ("evaluation_candidates"."sponsorship_or_backing" in ('company-backed','foundation-backed','individual','unknown'))
);
--> statement-breakpoint
CREATE TABLE "health_narratives" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"input_hash" text NOT NULL,
	"model" text NOT NULL,
	"narrative_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"trigger" text NOT NULL,
	"iso_week" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"counts_json" jsonb,
	"progress_json" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "health_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"iso_week" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"config_version" text NOT NULL,
	"raw_metrics_json" jsonb NOT NULL,
	"dimension_scores_json" jsonb NOT NULL,
	"overall_score" integer,
	"weight_coverage" double precision NOT NULL,
	"verdict" text NOT NULL,
	"reasons_json" jsonb NOT NULL,
	"gates_json" jsonb NOT NULL,
	"narrative_json" jsonb,
	"ai_status" text NOT NULL,
	"input_hash" text NOT NULL,
	"source_status_json" jsonb NOT NULL,
	"links_json" jsonb,
	"is_current" boolean DEFAULT false NOT NULL,
	"forced" boolean DEFAULT false NOT NULL,
	CONSTRAINT "health_snapshots_verdict_ck" CHECK ("health_snapshots"."verdict" in ('healthy','watch','risky','insufficient')),
	CONSTRAINT "health_snapshots_ai_ck" CHECK ("health_snapshots"."ai_status" in ('ok','fallback','skipped'))
);
--> statement-breakpoint
ALTER TABLE "adoption_decisions" ADD CONSTRAINT "adoption_decisions_candidate_id_evaluation_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."evaluation_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_narratives" ADD CONSTRAINT "health_narratives_candidate_id_evaluation_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."evaluation_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_snapshots" ADD CONSTRAINT "health_snapshots_candidate_id_evaluation_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."evaluation_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adoption_decisions_candidate_idx" ON "adoption_decisions" USING btree ("candidate_id","decided_at");--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_candidates_full_name_lower_uq" ON "evaluation_candidates" USING btree (lower("full_name"));--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_candidates_slug_uq" ON "evaluation_candidates" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "health_narratives_key_uq" ON "health_narratives" USING btree ("candidate_id","input_hash","model");--> statement-breakpoint
CREATE INDEX "health_runs_started_idx" ON "health_runs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "health_snapshots_candidate_week_uq" ON "health_snapshots" USING btree ("candidate_id","iso_week");--> statement-breakpoint
CREATE INDEX "health_snapshots_candidate_idx" ON "health_snapshots" USING btree ("candidate_id","captured_at");