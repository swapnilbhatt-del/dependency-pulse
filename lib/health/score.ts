import {
  ABANDONED_DAYS,
  BANDS,
  BUS_FACTOR_LOW_SHARE,
  COLLECTION,
  DIMENSIONS,
  HEALTH_CONFIG_VERSION,
  MIN_WEIGHT_COVERAGE,
  MIX,
  VERDICT_THRESHOLDS,
  WEIGHTS,
  bandPoints,
  type Dimension,
} from "@/lib/health/config";
import { buildReasons } from "@/lib/health/reasons";
import type { DimensionScore, GateHit, HealthReport, RawMetrics, Verdict } from "@/lib/health/types";

/**
 * Deterministic scoring. No model is involved anywhere in this file.
 * docs/HEALTH_METHOD.md walks through every function with worked examples.
 */

const insufficient = (note: string): DimensionScore => ({ score: null, status: "insufficient", note });
const scored = (score: number, note: string | null = null, partial = false): DimensionScore => ({
  score: Math.round(Math.max(0, Math.min(100, score))),
  status: partial ? "partial" : "scored",
  note,
});

export function scoreCadence(m: RawMetrics["cadence"]): DimensionScore {
  const days = m.daysSinceLastRelease.value;
  const count = m.releasesLast365.value;
  if (days === null && count === null) return insufficient("No release or tag dates available");
  const tagsOnly = m.usesGithubReleases.value === false ? "from tags (no GitHub Releases)" : null;
  if (days === null) return scored(bandPoints(BANDS.releasesPerYear, count!), tagsOnly ?? "release count only", true);
  if (count === null) return scored(bandPoints(BANDS.releaseRecencyDays, days), tagsOnly ?? "recency only", true);
  return scored(MIX.cadence.recency * bandPoints(BANDS.releaseRecencyDays, days) + MIX.cadence.volume * bandPoints(BANDS.releasesPerYear, count), tagsOnly);
}

export function scoreMaintenance(m: RawMetrics["maintenance"], archived: boolean | null): DimensionScore {
  if (archived === true) return scored(0, "archived");
  const days = m.daysSinceLastCommit.value;
  if (days === null) return insufficient("Default-branch commit date not available");
  return scored(bandPoints(BANDS.commitRecencyDays, days), archived === null ? "archive status unknown" : null, archived === null);
}

export function scoreResponsiveness(m: RawMetrics["responsiveness"]): DimensionScore {
  const n = (m.issueSampleSize.value ?? 0) + (m.prSampleSize.value ?? 0);
  if (n < COLLECTION.minResponsivenessSample) return insufficient(`Only ${n} recent issues or PRs to sample`);
  const share = m.maintainerResponseShare.value;
  const hours = m.medianHoursToFirstResponse.value;
  // No non-author comment on any sampled item → speed scores 0 (nobody answered).
  const speed = hours === null ? 0 : bandPoints(BANDS.firstResponseHours, hours);
  if (share === null) return scored(speed, `sampled (${n} items), response share unavailable`, true);
  return scored(MIX.responsiveness.speed * speed + MIX.responsiveness.share * share * 100, `sampled (${n} items)`);
}

export function scoreMaintainerDepth(m: RawMetrics["maintainerDepth"]): DimensionScore {
  const people = m.distinctContributors365.value;
  if (people === null) return insufficient("Commit authors not available");
  const share = m.topContributorShare365.value;
  if (share === null) return scored(bandPoints(BANDS.distinctContributors, people), "contributor count only", true);
  return scored(MIX.maintainerDepth.contributors * bandPoints(BANDS.distinctContributors, people) + MIX.maintainerDepth.topShare * bandPoints(BANDS.topContributorShare, share));
}

export function scoreGovernance(m: RawMetrics["governance"]): DimensionScore {
  const lic = m.licenseStatus.value;
  const sec = m.hasSecurityPolicy.value;
  if (lic === null && sec === null) return insufficient("License and security policy not available");
  const licPts = lic === "osi" ? MIX.governance.osiLicense : lic === "non_osi" ? MIX.governance.nonOsiLicense : 0;
  const secPts = sec ? MIX.governance.securityPolicy : 0;
  const partial = lic === null || sec === null;
  return scored(licPts + secPts, partial ? "partial: one of license / security policy unavailable" : null, partial);
}

export function scoreCi(m: RawMetrics["ci"]): DimensionScore {
  const s = m.status.value;
  if (s === "passing") return scored(MIX.ci.passing);
  if (s === "failing") return scored(MIX.ci.failing);
  return insufficient("No checks or statuses on the default branch head");
}

export function scoreSecurity(m: RawMetrics["security"]): DimensionScore {
  const sc = m.scorecardScore.value;
  if (sc === null) return insufficient("No OpenSSF Scorecard data for this repository");
  const adv = m.advisoriesLast365.value;
  const penalty = adv === null ? 0 : Math.min(MIX.security.advisoryPenaltyCap, adv * MIX.security.advisoryPenalty);
  return scored(sc * 10 - penalty, adv === null ? "advisory count unavailable" : null, adv === null);
}

export function scoreVulnerabilities(m: RawMetrics["vulnerabilities"]): DimensionScore {
  if (!m.packageName) return insufficient("No npm or PyPI package to look up");
  if (m.total.value === null) return insufficient(m.total.reason ?? "OSV lookup failed");
  if ((m.affectingLatest.value ?? 0) > 0) return scored(MIX.vulnerabilities.affectingLatest, "known vulnerability affects the latest version");
  const recent = m.publishedLast365.value ?? 0;
  const pts = recent === 0 ? 100 : Math.max(MIX.vulnerabilities.recentFloor, 100 - recent * MIX.vulnerabilities.perRecentPenalty);
  return scored(pts, m.foundInOsv.value === false ? "no records in OSV" : null, m.affectingLatest.value === null);
}

export function scoreAdoption(m: RawMetrics["adoption"], stars: number | null): DimensionScore {
  const dl = m.weeklyDownloads.value;
  if (dl === null && stars === null) return insufficient("No download or star data");
  if (dl === null) return scored(bandPoints(BANDS.stars, stars!), "stars only (weak signal)", true);
  if (stars === null) return scored(bandPoints(BANDS.weeklyDownloads, dl), "downloads only", true);
  return scored(MIX.adoption.downloads * bandPoints(BANDS.weeklyDownloads, dl) + MIX.adoption.stars * bandPoints(BANDS.stars, stars));
}

export function scoreDimensions(m: RawMetrics): Record<Dimension, DimensionScore> {
  return {
    security: scoreSecurity(m.security),
    vulnerabilities: scoreVulnerabilities(m.vulnerabilities),
    maintenance: scoreMaintenance(m.maintenance, m.repo.archived.value),
    cadence: scoreCadence(m.cadence),
    responsiveness: scoreResponsiveness(m.responsiveness),
    maintainerDepth: scoreMaintainerDepth(m.maintainerDepth),
    governance: scoreGovernance(m.governance),
    ci: scoreCi(m.ci),
    adoption: scoreAdoption(m.adoption, m.repo.stars.value),
  };
}

/** Weighted mean over dimensions with data; coverage = share of total weight that had data. */
export function weightedOverall(dims: Record<Dimension, DimensionScore>): { overall: number | null; coverage: number } {
  let covered = 0;
  let sum = 0;
  const total = DIMENSIONS.reduce((n, d) => n + WEIGHTS[d], 0);
  for (const d of DIMENSIONS) {
    const s = dims[d];
    if (s.score === null) continue;
    covered += WEIGHTS[d];
    sum += WEIGHTS[d] * s.score;
  }
  return { overall: covered === 0 ? null : Math.round(sum / covered), coverage: covered / total };
}

export function mapVerdict(overall: number | null, coverage: number): Verdict {
  if (overall === null || coverage < MIN_WEIGHT_COVERAGE) return "insufficient";
  if (overall >= VERDICT_THRESHOLDS.healthy) return "healthy";
  if (overall >= VERDICT_THRESHOLDS.watch) return "watch";
  return "risky";
}

export function evaluateGates(m: RawMetrics): GateHit[] {
  const gates: GateHit[] = [];
  if (m.repo.archived.value === true) gates.push({ id: "archived", cap: "risky", text: "The repository is archived, so no further fixes are expected." });
  const lic = m.governance.licenseStatus.value;
  if (lic === "none" || lic === "unknown" || lic === "non_osi") {
    const what = lic === "none" ? "No license was found" : lic === "unknown" ? "The license could not be identified" : `The license (${m.governance.licenseSpdx.value}) is not OSI-approved`;
    gates.push({ id: "license", cap: "watch", text: `${what}. License needs legal review.` });
  }
  const rel = m.cadence.daysSinceLastRelease.value;
  const com = m.maintenance.daysSinceLastCommit.value;
  const noRecentRelease = rel === null ? m.cadence.releasesLast365.value === 0 : rel > ABANDONED_DAYS;
  if (noRecentRelease && com !== null && com > ABANDONED_DAYS)
    gates.push({ id: "abandoned", cap: "risky", text: `No release and no default-branch commit in the last ${ABANDONED_DAYS} days.` });
  const unfixed = m.vulnerabilities.affectingLatest.value;
  if (unfixed !== null && unfixed > 0)
    gates.push({ id: "unfixed_vuln", cap: "watch", text: `${unfixed} known ${unfixed === 1 ? "vulnerability affects" : "vulnerabilities affect"} the latest version (${m.vulnerabilities.latestVersion.value}).` });
  const share = m.maintainerDepth.topContributorShare365.value;
  if (share !== null && share > BUS_FACTOR_LOW_SHARE)
    gates.push({ id: "bus_factor", cap: "watch", text: `One contributor authored ${Math.round(share * 100)} percent of commits in the last 365 days (low bus factor).` });
  return gates;
}

const RANK: Record<Exclude<Verdict, "insufficient">, number> = { risky: 1, watch: 2, healthy: 3 };

/**
 * Gates only ever cap a verdict, never raise it. A Risky cap also applies to
 * "Insufficient data", because archived or abandoned is definitive negative
 * evidence; a Watch cap leaves "Insufficient data" as it is.
 */
export function applyGates(verdict: Verdict, gates: GateHit[]): Verdict {
  let v = verdict;
  for (const g of gates) {
    if (v === "insufficient") {
      if (g.cap === "risky") v = "risky";
      continue;
    }
    if (RANK[g.cap] < RANK[v]) v = g.cap;
  }
  return v;
}

export const LIMITATIONS =
  "Does not assess code quality, test coverage, API design, or how well it fits your team's specific usage. Responsiveness is based on a sample of recent issues and pull requests.";

export function evaluate(m: RawMetrics): HealthReport {
  const dimensions = scoreDimensions(m);
  const { overall, coverage } = weightedOverall(dimensions);
  const computedVerdict = mapVerdict(overall, coverage);
  const gates = evaluateGates(m);
  const verdict = applyGates(computedVerdict, gates);
  return {
    configVersion: HEALTH_CONFIG_VERSION,
    dimensions,
    overallScore: overall,
    weightCoverage: Math.round(coverage * 100) / 100,
    computedVerdict,
    verdict,
    gates,
    reasons: buildReasons(m, dimensions, gates, coverage),
    limitations: LIMITATIONS,
  };
}
