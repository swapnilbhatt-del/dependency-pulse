import type { NarrativeInput } from "@/lib/health/ai/prompt";
import { DIMENSIONS } from "@/lib/health/config";
import { DIMENSION_LABEL } from "@/lib/health/labels";
import type { HealthReport, Metric, RawMetrics } from "@/lib/health/types";
import { VERDICT_LABEL } from "@/lib/health/types";

/** Flatten metrics to plain values (null when missing) for the model and for hashing. */
export function compactMetrics(m: RawMetrics): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (prefix: string, obj: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && "value" in (v as object) && "source" in (v as object)) {
        const val = (v as Metric<unknown>).value;
        out[key] = k === "scorecardChecks" && Array.isArray(val) ? val.map((c: { name: string; score: number | null }) => `${c.name}:${c.score ?? "n/a"}`) : val;
      } else if (v && typeof v === "object" && !Array.isArray(v)) walk(key, v as Record<string, unknown>);
      else out[key] = v;
    }
  };
  walk("", m as unknown as Record<string, unknown>);
  return out;
}

export function narrativeInputFor(name: string, intendedUse: string, report: HealthReport, metrics: RawMetrics): { input: NarrativeInput; missing: string[]; sampled: string | null } {
  const missing = DIMENSIONS.filter((d) => report.dimensions[d].status === "insufficient").map((d) => DIMENSION_LABEL[d]);
  const r = metrics.responsiveness;
  const sampled = r.issueSampleSize.value !== null ? `Responsiveness is based on a sample of ${r.issueSampleSize.value} issues and ${r.prSampleSize.value ?? 0} pull requests from the last 90 days.` : null;
  return {
    input: {
      name,
      intendedUse,
      verdict: VERDICT_LABEL[report.verdict],
      score: report.overallScore,
      weightCoveragePercent: Math.round(report.weightCoverage * 100),
      reasons: report.reasons.map(({ id, tag, text }) => ({ id, tag, text })),
      metrics: compactMetrics(metrics),
    },
    missing,
    sampled,
  };
}
