import { z } from "zod";

const sentence = (max: number) => z.string().trim().min(1).max(max);

/** Gemini output for the "Decision in one minute" section. Narrative only: no scores, no verdicts of its own. */
export const narrativeSchema = z
  .object({
    summary: sentence(600),
    strengths: z.array(sentence(240)).max(3),
    concerns: z.array(sentence(240)).max(3),
    verify_before_adopting: z.array(sentence(260)).max(4),
    uncertainty_note: sentence(260),
  })
  .strict();
export type Narrative = z.infer<typeof narrativeSchema>;

export const narrativeJsonSchema = {
  type: "object",
  properties: {
    summary: { type: "string", description: "At most 3 sentences restating the given verdict and its main reasons." },
    strengths: { type: "array", items: { type: "string" }, maxItems: 3 },
    concerns: { type: "array", items: { type: "string" }, maxItems: 3 },
    verify_before_adopting: { type: "array", items: { type: "string" }, maxItems: 4 },
    uncertainty_note: { type: "string", description: "One sentence naming sampled or missing data." },
  },
  required: ["summary", "strengths", "concerns", "verify_before_adopting", "uncertainty_note"],
  propertyOrdering: ["summary", "strengths", "concerns", "verify_before_adopting", "uncertainty_note"],
} as const;
