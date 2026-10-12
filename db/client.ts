import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

export type Db = PostgresJsDatabase<typeof schema>;

let instance: Db | null = null;

/**
 * Lazily created so that builds and tests never need DATABASE_URL.
 * Works with any Postgres (Supabase transaction pooler, Neon pooled URL, local).
 * prepare:false is required by transaction-mode poolers (PgBouncer/Supavisor).
 */
export function getDb(): Db {
  if (instance) return instance;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. See .env.example.");
  const client = postgres(url, { prepare: false, max: 5, idle_timeout: 20, connect_timeout: 10 });
  instance = drizzle(client, { schema });
  return instance;
}

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL) || instance !== null;
}

/** Integration tests run the real store code against an in-process Postgres (PGlite). */
export function setDbForTesting(db: unknown): void {
  instance = db as Db;
}

export { schema };
