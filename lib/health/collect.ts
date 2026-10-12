import { BUS_FACTOR_LOW_SHARE } from "@/lib/health/config";
import { isOsiApproved } from "@/lib/health/osi-licenses";
import type { HttpDeps, RunCache } from "@/lib/health/sources/http";
import * as gh from "@/lib/health/sources/github";
import { fetchLatestVersion, fetchOsv, fetchScorecard, fetchWeeklyDownloads } from "@/lib/health/sources/public";
import type { Metric, RawMetrics, SourceId, SourceStatus } from "@/lib/health/types";

export interface CandidateInput {
  fullName: string;
  packageEcosystem: "npm" | "pypi" | null;
  packageName: string | null;
  sponsorship: RawMetrics["manual"]["sponsorship"];
}

export interface CollectDeps {
  run: gh.GithubRun;
  http: HttpDeps;
  cache: RunCache;
  now: Date;
}

export interface Collected {
  metrics: RawMetrics;
  sources: Partial<Record<SourceId, SourceStatus>>;
  /** Canonical owner/name reported by GitHub (follows renames). */
  canonicalName: string | null;
  links: Record<string, string>;
}

const DAY = 86_400_000;

export function licenseStatus(spdx: string | null | undefined): "osi" | "non_osi" | "unknown" | "none" {
  if (!spdx) return "none";
  if (spdx === "NOASSERTION" || spdx === "OTHER") return "unknown";
  return isOsiApproved(spdx) ? "osi" : "non_osi";
}

/** Collect every metric for one candidate. Never throws for a source failure. */
export async function collectMetrics(c: CandidateInput, deps: CollectDeps): Promise<Collected> {
  const { run, now } = deps;
  const at = () => new Date().toISOString();
  const ok = <T>(value: T, source: string, note?: string): Metric<T> => ({ value, source, fetchedAt: at(), ...(note ? { note } : {}) });
  const na = <T>(source: string, reason: string): Metric<T> => ({ value: null, source, fetchedAt: at(), reason });
  const sources: Collected["sources"] = {};
  const links: Record<string, string> = { repository: `https://github.com/${c.fullName}` };

  // Public sources run in parallel with GitHub.
  const scorecardP = fetchScorecard(c.fullName, deps.http, deps.cache);
  const pkgP = c.packageEcosystem && c.packageName
    ? (async () => {
        const latest = await fetchLatestVersion(c.packageEcosystem!, c.packageName!, deps.http, deps.cache);
        const [osv, downloads] = await Promise.all([
          fetchOsv(c.packageEcosystem!, c.packageName!, latest.version, now, deps.http, deps.cache),
          fetchWeeklyDownloads(c.packageEcosystem!, c.packageName!, deps.http, deps.cache),
        ]);
        return { latest, osv, downloads };
      })()
    : null;

  // ── GitHub ────────────────────────────────────────────────────────────────
  const R = "GET /repos/{owner}/{repo}";
  let info: gh.RepoInfo | null = null;
  let infoFail: string | null = null;
  try {
    info = await gh.repoInfo(run, c.fullName);
    sources.github = { state: "ok", reason: null, at: at() };
  } catch (err) {
    const r = gh.githubReason(err);
    sources.github = { state: r.state, reason: r.reason, at: at() };
    infoFail = r.reason;
  }
  const name = info?.full_name ?? c.fullName;
  const guard = async <T>(fn: () => Promise<T>): Promise<{ v: T } | { err: string }> => {
    if (!info) return { err: `GitHub unavailable: ${infoFail}` };
    try {
      return { v: await fn() };
    } catch (err) {
      const r = gh.githubReason(err);
      if (r.state === "rate_limited") sources.github = { state: "rate_limited", reason: r.reason, at: at() };
      return { err: r.reason };
    }
  };

  const cad = await guard(() => gh.cadence(run, name, now));
  const com = await guard(() => gh.commitStats(run, name, info!.default_branch, now));
  const resp = await guard(() => gh.responsiveness(run, name, now));
  const prof = await guard(() => gh.community(run, name));
  const secFile = await guard(() => gh.securityPolicyFile(run, name));
  const ci = "v" in com && com.v.headSha ? await guard(() => gh.ciStatus(run, name, com.v.headSha!)) : ({ err: "Default-branch head commit not available" } as const);
  const adv = await guard(() => gh.advisoriesLastYear(run, name, now));
  const scorecard = await scorecardP;
  sources.scorecard = scorecard.status;
  if (scorecard.status.state === "ok") links.scorecard = scorecard.url;
  const pkg = pkgP ? await pkgP : null;

  // Cadence
  const cadence: RawMetrics["cadence"] = "v" in cad
    ? (() => {
        const v = cad.v;
        const src = v.basis === "releases" ? "GET /repos/{o}/{r}/releases" : "GET /repos/{o}/{r}/tags + commit dates";
        const latest = v.dates[0];
        const yearAgo = now.getTime() - 365 * DAY;
        const interval = gh.medianInterval(v.dates);
        return {
          daysSinceLastRelease: latest ? ok(Math.floor((now.getTime() - latest.getTime()) / DAY), src, v.note ?? undefined) : na(src, "No releases or version tags found"),
          releasesLast365: latest || v.basis === "releases" ? ok(v.dates.filter((d) => d.getTime() >= yearAgo).length, src, v.note ?? undefined) : na(src, "No releases or version tags found"),
          medianDaysBetweenReleases: interval === null ? na(src, "Fewer than 3 releases in the last 2 years") : ok(interval, src, "over the last 2 years"),
          usesGithubReleases: ok(v.usesGithubReleases, src),
          latestReleaseTag: v.latestTag ? ok(v.latestTag, src) : na(src, "No releases or version tags found"),
        };
      })()
    : {
        daysSinceLastRelease: na("GET /repos/{o}/{r}/releases", cad.err),
        releasesLast365: na("GET /repos/{o}/{r}/releases", cad.err),
        medianDaysBetweenReleases: na("GET /repos/{o}/{r}/releases", cad.err),
        usesGithubReleases: na("GET /repos/{o}/{r}/releases", cad.err),
        latestReleaseTag: na("GET /repos/{o}/{r}/releases", cad.err),
      };

  const C = "GET /repos/{o}/{r}/commits";
  const commits = "v" in com ? com.v : null;
  const respV = "v" in resp ? resp.v : null;
  const RS = "GET /repos/{o}/{r}/issues + /pulls (+ comments, reviews)";
  const profV = "v" in prof ? prof.v : null;
  const P = "GET /repos/{o}/{r}/community/profile";
  const spdx = info?.license?.spdx_id ?? null;

  // Security policy: repo files first; Scorecard's Security-Policy check also sees org-level policies.
  let hasSec: Metric<boolean>;
  const scSecPolicy = scorecard.checks.find((x) => x.name === "Security-Policy");
  if ("v" in secFile && secFile.v === true) hasSec = ok(true, "GET /repos/{o}/{r}/contents/SECURITY.md");
  else if (scSecPolicy && scSecPolicy.score !== null && scSecPolicy.score > 0) hasSec = ok(true, "OpenSSF Scorecard Security-Policy check", "organisation-level policy");
  else if ("v" in secFile && secFile.v === false) hasSec = ok(false, "GET /repos/{o}/{r}/contents/SECURITY.md (+ .github/, docs/)");
  else hasSec = na("GET /repos/{o}/{r}/contents/SECURITY.md", "err" in secFile ? secFile.err : "Could not determine");

  const metrics: RawMetrics = {
    repo: {
      fullName: name,
      description: info ? ok(info.description ?? "", R) : na(R, infoFail!),
      defaultBranch: info ? ok(info.default_branch, R) : na(R, infoFail!),
      archived: info ? ok(info.archived, R) : na(R, infoFail!),
      disabled: info ? ok(info.disabled, R) : na(R, infoFail!),
      stars: info ? ok(info.stargazers_count, R) : na(R, infoFail!),
      forks: info ? ok(info.forks_count, R) : na(R, infoFail!),
    },
    cadence,
    maintenance: {
      daysSinceLastCommit: commits?.lastCommitAt ? ok(Math.floor((now.getTime() - commits.lastCommitAt.getTime()) / DAY), C) : na(C, "err" in com ? com.err : "No commits on the default branch"),
      commitsLast365: commits ? ok(commits.count365, C, commits.capped ? "capped" : undefined) : na(C, "err" in com ? com.err : "unavailable"),
      commitsCapped: commits?.capped ?? false,
    },
    responsiveness: {
      issueSampleSize: respV ? ok(respV.issueSample, RS, "issues updated in the last 90 days, PRs excluded, bots excluded") : na(RS, "err" in resp ? resp.err : "unavailable"),
      prSampleSize: respV ? ok(respV.prSample, RS, "pull requests updated in the last 90 days, bots excluded") : na(RS, "err" in resp ? resp.err : "unavailable"),
      medianHoursToFirstResponse: respV ? (respV.medianHours === null ? na(RS, "No sampled item had a response from someone other than its author") : ok(respV.medianHours, RS, "sampled")) : na(RS, "err" in resp ? resp.err : "unavailable"),
      maintainerResponseShare: respV && respV.maintainerShare !== null ? ok(respV.maintainerShare, RS, "sampled") : na(RS, respV ? "No items in the sample" : "err" in resp ? resp.err : "unavailable"),
    },
    maintainerDepth: {
      distinctContributors365: commits ? ok(commits.distinctAuthors, C, commits.capped ? "from the most recent 1,000 commits" : undefined) : na(C, "err" in com ? com.err : "unavailable"),
      topContributorShare365: commits && commits.topShare !== null ? ok(Math.round(commits.topShare * 1000) / 1000, C) : na(C, commits ? "No commits in the last 365 days" : "err" in com ? com.err : "unavailable"),
      topContributor: commits?.topAuthor ? ok(commits.topAuthor, C) : na(C, "unavailable"),
      lowBusFactor: commits && commits.topShare !== null ? ok(commits.topShare > BUS_FACTOR_LOW_SHARE, C) : na(C, "unavailable"),
    },
    governance: {
      licenseSpdx: info ? (spdx ? ok(spdx, R) : na(R, "No license detected by GitHub")) : na(R, infoFail!),
      licenseStatus: info ? ok(licenseStatus(spdx), `${R} + OSI list`) : na(R, infoFail!),
      hasSecurityPolicy: hasSec,
      hasCodeOfConduct: profV ? ok(Boolean(profV.files.code_of_conduct), P) : na(P, "err" in prof ? prof.err : "unavailable"),
      hasContributingGuide: profV ? ok(Boolean(profV.files.contributing), P) : na(P, "err" in prof ? prof.err : "unavailable"),
      hasIssueTemplates: profV ? ok(Boolean(profV.files.issue_template), P) : na(P, "err" in prof ? prof.err : "unavailable"),
      communityHealthPercentage: profV ? ok(profV.health_percentage, P) : na(P, "err" in prof ? prof.err : "unavailable"),
    },
    ci: "v" in ci
      ? { status: ok(ci.v.status, `GET /repos/{o}/{r}/commits/{sha}/${ci.v.method === "check-runs" ? "check-runs" : "status"}`), method: ok(ci.v.method, "GitHub") }
      : { status: na("GET /repos/{o}/{r}/commits/{sha}/check-runs", ci.err), method: na("GitHub", ci.err) },
    security: {
      scorecardScore: scorecard.score !== null ? ok(scorecard.score, "OpenSSF Scorecard API") : na("OpenSSF Scorecard API", scorecard.status.reason ?? "not available"),
      scorecardDate: scorecard.date ? ok(scorecard.date, "OpenSSF Scorecard API") : na("OpenSSF Scorecard API", "not available"),
      scorecardChecks: scorecard.score !== null ? ok(scorecard.checks, "OpenSSF Scorecard API") : na("OpenSSF Scorecard API", "not available"),
      advisoriesLast365: "v" in adv ? ok(adv.v, "GET /repos/{o}/{r}/security-advisories") : na("GET /repos/{o}/{r}/security-advisories", adv.err),
    },
    vulnerabilities: (() => {
      const O = "OSV.dev POST /v1/query";
      if (!pkg) {
        const reason = "No npm or PyPI package set for this candidate";
        return { ecosystem: c.packageEcosystem, packageName: c.packageName, latestVersion: na(O, reason), total: na(O, reason), withFix: na(O, reason), publishedLast365: na(O, reason), affectingLatest: na(O, reason), mostRecentPublished: na(O, reason), foundInOsv: na(O, reason) };
      }
      const o = pkg.osv;
      const fail = o.status.reason ?? "OSV unavailable";
      const reg = c.packageEcosystem === "npm" ? "registry.npmjs.org" : "pypi.org JSON API";
      return {
        ecosystem: c.packageEcosystem,
        packageName: c.packageName,
        latestVersion: pkg.latest.version ? ok(pkg.latest.version, reg) : na(reg, pkg.latest.status.reason ?? "not found"),
        total: o.total !== null ? ok(o.total, O) : na(O, fail),
        withFix: o.withFix !== null ? ok(o.withFix, O) : na(O, fail),
        publishedLast365: o.publishedLast365 !== null ? ok(o.publishedLast365, O) : na(O, fail),
        affectingLatest: o.affectingLatest !== null ? ok(o.affectingLatest, O, pkg.latest.version ? `queried with ${pkg.latest.version}` : undefined) : na(O, o.affectingLatestReason ?? fail),
        mostRecentPublished: o.mostRecentPublished ? ok(o.mostRecentPublished, O) : na(O, o.total === 0 ? "No vulnerability records" : fail),
        foundInOsv: o.total !== null ? ok(o.total > 0, O, o.total === 0 ? "not found in OSV" : undefined) : na(O, fail),
      };
    })(),
    adoption: {
      weeklyDownloads: pkg?.downloads.weekly != null ? ok(pkg.downloads.weekly, pkg.downloads.source) : na(pkg ? pkg.downloads.source : "registry", pkg ? (pkg.downloads.status.reason ?? "unavailable") : "No npm or PyPI package set for this candidate"),
      downloadsSource: pkg ? ok(pkg.downloads.source.split(" ")[0], "registry") : na("registry", "No package"),
      dependents: na("—", "Not collected: no reliable public source without scraping"),
    },
    manual: { sponsorship: c.sponsorship },
  };

  if (pkg) {
    sources.osv = pkg.osv.status;
    sources[c.packageEcosystem === "npm" ? "npm" : "pypi"] = pkg.downloads.status.state === "ok" ? pkg.latest.status.state === "ok" ? pkg.downloads.status : pkg.latest.status : pkg.downloads.status;
    links.package = pkg.downloads.url;
    links.osv = `https://osv.dev/list?ecosystem=${c.packageEcosystem === "npm" ? "npm" : "PyPI"}&q=${encodeURIComponent(c.packageName!)}`;
  }
  return { metrics, sources, canonicalName: info?.full_name ?? null, links };
}
