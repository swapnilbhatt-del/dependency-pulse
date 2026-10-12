import "server-only";
import { desc, eq, isNotNull } from "drizzle-orm";
import { getDb, hasDatabase, schema } from "@/db/client";
import type { DigestModel } from "@/lib/digest/model";

/** Public archive entry: counts and dates only. Never recipients or admin data. */
export interface ArchiveEntry {
  isoWeek: string;
  weekOf: string;
  windowStart: string;
  windowEnd: string;
  generatedAt: string;
  status: string;
  delivered: boolean;
  counts: DigestModel["counts"];
  subject: string;
}

export async function listDigests(limit = 104): Promise<ArchiveEntry[]> {
  if (!hasDatabase()) return [];
  const rows = await getDb()
    .select({
      isoWeek: schema.digestRuns.isoWeek,
      status: schema.digestRuns.status,
      deliveredAt: schema.digestRuns.deliveredAt,
      modelJson: schema.digestRuns.modelJson,
      subject: schema.digestRuns.subject,
    })
    .from(schema.digestRuns)
    .where(isNotNull(schema.digestRuns.modelJson))
    .orderBy(desc(schema.digestRuns.isoWeek))
    .limit(limit);
  return rows.map((r) => {
    const m = r.modelJson as DigestModel;
    return {
      isoWeek: r.isoWeek,
      weekOf: m.weekOf,
      windowStart: m.window.start,
      windowEnd: m.window.end,
      generatedAt: m.generatedAt,
      status: r.status,
      delivered: r.deliveredAt !== null,
      counts: m.counts,
      subject: r.subject ?? m.subject,
    };
  });
}

export async function getDigestModel(isoWeek: string): Promise<DigestModel | null> {
  if (!hasDatabase()) return null;
  const [row] = await getDb().select({ modelJson: schema.digestRuns.modelJson }).from(schema.digestRuns).where(eq(schema.digestRuns.isoWeek, isoWeek)).limit(1);
  return (row?.modelJson as DigestModel | undefined) ?? null;
}

export async function getLatestDigest(): Promise<DigestModel | null> {
  if (!hasDatabase()) return null;
  const [row] = await getDb()
    .select({ modelJson: schema.digestRuns.modelJson })
    .from(schema.digestRuns)
    .where(isNotNull(schema.digestRuns.modelJson))
    .orderBy(desc(schema.digestRuns.isoWeek))
    .limit(1);
  return (row?.modelJson as DigestModel | undefined) ?? null;
}
