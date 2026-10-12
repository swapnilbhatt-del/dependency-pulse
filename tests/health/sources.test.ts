import { describe, expect, it, vi } from "vitest";
import { GithubClient } from "@/lib/github/client";
import { collectMetrics } from "@/lib/health/collect";
import { authorStats, ciFromCheckRuns, firstResponse, GithubRun, median, medianInterval, onlyIssues, summarizeSample } from "@/lib/health/sources/github";
import { fetchJson, RunCache, safeSourceUrl } from "@/lib/health/sources/http";
import { fetchOsv, fetchScorecard, fetchWeeklyDownloads } from "@/lib/health/sources/public";

const NOW = new Date("2026-10-12T12:00:00Z");
const noSleep = async () => {};
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("fetchJson: every failure becomes a typed outcome, never a crash", () => {
  const run = (impl: () => Promise<Response>) => fetchJson("https://example.test/x", {}, { fetchImpl: impl as unknown as typeof fetch, sleepImpl: noSleep, retries: 1 });
  it("success", async () => expect(await run(async () => json({ a: 1 }))).toMatchObject({ kind: "ok", data: { a: 1 } }));
  it("404 → not_found", async () => expect(await run(async () => json({}, 404))).toMatchObject({ kind: "not_found", reason: "Not found (404)" }));
  it("429 after retries → rate_limited", async () => expect(await run(async () => json({}, 429))).toMatchObject({ kind: "rate_limited" }));
  it("5xx after retries → error", async () => expect(await run(async () => json({}, 503))).toMatchObject({ kind: "error", reason: "Server error (503)" }));
  it("timeout → error with reason", async () => {
    const err = Object.assign(new Error("t"), { name: "TimeoutError" });
    expect(await run(async () => Promise.reject(err))).toMatchObject({ kind: "error", reason: "Timed out after 10 s" });
  });
  it("malformed JSON → error", async () => expect(await run(async () => new Response("<html>", { status: 200 }))).toMatchObject({ kind: "error", reason: "Malformed JSON in response" }));
  it("retries a transient error then succeeds", async () => {
    let n = 0;
    expect(await run(async () => (n++ ? json({ ok: true }) : json({}, 502)))).toMatchObject({ kind: "ok" });
  });
  it("RunCache: one run never fetches the same URL twice", async () => {
    const f = vi.fn(async () => json({ v: 1 }));
    const cache = new RunCache();
    await Promise.all([1, 2, 3].map(() => fetchJson("https://example.test/same", {}, { fetchImpl: f as unknown as typeof fetch }, cache)));
    expect(f).toHaveBeenCalledOnce();
  });
});

describe("public source adapters", () => {
  const deps = (impl: (url: string, init?: RequestInit) => Promise<Response>) => ({ fetchImpl: impl as unknown as typeof fetch, sleepImpl: noSleep, retries: 0 });
  it("Scorecard 404 → not available (not zero)", async () => {
    const r = await fetchScorecard("a/b", deps(async () => json({}, 404)));
    expect(r).toMatchObject({ score: null, status: { state: "not_available", reason: "No Scorecard data for this repository" } });
  });
  it("Scorecard maps -1 check scores to null", async () => {
    const r = await fetchScorecard("a/b", deps(async () => json({ date: "2026-10-05", score: 7.49, checks: [{ name: "Fuzzing", score: -1, reason: "n/a" }, { name: "Maintained", score: 10, reason: "ok" }] })));
    expect(r.score).toBe(7.5);
    expect(r.checks).toEqual([{ name: "Fuzzing", score: null, reason: "n/a" }, { name: "Maintained", score: 10, reason: "ok" }]);
  });
  it("OSV: counts, fixes, recency and vulnerabilities affecting the latest version", async () => {
    const vulns = [
      { id: "GHSA-1", published: "2026-03-01T00:00:00Z", affected: [{ ranges: [{ events: [{ introduced: "0" }, { fixed: "2.0.0" }] }] }] },
      { id: "GHSA-2", published: "2024-01-01T00:00:00Z", affected: [{ ranges: [{ events: [{ introduced: "0" }] }] }] },
    ];
    const r = await fetchOsv("npm", "pkg", "2.1.0", NOW, deps(async (_u, init) => json(JSON.parse(String(init!.body)).version ? { vulns: [vulns[1]] } : { vulns })));
    expect(r).toMatchObject({ total: 2, withFix: 1, publishedLast365: 1, affectingLatest: 1, mostRecentPublished: "2026-03-01T00:00:00Z" });
  });
  it("OSV: empty result means 'not found in OSV', zero affecting latest", async () => {
    const r = await fetchOsv("pypi", "pkg", "1.0", NOW, deps(async () => json({})));
    expect(r).toMatchObject({ total: 0, affectingLatest: 0 });
  });
  it("OSV outage → error status, null counts", async () => {
    const r = await fetchOsv("npm", "pkg", "1.0", NOW, deps(async () => json({}, 500)));
    expect(r).toMatchObject({ total: null, status: { state: "error" } });
  });
  it("npm downloads: success, unknown package, malformed", async () => {
    expect((await fetchWeeklyDownloads("npm", "jose", deps(async () => json({ downloads: 123, package: "jose" })))).weekly).toBe(123);
    expect((await fetchWeeklyDownloads("npm", "nope", deps(async () => json({ error: "not found" }, 404)))).status.state).toBe("not_available");
    expect((await fetchWeeklyDownloads("npm", "x", deps(async () => new Response("oops")))).status).toMatchObject({ state: "error", reason: "Malformed JSON in response" });
  });
  it("PyPI downloads use pypistats last_week and normalise names", async () => {
    const f = vi.fn(async () => json({ data: { last_week: 900 } }));
    const r = await fetchWeeklyDownloads("pypi", "PyJWT", deps(f));
    expect(r.weekly).toBe(900);
    expect(String((f.mock.calls[0] as unknown[])[0])).toBe("https://pypistats.org/api/packages/pyjwt/recent?period=week");
  });
});

describe("sampling and statistics", () => {
  it("the issues endpoint returns PRs too: they are removed from the issue sample", () => {
    const items = [{ number: 1, pull_request: {} }, { number: 2 }, { number: 3, pull_request: { url: "x" } }] as Parameters<typeof onlyIssues>[0];
    expect(onlyIssues(items).map((i) => i.number)).toEqual([2]);
  });
  it("first response ignores the author and bots; flags maintainer responses", () => {
    const r = firstResponse("alice", [
      { at: "2026-10-01T01:00:00Z", user: { login: "alice" }, association: "OWNER" },
      { at: "2026-10-01T02:00:00Z", user: { login: "dependabot[bot]", type: "Bot" }, association: "NONE" },
      { at: "2026-10-01T05:00:00Z", user: { login: "carol" }, association: "CONTRIBUTOR" },
      { at: "2026-10-01T09:00:00Z", user: { login: "bob" }, association: "MEMBER" },
    ]);
    expect(r.at?.toISOString()).toBe("2026-10-01T05:00:00.000Z");
    expect(r.maintainer).toBe(true);
  });
  it("reports sample sizes, median hours and response share", () => {
    const at = (h: number) => new Date(Date.UTC(2026, 9, 1, h));
    const s = summarizeSample(
      [{ createdAt: at(0), firstResponseAt: at(2), maintainerResponded: true }, { createdAt: at(0), firstResponseAt: null, maintainerResponded: false }],
      [{ createdAt: at(0), firstResponseAt: at(10), maintainerResponded: true }],
    );
    expect(s).toEqual({ issueSample: 2, prSample: 1, medianHours: 6, maintainerShare: 0.67 });
  });
  it("median", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
  it("median days between releases is null with fewer than three releases", () => {
    const d = (s: string) => new Date(s);
    expect(medianInterval([d("2026-10-01"), d("2026-09-01")])).toBeNull();
    expect(medianInterval([d("2026-10-01"), d("2026-09-21"), d("2026-08-22")])).toBe(20); // gaps 10 and 30
  });
  it("bus factor stats: share of the top author, linked bots excluded", () => {
    const c = (login: string | null, email = `${login}@x`) => ({ sha: "s", author: login ? { login, type: login.endsWith("[bot]") ? "Bot" : "User" } : null, commit: { author: { email, date: "2026-10-01" }, committer: { date: "2026-10-01" } } });
    const s = authorStats([c("alice"), c("alice"), c("alice"), c("bob"), c("dependabot[bot]"), c(null, "anon@x")]);
    expect(s).toEqual({ distinct: 3, top: "alice", share: 0.6 });
  });
  it("CI: any failing run fails; cancelled ignored; nothing completed is unknown", () => {
    expect(ciFromCheckRuns([{ status: "completed", conclusion: "success" }, { status: "completed", conclusion: "failure" }])).toBe("failing");
    expect(ciFromCheckRuns([{ status: "completed", conclusion: "success" }, { status: "completed", conclusion: "cancelled" }])).toBe("passing");
    expect(ciFromCheckRuns([{ status: "in_progress", conclusion: null }])).toBe("unknown");
  });
  it("outbound links only to verified source hosts", () => {
    expect(safeSourceUrl("https://osv.dev/list?q=x")).toBe("https://osv.dev/list?q=x");
    expect(safeSourceUrl("https://evil.example/osv.dev")).toBeNull();
    expect(safeSourceUrl("http://github.com/a/b")).toBeNull();
  });
});

describe("collectMetrics degrades per source", () => {
  it("GitHub 404 → every GitHub metric not available with a reason; public sources still collected", async () => {
    const gh = new GithubClient({ token: "t", fetchImpl: (async () => json({ message: "Not Found" }, 404)) as unknown as typeof fetch, sleepImpl: noSleep });
    const http = { fetchImpl: (async (url: string) => (String(url).includes("securityscorecards") ? json({ date: "2026-10-05", score: 6, checks: [] }) : json({}, 404))) as unknown as typeof fetch, sleepImpl: noSleep, retries: 0 };
    const c = await collectMetrics({ fullName: "gone/repo", packageEcosystem: null, packageName: null, sponsorship: "unknown" }, { run: new GithubRun(gh), http, cache: new RunCache(), now: NOW });
    expect(c.sources.github).toMatchObject({ state: "not_available" });
    expect(c.metrics.maintenance.daysSinceLastCommit).toMatchObject({ value: null });
    expect(c.metrics.maintenance.daysSinceLastCommit.reason).toMatch(/GitHub unavailable/);
    expect(c.metrics.security.scorecardScore.value).toBe(6);
    expect(c.metrics.vulnerabilities.total.reason).toBe("No npm or PyPI package set for this candidate");
    expect(c.metrics.adoption.dependents.reason).toMatch(/Not collected/);
  });
  it("GitHub rate limit → github marked rate_limited, no crash", async () => {
    const reset = Math.floor(Date.now() / 1000) + 3600;
    const gh = new GithubClient({ token: "t", fetchImpl: (async () => json({}, 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) })) as unknown as typeof fetch, sleepImpl: noSleep });
    const c = await collectMetrics({ fullName: "a/b", packageEcosystem: null, packageName: null, sponsorship: "unknown" }, { run: new GithubRun(gh), http: { fetchImpl: (async () => json({}, 404)) as unknown as typeof fetch, retries: 0 }, cache: new RunCache(), now: NOW });
    expect(c.sources.github?.state).toBe("rate_limited");
  });
});
