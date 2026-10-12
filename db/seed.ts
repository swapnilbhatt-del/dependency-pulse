import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { SEED_REPOS } from "./seed-repos";

/**
 * Idempotent seed: inserts any seed repo that is not already tracked (by
 * case-insensitive full name), after confirming it exists on GitHub. Re-running
 * never duplicates rows and never touches repos edited in the admin UI.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  const token = process.env.GITHUB_TOKEN;
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (!token) throw new Error("GITHUB_TOKEN is not set (needed to verify each repo exists).");
  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client, { schema });

  let added = 0;
  let skipped = 0;
  const failed: string[] = [];
  for (const r of SEED_REPOS) {
    const res = await fetch(`https://api.github.com/repos/${r.fullName}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "dependency-pulse-seed" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      failed.push(`${r.fullName} (HTTP ${res.status})`);
      continue;
    }
    const info = (await res.json()) as { full_name: string; private: boolean };
    if (info.private) {
      failed.push(`${r.fullName} (private)`);
      continue;
    }
    const canonical = info.full_name;
    const [owner, name] = canonical.split("/");
    const rows = await db
      .insert(schema.repos)
      .values({ owner, name, fullName: canonical, category: r.category, priority: r.priority, notes: r.notes })
      .onConflictDoNothing()
      .returning({ id: schema.repos.id });
    if (rows.length) {
      added++;
      console.log(`  + ${canonical}${canonical !== r.fullName ? ` (was ${r.fullName})` : ""}`);
    } else skipped++;
  }

  const defaults = (process.env.DIGEST_RECIPIENTS ?? "").split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
  for (const email of defaults) await db.insert(schema.recipients).values({ email }).onConflictDoNothing();

  console.log(`Seed complete: ${added} added, ${skipped} already present, ${failed.length} failed verification.`);
  if (defaults.length) console.log(`Recipients ensured from DIGEST_RECIPIENTS: ${defaults.length}.`);
  if (failed.length) console.log(`Not seeded: ${failed.join(", ")}`);
  await client.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
