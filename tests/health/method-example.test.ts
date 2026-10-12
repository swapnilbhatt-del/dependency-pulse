/** docs/HEALTH_METHOD.md §7 must stay true: recompute the worked example from the stored metrics. */
import { describe, expect, it } from "vitest";
import { evaluate } from "@/lib/health/score";
import type { RawMetrics } from "@/lib/health/types";
import stored from "./fixtures/panva-jose-2026-W42.json";

describe("HEALTH_METHOD worked example: panva/jose 2026-W42", () => {
  const r = evaluate(stored as unknown as RawMetrics);
  it("dimension scores match the document", () => {
    expect(Object.fromEntries(Object.entries(r.dimensions).map(([k, v]) => [k, v.score]))).toEqual({
      security: 75,
      vulnerabilities: 100,
      maintenance: 100,
      cadence: 91,
      responsiveness: 65,
      maintainerDepth: 48,
      governance: 100,
      ci: 20,
      adoption: 94,
    });
  });
  it("overall 81, coverage 100%, Healthy before gates, Watch after the bus-factor gate", () => {
    expect(r).toMatchObject({ overallScore: 81, weightCoverage: 1, computedVerdict: "healthy", verdict: "watch" });
    expect(r.gates.map((g) => g.id)).toEqual(["bus_factor"]);
    expect(r.reasons[0].text).toBe("One contributor authored 98 percent of commits in the last 365 days (low bus factor).");
  });
});
