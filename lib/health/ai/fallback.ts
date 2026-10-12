import type { Narrative } from "@/lib/health/ai/schema";
import type { NarrativeInput } from "@/lib/health/ai/prompt";

/** Concrete follow-up checks keyed by reason id, used by the template narrative. */
const VERIFY: Record<string, string> = {
  "gate.license": "Have legal review the license before adopting.",
  "gate.unfixed_vuln": "Check whether the known vulnerability in the latest version touches the parts you would use, and whether a fix is planned.",
  "gate.bus_factor": "Ask the maintainers about co-maintainers or succession, since one contributor wrote most recent commits.",
  "gate.archived": "Look for a maintained fork or an alternative; an archived project will not receive fixes.",
  "gate.abandoned": "Confirm with the maintainers whether the project is still maintained before depending on it.",
  "coverage.low": "Fill the data gaps (for example, add the npm or PyPI package name) and refresh before deciding.",
  "ci.failing": "Find out why the default-branch checks are failing before pinning a version.",
  "responsiveness.share": "Read a few recent issue threads to see how maintainers engage with reports.",
  "responsiveness.none": "Read a few recent issue threads to see whether reports get answered at all.",
  "cadence.recency": "Ask whether a new release is planned, given the time since the last one.",
  "security.scorecard": "Review the low-scoring OpenSSF Scorecard checks for practices that matter to you.",
  "security.advisories": "Read the recent security advisories and check how quickly they were fixed.",
  "governance.security_policy": "Ask how to report a vulnerability privately, since no security policy was found.",
};

/** Deterministic narrative built only from the reason list (used when Gemini output fails validation twice). */
export function templateNarrative(input: NarrativeInput, missing: string[], sampled: string | null): Narrative {
  const pos = input.reasons.filter((r) => r.tag === "positive");
  const con = input.reasons.filter((r) => r.tag === "concern");
  const lead = `${input.name} is rated ${input.verdict}${input.score !== null ? ` with a score of ${input.score}` : ""}, based on ${input.weightCoveragePercent} percent of the scoring weight.`;
  const summary = [lead, con[0] ? `Main concern: ${con[0].text}` : null, pos[0] ? `Main strength: ${pos[0].text}` : null].filter(Boolean).join(" ");
  const verify = [...new Set(con.map((r) => VERIFY[r.id]).filter(Boolean))].slice(0, 4);
  const gaps = missing.length ? `No data for: ${missing.join(", ")}.` : "";
  return {
    summary,
    strengths: pos.slice(0, 3).map((r) => r.text),
    concerns: con.slice(0, 3).map((r) => r.text),
    verify_before_adopting: verify,
    uncertainty_note: [sampled, gaps].filter(Boolean).join(" ") || "All dimensions had data for this refresh.",
  };
}
