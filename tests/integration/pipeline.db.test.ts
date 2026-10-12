/**
 * Integration tests: the real store code and SQL (migrations, unique ISO-week
 * claim, lease, upserts, AI cache, change detection) against an in-process
 * Postgres (PGlite). GitHub, Gemini and email are faked at the edges only.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { schema, setDbForTesting } from "@/db/client";
import type { JsonModel } from "@/lib/ai/gemini";
import type { EmailProvider } from "@/lib/delivery/email";
import type { RepoIngestResult } from "@/lib/github/ingest";
import { runWeeklyDigest, type PipelineDeps } from "@/lib/pipeline/run";
import * as store from "@/lib/pipeline/store";
import { listEnabledRepos, recordRepoStatuses } from "@/lib/repos/service";
import type { NormalizedRelease, RepoRef } from "@/lib/types";
import { analysis, release } from "../fixtures/factory";

let db: ReturnType<typeof drizzle<typeof schema>>;
let repoId: number;

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "db/migrations" });
  setDbForTesting(db);
  const [r] = await db.insert(schema.repos).values({ owner: "acme", name: "widget", fullName: "acme/widget", category: "payments", priority: "normal" }).returning();
  repoId = r.id;
}, 60_000);

function rel(tag: string, publishedAt: string, body: string): NormalizedRelease {
  return release({ repoId, repoFullName: "acme/widget", tagName: tag, name: tag, githubReleaseId: Number(tag.replace(/\D/g, "")), publishedAt: new Date(publishedAt), body, htmlUrl: `https://github.com/acme/widget/releases/tag/${tag}` });
}

function deps(now: string, ingestFor: (repos: RepoRef[]) => RepoIngestResult[], sent: string[], model: JsonModel | null = null): PipelineDeps {
  const provider: EmailProvider = { name: "fake", send: async (m) => (sent.push(`${m.to}|${m.subject}`), { id: `m${sent.length}` }) };
  return {
    now: () => new Date(now),
    baseUrl: "https://pulse.example",
    timezoneLabel: "Asia/Kolkata",
    model,
    classificationCache: store.dbClassificationCache,
    listEnabledRepos,
    ingest: async (repos) => ingestFor(repos),
    recordRepoStatuses,
    upsertReleases: store.upsertReleases,
    previouslyReported: store.previouslyReported,
    claimWeek: store.claimWeek,
    getWeek: store.getDigestRun,
    saveDigest: store.saveDigest,
    markDelivery: store.markDelivery,
    recordDeliveries: store.recordDeliveries,
    releaseLease: store.releaseLease,
    failDigestRun: store.failDigestRun,
    startPipelineRun: (v) => store.startPipelineRun(v as Parameters<typeof store.startPipelineRun>[0]),
    updatePipelineRun: (id, v) => store.updatePipelineRun(id, v as Parameters<typeof store.updatePipelineRun>[1]),
    recipients: async () => ["keerthi@example.com"],
    emailProvider: () => provider,
    sleep: async () => {},
  };
}

const result = (repos: RepoRef[], releases: NormalizedRelease[], revisit: NormalizedRelease[] = []): RepoIngestResult[] =>
  repos.map((repo) => ({
    repo,
    status: "ok",
    error: null,
    releases: releases.map((r) => ({ release: r, majorBump: null, advisories: [] })),
    revisitCandidates: revisit.map((r) => ({ release: r, majorBump: null, advisories: [] })),
    unmatchedAdvisories: [],
    usedTagFallback: false,
    warnings: [],
    durationMs: 1,
  }));

describe("weekly pipeline on a real Postgres", () => {
  const W42 = "2026-10-12T04:10:00Z"; // Monday, late Hobby cron
  const W43 = "2026-10-19T04:05:00Z";
  const A_v1 = () => rel("v1.4.0", "2026-10-08T09:00:00Z", "Adds webhook retries.");

  it("sends W42 once; the unique ISO-week row and delivery record exist", async () => {
    const sent: string[] = [];
    const first = await runWeeklyDigest(deps(W42, (r) => result(r, [A_v1()]), sent), { trigger: "cron" });
    const second = await runWeeklyDigest(deps(W42, (r) => result(r, [A_v1()]), sent), { trigger: "cron" });
    expect(first.status).toBe("sent");
    expect(second).toMatchObject({ status: "skipped", reason: "already_sent" });
    expect(sent).toHaveLength(1);
    const runs = await db.select().from(schema.digestRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ isoWeek: "2026-W42", deliveryStatus: "sent" });
    expect(runs[0].windowEnd.toISOString()).toBe("2026-10-12T03:30:00.000Z");
    expect(await db.select().from(schema.digestItems)).toHaveLength(1);
    expect(await db.select().from(schema.digestDeliveries)).toHaveLength(1);
    const [repo] = await db.select().from(schema.repos);
    expect(repo.lastStatus).toBe("ok");
  });

  it("concurrent claims of a new week: exactly one wins the lease", async () => {
    const window = { start: new Date("2026-10-26T03:30:00Z"), end: new Date("2026-11-02T03:30:00Z") };
    const claims = await Promise.all([1, 2, 3].map(() => store.claimWeek("2026-W45", window, "cron", { force: false, leaseMs: 60_000 })));
    expect(claims.filter((c) => c.ok)).toHaveLength(1);
    expect(claims.filter((c) => !c.ok).every((c) => !c.ok && c.reason === "in_progress")).toBe(true);
  });

  it("W43: a release reported in W42 whose notes were edited comes back under “Updated since last digest”", async () => {
    const sent: string[] = [];
    const edited = rel("v1.4.0", "2026-10-08T09:00:00Z", "Adds webhook retries. Also fixes retry jitter on 5xx responses.");
    const fresh = rel("v1.5.0", "2026-10-15T09:00:00Z", "Adds idempotency keys.");
    const r = await runWeeklyDigest(deps(W43, (repos) => result(repos, [fresh], [edited]), sent), { trigger: "cron" });
    expect(r.status).toBe("sent");
    const [w43] = (await db.select().from(schema.digestRuns)).filter((x) => x.isoWeek === "2026-W43");
    const model = w43.modelJson as { updated: { tag: string; flags: { updated: boolean } }[]; fyi: { items: { tag: string }[] }[] };
    expect(model.updated.map((i) => i.tag)).toEqual(["v1.4.0"]);
    expect(model.updated[0].flags.updated).toBe(true);
    expect(model.fyi.flatMap((g) => g.items.map((i) => i.tag))).toEqual(["v1.5.0"]);
    expect(w43.html).toContain("Updated since last digest");
  });

  it("a release unchanged since it was last reported (in W43, as updated) is not repeated", async () => {
    const sent: string[] = [];
    const current = rel("v1.4.0", "2026-10-08T09:00:00Z", "Adds webhook retries. Also fixes retry jitter on 5xx responses.");
    const r = await runWeeklyDigest(deps("2026-10-26T04:00:00Z", (repos) => result(repos, [], [current]), sent), { trigger: "cron" });
    expect(r.status).toBe("sent");
    const [w44] = (await db.select().from(schema.digestRuns)).filter((x) => x.isoWeek === "2026-W44");
    expect((w44.modelJson as { updated: unknown[] }).updated).toHaveLength(0);
  });

  it("per-release AI results are cached by release + body hash + model; a re-run makes no per-release calls", async () => {
    let calls = 0;
    const model: JsonModel = {
      model: "gemini-test",
      generateJson: async (req) => {
        if (req.prompt.startsWith("Task: summarize one GitHub release")) calls++;
        return { text: JSON.stringify(analysis({ one_line_summary: "Adds idempotency keys." })), usage: { input: 10, output: 5 } };
      },
    };
    const ing = (repos: RepoRef[]) => result(repos, [rel("v1.6.0", "2026-11-04T09:00:00Z", "Adds idempotency keys.")]);
    await runWeeklyDigest(deps("2026-11-09T04:00:00Z", ing, [], model), { trigger: "preview" });
    const afterFirst = calls;
    await runWeeklyDigest(deps("2026-11-09T04:00:00Z", ing, [], model), { trigger: "preview" });
    expect(afterFirst).toBeGreaterThan(0);
    expect(calls).toBe(afterFirst);
    const rows = await db.select().from(schema.classifications);
    expect(rows.some((r) => r.model === "gemini-test" && r.aiStatus === "ok")).toBe(true);
  });
});
