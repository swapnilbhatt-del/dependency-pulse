import "server-only";
import { createGeminiModel } from "@/lib/ai/gemini";
import { env, geminiModelName } from "@/lib/env";
import { GithubClient } from "@/lib/github/client";
import type { HealthDeps } from "@/lib/health/refresh";
import * as store from "@/lib/health/store";
import { dbHttpCache } from "@/lib/pipeline/store";

/** Production wiring: Postgres, GitHub (live client + ETag cache), public sources, Gemini Flash. */
export function healthDeps(): HealthDeps {
  const key = env("GEMINI_API_KEY");
  return {
    now: () => new Date(),
    github: () => new GithubClient({ token: env("GITHUB_TOKEN") ?? "", cache: dbHttpCache }),
    http: {},
    model: key ? createGeminiModel({ apiKey: key, model: geminiModelName() }) : null,
    narrativeCache: store.dbNarrativeCache,
    listCandidates: async () => (await store.listCandidates()).map((c) => ({ id: c.id, fullName: c.fullName, intendedUse: c.intendedUse, packageEcosystem: c.packageEcosystem ?? null, packageName: c.packageName, sponsorshipOrBacking: c.sponsorshipOrBacking })),
    hasSnapshotForWeek: async (id, week) => (await store.snapshotForWeek(id, week)) !== null,
    saveSnapshot: (v) => store.saveSnapshot(v),
    startRun: (v) => store.startHealthRun(v),
    updateRun: (id, v) => store.updateHealthRun(id, v),
    getRun: (id) => store.getHealthRun(id),
  };
}
