import type { Metadata } from "next";
import Link from "next/link";
import { desc, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { ResendButton, RunControls } from "@/components/admin/run-controls";
import { RunStatusBadge, StatusBadge } from "@/components/admin/status-badge";
import type { DigestModel } from "@/lib/digest/model";
import { fmtDateTime } from "@/lib/digest/format";
import { timezoneLabel } from "@/lib/env";
import { isoWeek } from "@/lib/filter/window";
import { listPipelineRuns } from "@/lib/pipeline/store";

export const metadata: Metadata = { title: "Runs" };
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface RepoResult {
  repo: string;
  status: "ok" | "not_found" | "rate_limited" | "error";
  error: string | null;
  releases: number;
  tagFallback: boolean;
  warnings: string[];
  durationMs: number;
}

function dur(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

const TRIGGER_LABEL: Record<string, string> = { cron: "Weekly schedule", preview: "Preview", send: "Send now", resend: "Resend", continue: "Continuation", rebuild: "Rebuild (no email)" };

export default async function RunsPage() {
  const tz = timezoneLabel();
  const [runs, weeks] = await Promise.all([
    listPipelineRuns(40),
    getDb()
      .select({
        isoWeek: schema.digestRuns.isoWeek,
        status: schema.digestRuns.status,
        deliveryStatus: schema.digestRuns.deliveryStatus,
        deliveredAt: schema.digestRuns.deliveredAt,
        error: schema.digestRuns.error,
        modelJson: schema.digestRuns.modelJson,
      })
      .from(schema.digestRuns)
      .where(isNotNull(schema.digestRuns.isoWeek))
      .orderBy(desc(schema.digestRuns.isoWeek))
      .limit(12),
  ]);
  const thisWeek = isoWeek(new Date());
  const currentSent = weeks.some((w) => w.isoWeek === thisWeek && w.deliveredAt);
  const latest = runs.find((r) => r.repoResultsJson);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-display text-[2.5rem] leading-tight">Runs</h1>
        <p className="mt-1 text-sm text-ink-2">Every pipeline run, newest first, with per-repository results and AI usage.</p>
      </div>

      <RunControls currentWeek={thisWeek} currentWeekSent={currentSent} />

      <section aria-labelledby="weeks">
        <h2 id="weeks" className="text-lg font-semibold">
          Weekly digests
        </h2>
        {weeks.length === 0 ? (
          <p className="card mt-3 p-4 text-ink-2">No weekly digest yet. Use “Send digest now” or wait for Monday’s run.</p>
        ) : (
          <div className="mt-3 md:card">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Week</th>
                  <th scope="col">Digest</th>
                  <th scope="col">Email</th>
                  <th scope="col">Counts</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((w) => {
                  const m = w.modelJson as DigestModel | null;
                  return (
                    <tr key={w.isoWeek}>
                      <td data-label="Week" className="font-semibold tabular">
                        {m ? <Link href={`/digest/${w.isoWeek}`}>{w.isoWeek}</Link> : w.isoWeek}
                      </td>
                      <td data-label="Digest">
                        <RunStatusBadge status={w.status} />
                      </td>
                      <td data-label="Email" className="text-sm">
                        {w.deliveredAt ? (
                          <span>
                            {w.deliveryStatus === "partial" ? "Partly sent" : "Sent"} {fmtDateTime(w.deliveredAt.toISOString(), tz)}
                          </span>
                        ) : w.deliveryStatus === "failed" ? (
                          <span className="text-act">Failed{w.error ? `: ${w.error}` : ""}</span>
                        ) : (
                          <span className="text-ink-3">Not sent</span>
                        )}
                      </td>
                      <td data-label="Counts" className="text-sm tabular">
                        {m ? `${m.counts.act} act · ${m.counts.review} review · ${m.counts.fyi} FYI · ${m.counts.couldNotCheck} skipped` : "—"}
                      </td>
                      <td className="text-right">{m && <ResendButton isoWeek={w.isoWeek} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="run-log">
        <h2 id="run-log" className="text-lg font-semibold">
          Run log
        </h2>
        {runs.length === 0 ? (
          <p className="card mt-3 p-4 text-ink-2">No runs yet. Start one with “Run preview”.</p>
        ) : (
          <ol className="mt-3 space-y-2">
            {runs.map((r) => {
              const repos = (r.repoResultsJson as RepoResult[] | null) ?? [];
              const errors = (r.errorsJson as string[] | null) ?? [];
              const counts = r.countsJson as DigestModel["counts"] | null;
              return (
                <li key={r.id} className="card" data-testid="run-item">
                  <details open={r.id === latest?.id}>
                    <summary className="flex flex-wrap items-center gap-x-4 gap-y-1 p-4 min-h-11">
                      <RunStatusBadge status={r.status} />
                      <span className="font-semibold">{TRIGGER_LABEL[r.trigger] ?? r.trigger}</span>
                      <span className="text-sm text-ink-2 tabular">{fmtDateTime(r.startedAt.toISOString(), tz)}</span>
                      <span className="text-sm text-ink-3 tabular">{dur(r.durationMs)}</span>
                      <span className="text-sm text-ink-3 tabular">{r.isoWeek}</span>
                      {counts && (
                        <span className="text-sm text-ink-2 tabular">
                          {counts.releasesFound} releases · {counts.act} act · {counts.review} review · {counts.couldNotCheck} skipped
                        </span>
                      )}
                      <span className="ml-auto text-sm font-semibold text-accent">Details</span>
                    </summary>
                    <div className="disclosure-body border-t border-line p-4 space-y-3 text-sm">
                      <p className="text-ink-2 tabular">
                        AI: {r.aiCalls} Gemini calls, {r.aiCacheHits} cache hits, {r.aiFallbacks} fallbacks, {r.tokensIn.toLocaleString("en")} input / {r.tokensOut.toLocaleString("en")} output tokens.
                        {r.note ? ` ${r.note}` : ""}
                      </p>
                      {r.previewModelJson ? (
                        <p>
                          <Link href={`/admin/preview/${r.id}`}>Open this preview</Link>
                        </p>
                      ) : null}
                      {errors.length > 0 && (
                        <ul className="list-disc pl-5 text-act">
                          {errors.slice(0, 10).map((e, i) => (
                            <li key={i} className="break-words">
                              {e}
                            </li>
                          ))}
                        </ul>
                      )}
                      {repos.length > 0 && (
                        <table className="data-table">
                          <caption className="sr-only">Per-repository results</caption>
                          <thead>
                            <tr>
                              <th scope="col">Repository</th>
                              <th scope="col">Status</th>
                              <th scope="col">Releases</th>
                              <th scope="col">Time</th>
                              <th scope="col">Notes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {repos.map((x) => (
                              <tr key={x.repo}>
                                <td data-label="Repository" className="font-medium break-all">
                                  {x.repo}
                                </td>
                                <td data-label="Status">
                                  <StatusBadge status={x.status} />
                                </td>
                                <td data-label="Releases" className="tabular">
                                  {x.releases}
                                  {x.tagFallback ? " (tags)" : ""}
                                </td>
                                <td data-label="Time" className="tabular">
                                  {dur(x.durationMs)}
                                </td>
                                <td data-label="Notes" className="text-ink-3 break-words">
                                  {[x.error, ...x.warnings].filter(Boolean).join(" ") || "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
