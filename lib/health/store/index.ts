import "server-only";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { audit } from "@/lib/audit";
import type { NarrativeCache } from "@/lib/health/ai/narrate";
import type { Narrative } from "@/lib/health/ai/schema";
import { decideCurrent } from "@/lib/health/store/rules";

export type CandidateRow = typeof schema.evaluationCandidates.$inferSelect;
export type SnapshotRow = typeof schema.healthSnapshots.$inferSelect;
export type DecisionRow = typeof schema.adoptionDecisions.$inferSelect;
export type HealthRunRow = typeof schema.healthRuns.$inferSelect;

const C = schema.evaluationCandidates;
const S = schema.healthSnapshots;

// ── Candidates ───────────────────────────────────────────────────────────────
export async function listCandidates(opts: { includeArchived?: boolean } = {}): Promise<CandidateRow[]> {
  const q = getDb().select().from(C);
  const rows = opts.includeArchived ? await q.orderBy(asc(C.fullName)) : await q.where(eq(C.archivedFromWatchlist, false)).orderBy(asc(C.fullName));
  return rows;
}
export async function getCandidateBySlug(slug: string): Promise<CandidateRow | null> {
  const [r] = await getDb().select().from(C).where(eq(C.slug, slug)).limit(1);
  return r ?? null;
}
export async function getCandidate(id: number): Promise<CandidateRow | null> {
  const [r] = await getDb().select().from(C).where(eq(C.id, id)).limit(1);
  return r ?? null;
}
export async function findCandidateByName(fullName: string): Promise<CandidateRow | null> {
  const [r] = await getDb().select().from(C).where(sql`lower(${C.fullName}) = lower(${fullName})`).limit(1);
  return r ?? null;
}
export async function insertCandidate(v: typeof C.$inferInsert): Promise<CandidateRow> {
  const [r] = await getDb().insert(C).values(v).returning();
  await audit("candidate.add", r.fullName, { packageEcosystem: r.packageEcosystem, packageName: r.packageName, isExample: r.isExample });
  return r;
}
export async function updateCandidate(id: number, patch: Partial<typeof C.$inferInsert>, auditAction = "candidate.update"): Promise<CandidateRow | null> {
  const [r] = await getDb().update(C).set({ ...patch, updatedAt: new Date() }).where(eq(C.id, id)).returning();
  if (r) await audit(auditAction, r.fullName, Object.fromEntries(Object.entries(patch).filter(([k]) => k !== "teamNotes")));
  return r ?? null;
}

// ── Decisions (append-only) ──────────────────────────────────────────────────
export async function recordDecision(candidateId: number, status: DecisionRow["status"], reason: string, decidedBy: string): Promise<DecisionRow> {
  const db = getDb();
  const [d] = await db.insert(schema.adoptionDecisions).values({ candidateId, status, reason, decidedBy }).returning();
  const [c] = await db.update(C).set({ adoptionStatus: status, adoptionReason: reason, decidedAt: d.decidedAt, decidedBy, updatedAt: new Date() }).where(eq(C.id, candidateId)).returning();
  await audit("candidate.decision", c?.fullName ?? String(candidateId), { status, decidedBy });
  return d;
}
export async function listDecisions(candidateId: number): Promise<DecisionRow[]> {
  return getDb().select().from(schema.adoptionDecisions).where(eq(schema.adoptionDecisions.candidateId, candidateId)).orderBy(desc(schema.adoptionDecisions.decidedAt), desc(schema.adoptionDecisions.id));
}

// ── Snapshots ────────────────────────────────────────────────────────────────
export async function snapshotForWeek(candidateId: number, isoWeek: string): Promise<SnapshotRow | null> {
  const [r] = await getDb().select().from(S).where(and(eq(S.candidateId, candidateId), eq(S.isoWeek, isoWeek))).limit(1);
  return r ?? null;
}
export async function currentSnapshot(candidateId: number): Promise<SnapshotRow | null> {
  const [r] = await getDb().select().from(S).where(and(eq(S.candidateId, candidateId), eq(S.isCurrent, true))).limit(1);
  return r ?? null;
}
export async function currentSnapshots(candidateIds: number[]): Promise<Map<number, SnapshotRow>> {
  if (!candidateIds.length) return new Map();
  const rows = await getDb().select().from(S).where(and(inArray(S.candidateId, candidateIds), eq(S.isCurrent, true)));
  return new Map(rows.map((r) => [r.candidateId, r]));
}
export async function snapshotHistory(candidateId: number, limit = 12): Promise<SnapshotRow[]> {
  return getDb().select().from(S).where(eq(S.candidateId, candidateId)).orderBy(desc(S.capturedAt)).limit(limit);
}

/**
 * Stores a snapshot under the completeness rule: one row per candidate and ISO
 * week (a forced refresh updates that week's row), and a less complete refresh
 * never replaces the report currently shown.
 */
export async function saveSnapshot(v: Omit<typeof S.$inferInsert, "isCurrent">): Promise<{ row: SnapshotRow; current: boolean; note: string | null }> {
  const db = getDb();
  const cur = await currentSnapshot(v.candidateId);
  const capturedAt = v.capturedAt ?? new Date();
  const decision = decideCurrent({ weightCoverage: v.weightCoverage, capturedAt }, cur ? { weightCoverage: cur.weightCoverage, capturedAt: cur.capturedAt } : null);
  const replace = decision.action === "replace";
  const existing = await snapshotForWeek(v.candidateId, v.isoWeek);

  let row: SnapshotRow;
  if (existing && !replace) {
    // Same week, less complete: keep the stored, more complete snapshot untouched.
    row = existing;
  } else if (existing) {
    [row] = await db.update(S).set({ ...v, capturedAt, isCurrent: true }).where(eq(S.id, existing.id)).returning();
  } else {
    [row] = await db.insert(S).values({ ...v, capturedAt, isCurrent: replace }).returning();
  }
  if (replace) await db.update(S).set({ isCurrent: false }).where(and(eq(S.candidateId, v.candidateId), ne(S.id, row.id)));
  await db.update(C).set({ lastRefreshNote: replace ? null : decision.action === "keep_previous" ? decision.note : null, updatedAt: new Date() }).where(eq(C.id, v.candidateId));
  return { row, current: replace, note: decision.action === "keep_previous" ? decision.note : null };
}

// ── Narrative cache ──────────────────────────────────────────────────────────
export const dbNarrativeCache: NarrativeCache = {
  async get(candidateId, inputHash, model) {
    const [r] = await getDb()
      .select()
      .from(schema.healthNarratives)
      .where(and(eq(schema.healthNarratives.candidateId, candidateId), eq(schema.healthNarratives.inputHash, inputHash), eq(schema.healthNarratives.model, model)))
      .limit(1);
    return (r?.narrativeJson as Narrative | undefined) ?? null;
  },
  async put(candidateId, inputHash, model, n) {
    await getDb().insert(schema.healthNarratives).values({ candidateId, inputHash, model, narrativeJson: n }).onConflictDoNothing();
  },
};

// ── Runs ─────────────────────────────────────────────────────────────────────
export async function startHealthRun(v: typeof schema.healthRuns.$inferInsert) {
  await getDb().insert(schema.healthRuns).values(v);
}
export async function updateHealthRun(id: string, v: Partial<typeof schema.healthRuns.$inferInsert>) {
  await getDb().update(schema.healthRuns).set(v).where(eq(schema.healthRuns.id, id));
}
export async function getHealthRun(id: string): Promise<HealthRunRow | null> {
  const [r] = await getDb().select().from(schema.healthRuns).where(eq(schema.healthRuns.id, id)).limit(1);
  return r ?? null;
}
export async function listHealthRuns(limit = 10): Promise<HealthRunRow[]> {
  return getDb().select().from(schema.healthRuns).orderBy(desc(schema.healthRuns.startedAt)).limit(limit);
}

/** Last time each source answered successfully, from the most recent snapshots. */
export async function sourceLastSuccess(): Promise<Record<string, string | null>> {
  const rows = await getDb().select({ s: S.sourceStatusJson, at: S.capturedAt }).from(S).orderBy(desc(S.capturedAt)).limit(200);
  const out: Record<string, string | null> = { github: null, scorecard: null, osv: null, npm: null, pypi: null };
  for (const r of rows) {
    for (const [k, v] of Object.entries((r.s ?? {}) as Record<string, { state: string; at: string }>)) {
      if (v?.state === "ok" && (!out[k] || v.at > out[k]!)) out[k] = v.at;
    }
  }
  return out;
}

// ── Settings / feature flag ──────────────────────────────────────────────────
export const EMAIL_WATCHLIST_FLAG = "email_watchlist_enabled";
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const [r] = await getDb().select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).limit(1);
  return r ? (r.valueJson as T) : fallback;
}
export async function setSetting(key: string, value: unknown): Promise<void> {
  await getDb()
    .insert(schema.appSettings)
    .values({ key, valueJson: value })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { valueJson: value, updatedAt: new Date() } });
  await audit("setting.update", key, { value });
}
