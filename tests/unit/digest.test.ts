import { describe, expect, it } from "vitest";
import { buildDigest, collapseDuplicates, toItem } from "@/lib/digest/build";
import type { BuildInput, RepoOutcome } from "@/lib/digest/model";
import { compareImpact, prioritize } from "@/lib/digest/prioritize";
import { digestSubject } from "@/lib/digest/subject";
import { assignTier } from "@/lib/digest/tiers";
import { analysis, classified, release, repo } from "../fixtures/factory";

const base = { isSecurityFix: false, isBreakingChange: false, majorBump: null, requiresAction: "none" as const };

describe("assignTier", () => {
  it("tier 1: security, upgrade_now, or breaking in a critical repo", () => {
    expect(assignTier({ ...base, isSecurityFix: true }, "low")).toBe(1);
    expect(assignTier({ ...base, requiresAction: "upgrade_now" }, "normal")).toBe(1);
    expect(assignTier({ ...base, isBreakingChange: true }, "critical")).toBe(1);
  });
  it("tier 2: breaking, major bump, or review", () => {
    expect(assignTier({ ...base, isBreakingChange: true }, "normal")).toBe(2);
    expect(assignTier({ ...base, majorBump: { from: 1, to: 2 } }, "normal")).toBe(2);
    expect(assignTier({ ...base, requiresAction: "review" }, "low")).toBe(2);
  });
  it("tier 3 otherwise", () => {
    expect(assignTier(base, "critical")).toBe(3);
  });
});

describe("smart prioritization", () => {
  const mk = (o: Partial<Parameters<typeof compareImpact>[0]>) => ({
    isSecurityFix: false,
    isBreakingChange: false,
    priority: "normal" as const,
    evidenceCount: 1,
    publishedAt: new Date("2026-10-08T00:00:00Z"),
    repoFullName: "a/a",
    ...o,
  });
  it("security > breaking > critical > more evidence > newer", () => {
    const items = [
      mk({ repoFullName: "newer", publishedAt: new Date("2026-10-11T00:00:00Z") }),
      mk({ repoFullName: "evidence", evidenceCount: 3 }),
      mk({ repoFullName: "critical", priority: "critical" }),
      mk({ repoFullName: "breaking", isBreakingChange: true }),
      mk({ repoFullName: "security", isSecurityFix: true, priority: "low" }),
      mk({ repoFullName: "older", publishedAt: new Date("2026-10-06T00:00:00Z") }),
    ];
    expect(prioritize(items).map((i) => i.repoFullName)).toEqual(["security", "breaking", "critical", "evidence", "newer", "older"]);
  });
});

describe("collapseDuplicates", () => {
  it("folds an older release with the same advisory into the newer card", () => {
    const rp = repo();
    const adv = { ghsaId: "GHSA-aaaa-bbbb-cccc", cveId: null, summary: "s", htmlUrl: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc", severity: null };
    const mkC = (tag: string, day: string) => {
      const r = release({ tagName: tag, githubReleaseId: Number(day), publishedAt: new Date(`2026-10-${day}T00:00:00Z`), body: "Maintenance." });
      const c = classified(r, analysis(), rp);
      c.classification = { ...c.classification, isSecurityFix: true, securityEvidence: [{ kind: "advisory", text: adv.ghsaId, url: adv.htmlUrl }] };
      return toItem(c);
    };
    const out = collapseDuplicates([mkC("v1.2.4", "07"), mkC("v1.2.5", "09")]);
    expect(out).toHaveLength(1);
    expect(out[0].tag).toBe("v1.2.5");
    expect(out[0].alsoIn).toEqual(["v1.2.4"]);
  });
  it("keeps distinct changes separate", () => {
    const a = toItem(classified(release({ tagName: "v1", body: "Fixes CVE-2026-1000." }), analysis()));
    const b = toItem(classified(release({ tagName: "v2", githubReleaseId: 2, body: "Fixes CVE-2026-2000." }), analysis()));
    expect(collapseDuplicates([a, b])).toHaveLength(2);
  });
});

function input(over: Partial<BuildInput> = {}): BuildInput {
  return {
    isoWeek: "2026-W42",
    weekOf: new Date("2026-10-12T00:00:00Z"),
    window: { start: new Date("2026-10-05T03:30:00Z"), end: new Date("2026-10-12T03:30:00Z") },
    generatedAt: new Date("2026-10-12T03:31:00Z"),
    timezoneLabel: "Asia/Kolkata",
    baseUrl: "https://pulse.example",
    releases: [],
    repoOutcomes: [],
    advisoryOnly: [],
    aiFallbacks: 0,
    ...over,
  };
}
const ok = (r = repo(), n = 0): RepoOutcome => ({ repo: r, status: "ok", error: null, releaseCount: n, usedTagFallback: false });

describe("buildDigest", () => {
  it("puts security items at the top, then review, then FYI grouped by category", () => {
    const pay = repo({ id: 1, fullName: "stripe/stripe-node", category: "payments", priority: "critical" });
    const auth = repo({ id: 2, fullName: "panva/jose", category: "auth" });
    const sec = classified(release({ repoId: 2, tagName: "v6.1.1", body: "Fixes CVE-2026-1234 in JWE decryption." }), analysis(), auth);
    const brk = classified(release({ repoId: 1, tagName: "v19.0.0", githubReleaseId: 7, body: "Removed legacy charges API." }), analysis({ is_breaking_change: true, breaking_evidence: "Removed legacy charges API" }), repo({ ...pay, priority: "normal" }));
    const fyi = classified(release({ repoId: 1, tagName: "v18.9.0", githubReleaseId: 8, body: "Adds new webhook types." }), analysis({ one_line_summary: "Adds new webhook types." }), pay);
    const d = buildDigest(input({ releases: [fyi, brk, sec], repoOutcomes: [ok(pay, 2), ok(auth, 1), ok(repo({ id: 3, fullName: "quiet/repo", category: "tooling" }))] }));
    expect(d.act.map((i) => i.tag)).toEqual(["v6.1.1"]);
    expect(d.review.map((i) => i.tag)).toEqual(["v19.0.0"]);
    expect(d.fyi[0].category).toBe("payments");
    expect(d.fyi[0].items[0].tag).toBe("v18.9.0");
    expect(d.quiet).toEqual(["quiet/repo"]);
    expect(d.counts).toMatchObject({ act: 1, review: 1, fyi: 1, releasesFound: 3, reposChecked: 3 });
    expect(d.act[0].whyFlagged).toContain("CVE-2026-1234");
    expect(d.act[0].nextStep).toContain("v6.1.1");
    expect(d.coverage.find((c) => c.category === "payments")).toEqual({ category: "payments", reposChecked: 1, releases: 2 });
  });

  it("never hides a release: caps FYI at 3 per repo with the rest listed as earlier", () => {
    const rp = repo();
    const rels = [1, 2, 3, 4, 5].map((n) =>
      classified(release({ tagName: `v1.0.${n}`, githubReleaseId: n, publishedAt: new Date(`2026-10-${String(n + 5).padStart(2, "0")}T00:00:00Z`), body: `Change ${n}.` }), analysis({ one_line_summary: `Change ${n}.` }), rp),
    );
    const d = buildDigest(input({ releases: rels, repoOutcomes: [ok(rp, 5)] }));
    expect(d.fyi[0].items.map((i) => i.tag)).toEqual(["v1.0.5", "v1.0.4", "v1.0.3"]);
    expect(d.fyi[0].earlier).toEqual([{ repo: "acme/widget", tags: ["v1.0.2", "v1.0.1"] }]);
    expect(d.counts.fyi).toBe(5);
  });

  it("keeps flagged items visible even beyond the FYI cap", () => {
    const rp = repo();
    const rels = [1, 2, 3, 4].map((n) =>
      classified(release({ tagName: `v1.0.${n}`, githubReleaseId: n, publishedAt: new Date(`2026-10-${String(n + 5).padStart(2, "0")}T00:00:00Z`), body: n === 1 ? "Fixes CVE-2026-9999." : `Change ${n}.` }), analysis({ one_line_summary: `Change ${n}.` }), rp),
    );
    const d = buildDigest(input({ releases: rels, repoOutcomes: [ok(rp, 4)] }));
    expect(d.act.map((i) => i.tag)).toEqual(["v1.0.1"]);
    expect(d.fyi[0].items).toHaveLength(3);
  });

  it("separates updated and already-reported releases (change-aware)", () => {
    const rp = repo();
    const upd = classified(release({ tagName: "v2.0.1", body: "Edited notes." }), analysis({ one_line_summary: "Edited notes." }), rp, { history: "updated" });
    const old = classified(release({ tagName: "v2.0.0", githubReleaseId: 2, body: "Same." }), analysis(), rp, { history: "already_reported" });
    const d = buildDigest(input({ releases: [upd, old], repoOutcomes: [ok(rp, 2)] }));
    expect(d.updated.map((i) => i.tag)).toEqual(["v2.0.1"]);
    expect(d.alreadyReported.map((i) => i.tag)).toEqual(["v2.0.0"]);
    expect(d.fyi).toHaveLength(0);
  });

  it("lists repos that could not be checked with a reason", () => {
    const d = buildDigest(input({ repoOutcomes: [{ repo: repo({ fullName: "gone/repo" }), status: "not_found", error: null, releaseCount: 0, usedTagFallback: false }] }));
    expect(d.couldNotCheck[0].repo).toBe("gone/repo");
    expect(d.couldNotCheck[0].reason).toMatch(/404/);
    expect(d.statusLine).toContain("1 repo could not be checked");
  });

  it("all-quiet week still produces a full digest", () => {
    const d = buildDigest(input({ repoOutcomes: [ok(repo({ fullName: "a/a" })), ok(repo({ id: 2, fullName: "b/b" }))] }));
    expect(d.subject).toBe("[Dependency Pulse] All quiet this week · 12 Oct 2026");
    expect(d.quiet).toEqual(["a/a", "b/b"]);
    expect(d.synthesis.paragraph).toMatch(/All quiet/);
  });

  it("labels low-confidence items", () => {
    const r = release({ body: "Hardened security of cookie parsing." });
    const c = classified(r, analysis({ is_security_fix: true, security_evidence: "invented phrase here" }));
    const item = toItem(c);
    expect(item.tier).toBe(2);
    expect(item.flags.lowConfidence).toBe(true);
    expect(item.whyFlagged).toMatch(/not found in the notes/);
  });
});

describe("digestSubject", () => {
  const monday = new Date("2026-10-12T00:00:00Z");
  it("zero flagged", () => expect(digestSubject(0, 0, monday)).toBe("[Dependency Pulse] All quiet this week · 12 Oct 2026"));
  it("some flagged", () => expect(digestSubject(2, 4, monday)).toBe("[Dependency Pulse] 2 need action · 4 to review · week of 12 Oct 2026"));
  it("review only", () => expect(digestSubject(0, 1, monday)).toBe("[Dependency Pulse] 0 need action · 1 to review · week of 12 Oct 2026"));
  it("many flagged", () => expect(digestSubject(25, 130, monday)).toBe("[Dependency Pulse] 25 need action · 130 to review · week of 12 Oct 2026"));
});

describe("groupSameRepo", () => {
  it("folds several flagged releases of one repo into one card without changing counts", () => {
    const rp = repo({ fullName: "prisma/orm", category: "data" });
    const rels = [15, 16, 17].map((n) =>
      classified(
        release({ tagName: `v8.0.0-rc.${n}`, githubReleaseId: n, prerelease: true, publishedAt: new Date(`2026-10-0${n - 9}T00:00:00Z`), body: `Removed option ${n}.` }),
        analysis({ is_breaking_change: true, breaking_evidence: `Removed option ${n}`, one_line_summary: `RC ${n}.` }),
        rp,
      ),
    );
    const d = buildDigest(input({ releases: rels, repoOutcomes: [ok(rp, 3)] }));
    expect(d.review).toHaveLength(1);
    expect(d.review[0].tag).toBe("v8.0.0-rc.17");
    expect(d.review[0].related?.map((r) => r.tag)).toEqual(["v8.0.0-rc.16", "v8.0.0-rc.15"]);
    expect(d.counts.review).toBe(3);
  });
});
