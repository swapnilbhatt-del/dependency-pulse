CREATE TABLE "admin_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"target" text NOT NULL,
	"detail_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"release_id" integer NOT NULL,
	"model" text NOT NULL,
	"body_hash" text NOT NULL,
	"output_json" jsonb NOT NULL,
	"ai_status" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classifications_status_ck" CHECK ("classifications"."ai_status" in ('ok','fallback'))
);
--> statement-breakpoint
CREATE TABLE "digest_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"digest_run_id" integer NOT NULL,
	"recipient" text NOT NULL,
	"provider" text NOT NULL,
	"provider_message_id" text,
	"status" text NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "digest_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"digest_run_id" integer NOT NULL,
	"release_id" integer NOT NULL,
	"repo_id" integer NOT NULL,
	"tag_name" text NOT NULL,
	"body_hash" text NOT NULL,
	"tier" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "digest_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"iso_week" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"counts_json" jsonb,
	"model_json" jsonb,
	"html" text,
	"text" text,
	"subject" text,
	"error" text,
	"trigger" text DEFAULT 'cron' NOT NULL,
	"delivered_at" timestamp with time zone,
	"delivery_status" text,
	"lock_until" timestamp with time zone,
	CONSTRAINT "digest_runs_status_ck" CHECK ("digest_runs"."status" in ('running','ok','partial','failed'))
);
--> statement-breakpoint
CREATE TABLE "http_cache" (
	"url" text PRIMARY KEY NOT NULL,
	"etag" text NOT NULL,
	"body" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"digest_run_id" integer,
	"iso_week" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"phase" text DEFAULT 'start' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"counts_json" jsonb,
	"repo_results_json" jsonb,
	"errors_json" jsonb,
	"ai_calls" integer DEFAULT 0 NOT NULL,
	"ai_fallbacks" integer DEFAULT 0 NOT NULL,
	"ai_cache_hits" integer DEFAULT 0 NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"preview_model_json" jsonb,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "releases" (
	"id" serial PRIMARY KEY NOT NULL,
	"repo_id" integer NOT NULL,
	"github_release_id" bigint,
	"tag_name" text NOT NULL,
	"name" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"prerelease" boolean DEFAULT false NOT NULL,
	"body_hash" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"body_truncated" boolean DEFAULT false NOT NULL,
	"notes_available" boolean DEFAULT true NOT NULL,
	"html_url" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "releases_source_ck" CHECK ("releases"."source" in ('github_release','tag'))
);
--> statement-breakpoint
CREATE TABLE "repos" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"full_name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_status" text,
	"last_error" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "repos_priority_ck" CHECK ("repos"."priority" in ('critical','normal','low')),
	CONSTRAINT "repos_status_ck" CHECK ("repos"."last_status" is null or "repos"."last_status" in ('ok','not_found','rate_limited','error'))
);
--> statement-breakpoint
ALTER TABLE "classifications" ADD CONSTRAINT "classifications_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_deliveries" ADD CONSTRAINT "digest_deliveries_digest_run_id_digest_runs_id_fk" FOREIGN KEY ("digest_run_id") REFERENCES "public"."digest_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_items" ADD CONSTRAINT "digest_items_digest_run_id_digest_runs_id_fk" FOREIGN KEY ("digest_run_id") REFERENCES "public"."digest_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_items" ADD CONSTRAINT "digest_items_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_digest_run_id_digest_runs_id_fk" FOREIGN KEY ("digest_run_id") REFERENCES "public"."digest_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "classifications_release_hash_model_uq" ON "classifications" USING btree ("release_id","body_hash","model");--> statement-breakpoint
CREATE INDEX "digest_deliveries_run_idx" ON "digest_deliveries" USING btree ("digest_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "digest_items_run_release_uq" ON "digest_items" USING btree ("digest_run_id","release_id");--> statement-breakpoint
CREATE INDEX "digest_items_repo_tag_idx" ON "digest_items" USING btree ("repo_id","tag_name");--> statement-breakpoint
CREATE UNIQUE INDEX "digest_runs_iso_week_uq" ON "digest_runs" USING btree ("iso_week");--> statement-breakpoint
CREATE INDEX "pipeline_runs_started_idx" ON "pipeline_runs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "recipients_email_uq" ON "recipients" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "releases_repo_tag_uq" ON "releases" USING btree ("repo_id","tag_name");--> statement-breakpoint
CREATE UNIQUE INDEX "releases_repo_ghid_uq" ON "releases" USING btree ("repo_id","github_release_id") WHERE "releases"."github_release_id" is not null;--> statement-breakpoint
CREATE INDEX "releases_published_idx" ON "releases" USING btree ("published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "repos_full_name_lower_uq" ON "repos" USING btree (lower("full_name"));