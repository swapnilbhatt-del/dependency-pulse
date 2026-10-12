import { describe, expect, it } from "vitest";
import { BUS_FACTOR_LOW_SHARE, HEALTH_CONFIG_VERSION, VERDICT_THRESHOLDS, WEIGHTS } from "@/lib/health/config";
import {
  applyGates,
  evaluate,
  evaluateGates,
  mapVerdict,
  scoreAdoption,
  scoreCadence,
  scoreCi,
  scoreGovernance,
  scoreMaintainerDepth,
  scoreMaintenance,
  scoreResponsiveness,
  scoreSecurity,
  scoreVulnerabilities,
  scoreDimensions,
  weightedOverall,
} from "@/lib/health/score";
import type { Verdict } from "@/lib/health/types";
import { metrics, mv } from "./fixtures";

describe("weights", () => {
  it("sum to 100", () => expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100));
});

describe("dimension scores", () => {
  it("cadence: boundaries and insufficient", () => {
    const c = (days: number | null, n: number | null) => scoreCadence(metrics((m) => ((m.cadence.daysSinceLastRelease = mv(days)), (m.cadence.releasesLast365 = mv(n)))).cadence);
    expect(c(30, 12).score).toBe(100); // 0.6*100 + 0.4*100
    expect(c(31, 12).score).toBe(91); // 0.6*85 + 0.4*100
    expect(c(365, 0).score).toBe(28); // 0.6*40 + 0.4*10
    expect(c(366, 0).score).toBe(10);
    expect(c(null, null).status).toBe("insufficient");
    expect(c(null, 2)).toMatchObject({ status: "partial", score: 55 });
  });
  it("maintenance: archived scores 0; missing commit date is insufficient", () => {
    const m = metrics();
    expect(scoreMaintenance(m.maintenance, true).score).toBe(0);
    expect(scoreMaintenance({ ...m.maintenance, daysSinceLastCommit: mv(14) }, false).score).toBe(100);
    expect(scoreMaintenance({ ...m.maintenance, daysSinceLastCommit: mv(15) }, false).score).toBe(90);
    expect(scoreMaintenance({ ...m.maintenance, daysSinceLastCommit: mv(null) }, false).status).toBe("insufficient");
  });
  it("responsiveness: needs a minimum sample; no responses scores speed 0", () => {
    const r = (o: Partial<ReturnType<typeof metrics>["responsiveness"]>) => scoreResponsiveness({ ...metrics().responsiveness, ...o });
    expect(r({ issueSampleSize: mv(2), prSampleSize: mv(2) }).status).toBe("insufficient");
    expect(r({ issueSampleSize: mv(3), prSampleSize: mv(2) }).status).toBe("scored");
    expect(r({ medianHoursToFirstResponse: mv(24), maintainerResponseShare: mv(1) }).score).toBe(100);
    expect(r({ medianHoursToFirstResponse: mv(null), maintainerResponseShare: mv(0) }).score).toBe(0);
    expect(r({}).note).toMatch(/sampled \(70 items\)/);
  });
  it("maintainer depth", () => {
    const d = (people: number | null, share: number | null) => scoreMaintainerDepth({ ...metrics().maintainerDepth, distinctContributors365: mv(people), topContributorShare365: mv(share) });
    expect(d(10, 0.4).score).toBe(100);
    expect(d(1, 0.9).score).toBe(18); // 0.5*20 + 0.5*15 = 17.5 → 18
    expect(d(null, 0.5).status).toBe("insufficient");
  });
  it("governance: OSI license + security policy = 100; non-OSI and missing policy reduce it", () => {
    const g = (lic: "osi" | "non_osi" | "unknown" | "none" | null, sec: boolean | null) => scoreGovernance({ ...metrics().governance, licenseStatus: mv(lic), hasSecurityPolicy: mv(sec) });
    expect(g("osi", true).score).toBe(100);
    expect(g("non_osi", true).score).toBe(60);
    expect(g("none", false).score).toBe(0);
    expect(g(null, null).status).toBe("insufficient");
    expect(g("osi", null).status).toBe("partial");
  });
  it("ci: passing / failing / unknown", () => {
    expect(scoreCi({ status: mv("passing"), method: mv("check-runs") }).score).toBe(100);
    expect(scoreCi({ status: mv("failing"), method: mv("check-runs") }).score).toBe(20);
    expect(scoreCi({ status: mv("unknown"), method: mv("check-runs") }).status).toBe("insufficient");
  });
  it("security: Scorecard ×10 minus capped advisory penalty; no Scorecard is insufficient, not zero", () => {
    const s = (sc: number | null, adv: number | null) => scoreSecurity({ ...metrics().security, scorecardScore: mv(sc), advisoriesLast365: mv(adv) });
    expect(s(8, 0).score).toBe(80);
    expect(s(8, 1).score).toBe(70);
    expect(s(8, 9).score).toBe(50); // penalty capped at 30
    expect(s(null, 0)).toMatchObject({ status: "insufficient", score: null });
  });
  it("vulnerabilities: unfixed in latest = 10; recent ones reduce to a floor; no package is insufficient", () => {
    const v = metrics().vulnerabilities;
    expect(scoreVulnerabilities({ ...v, affectingLatest: mv(1) }).score).toBe(10);
    expect(scoreVulnerabilities({ ...v, total: mv(3), publishedLast365: mv(2), foundInOsv: mv(true) }).score).toBe(80);
    expect(scoreVulnerabilities({ ...v, total: mv(20), publishedLast365: mv(9), foundInOsv: mv(true) }).score).toBe(60);
    expect(scoreVulnerabilities({ ...v, packageName: null }).status).toBe("insufficient");
  });
  it("adoption: stars alone are partial and weak", () => {
    const a = metrics().adoption;
    expect(scoreAdoption(a, 12_000).score).toBe(100); // 0.8*100 + 0.2*100
    expect(scoreAdoption({ ...a, weeklyDownloads: mv(null) }, 500)).toMatchObject({ status: "partial", score: 40 });
    expect(scoreAdoption({ ...a, weeklyDownloads: mv(null) }, null).status).toBe("insufficient");
  });
});

describe("weight coverage and the 60 percent rule", () => {
  it("excludes insufficient dimensions from the mean and reports coverage", () => {
    const m = metrics((x) => ((x.security.scorecardScore = mv(null)), (x.vulnerabilities.packageName = null)));
    const { coverage } = weightedOverall(scoreDimensions(m));
    expect(coverage).toBeCloseTo(0.65); // 100 − 20 − 15
  });
  it("exactly 60 percent is enough; below 60 is Insufficient data regardless of score", () => {
    expect(mapVerdict(95, 0.6)).toBe("healthy");
    expect(mapVerdict(95, 0.59)).toBe("insufficient");
    expect(mapVerdict(null, 0)).toBe("insufficient");
  });
  it("evaluate() reports coverage and an Insufficient verdict with a coverage reason", () => {
    const r = evaluate(metrics((x) => ((x.security.scorecardScore = mv(null)), (x.vulnerabilities.packageName = null), (x.maintenance.daysSinceLastCommit = mv(null)))));
    expect(r.weightCoverage).toBe(0.5);
    expect(r.verdict).toBe("insufficient");
    expect(r.reasons[0].id).toBe("coverage.low");
  });
});

describe("verdict thresholds", () => {
  it.each([
    [VERDICT_THRESHOLDS.healthy, "healthy"],
    [VERDICT_THRESHOLDS.healthy - 1, "watch"],
    [VERDICT_THRESHOLDS.watch, "watch"],
    [VERDICT_THRESHOLDS.watch - 1, "risky"],
  ])("score %i → %s", (score, verdict) => expect(mapVerdict(score, 1)).toBe(verdict));
});

describe("hard gates", () => {
  it("archived caps at Risky", () => {
    const r = evaluate(metrics((m) => (m.repo.archived = mv(true))));
    expect(r.verdict).toBe("risky");
    expect(r.reasons[0].text).toMatch(/archived/);
  });
  it("missing or non-OSI license caps at Watch with 'License needs legal review.'", () => {
    for (const lic of ["none", "unknown", "non_osi"] as const) {
      const r = evaluate(metrics((m) => ((m.governance.licenseStatus = mv(lic)), (m.governance.licenseSpdx = mv(lic === "non_osi" ? "BUSL-1.1" : null)))));
      expect(r.computedVerdict).toBe("healthy");
      expect(r.verdict).toBe("watch");
      expect(r.reasons.some((x) => x.text.includes("License needs legal review."))).toBe(true);
    }
  });
  it("no release and no commit in 365 days → Risky", () => {
    const r = evaluate(metrics((m) => ((m.cadence.daysSinceLastRelease = mv(400)), (m.maintenance.daysSinceLastCommit = mv(380)))));
    expect(r.gates.map((g) => g.id)).toContain("abandoned");
    expect(r.verdict).toBe("risky");
  });
  it("a known unfixed vulnerability caps at Watch", () => {
    const r = evaluate(metrics((m) => ((m.vulnerabilities.affectingLatest = mv(2)), (m.vulnerabilities.total = mv(2)), (m.vulnerabilities.foundInOsv = mv(true)))));
    expect(r.gates.map((g) => g.id)).toEqual(["unfixed_vuln"]);
    expect(r.verdict).toBe("watch");
  });
  it(`bus factor: exactly ${BUS_FACTOR_LOW_SHARE * 100}% does not trigger; just above does`, () => {
    expect(evaluateGates(metrics((m) => (m.maintainerDepth.topContributorShare365 = mv(0.6)))).map((g) => g.id)).not.toContain("bus_factor");
    const r = evaluate(metrics((m) => (m.maintainerDepth.topContributorShare365 = mv(0.6001))));
    expect(r.gates.map((g) => g.id)).toContain("bus_factor");
    expect(r.verdict).toBe("watch");
  });
  it("gates only cap, never raise", () => {
    const all: Verdict[] = ["healthy", "watch", "risky"];
    const rank = { risky: 1, watch: 2, healthy: 3 } as const;
    for (const v of all)
      for (const cap of ["watch", "risky"] as const) {
        const out = applyGates(v, [{ id: "license", cap, text: "" }]);
        expect(rank[out as keyof typeof rank]).toBeLessThanOrEqual(rank[v as keyof typeof rank]);
      }
    expect(applyGates("risky", [{ id: "license", cap: "watch", text: "" }])).toBe("risky");
  });
  it("Insufficient data stays insufficient under a Watch cap but becomes Risky under a Risky cap", () => {
    expect(applyGates("insufficient", [{ id: "license", cap: "watch", text: "" }])).toBe("insufficient");
    expect(applyGates("insufficient", [{ id: "archived", cap: "risky", text: "" }])).toBe("risky");
  });
});

describe("reasons", () => {
  it("are tagged, ordered (gates first, positives last) and worded from metrics", () => {
    const r = evaluate(metrics((m) => ((m.cadence.daysSinceLastRelease = mv(412)), (m.maintainerDepth.topContributorShare365 = mv(0.78)), (m.maintainerDepth.topContributor = mv("bob")))));
    const texts = r.reasons.map((x) => x.text);
    expect(texts).toContain("Last release was 412 days ago (v3.2.0).");
    expect(texts).toContain("One contributor authored 78 percent of commits in the last 365 days (low bus factor).");
    expect(r.reasons[0].dimension).toBe("gate");
    expect(r.reasons.at(-1)!.tag).toBe("positive");
    expect(r.reasons.find((x) => x.id === "cadence.recency")!.tag).toBe("concern");
  });
  it("produce nothing for a missing metric", () => {
    const r = evaluate(metrics((m) => ((m.security.scorecardScore = mv(null)), (m.cadence.daysSinceLastRelease = mv(null)))));
    expect(r.reasons.some((x) => x.id === "security.scorecard")).toBe(false);
    expect(r.reasons.some((x) => x.id === "cadence.recency")).toBe(false);
  });
  it("label tags-only projects and sampled responsiveness", () => {
    const r = evaluate(metrics((m) => (m.cadence.usesGithubReleases = mv(false))));
    expect(r.reasons.find((x) => x.id === "cadence.recency")!.text).toMatch(/^Last tag was/);
    expect(r.reasons.find((x) => x.id === "responsiveness.speed")!.text).toMatch(/sample of 30 issues and 40 pull requests/);
  });
  it("stamp the config version", () => expect(evaluate(metrics()).configVersion).toBe(HEALTH_CONFIG_VERSION));
});
