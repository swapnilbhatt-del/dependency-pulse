import { createHash } from "node:crypto";
import type { JsonModel } from "@/lib/ai/gemini";
import { NARRATIVE_SYSTEM, buildNarrativePrompt, type NarrativeInput } from "@/lib/health/ai/prompt";
import { checkGrounding } from "@/lib/health/ai/grounding";
import { templateNarrative } from "@/lib/health/ai/fallback";
import { narrativeJsonSchema, narrativeSchema, type Narrative } from "@/lib/health/ai/schema";
import { HEALTH_CONFIG_VERSION } from "@/lib/health/config";
import { errorMessage } from "@/lib/log";

export interface NarrativeCache {
  get(candidateId: number, inputHash: string, model: string): Promise<Narrative | null>;
  put(candidateId: number, inputHash: string, model: string, n: Narrative): Promise<void>;
}

export function narrativeInputHash(input: NarrativeInput): string {
  return createHash("sha256").update(HEALTH_CONFIG_VERSION).update(JSON.stringify(input)).digest("hex");
}

export interface NarrateResult {
  narrative: Narrative;
  aiStatus: "ok" | "fallback" | "skipped";
  fromCache: boolean;
  error: string | null;
  calls: number;
}

/**
 * Gemini writes the narrative; code validates it (zod + numeric grounding +
 * verdict consistency), retries once with the error, then falls back to a
 * template built from the reasons. Cached by (candidate, input hash, model).
 */
export async function narrate(opts: {
  model: JsonModel | null;
  cache: NarrativeCache;
  candidateId: number;
  input: NarrativeInput;
  inputHash: string;
  missing: string[];
  sampled: string | null;
}): Promise<NarrateResult> {
  const fallback = (aiStatus: "fallback" | "skipped", error: string | null, calls: number): NarrateResult => ({
    narrative: templateNarrative(opts.input, opts.missing, opts.sampled),
    aiStatus,
    fromCache: false,
    error,
    calls,
  });
  if (!opts.model) return fallback("skipped", "Gemini is not configured", 0);

  const cached = await opts.cache.get(opts.candidateId, opts.inputHash, opts.model.model).catch(() => null);
  if (cached && narrativeSchema.safeParse(cached).success) return { narrative: cached, aiStatus: "ok", fromCache: true, error: null, calls: 0 };

  const prompt = buildNarrativePrompt(opts.input);
  let lastError = "";
  let calls = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    calls++;
    let text: string;
    try {
      text = (
        await opts.model.generateJson({
          system: NARRATIVE_SYSTEM,
          prompt: attempt === 0 ? prompt : `${prompt}\n\nYour previous response was rejected: ${lastError}\nReturn corrected JSON only.`,
          jsonSchema: narrativeJsonSchema,
          maxOutputTokens: 1_500,
        })
      ).text;
    } catch (err) {
      return fallback("fallback", `Gemini unavailable: ${errorMessage(err)}`, calls);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      lastError = "Response was not valid JSON.";
      continue;
    }
    const v = narrativeSchema.safeParse(parsed);
    if (!v.success) {
      lastError = v.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
      continue;
    }
    const g = checkGrounding(v.data, opts.input);
    if (!g.ok) {
      lastError = g.error;
      continue;
    }
    await opts.cache.put(opts.candidateId, opts.inputHash, opts.model.model, v.data).catch(() => undefined);
    return { narrative: v.data, aiStatus: "ok", fromCache: false, error: null, calls };
  }
  return fallback("fallback", lastError, calls);
}
