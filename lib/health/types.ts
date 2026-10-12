/** Shared types for the Adoption Check module. */

export type SourceId = "github" | "scorecard" | "osv" | "npm" | "pypi";
export type SourceState = "ok" | "not_available" | "rate_limited" | "error";

export interface SourceStatus {
  state: SourceState;
  /** Plain-language reason when state is not "ok". */
  reason: string | null;
  /** Last successful or attempted fetch time (ISO). */
  at: string;
}

/**
 * One measured value with provenance. A value that could not be obtained is
 * `null` with a reason, never zero.
 */
export interface Metric<T> {
  value: T | null;
  source: string; // endpoint or source label, e.g. "GET /repos/{o}/{r}/releases"
  fetchedAt: string | null;
  reason?: string; // why value is null
  note?: string; // e.g. "sample of 50 issues", "capped at 1,000 commits"
}

export interface ScorecardCheck {
  name: string;
  score: number | null; // -1 in the API means "not applicable" → null here
  reason: string | null;
}

export interface RawMetrics {
  repo: {
    fullName: string;
    description: Metric<string>;
    defaultBranch: Metric<string>;
    archived: Metric<boolean>;
    disabled: Metric<boolean>;
    stars: Metric<number>;
    forks: Metric<number>;
  };
  cadence: {
    daysSinceLastRelease: Metric<number>;
    releasesLast365: Metric<number>;
    medianDaysBetweenReleases: Metric<number>;
    usesGithubReleases: Metric<boolean>;
    latestReleaseTag: Metric<string>;
  };
  maintenance: {
    daysSinceLastCommit: Metric<number>;
    commitsLast365: Metric<number>;
    commitsCapped: boolean;
  };
  responsiveness: {
    issueSampleSize: Metric<number>;
    prSampleSize: Metric<number>;
    medianHoursToFirstResponse: Metric<number>;
    maintainerResponseShare: Metric<number>; // 0–1
  };
  maintainerDepth: {
    distinctContributors365: Metric<number>;
    topContributorShare365: Metric<number>; // 0–1
    topContributor: Metric<string>;
    lowBusFactor: Metric<boolean>;
  };
  governance: {
    licenseSpdx: Metric<string>;
    licenseStatus: Metric<"osi" | "non_osi" | "unknown" | "none">;
    hasSecurityPolicy: Metric<boolean>;
    hasCodeOfConduct: Metric<boolean>;
    hasContributingGuide: Metric<boolean>;
    hasIssueTemplates: Metric<boolean>;
    communityHealthPercentage: Metric<number>;
  };
  ci: {
    status: Metric<"passing" | "failing" | "unknown">;
    method: Metric<"check-runs" | "commit-status">;
  };
  security: {
    scorecardScore: Metric<number>; // 0–10
    scorecardDate: Metric<string>;
    scorecardChecks: Metric<ScorecardCheck[]>;
    advisoriesLast365: Metric<number>;
  };
  vulnerabilities: {
    ecosystem: "npm" | "pypi" | null;
    packageName: string | null;
    latestVersion: Metric<string>;
    total: Metric<number>;
    withFix: Metric<number>;
    publishedLast365: Metric<number>;
    affectingLatest: Metric<number>;
    mostRecentPublished: Metric<string>;
    foundInOsv: Metric<boolean>;
  };
  adoption: {
    weeklyDownloads: Metric<number>;
    downloadsSource: Metric<string>;
    dependents: Metric<number>; // always "not collected"
  };
  manual: {
    sponsorship: "company-backed" | "foundation-backed" | "individual" | "unknown";
  };
}

export type DimensionStatus = "scored" | "partial" | "insufficient";

export interface DimensionScore {
  score: number | null; // 0–100, null when insufficient
  status: DimensionStatus;
  note: string | null; // e.g. "sampled", "stars only"
}

export type Verdict = "healthy" | "watch" | "risky" | "insufficient";
export const VERDICT_LABEL: Record<Verdict, string> = { healthy: "Healthy", watch: "Watch", risky: "Risky", insufficient: "Insufficient data" };

export type ReasonTag = "positive" | "neutral" | "concern";

export interface Reason {
  id: string;
  dimension: string; // a Dimension or "gate"
  tag: ReasonTag;
  text: string;
}

export interface GateHit {
  id: "archived" | "license" | "abandoned" | "unfixed_vuln" | "bus_factor";
  cap: "watch" | "risky";
  text: string;
}

export interface HealthReport {
  configVersion: string;
  dimensions: Record<string, DimensionScore>;
  overallScore: number | null; // weighted over covered dimensions, rounded
  weightCoverage: number; // 0–1
  computedVerdict: Verdict; // before gates
  verdict: Verdict; // after gates
  gates: GateHit[];
  reasons: Reason[];
  limitations: string;
}
