import "dotenv/config";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Seeds three EXAMPLE evaluation candidates (is_example = true) so the
 * Adoption Check pages have content until the team adds its own list.
 * Idempotent; each repo is verified on GitHub first. Replace them in /admin/evaluate.
 */
const EXAMPLES = [
  { fullName: "panva/jose", eco: "npm" as const, pkg: "jose", use: "Example: JWT verification for the Node API" },
  { fullName: "hokaccha/node-jwt-simple", eco: "npm" as const, pkg: "jwt-simple", use: "Example: lighter alternative for JWT verification" },
  { fullName: "square/square-nodejs-sdk", eco: "npm" as const, pkg: "square", use: "Example: card payments for the India checkout" },
];

async function main() {
  const url = process.env.DATABASE_URL;
  const token = process.env.GITHUB_TOKEN;
  if (!url || !token) throw new Error("DATABASE_URL and GITHUB_TOKEN must be set.");
  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client, { schema });
  for (const e of EXAMPLES) {
    const res = await fetch(`https://api.github.com/repos/${e.fullName}`, { headers: { Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "dependency-pulse-seed" } });
    if (!res.ok) {
      console.log(`  skip ${e.fullName} (HTTP ${res.status})`);
      continue;
    }
    const canonical = ((await res.json()) as { full_name: string }).full_name;
    const [owner, name] = canonical.split("/");
    const exists = await db.select({ id: schema.evaluationCandidates.id }).from(schema.evaluationCandidates).where(sql`lower(${schema.evaluationCandidates.fullName}) = lower(${canonical})`);
    if (exists.length) {
      console.log(`  = ${canonical} (already present)`);
      continue;
    }
    await db.insert(schema.evaluationCandidates).values({ owner, name, fullName: canonical, slug: canonical.toLowerCase().replace(/[^a-z0-9._-]+/g, "--"), packageEcosystem: e.eco, packageName: e.pkg, intendedUse: e.use, isExample: true });
    console.log(`  + ${canonical} (example)`);
  }
  await client.end();
}
main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
