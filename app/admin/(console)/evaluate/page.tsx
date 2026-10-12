import type { Metadata } from "next";
import { CandidateManager, type AdminCandidate } from "@/components/admin/candidate-manager";
import * as store from "@/lib/health/store";
import type { SourceStatus } from "@/lib/health/types";

export const metadata: Metadata = { title: "Adoption Check" };
export const dynamic = "force-dynamic";
export const maxDuration = 300; // refresh-all runs inside this page's server actions

const SOURCE_LABEL: Record<string, string> = { github: "GitHub", scorecard: "OpenSSF Scorecard", osv: "OSV.dev", npm: "npm", pypi: "PyPI stats" };

export default async function AdminEvaluatePage() {
  const [rows, emailEnabled, lastOk, runs] = await Promise.all([store.listCandidates(), store.getSetting(store.EMAIL_WATCHLIST_FLAG, false), store.sourceLastSuccess(), store.listHealthRuns(8)]);
  const snaps = await store.currentSnapshots(rows.map((r) => r.id));
  const candidates: AdminCandidate[] = rows.map((r) => {
    const s = snaps.get(r.id);
    return {
      id: r.id,
      slug: r.slug,
      fullName: r.fullName,
      intendedUse: r.intendedUse,
      packageEcosystem: r.packageEcosystem ?? null,
      packageName: r.packageName,
      sponsorship: r.sponsorshipOrBacking,
      teamNotes: r.teamNotes,
      notesPublic: r.notesPublic,
      adoptionStatus: r.adoptionStatus,
      isExample: r.isExample,
      verdict: s?.verdict ?? null,
      score: s?.overallScore ?? null,
      lastChecked: s?.capturedAt.toISOString() ?? null,
      sources: (s?.sourceStatusJson as Partial<Record<string, SourceStatus>>) ?? {},
      refreshNote: r.lastRefreshNote,
    };
  });
  return (
    <div className="space-y-10">
      <CandidateManager candidates={candidates} emailEnabled={emailEnabled} />
      <section aria-labelledby="sources-status">
        <h2 id="sources-status" className="text-lg font-semibold">
          Data sources
        </h2>
        <p className="mt-1 text-sm text-ink-2">When each source last answered successfully.</p>
        <ul className="mt-3 flex flex-wrap gap-2 text-sm" data-testid="source-last-success">
          {Object.entries(lastOk).map(([k, at]) => (
            <li key={k} className={`chip ${at ? "chip-ok" : "chip-dashed"}`}>
              {SOURCE_LABEL[k] ?? k}: {at ? `${at.replace("T", " ").slice(0, 16)} UTC` : "not reached yet"}
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="health-runs">
        <h2 id="health-runs" className="text-lg font-semibold">
          Recent health runs
        </h2>
        {runs.length === 0 ? (
          <p className="card mt-3 p-4 text-ink-2">No health runs yet. They run every Monday at 04:30 UTC, or when you click “Refresh all”.</p>
        ) : (
          <ul className="card mt-3 divide-y divide-line text-sm">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <span className={`chip ${r.status === "ok" ? "chip-ok" : r.status === "partial" ? "chip-review" : r.status === "failed" ? "chip-act" : ""}`}>{r.status}</span>
                <span className="tabular">{r.startedAt.toISOString().replace("T", " ").slice(0, 16)} UTC</span>
                <span className="text-ink-2">{{ cron: "Weekly schedule", admin_all: "Refresh all", admin_one: "Single refresh", continue: "Continuation" }[r.trigger]}</span>
                <span className="text-ink-3 tabular">{r.isoWeek}</span>
                {r.countsJson ? <span className="text-ink-3">{Object.entries(r.countsJson as Record<string, number>).map(([k, v]) => `${v} ${k}`).join(" · ")}</span> : null}
                {r.error && <span className="text-act">{r.error}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
