import { describe, expect, it } from "vitest";
import { dimensionMetrics, headline, strongestPerRow, trendSummary } from "@/lib/health/present";
import { evaluate } from "@/lib/health/score";
import { metrics, mv } from "./fixtures";

describe("presentation", () => {
  it("missing metrics read 'Not available' with the reason, never zero", () => {
    const m = metrics((x) => (x.security.scorecardScore = mv(null, "No Scorecard data for this repository")));
    const r = dimensionMetrics("security", m)[0];
    expect(r).toMatchObject({ value: "Not available", missing: true, reason: "No Scorecard data for this repository" });
    expect(headline("security", m)).toBe("Not available");
  });
  it("sampled responsiveness is labelled as sampled", () => expect(headline("responsiveness", metrics())).toMatch(/sampled/));
  it("trend summary names verdict and dimension changes", () => {
    const a = evaluate(metrics());
    const b = evaluate(metrics((x) => ((x.cadence.daysSinceLastRelease = mv(200)), (x.cadence.releasesLast365 = mv(2)), (x.repo.archived = mv(true)))));
    const lines = trendSummary([
      { isoWeek: "2026-W42", verdict: a.verdict, score: a.overallScore, dimensions: a.dimensions },
      { isoWeek: "2026-W43", verdict: b.verdict, score: b.overallScore, dimensions: b.dimensions },
    ]);
    expect(lines[0]).toBe("Verdict changed from Healthy to Risky on the last refresh (2026-W43).");
    expect(lines).toContain("Release cadence dropped from Healthy to Risky on the last refresh.");
  });
  it("first snapshot and no-change messages", () => {
    const a = evaluate(metrics());
    const s = { isoWeek: "W", verdict: a.verdict, score: a.overallScore, dimensions: a.dimensions };
    expect(trendSummary([s])[0]).toMatch(/First snapshot/);
    expect(trendSummary([s, s])).toEqual(["No changes since the previous refresh."]);
  });
  it("strongest value per row (ties all marked; one value → none)", () => {
    expect(strongestPerRow([80, 95, null, 95])).toEqual([1, 3]);
    expect(strongestPerRow([3, 1], false)).toEqual([1]);
    expect(strongestPerRow([50, null])).toEqual([]);
  });
});
