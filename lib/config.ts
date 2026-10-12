/**
 * Static configuration constants. Runtime secrets live in lib/env.ts.
 */

/** Lookback window length. The digest covers [runTime - WINDOW_DAYS, runTime] in UTC. */
export const WINDOW_DAYS = 7;

/**
 * The weekly schedule. MUST match the cron expression in vercel.json
 * (tests/unit/schedule.test.ts enforces this). Times are UTC.
 * Default: Monday 03:30 UTC = 09:00 India Standard Time.
 */
export const DIGEST_SCHEDULE = { weekday: 1, hour: 3, minute: 30 } as const;
export const DIGEST_CRON_EXPRESSION = `${DIGEST_SCHEDULE.minute} ${DIGEST_SCHEDULE.hour} * * ${DIGEST_SCHEDULE.weekday}`;

/**
 * Releases published this many days before the window are re-checked: if one
 * was reported in an earlier digest and its notes have changed since, it comes
 * back under "Updated since last digest" (weekly windows never overlap, so
 * edits would otherwise go unseen).
 */
export const REVISIT_DAYS = 28;

/** FYI summaries shown per repo before collapsing into "+N earlier releases". */
export const DISPLAY_CAP_PER_REPO = 3;

/** Release body characters sent to the model. */
export const AI_BODY_MAX_CHARS = 12_000;
/** Release body characters stored in the database. */
export const DB_BODY_MAX_CHARS = 60_000;

export const GITHUB_API_BASE = "https://api.github.com";
export const GITHUB_API_VERSION = "2022-11-28";
export const GITHUB_TIMEOUT_MS = 10_000;
export const GITHUB_REPO_CONCURRENCY = 5;
export const GITHUB_MAX_RELEASE_PAGES = 5;
/** Stop starting new repos when the remaining primary quota falls below this. */
export const GITHUB_MIN_REMAINING = 25;
/** Max tags whose commit dates are looked up in tag-fallback mode. */
export const GITHUB_TAG_FALLBACK_LIMIT = 15;

export const GEMINI_TIMEOUT_MS = 30_000;
export const GEMINI_CONCURRENCY = 3;
export const GEMINI_TEMPERATURE = 0.1;
export const GEMINI_MAX_OUTPUT_TOKENS = 2_048;

export const EMAIL_TIMEOUT_MS = 10_000;

/**
 * Work budget for one serverless invocation (Vercel Hobby max is 300s).
 * When classification work remains after this, the run continues in a
 * follow-up invocation (see lib/pipeline/run.ts).
 */
export const INVOCATION_BUDGET_MS = 240_000;
export const FUNCTION_MAX_DURATION_S = 300;

export const SESSION_TTL_SECONDS = 60 * 60 * 12;
export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_WINDOW_SECONDS = 15 * 60;

export const CATEGORY_ORDER = ["payments", "auth", "banking", "security", "platform", "data", "tooling", "evaluation"];
