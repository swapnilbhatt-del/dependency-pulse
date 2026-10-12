import pLimit from "p-limit";
import { COLLECTION, MAINTAINER_ASSOCIATIONS } from "@/lib/health/config";
import { GITHUB_TAG_FALLBACK_LIMIT } from "@/lib/config";
import { GithubError, type GithubClient } from "@/lib/github/client";
import { errorMessage } from "@/lib/log";
import { parseVersion } from "@/lib/signals/semver";

/**
 * GitHub REST collection for one candidate, reusing the live app's client
 * (auth, API version header, ETag cache, rate-limit and 5xx backoff). Each call
 * is memoized for the run. Endpoints (all GET, API version 2022-11-28):
 *   /repos/{o}/{r}                               metadata, license, archived, stars
 *   /repos/{o}/{r}/releases                       cadence (tags + commit dates as fallback)
 *   /repos/{o}/{r}/commits?since=                 commits, authors, last commit
 *   /repos/{o}/{r}/issues?state=all&since=        issue sample (PRs filtered out)
 *   /repos/{o}/{r}/pulls?state=all&sort=updated   PR sample
 *   /repos/{o}/{r}/issues/{n}/comments, /pulls/{n}/reviews   first responses
 *   /repos/{o}/{r}/community/profile              code of conduct, contributing, templates, health %
 *   /repos/{o}/{r}/contents/{SECURITY.md|.github/SECURITY.md|docs/SECURITY.md}
 *   /repos/{o}/{r}/commits/{sha}/check-runs, /commits/{sha}/status   CI
 *   /repos/{o}/{r}/security-advisories?state=published               advisories
 */

export class GithubRun {
  private memo = new Map<string, Promise<unknown>>();
  rateLimited: string | null = null;
  constructor(readonly gh: GithubClient) {}
  /** Memoized GET. Throws GithubError; once rate limited, every later call fails fast. */
  get<T>(path: string, query: Record<string, string | number> = {}): Promise<T> {
    if (this.rateLimited) return Promise.reject(new GithubError(this.rateLimited, "rate_limited", 429));
    const key = `${path}?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))}`;
    let p = this.memo.get(key) as Promise<T> | undefined;
    if (!p) {
      p = this.gh.get<T>(path, query).then((r) => r.data).catch((err) => {
        if (err instanceof GithubError && err.kind === "rate_limited") this.rateLimited = err.message;
        throw err;
      });
      this.memo.set(key, p);
    }
    return p;
  }
}

const DAY = 86_400_000;
const daysBetween = (a: Date, b: Date) => Math.max(0, Math.floor((a.getTime() - b.getTime()) / DAY));
export const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const isBot = (u?: { login?: string; type?: string } | null) => !u || u.type === "Bot" || /\[bot\]$/i.test(u.login ?? "");

export interface RepoInfo {
  full_name: string;
  description: string | null;
  default_branch: string;
  archived: boolean;
  disabled: boolean;
  fork: boolean;
  stargazers_count: number;
  forks_count: number;
  license: { spdx_id: string | null } | null;
}

export async function repoInfo(run: GithubRun, fullName: string) {
  return run.get<RepoInfo>(`/repos/${fullName}`);
}

// ── Cadence ──────────────────────────────────────────────────────────────────
interface RawRelease {
  draft: boolean;
  published_at: string | null;
  created_at: string;
  tag_name: string;
}

export interface CadenceResult {
  usesGithubReleases: boolean;
  dates: Date[]; // newest first, within the 2-year history window (plus the latest even if older)
  latestTag: string | null;
  basis: "releases" | "tags";
  note: string | null;
}

/** Median days between consecutive releases; null with fewer than 3 releases. */
export function medianInterval(dates: Date[]): number | null {
  if (dates.length < 3) return null;
  const sorted = [...dates].sort((a, b) => b.getTime() - a.getTime());
  const gaps = sorted.slice(1).map((d, i) => daysBetween(sorted[i], d));
  const m = median(gaps);
  return m === null ? null : Math.round(m);
}

export async function cadence(run: GithubRun, fullName: string, now: Date): Promise<CadenceResult> {
  const horizon = now.getTime() - COLLECTION.releaseHistoryDays * DAY;
  const dates: Date[] = [];
  let latestTag: string | null = null;
  let any = false;
  for (let page = 1; page <= COLLECTION.releasePagesCap; page++) {
    const items = await run.get<RawRelease[]>(`/repos/${fullName}/releases`, { per_page: 100, page });
    const published = items.filter((r) => !r.draft);
    if (published.length) any = true;
    for (const r of published) {
      const d = new Date(r.published_at ?? r.created_at);
      if (latestTag === null) latestTag = r.tag_name;
      if (d.getTime() >= horizon || dates.length === 0) dates.push(d);
    }
    if (items.length < 100 || published.some((r) => new Date(r.published_at ?? r.created_at).getTime() < horizon)) break;
  }
  if (any) return { usesGithubReleases: true, dates: dates.sort((a, b) => b.getTime() - a.getTime()), latestTag, basis: "releases", note: null };

  // Tag fallback, as in the live digest: rank tags by version, date the top N by their commit.
  const tags = await run.get<{ name: string; commit: { sha: string } }[]>(`/repos/${fullName}/tags`, { per_page: 100 });
  const ranked = tags
    .map((t) => ({ t, v: parseVersion(t.name) }))
    .filter((x) => x.v)
    .sort((a, b) => b.v!.major - a.v!.major || b.v!.minor - a.v!.minor || b.v!.patch - a.v!.patch)
    .slice(0, GITHUB_TAG_FALLBACK_LIMIT);
  const limit = pLimit(COLLECTION.candidateConcurrency);
  const dated = await Promise.all(
    ranked.map(({ t }) =>
      limit(async () => {
        const c = await run.get<{ commit?: { committer?: { date?: string } } }>(`/repos/${fullName}/commits/${t.commit.sha}`).catch(() => null);
        const iso = c?.commit?.committer?.date;
        return iso ? { name: t.name, date: new Date(iso) } : null;
      }),
    ),
  );
  const ok = dated.filter((x): x is { name: string; date: Date } => x !== null).sort((a, b) => b.date.getTime() - a.date.getTime());
  return {
    usesGithubReleases: false,
    dates: ok.filter((x, i) => i === 0 || x.date.getTime() >= horizon).map((x) => x.date),
    latestTag: ok[0]?.name ?? null,
    basis: "tags",
    note: ok.length ? `Based on the ${ok.length} highest-version tags (no GitHub Releases)` : null,
  };
}

// ── Commits / bus factor ─────────────────────────────────────────────────────
interface RawCommit {
  sha: string;
  author: { login?: string; type?: string } | null;
  commit: { author: { name?: string; email?: string; date: string } | null; committer: { date: string } | null };
}

export interface CommitStats {
  headSha: string | null;
  lastCommitAt: Date | null;
  count365: number;
  capped: boolean;
  distinctAuthors: number;
  topAuthor: string | null;
  topShare: number | null;
}

export function authorStats(commits: RawCommit[]): { distinct: number; top: string | null; share: number | null } {
  const counts = new Map<string, number>();
  for (const c of commits) {
    if (isBot(c.author) && c.author) continue; // linked bot accounts (dependabot etc.) are not maintainers
    const key = c.author?.login ?? c.commit.author?.email ?? c.commit.author?.name ?? "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (!total) return { distinct: 0, top: null, share: null };
  const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return { distinct: counts.size, top, share: n / total };
}

export async function commitStats(run: GithubRun, fullName: string, branch: string, now: Date): Promise<CommitStats> {
  const head = await run.get<RawCommit[]>(`/repos/${fullName}/commits`, { sha: branch, per_page: 1 });
  const since = new Date(now.getTime() - 365 * DAY).toISOString();
  const all: RawCommit[] = [];
  let capped = false;
  for (let page = 1; page <= COLLECTION.commitPagesCap; page++) {
    const items = await run.get<RawCommit[]>(`/repos/${fullName}/commits`, { sha: branch, since, per_page: 100, page });
    all.push(...items);
    if (items.length < 100) break;
    if (page === COLLECTION.commitPagesCap) capped = true;
  }
  const s = authorStats(all);
  const last = head[0]?.commit.committer?.date ?? head[0]?.commit.author?.date;
  return { headSha: head[0]?.sha ?? null, lastCommitAt: last ? new Date(last) : null, count365: all.length, capped, distinctAuthors: s.distinct, topAuthor: s.top, topShare: s.share };
}

// ── Responsiveness (sampled) ─────────────────────────────────────────────────
interface RawIssue {
  number: number;
  created_at: string;
  updated_at: string;
  comments: number;
  user: { login: string; type?: string } | null;
  pull_request?: unknown;
}
interface RawComment {
  created_at: string;
  user: { login: string; type?: string } | null;
  author_association: string;
}
interface RawReview {
  submitted_at: string | null;
  user: { login: string; type?: string } | null;
  author_association: string;
}

export interface SampleItem {
  createdAt: Date;
  firstResponseAt: Date | null; // first comment/review by someone other than the author (bots excluded)
  maintainerResponded: boolean;
}

export interface ResponsivenessStats {
  issueSample: number;
  prSample: number;
  medianHours: number | null;
  maintainerShare: number | null;
}

/** The issues endpoint also returns pull requests; those are removed from the issue sample. */
export function onlyIssues(items: RawIssue[]): RawIssue[] {
  return items.filter((i) => !i.pull_request);
}

export function firstResponse(author: string | undefined, events: { at: string | null; user: RawComment["user"]; association: string }[]): { at: Date | null; maintainer: boolean } {
  const others = events.filter((e) => e.at && e.user && e.user.login !== author && !isBot(e.user)).sort((a, b) => a.at!.localeCompare(b.at!));
  const maintainer = others.some((e) => (MAINTAINER_ASSOCIATIONS as readonly string[]).includes(e.association));
  return { at: others[0] ? new Date(others[0].at!) : null, maintainer };
}

export function summarizeSample(issues: SampleItem[], prs: SampleItem[]): ResponsivenessStats {
  const all = [...issues, ...prs];
  const hours = all.filter((x) => x.firstResponseAt).map((x) => (x.firstResponseAt!.getTime() - x.createdAt.getTime()) / 3_600_000);
  const m = median(hours);
  return {
    issueSample: issues.length,
    prSample: prs.length,
    medianHours: m === null ? null : Math.round(m * 10) / 10,
    maintainerShare: all.length ? Math.round((all.filter((x) => x.maintainerResponded).length / all.length) * 100) / 100 : null,
  };
}

export async function responsiveness(run: GithubRun, fullName: string, now: Date): Promise<ResponsivenessStats> {
  const since = new Date(now.getTime() - COLLECTION.sampleWindowDays * DAY);
  const limit = pLimit(COLLECTION.candidateConcurrency);
  const issuesRaw = await run.get<RawIssue[]>(`/repos/${fullName}/issues`, { state: "all", since: since.toISOString(), sort: "updated", direction: "desc", per_page: 100 });
  const issues = onlyIssues(issuesRaw).filter((i) => !isBot(i.user)).slice(0, COLLECTION.sampleIssues);
  const pullsRaw = await run.get<(RawIssue & { updated_at: string })[]>(`/repos/${fullName}/pulls`, { state: "all", sort: "updated", direction: "desc", per_page: 100 });
  const pulls = pullsRaw.filter((p) => new Date(p.updated_at) >= since && !isBot(p.user)).slice(0, COLLECTION.samplePulls);

  const issueItems = await Promise.all(
    issues.map((i) =>
      limit(async (): Promise<SampleItem> => {
        const comments = i.comments > 0 ? await run.get<RawComment[]>(`/repos/${fullName}/issues/${i.number}/comments`, { per_page: 30 }) : [];
        const r = firstResponse(i.user?.login, comments.map((c) => ({ at: c.created_at, user: c.user, association: c.author_association })));
        return { createdAt: new Date(i.created_at), firstResponseAt: r.at, maintainerResponded: r.maintainer };
      }),
    ),
  );
  const prItems = await Promise.all(
    pulls.map((p) =>
      limit(async (): Promise<SampleItem> => {
        const [comments, reviews] = await Promise.all([
          run.get<RawComment[]>(`/repos/${fullName}/issues/${p.number}/comments`, { per_page: 30 }),
          run.get<RawReview[]>(`/repos/${fullName}/pulls/${p.number}/reviews`, { per_page: 30 }),
        ]);
        const r = firstResponse(p.user?.login, [
          ...comments.map((c) => ({ at: c.created_at, user: c.user, association: c.author_association })),
          ...reviews.map((v) => ({ at: v.submitted_at, user: v.user, association: v.author_association })),
        ]);
        return { createdAt: new Date(p.created_at), firstResponseAt: r.at, maintainerResponded: r.maintainer };
      }),
    ),
  );
  return summarizeSample(issueItems, prItems);
}

// ── Governance ───────────────────────────────────────────────────────────────
export interface CommunityProfile {
  health_percentage: number;
  files: { code_of_conduct: unknown; contributing: unknown; issue_template: unknown; license: unknown };
}

export async function community(run: GithubRun, fullName: string): Promise<CommunityProfile> {
  return run.get<CommunityProfile>(`/repos/${fullName}/community/profile`);
}

/** SECURITY.md in any location GitHub recognises. null = could not be determined. */
export async function securityPolicyFile(run: GithubRun, fullName: string): Promise<boolean | null> {
  let unknown = false;
  for (const path of ["SECURITY.md", ".github/SECURITY.md", "docs/SECURITY.md"]) {
    try {
      await run.get(`/repos/${fullName}/contents/${path}`);
      return true;
    } catch (err) {
      if (!(err instanceof GithubError && err.kind === "not_found")) unknown = true;
    }
  }
  return unknown ? null : false;
}

// ── CI ───────────────────────────────────────────────────────────────────────
const FAILING = new Set(["failure", "timed_out", "action_required"]);
const PASSING = new Set(["success", "neutral", "skipped"]);

export function ciFromCheckRuns(runs: { status: string; conclusion: string | null }[]): "passing" | "failing" | "unknown" {
  const done = runs.filter((r) => r.status === "completed" && r.conclusion);
  if (done.some((r) => FAILING.has(r.conclusion!))) return "failing";
  // Cancelled runs are ignored; at least one completed passing run is required.
  return done.some((r) => PASSING.has(r.conclusion!)) ? "passing" : "unknown";
}

export async function ciStatus(run: GithubRun, fullName: string, sha: string): Promise<{ status: "passing" | "failing" | "unknown"; method: "check-runs" | "commit-status" }> {
  const cr = await run.get<{ total_count: number; check_runs: { status: string; conclusion: string | null }[] }>(`/repos/${fullName}/commits/${sha}/check-runs`, { per_page: 100, filter: "latest" });
  if (cr.total_count > 0) return { status: ciFromCheckRuns(cr.check_runs), method: "check-runs" };
  const st = await run.get<{ state: string; total_count: number }>(`/repos/${fullName}/commits/${sha}/status`);
  if (st.total_count === 0) return { status: "unknown", method: "commit-status" };
  return { status: st.state === "success" ? "passing" : st.state === "failure" || st.state === "error" ? "failing" : "unknown", method: "commit-status" };
}

// ── Advisories ───────────────────────────────────────────────────────────────
export async function advisoriesLastYear(run: GithubRun, fullName: string, now: Date): Promise<number> {
  const items = await run.get<{ published_at: string | null }[]>(`/repos/${fullName}/security-advisories`, { state: "published", per_page: 100 });
  const from = now.getTime() - 365 * DAY;
  return items.filter((a) => a.published_at && new Date(a.published_at).getTime() >= from).length;
}

export function githubReason(err: unknown): { state: "not_available" | "rate_limited" | "error"; reason: string } {
  if (err instanceof GithubError) {
    if (err.kind === "not_found") return { state: "not_available", reason: "Not found or not accessible (404)" };
    if (err.kind === "rate_limited") return { state: "rate_limited", reason: err.message };
    return { state: "error", reason: err.message };
  }
  return { state: "error", reason: errorMessage(err) };
}
