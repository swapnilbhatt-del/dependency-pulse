import "server-only";
import { ApiError, GoogleGenAI, ThinkingLevel } from "@google/genai";
import pLimit from "p-limit";
import type { z } from "zod";
import { fallbackAnalysis } from "@/lib/ai/fallback";
import { SYSTEM_INSTRUCTION, buildSummarizePrompt, buildSynthesisPrompt, type SummarizeInput, type SynthesisItem } from "@/lib/ai/prompts";
import {
  releaseAnalysisJsonSchema,
  releaseAnalysisSchema,
  synthesisJsonSchema,
  synthesisSchema,
  type ReleaseAnalysis,
  type Synthesis,
} from "@/lib/ai/schema";
import { GEMINI_CONCURRENCY, GEMINI_MAX_OUTPUT_TOKENS, GEMINI_TEMPERATURE, GEMINI_TIMEOUT_MS } from "@/lib/config";
import { errorMessage, log } from "@/lib/log";
import { backoffMs, sleep } from "@/lib/util";

/**
 * The single AI module. All model calls go through Gemini Flash via the
 * official @google/genai SDK. Nothing else in the codebase talks to a model.
 */

export interface Usage {
  input: number;
  output: number;
}

export interface GenerateJsonRequest {
  system: string;
  prompt: string;
  jsonSchema: unknown;
  maxOutputTokens: number;
}

/** Minimal model interface so tests can inject a mock. */
export interface JsonModel {
  readonly model: string;
  generateJson(req: GenerateJsonRequest): Promise<{ text: string; usage: Usage | null }>;
}

export class AiUnavailableError extends Error {
  constructor(message: string, public readonly status: number | null) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export function createGeminiModel(opts: { apiKey: string; model: string; maxRetries?: number; sleepImpl?: (ms: number) => Promise<void> }): JsonModel {
  if (!opts.apiKey) throw new AiUnavailableError("GEMINI_API_KEY is not set.", null);
  if (!opts.model) throw new AiUnavailableError("GEMINI_MODEL is not set.", null);
  const ai = new GoogleGenAI({ apiKey: opts.apiKey, httpOptions: { timeout: GEMINI_TIMEOUT_MS } });
  const maxRetries = opts.maxRetries ?? 3;
  const wait = opts.sleepImpl ?? sleep;
  const gate = pLimit(GEMINI_CONCURRENCY);

  return {
    model: opts.model,
    generateJson: (req) =>
      gate(async () => {
        for (let attempt = 0; ; attempt++) {
          try {
            const res = await ai.models.generateContent({
              model: opts.model,
              contents: req.prompt,
              config: {
                systemInstruction: req.system,
                temperature: GEMINI_TEMPERATURE,
                maxOutputTokens: req.maxOutputTokens,
                responseMimeType: "application/json",
                responseJsonSchema: req.jsonSchema,
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                abortSignal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
              },
            });
            const u = res.usageMetadata;
            return {
              text: res.text ?? "",
              usage: u ? { input: u.promptTokenCount ?? 0, output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) } : null,
            };
          } catch (err) {
            const status = err instanceof ApiError ? err.status : null;
            const transient = status === null || RETRYABLE.has(status);
            if (transient && attempt < maxRetries) {
              const ms = status === 429 ? backoffMs(attempt, 4_000, 30_000) : backoffMs(attempt, 1_000, 8_000);
              log.warn("gemini.retry", { status, attempt, wait_ms: ms });
              await wait(ms);
              continue;
            }
            throw new AiUnavailableError(`Gemini request failed${status ? ` (${status})` : ""}: ${errorMessage(err)}`, status);
          }
        }
      }),
  };
}

function parseJson<T>(text: string, schema: z.ZodType<T>): { ok: true; value: T } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "Response was not valid JSON." };
  }
  const parsed = schema.safeParse(data);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") };
}

export interface SummarizeResult {
  analysis: ReleaseAnalysis;
  aiStatus: "ok" | "fallback";
  usage: Usage;
  attempts: number;
  error: string | null;
  truncated: boolean;
}

/**
 * Task 1: per-release summary and classification. Validates with zod; on a
 * validation failure retries once with the error appended; on a second failure
 * (or when the API is unavailable) returns the deterministic fallback with
 * aiStatus = "fallback".
 */
export async function summarizeRelease(model: JsonModel, input: SummarizeInput): Promise<SummarizeResult> {
  const { prompt, truncated } = buildSummarizePrompt(input);
  const usage: Usage = { input: 0, output: 0 };
  let lastError: string | null = null;
  let attempts = 0;
  for (let i = 0; i < 2; i++) {
    attempts++;
    const p = i === 0 ? prompt : `${prompt}\n\nYour previous response failed validation: ${lastError}\nReturn corrected JSON only.`;
    let text: string;
    try {
      const res = await model.generateJson({ system: SYSTEM_INSTRUCTION, prompt: p, jsonSchema: releaseAnalysisJsonSchema, maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS });
      text = res.text;
      if (res.usage) {
        usage.input += res.usage.input;
        usage.output += res.usage.output;
      }
    } catch (err) {
      lastError = errorMessage(err);
      break; // API unavailable: no point retrying validation.
    }
    const parsed = parseJson(text, releaseAnalysisSchema);
    if (parsed.ok) return { analysis: parsed.value, aiStatus: "ok", usage, attempts, error: null, truncated };
    lastError = parsed.error;
    log.warn("gemini.validation_failed", { repo: input.repoFullName, tag: input.tagName, attempt: attempts, error: lastError });
  }
  return { analysis: fallbackAnalysis(input.body), aiStatus: "fallback", usage, attempts, error: lastError, truncated };
}

/** Task 2: weekly synthesis. Returns null on failure (the builder then uses a deterministic paragraph). */
export async function synthesizeDigest(
  model: JsonModel,
  counts: Record<string, number>,
  items: SynthesisItem[],
): Promise<{ synthesis: Synthesis; usage: Usage } | { synthesis: null; usage: Usage; error: string }> {
  const usage: Usage = { input: 0, output: 0 };
  try {
    const res = await model.generateJson({
      system: SYSTEM_INSTRUCTION,
      prompt: buildSynthesisPrompt(counts, items),
      jsonSchema: synthesisJsonSchema,
      maxOutputTokens: 1_024,
    });
    if (res.usage) {
      usage.input += res.usage.input;
      usage.output += res.usage.output;
    }
    const parsed = parseJson(res.text, synthesisSchema);
    if (!parsed.ok) return { synthesis: null, usage, error: parsed.error };
    return { synthesis: parsed.value, usage };
  } catch (err) {
    return { synthesis: null, usage, error: errorMessage(err) };
  }
}
