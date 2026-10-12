import type { Narrative } from "@/lib/health/ai/schema";
import type { NarrativeInput } from "@/lib/health/ai/prompt";

const NUM_RE = /\d[\d,]*(?:\.\d+)?/g;
const norm = (n: string) => {
  const x = n.replace(/,/g, "");
  return x.includes(".") ? String(Number(x)) : x;
};

/** Every number that may appear in the narrative: those in the reasons, the metrics JSON, the name and the intended use. */
export function allowedNumbers(input: NarrativeInput): Set<string> {
  const src = [JSON.stringify(input.metrics), ...input.reasons.map((r) => r.text), input.name, input.intendedUse, String(input.score ?? ""), String(input.weightCoveragePercent)].join("\n");
  const set = new Set<string>();
  for (const m of src.match(NUM_RE) ?? []) {
    set.add(norm(m));
    for (const part of m.split(/[.,]/)) if (part) set.add(String(Number(part))); // parts of versions like 6.2.12
  }
  return set;
}

const VERDICT_WORDS = /\b(healthy|watch|risky|insufficient data)\b/gi;

export type GroundingResult = { ok: true } | { ok: false; error: string };

export function checkGrounding(n: Narrative, input: NarrativeInput): GroundingResult {
  const allowed = allowedNumbers(input);
  const texts = [n.summary, ...n.strengths, ...n.concerns, ...n.verify_before_adopting, n.uncertainty_note];
  const bad = new Set<string>();
  for (const t of texts) for (const m of t.match(NUM_RE) ?? []) if (!allowed.has(norm(m))) bad.add(m);
  if (bad.size) return { ok: false, error: `Numbers not found in the data: ${[...bad].join(", ")}. Copy numbers exactly from the reasons.` };

  const words = (n.summary.match(VERDICT_WORDS) ?? []).map((w) => w.toLowerCase());
  const want = input.verdict.toLowerCase();
  const wrong = words.filter((w) => w !== want);
  if (wrong.length) return { ok: false, error: `The summary uses the verdict word "${wrong[0]}" but the verdict is "${input.verdict}".` };

  const sentences = n.summary.split(/(?<=[.!?])\s+/).filter(Boolean).length;
  if (sentences > 3) return { ok: false, error: `The summary has ${sentences} sentences; at most 3 are allowed.` };
  if (n.strengths.length && !input.reasons.some((r) => r.tag === "positive")) return { ok: false, error: "Strengths were given but there are no positive reasons." };
  if (n.concerns.length && !input.reasons.some((r) => r.tag === "concern")) return { ok: false, error: "Concerns were given but there are no concern reasons." };
  return { ok: true };
}
