import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  doublePrecision,
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

// ══ Adoption Check (additive; the live digest tables above are untouched) ══════

/** Open-source projects being evaluated before adoption. Separate from `repos` (live dependencies). */
export const evaluationCandidates = pgTable(
  "evaluation_candidates",
  {
    id: serial("id").primaryKey(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    fullName: text("full_name").notNull(),
    slug: text("slug").notNull(),
    packageEcosystem: text("package_ecosystem").$type<"npm" | "pypi">(),
    packageName: text("package_name"),
    intendedUse: text("intended_use").notNull().default(""),
    sponsorshipOrBacking: text("sponsorship_or_backing").$type<"company-backed" | "foundation-backed" | "individual" | "unknown">().notNull().default("unknown"),
    teamNotes: text("team_notes").notNull().default(""),
    /** Private by default: team notes, sponsorship notes, decision reasons and decided_by are hidden on public pages. */
    notesPublic: boolean("notes_public").notNull().default(false),
    adoptionStatus: text("adoption_status").$type<"evaluating" | "adopted" | "rejected" | "parked">().notNull().default("evaluating"),
    adoptionReason: text("adoption_reason").notNull().default(""),
    decidedAt: ts("decided_at"),
    decidedBy: text("decided_by"),
    archivedFromWatchlist: boolean("archived_from_watchlist").notNull().default(false),
    isExample: boolean("is_example").notNull().default(false),
    lastRefreshNote: text("last_refresh_note"),
    addedAt: ts("added_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("evaluation_candidates_full_name_lower_uq").on(sql`lower(${t.fullName})`),
    uniqueIndex("evaluation_candidates_slug_uq").on(t.slug),
    check("evaluation_candidates_eco_ck", sql`${t.packageEcosystem} is null or ${t.packageEcosystem} in ('npm','pypi')`),
    check("evaluation_candidates_status_ck", sql`${t.adoptionStatus} in ('evaluating','adopted','rejected','parked')`),
    check("evaluation_candidates_backing_ck", sql`${t.sponsorshipOrBacking} in ('company-backed','foundation-backed','individual','unknown')`),
  ],
);

/** One health snapshot per candidate per ISO week (forced admin refreshes update that week's row). */
export const healthSnapshots = pgTable(
  "health_snapshots",
  {
    id: serial("id").primaryKey(),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => evaluationCandidates.id, { onDelete: "cascade" }),
    isoWeek: text("iso_week").notNull(),
    capturedAt: ts("captured_at").notNull().defaultNow(),
    configVersion: text("config_version").notNull(),
    rawMetricsJson: jsonb("raw_metrics_json").notNull(),
    dimensionScoresJson: jsonb("dimension_scores_json").notNull(),
    overallScore: integer("overall_score"),
    weightCoverage: doublePrecision("weight_coverage").notNull(),
    verdict: text("verdict").$type<"healthy" | "watch" | "risky" | "insufficient">().notNull(),
    reasonsJson: jsonb("reasons_json").notNull(),
    gatesJson: jsonb("gates_json").notNull(),
    narrativeJson: jsonb("narrative_json"),
    aiStatus: text("ai_status").$type<"ok" | "fallback" | "skipped">().notNull(),
    inputHash: text("input_hash").notNull(),
    sourceStatusJson: jsonb("source_status_json").notNull(),
    linksJson: jsonb("links_json"),
    /** The snapshot shown on reports. A less complete refresh never displaces a more complete one. */
    isCurrent: boolean("is_current").notNull().default(false),
    forced: boolean("forced").notNull().default(false),
  },
  (t) => [
    uniqueIndex("health_snapshots_candidate_week_uq").on(t.candidateId, t.isoWeek),
    index("health_snapshots_candidate_idx").on(t.candidateId, t.capturedAt),
    check("health_snapshots_verdict_ck", sql`${t.verdict} in ('healthy','watch','risky','insufficient')`),
    check("health_snapshots_ai_ck", sql`${t.aiStatus} in ('ok','fallback','skipped')`),
  ],
);

/** Gemini narrative cache, keyed by (candidate, input hash, model). Unchanged metrics never re-call Gemini. */
export const healthNarratives = pgTable(
  "health_narratives",
  {
    id: serial("id").primaryKey(),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => evaluationCandidates.id, { onDelete: "cascade" }),
    inputHash: text("input_hash").notNull(),
    model: text("model").notNull(),
    narrativeJson: jsonb("narrative_json").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("health_narratives_key_uq").on(t.candidateId, t.inputHash, t.model)],
);

/** Append-only decision history. */
export const adoptionDecisions = pgTable(
  "adoption_decisions",
  {
    id: serial("id").primaryKey(),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => evaluationCandidates.id, { onDelete: "cascade" }),
    status: text("status").$type<"evaluating" | "adopted" | "rejected" | "parked">().notNull(),
    reason: text("reason").notNull(),
    decidedBy: text("decided_by").notNull(),
    decidedAt: ts("decided_at").notNull().defaultNow(),
  },
  (t) => [index("adoption_decisions_candidate_idx").on(t.candidateId, t.decidedAt)],
);

/** Health refresh runs (cron or admin), resumable across invocations. */
export const healthRuns = pgTable(
  "health_runs",
  {
    id: text("id").primaryKey(),
    trigger: text("trigger").$type<"cron" | "admin_all" | "admin_one" | "continue">().notNull(),
    isoWeek: text("iso_week").notNull(),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
    status: text("status").$type<"running" | "ok" | "partial" | "failed">().notNull(),
    countsJson: jsonb("counts_json"),
    progressJson: jsonb("progress_json"),
    error: text("error"),
  },
  (t) => [index("health_runs_started_idx").on(t.startedAt)],
);

/** Small key/value settings, e.g. the email feature flag. */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  valueJson: jsonb("value_json").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
