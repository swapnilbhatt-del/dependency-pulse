import { DIMENSIONS, WEIGHTS, type Dimension } from "@/lib/health/config";
import { DIMENSION_LABEL } from "@/lib/health/labels";
import type { DimensionScore, Metric, RawMetrics, Verdict } from "@/lib/health/types";
import { VERDICT_LABEL } from "@/lib/health/types";

export interface MetricRow {
  label: string;
  value: string; // formatted, or "Not available"
  missing: boolean;
  reason: string | null;
  source: string;
  fetchedAt: string | null;
  note: string | null;
}

const int = (n: number) => n.toLocaleString("en-US");
function row<T>(label: string, m: Metric<T> | undefined, fmt: (v: T) => string): MetricRow {
  if (!m) return { label, value: "Not available", missing: true, reason: "Not collected", source: "—", fetchedAt: null, note: null };
  return {
    label,
    value: m.value === null || m.value === undefined ? "Not available" : fmt(m.value),
    missing: m.value === null || m.value === undefined,
    reason: m.value === null ? (m.reason ?? "Not available") : null,
    source: m.source,
    fetchedAt: m.fetchedAt,
    note: m.note ?? null,
  };
}
const days = (n: number) => `${int(n)} ${n === 1 ? "day" : "days"}`;
const yesNo = (b: boolean) => (b ? "Yes" : "No");
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** The metrics behind each dimension, for the report's detail drawers and the comparison table. */
export function dimensionMetrics(d: Dimension, m: RawMetrics): MetricRow[] {
  switch (d) {
    case "cadence":
      return [
        row("Days since last release", m.cadence.daysSinceLastRelease, days),
        row("Releases in last 365 days", m.cadence.releasesLast365, int),
        row("Median days between releases (2 years)", m.cadence.medianDaysBetweenReleases, days),
        row("Uses GitHub Releases", m.cadence.usesGithubReleases, (b) => (b ? "Yes" : "No, tags only")),
        row("Latest release", m.cadence.latestReleaseTag, (s) => s),
      ];
    case "maintenance":
      return [
        row("Archived", m.repo.archived, yesNo),
        row("Disabled", m.repo.disabled, yesNo),
        row("Days since last default-branch commit", m.maintenance.daysSinceLastCommit, days),
        row("Commits in last 365 days", m.maintenance.commitsLast365, (n) => `${m.maintenance.commitsCapped ? "≥ " : ""}${int(n)}`),
      ];
    case "responsiveness":
      return [
        row("Issues sampled", m.responsiveness.issueSampleSize, int),
        row("Pull requests sampled", m.responsiveness.prSampleSize, int),
        row("Median time to first response", m.responsiveness.medianHoursToFirstResponse, (h) => (h < 48 ? `${h} hours` : `${Math.round(h / 24)} days`)),
        row("Share with a maintainer response", m.responsiveness.maintainerResponseShare, pct),
      ];
    case "maintainerDepth":
      return [
        row("Distinct contributors (365 days)", m.maintainerDepth.distinctContributors365, int),
        row("Top contributor's share of commits", m.maintainerDepth.topContributorShare365, pct),
        row("Top contributor", m.maintainerDepth.topContributor, (s) => s),
        row("Low bus factor", m.maintainerDepth.lowBusFactor, yesNo),
      ];
    case "governance":
      return [
        row("License (SPDX)", m.governance.licenseSpdx, (s) => s),
        row("License status", m.governance.licenseStatus, (s) => ({ osi: "OSI-approved", non_osi: "Not OSI-approved", unknown: "Unknown", none: "None" })[s]),
        row("Security policy", m.governance.hasSecurityPolicy, yesNo),
        row("Code of conduct (info)", m.governance.hasCodeOfConduct, yesNo),
        row("Contributing guide (info)", m.governance.hasContributingGuide, yesNo),
        row("Issue templates (info)", m.governance.hasIssueTemplates, yesNo),
        row("Community profile (info)", m.governance.communityHealthPercentage, (n) => `${n}%`),
      ];
    case "ci":
      return [row("Default-branch checks", m.ci.status, (s) => ({ passing: "Passing", failing: "Failing", unknown: "Unknown" })[s]), row("Method", m.ci.method, (s) => s)];
    case "security":
      return [
        row("OpenSSF Scorecard", m.security.scorecardScore, (n) => `${n} / 10`),
        row("Scorecard date", m.security.scorecardDate, (s) => s),
        row("Advisories (365 days)", m.security.advisoriesLast365, int),
      ];
    case "vulnerabilities":
      return [
        row("Package", { value: m.vulnerabilities.packageName ? `${m.vulnerabilities.ecosystem === "pypi" ? "PyPI" : "npm"}: ${m.vulnerabilities.packageName}` : null, source: "Entered in admin", fetchedAt: null, reason: "No npm or PyPI package set" }, (s) => s),
        row("Latest version", m.vulnerabilities.latestVersion, (s) => s),
        row("Known vulnerabilities (all versions)", m.vulnerabilities.total, int),
        row("With a fixed version", m.vulnerabilities.withFix, int),
        row("Affecting the latest version", m.vulnerabilities.affectingLatest, int),
        row("Published in last 365 days", m.vulnerabilities.publishedLast365, int),
        row("Most recent published", m.vulnerabilities.mostRecentPublished, (s) => s.slice(0, 10)),
      ];
    case "adoption":
      return [
        row("Weekly downloads", m.adoption.weeklyDownloads, int),
        row("Stars (weak signal)", m.repo.stars, int),
        row("Forks (weak signal)", m.repo.forks, int),
        row("Dependents", m.adoption.dependents, int),
      ];
  }
}

/** The headline value for a dimension in the comparison table. */
export function headline(d: Dimension, m: RawMetrics): string {
  const first = dimensionMetrics(d, m).find((r) => !r.missing);
  if (d === "security") return m.security.scorecardScore.value !== null ? `Scorecard ${m.security.scorecardScore.value}/10` : "Not available";
  if (d === "vulnerabilities" && m.vulnerabilities.total.value !== null) return `${m.vulnerabilities.affectingLatest.value ?? "?"} unfixed · ${m.vulnerabilities.total.value} total`;
  if (d === "maintainerDepth" && m.maintainerDepth.distinctContributors365.value !== null)
    return `${m.maintainerDepth.distinctContributors365.value} people · top ${m.maintainerDepth.topContributorShare365.value !== null ? pct(m.maintainerDepth.topContributorShare365.value) : "?"}`;
  if (d === "responsiveness" && m.responsiveness.medianHoursToFirstResponse.value !== null) {
    const h = m.responsiveness.medianHoursToFirstResponse.value;
    return `${h < 48 ? `${h} h` : `${Math.round(h / 24)} d`} median (sampled)`;
  }
  return first ? `${first.label.replace(/ \(.*\)$/, "")}: ${first.value}` : "Not available";
}

export function dimensionBand(s: DimensionScore | undefined): "Healthy" | "Watch" | "Risky" | "No data" {
  if (!s || s.score === null) return "No data";
  return s.score >= 75 ? "Healthy" : s.score >= 50 ? "Watch" : "Risky";
}

/** Plain-language summary of what changed between the last two snapshots. */
export function trendSummary(trend: { verdict: Verdict; score: number | null; dimensions: Record<string, DimensionScore>; isoWeek: string }[]): string[] {
  if (trend.length < 2) return trend.length === 1 ? ["First snapshot; changes will appear after the next weekly refresh."] : [];
  const [prev, cur] = trend.slice(-2);
  const out: string[] = [];
  if (prev.verdict !== cur.verdict) out.push(`Verdict changed from ${VERDICT_LABEL[prev.verdict]} to ${VERDICT_LABEL[cur.verdict]} on the last refresh (${cur.isoWeek}).`);
  else if (prev.score !== cur.score && prev.score !== null && cur.score !== null) out.push(`Score moved from ${prev.score} to ${cur.score}; the verdict stayed ${VERDICT_LABEL[cur.verdict]}.`);
  const rank = { Healthy: 3, Watch: 2, Risky: 1, "No data": 0 } as const;
  for (const d of DIMENSIONS) {
    const a = dimensionBand(prev.dimensions?.[d]);
    const b = dimensionBand(cur.dimensions?.[d]);
    if (a === b) continue;
    const dir = b === "No data" ? "lost data" : a === "No data" ? "gained data" : rank[b] > rank[a] ? "improved" : "dropped";
    out.push(dir === "lost data" || dir === "gained data" ? `${DIMENSION_LABEL[d]} ${dir} on the last refresh (${a} → ${b}).` : `${DIMENSION_LABEL[d]} ${dir} from ${a} to ${b} on the last refresh.`);
  }
  return out.length ? out : ["No changes since the previous refresh."];
}

export function strongestPerRow(values: (number | null)[], higherIsBetter = true): number[] {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) return [];
  const best = higherIsBetter ? Math.max(...nums) : Math.min(...nums);
  return values.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0);
}

export const DIMENSION_ORDER: Dimension[] = [...DIMENSIONS].sort((a, b) => WEIGHTS[b] - WEIGHTS[a]);
