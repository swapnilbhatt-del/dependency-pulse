import { describe, expect, it, vi } from "vitest";
import type { ClassificationCache } from "@/lib/ai/classify";
import type { JsonModel } from "@/lib/ai/gemini";
import type { EmailProvider } from "@/lib/delivery/email";
import type { RepoIngestResult } from "@/lib/github/ingest";
import { resendStoredDigest, runWeeklyDigest, type PipelineDeps } from "@/lib/pipeline/run";
import type { RepoRef } from "@/lib/types";
import { analysis, release, repo } from "../fixtures/factory";

interface WeekRow {
  id: number;
  isoWeek: string;
  windowStart: Date;
  windowEnd: Date;
  html: string | null;
  text: string | null;
  subject: string | null;
  deliveredAt: Date | null;
  lockUntil: number | null;
  status: string;
}

function fakeDeps(opts: { ingest?: (repos: RepoRef[]) => RepoIngestResult[]; provider?: EmailProvider; model?: JsonModel | null; recipients?: string[]; now?: Date } = {}) {
  const weeks = new Map<string, WeekRow>();
  const sent: { to: string; subject: string; key: string }[] = [];
  const deliveries: { status: string }[] = [];
  const runs = new Map<string, Record<string, unknown>>();
  const saved: { id: number; items: unknown[] }[] = [];
  const cache: ClassificationCache = { getMany: async () => new Map(), put: async () => {} };
  const repos = [repo({ id: 1, fullName: "stripe/stripe-node", priority: "critical" }), repo({ id: 2, fullName: "panva/jose", category: "auth" })];
  const provider: EmailProvider = opts.provider ?? {
    name: "fake",
    send: async (m) => {
      sent.push({ to: m.to, subject: m.subject, key: m.idempotencyKey });
      return { id: `msg-${sent.length}` };
    },
  };
  const defaultIngest = (rs: RepoRef[]): RepoIngestResult[] =>
    rs.map((r) => ({
      repo: r,
      status: "ok",
      error: null,
      releases:
        r.id === 1
          ? [{ release: release({ repoId: 1, repoFullName: r.fullName, tagName: "v19.1.0", body: "Fixes CVE-2026-4242 in webhook signature checks." }), majorBump: null, advisories: [] }]
          : [],
      revisitCandidates: [], unmatchedAdvisories: [],
      usedTagFallback: false,
      warnings: [],
      durationMs: 5,
    }));
  let id = 0;
  const deps: PipelineDeps = {
    now: () => opts.now ?? new Date("2026-10-12T04:12:00Z"),
    baseUrl: "https://pulse.example",
    timezoneLabel: "Asia/Kolkata",
    model: opts.model === undefined ? null : opts.model,
    classificationCache: cache,
    listEnabledRepos: async () => repos,
    ingest: async (rs) => (opts.ingest ?? defaultIngest)(rs),
    recordRepoStatuses: async () => {},
    upsertReleases: async (rels) => new Map(rels.map((r, i) => [`${r.repoId}:${r.tagName}`, i + 1])),
    previouslyReported: async () => new Map(),
    claimWeek: async (isoWeek, window, _t, o) => {
      let w = weeks.get(isoWeek);
      if (!w) {
        w = { id: ++id, isoWeek, windowStart: window.start, windowEnd: window.end, html: null, text: null, subject: null, deliveredAt: null, lockUntil: null, status: "running" };
        weeks.set(isoWeek, w);
      }
      if (w.deliveredAt && !o.force) return { ok: false, reason: "already_sent", row: w };
      if (w.lockUntil && w.lockUntil > Date.now()) return { ok: false, reason: "in_progress", row: w };
      w.lockUntil = Date.now() + o.leaseMs;
      return { ok: true, row: w };
    },
    getWeek: async (isoWeek) => weeks.get(isoWeek) ?? null,
    saveDigest: async (wid, d, items) => {
      const w = [...weeks.values()].find((x) => x.id === wid)!;
      Object.assign(w, { html: d.html, text: d.text, subject: d.model.subject, status: d.status });
      saved.push({ id: wid, items });
    },
    markDelivery: async (wid, status) => {
      const w = [...weeks.values()].find((x) => x.id === wid)!;
      if (status !== "failed") w.deliveredAt = new Date();
      else w.status = "failed";
      w.lockUntil = null;
    },
    recordDeliveries: async (_id, _p, attempts) => void deliveries.push(...attempts),
    releaseLease: async (wid) => void ([...weeks.values()].find((x) => x.id === wid)!.lockUntil = null),
    failDigestRun: async (wid) => void Object.assign([...weeks.values()].find((x) => x.id === wid)!, { status: "failed", lockUntil: null }),
    startPipelineRun: async (v) => void runs.set(v.id, { ...v }),
    updatePipelineRun: async (rid, v) => void runs.set(rid, { ...runs.get(rid), ...v }),
    recipients: async () => opts.recipients ?? ["keerthi@example.com"],
    emailProvider: () => provider,
    sleep: async () => {},
  };
  return { deps, weeks, sent, deliveries, runs, saved };
}

describe("weekly job idempotency", () => {
  it("running the weekly job twice for the same ISO week sends once", async () => {
    const f = fakeDeps();
    const first = await runWeeklyDigest(f.deps, { trigger: "cron" });
    const second = await runWeeklyDigest(f.deps, { trigger: "cron" });
    expect(first.status).toBe("sent");
    expect(second).toMatchObject({ status: "skipped", reason: "already_sent" });
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0].subject).toBe("[Dependency Pulse] 1 need action · 0 to review · week of 12 Oct 2026");
  });

  it("concurrent duplicate invocations: only one holds the lease", async () => {
    const f = fakeDeps();
    const [a, b] = await Promise.all([runWeeklyDigest(f.deps, { trigger: "cron" }), runWeeklyDigest(f.deps, { trigger: "cron" })]);
    expect([a.status, b.status].sort()).toEqual(["sent", "skipped"]);
    expect(f.sent).toHaveLength(1);
  });

  it("a late cron invocation still covers the scheduled window (Monday 03:30 UTC)", async () => {
    const f = fakeDeps({ now: new Date("2026-10-12T04:59:00Z") });
    await runWeeklyDigest(f.deps, { trigger: "cron" });
    const w = f.weeks.get("2026-W42")!;
    expect(w.windowEnd.toISOString()).toBe("2026-10-12T03:30:00.000Z");
    expect(w.windowStart.toISOString()).toBe("2026-10-05T03:30:00.000Z");
  });

  it("an admin can force a resend; it uses a fresh provider idempotency key", async () => {
    const f = fakeDeps();
    await runWeeklyDigest(f.deps, { trigger: "cron" });
    const forced = await runWeeklyDigest(f.deps, { trigger: "send", force: true });
    expect(forced.status).toBe("sent");
    expect(f.sent).toHaveLength(2);
    expect(f.sent[0].key).not.toBe(f.sent[1].key);
  });

  it("resend re-sends the stored digest without regenerating", async () => {
    const f = fakeDeps();
    await runWeeklyDigest(f.deps, { trigger: "cron" });
    const ingestSpy = vi.spyOn(f.deps, "ingest");
    const r = await resendStoredDigest(f.deps, "2026-W42");
    expect(r.status).toBe("sent");
    expect(ingestSpy).not.toHaveBeenCalled();
    expect(f.sent).toHaveLength(2);
  });
});

describe("graceful degradation", () => {
  it("a failing repo still ships the digest with a Could not check entry", async () => {
    const f = fakeDeps({
      ingest: (rs) =>
        rs.map((r) => ({ repo: r, status: r.id === 2 ? ("not_found" as const) : ("ok" as const), error: r.id === 2 ? "Repository not found or not accessible (404)." : null, releases: [], revisitCandidates: [], unmatchedAdvisories: [], usedTagFallback: false, warnings: [], durationMs: 1 })),
    });
    const r = await runWeeklyDigest(f.deps, { trigger: "cron" });
    expect(r.status).toBe("sent");
    expect(f.weeks.get("2026-W42")!.html).toContain("Could not check");
    expect(f.weeks.get("2026-W42")!.status).toBe("partial");
    expect(f.sent[0].subject).toMatch(/All quiet this week/);
  });

  it("a Gemini outage yields fallback summaries and a visible footer note", async () => {
    const down: JsonModel = { model: "m", generateJson: async () => Promise.reject(new (await import("@/lib/ai/gemini")).AiUnavailableError("Gemini request failed (503)", 503)) };
    const f = fakeDeps({ model: down });
    const r = await runWeeklyDigest(f.deps, { trigger: "cron" });
    expect(r.status).toBe("sent");
    expect(f.weeks.get("2026-W42")!.html).toMatch(/1 AI fallbacks|1 AI fallback/);
  });

  it("delivery failure is retried once, then the run is marked failed", async () => {
    const send = vi.fn(async () => {
      throw new Error("provider down");
    });
    const f = fakeDeps({ provider: { name: "fake", send } });
    const r = await runWeeklyDigest(f.deps, { trigger: "cron" });
    expect(r.status).toBe("failed");
    expect(send).toHaveBeenCalledTimes(2);
    expect(f.weeks.get("2026-W42")!.deliveredAt).toBeNull();
    // Not delivered, so the next invocation may try again.
    const again = await runWeeklyDigest(f.deps, { trigger: "cron" });
    expect(again.status).toBe("failed");
  });

  it("no recipients is a visible failure, not a silent success", async () => {
    const f = fakeDeps({ recipients: [] });
    const r = await runWeeklyDigest(f.deps, { trigger: "cron" });
    expect(r).toMatchObject({ status: "failed" });
    expect((r as { error?: string }).error).toMatch(/No recipients/);
  });

  it("preview never sends or claims the week", async () => {
    const f = fakeDeps();
    const r = await runWeeklyDigest(f.deps, { trigger: "preview" });
    expect(r.status).toBe("preview");
    expect(f.sent).toHaveLength(0);
    expect(f.weeks.size).toBe(0);
  });

  it("continues in a new invocation when the time budget runs out", async () => {
    const slow: JsonModel = { model: "m", generateJson: async () => ({ text: JSON.stringify(analysis()), usage: null }) };
    const f = fakeDeps({ model: slow });
    const r = await runWeeklyDigest(f.deps, { trigger: "cron", budgetMs: 0 });
    expect(r.status).toBe("continue");
    expect(f.sent).toHaveLength(0);
    const cont = await runWeeklyDigest({ ...f.deps }, { trigger: "continue", isoWeek: "2026-W42" });
    expect(cont.status).toBe("sent");
  });
});
