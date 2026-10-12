import { z } from "zod";

export const CHANGE_TYPES = ["feature", "fix", "security", "breaking", "deprecation", "maintenance", "unknown"] as const;
export const REQUIRES_ACTION = ["none", "review", "upgrade_now"] as const;
export const CONFIDENCE = ["high", "medium", "low"] as const;

/** Runtime validation for Task 1 (release summarization). */
export const releaseAnalysisSchema = z
  .object({
    one_line_summary: z.string().min(1).max(160),
    key_changes: z.array(z.string().min(1).max(140)).max(4),
    change_type: z.enum(CHANGE_TYPES),
    is_security_fix: z.boolean(),
    is_breaking_change: z.boolean(),
    security_evidence: z.string().max(300).nullable(),
    breaking_evidence: z.string().max(300).nullable(),
    affected_area: z.string().min(1).max(80),
    requires_action: z.enum(REQUIRES_ACTION),
    confidence: z.enum(CONFIDENCE),
  })
  .strict();
export type ReleaseAnalysis = z.infer<typeof releaseAnalysisSchema>;

/**
 * The same contract as JSON Schema, sent to Gemini via responseJsonSchema.
 * Kept by hand (not generated) so it only uses the JSON Schema subset Gemini
 * documents as supported.
 */
export const releaseAnalysisJsonSchema = {
  type: "object",
  properties: {
    one_line_summary: { type: "string", description: "What shipped, max 160 characters, grounded in the notes." },
    key_changes: {
      type: "array",
      items: { type: "string", description: "One change, max 140 characters." },
      maxItems: 4,
    },
    change_type: { type: "string", enum: [...CHANGE_TYPES] },
    is_security_fix: { type: "boolean" },
    is_breaking_change: { type: "boolean" },
    security_evidence: {
      type: ["string", "null"],
      description: "A short phrase copied verbatim from the notes that shows a security fix, or null.",
    },
    breaking_evidence: {
      type: ["string", "null"],
      description: "A short phrase copied verbatim from the notes that shows a breaking change, or null.",
    },
    affected_area: { type: "string", description: 'Area affected, e.g. "authentication", or "not stated".' },
    requires_action: { type: "string", enum: [...REQUIRES_ACTION] },
    confidence: { type: "string", enum: [...CONFIDENCE] },
  },
  required: [
    "one_line_summary",
    "key_changes",
    "change_type",
    "is_security_fix",
    "is_breaking_change",
    "security_evidence",
    "breaking_evidence",
    "affected_area",
    "requires_action",
    "confidence",
  ],
  propertyOrdering: [
    "one_line_summary",
    "key_changes",
    "change_type",
    "is_security_fix",
    "is_breaking_change",
    "security_evidence",
    "breaking_evidence",
    "affected_area",
    "requires_action",
    "confidence",
  ],
} as const;

/** Task 2 (weekly synthesis). */
export const synthesisSchema = z
  .object({
    at_a_glance: z.string().min(1).max(600),
    action_items: z.array(z.string().min(1).max(200)).max(5),
  })
  .strict();
export type Synthesis = z.infer<typeof synthesisSchema>;

export const synthesisJsonSchema = {
  type: "object",
  properties: {
    at_a_glance: { type: "string", description: "At most 3 sentences. Most important item first. Counts stated plainly." },
    action_items: { type: "array", items: { type: "string" }, maxItems: 5 },
  },
  required: ["at_a_glance", "action_items"],
  propertyOrdering: ["at_a_glance", "action_items"],
} as const;
