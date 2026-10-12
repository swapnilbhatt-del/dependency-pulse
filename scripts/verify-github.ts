/**
 * Phase 3 live check: one real ingestion against GitHub (default stripe/stripe-node).
 * Usage: pnpm verify:github [owner/name]
 */
import "dotenv/config";
import { computeWindow } from "@/lib/filter/window";
import { GithubClient } from "@/lib/github/client";
import { ingestRepo } from "@/lib/github/ingest";

async function main() {
  const fullName = process.argv[2] ?? "stripe/stripe-node";
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set in .env");
  const gh = new GithubClient({ token });
  const window = computeWindow(new Date());
  const [owner, name] = fullName.split("/");
  const res = await ingestRepo(gh, { id: 0, owner, name, fullName, category: "check", priority: "normal", enabled: true }, window);
  console.log(`Window (UTC): ${window.start.toISOString()} → ${window.end.toISOString()}`);
  console.log(`${fullName}: status=${res.status}${res.error ? ` (${res.error})` : ""}, tag fallback=${res.usedTagFallback}, ${res.durationMs} ms, ${gh.requests} requests`);
  console.log(`Rate limit remaining: ${gh.rate.remaining}/${gh.rate.limit}`);
  for (const r of res.releases) {
    console.log(`  - ${r.release.tagName}  ${r.release.publishedAt.toISOString()}  ${r.release.prerelease ? "[pre-release] " : ""}${r.majorBump ? `[major ${r.majorBump.from}→${r.majorBump.to}] ` : ""}${r.advisories.map((a) => a.ghsaId).join(",")}  notes=${r.release.body.length} chars`);
  }
  if (!res.releases.length) console.log("  (no releases in the last 7 days)");
  if (res.unmatchedAdvisories.length) console.log(`  advisories without a matching release: ${res.unmatchedAdvisories.map((a) => a.ghsaId).join(", ")}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
