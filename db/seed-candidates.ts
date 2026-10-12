import "dotenv/config";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Seeds EXAMPLE evaluation candidates (is_example = true): real repositories
 * with hypothetical intended uses for a fintech team, so the Adoption Check
 * pages have content until the team adds its own list. Several are natural
 * pairs to compare (money math, payments SDKs, IBAN validation).
 * Idempotent; each repo is verified on GitHub first. Replace them in /admin/evaluate.
 */
const EXAMPLES = [
  { fullName: "panva/jose", eco: "npm" as const, pkg: "jose", use: "Example: JWT verification for the Node API" },
  { fullName: "hokaccha/node-jwt-simple", eco: "npm" as const, pkg: "jwt-simple", use: "Example: lighter alternative for JWT verification" },
  { fullName: "square/square-nodejs-sdk", eco: "npm" as const, pkg: "square", use: "Example: card payments for the India checkout" },
  { fullName: "stripe/stripe-node", eco: "npm" as const, pkg: "stripe", use: "Example: card payments for international customers (compare with Square)" },
  { fullName: "dinerojs/dinero.js", eco: "npm" as const, pkg: "dinero.js", use: "Example: money arithmetic for ledger balances and fees" },
  { fullName: "MikeMcl/big.js", eco: "npm" as const, pkg: "big.js", use: "Example: decimal math for interest and FX (compare with dinero.js)" },
  { fullName: "colinhacks/zod", eco: "npm" as const, pkg: "zod", use: "Example: validate incoming webhook payloads from payment providers" },
  { fullName: "taskforcesh/bullmq", eco: "npm" as const, pkg: "bullmq", use: "Example: retryable job queue for payout batches" },
  { fullName: "foliojs/pdfkit", eco: "npm" as const, pkg: "pdfkit", use: "Example: monthly account statements as PDF" },
  { fullName: "better-auth/better-auth", eco: "npm" as const, pkg: "better-auth", use: "Example: customer login with passkeys and two-factor auth" },
  { fullName: "pydantic/pydantic", eco: "pypi" as const, pkg: "pydantic", use: "Example: schema validation in the Python risk-scoring service" },
  { fullName: "arthurdejong/python-stdnum", eco: "pypi" as const, pkg: "python-stdnum", use: "Example: validate IBAN, PAN and GSTIN numbers during onboarding" },
  { fullName: "mdomke/schwifty", eco: "pypi" as const, pkg: "schwifty", use: "Example: IBAN and BIC validation (compare with python-stdnum)" },
  { fullName: "py-moneyed/py-moneyed", eco: "pypi" as const, pkg: "py-moneyed", use: "Example: currency-aware amounts in reconciliation scripts" },
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
