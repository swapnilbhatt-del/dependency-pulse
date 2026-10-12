import "server-only";
import { createGeminiModel, type JsonModel } from "@/lib/ai/gemini";
import { createResendProvider } from "@/lib/delivery/email";
import { effectiveRecipients } from "@/lib/delivery/recipients";
import { appBaseUrl, env, geminiModelName, timezoneLabel } from "@/lib/env";
import { GithubClient } from "@/lib/github/client";
import { ingestAll } from "@/lib/github/ingest";
import { errorMessage, log } from "@/lib/log";
import type { PipelineDeps } from "@/lib/pipeline/run";
import * as store from "@/lib/pipeline/store";
import { listEnabledRepos, recordRepoStatuses } from "@/lib/repos/service";

function model(): JsonModel | null {
  const key = env("GEMINI_API_KEY");
  if (!key) {
    log.warn("gemini.not_configured", {});
    return null;
  }
  try {
    return createGeminiModel({ apiKey: key, model: geminiModelName() });
  } catch (err) {
    log.error("gemini.init_failed", { error: errorMessage(err) });
    return null;
  }
}

/** Production wiring of the pipeline: Postgres, GitHub, Gemini, Resend. */
export function productionDeps(): PipelineDeps {
  return {
    now: () => new Date(),
    baseUrl: appBaseUrl(),
    timezoneLabel: timezoneLabel(),
    model: model(),
    classificationCache: store.dbClassificationCache,
    listEnabledRepos,
    ingest: (repos, window, runId) => ingestAll(new GithubClient({ token: env("GITHUB_TOKEN") ?? "", cache: store.dbHttpCache, runId }), repos, window, runId),
    recordRepoStatuses,
    upsertReleases: store.upsertReleases,
    previouslyReported: store.previouslyReported,
    claimWeek: store.claimWeek,
    getWeek: store.getDigestRun,
    saveDigest: store.saveDigest,
    markDelivery: store.markDelivery,
    recordDeliveries: store.recordDeliveries,
    releaseLease: store.releaseLease,
    failDigestRun: store.failDigestRun,
    startPipelineRun: (v) => store.startPipelineRun(v as Parameters<typeof store.startPipelineRun>[0]),
    updatePipelineRun: (id, v) => store.updatePipelineRun(id, v as Parameters<typeof store.updatePipelineRun>[1]),
    recipients: async () => (await effectiveRecipients()).emails,
    emailProvider: () => createResendProvider(env("RESEND_API_KEY"), env("EMAIL_FROM")),
  };
}
