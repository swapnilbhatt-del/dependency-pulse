import { GITHUB_MAX_RELEASE_PAGES, GITHUB_TAG_FALLBACK_LIMIT } from "@/lib/config";
import type { GithubClient } from "@/lib/github/client";
import { parseVersion } from "@/lib/signals/semver";
import type { Advisory, TimeWindow } from "@/lib/types";

export interface RawReleasePage {
  /** Raw payloads, newest first, across fetched pages. */
  releases: unknown[];
  pages: number;
  fromCache: boolean;
}

function releaseTime(r: unknown): number | null {
  const o = r as { published_at?: string | null; created_at?: string | null };
  const t = o?.published_at ?? o?.created_at;
  return t ? new Date(t).getTime() : null;
}

/**
 * GET /repos/{owner}/{repo}/releases, newest first, 100 per page. Stops as soon
 * as a page contains a release older than the window start (that page also
 * provides the history used for semver comparison), or when a page is short.
 */
export async function fetchReleases(gh: GithubClient, fullName: string, window: TimeWindow): Promise<RawReleasePage> {
  const all: unknown[] = [];
  let fromCache = true;
  let page = 1;
  for (; page <= GITHUB_MAX_RELEASE_PAGES; page++) {
    const res = await gh.get<unknown[]>(`/repos/${fullName}/releases`, { per_page: 100, page });
    fromCache &&= res.fromCache;
    const items = Array.isArray(res.data) ? res.data : [];
    all.push(...items);
    if (items.length < 100) break;
    // Drafts have no published_at and sort first; ignore them for the stop check.
    const oldest = items.map(releaseTime).filter((t): t is number => t !== null);
    if (oldest.length && Math.min(...oldest) < window.start.getTime()) break;
  }
  return { releases: all, pages: Math.min(page, GITHUB_MAX_RELEASE_PAGES), fromCache };
}

/** Whether the repo has ever produced a GitHub Release (checks one item). */
export async function hasAnyRelease(gh: GithubClient, fullName: string): Promise<boolean> {
  const res = await gh.get<unknown[]>(`/repos/${fullName}/releases`, { per_page: 1 });
  return Array.isArray(res.data) && res.data.length > 0;
}

interface RawTag {
  name: string;
  commit: { sha: string };
}

export interface DatedTag {
  name: string;
  commitSha: string;
  commitDate: Date;
}

/**
 * Tag fallback for repos that publish tags but not GitHub Releases.
 * The tags endpoint carries no dates and is ordered by name, so we read up to
 * 300 tags, rank them by semantic version, and look up commit dates for the
 * highest few. Only tags whose commit date is inside the window are returned.
 * No commits, PRs or issues are ever listed.
 */
export async function fetchTagsInWindow(
  gh: GithubClient,
  fullName: string,
  window: TimeWindow,
): Promise<{ inWindow: DatedTag[]; allNames: string[] }> {
  const tags: RawTag[] = [];
  for (let page = 1; page <= 3; page++) {
    const res = await gh.get<RawTag[]>(`/repos/${fullName}/tags`, { per_page: 100, page });
    const items = Array.isArray(res.data) ? res.data : [];
    tags.push(...items.filter((t) => t && typeof t.name === "string" && t.commit?.sha));
    if (items.length < 100) break;
  }
  const ranked = tags
    .map((t) => ({ t, v: parseVersion(t.name) }))
    .filter((x) => x.v !== null)
    .sort((a, b) => b.v!.major - a.v!.major || b.v!.minor - a.v!.minor || b.v!.patch - a.v!.patch)
    .slice(0, GITHUB_TAG_FALLBACK_LIMIT)
    .map((x) => x.t);

  const out: DatedTag[] = [];
  for (const tag of ranked) {
    const res = await gh.get<{ commit?: { committer?: { date?: string }; author?: { date?: string } } }>(
      `/repos/${fullName}/commits/${tag.commit.sha}`,
    );
    const iso = res.data.commit?.committer?.date ?? res.data.commit?.author?.date;
    if (!iso) continue;
    const commitDate = new Date(iso);
    if (commitDate.getTime() >= window.start.getTime() && commitDate.getTime() <= window.end.getTime()) {
      out.push({ name: tag.name, commitSha: tag.commit.sha, commitDate });
    }
  }
  return { inWindow: out.sort((a, b) => b.commitDate.getTime() - a.commitDate.getTime()), allNames: tags.map((t) => t.name) };
}

interface RawAdvisory {
  ghsa_id: string;
  cve_id: string | null;
  summary: string;
  severity: string | null;
  published_at: string | null;
  html_url: string;
  vulnerabilities: { patched_versions: string | null }[] | null;
}

/**
 * Published repository security advisories (GET /repos/{owner}/{repo}/security-advisories)
 * with published_at inside the window.
 */
export async function fetchAdvisories(gh: GithubClient, fullName: string, window: TimeWindow): Promise<Advisory[]> {
  const res = await gh.get<RawAdvisory[]>(`/repos/${fullName}/security-advisories`, {
    state: "published",
    sort: "published",
    direction: "desc",
    per_page: 30,
  });
  const items = Array.isArray(res.data) ? res.data : [];
  return items
    .filter((a) => a.published_at && new Date(a.published_at) >= window.start && new Date(a.published_at) <= window.end)
    .map((a) => ({
      ghsaId: a.ghsa_id,
      cveId: a.cve_id,
      summary: a.summary,
      severity: a.severity,
      publishedAt: new Date(a.published_at!),
      htmlUrl: a.html_url,
      patchedVersions: (a.vulnerabilities ?? [])
        .flatMap((v) => (v.patched_versions ?? "").split(/[,|]/))
        .map((s) => s.replace(/[<>=~^\s]/g, "").replace(/^v/, ""))
        .filter(Boolean),
    }));
}
