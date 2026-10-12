import { BUS_FACTOR_LOW_SHARE, MIN_WEIGHT_COVERAGE, WEIGHTS, type Dimension } from "@/lib/health/config";
import type { DimensionScore, GateHit, RawMetrics, Reason, ReasonTag } from "@/lib/health/types";

/**
 * Reason templates. Every sentence is built from one specific metric value.
 * No reason is produced for a metric that is missing (null).
 */

export const fmtInt = (n: number) => n.toLocaleString("en-US");
const pct = (share: number) => `${Math.round(share * 100)} percent`;
const plural = (n: number, one: string, many = `${one}s`) => `${fmtInt(n)} ${n === 1 ? one : many}`;
function duration(hours: number): string {
  if (hours < 48) return `${Math.round(hours)} ${Math.round(hours) === 1 ? "hour" : "hours"}`;
  const d = Math.round(hours / 24);
  return `${d} ${d === 1 ? "day" : "days"}`;
}

export function buildReasons(m: RawMetrics, dims: Record<Dimension, DimensionScore>, gates: GateHit[], coverage: number): Reason[] {
  const out: Reason[] = [];
  const add = (id: string, dimension: Dimension | "gate" | "coverage" | "manual", tag: ReasonTag, text: string) => out.push({ id, dimension, tag, text });

  for (const g of gates) add(`gate.${g.id}`, "gate", "concern", g.text);
  if (coverage < MIN_WEIGHT_COVERAGE)
    add("coverage.low", "coverage", "concern", `Only ${Math.round(coverage * 100)} percent of the scoring weight had data, below the ${Math.round(MIN_WEIGHT_COVERAGE * 100)} percent needed for a verdict.`);

  // Cadence
  const c = m.cadence;
  const tagWord = c.usesGithubReleases.value === false ? "tag" : "release";
  if (c.daysSinceLastRelease.value !== null) {
    const d = c.daysSinceLastRelease.value;
    add("cadence.recency", "cadence", d <= 90 ? "positive" : d <= 365 ? "neutral" : "concern", `Last ${tagWord} was ${plural(d, "day")} ago${c.latestReleaseTag.value ? ` (${c.latestReleaseTag.value})` : ""}.`);
  }
  if (c.releasesLast365.value !== null) {
    const n = c.releasesLast365.value;
    add("cadence.volume", "cadence", n >= 4 ? "positive" : n >= 1 ? "neutral" : "concern", n === 0 ? `No ${tagWord}s in the last 365 days.` : `${plural(n, tagWord)} in the last 365 days.`);
  }
  if (c.medianDaysBetweenReleases.value !== null)
    add("cadence.interval", "cadence", "neutral", `Median gap between ${tagWord}s over the last 2 years: ${plural(c.medianDaysBetweenReleases.value, "day")}.`);
  if (c.usesGithubReleases.value === false) add("cadence.tags_only", "cadence", "neutral", "The project publishes tags but not GitHub Releases, so there are no release notes to read.");

  // Maintenance
  const mt = m.maintenance;
  if (mt.daysSinceLastCommit.value !== null && m.repo.archived.value !== true) {
    const d = mt.daysSinceLastCommit.value;
    add("maintenance.recency", "maintenance", d <= 30 ? "positive" : d <= 180 ? "neutral" : "concern", `Last commit to the default branch was ${plural(d, "day")} ago.`);
  }
  if (mt.commitsLast365.value !== null)
    add("maintenance.commits", "maintenance", "neutral", `${mt.commitsCapped ? "At least " : ""}${plural(mt.commitsLast365.value, "commit")} in the last 365 days${mt.commitsCapped ? " (count capped)" : ""}.`);

  // Responsiveness (always labelled as a sample)
  const r = m.responsiveness;
  const sample = `sample of ${plural(r.issueSampleSize.value ?? 0, "issue")} and ${plural(r.prSampleSize.value ?? 0, "pull request")}`;
  if (dims.responsiveness.status !== "insufficient") {
    if (r.medianHoursToFirstResponse.value !== null) {
      const h = r.medianHoursToFirstResponse.value;
      add("responsiveness.speed", "responsiveness", h <= 72 ? "positive" : h <= 168 ? "neutral" : "concern", `Median time to a first response from someone other than the author: ${duration(h)} (${sample} from the last 90 days).`);
    } else add("responsiveness.none", "responsiveness", "concern", `None of the sampled items received a response from someone other than the author (${sample}).`);
    if (r.maintainerResponseShare.value !== null) {
      const s = r.maintainerResponseShare.value;
      add("responsiveness.share", "responsiveness", s >= 0.6 ? "positive" : s >= 0.3 ? "neutral" : "concern", `Maintainers responded to ${pct(s)} of sampled items.`);
    }
  }

  // Maintainer depth
  const md = m.maintainerDepth;
  if (md.distinctContributors365.value !== null) {
    const n = md.distinctContributors365.value;
    add("depth.people", "maintainerDepth", n >= 5 ? "positive" : n >= 2 ? "neutral" : "concern", `${plural(n, "person", "people")} committed in the last 365 days.`);
  }
  if (md.topContributorShare365.value !== null && md.topContributorShare365.value <= BUS_FACTOR_LOW_SHARE) {
    const s = md.topContributorShare365.value;
    add("depth.share", "maintainerDepth", s <= 0.4 ? "positive" : "neutral", `The most active contributor authored ${pct(s)} of commits in the last 365 days.`);
  }

  // Governance
  const g = m.governance;
  if (g.licenseStatus.value === "osi") add("governance.license", "governance", "positive", `Licensed under ${g.licenseSpdx.value} (OSI-approved).`);
  if (g.hasSecurityPolicy.value !== null)
    add("governance.security_policy", "governance", g.hasSecurityPolicy.value ? "positive" : "concern", g.hasSecurityPolicy.value ? "Publishes a security policy for reporting vulnerabilities." : "No security policy (SECURITY.md) was found.");
  if (g.communityHealthPercentage.value !== null)
    add("governance.community", "governance", "neutral", `GitHub community profile is ${g.communityHealthPercentage.value} percent complete (informational).`);

  // CI
  const ci = m.ci.status.value;
  if (ci === "passing") add("ci.passing", "ci", "positive", "Checks on the default branch are passing.");
  if (ci === "failing") add("ci.failing", "ci", "concern", "Checks on the default branch are failing.");

  // Security posture
  const sec = m.security;
  if (sec.scorecardScore.value !== null) {
    const s = sec.scorecardScore.value;
    add("security.scorecard", "security", s >= 7 ? "positive" : s >= 4 ? "neutral" : "concern", `OpenSSF Scorecard score is ${s} out of 10.`);
  }
  if (sec.advisoriesLast365.value !== null) {
    const n = sec.advisoriesLast365.value;
    add("security.advisories", "security", n === 0 ? "neutral" : "concern", n === 0 ? "No GitHub security advisories published in the last 365 days." : `${plural(n, "GitHub security advisory", "GitHub security advisories")} published in the last 365 days.`);
  }

  // Known vulnerabilities (OSV)
  const v = m.vulnerabilities;
  if (v.packageName && v.total.value !== null) {
    const pkg = `${v.packageName} (${v.ecosystem === "pypi" ? "PyPI" : "npm"})`;
    if (v.foundInOsv.value === false) add("vulns.none", "vulnerabilities", "neutral", `OSV has no vulnerability records for ${pkg}.`);
    else if ((v.affectingLatest.value ?? 0) === 0 && v.affectingLatest.value !== null)
      add("vulns.fixed", "vulnerabilities", "positive", `None of the ${plural(v.total.value, "known vulnerability", "known vulnerabilities")} for ${pkg} affect the latest version (${v.latestVersion.value}).`);
    if ((v.publishedLast365.value ?? 0) > 0)
      add("vulns.recent", "vulnerabilities", "neutral", `${plural(v.publishedLast365.value!, "vulnerability", "vulnerabilities")} for ${pkg} published in the last 365 days.`);
  }

  // Adoption (stars are a weak signal and said so)
  const a = m.adoption;
  if (a.weeklyDownloads.value !== null)
    add("adoption.downloads", "adoption", a.weeklyDownloads.value >= 100_000 ? "positive" : "neutral", `${fmtInt(a.weeklyDownloads.value)} downloads last week on ${a.downloadsSource.value ?? "the registry"}.`);
  if (m.repo.stars.value !== null) add("adoption.stars", "adoption", "neutral", `${fmtInt(m.repo.stars.value)} GitHub stars (a weak signal on its own).`);

  if (m.manual.sponsorship !== "unknown") add("manual.backing", "manual", "neutral", `Backing: ${m.manual.sponsorship.replace("-", " ")} (entered by the team).`);

  // Order: gates and coverage first, then concerns by weight, then neutral, then positives by weight.
  const tagRank: Record<ReasonTag, number> = { concern: 0, neutral: 1, positive: 2 };
  const weightOf = (d: string) => (d in WEIGHTS ? WEIGHTS[d as Dimension] : d === "gate" || d === "coverage" ? 1000 : 0);
  return out
    .map((x, i) => ({ x, i }))
    .sort((p, q) => tagRank[p.x.tag] - tagRank[q.x.tag] || weightOf(q.x.dimension) - weightOf(p.x.dimension) || p.i - q.i)
    .map((p) => p.x);
}
