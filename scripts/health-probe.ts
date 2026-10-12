/**
 * Live probe: collect metrics and score one candidate without touching the database.
 * Usage: pnpm health:probe owner/name [npm|pypi] [package]
 */
import "dotenv/config";
import { GithubClient } from "@/lib/github/client";
import { collectMetrics } from "@/lib/health/collect";
import { evaluate } from "@/lib/health/score";
import { GithubRun } from "@/lib/health/sources/github";
import { RunCache } from "@/lib/health/sources/http";

async function main() {
  const [fullName, eco, pkg] = process.argv.slice(2);
  const gh = new GithubClient({ token: process.env.GITHUB_TOKEN ?? "" });
  const run = new GithubRun(gh);
  const cache = new RunCache();
  const t0 = Date.now();
  const c = await collectMetrics({ fullName, packageEcosystem: (eco as "npm" | "pypi") ?? null, packageName: pkg ?? null, sponsorship: "unknown" }, { run, http: {}, cache, now: new Date() });
  const r = evaluate(c.metrics);
  console.log(JSON.stringify({ fullName: c.canonicalName, ms: Date.now() - t0, githubRequests: gh.requests, publicFetches: cache.fetched.length, sources: c.sources, verdict: r.verdict, score: r.overallScore, coverage: r.weightCoverage, dims: Object.fromEntries(Object.entries(r.dimensions).map(([k, v]) => [k, `${v.score ?? "—"} ${v.status}${v.note ? ` (${v.note})` : ""}`])), reasons: r.reasons.map((x) => `[${x.tag}] ${x.text}`) }, null, 2));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
