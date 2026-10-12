/**
 * Phase 6 live check: run the full pipeline in preview mode against live
 * GitHub data and the configured database, and write the rendered digest to
 * out-preview/ for inspection. Sends nothing.
 * Usage: pnpm preview:digest
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { renderEmailHtml } from "@/lib/digest/render-email";
import { renderEmailText } from "@/lib/digest/render-text";
import { productionDeps } from "@/lib/pipeline/deps";
import { runWeeklyDigest } from "@/lib/pipeline/run";

async function main() {
  const started = Date.now();
  const r = await runWeeklyDigest(productionDeps(), { trigger: "preview" });
  if (r.status !== "preview") throw new Error(`Preview did not complete: ${JSON.stringify(r)}`);
  mkdirSync("out-preview", { recursive: true });
  writeFileSync("out-preview/digest.html", renderEmailHtml(r.model));
  writeFileSync("out-preview/digest.txt", renderEmailText(r.model));
  writeFileSync("out-preview/model.json", JSON.stringify(r.model, null, 2));
  console.log(`Preview ${r.runId} for ${r.isoWeek} in ${Math.round((Date.now() - started) / 1000)} s`);
  console.log(`Subject: ${r.model.subject}`);
  console.log(`Status:  ${r.model.statusLine}`);
  console.log(`Counts:  ${JSON.stringify(r.model.counts)}`);
  for (const i of [...r.model.act, ...r.model.review]) console.log(`  [${i.tier === 1 ? "ACT" : "REVIEW"}] ${i.repo} ${i.tag}: ${i.whyFlagged}`);
  console.log("Wrote out-preview/digest.html, digest.txt, model.json");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
