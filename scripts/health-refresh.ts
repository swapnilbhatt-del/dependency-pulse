/**
 * Manual health refresh (same code path as the cron): refreshes every
 * watchlist candidate (forced) and writes the results to out-health/ for inspection.
 * Usage: pnpm health:refresh
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { healthDeps } from "@/lib/health/deps";
import { refreshAll } from "@/lib/health/refresh";
import * as store from "@/lib/health/store";

async function main() {
  const t0 = Date.now();
  const r = await refreshAll(healthDeps(), { trigger: "admin_all", force: true, budgetMs: 280_000 });
  mkdirSync("out-health", { recursive: true });
  for (const c of await store.listCandidates()) {
    const s = await store.currentSnapshot(c.id);
    writeFileSync(`out-health/${c.slug}.json`, JSON.stringify({ candidate: c.fullName, isoWeek: s?.isoWeek, verdict: s?.verdict, score: s?.overallScore, weightCoverage: s?.weightCoverage, aiStatus: s?.aiStatus, sources: s?.sourceStatusJson, reasons: s?.reasonsJson, dimensions: s?.dimensionScoresJson, narrative: s?.narrativeJson, metrics: s?.rawMetricsJson }, null, 2));
  }
  console.log(JSON.stringify({ status: r.status, runId: r.runId, seconds: Math.round((Date.now() - t0) / 1000), results: r.progress.results }, null, 2));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
