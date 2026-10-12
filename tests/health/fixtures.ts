import type { Metric, RawMetrics } from "@/lib/health/types";

const AT = "2026-10-12T10:00:00.000Z";
export const mv = <T,>(value: NoInfer<T> | null, reason?: string): Metric<T> => ({ value, source: "test", fetchedAt: AT, ...(value === null ? { reason: reason ?? "not available" } : {}) });

/** A healthy, fully covered candidate; tests override individual metrics. */
export function metrics(over: (m: RawMetrics) => void = () => {}): RawMetrics {
  const m: RawMetrics = {
    repo: { fullName: "acme/lib", description: mv("A library"), defaultBranch: mv("main"), archived: mv(false), disabled: mv(false), stars: mv(12_000), forks: mv(900) },
    cadence: { daysSinceLastRelease: mv(12), releasesLast365: mv(14), medianDaysBetweenReleases: mv(21), usesGithubReleases: mv(true), latestReleaseTag: mv("v3.2.0") },
    maintenance: { daysSinceLastCommit: mv(3), commitsLast365: mv(420), commitsCapped: false },
    responsiveness: { issueSampleSize: mv(30), prSampleSize: mv(40), medianHoursToFirstResponse: mv(10), maintainerResponseShare: mv(0.8) },
    maintainerDepth: { distinctContributors365: mv(14), topContributorShare365: mv(0.35), topContributor: mv("alice"), lowBusFactor: mv(false) },
    governance: {
      licenseSpdx: mv("MIT"),
      licenseStatus: mv("osi" as const),
      hasSecurityPolicy: mv(true),
      hasCodeOfConduct: mv(true),
      hasContributingGuide: mv(true),
      hasIssueTemplates: mv(true),
      communityHealthPercentage: mv(100),
    },
    ci: { status: mv("passing" as const), method: mv("check-runs" as const) },
    security: { scorecardScore: mv(8), scorecardDate: mv("2026-10-05"), scorecardChecks: mv([]), advisoriesLast365: mv(0) },
    vulnerabilities: {
      ecosystem: "npm",
      packageName: "acme-lib",
      latestVersion: mv("3.2.0"),
      total: mv(0),
      withFix: mv(0),
      publishedLast365: mv(0),
      affectingLatest: mv(0),
      mostRecentPublished: mv(null, "no vulnerabilities"),
      foundInOsv: mv(false),
    },
    adoption: { weeklyDownloads: mv(2_000_000), downloadsSource: mv("npm"), dependents: mv(null, "not collected") },
    manual: { sponsorship: "unknown" },
  };
  over(m);
  return m;
}
