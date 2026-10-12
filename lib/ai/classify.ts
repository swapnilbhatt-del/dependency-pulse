import pLimit from "p-limit";
import { fallbackAnalysis } from "@/lib/ai/fallback";
import { AiUnavailableError, summarizeRelease, type JsonModel } from "@/lib/ai/gemini";
import { releaseAnalysisSchema, type ReleaseAnalysis } from "@/lib/ai/schema";
import { GEMINI_CONCURRENCY } from "@/lib/config";
import { errorMessage, log } from "@/lib/log";
import type { NormalizedRelease } from "@/lib/types";

export interface CachedClassification {
  analysis: ReleaseAnalysis;
  aiStatus: "ok" | "fallback";
}

/** Persistence for the (release_id, body_hash, model) cache. */
export interface ClassificationCache {
  getMany(keys: { releaseId: number; bodyHash: string }[], model: string): Promise<Map<number, CachedClassification>>;
  put(
    entry: { releaseId: number; bodyHash: string; model: string; analysis: ReleaseAnalysis; aiStatus: "ok" | "fallback"; inputTokens: number; outputTokens: number },
  ): Promise<void>;
}

export interface ClassifyJob {
  releaseId: number;
  release: NormalizedRelease;
  /** False for releases folded under "+N earlier" with no signals; they get a deterministic summary. */
  needsAi: boolean;
}

export interface ClassifyOutcome {
  analysis: ReleaseAnalysis;
  aiStatus: "ok" | "fallback" | "skipped";
  fromCache: boolean;
}

export interface ClassifyStats {
  calls: number;
  cacheHits: number;
  fallbacks: number;
  tokensIn: number;
  tokensOut: number;
  pending: number;
  aiUnavailable: boolean;
  errors: string[];
}

const BREAKER_THRESHOLD = 3;

/**
 * Classification orchestration: cache first, then Gemini (bounded concurrency
 * is enforced inside the model), stopping when the invocation deadline is
 * near. Releases not processed before the deadline are reported as `pending`
 * so the caller can continue in a follow-up invocation.
 */
export async function classifyReleases(opts: {
  model: JsonModel | null;
  cache: ClassificationCache;
  jobs: ClassifyJob[];
  deadline: number;
  now?: () => number;
}): Promise<{ results: Map<number, ClassifyOutcome>; stats: ClassifyStats }> {
  const now = opts.now ?? Date.now;
  const results = new Map<number, ClassifyOutcome>();
  const stats: ClassifyStats = { calls: 0, cacheHits: 0, fallbacks: 0, tokensIn: 0, tokensOut: 0, pending: 0, aiUnavailable: false, errors: [] };
  const modelName = opts.model?.model ?? "none";

  const aiJobs = opts.jobs.filter((j) => j.needsAi && j.release.notesAvailable);
  for (const j of opts.jobs) {
    if (!(j.needsAi && j.release.notesAvailable)) {
      results.set(j.releaseId, { analysis: fallbackAnalysis(j.release.body), aiStatus: "skipped", fromCache: false });
    }
  }

  const cached = opts.model ? await opts.cache.getMany(aiJobs.map((j) => ({ releaseId: j.releaseId, bodyHash: j.release.bodyHash })), modelName) : new Map();
  const todo: ClassifyJob[] = [];
  for (const j of aiJobs) {
    const hit = cached.get(j.releaseId);
    const valid = hit ? releaseAnalysisSchema.safeParse(hit.analysis) : null;
    if (hit && valid?.success) {
      stats.cacheHits++;
      if (hit.aiStatus === "fallback") stats.fallbacks++;
      results.set(j.releaseId, { analysis: valid.data, aiStatus: hit.aiStatus, fromCache: true });
    } else {
      todo.push(j);
    }
  }

  let consecutiveFailures = 0;
  const runOne = async (j: ClassifyJob) => {
    const fallback = () => {
      stats.fallbacks++;
      results.set(j.releaseId, { analysis: fallbackAnalysis(j.release.body), aiStatus: "fallback", fromCache: false });
    };
    if (!opts.model || stats.aiUnavailable) return fallback();
    if (now() > opts.deadline) {
      stats.pending++;
      return;
    }
    stats.calls++;
    const r = await summarizeRelease(opts.model, {
      repoFullName: j.release.repoFullName,
      tagName: j.release.tagName,
      name: j.release.name,
      prerelease: j.release.prerelease,
      publishedAt: j.release.publishedAt,
      body: j.release.body,
    });
    stats.tokensIn += r.usage.input;
    stats.tokensOut += r.usage.output;
    if (r.aiStatus === "ok") {
      consecutiveFailures = 0;
      results.set(j.releaseId, { analysis: r.analysis, aiStatus: "ok", fromCache: false });
      await opts.cache
        .put({ releaseId: j.releaseId, bodyHash: j.release.bodyHash, model: modelName, analysis: r.analysis, aiStatus: "ok", inputTokens: r.usage.input, outputTokens: r.usage.output })
        .catch((err) => stats.errors.push(`cache write: ${errorMessage(err)}`));
      return;
    }
    // Fallback. Cache it only when the model answered but failed validation twice;
    // API outages are not cached so the next run tries again.
    stats.fallbacks++;
    results.set(j.releaseId, { analysis: r.analysis, aiStatus: "fallback", fromCache: false });
    if (r.error) stats.errors.push(`${j.release.repoFullName}@${j.release.tagName}: ${r.error}`);
    const apiDown = r.error !== null && /Gemini request failed|GEMINI_/.test(r.error);
    if (apiDown) {
      if (++consecutiveFailures >= BREAKER_THRESHOLD) {
        stats.aiUnavailable = true;
        log.error("gemini.circuit_open", { failures: consecutiveFailures });
      }
    } else {
      await opts.cache
        .put({ releaseId: j.releaseId, bodyHash: j.release.bodyHash, model: modelName, analysis: r.analysis, aiStatus: "fallback", inputTokens: r.usage.input, outputTokens: r.usage.output })
        .catch((err) => stats.errors.push(`cache write: ${errorMessage(err)}`));
    }
  };

  // Gate here (not only inside the model) so the deadline is checked when a job starts, not when it is queued.
  const gate = pLimit(GEMINI_CONCURRENCY);
  await Promise.all(
    todo.map((j) =>
      gate(() =>
        runOne(j).catch((err) => {
          stats.errors.push(errorMessage(err));
          if (err instanceof AiUnavailableError) stats.aiUnavailable = true;
        }),
      ),
    ),
  );
  return { results, stats };
}
