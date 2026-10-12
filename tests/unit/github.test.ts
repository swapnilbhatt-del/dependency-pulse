import { describe, expect, it, vi } from "vitest";
import { GithubClient, GithubError } from "@/lib/github/client";
import { ingestRepo, matchAdvisories } from "@/lib/github/ingest";
import { fetchReleases } from "@/lib/github/releases";
import { computeWindow } from "@/lib/filter/window";
import { release, repo } from "../fixtures/factory";

const WINDOW = computeWindow(new Date("2026-10-12T03:30:00Z"));

function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { "content-type": "application/json", "x-ratelimit-remaining": "4999", ...init.headers } });
}

function rel(id: number, publishedAt: string, extra: Record<string, unknown> = {}) {
  return { id, tag_name: `v1.0.${id}`, name: `v1.0.${id}`, body: `Release ${id}`, draft: false, prerelease: false, created_at: publishedAt, published_at: publishedAt, html_url: `https://github.com/acme/widget/releases/tag/v1.0.${id}`, ...extra };
}

/** Routes requests by path; records every URL requested. */
function router(routes: Record<string, (url: URL) => Response>) {
  const calls: string[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    for (const [prefix, h] of Object.entries(routes)) if (url.pathname.startsWith(prefix)) return h(url);
    return json({ message: "Not Found" }, { status: 404 });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const noSleep = async () => {};

describe("GithubClient", () => {
  it("sends auth and API version headers", async () => {
    const f = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      const h = init!.headers as Record<string, string>;
      expect(h.Authorization).toBe("Bearer t0ken");
      expect(h["X-GitHub-Api-Version"]).toBe("2022-11-28");
      return json([]);
    });
    await new GithubClient({ token: "t0ken", fetchImpl: f as unknown as typeof fetch }).get("/repos/a/b/releases");
    expect(f).toHaveBeenCalledOnce();
  });

  it("maps 404 to not_found", async () => {
    const gh = new GithubClient({ token: "t", fetchImpl: (async () => json({}, { status: 404 })) as unknown as typeof fetch });
    await expect(gh.get("/repos/a/b")).rejects.toMatchObject({ kind: "not_found", status: 404 });
  });

  it("waits for Retry-After on a secondary rate limit, then succeeds", async () => {
    const sleeps: number[] = [];
    let n = 0;
    const f = async () => (n++ === 0 ? json({ message: "secondary" }, { status: 403, headers: { "retry-after": "2" } }) : json([{ ok: 1 }]));
    const gh = new GithubClient({ token: "t", fetchImpl: f as unknown as typeof fetch, sleepImpl: async (ms) => void sleeps.push(ms) });
    const res = await gh.get<unknown[]>("/x");
    expect(res.data).toHaveLength(1);
    expect(sleeps).toEqual([2000]);
  });

  it("fails as rate_limited when the primary limit resets too far in the future", async () => {
    const reset = Math.floor(Date.now() / 1000) + 3600;
    const f = async () => json({ message: "API rate limit exceeded" }, { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) } });
    const gh = new GithubClient({ token: "t", fetchImpl: f as unknown as typeof fetch, sleepImpl: noSleep });
    await expect(gh.get("/x")).rejects.toMatchObject({ kind: "rate_limited" });
    expect(gh.rate.remaining).toBe(0);
  });

  it("backs off exponentially on 5xx and gives up after maxRetries", async () => {
    const sleeps: number[] = [];
    const f = vi.fn(async () => json({}, { status: 502 }));
    const gh = new GithubClient({ token: "t", fetchImpl: f as unknown as typeof fetch, maxRetries: 3, sleepImpl: async (ms) => void sleeps.push(ms) });
    await expect(gh.get("/x")).rejects.toBeInstanceOf(GithubError);
    expect(f).toHaveBeenCalledTimes(4);
    expect(sleeps).toHaveLength(3);
    expect(sleeps[2]).toBeGreaterThanOrEqual(sleeps[0]);
  });

  it("uses If-None-Match and serves 304 from the ETag cache", async () => {
    const store = new Map<string, { etag: string; body: string }>();
    const cache = { get: async (u: string) => store.get(u) ?? null, set: async (u: string, etag: string, body: string) => void store.set(u, { etag, body }) };
    let n = 0;
    const f = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      if (n++ === 0) return json([1, 2], { headers: { etag: '"abc"' } });
      expect((init!.headers as Record<string, string>)["If-None-Match"]).toBe('"abc"');
      return new Response(null, { status: 304 });
    });
    const gh = new GithubClient({ token: "t", fetchImpl: f as unknown as typeof fetch, cache });
    await gh.get("/x");
    const second = await gh.get<number[]>("/x");
    expect(second.fromCache).toBe(true);
    expect(second.data).toEqual([1, 2]);
  });
});

describe("fetchReleases pagination", () => {
  it("stops once a page reaches past the window start", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => rel(1000 - i, new Date(Date.UTC(2026, 9, 11) - i * 3_600_000 * 3).toISOString()));
    const { impl, calls } = router({ "/repos/acme/widget/releases": () => json(page1) });
    const gh = new GithubClient({ token: "t", fetchImpl: impl });
    const res = await fetchReleases(gh, "acme/widget", WINDOW);
    expect(calls).toHaveLength(1); // page 1 already contains releases older than the window
    expect(res.releases).toHaveLength(100);
  });

  it("requests the next page while the whole page is inside the window", async () => {
    const inWindow = (i: number) => new Date(Date.UTC(2026, 9, 11) - i * 60_000).toISOString();
    const pages: Record<string, unknown[]> = {
      "1": Array.from({ length: 100 }, (_, i) => rel(5000 - i, inWindow(i))),
      "2": [rel(1, "2026-09-01T00:00:00Z")],
    };
    const { impl, calls } = router({ "/repos/acme/widget/releases": (u) => json(pages[u.searchParams.get("page") ?? "1"] ?? []) });
    const res = await fetchReleases(new GithubClient({ token: "t", fetchImpl: impl }), "acme/widget", WINDOW);
    expect(calls).toHaveLength(2);
    expect(res.releases).toHaveLength(101);
  });
});

describe("ingestRepo", () => {
  it("returns in-window releases only, excludes drafts, keeps prereleases, detects major bumps", async () => {
    const { impl } = router({
      "/repos/acme/widget/releases": () =>
        json([
          rel(4, "2026-10-11T00:00:00Z", { draft: true, published_at: null }),
          rel(3, "2026-10-10T00:00:00Z", { tag_name: "v2.0.0", name: "v2.0.0", html_url: "https://github.com/acme/widget/releases/tag/v2.0.0" }),
          rel(2, "2026-10-08T00:00:00Z", { prerelease: true, tag_name: "v2.0.0-rc.1", html_url: "https://github.com/acme/widget/releases/tag/v2.0.0-rc.1" }),
          rel(1, "2026-09-01T00:00:00Z", { tag_name: "v1.9.0", html_url: "https://github.com/acme/widget/releases/tag/v1.9.0" }),
        ]),
      "/repos/acme/widget/security-advisories": () => json([]),
    });
    const res = await ingestRepo(new GithubClient({ token: "t", fetchImpl: impl }), repo(), WINDOW);
    expect(res.status).toBe("ok");
    expect(res.releases.map((r) => r.release.tagName)).toEqual(["v2.0.0", "v2.0.0-rc.1"]);
    expect(res.releases[1].release.prerelease).toBe(true);
    expect(res.releases[1].majorBump).toEqual({ from: 1, to: 2 });
    expect(res.releases[0].majorBump).toBeNull(); // rc already moved the line to v2
  });

  it("marks a missing repository not_found without throwing", async () => {
    const { impl } = router({});
    const res = await ingestRepo(new GithubClient({ token: "t", fetchImpl: impl }), repo({ fullName: "gone/away" }), WINDOW);
    expect(res.status).toBe("not_found");
    expect(res.releases).toEqual([]);
  });

  it("tag fallback: only for repos with no releases, only tags dated inside the window, never commits or PRs", async () => {
    const { impl, calls } = router({
      "/repos/acme/widget/releases": () => json([]),
      "/repos/acme/widget/tags": () =>
        json([
          { name: "v9.0.3", commit: { sha: "aaa" } },
          { name: "v9.0.2", commit: { sha: "bbb" } },
          { name: "not-a-version", commit: { sha: "ccc" } },
        ]),
      "/repos/acme/widget/commits/aaa": () => json({ commit: { committer: { date: "2026-10-09T00:00:00Z" } } }),
      "/repos/acme/widget/commits/bbb": () => json({ commit: { committer: { date: "2026-08-01T00:00:00Z" } } }),
      "/repos/acme/widget/security-advisories": () => json([]),
      "/repos/acme/widget/pulls": () => json([{ id: 1, title: "PR" }]),
      "/repos/acme/widget/issues": () => json([{ id: 1, title: "issue" }]),
    });
    const res = await ingestRepo(new GithubClient({ token: "t", fetchImpl: impl }), repo(), WINDOW);
    expect(res.usedTagFallback).toBe(true);
    expect(res.releases.map((r) => [r.release.tagName, r.release.source, r.release.notesAvailable])).toEqual([["v9.0.3", "tag", false]]);
    expect(calls.some((c) => /\/(pulls|issues|events|comments)/.test(c))).toBe(false);
    expect(calls.filter((c) => c.includes("/commits/"))).toHaveLength(2); // only tag commit lookups
  });

  it("does not use tag fallback when the repo has recent releases outside the window", async () => {
    const { impl, calls } = router({
      "/repos/acme/widget/releases": () => json([rel(1, "2026-09-20T00:00:00Z")]),
      "/repos/acme/widget/security-advisories": () => json([]),
    });
    const res = await ingestRepo(new GithubClient({ token: "t", fetchImpl: impl }), repo(), WINDOW);
    expect(res.usedTagFallback).toBe(false);
    expect(res.releases).toEqual([]);
    expect(calls.some((c) => c.includes("/tags"))).toBe(false);
  });

  it("an advisory failure is a warning, not a repo failure", async () => {
    const { impl } = router({
      "/repos/acme/widget/releases": () => json([rel(1, "2026-10-10T00:00:00Z")]),
      "/repos/acme/widget/security-advisories": () => json({ message: "boom" }, { status: 500 }),
    });
    const gh = new GithubClient({ token: "t", fetchImpl: impl, maxRetries: 0 });
    const res = await ingestRepo(gh, repo(), WINDOW);
    expect(res.status).toBe("ok");
    expect(res.warnings[0]).toMatch(/Advisory lookup failed/);
  });
});

describe("matchAdvisories", () => {
  const adv = { ghsaId: "GHSA-aaaa-bbbb-cccc", cveId: "CVE-2026-1", summary: "x", severity: "high", publishedAt: new Date(), htmlUrl: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc", patchedVersions: ["1.2.4"] };
  it("matches by patched version (leading v tolerated)", () => {
    const r = release({ tagName: "v1.2.4" });
    const { byRelease, unmatched } = matchAdvisories([r], [adv]);
    expect(byRelease.get(r)?.[0].ghsaId).toBe(adv.ghsaId);
    expect(unmatched).toEqual([]);
  });
  it("matches by id mentioned in the notes", () => {
    const r = release({ tagName: "v3.0.0", body: "Fixes CVE-2026-1." });
    expect(matchAdvisories([r], [adv]).byRelease.size).toBe(1);
  });
  it("reports advisories with no matching release", () => {
    expect(matchAdvisories([release({ tagName: "v9.9.9" })], [adv]).unmatched).toHaveLength(1);
  });
});
