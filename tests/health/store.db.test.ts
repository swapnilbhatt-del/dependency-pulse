/** Health store on a real Postgres (PGlite): completeness rule, ISO-week idempotency, decisions, flag, resumable runs. */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { schema, setDbForTesting } from "@/db/client";
import type { Collected } from "@/lib/health/collect";
import { refreshAll, type HealthDeps } from "@/lib/health/refresh";
import * as store from "@/lib/health/store";
import { decideCurrent, slugFor } from "@/lib/health/store/rules";
import { metrics, mv } from "./fixtures";

let id = 0;
beforeAll(async () => {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: "db/migrations" });
  setDbForTesting(db);
  const c = await store.insertCandidate({ owner: "acme", name: "lib", fullName: "acme/lib", slug: slugFor("acme/lib"), packageEcosystem: "npm", packageName: "acme-lib", intendedUse: "JWT verification" });
  id = c.id;
}, 60_000);

function deps(now: string, collect: () => Collected): HealthDeps {
  return {
    now: () => new Date(now),
    github: () => ({}) as never,
    http: {},
    model: null,
    narrativeCache: store.dbNarrativeCache,
    listCandidates: async () => (await store.listCandidates()).map((c) => ({ id: c.id, fullName: c.fullName, intendedUse: c.intendedUse, packageEcosystem: c.packageEcosystem ?? null, packageName: c.packageName, sponsorshipOrBacking: c.sponsorshipOrBacking })),
    hasSnapshotForWeek: async (cid, w) => (await store.snapshotForWeek(cid, w)) !== null,
    saveSnapshot: (v) => store.saveSnapshot(v),
    startRun: (v) => store.startHealthRun(v),
    updateRun: (rid, v) => store.updateHealthRun(rid, v),
    getRun: (rid) => store.getHealthRun(rid),
    collect: async () => collect(),
  };
}
const full = (): Collected => ({ metrics: metrics(), sources: { github: { state: "ok", reason: null, at: "x" } }, canonicalName: "acme/lib", links: {} });
const thin = (): Collected => ({
  metrics: metrics((m) => {
    m.security.scorecardScore = mv(null);
    m.vulnerabilities.total = mv(null);
    m.maintenance.daysSinceLastCommit = mv(null);
  }),
  sources: { github: { state: "rate_limited", reason: "GitHub rate limit reached.", at: "x" }, scorecard: { state: "error", reason: "Timed out after 10 s", at: "x" } },
  canonicalName: "acme/lib",
  links: {},
});

describe("snapshot rules", () => {
  it("decideCurrent: equal or more complete replaces; less complete keeps the previous with a note", () => {
    const cur = { weightCoverage: 0.9, capturedAt: new Date("2026-10-05") };
    expect(decideCurrent({ weightCoverage: 0.9, capturedAt: new Date("2026-10-12") }, cur)).toEqual({ action: "replace" });
    const keep = decideCurrent({ weightCoverage: 0.55, capturedAt: new Date("2026-10-12") }, cur);
    expect(keep.action).toBe("keep_previous");
    expect((keep as { note: string }).note).toMatch(/reached only 55 percent .* had 90 percent/);
  });

  it("W42 full refresh becomes current; a second cron run the same week is skipped (idempotent)", async () => {
    const r1 = await refreshAll(deps("2026-10-12T04:30:00Z", full), { trigger: "cron" });
    expect(r1.status).toBe("ok");
    const r2 = await refreshAll(deps("2026-10-12T05:00:00Z", full), { trigger: "cron" });
    expect(r2.progress.results["acme/lib"].note).toBe("Already refreshed this ISO week");
    const rows = await store.snapshotHistory(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ isoWeek: "2026-W42", isCurrent: true, verdict: "healthy" });
  });

  it("W43 less complete refresh is stored but does not replace the W42 report, and says so", async () => {
    const r = await refreshAll(deps("2026-10-19T04:30:00Z", thin), { trigger: "cron" });
    expect(r.progress.results["acme/lib"]).toMatchObject({ current: false });
    const cur = await store.currentSnapshot(id);
    expect(cur?.isoWeek).toBe("2026-W42");
    const c = await store.getCandidate(id);
    expect(c?.lastRefreshNote).toMatch(/earlier, more complete report is still shown/);
    expect((await store.snapshotHistory(id)).map((s) => [s.isoWeek, s.isCurrent])).toEqual([["2026-W43", false], ["2026-W42", true]]);
  });

  it("a forced admin refresh in W43 with full data replaces the week's row and becomes current", async () => {
    await refreshAll(deps("2026-10-19T09:00:00Z", full), { trigger: "admin_one", force: true, onlyIds: [id] });
    const hist = await store.snapshotHistory(id);
    expect(hist).toHaveLength(2);
    expect(hist[0]).toMatchObject({ isoWeek: "2026-W43", isCurrent: true, forced: true });
    expect((await store.getCandidate(id))?.lastRefreshNote).toBeNull();
  });

  it("stores source status and the config version with each snapshot", async () => {
    const s = await store.currentSnapshot(id);
    expect(s?.configVersion).toMatch(/^2026-/);
    expect(s?.sourceStatusJson).toMatchObject({ github: { state: "ok" } });
    expect(s?.aiStatus).toBe("skipped"); // no model in tests → template narrative, visibly labelled
  });
});

describe("resumable runs", () => {
  it("stops at the budget, records progress, and a continuation finishes the rest", async () => {
    await store.insertCandidate({ owner: "b", name: "two", fullName: "b/two", slug: "b--two" });
    await store.insertCandidate({ owner: "c", name: "three", fullName: "c/three", slug: "c--three" });
    const first = await refreshAll(deps("2026-10-26T04:30:00Z", full), { trigger: "cron", budgetMs: -1 });
    expect(first.status).toBe("continue");
    expect(first.remaining).toBe(3);
    const second = await refreshAll(deps("2026-10-26T04:31:00Z", full), { trigger: "continue", continueRunId: first.runId });
    expect(second.status).toBe("ok");
    expect(second.progress.done).toHaveLength(3);
    const run = await store.getHealthRun(first.runId);
    expect(run?.status).toBe("ok");
  });
});

describe("decisions and settings", () => {
  it("decisions are appended with reason, date and decided_by; the latest is first", async () => {
    await store.recordDecision(id, "parked", "Waiting for the v4 API.", "Keerthi");
    await store.recordDecision(id, "adopted", "Replaces jsonwebtoken in the auth service.", "Keerthi");
    const log = await store.listDecisions(id);
    expect(log.map((d) => d.status)).toEqual(["adopted", "parked"]);
    expect(log[0]).toMatchObject({ reason: "Replaces jsonwebtoken in the auth service.", decidedBy: "Keerthi" });
    expect((await store.getCandidate(id))?.adoptionStatus).toBe("adopted");
  });
  it("the email feature flag defaults to off", async () => {
    expect(await store.getSetting(store.EMAIL_WATCHLIST_FLAG, false)).toBe(false);
    await store.setSetting(store.EMAIL_WATCHLIST_FLAG, true);
    expect(await store.getSetting(store.EMAIL_WATCHLIST_FLAG, false)).toBe(true);
  });
});
