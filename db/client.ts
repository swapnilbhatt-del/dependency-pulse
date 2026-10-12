import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "@/db/schema";

export type Db = NeonHttpDatabase<typeof schema>;

let instance: Db | null = null;

/** Lazily created so that builds and tests never need DATABASE_URL. */
export function getDb(): Db {
  if (instance) return instance;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. See .env.example.");
  instance = drizzle(neon(url), { schema });
  return instance;
}

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export { schema };
