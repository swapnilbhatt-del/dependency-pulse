import "server-only";
import { and, desc, eq, inArray, isNotNull, lt, ne, or, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { ClassificationCache } from "@/lib/ai/classify";
import type { ReleaseAnalysis } from "@/lib/ai/schema";
import type { DigestModel } from "@/lib/digest/model";
import type { HttpCache } from "@/lib/github/client";
import type { NormalizedRelease } from "@/lib/types";

/** Upserts releases by (repo_id, tag_name) and returns their database ids keyed by `${repoId}:${tag}`. */
export async function upsertReleases(rels: NormalizedRelease[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!rels.length) return out;
  const db = getDb();
  for (let i = 0; i < rels.length; i += 50) {
    const chunk = rels.slice(i, i + 50);
    const rows = await db
      .insert(schema.releases)
      .values(
        chunk.map((r) => ({
          repoId: r.repoId,
          githubReleaseId: r.githubReleaseId,
          tagName: r.tagName,
          name: r.name,
          publishedAt: r.publishedAt,
          prerelease: r.prerelease,
          bodyHash: r.bodyHash,
          body: r.body,
          bodyTruncated: r.bodyTruncated,
          notesAvailable: r.notesAvailable,
          htmlUrl: r.htmlUrl,
          source: r.source,
        })),
      )
      .onConflictDoUpdate({
        target: [schema.releases.repoId, schema.releases.tagName],
        set: {
          githubReleaseId: sql`excluded.github_release_id`,
          name: sql`excluded.name`,
          publishedAt: sql`excluded.published_at`,
          prerelease: sql`excluded.prerelease`,
          bodyHash: sql`excluded.body_hash`,
          body: sql`excluded.body`,
          bodyTruncated: sql`excluded.body_truncated`,
          notesAvailable: sql`excluded.notes_available`,
          htmlUrl: sql`excluded.html_url`,
          source: sql`excluded.source`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: schema.releases.id, repoId: schema.releases.repoId, tagName: schema.releases.tagName });
    for (const r of rows) out.set(`${r.repoId}:${r.tagName}`, r.id);
  }
  return out;
}

export const dbClassificationCache: ClassificationCache = {
  async getMany(keys, model) {
    const out = new Map<number, { analysis: ReleaseAnalysis; aiStatus: "ok" | "fallback" }>();
    if (!keys.length) return out;
    const rows = await getDb()
      .select()
      .from(schema.classifications)
      .where(and(eq(schema.classifications.model, model), inArray(schema.classifications.releaseId, keys.map((k) => k.releaseId))));
    const wanted = new Map(keys.map((k) => [k.releaseId, k.bodyHash]));
    for (const r of rows) {
      if (wanted.get(r.releaseId) === r.bodyHash) out.set(r.releaseId, { analysis: r.outputJson as ReleaseAnalysis, aiStatus: r.aiStatus });
    }
    return out;
  },
  async put(e) {
    await getDb()
      .insert(schema.classifications)
      .values({ releaseId: e.releaseId, bodyHash: e.bodyHash, model: e.model, outputJson: e.analysis, aiStatus: e.aiStatus, inputTokens: e.inputTokens, outputTokens: e.outputTokens })
      .onConflictDoUpdate({
        target: [schema.classifications.releaseId, schema.classifications.bodyHash, schema.classifications.model],
        set: { outputJson: e.analysis, aiStatus: e.aiStatus, createdAt: sql`now()` },
      });
  },
};

export const dbHttpCache: HttpCache = {
  async get(url) {
    const [row] = await getDb().select().from(schema.httpCache).where(eq(schema.httpCache.url, url)).limit(1);
    return row ? { etag: row.etag, body: row.body } : null;
  },
  async set(url, etag, body) {
    if (body.length > 2_000_000) return;
    await getDb()
      .insert(schema.httpCache)
      .values({ url, etag, body })
      .onConflictDoUpdate({ target: schema.httpCache.url, set: { etag, body, fetchedAt: sql`now()` } });
  },
};

/** repoId:tag → body hash, as last reported by a digest for another ISO week. */
export async function previouslyReported(repoIds: number[], excludeIsoWeek: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!repoIds.length) return out;
  const rows = await getDb()
    .select({ repoId: schema.digestItems.repoId, tagName: schema.digestItems.tagName, bodyHash: schema.digestItems.bodyHash, startedAt: schema.digestRuns.startedAt })
    .from(schema.digestItems)
    .innerJoin(schema.digestRuns, eq(schema.digestItems.digestRunId, schema.digestRuns.id))
    .where(and(inArray(schema.digestItems.repoId, repoIds), ne(schema.digestRuns.isoWeek, excludeIsoWeek), isNotNull(schema.digestRuns.modelJson)))
    .orderBy(schema.digestRuns.startedAt);
  for (const r of rows) out.set(`${r.repoId}:${r.tagName}`, r.bodyHash);
  return out;
}

export type DigestRunRow = typeof schema.digestRuns.$inferSelect;

export async function getDigestRun(isoWeek: string): Promise<DigestRunRow | null> {
  const [row] = await getDb().select().from(schema.digestRuns).where(eq(schema.digestRuns.isoWeek, isoWeek)).limit(1);
  return row ?? null;
}

/**
 * Weekly idempotency: one digest_runs row per ISO week (unique constraint),
 * plus a short lease so concurrent duplicate invocations cannot both work.
 * Returns the row when this caller holds the lease, or the reason it does not.
 */
export async function claimWeek(
  isoWeek: string,
  window: { start: Date; end: Date },
  trigger: string,
  opts: { force: boolean; leaseMs: number },
): Promise<{ ok: true; row: DigestRunRow } | { ok: false; reason: "already_sent" | "in_progress"; row: DigestRunRow }> {
  const db = getDb();
  await db
    .insert(schema.digestRuns)
    .values({ isoWeek, windowStart: window.start, windowEnd: window.end, status: "running", trigger })
    .onConflictDoNothing({ target: schema.digestRuns.isoWeek });
  const current = (await getDigestRun(isoWeek))!;
  if (current.deliveredAt && !opts.force) return { ok: false, reason: "already_sent", row: current };
  const lease = new Date(Date.now() + opts.leaseMs);
  const [claimed] = await db
    .update(schema.digestRuns)
    .set({
      lockUntil: lease,
      status: "running",
      trigger,
      // A forced re-run regenerates the digest for its own (new) window.
      ...(opts.force || !current.modelJson ? { windowStart: window.start, windowEnd: window.end } : {}),
    })
    .where(and(eq(schema.digestRuns.id, current.id), or(isNull(schema.digestRuns.lockUntil), lt(schema.digestRuns.lockUntil, new Date()))))
    .returning();
  if (!claimed) return { ok: false, reason: "in_progress", row: current };
  return { ok: true, row: claimed };
}

export async function extendLease(id: number, leaseMs: number) {
  await getDb().update(schema.digestRuns).set({ lockUntil: new Date(Date.now() + leaseMs) }).where(eq(schema.digestRuns.id, id));
}

export async function saveDigest(
  id: number,
  d: { model: DigestModel; html: string; text: string; status: "ok" | "partial" | "failed"; error: string | null },
  items: { releaseId: number; repoId: number; tagName: string; bodyHash: string; tier: number }[],
) {
  const db = getDb();
  await db
    .update(schema.digestRuns)
    .set({
      modelJson: d.model,
      html: d.html,
      text: d.text,
      subject: d.model.subject,
      countsJson: d.model.counts,
      status: d.status,
      error: d.error,
      finishedAt: new Date(),
    })
    .where(eq(schema.digestRuns.id, id));
  await db.delete(schema.digestItems).where(eq(schema.digestItems.digestRunId, id));
  for (let i = 0; i < items.length; i += 100) {
    await db
      .insert(schema.digestItems)
      .values(items.slice(i, i + 100).map((x) => ({ ...x, digestRunId: id })))
      .onConflictDoNothing();
  }
}

export async function markDelivery(id: number, status: "sent" | "partial" | "failed", error: string | null) {
  await getDb()
    .update(schema.digestRuns)
    .set({
      deliveryStatus: status,
      ...(status !== "failed" ? { deliveredAt: new Date() } : {}),
      ...(status === "failed" ? { status: "failed" as const, error } : error ? { error } : {}),
      lockUntil: null,
    })
    .where(eq(schema.digestRuns.id, id));
}

export async function releaseLease(id: number) {
  await getDb().update(schema.digestRuns).set({ lockUntil: null }).where(eq(schema.digestRuns.id, id));
}

export async function failDigestRun(id: number, error: string) {
  await getDb().update(schema.digestRuns).set({ status: "failed", error: error.slice(0, 2000), finishedAt: new Date(), lockUntil: null }).where(eq(schema.digestRuns.id, id));
}

export async function recordDeliveries(
  digestRunId: number,
  provider: string,
  attempts: { recipient: string; status: "sent" | "failed"; providerMessageId: string | null; error: string | null }[],
) {
  if (!attempts.length) return;
  await getDb()
    .insert(schema.digestDeliveries)
    .values(attempts.map((a) => ({ digestRunId, recipient: a.recipient, provider, providerMessageId: a.providerMessageId, status: a.status, error: a.error })));
}

export async function deliveryCount(digestRunId: number): Promise<number> {
  const [r] = await getDb().select({ n: sql<number>`count(*)::int` }).from(schema.digestDeliveries).where(eq(schema.digestDeliveries.digestRunId, digestRunId));
  return r?.n ?? 0;
}

// ── Run log ───────────────────────────────────────────────────────────────────
export type PipelineRunRow = typeof schema.pipelineRuns.$inferSelect;

export async function startPipelineRun(v: typeof schema.pipelineRuns.$inferInsert) {
  await getDb().insert(schema.pipelineRuns).values(v);
}

export async function updatePipelineRun(id: string, v: Partial<typeof schema.pipelineRuns.$inferInsert>) {
  await getDb().update(schema.pipelineRuns).set(v).where(eq(schema.pipelineRuns.id, id));
}

export async function listPipelineRuns(limit = 30): Promise<PipelineRunRow[]> {
  return getDb().select().from(schema.pipelineRuns).orderBy(desc(schema.pipelineRuns.startedAt)).limit(limit);
}

export async function getPipelineRun(id: string): Promise<PipelineRunRow | null> {
  const [row] = await getDb().select().from(schema.pipelineRuns).where(eq(schema.pipelineRuns.id, id)).limit(1);
  return row ?? null;
}
