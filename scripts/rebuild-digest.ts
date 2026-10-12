/**
 * Regenerates the current ISO week's published digest with the current rules,
 * without sending email (same as Admin → Runs → "Rebuild page (no email)").
 * Usage: pnpm rebuild:digest
 */
import "dotenv/config";
import { productionDeps } from "@/lib/pipeline/deps";
import { runWeeklyDigest } from "@/lib/pipeline/run";

runWeeklyDigest(productionDeps(), { trigger: "rebuild" })
  .then((r) => {
    console.log(JSON.stringify("model" in r ? { ...r, model: undefined } : r));
    if (r.status !== "rebuilt") process.exit(1);
  })
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
