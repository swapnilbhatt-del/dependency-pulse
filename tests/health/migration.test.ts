/**
 * Rehearses the production migration on a disposable Postgres (PGlite):
 * build the schema exactly as production has it today (0000 only), load
 * digest data, apply 0001_adoption_check, and prove nothing existing changed.
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";

const SQL = readFileSync("db/migrations/0001_adoption_check.sql", "utf8");
const EXISTING = ["repos", "releases", "classifications", "digest_runs", "digest_items", "digest_deliveries", "recipients", "admin_audit_log", "pipeline_runs", "http_cache", "login_attempts"];

describe("0001_adoption_check is additive only", () => {
  it("contains no DROP, RENAME, ALTER COLUMN, and no ALTER on an existing table", () => {
    expect(SQL).not.toMatch(/\bdrop\b|\brename\b|alter column|set not null|set data type/i);
    const altered = [...SQL.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map((m) => m[1]);
    expect(altered.filter((t) => EXISTING.includes(t))).toEqual([]);
  });

  it("applies on top of the production schema without touching existing data", async () => {
    // Folder with only 0000 = today's production schema.
    const dir = mkdtempSync(path.join(tmpdir(), "dp-mig-"));
    cpSync("db/migrations", dir, { recursive: true });
    const journalPath = path.join(dir, "meta/_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    const full = structuredClone(journal);
    journal.entries = journal.entries.filter((e: { tag: string }) => e.tag.startsWith("0000"));
    writeFileSync(journalPath, JSON.stringify(journal));

    const client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: dir });
    await client.exec(`
      insert into repos (owner, name, full_name, category, priority) values ('stripe','stripe-node','stripe/stripe-node','payments','critical');
      insert into releases (repo_id, tag_name, name, published_at, body_hash, html_url, source) values (1,'v1','v1', now(), 'h', 'https://github.com/stripe/stripe-node/releases/tag/v1', 'github_release');
      insert into digest_runs (iso_week, window_start, window_end, status, delivered_at) values ('2026-W42', now(), now(), 'ok', now());
      insert into digest_items (digest_run_id, release_id, repo_id, tag_name, body_hash, tier) values (1,1,1,'v1','h',3);
      insert into recipients (email) values ('keerthi@example.com');
    `);
    const before = await Promise.all(EXISTING.map((t) => client.query(`select * from ${t} order by 1`)));
    const colsBefore = await client.query(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' order by 1,2`);

    // Apply 0001 exactly as `pnpm db:migrate` will in production.
    writeFileSync(journalPath, JSON.stringify(full));
    await migrate(db, { migrationsFolder: dir });

    const after = await Promise.all(EXISTING.map((t) => client.query(`select * from ${t} order by 1`)));
    expect(after.map((r) => r.rows)).toEqual(before.map((r) => r.rows));
    const colsAfter = await client.query(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name = any($1) order by 1,2`, [EXISTING]);
    expect(colsAfter.rows).toEqual(colsBefore.rows.filter((r) => EXISTING.includes((r as { table_name: string }).table_name)));
    const newTables = await client.query(`select table_name from information_schema.tables where table_schema='public' and table_name = any($1) order by 1`, [["adoption_decisions", "app_settings", "evaluation_candidates", "health_narratives", "health_runs", "health_snapshots"]]);
    expect(newTables.rows).toHaveLength(6);
  }, 60_000);
});
