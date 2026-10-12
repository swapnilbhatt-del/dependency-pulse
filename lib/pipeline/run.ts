import { randomUUID } from "node:crypto";
import { classifyReleases, type ClassificationCache, type ClassifyJob } from "@/lib/ai/classify";
import { synthesizeDigest, type JsonModel } from "@/lib/ai/gemini";
import { applyGuardrails, isSynthesisGrounded } from "@/lib/ai/guardrails";
import { DISPLAY_CAP_PER_REPO, INVOCATION_BUDGET_MS } from "@/lib/config";
import { buildDigest } from "@/lib/digest/build";
import type { ClassifiedRelease, DigestModel, RepoOutcome } from "@/lib/digest/model";
import { renderEmailHtml } from "@/lib/digest/render-email";
import { renderEmailText } from "@/lib/digest/render-text";
import { TIER_LABEL } from "@/lib/digest/tiers";
import type { DeliveryAttempt, EmailProvider } from "@/lib/delivery/email";
import { deliverToAll } from "@/lib/delivery/email";
import { classifyAgainstHistory, releaseKey } from "@/lib/filter/filter";
import { computeWindow, isoWeek as isoWeekOf, mondayOf, scheduledRunTime } from "@/lib/filter/window";
import type { RepoIngestResult } from "@/lib/github/ingest";
import { errorMessage, log } from "@/lib/log";
import { prescreen } from "@/lib/signals/keywords";
import type { RepoRef, RepoStatus, TimeWindow } from "@/lib/types";

export type Trigger = "cron" | "preview" | "send" | "continue";

/** Everything the pipeline touches, injected so the orchestration is testable without a database. */
export interface PipelineDeps {
  now(): Date;
  baseUrl: string;
  timezoneLabel: string;
  model: JsonModel | null;
  classificationCache: ClassificationCache;
  listEnabledRepos(): Promise<RepoRef[]>;
  ingest(repos: RepoRef[], window: TimeWindow, runId: string): Promise<RepoIngestResult[]>;
  recordRepoStatuses(results: { id: number; status: RepoStatus; error: string | null }[], at: Date): Promise<void>;
  upsertReleases(rels: RepoIngestResult["releases"][number]["release"][]): Promise<Map<string, number>>;
  previouslyReported(repoIds: number[], excludeIsoWeek: string): Promise<Map<string, string>>;
  claimWeek(
    isoWeek: string,
    window: TimeWindow,
    trigger: string,
    opts: { force: boolean; leaseMs: number },
  ): Promise<{ ok: true; row: { id: number; windowEnd: Date } } | { ok: false; reason: "already_sent" | "in_progress"; row: { id: number } }>;
  getWeek(isoWeek: string): Promise<{ id: number; windowStart: Date; windowEnd: Date; html: string | null; text: string | null; subject: string | null; deliveredAt: Date | null } | null>;
  saveDigest(
    id: number,
    d: { model: DigestModel; html: string; text: string; status: "ok" | "partial" | "failed"; error: string | null },
    items: { releaseId: number; repoId: number; tagName: string; bodyHash: string; tier: number }[],
  ): Promise<void>;
  markDelivery(id: number, status: "sent" | "partial" | "failed", error: string | null): Promise<void>;
  recordDeliveries(id: number, provider: string, attempts: DeliveryAttempt[]): Promise<void>;
  releaseLease(id: number): Promise<void>;
  failDigestRun(id: number, error: string): Promise<void>;
  startPipelineRun(v: Record<string, unknown> & { id: string; isoWeek: string; trigger: Trigger | "resend"; status: string }): Promise<void>;
  updatePipelineRun(id: string, v: Record<string, unknown>): Promise<void>;
  recipients(): Promise<string[]>;
  emailProvider(): EmailProvider;
  sleep?(ms: number): Promise<void>;
}

export interface RunOptions {
  trigger: Trigger;
  /** Regenerate and re-send even if this week was already delivered (admin only). */
  force?: boolean;
  /** For "continue": the ISO week being resumed. */
  isoWeek?: string;
  budgetMs?: number;
}

export type RunResult =
  | { status: "sent" | "partial" | "failed"; runId: string; isoWeek: string; counts?: DigestModel["counts"]; error?: string }
  | { status: "preview"; runId: string; isoWeek: string; model: DigestModel }
  | { status: "skipped"; runId: string; isoWeek: string; reason: "already_sent" | "in_progress" | "nothing_to_continue" }
  | { status: "continue"; runId: string; isoWeek: string; pending: number };

const LEASE_MS = 6 * 60_000;
/** Time reserved after classification for synthesis, rendering, saving and sending. */
const TAIL_RESERVE_MS = 45_000;

function needsAiFlags(results: RepoIngestResult[]): Set<object> {
  const set = new Set<object>();
  for (const r of results) {
    const sorted = [...r.releases].sort((a, b) => b.release.publishedAt.getTime() - a.release.publishedAt.getTime());
    sorted.forEach((x, idx) => {
      const p = prescreen(x.release.name, x.release.body);
      if (idx < DISPLAY_CAP_PER_REPO || p.security.length || p.breaking.length || x.majorBump || x.advisories.length) set.add(x);
    });
  }
  return set;
}

export async function runWeeklyDigest(deps: PipelineDeps, opts: RunOptions): Promise<RunResult> {
  const started = Date.now();
  const budget = opts.budgetMs ?? INVOCATION_BUDGET_MS;
  const deadline = started + budget - TAIL_RESERVE_MS;
  const runId = randomUUID();
  const now = deps.now();

  // ── Window ────────────────────────────────────────────────────────────────
  let runTime: Date;
  let weekLabel: string;
  if (opts.trigger === "continue") {
    const row = opts.isoWeek ? await deps.getWeek(opts.isoWeek) : null;
    if (!row || row.deliveredAt) return { status: "skipped", runId, isoWeek: opts.isoWeek ?? "", reason: "nothing_to_continue" };
    runTime = row.windowEnd;
    weekLabel = opts.isoWeek!;
  } else {
    runTime = opts.trigger === "cron" ? scheduledRunTime(now) : now;
    weekLabel = isoWeekOf(runTime);
  }
  const window = computeWindow(runTime);
  const weekOf = mondayOf(runTime);
  const preview = opts.trigger === "preview";

  // ── Idempotency (not for previews) ─────────────────────────────────────────
  let digestRunId: number | null = null;
  if (!preview) {
    const claim = await deps.claimWeek(weekLabel, window, opts.trigger, { force: Boolean(opts.force), leaseMs: LEASE_MS });
    if (!claim.ok) {
      await deps.startPipelineRun({ id: runId, isoWeek: weekLabel, trigger: opts.trigger, status: "skipped", note: claim.reason, finishedAt: new Date(), durationMs: 0, digestRunId: claim.row.id });
      log.info("pipeline.skipped", { run_id: runId, iso_week: weekLabel, reason: claim.reason });
      return { status: "skipped", runId, isoWeek: weekLabel, reason: claim.reason };
    }
    digestRunId = claim.row.id;
  }

  await deps.startPipelineRun({ id: runId, isoWeek: weekLabel, trigger: opts.trigger, status: "running", phase: "ingest", windowStart: window.start, windowEnd: window.end, digestRunId });
  log.info("pipeline.start", { run_id: runId, iso_week: weekLabel, trigger: opts.trigger, window_start: window.start.toISOString(), window_end: window.end.toISOString() });

  try {
    // ── Ingestion ──────────────────────────────────────────────────────────
    const repos = await deps.listEnabledRepos();
    const ingested = await deps.ingest(repos, window, runId);
    await deps.recordRepoStatuses(ingested.map((r) => ({ id: r.repo.id, status: r.status, error: r.error })), deps.now());
    const all = ingested.flatMap((r) => r.releases);
    const ids = await deps.upsertReleases(all.map((x) => x.release));
    const prev = await deps.previouslyReported(repos.map((r) => r.id), weekLabel);

    // ── Classification ─────────────────────────────────────────────────────
    await deps.updatePipelineRun(runId, { phase: "classify" });
    const aiSet = needsAiFlags(ingested);
    const jobs: ClassifyJob[] = all
      .map((x) => ({ releaseId: ids.get(releaseKey(x.release)) ?? -1, release: x.release, needsAi: aiSet.has(x) }))
      .filter((j) => j.releaseId > 0);
    const { results: cls, stats } = await classifyReleases({ model: deps.model, cache: deps.classificationCache, jobs, deadline: preview ? Number.POSITIVE_INFINITY : deadline });

    if (stats.pending > 0 && !preview && digestRunId !== null) {
      await deps.releaseLease(digestRunId);
      await deps.updatePipelineRun(runId, {
        status: "ok",
        phase: "continue",
        finishedAt: new Date(),
        durationMs: Date.now() - started,
        aiCalls: stats.calls,
        aiCacheHits: stats.cacheHits,
        aiFallbacks: stats.fallbacks,
        tokensIn: stats.tokensIn,
        tokensOut: stats.tokensOut,
        note: `${stats.pending} releases left to classify; continuing in a new invocation.`,
      });
      log.info("pipeline.continue", { run_id: runId, pending: stats.pending });
      return { status: "continue", runId, isoWeek: weekLabel, pending: stats.pending };
    }

    // ── Guardrails + digest ────────────────────────────────────────────────
    await deps.updatePipelineRun(runId, { phase: "build" });
    const byRepo = new Map(ingested.map((r) => [r.repo.id, r]));
    const classified: ClassifiedRelease[] = [];
    for (const x of all) {
      const id = ids.get(releaseKey(x.release));
      const c = id ? cls.get(id) : undefined;
      if (!id || !c) continue;
      classified.push({
        release: x.release,
        repo: byRepo.get(x.release.repoId)!.repo,
        advisories: x.advisories,
        history: classifyAgainstHistory(x.release, prev),
        classification: applyGuardrails(c.analysis, c.aiStatus, {
          title: x.release.name,
          tagName: x.release.tagName,
          body: x.release.body,
          notesAvailable: x.release.notesAvailable,
          prescreen: prescreen(x.release.name, x.release.body),
          advisories: x.advisories,
          majorBump: x.majorBump,
        }),
      });
    }
    const outcomes: RepoOutcome[] = ingested.map((r) => ({ repo: r.repo, status: r.status, error: r.error, releaseCount: r.releases.length, usedTagFallback: r.usedTagFallback }));
    const model = buildDigest({
      isoWeek: weekLabel,
      weekOf,
      window,
      generatedAt: deps.now(),
      timezoneLabel: deps.timezoneLabel,
      baseUrl: deps.baseUrl,
      releases: classified,
      repoOutcomes: outcomes,
      advisoryOnly: ingested.flatMap((r) => r.unmatchedAdvisories.map((advisory) => ({ repo: r.repo, advisory }))),
      aiFallbacks: stats.fallbacks,
      aiUnavailable: stats.aiUnavailable || (!deps.model && classified.some((c) => c.release.notesAvailable)),
    });

    // Task 2: grounded weekly synthesis (optional; deterministic paragraph otherwise).
    let tokensIn = stats.tokensIn;
    let tokensOut = stats.tokensOut;
    const flagged = [...model.act, ...model.review, ...model.updated];
    if (deps.model && !stats.aiUnavailable && model.counts.releasesFound > 0) {
      // One entry per repository (its most important item), so the summary does not repeat itself.
      const seenRepos = new Set<string>();
      const perRepo = [...flagged, ...model.fyi.flatMap((g) => g.items)].filter((i) => !seenRepos.has(i.repo) && Boolean(seenRepos.add(i.repo)));
      const synthItems = perRepo.slice(0, 20).map((i) => ({
        repo: i.repo,
        tag: i.tag,
        tier: TIER_LABEL[i.tier],
        summary: i.summary,
        why: i.whyFlagged,
        next_step: i.nextStep,
      }));
      const counts = { act_now: model.counts.act, review: model.counts.review, fyi: model.counts.fyi, repos_checked: model.counts.reposChecked, releases: model.counts.releasesFound, could_not_check: model.counts.couldNotCheck };
      const s = await synthesizeDigest(deps.model, counts, synthItems);
      tokensIn += s.usage.input;
      tokensOut += s.usage.output;
      const inputJson = JSON.stringify({ counts, synthItems, advisories: model.advisories });
      if (s.synthesis && isSynthesisGrounded(s.synthesis.at_a_glance, inputJson) && s.synthesis.action_items.every((a) => isSynthesisGrounded(a, inputJson))) {
        model.synthesis = { paragraph: s.synthesis.at_a_glance, actions: s.synthesis.action_items, source: "ai" };
      } else {
        log.warn("synthesis.rejected", { run_id: runId, reason: s.synthesis ? "not grounded" : "error" in s ? s.error : "unknown" });
      }
    }

    const html = renderEmailHtml(model);
    const text = renderEmailText(model);
    const digestStatus: "ok" | "partial" = model.counts.couldNotCheck > 0 || stats.aiUnavailable ? "partial" : "ok";
    const repoResults = ingested.map((r) => ({ repo: r.repo.fullName, status: r.status, error: r.error, releases: r.releases.length, tagFallback: r.usedTagFallback, warnings: r.warnings, durationMs: r.durationMs }));
    const common = {
      countsJson: model.counts,
      repoResultsJson: repoResults,
      errorsJson: stats.errors.slice(0, 50),
      aiCalls: stats.calls,
      aiCacheHits: stats.cacheHits,
      aiFallbacks: stats.fallbacks,
      tokensIn,
      tokensOut,
    };

    if (preview) {
      await deps.updatePipelineRun(runId, { ...common, status: digestStatus, phase: "done", previewModelJson: model, finishedAt: new Date(), durationMs: Date.now() - started });
      log.info("pipeline.preview_done", { run_id: runId, duration_ms: Date.now() - started });
      return { status: "preview", runId, isoWeek: weekLabel, model };
    }

    const items = classified
      .filter((c) => c.history !== "already_reported")
      .map((c) => ({ releaseId: ids.get(releaseKey(c.release))!, repoId: c.repo.id, tagName: c.release.tagName, bodyHash: c.release.bodyHash, tier: 0 }))
      .map((it) => ({ ...it, tier: [...model.act, ...model.review, ...model.updated, ...model.fyi.flatMap((g) => g.items)].find((i) => i.id === `${it.repoId}:${it.tagName}`)?.tier ?? 3 }));
    await deps.saveDigest(digestRunId!, { model, html, text, status: digestStatus, error: null }, items);

    // ── Delivery ───────────────────────────────────────────────────────────
    await deps.updatePipelineRun(runId, { phase: "deliver" });
    const delivery = await deliver(deps, digestRunId!, weekLabel, { subject: model.subject, html, text }, opts.force ? `${weekLabel}:forced:${runId}` : `${weekLabel}:weekly`);
    const finalStatus = delivery.status === "sent" ? digestStatus : delivery.status === "partial" ? "partial" : "failed";
    await deps.updatePipelineRun(runId, {
      ...common,
      status: finalStatus,
      phase: "done",
      finishedAt: new Date(),
      durationMs: Date.now() - started,
      note: delivery.error ?? `Sent to ${delivery.sent} of ${delivery.total} recipients.`,
    });
    log.info("pipeline.done", { run_id: runId, status: finalStatus, duration_ms: Date.now() - started, sent: delivery.sent });
    return { status: delivery.status, runId, isoWeek: weekLabel, counts: model.counts, error: delivery.error ?? undefined };
  } catch (err) {
    const msg = errorMessage(err);
    log.error("pipeline.failed", { run_id: runId, error: msg });
    if (digestRunId !== null) await deps.failDigestRun(digestRunId, msg).catch(() => undefined);
    await deps.updatePipelineRun(runId, { status: "failed", phase: "failed", finishedAt: new Date(), durationMs: Date.now() - started, errorsJson: [msg] }).catch(() => undefined);
    return { status: "failed", runId, isoWeek: weekLabel, error: msg };
  }
}

async function deliver(
  deps: PipelineDeps,
  digestRunId: number,
  isoWeek: string,
  message: { subject: string; html: string; text: string },
  keyPrefix: string,
): Promise<{ status: "sent" | "partial" | "failed"; sent: number; total: number; error: string | null }> {
  const recipients = await deps.recipients();
  if (!recipients.length) {
    const error = "No recipients configured. Add one under Admin → Recipients or set DIGEST_RECIPIENTS.";
    await deps.markDelivery(digestRunId, "failed", error);
    return { status: "failed", sent: 0, total: 0, error };
  }
  let provider: EmailProvider;
  try {
    provider = deps.emailProvider();
  } catch (err) {
    const error = errorMessage(err);
    await deps.markDelivery(digestRunId, "failed", error);
    return { status: "failed", sent: 0, total: recipients.length, error };
  }
  const attempts = await deliverToAll(provider, recipients, message, keyPrefix, deps.sleep);
  await deps.recordDeliveries(digestRunId, provider.name, attempts);
  const sent = attempts.filter((a) => a.status === "sent").length;
  const status = sent === attempts.length ? "sent" : sent > 0 ? "partial" : "failed";
  const error = status === "sent" ? null : `Delivery failed for ${attempts.length - sent} of ${attempts.length} recipients: ${attempts.find((a) => a.error)?.error ?? "unknown error"}`;
  await deps.markDelivery(digestRunId, status, error);
  log.info("delivery.done", { iso_week: isoWeek, status, sent, total: attempts.length });
  return { status, sent, total: attempts.length, error };
}

/** Admin "Resend": re-sends the stored digest for a week without regenerating it. */
export async function resendStoredDigest(deps: PipelineDeps, isoWeek: string): Promise<RunResult> {
  const runId = randomUUID();
  const row = await deps.getWeek(isoWeek);
  if (!row || !row.html || !row.text || !row.subject) {
    return { status: "failed", runId, isoWeek, error: "No stored digest for that week. Run “Send digest now” first." };
  }
  const started = Date.now();
  await deps.startPipelineRun({ id: runId, isoWeek, trigger: "resend", status: "running", phase: "deliver", digestRunId: row.id });
  const delivery = await deliver(deps, row.id, isoWeek, { subject: row.subject, html: row.html, text: row.text }, `${isoWeek}:resend:${runId}`);
  await deps.updatePipelineRun(runId, {
    status: delivery.status === "sent" ? "ok" : delivery.status,
    phase: "done",
    finishedAt: new Date(),
    durationMs: Date.now() - started,
    note: delivery.error ?? `Resent to ${delivery.sent} of ${delivery.total} recipients.`,
  });
  return { status: delivery.status, runId, isoWeek, error: delivery.error ?? undefined };
}
