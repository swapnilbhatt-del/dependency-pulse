/**
 * Adoption Check: every threshold and weight used to score a candidate.
 *
 * Bump HEALTH_CONFIG_VERSION whenever any value changes. The version is stored
 * on every health snapshot, so a verdict can always be recomputed by hand with
 * the exact numbers that produced it (see docs/HEALTH_METHOD.md).
 */
export const HEALTH_CONFIG_VERSION = "2026-10-12.2"; // .2: GitHub's deprecated GNU license IDs are mapped before the OSI check.

/** Dimension weights (sum = 100). Justified in README → Adoption Check. */
export const WEIGHTS = {
  security: 20, // Scorecard + advisories: the broadest independent signal of security practice.
  vulnerabilities: 15, // Known vulnerabilities in the package itself directly affect us.
  maintenance: 15, // Recent commits / not archived: fixes will keep coming.
  cadence: 10, // Releases are how fixes reach us; commits alone don't ship.
  responsiveness: 10, // How quickly someone answers when we report a problem.
  maintainerDepth: 10, // Bus factor: one person leaving should not end the project.
  governance: 10, // License clarity and a disclosure channel (SECURITY.md).
  ci: 5, // A passing default branch is a weak but useful hygiene signal.
  adoption: 5, // Popularity is easy to inflate and says little about quality.
} as const;
export type Dimension = keyof typeof WEIGHTS;
export const DIMENSIONS = Object.keys(WEIGHTS) as Dimension[];

/** Below this share of total weight with data, the verdict is "Insufficient data". */
export const MIN_WEIGHT_COVERAGE = 0.6; // Fewer than 60 points of evidence is too thin to call.

/** Overall score → verdict. Scores are 0–100. */
export const VERDICT_THRESHOLDS = {
  healthy: 75, // ≥ 75: comfortably above average on most dimensions.
  watch: 50, // 50–74: usable with known caveats; < 50 is Risky.
} as const;

/** Bus factor is "low" when one author has MORE than this share of recent commits. */
export const BUS_FACTOR_LOW_SHARE = 0.6; // 60%: one absence would stall most of the work.

/** Hard-gate inactivity: no release AND no default-branch commit within this many days → Risky. */
export const ABANDONED_DAYS = 365;

/** Collection limits (keep each candidate well inside GitHub's 5,000 requests/hour). */
export const COLLECTION = {
  releaseHistoryDays: 730, // median interval is computed over 2 years
  releasePagesCap: 5, // 500 releases max
  commitPagesCap: 10, // 1,000 commits max; beyond that the count is marked "capped"
  sampleIssues: 50, // responsiveness sample sizes (stated in every report)
  samplePulls: 50,
  sampleWindowDays: 90,
  minResponsivenessSample: 5, // fewer sampled items → responsiveness is "insufficient"
  sourceTimeoutMs: 10_000, // per external call
  sourceRetries: 2, // on 429/5xx/network errors, with exponential backoff
  candidateConcurrency: 4, // parallel requests per candidate
} as const;

/** Maintainer associations that count as a "maintainer response". */
export const MAINTAINER_ASSOCIATIONS = ["OWNER", "MEMBER", "COLLABORATOR"] as const;

/**
 * Piecewise scoring tables: the first row whose `max` the value does not exceed
 * gives the points. Each table states its rationale.
 */
export type Band = { max: number; points: number };

export const BANDS = {
  /** Days since last release: monthly is great, yearly is a warning. */
  releaseRecencyDays: [
    { max: 30, points: 100 },
    { max: 90, points: 85 },
    { max: 180, points: 65 },
    { max: 365, points: 40 },
    { max: Infinity, points: 10 },
  ],
  /** Releases in the last 365 days: none, 1–3, 4–11, monthly or more. */
  releasesPerYear: [
    { max: 0, points: 10 },
    { max: 3, points: 55 },
    { max: 11, points: 80 },
    { max: Infinity, points: 100 },
  ],
  /** Days since last default-branch commit. */
  commitRecencyDays: [
    { max: 14, points: 100 },
    { max: 30, points: 90 },
    { max: 90, points: 70 },
    { max: 180, points: 45 },
    { max: 365, points: 25 },
    { max: Infinity, points: 5 },
  ],
  /** Median hours to first non-author comment. */
  firstResponseHours: [
    { max: 24, points: 100 },
    { max: 72, points: 85 },
    { max: 168, points: 65 },
    { max: 720, points: 40 },
    { max: Infinity, points: 15 },
  ],
  /** Distinct commit authors in 365 days. */
  distinctContributors: [
    { max: 1, points: 20 },
    { max: 2, points: 40 },
    { max: 4, points: 60 },
    { max: 9, points: 80 },
    { max: Infinity, points: 100 },
  ],
  /** Top contributor's share of commits (0–1). */
  topContributorShare: [
    { max: 0.4, points: 100 },
    { max: 0.6, points: 70 },
    { max: 0.8, points: 35 },
    { max: Infinity, points: 15 },
  ],
  /** Weekly downloads (npm last-week point, or PyPI last_week). */
  weeklyDownloads: [
    { max: 999, points: 20 },
    { max: 9_999, points: 40 },
    { max: 99_999, points: 65 },
    { max: 999_999, points: 85 },
    { max: Infinity, points: 100 },
  ],
  /** GitHub stars: weakest signal, smallest share of the adoption score. */
  stars: [
    { max: 99, points: 15 },
    { max: 999, points: 40 },
    { max: 9_999, points: 70 },
    { max: Infinity, points: 100 },
  ],
} satisfies Record<string, Band[]>;

/** Mixing ratios inside composite dimensions. */
export const MIX = {
  cadence: { recency: 0.6, volume: 0.4 },
  responsiveness: { speed: 0.5, share: 0.5 },
  maintainerDepth: { contributors: 0.5, topShare: 0.5 },
  adoption: { downloads: 0.8, stars: 0.2 }, // stars alone (no package) → stars only, marked partial
  governance: { osiLicense: 60, nonOsiLicense: 20, securityPolicy: 40 },
  security: { advisoryPenalty: 10, advisoryPenaltyCap: 30 }, // per advisory in 365 days
  vulnerabilities: { affectingLatest: 10, perRecentPenalty: 10, recentFloor: 60, recentDays: 365 },
  ci: { passing: 100, failing: 20 },
} as const;

export function bandPoints(table: Band[], value: number): number {
  for (const b of table) if (value <= b.max) return b.points;
  return table[table.length - 1].points;
}
