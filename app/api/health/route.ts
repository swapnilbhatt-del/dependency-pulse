import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, hasDatabase } from "@/db/client";
import { configStatus, missingRequired } from "@/lib/env";
import { errorMessage } from "@/lib/log";

export const dynamic = "force-dynamic";

/** Health: database reachability and which config is present. Never returns secret values. */
export async function GET() {
  let db: { ok: boolean; error?: string; repos?: number } = { ok: false, error: "DATABASE_URL not set" };
  if (hasDatabase()) {
    try {
      const rows = await getDb().execute(sql`select count(*)::int as n from repos where deleted_at is null`);
      db = { ok: true, repos: Number((rows.rows[0] as { n: number } | undefined)?.n ?? 0) };
    } catch (err) {
      db = { ok: false, error: errorMessage(err).replace(/postgres(ql)?:\/\/\S+/gi, "[redacted]").slice(0, 200) };
    }
  }
  const missing = missingRequired();
  const ok = db.ok && missing.length === 0;
  return NextResponse.json(
    { ok, db, config: { present: configStatus(), missing }, time: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
