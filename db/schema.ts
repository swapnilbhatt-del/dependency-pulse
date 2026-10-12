import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** Repo Registry. Editable from /admin; never hardcoded in the pipeline. */
export const repos = pgTable(
  "repos",
  {
    id: serial("id").primaryKey(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    fullName: text("full_name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    category: text("category").notNull().default(""),
    priority: text("priority").$type<"critical" | "normal" | "low">().notNull().default("normal"),
    notes: text("notes").notNull().default(""),
    addedAt: ts("added_at").notNull().defaultNow(),
    lastCheckedAt: ts("last_checked_at"),
    lastStatus: text("last_status").$type<"ok" | "not_found" | "rate_limited" | "error">(),
    lastError: text("last_error"),
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    uniqueIndex("repos_full_name_lower_uq").on(sql`lower(${t.fullName})`),
    check("repos_priority_ck", sql`${t.priority} in ('critical','normal','low')`),
    check("repos_status_ck", sql`${t.lastStatus} is null or ${t.lastStatus} in ('ok','not_found','rate_limited','error')`),
  ],
);

export const releases = pgTable(
  "releases",
  {
    id: serial("id").primaryKey(),
    repoId: integer("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    githubReleaseId: bigint("github_release_id", { mode: "number" }),
    tagName: text("tag_name").notNull(),
    name: text("name").notNull(),
    publishedAt: ts("published_at").notNull(),
    prerelease: boolean("prerelease").notNull().default(false),
    bodyHash: text("body_hash").notNull(),
    body: text("body").notNull().default(""),
    bodyTruncated: boolean("body_truncated").notNull().default(false),
    notesAvailable: boolean("notes_available").notNull().default(true),
    htmlUrl: text("html_url").notNull(),
    source: text("source").$type<"github_release" | "tag">().notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("releases_repo_tag_uq").on(t.repoId, t.tagName),
    uniqueIndex("releases_repo_ghid_uq").on(t.repoId, t.githubReleaseId).where(sql`${t.githubReleaseId} is not null`),
    index("releases_published_idx").on(t.publishedAt),
    check("releases_source_ck", sql`${t.source} in ('github_release','tag')`),
  ],
);

/** AI cache: one row per (release, body hash, model). Re-runs never re-call Gemini for unchanged notes. */
export const classifications = pgTable(
  "classifications",
  {
    id: serial("id").primaryKey(),
    releaseId: integer("release_id")
      .notNull()
      .references(() => releases.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    bodyHash: text("body_hash").notNull(),
    outputJson: jsonb("output_json").notNull(),
    aiStatus: text("ai_status").$type<"ok" | "fallback">().notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("classifications_release_hash_model_uq").on(t.releaseId, t.bodyHash, t.model),
    check("classifications_status_ck", sql`${t.aiStatus} in ('ok','fallback')`),
  ],
);

/** One row per ISO week. The unique constraint is the weekly idempotency key. */
export const digestRuns = pgTable(
  "digest_runs",
  {
    id: serial("id").primaryKey(),
    isoWeek: text("iso_week").notNull(),
    windowStart: ts("window_start").notNull(),
    windowEnd: ts("window_end").notNull(),
    status: text("status").$type<"running" | "ok" | "partial" | "failed">().notNull(),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
    countsJson: jsonb("counts_json"),
    modelJson: jsonb("model_json"),
    html: text("html"),
    text: text("text"),
    subject: text("subject"),
    error: text("error"),
    trigger: text("trigger").notNull().default("cron"),
    deliveredAt: ts("delivered_at"),
    deliveryStatus: text("delivery_status").$type<"pending" | "sent" | "partial" | "failed">(),
    lockUntil: ts("lock_until"),
  },
  (t) => [
    uniqueIndex("digest_runs_iso_week_uq").on(t.isoWeek),
    check("digest_runs_status_ck", sql`${t.status} in ('running','ok','partial','failed')`),
  ],
);

/** Which release versions each digest reported. Powers "Updated since last digest". */
export const digestItems = pgTable(
  "digest_items",
  {
    id: serial("id").primaryKey(),
    digestRunId: integer("digest_run_id")
      .notNull()
      .references(() => digestRuns.id, { onDelete: "cascade" }),
    releaseId: integer("release_id")
      .notNull()
      .references(() => releases.id, { onDelete: "cascade" }),
    repoId: integer("repo_id").notNull(),
    tagName: text("tag_name").notNull(),
    bodyHash: text("body_hash").notNull(),
    tier: integer("tier").notNull(),
  },
  (t) => [uniqueIndex("digest_items_run_release_uq").on(t.digestRunId, t.releaseId), index("digest_items_repo_tag_idx").on(t.repoId, t.tagName)],
);

export const digestDeliveries = pgTable(
  "digest_deliveries",
  {
    id: serial("id").primaryKey(),
    digestRunId: integer("digest_run_id")
      .notNull()
      .references(() => digestRuns.id, { onDelete: "cascade" }),
    recipient: text("recipient").notNull(),
    provider: text("provider").notNull(),
    providerMessageId: text("provider_message_id"),
    status: text("status").$type<"sent" | "failed">().notNull(),
    attemptedAt: ts("attempted_at").notNull().defaultNow(),
    error: text("error"),
  },
  (t) => [index("digest_deliveries_run_idx").on(t.digestRunId)],
);

export const recipients = pgTable(
  "recipients",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    active: boolean("active").notNull().default(true),
    addedAt: ts("added_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("recipients_email_uq").on(t.email)],
);

export const adminAuditLog = pgTable("admin_audit_log", {
  id: serial("id").primaryKey(),
  action: text("action").notNull(),
  target: text("target").notNull(),
  detailJson: jsonb("detail_json"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Run Log & Observability: every pipeline invocation (cron, preview, send, resend). */
export const pipelineRuns = pgTable(
  "pipeline_runs",
  {
    id: text("id").primaryKey(),
    digestRunId: integer("digest_run_id").references(() => digestRuns.id, { onDelete: "set null" }),
    isoWeek: text("iso_week").notNull(),
    trigger: text("trigger").$type<"cron" | "preview" | "send" | "resend" | "continue" | "rebuild">().notNull(),
    status: text("status").$type<"running" | "ok" | "partial" | "failed" | "skipped">().notNull(),
    phase: text("phase").notNull().default("start"),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
    durationMs: integer("duration_ms"),
    windowStart: ts("window_start"),
    windowEnd: ts("window_end"),
    countsJson: jsonb("counts_json"),
    repoResultsJson: jsonb("repo_results_json"),
    errorsJson: jsonb("errors_json"),
    aiCalls: integer("ai_calls").notNull().default(0),
    aiFallbacks: integer("ai_fallbacks").notNull().default(0),
    aiCacheHits: integer("ai_cache_hits").notNull().default(0),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    previewModelJson: jsonb("preview_model_json"),
    note: text("note"),
  },
  (t) => [index("pipeline_runs_started_idx").on(t.startedAt)],
);

/** Conditional-request cache for GitHub GETs (ETag / If-None-Match). */
export const httpCache = pgTable("http_cache", {
  url: text("url").primaryKey(),
  etag: text("etag").notNull(),
  body: text("body").notNull(),
  fetchedAt: ts("fetched_at").notNull().defaultNow(),
});

/** Login rate limiting, keyed by a hash of the client IP. */
export const loginAttempts = pgTable("login_attempts", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: ts("window_start").notNull().defaultNow(),
});
