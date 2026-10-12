import { randomUUID } from "node:crypto";
import type { JsonModel } from "@/lib/ai/gemini";
import { isoWeek as isoWeekOf } from "@/lib/filter/window";
import type { GithubClient } from "@/lib/github/client";
import { narrativeInputFor } from "@/lib/health/ai/input";
import { narrate, narrativeInputHash, type NarrativeCache } from "@/lib/health/ai/narrate";
import { collectMetrics, type Collected } from "@/lib/health/collect";
import { HEALTH_CONFIG_VERSION } from "@/lib/health/config";
import { evaluate } from "@/lib/health/score";
import { GithubRun } from "@/lib/health/sources/github";
import { RunCache, type HttpDeps } from "@/lib/health/sources/http";
import { shouldRefresh } from "@/lib/health/store/rules";
import type { HealthReport } from "@/lib/health/types";
import { errorMessage, log } from "@/lib/log";

export interface RefreshCandidate {
  id: number;
  fullName: string;
  intendedUse: string;
  packageEcosystem: "npm" | "pypi" | null;
  packageName: string | null;
  sponsorshipOrBacking: "company-backed" | "foundation-backed" | "individual" | "unknown";
}

/** Everything a refresh touches, injected so the orchestration is testable without a database. */
export interface HealthDeps {
  now(): Date;
  github(): GithubClient;
  http: HttpDeps;
  model: JsonModel | null;
  narrativeCache: NarrativeCache;
  listCandidates(): Promise<RefreshCandidate[]>;
  hasSnapshotForWeek(candidateId: number, isoWeek: string): Promise<boolean>;
  saveSnapshot(v: SnapshotInput): Promise<{ current: boolean; note: string | null }>;
  startRun(v: { id: string; trigger: RunTrigger; isoWeek: string; status: "running"; progressJson: RunProgress }): Promise<void>;
  updateRun(id: string, v: Record<string, unknown>): Promise<void>;
  getRun(id: string): Promise<{ id: string; isoWeek: string; progressJson: unknown; status: string } | null>;
  collect?: typeof collectMetrics;
}

export type RunTrigger = "cron" | "admin_all" | "admin_one" | "continue";
export interface RunProgress {
  done: number[];
  results: Record<string, { verdict: string; score: number | null; coverage: number; current: boolean; note: string | null; error?: string }>;
}

export interface SnapshotInput {
  candidateId: number;
  isoWeek: string;
  capturedAt: Date;
  configVersion: string;
  rawMetricsJson: unknown;
  dimensionScoresJson: unknown;
  overallScore: number | null;
  weightCoverage: number;
  verdict: HealthReport["verdict"];
  reasonsJson: unknown;
  gatesJson: unknown;
  narrativeJson: unknown;
  aiStatus: "ok" | "fallback" | "skipped";
  inputHash: string;
  sourceStatusJson: unknown;
  linksJson: unknown;
  forced: boolean;
}

/** Collect → score → narrate → store, for one candidate. */
export async function refreshOne(deps: HealthDeps, c: RefreshCandidate, opts: { runId: string; isoWeek: string; force: boolean; github: GithubRun; cache: RunCache }) {
  const t0 = Date.now();
  const collect = deps.collect ?? collectMetrics;
  const got: Collected = await collect(
    { fullName: c.fullName, packageEcosystem: c.packageEcosystem, packageName: c.packageName, sponsorship: c.sponsorshipOrBacking },
    { run: opts.github, http: deps.http, cache: opts.cache, now: deps.now() },
  );
  const report = evaluate(got.metrics);
  const { input, missing, sampled } = narrativeInputFor(c.fullName, c.intendedUse, report, got.metrics);
  const inputHash = narrativeInputHash(input);
  const n = await narrate({ model: deps.model, cache: deps.narrativeCache, candidateId: c.id, input, inputHash, missing, sampled });
  const saved = await deps.saveSnapshot({
    candidateId: c.id,
    isoWeek: opts.isoWeek,
    capturedAt: deps.now(),
    configVersion: HEALTH_CONFIG_VERSION,
    rawMetricsJson: got.metrics,
    dimensionScoresJson: report.dimensions,
    overallScore: report.overallScore,
    weightCoverage: report.weightCoverage,
    verdict: report.verdict,
    reasonsJson: report.reasons,
    gatesJson: report.gates,
    narrativeJson: { ...n.narrative, error: n.error },
    aiStatus: n.aiStatus,
    inputHash,
    sourceStatusJson: got.sources,
    linksJson: got.links,
    forced: opts.force,
  });
  for (const [source, st] of Object.entries(got.sources)) log.info("health.source", { run_id: opts.runId, candidate: c.fullName, source, status: st?.state, reason: st?.reason ?? undefined });
  log.info("health.candidate", { run_id: opts.runId, candidate: c.fullName, verdict: report.verdict, score: report.overallScore, coverage: report.weightCoverage, ai_status: n.aiStatus, duration_ms: Date.now() - t0, current: saved.current });
  return { report, saved, aiStatus: n.aiStatus };
}

/**
 * Refresh candidates within a time budget. Progress is recorded in
 * health_runs.progress_json, so a run that does not finish is resumed by a
 * follow-up invocation ("continue") from where it stopped.
 */
export async function refreshAll(
  deps: HealthDeps,
  opts: { trigger: RunTrigger; force?: boolean; onlyIds?: number[]; continueRunId?: string; budgetMs?: number },
): Promise<{ runId: string; status: "ok" | "partial" | "failed" | "continue"; isoWeek: string; progress: RunProgress; remaining: number }> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 230_000;
  let runId: string = randomUUID();
  let isoWeek = isoWeekOf(deps.now());
  let progress: RunProgress = { done: [], results: {} };

  if (opts.continueRunId) {
    const prev = await deps.getRun(opts.continueRunId);
    if (!prev || prev.status !== "running") return { runId: opts.continueRunId, status: "failed", isoWeek, progress, remaining: 0 };
    runId = prev.id;
    isoWeek = prev.isoWeek;
    progress = (prev.progressJson as RunProgress) ?? progress;
  } else {
    await deps.startRun({ id: runId, trigger: opts.trigger, isoWeek, status: "running", progressJson: progress });
  }

  try {
    let candidates = await deps.listCandidates();
    if (opts.onlyIds) candidates = candidates.filter((c) => opts.onlyIds!.includes(c.id));
    const todo = candidates.filter((c) => !progress.done.includes(c.id));
    const github = new GithubRun(deps.github());
    const cache = new RunCache();
    let remaining = todo.length;
    for (const c of todo) {
      if (Date.now() - started > budget) break;
      if (!shouldRefresh(await deps.hasSnapshotForWeek(c.id, isoWeek), Boolean(opts.force))) {
        progress.results[c.fullName] = { verdict: "unchanged", score: null, coverage: 0, current: true, note: "Already refreshed this ISO week" };
      } else {
        try {
          const r = await refreshOne(deps, c, { runId, isoWeek, force: Boolean(opts.force), github, cache });
          progress.results[c.fullName] = { verdict: r.report.verdict, score: r.report.overallScore, coverage: r.report.weightCoverage, current: r.saved.current, note: r.saved.note };
        } catch (err) {
          progress.results[c.fullName] = { verdict: "error", score: null, coverage: 0, current: false, note: null, error: errorMessage(err) };
          log.error("health.candidate_failed", { run_id: runId, candidate: c.fullName, error: errorMessage(err) });
        }
      }
      progress.done.push(c.id);
      remaining--;
      await deps.updateRun(runId, { progressJson: progress });
    }
    if (remaining > 0) {
      await deps.updateRun(runId, { progressJson: progress, error: `${remaining} candidates left; continuing in a new invocation.` });
      return { runId, status: "continue", isoWeek, progress, remaining };
    }
    const failed = Object.values(progress.results).filter((r) => r.verdict === "error").length;
    const status = failed === 0 ? "ok" : failed < Object.keys(progress.results).length ? "partial" : "failed";
    const counts = Object.values(progress.results).reduce<Record<string, number>>((a, r) => ((a[r.verdict] = (a[r.verdict] ?? 0) + 1), a), {});
    await deps.updateRun(runId, { status, finishedAt: deps.now(), countsJson: counts, progressJson: progress, error: failed ? `${failed} candidates failed` : null });
    return { runId, status, isoWeek, progress, remaining: 0 };
  } catch (err) {
    await deps.updateRun(runId, { status: "failed", finishedAt: deps.now(), error: errorMessage(err) }).catch(() => undefined);
    return { runId, status: "failed", isoWeek, progress, remaining: 0 };
  }
}
