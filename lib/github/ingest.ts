import pLimit from "p-limit";
import { GITHUB_MIN_REMAINING, GITHUB_REPO_CONCURRENCY, REVISIT_DAYS } from "@/lib/config";
import { byNewest, filterReleases } from "@/lib/filter/filter";
import { GithubError, type GithubClient } from "@/lib/github/client";
import { fetchAdvisories, fetchReleases, fetchTagsInWindow } from "@/lib/github/releases";
import { log, errorMessage } from "@/lib/log";
import { normalizeRelease, normalizeTag } from "@/lib/normalize/release";
import { detectMajorBump, parseVersion, versionCore, type MajorBump } from "@/lib/signals/semver";
import type { Advisory, AdvisoryMatch, NormalizedRelease, RepoRef, RepoStatus, TimeWindow } from "@/lib/types";

/** A repo whose most recent GitHub Release is older than this is treated as tag-only. */
export const STALE_RELEASES_DAYS = 365;

export interface IngestedRelease {
  release: NormalizedRelease;
  majorBump: MajorBump | null;
  advisories: AdvisoryMatch[];
}

export interface RepoIngestResult {
  repo: RepoRef;
  status: RepoStatus;
  error: string | null;
  releases: IngestedRelease[];
  /**
   * Releases published up to REVISIT_DAYS before the window. The pipeline keeps
   * only those reported earlier whose notes have since changed.
   */
  revisitCandidates: IngestedRelease[];
  /** In-window advisories that did not match any in-window release. */
  unmatchedAdvisories: AdvisoryMatch[];
  usedTagFallback: boolean;
  warnings: string[];
  durationMs: number;
}

function toMatch(a: Advisory): AdvisoryMatch {
  return { ghsaId: a.ghsaId, cveId: a.cveId, summary: a.summary, htmlUrl: a.htmlUrl, severity: a.severity };
}

/**
 * An advisory matches a release when one of its patched versions equals the
 * release version, or the release notes mention its GHSA or CVE id.
 */
export function matchAdvisories(releases: NormalizedRelease[], advisories: Advisory[]) {
  const byRelease = new Map<NormalizedRelease, AdvisoryMatch[]>();
  const matchedIds = new Set<string>();
  for (const r of releases) {
    const v = parseVersion(r.tagName);
    const core = v ? versionCore(v) : null;
    const text = `${r.name}\n${r.body}`.toLowerCase();
    const hits = advisories.filter(
      (a) =>
        (core !== null && a.patchedVersions.includes(core)) ||
        text.includes(a.ghsaId.toLowerCase()) ||
        (a.cveId !== null && text.includes(a.cveId.toLowerCase())),
    );
    if (hits.length) {
      byRelease.set(r, hits.map(toMatch));
      hits.forEach((h) => matchedIds.add(h.ghsaId));
    }
  }
  const unmatched = advisories.filter((a) => !matchedIds.has(a.ghsaId)).map(toMatch);
  return { byRelease, unmatched };
}

function majorBumpFor(r: NormalizedRelease, all: NormalizedRelease[]): MajorBump | null {
  const earlier = all.filter((o) => o !== r && !o.draft && o.publishedAt.getTime() < r.publishedAt.getTime()).map((o) => o.tagName);
  return detectMajorBump(r.tagName, earlier);
}

export async function ingestRepo(gh: GithubClient, repo: RepoRef, window: TimeWindow, runId?: string): Promise<RepoIngestResult> {
  const started = Date.now();
  const ctx = { repoId: repo.id, repoFullName: repo.fullName };
  const warnings: string[] = [];
  const base = { repo, releases: [] as IngestedRelease[], revisitCandidates: [] as IngestedRelease[], unmatchedAdvisories: [] as AdvisoryMatch[], usedTagFallback: false, warnings };
  try {
    const page = await fetchReleases(gh, repo.fullName, window);
    const normalized = page.releases.map((r) => normalizeRelease(r, ctx)).filter((r): r is NormalizedRelease => r !== null);
    const published = normalized.filter((r) => !r.draft).sort(byNewest);
    const { included } = filterReleases(normalized, window);

    let inWindow: { release: NormalizedRelease; majorBump: MajorBump | null }[] = included.map((r) => ({ release: r, majorBump: majorBumpFor(r, normalized) }));
    let usedTagFallback = false;

    const neverReleased = published.length === 0;
    const stale = !neverReleased && published[0].publishedAt.getTime() < window.end.getTime() - STALE_RELEASES_DAYS * 86_400_000;
    if (included.length === 0 && (neverReleased || stale)) {
      usedTagFallback = true;
      const { inWindow: tags, allNames } = await fetchTagsInWindow(gh, repo.fullName, window);
      inWindow = tags.map((t) => {
        const v = parseVersion(t.name);
        const lower = allNames.filter((n) => {
          const p = parseVersion(n);
          return n !== t.name && p && v && p.prefix === v.prefix && (p.major < v.major || (p.major === v.major && (p.minor < v.minor || (p.minor === v.minor && p.patch < v.patch))));
        });
        return { release: normalizeTag(t, ctx), majorBump: detectMajorBump(t.name, lower) };
      });
    }

    let advisories: Advisory[] = [];
    try {
      advisories = await fetchAdvisories(gh, repo.fullName, window);
    } catch (err) {
      if (err instanceof GithubError && err.kind === "rate_limited") throw err;
      warnings.push(`Advisory lookup failed: ${errorMessage(err)}`);
    }
    const { byRelease, unmatched } = matchAdvisories(
      inWindow.map((x) => x.release),
      advisories,
    );

    const revisitFrom = window.start.getTime() - REVISIT_DAYS * 86_400_000;
    const revisitCandidates: IngestedRelease[] = published
      .filter((r) => r.publishedAt.getTime() >= revisitFrom && r.publishedAt.getTime() < window.start.getTime())
      .map((r) => ({ release: r, majorBump: majorBumpFor(r, normalized), advisories: [] }));

    const result: RepoIngestResult = {
      ...base,
      status: "ok",
      error: null,
      releases: inWindow.map((x) => ({ ...x, advisories: byRelease.get(x.release) ?? [] })),
      revisitCandidates,
      unmatchedAdvisories: unmatched,
      usedTagFallback,
      durationMs: Date.now() - started,
    };
    log.info("ingest.repo", { run_id: runId, repo: repo.fullName, releases: result.releases.length, tag_fallback: usedTagFallback, advisories: advisories.length, duration_ms: result.durationMs });
    return result;
  } catch (err) {
    const kind: RepoStatus = err instanceof GithubError ? err.kind : "error";
    log.warn("ingest.repo_failed", { run_id: runId, repo: repo.fullName, status: kind, error: errorMessage(err) });
    return { ...base, status: kind, error: errorMessage(err), durationMs: Date.now() - started };
  }
}

/**
 * Ingest all enabled repos with bounded concurrency. One failing repo never
 * fails the run. When the primary rate-limit budget runs low, remaining repos
 * are marked rate_limited instead of being attempted.
 */
export async function ingestAll(gh: GithubClient, repos: RepoRef[], window: TimeWindow, runId?: string): Promise<RepoIngestResult[]> {
  const limit = pLimit(GITHUB_REPO_CONCURRENCY);
  return Promise.all(
    repos.map((repo) =>
      limit(async () => {
        if (gh.rate.remaining !== null && gh.rate.remaining < GITHUB_MIN_REMAINING) {
          const reset = gh.rate.resetAt ? ` Resets at ${gh.rate.resetAt.toISOString()}.` : "";
          log.warn("ingest.rate_budget_exhausted", { run_id: runId, repo: repo.fullName, remaining: gh.rate.remaining });
          return {
            repo,
            status: "rate_limited" as const,
            error: `Skipped: only ${gh.rate.remaining} GitHub API requests remained.${reset}`,
            releases: [],
            revisitCandidates: [],
            unmatchedAdvisories: [],
            usedTagFallback: false,
            warnings: [],
            durationMs: 0,
          };
        }
        return ingestRepo(gh, repo, window, runId);
      }),
    ),
  );
}
